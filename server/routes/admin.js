/**
 * Administration: database health, backups, the audit trail, user management
 * and the settings that drive the rest of the platform.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Router } from 'express';

import { schemaSummary } from './crud.js';
import { redact } from '../db/schema.js';
import { ROLES } from '../../shared/domain.js';
import { hashPassword, actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, num, requireFields } from '../lib/http.js';
import { logActivity } from '../lib/events.js';

const bytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

function directorySize(dir) {
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let total = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else { files++; total += fs.statSync(full).size; }
    }
  };
  walk(dir);
  return { files, bytes: total };
}

export function adminRouter(db, hub) {
  const router = Router();

  router.use(requirePermission('settings.manage'));

  /** Database health: what is stored, where, and how big it is on disk. */
  router.get('/health', route((_req, res) => {
    const stats = db.stats();
    const files = directorySize(db.filesDir);
    const audit = directorySize(db.auditDir);
    const backups = directorySize(db.backupDir);
    res.json({
      database: {
        ...stats,
        bytesHuman: bytes(stats.bytes),
        engine: 'enova-fsdb/1.0 (JSON snapshots + write-ahead log)',
        durability: 'Every write is appended to a WAL before it is acknowledged; snapshots are written atomically and the WAL is replayed on boot.',
      },
      files: { ...files, bytesHuman: bytes(files.bytes), path: db.filesDir },
      audit: { ...audit, bytesHuman: bytes(audit.bytes), path: db.auditDir },
      backups: { ...backups, bytesHuman: bytes(backups.bytes), path: db.backupDir, sets: stats.backups },
      realtime: { connections: hub.clients.size, online: hub.presence().length },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        pid: process.pid,
      },
    });
  }));

  router.post('/checkpoint', route((_req, res) => {
    db.checkpoint();
    res.json({ ok: true, stats: db.stats() });
  }));

  router.post('/backup', route((_req, res) => {
    res.json(db.backup());
  }));

  router.get('/backups', route((_req, res) => {
    if (!fs.existsSync(db.backupDir)) return res.json({ rows: [] });
    const rows = fs.readdirSync(db.backupDir)
      .filter((d) => /^\d{4}-/.test(d))
      .sort()
      .reverse()
      .map((stamp) => {
        const size = directorySize(path.join(db.backupDir, stamp));
        return { stamp, takenAt: stamp.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z'), ...size, bytesHuman: bytes(size.bytes) };
      });
    res.json({ rows, total: rows.length });
  }));

  /** Export a collection as JSON — the file-system database is meant to be portable. */
  router.get('/export/:collection', route((req, res) => {
    if (!db.has(req.params.collection)) throw new HttpError(404, `Unknown collection "${req.params.collection}"`);
    const rows = db.all(req.params.collection, { includeDeleted: req.query.includeDeleted === 'true' })
      .map((row) => redact(req.params.collection, row));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="enova-${req.params.collection}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ collection: req.params.collection, exportedAt: new Date().toISOString(), count: rows.length, records: rows });
  }));

  router.get('/audit', route((req, res) => {
    res.json({
      entries: db.readAudit({
        days: num(req.query.days, 14),
        limit: num(req.query.limit, 300),
        collection: req.query.collection ? String(req.query.collection) : undefined,
        actorId: req.query.actorId ? String(req.query.actorId) : undefined,
        recordId: req.query.recordId ? String(req.query.recordId) : undefined,
      }),
    });
  }));

  router.get('/schema', route((_req, res) => {
    res.json({ collections: schemaSummary(), roles: ROLES });
  }));

  /** Create a user with a temporary password they must change at first sign-in. */
  router.post('/users', requirePermission('users.manage'), route((req, res) => {
    requireFields(req.body ?? {}, ['name', 'email', 'role']);
    const temporary = req.body.password || `enova-${Math.random().toString(36).slice(2, 10)}`;
    const name = String(req.body.name).trim();
    const user = db.insert('users', {
      name,
      email: String(req.body.email).trim().toLowerCase(),
      role: req.body.role,
      title: req.body.title ?? '',
      department: req.body.department ?? '',
      phone: req.body.phone ?? '',
      initials: req.body.initials || name.replace(/^Dr\.\s+/, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      accentColor: req.body.accentColor || '#2FBF9B',
      active: true,
      mustChangePassword: true,
      ...hashPassword(temporary),
      preferences: { theme: 'dark', density: 'comfortable' },
    }, actorContext(req));
    res.status(201).json({ user: redact('users', user), temporaryPassword: temporary });
  }));

  router.post('/users/:id/deactivate', requirePermission('users.manage'), route((req, res) => {
    const user = db.getOrFail('users', req.params.id);
    if (user.id === req.user.id) throw new HttpError(409, 'You cannot deactivate your own account');
    const admins = db.find('users', { role: 'admin', active: true });
    if (user.role === 'admin' && admins.length <= 1) throw new HttpError(409, 'This is the last active administrator — promote someone else first');
    const ctx = actorContext(req);
    for (const session of db.find('sessions', { userId: user.id })) db.purge('sessions', session.id);
    res.json(redact('users', db.update('users', user.id, { active: false }, ctx)));
  }));

  router.post('/users/:id/activate', requirePermission('users.manage'), route((req, res) => {
    res.json(redact('users', db.update('users', req.params.id, { active: true }, actorContext(req))));
  }));

  /** Settings are stored as records so they are versioned and audited like data. */
  router.put('/settings/:key', route((req, res) => {
    const existing = db.findOne('settings', { key: req.params.key });
    const ctx = actorContext(req);
    if (existing) return res.json(db.update('settings', existing.id, { value: req.body?.value }, ctx));
    res.status(201).json(db.insert('settings', {
      key: req.params.key,
      value: req.body?.value,
      label: req.body?.label ?? req.params.key,
      category: req.body?.category ?? 'general',
      description: req.body?.description ?? '',
    }, ctx));
  }));

  /**
   * Clear the demo/seed data for a clean production start. Wipes every business
   * collection but keeps the settings and the account performing the reset, so
   * nobody locks themselves out. Destructive and irreversible — guarded by a
   * typed confirmation and written to the audit trail.
   */
  router.post('/reset', requirePermission('data.manage'), route((req, res) => {
    if (req.body?.confirm !== 'ERASE') {
      throw new HttpError(400, 'To clear the demo data, send confirm: "ERASE".');
    }
    const WIPE = [
      'customers', 'vendors', 'items', 'locations', 'lots', 'inventoryTxns', 'cycleCounts',
      'projects', 'formulas', 'quotes', 'workOrders', 'labelReviews', 'samples', 'rfqs', 'purchaseOrders',
      'salesOrders', 'shipments', 'documents', 'tasks', 'comments', 'activity',
      'notifications', 'savedViews',
    ];
    const ctx = actorContext(req);
    const removed = {};
    for (const collection of WIPE) {
      if (!db.has(collection)) continue;
      const rows = db.all(collection, { includeDeleted: true });
      for (const row of rows) db.purge(collection, row.id, ctx);
      if (rows.length) removed[collection] = rows.length;
    }
    // Remove every other user (and their sessions) but keep the one resetting.
    let usersRemoved = 0;
    for (const user of db.all('users', { includeDeleted: true })) {
      if (user.id === req.user.id) continue;
      for (const session of db.find('sessions', { userId: user.id })) db.purge('sessions', session.id);
      db.purge('users', user.id, ctx);
      usersRemoved += 1;
    }
    if (usersRemoved) removed.users = usersRemoved;

    logActivity(db, req, {
      type: 'admin',
      title: 'Demo data cleared',
      detail: `${Object.values(removed).reduce((a, b) => a + b, 0)} records removed — clean production start`,
      tone: 'warning',
    });
    res.json({ ok: true, removed });
  }));

  /** Permanently remove an archived record. Deliberately narrow and audited. */
  router.delete('/purge/:collection/:id', requirePermission('data.manage'), route((req, res) => {
    const record = db.get(req.params.collection, req.params.id, { includeDeleted: true });
    if (!record) throw new HttpError(404, 'Record not found');
    if (!record.deletedAt) throw new HttpError(409, 'Archive the record first — purge only removes records that are already archived');
    res.json(db.purge(req.params.collection, req.params.id, actorContext(req)));
  }));

  return router;
}
