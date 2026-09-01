/**
 * Clear the demo data for a clean production start.
 *
 * One implementation, two doors: the Admin "clear demo data" button calls
 * clearDemoData() on the running server, and the CLI below runs it directly
 * against the data directory when the server is stopped — no login needed:
 *
 *   node server/db/reset.js --keep jbradfield@enovascience.com --name "Joe Bradfield" --yes
 *
 * Every business collection is emptied and every user except the one kept is
 * removed. Settings survive, and so does the kept account, which is why the
 * database will not re-seed itself on the next boot.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from './engine.js';
import { schema } from './schema.js';

export const WIPE_COLLECTIONS = [
  'customers', 'vendors', 'items', 'locations', 'lots', 'inventoryTxns', 'cycleCounts',
  'projects', 'formulas', 'quotes', 'workOrders', 'labelReviews', 'samples', 'rfqs', 'purchaseOrders',
  'salesOrders', 'shipments', 'documents', 'tasks', 'comments', 'activity',
  'notifications', 'savedViews',
];

/**
 * Wipe everything except settings and one account.
 * Identify the account to keep by id or by email; optionally rename it.
 */
export function clearDemoData(db, { keepUserId, keepEmail, rename, ctx } = {}) {
  const actor = ctx ?? { actorId: 'system', actorName: 'system' };
  const keep = keepUserId
    ? db.get('users', keepUserId, { includeDeleted: true })
    : keepEmail ? db.findOne('users', { email: String(keepEmail).toLowerCase() }) : null;
  if (!keep) throw new Error(`No user to keep found (${keepUserId ?? keepEmail ?? 'none given'})`);

  const removed = {};
  for (const collection of WIPE_COLLECTIONS) {
    if (!db.has(collection)) continue;
    const rows = db.all(collection, { includeDeleted: true });
    for (const row of rows) db.purge(collection, row.id, actor);
    if (rows.length) removed[collection] = rows.length;
  }

  let usersRemoved = 0;
  for (const user of db.all('users', { includeDeleted: true })) {
    if (user.id === keep.id) continue;
    for (const session of db.find('sessions', { userId: user.id })) db.purge('sessions', session.id);
    db.purge('users', user.id, actor);
    usersRemoved += 1;
  }
  if (usersRemoved) removed.users = usersRemoved;

  let kept = keep;
  if (rename && rename.trim() && rename.trim() !== keep.name) {
    const name = rename.trim();
    const initials = name.replace(/^Dr\.\s+/, '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    kept = db.update('users', keep.id, { name, initials }, actor);
  }

  return { removed, total: Object.values(removed).reduce((a, b) => a + b, 0), kept: { id: kept.id, name: kept.name, email: kept.email } };
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const keepEmail = opt('--keep');
  const rename = opt('--name');
  const yes = args.includes('--yes');
  const dir = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');

  if (!keepEmail) {
    console.error('Usage: node server/db/reset.js --keep <email-to-keep> [--name "Full Name"] --yes');
    process.exit(1);
  }
  if (!yes) {
    console.error('This permanently removes every record except settings and the kept account. Re-run with --yes to confirm.');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(dir, 'db'))) {
    console.error(`No database found at ${dir}`);
    process.exit(1);
  }
  // Only one process may hold the database: run this with the server stopped.
  const db = new Database({ dir, schema }).open();
  try {
    const result = clearDemoData(db, { keepEmail, rename });
    db.checkpoint();
    console.log(`[reset] removed ${result.total} records; kept ${result.kept.name} <${result.kept.email}>`);
  } catch (err) {
    console.error(`[reset] ${err.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
