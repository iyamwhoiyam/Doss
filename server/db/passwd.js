/**
 * Reset one account's password from the command line — for when nobody can
 * sign in to do it from the Admin console. Runs against the data directory
 * directly, so the server must be stopped first (only one process may hold
 * the database).
 *
 *   node server/db/passwd.js --email jbradfield@enovascience.com --temporary
 *   node server/db/passwd.js --email jbradfield@enovascience.com --password 'A longer passphrase'
 *
 * `--temporary` mints a one-time password, prints it, and makes the app ask
 * for a new one at the next sign-in. Either form also reactivates the account.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from './engine.js';
import { schema } from './schema.js';
import { hashPassword } from '../lib/auth.js';

const MIN_LENGTH = 10;

/** A readable one-time password: four short unambiguous chunks. */
export function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chunk = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  return `${chunk()}-${chunk()}-${chunk()}`;
}

/**
 * Set a password on the account with this email. Returns the updated user and,
 * when one was minted, the temporary password to hand over.
 */
export function setPassword(db, { email, password, temporary = false, ctx = { actor: 'cli' } }) {
  const needle = String(email ?? '').trim().toLowerCase();
  if (!needle) throw new Error('An email address is required');
  const user = db.all('users', { includeDeleted: true }).find((u) => (u.email ?? '').toLowerCase() === needle);
  if (!user) throw new Error(`No account with the email ${email}`);

  const minted = temporary || !password ? temporaryPassword() : null;
  const next = minted ?? String(password);
  if (!minted && next.length < MIN_LENGTH) throw new Error(`Passwords need at least ${MIN_LENGTH} characters`);

  const updated = db.update('users', user.id, {
    ...hashPassword(next),
    mustChangePassword: Boolean(minted),
    active: true,
    deletedAt: null,
  }, ctx);
  return { user: updated, temporary: minted };
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const email = opt('--email');
  const password = opt('--password');
  const temporary = args.includes('--temporary') || !password;
  const dir = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');

  if (!email) {
    console.error('Usage: node server/db/passwd.js --email <address> [--password "<new password>" | --temporary]');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(dir, 'db'))) {
    console.error(`No database found at ${dir}`);
    process.exit(1);
  }
  const db = new Database({ dir, schema }).open();
  try {
    const result = setPassword(db, { email, password, temporary });
    db.checkpoint();
    console.log(`[passwd] password set for ${result.user.name} <${result.user.email}>`);
    if (result.temporary) {
      console.log('');
      console.log(`  Temporary password:  ${result.temporary}`);
      console.log('');
      console.log('  Sign in with it once; the app will ask you to choose your own.');
    }
  } catch (err) {
    console.error(`[passwd] ${err.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
