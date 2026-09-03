import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Database, ValidationError, ConflictError, newId } from './engine.js';

const SCHEMA = {
  widgets: {
    fields: {
      name: { type: 'string', required: true },
      qty: { type: 'number', default: 0 },
      status: { type: 'string', enum: ['draft', 'live'], default: 'draft' },
      tags: { type: 'array', default: [] },
    },
    indexes: ['status', 'tags'],
    unique: ['name'],
  },
};

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enova-db-'));
  return { dir, db: new Database({ dir, schema: SCHEMA, checkpointMs: 50 }).open() };
}

test('ids sort by mint order even within the same millisecond', () => {
  const ids = Array.from({ length: 500 }, () => newId());
  assert.equal(new Set(ids).size, 500, 'ids must be unique');
  assert.deepEqual(ids, [...ids].sort(), 'ids must be lexicographically ordered');
});

test('insert applies defaults, stamps metadata and validates', () => {
  const { db } = freshDb();
  const row = db.insert('widgets', { name: 'Gummy line' }, { actorId: 'u1' });
  assert.equal(row.qty, 0);
  assert.equal(row.status, 'draft');
  assert.deepEqual(row.tags, []);
  assert.equal(row.version, 1);
  assert.equal(row.createdBy, 'u1');
  assert.equal(row.deletedAt, null);

  assert.throws(() => db.insert('widgets', {}), ValidationError);
  assert.throws(() => db.insert('widgets', { name: 'x', status: 'nope' }), ValidationError);
  assert.throws(() => db.insert('widgets', { name: 'Gummy line' }), ConflictError);
  db.close();
});

test('update enforces optimistic concurrency', () => {
  const { db } = freshDb();
  const row = db.insert('widgets', { name: 'a' });
  const v2 = db.update('widgets', row.id, { qty: 5 }, { expectedVersion: 1, actorId: 'u2' });
  assert.equal(v2.version, 2);
  assert.equal(v2.qty, 5);
  assert.equal(v2.createdBy, 'system', 'createdBy must survive an update');
  assert.throws(() => db.update('widgets', row.id, { qty: 6 }, { expectedVersion: 1 }), ConflictError);
  db.close();
});

