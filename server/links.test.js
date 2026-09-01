/**
 * Every place the app sends someone — a card click, a row click, a search
 * result, an activity entry — must land on a route that exists. This scans the
 * client and the server-side link builders and fails on any target that no
 * <Route> in App.tsx can serve, so a rename or a typo cannot quietly turn a
 * click into a dead end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('every link target in the app matches a defined route', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*' && r !== '/*');
  assert.ok(routes.length > 20, 'App.tsx should define the page routes');
  const matchers = routes.map((r) => new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$'));

  const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'server/routes'))]
    .filter((f) => /\.(tsx?|js)$/.test(f) && !f.endsWith('.test.js'));
  const targets = new Map(); // target -> files
  const re = /(?:navigate\(|to=|to=\{|link:\s*|link=\{|href=)\s*[`"']([^`"']+)[`"']/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src))) {
      const raw = m[1];
      if (!raw.startsWith('/') || raw.startsWith('/api') || raw.startsWith('/files')) continue;
      const t = raw.replace(/\$\{[^}]+\}/g, 'X').split('?')[0];
      if (!targets.has(t)) targets.set(t, new Set());
      targets.get(t).add(path.relative(root, f));
    }
  }
  assert.ok(targets.size > 15, 'the scan should find the app\'s link targets');

  const dead = [...targets.entries()].filter(([t]) => !matchers.some((rx) => rx.test(t)));
  assert.deepEqual(
    dead.map(([t, fs_]) => `${t}  <- ${[...fs_].join(', ')}`),
    [],
    'these link targets do not match any route',
  );
});
