/**
 * Sign in, sign out, session identity and password management.
 */

import { Router } from 'express';

import { redact } from '../db/schema.js';
import { PERMISSIONS, ROLES, can } from '../../shared/domain.js';
import {
  createSession, destroySession, hashPassword, verifyPassword,
  SESSION_COOKIE, sessionCookieOptions, requireUser, requirePermission,
  actorContext, HttpError,
} from '../lib/auth.js';
import { route, requireFields } from '../lib/http.js';

/** Capabilities the signed-in user holds, so the UI can hide what it cannot do. */
function permissionsFor(role) {
  return Object.fromEntries(Object.keys(PERMISSIONS).map((p) => [p, can(role, p)]));
}

export function authRouter(db) {
  const router = Router();

  router.post('/login', route((req, res) => {
    requireFields(req.body ?? {}, ['email', 'password']);
    const email = String(req.body.email).trim().toLowerCase();
    const user = db.findOne('users', { email });

    // Same message and roughly the same work either way, so the response does
    // not reveal which addresses exist.
    if (!user || !verifyPassword(req.body.password, user)) {
      throw new HttpError(401, 'That email and password do not match an active account');
    }
    if (!user.active) throw new HttpError(403, 'This account has been deactivated. Contact an administrator.');

    const token = createSession(db, user, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions);
    res.json({
      user: redact('users', db.get('users', user.id)),
      permissions: permissionsFor(user.role),
      token,
    });
  }));

  router.post('/logout', route((req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  router.get('/me', route((req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    res.json({
      user: req.user,
      permissions: permissionsFor(req.user.role),
      roles: ROLES,
      session: req.session ? { id: req.session.id, expiresAt: req.session.expiresAt } : null,
    });
  }));

  router.patch('/me', requireUser, route((req, res) => {
    const allowed = ['name', 'initials', 'phone', 'title', 'accentColor', 'preferences'];
    const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)));
    res.json(redact('users', db.update('users', req.user.id, patch, actorContext(req))));
  }));

  router.post('/password', requireUser, route((req, res) => {
    requireFields(req.body ?? {}, ['currentPassword', 'newPassword']);
    const { currentPassword, newPassword } = req.body;
    const user = db.get('users', req.user.id);
    if (!verifyPassword(currentPassword, user)) throw new HttpError(401, 'Your current password is not correct');
    if (String(newPassword).length < 10) throw new HttpError(422, 'Choose a password of at least 10 characters');

    db.update('users', user.id, { ...hashPassword(newPassword), mustChangePassword: false }, actorContext(req));

    // every other session for this user is invalidated
    for (const session of db.find('sessions', { userId: user.id })) {
      if (session.token !== req.cookies?.[SESSION_COOKIE]) db.purge('sessions', session.id);
    }
    res.json({ ok: true });
  }));

  /** Administrator resets someone else's password and forces a change at next sign-in. */
  router.post('/users/:id/reset-password', requireUser, requirePermission('users.manage'), route((req, res) => {
    const target = db.getOrFail('users', req.params.id);
    const temporary = req.body?.password || `enova-${Math.random().toString(36).slice(2, 10)}`;
    db.update('users', target.id, { ...hashPassword(temporary), mustChangePassword: true }, actorContext(req));
    for (const session of db.find('sessions', { userId: target.id })) db.purge('sessions', session.id);
    res.json({ ok: true, temporaryPassword: temporary });
  }));

  /** Live sessions, so an administrator can see and revoke who is signed in. */
  router.get('/sessions', requireUser, requirePermission('users.manage'), route((_req, res) => {
    const rows = db.all('sessions', { sort: '-lastSeenAt' }).map((s) => {
      const user = db.get('users', s.userId);
      return {
        id: s.id,
        userId: s.userId,
        userName: user?.name ?? 'Unknown',
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
      };
    });
    res.json({ rows, total: rows.length });
  }));

  router.delete('/sessions/:id', requireUser, requirePermission('users.manage'), route((req, res) => {
    db.purge('sessions', req.params.id, actorContext(req));
    res.json({ ok: true });
  }));

  return router;
}