test('queries support operators, search, sort and paging', () => {
  const { db } = freshDb();
  db.insert('widgets', { name: 'alpha', qty: 10, status: 'live', tags: ['gummy'] });
  db.insert('widgets', { name: 'bravo', qty: 3, status: 'draft', tags: ['capsule'] });
  db.insert('widgets', { name: 'charlie', qty: 7, status: 'live', tags: ['gummy', 'bulk'] });

  assert.deepEqual(db.find('widgets', { status: 'live' }, { sort: 'name' }).map((r) => r.name), ['alpha', 'charlie']);
  assert.deepEqual(db.find('widgets', { qty: { $gte: 7 } }, { sort: '-qty' }).map((r) => r.qty), [10, 7]);
  assert.deepEqual(db.find('widgets', { tags: 'bulk' }).map((r) => r.name), ['charlie']);
  assert.deepEqual(
    db.find('widgets', { $or: [{ name: 'alpha' }, { qty: 3 }] }, { sort: 'name' }).map((r) => r.name),
    ['alpha', 'bravo'],
  );
  assert.deepEqual(
    db.find('widgets', { $search: { value: 'RAV', fields: ['name'] } }).map((r) => r.name),
    ['bravo'],
  );
  const page = db.query('widgets', { sort: 'name', limit: 2, offset: 1 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.rows.map((r) => r.name), ['bravo', 'charlie']);
  db.close();
});

test('soft delete hides records but keeps them recoverable', () => {
  const { db } = freshDb();
  const row = db.insert('widgets', { name: 'a' });
  db.remove('widgets', row.id, { actorId: 'u1' });
  assert.equal(db.get('widgets', row.id), null);
  assert.ok(db.get('widgets', row.id, { includeDeleted: true }).deletedAt);
  db.restore('widgets', row.id);
  assert.ok(db.get('widgets', row.id));
  db.close();
});

test('a failed transaction rolls every write back', () => {
  const { db } = freshDb();
  const existing = db.insert('widgets', { name: 'keep', qty: 1 });
  assert.throws(() =>
    db.transaction((tx) => {
      tx.insert('widgets', { name: 'temp' });
      tx.update('widgets', existing.id, { qty: 99 });
      throw new Error('boom');
    }),
  );
  assert.equal(db.count('widgets'), 1, 'the inserted row must be gone');
  assert.equal(db.get('widgets', existing.id).qty, 1, 'the update must be reverted');
  db.close();
});

test('state survives a crash: WAL replays on top of the snapshot', () => {
  const { dir, db } = freshDb();
  db.insert('widgets', { name: 'persisted', qty: 4 });
  db.checkpoint();                                   // snapshot written
  db.insert('widgets', { name: 'after-snapshot', qty: 8 }); // only in the WAL
  for (const handle of db.walHandles.values()) fs.fsyncSync(handle);
  // simulate a hard kill: no close(), no final checkpoint
  for (const handle of db.walHandles.values()) fs.closeSync(handle);
  db.walHandles.clear();
  if (db.checkpointTimer) clearTimeout(db.checkpointTimer);
  if (db.backupTimer) clearInterval(db.backupTimer);

  const reopened = new Database({ dir, schema: SCHEMA }).open();
  assert.equal(reopened.count('widgets'), 2);
  assert.equal(reopened.findOne('widgets', { name: 'after-snapshot' }).qty, 8);
  reopened.close();
});

test('a torn final WAL line is discarded, earlier entries survive', () => {
  const { dir, db } = freshDb();
  db.insert('widgets', { name: 'good' });
  const wal = path.join(dir, 'db', 'wal', 'widgets.log');
  for (const handle of db.walHandles.values()) fs.closeSync(handle);
  db.walHandles.clear();
  if (db.checkpointTimer) clearTimeout(db.checkpointTimer);
  if (db.backupTimer) clearInterval(db.backupTimer);
  fs.appendFileSync(wal, '{"op":"put","r":{"id":"TRUNCA');

  const reopened = new Database({ dir, schema: SCHEMA }).open();
  assert.equal(reopened.count('widgets'), 1);
  assert.equal(reopened.findOne('widgets', {}).name, 'good');
  reopened.close();
});

test('audit trail records who changed what', () => {
  const { db } = freshDb();
  const row = db.insert('widgets', { name: 'a' }, { actorId: 'u1', actorName: 'Jamie' });
  db.update('widgets', row.id, { qty: 12 }, { actorId: 'u2', actorName: 'Riley', reason: 'cycle count' });
  const entries = db.readAudit({ collection: 'widgets' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].op, 'update');
  assert.equal(entries[0].actorName, 'Riley');
  assert.equal(entries[0].reason, 'cycle count');
  assert.deepEqual(entries[0].changes, [{ field: 'qty', from: 0, to: 12 }]);
  db.close();
});

test('sequences produce stable human-readable codes and survive a restart', () => {
  const { dir, db } = freshDb();
  const year = new Date().getFullYear();
  assert.equal(db.nextSequence('WO', 'WO-{yyyy}-{n:4}'), `WO-${year}-0001`);
  assert.equal(db.nextSequence('WO', 'WO-{yyyy}-{n:4}'), `WO-${year}-0002`);
  db.close();
  const reopened = new Database({ dir, schema: SCHEMA }).open();
  assert.equal(reopened.nextSequence('WO', 'WO-{yyyy}-{n:4}'), `WO-${year}-0003`);
  reopened.close();
});

test('change events fire for every mutation', () => {
  const { db } = freshDb();
  const seen = [];
  db.on('change', (e) => seen.push(`${e.op}:${e.collection}`));
  const row = db.insert('widgets', { name: 'a' });
  db.update('widgets', row.id, { qty: 1 });
  db.remove('widgets', row.id);
  assert.deepEqual(seen, ['insert:widgets', 'update:widgets', 'update:widgets']);
  db.close();
});
