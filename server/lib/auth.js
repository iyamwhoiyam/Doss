/**
 * Authentication: scrypt password hashing and database-backed cookie sessions.
 *
 * Sessions live in the `sessions` collection like any other record, so a signed-in
 * user survives a server restart and an administrator can see and revoke every
 * live session from the admin console.
 */

import crypto from 'node:crypto';

import { can } from '../../shared/domain.js';
import { redact } from '../db/schema.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_COOKIE = 'enova_session';
const SESSION_DAYS = 14;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { passwordHash: hash, passwordSalt: salt };
}

export function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const candidate = crypto.scryptSync(password, user.passwordSalt, SCRYPT.keylen, SCRYPT);
  const stored = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function createSession(db, user, { ip, userAgent } = {}) {
  const token = newSessionToken();
  db.insert('sessions', {
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    ip: ip ?? '',
    userAgent: (userAgent ?? '').slice(0, 250),
  }, { actorId: user.id, actorName: user.name });
  db.update('users', user.id, { lastLoginAt: new Date().toISOString() }, { actorId: user.id, actorName: user.name });
  return token;
}

export function destroySession(db, token) {
  const session = db.findOne('sessions', { token });
  if (session) db.purge('sessions', session.id);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_DAYS * 86400000,
  secure: process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_COOKIE !== '1',
};

export { SESSION_COOKIE };

/**
 * Express middleware that resolves `req.user` from the session cookie (or an
 * `Authorization: Bearer <token>` header, which the SSE stream and scripts use).
 */
export function attachUser(db) {
  return (req, _res, next) => {
    const bearer = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
    const token = req.cookies?.[SESSION_COOKIE] ?? bearer;
    req.session = null;
    req.user = null;
    if (!token) return next();

    const session = db.findOne('sessions', { token });
    if (!session) return next();
    if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
      db.purge('sessions', session.id);
      return next();
    }
    const user = db.get('users', session.userId);
    if (!user || !user.active) return next();

    // keep `lastSeenAt` fresh without writing on every single request
    if (!session.lastSeenAt || Date.now() - Date.parse(session.lastSeenAt) > 60_000) {
      db.update('sessions', session.id, { lastSeenAt: new Date().toISOString() }, { actorId: user.id });
    }
    req.session = session;
    req.user = redact('users', user);
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue'));
  next();
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Sign in to continue'));
    if (!can(req.user.role, permission)) {
      return next(new HttpError(403, `Your role (${req.user.role}) does not have permission to ${permission.replace('.', ' ')}`));
    }
    next();
  };
}

/** The write context every db mutation carries, so the audit trail names a person. */
export function actorContext(req, extra = {}) {
  return {
    actorId: req.user?.id ?? 'system',
    actorName: req.user?.name ?? 'system',
    reason: req.get('x-change-reason') ?? null,
    ...extra,
  };
}
