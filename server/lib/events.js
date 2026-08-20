/**
 * Activity feed and in-app notifications.
 *
 * The audit trail records every field change for compliance; this is the
 * human-readable stream — the handful of moments a colleague actually wants to
 * see on the dashboard, written deliberately rather than derived from diffs.
 */

const MAX_ACTIVITY = 2000;

export function logActivity(db, req, { type, title, detail = '', tone = 'neutral', refType = '', refId = '', link = '' }) {
  const ctx = {
    actorId: req?.user?.id ?? 'system',
    actorName: req?.user?.name ?? 'system',
  };
  const row = db.insert('activity', {
    type, title, detail, tone, refType, refId, link,
    actorId: ctx.actorId,
    actorName: ctx.actorName,
  }, ctx);

  // keep the feed bounded — it is a stream, not an archive
  const collection = db.collection('activity');
  if (collection.records.size > MAX_ACTIVITY) {
    const oldest = db.query('activity', { sort: 'createdAt', limit: collection.records.size - MAX_ACTIVITY }).rows;
    for (const entry of oldest) db.purge('activity', entry.id);
  }
  return row;
}

export function notify(db, userId, { title, body = '', link = '', severity = 'info' }) {
  if (!userId) return null;
  return db.insert('notifications', { userId, title, body, link, severity, read: false }, { actorId: 'system', actorName: 'system' });
}

export function notifyRole(db, role, payload) {
  const out = [];
  for (const user of db.find('users', { role, active: true })) out.push(notify(db, user.id, payload));
  return out;
}
