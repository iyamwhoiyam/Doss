/**
 * End-to-end API tests: boot a real server against a throwaway data directory,
 * sign in as a real seeded user, and drive the flows Enova depends on.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from './index.js';

let base;
let server;
let db;
let hub;
let dataDir;
const cookies = new Map();

function jar() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function api(method, url, body, { raw = false } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookies.size ? { Cookie: jar() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (value === '') cookies.delete(name); else cookies.set(name, value);
  }
  const payload = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (raw) return { status: res.status, body: payload };
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${payload?.error ?? payload}`);
  return payload;
}

const get = (url) => api('GET', url);
const post = (url, body) => api('POST', url, body);
const patch = (url, body) => api('PATCH', url, body);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enova-api-'));
  const created = createServer({ dataDir });
  db = created.db;
  hub = created.hub;
  server = created.app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  hub?.close();
  await new Promise((resolve) => server.close(resolve));
  db?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('health and metadata are public', async () => {
  const health = await get('/api/health');
  assert.equal(health.ok, true);
  assert.ok(health.records > 500, 'the seed should have populated the database');
  const meta = await get('/api/meta');
  assert.ok(meta.workOrderStages.length >= 7);
  assert.ok(meta.formulaFormats.some((f) => f.value === 'gummy'));
});

test('the API refuses anonymous access to data', async () => {
  const { status, body } = await api('GET', '/api/data/customers', undefined, { raw: true });
  assert.equal(status, 401);
  assert.match(body.error, /Sign in/);
});

test('a wrong password is rejected without revealing whether the account exists', async () => {
  const wrongPassword = await api('POST', '/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'nope' }, { raw: true });
  const noSuchUser = await api('POST', '/api/auth/login', { email: 'nobody@enovascience.com', password: 'nope' }, { raw: true });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(wrongPassword.body.error, noSuchUser.body.error);
});

test('sign in establishes a session and reports capabilities', async () => {
  const login = await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });
  assert.equal(login.user.email, 'jbradfield@enovascience.com');
  assert.equal(login.user.role, 'admin');
  assert.equal(login.user.passwordHash, undefined, 'the password hash must never leave the server');
  assert.equal(login.permissions['production.release'], true);

  const me = await get('/api/auth/me');
  assert.equal(me.user.id, login.user.id);
});

test('the dashboard assembles KPIs, alerts and my work', async () => {
  const dash = await get('/api/dashboard');
  assert.ok(dash.kpis.length >= 8);
  assert.ok(dash.kpis.every((k) => k.value !== undefined));
  assert.equal(dash.production.length, 7);
  assert.equal(dash.throughput.length, 12);
  assert.ok(Array.isArray(dash.alerts));
  assert.ok(Array.isArray(dash.myWork.tasks));
});

test('global search spans every module', async () => {
  const results = await get('/api/search?q=gummy');
  assert.ok(results.total > 0);
  const collections = results.groups.map((g) => g.collection);
  assert.ok(collections.includes('formulas'), `expected formulas in ${collections.join(', ')}`);
  assert.ok(results.groups.every((g) => g.results.every((r) => r.link.startsWith('/'))));
});

test('generic CRUD creates, patches and archives with optimistic concurrency', async () => {
  const created = await post('/api/data/customers', { code: 'C-TEST-1', name: 'Test Customer Co.', status: 'prospect' });
  assert.equal(created.version, 1);
  assert.equal(created.createdBy, (await get('/api/auth/me')).user.id);

  const updated = await patch(`/api/data/customers/${created.id}`, { status: 'active', expectedVersion: 1 });
  assert.equal(updated.status, 'active');
  assert.equal(updated.version, 2);

  const stale = await api('PATCH', `/api/data/customers/${created.id}`, { status: 'on_hold', expectedVersion: 1 }, { raw: true });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /changed by someone else/);

  const duplicate = await api('POST', '/api/data/customers', { code: 'C-TEST-1', name: 'Another' }, { raw: true });
  assert.equal(duplicate.status, 409);

  const invalid = await api('POST', '/api/data/customers', { name: 'No code', status: 'not-a-status' }, { raw: true });
  assert.equal(invalid.status, 422);

  await api('DELETE', `/api/data/customers/${created.id}`);
  const gone = await api('GET', `/api/data/customers/${created.id}`, undefined, { raw: true });
  assert.equal(gone.status, 404);
  await post(`/api/data/customers/${created.id}/restore`);
  assert.equal((await get(`/api/data/customers/${created.id}`)).status, 'active');
});

test('every write lands in the audit trail with the actor', async () => {
  const customer = await post('/api/data/customers', { code: 'C-TEST-2', name: 'Audited Co.' });
  await patch(`/api/data/customers/${customer.id}`, { tier: 'key' });
  const history = await get(`/api/data/customers/${customer.id}/history`);
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0].op, 'update');
  assert.equal(history.entries[0].actorName, 'Joe Bradfield');
  assert.deepEqual(history.entries[0].changes, [{ field: 'tier', from: 'standard', to: 'key' }]);
});

test('the production board groups work orders and flags WIP breaches', async () => {
  const board = await get('/api/production/board');
  assert.equal(board.columns.length, 7);
  assert.ok(board.total > 0);
  for (const column of board.columns) {
    assert.equal(column.count, column.cards.length);
    assert.ok(column.cards.every((c) => c.stage === column.value));
  }
});

test('a work order cannot start before its materials are staged', async () => {
  const board = await get('/api/production/board');
  const planned = board.columns.find((c) => c.value === 'planned').cards[0];
  const blocked = await api('POST', `/api/production/${planned.id}/move`, { stage: 'in_process' }, { raw: true });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /not been issued/);
});

test('a QC hold needs a reason, and failing a check pulls the batch onto hold', async () => {
  const board = await get('/api/production/board');
  const running = board.columns.find((c) => c.value === 'in_process').cards[0];

  const noReason = await api('POST', `/api/production/${running.id}/move`, { stage: 'qc_hold' }, { raw: true });
  assert.equal(noReason.status, 422);
  assert.match(noReason.body.error, /needs a reason/);

  const held = await post(`/api/production/${running.id}/move`, { stage: 'qc_hold', holdReason: 'Weight variation out of spec' });
  assert.equal(held.stage, 'qc_hold');
  assert.equal(held.holdReason, 'Weight variation out of spec');

  const back = await post(`/api/production/${running.id}/move`, { stage: 'in_process' });
  assert.equal(back.holdReason, '', 'leaving QC hold clears the reason');

  const failed = await post(`/api/production/${running.id}/qc/1`, { status: 'fail', result: '9.2%' });
  assert.equal(failed.stage, 'qc_hold');
  assert.match(failed.holdReason, /Average weight failed/);
});

test('a batch cannot be released with unfinished steps or open deviations', async () => {
  const board = await get('/api/production/board');
  const inReview = board.columns.find((c) => c.value === 'qa_review').cards[0];
  const blocked = await api('POST', `/api/production/${inReview.id}/move`, { stage: 'complete' }, { raw: true });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /not signed off|open deviation/);
});

test('issuing material draws down the lot and writes the ledger entry in one transaction', async () => {
  const created = await post('/api/production/from-formula', {
    formulaId: db.findOne('formulas', { code: 'F-4002' }).id,
    plannedQty: 1000,
  });
  assert.match(created.woNumber, /^WO-\d{4}-\d{4}$/);
  assert.ok(created.materials.length > 0);

  const availability = await get(`/api/production/${created.id}/availability`);
  const line = availability.rows.findIndex((r) => r.lots.length && r.lots[0].qtyOnHand > r.required && r.required > 0);
  assert.ok(line >= 0, 'the seed should leave at least one fully covered material line');

  const material = availability.rows[line];
  const lot = material.lots[0];
  const before = db.get('lots', lot.id).qtyOnHand;
  const issueQty = Number((material.required).toFixed(3));

  const updated = await post(`/api/production/${created.id}/issue`, { index: line, lotId: lot.id, qty: issueQty });
  assert.equal(updated.materials[line].issuedQty, issueQty);
  assert.equal(db.get('lots', lot.id).qtyOnHand, Number((before - issueQty).toFixed(4)));

  const txn = db.find('inventoryTxns', { lotId: lot.id, type: 'issue' }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  assert.equal(txn.qty, -issueQty);
  assert.equal(txn.refId, created.id);
});

test('issuing more than a lot holds is refused and changes nothing', async () => {
  const wo = db.all('workOrders', { sort: '-createdAt' })[0];
  const lot = db.find('lots', { status: 'released' }).find((l) => l.itemId === wo.materials[0].itemId);
  assert.ok(lot, 'expected a released lot for the first material line');
  const before = db.get('lots', lot.id).qtyOnHand;

  const refused = await api('POST', `/api/production/${wo.id}/issue`, { index: 0, lotId: lot.id, qty: before + 100 }, { raw: true });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /on hand/);
  assert.equal(db.get('lots', lot.id).qtyOnHand, before, 'the failed issue must not move stock');
});

test('inventory positions roll lots up per item with alerts', async () => {
  const positions = await get('/api/inventory/positions?limit=500');
  assert.ok(positions.rows.length > 50);
  const withStock = positions.rows.find((r) => r.onHand > 0);
  assert.ok(withStock.value > 0);
  assert.ok(positions.totals.value > 0);

  const alerts = await get('/api/inventory/alerts');
  assert.ok(Array.isArray(alerts.rows));
  assert.ok(alerts.rows.every((a) => a.message && a.severity));
});

test('receiving a COA-required item lands it in quarantine, and release requires the COA', async () => {
  const item = db.findOne('items', { itemCode: 'ALT-RP-1001' });
  const lot = await post('/api/inventory/receive', { itemId: item.id, qty: 25, vendorLot: 'TEST-LOT-1' });
  assert.equal(lot.status, 'quarantine');
  assert.equal(lot.qtyOnHand, 25);

  const refused = await api('POST', `/api/inventory/lots/${lot.id}/disposition`, { status: 'released' }, { raw: true });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /certificate of analysis/);

  const released = await post(`/api/inventory/lots/${lot.id}/disposition`, { status: 'released', coaReceived: true });
  assert.equal(released.status, 'released');
  assert.equal(released.dispositionBy, (await get('/api/auth/me')).user.id);
});

test('lot genealogy traces from a lot forward to customers', async () => {
  const issue = db.all('inventoryTxns').find((t) => t.type === 'issue' && t.refId);
  const trace = await get(`/api/inventory/lots/${issue.lotId}/trace`);
  assert.ok(trace.lot);
  assert.ok(trace.item);
  assert.ok(Array.isArray(trace.workOrders));
  assert.ok(Array.isArray(trace.customers));
});

test('the cost engine prices a saved formula through the API', async () => {
  const formula = db.findOne('formulas', { code: 'F-4001' });
  const cost = await get(`/api/commerce/formulas/${formula.id}/cost?qty=25000`);
  assert.equal(cost.product.format, 'gummy');
  assert.ok(Number(cost.costSummary.rawMaterialsPerUnit) > 0);
  assert.ok(Number(cost.tiers[0].cogsPerUnit) > 0);
  assert.equal(cost.tiers[0].salePricePerUnit, null, 'no margin was supplied, so no price is invented');
  assert.ok(cost.compliance.length > 0);
});

test('a quote is created, re-priced and converted to an order', async () => {
  const formula = db.findOne('formulas', { code: 'F-4002' });
  const quote = await post('/api/commerce/quotes', {
    formulaId: formula.id,
    tiers: [
      { qty: 10000, labor: { encapsulationPer1000: 15, packagingPer1000: 10, qcPctOfProduction: 0.12 }, overheadRate: 0.9, margin: 0.45 },
      { qty: 50000, labor: { encapsulationPer1000: 12, packagingPer1000: 8, qcPctOfProduction: 0.12 }, overheadRate: 0.6, margin: 0.4 },
    ],
  });
  assert.match(quote.quoteNumber, /^Q-\d{4}-\d{4}$/);
  assert.equal(quote.result.tiers.length, 2);
  assert.ok(Number(quote.result.tiers[1].cogsPerUnit) < Number(quote.result.tiers[0].cogsPerUnit));

  const repriced = await post(`/api/commerce/quotes/${quote.id}/recompute`, {
    tiers: quote.tiers.map((t) => ({ ...t, margin: 0.5 })),
  });
  assert.ok(Number(repriced.result.tiers[0].salePricePerUnit) > Number(quote.result.tiers[0].salePricePerUnit));

  await post(`/api/commerce/quotes/${quote.id}/send`);
  await post(`/api/commerce/quotes/${quote.id}/decide`, { decision: 'accepted' });

  const badTier = await api('POST', `/api/commerce/quotes/${quote.id}/to-order`, { qty: 999 }, { raw: true });
  assert.equal(badTier.status, 422);
  assert.match(badTier.body.error, /no 999-unit tier/);

  const order = await post(`/api/commerce/quotes/${quote.id}/to-order`, { qty: 50000, customerPo: 'PO-99887' });
  assert.equal(order.status, 'confirmed');
  assert.equal(order.lines[0].qty, 50000);
  assert.equal(order.lines[0].unitPrice, Number(repriced.result.tiers[1].salePricePerUnit));
});

test('a quote with no margin on a tier cannot be sent', async () => {
  const formula = db.findOne('formulas', { code: 'F-4006' });
  const quote = await post('/api/commerce/quotes', {
    formulaId: formula.id,
    tiers: [{ qty: 25000, labor: { compressionPer1000: 14 }, overheadRate: 0.7, margin: null }],
  });
  const refused = await api('POST', `/api/commerce/quotes/${quote.id}/send`, {}, { raw: true });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /no margin set/);
});

test('the label engine runs through the API and enforces the sign-off rules', async () => {
  const checklist = await get('/api/labels/checklist');
  assert.equal(checklist.rows.length, 41);
  assert.equal(checklist.evidenceBlocked, 20);

  const review = await post('/api/labels', {
    productName: 'API Test Label',
    brand: 'Testco',
    panels: {
      pdp: 'TESTCO\nAPI Test Label\nDietary Supplement\n60 Capsules',
      information: 'Supplement Facts\nServing Size: 2 Capsules\nServings Per Container: 30\n\nVitamin C (as ascorbic acid)   250 mg   417%\n\nOther Ingredients: Microcrystalline cellulose.\n\nManufactured: Testco, Austin, TX',
      leftSide: 'Suggested Use: Take 2 capsules daily.',
    },
  });
  assert.ok(review.metrics.requiredCorrections > 0);
  assert.equal(review.checklist.length, 41);

  // a row that needs artwork cannot be ticked without recorded evidence
  const noEvidence = await api('POST', `/api/labels/${review.id}/checklist/10`, { state: 'pass' }, { raw: true });
  assert.equal(noEvidence.status, 422);
  assert.match(noEvidence.body.error, /without a comment/);
  const withEvidence = await post(`/api/labels/${review.id}/checklist/10`, { state: 'pass', comment: 'Checked the print PDF at 300 dpi — hairlines span the full panel width.' });
  assert.equal(withEvidence.checklist.find((c) => c.id === 10).state, 'pass');

  // approval is blocked while any finding is undecided
  const undecided = await api('POST', `/api/labels/${review.id}/approve`, {}, { raw: true });
  assert.equal(undecided.status, 409);
  assert.match(undecided.body.error, /no decision yet/);

  const denyWithoutReason = await api('POST', `/api/labels/${review.id}/findings/${review.findings[0].id}`, { decision: 'denied' }, { raw: true });
  assert.equal(denyWithoutReason.status, 422);

  for (const finding of review.findings) {
    await post(`/api/labels/${review.id}/findings/${finding.id}`, { decision: 'accepted' });
  }
  const soleReviewer = await api('POST', `/api/labels/${review.id}/approve`, {}, { raw: true });
  assert.equal(soleReviewer.status, 409);
  assert.match(soleReviewer.body.error, /signed by two people/);

  const approved = await post(`/api/labels/${review.id}/approve`, { soleReviewerReason: 'Second reviewer unavailable; documented per SOP-QA-014.' });
  assert.equal(approved.status, 'approved');

  const proof = await get(`/api/labels/${review.id}/corrected-proof`);
  assert.ok(proof.applied.length + proof.manual.length > 0);
  assert.match(proof.note, /proof, not artwork/);
});

test('reorder suggestions drive purchase order drafting', async () => {
  const suggestions = await get('/api/purchasing/reorder-suggestions');
  assert.ok(Array.isArray(suggestions.rows));
  if (!suggestions.rows.length) return;

  const withVendor = suggestions.rows.filter((r) => r.vendorId && r.suggestedQty > 0).slice(0, 3);
  if (!withVendor.length) return;
  const drafted = await post('/api/purchasing/draft-from-suggestions', { itemIds: withVendor.map((r) => r.itemId) });
  assert.ok(drafted.count >= 1);
  for (const po of drafted.created) {
    assert.equal(po.status, 'draft');
    assert.equal(po.total, Number((po.subtotal + po.freight + po.tax).toFixed(2)));
  }
});

test('purchase order approval refuses an unqualified vendor without an override', async () => {
  const vendor = db.findOne('vendors', { status: 'pending' });
  const po = await post('/api/data/purchaseOrders', {
    poNumber: 'PO-TEST-0001',
    vendorId: vendor.id,
    lines: [{ itemId: db.findOne('items', {}).id, description: 'Test', qty: 10, uom: 'kg', unitCost: 5, received: 0 }],
    subtotal: 50, total: 50,
  });
  const refused = await api('POST', `/api/purchasing/${po.id}/approve`, {}, { raw: true });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /is pending qualification —/);

  const approved = await post(`/api/purchasing/${po.id}/approve`, { overrideReason: 'Sole-source ingredient; qualification audit booked for next week.' });
  assert.equal(approved.status, 'approved');
  assert.match(approved.notes, /Sole-source ingredient/);
});

test('receiving against a purchase order rolls the line forward', async () => {
  const po = db.findOne('purchaseOrders', { poNumber: 'PO-TEST-0001' });
  await post(`/api/purchasing/${po.id}/send`);
  const line = po.lines[0];
  const lot = await post('/api/inventory/receive', { itemId: line.itemId, qty: line.qty, purchaseOrderId: po.id });
  const updated = db.get('purchaseOrders', po.id);
  assert.equal(updated.status, 'received');
  assert.equal(updated.lines[0].received, line.qty);
  assert.ok(updated.lines[0].lotIds.includes(lot.id));
});

test('board moves persist column and order, and a gated stage is protected', async () => {
  const project = db.find('projects', { stage: 'intake' })[0];
  const moved = await post('/api/boards/projects/move', { id: project.id, column: 'feasibility', beforeOrder: 100, afterOrder: 200 });
  assert.equal(moved.stage, 'feasibility');
  assert.equal(moved.boardOrder, 150);

  // a gate guards the exit from its own stage, so an open feasibility check
  // blocks the move forward and an override reason carries it through
  const blocked = await api('POST', '/api/boards/projects/move', { id: project.id, column: 'formulation' }, { raw: true });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Feasibility gate check/);
  const overridden = await post('/api/boards/projects/move', { id: project.id, column: 'formulation', overrideReason: 'Cost target signed off verbally by the customer; minutes filed.' });
  assert.equal(overridden.stage, 'formulation');

  const task = db.find('tasks', { status: 'todo' })[0];
  const doneTask = await post('/api/boards/tasks/move', { id: task.id, column: 'done' });
  assert.equal(doneTask.status, 'done');
  assert.ok(doneTask.completedAt);
});

test('the schedule lays work orders out by line and date, and rescheduling moves one', async () => {
  const schedule = await get('/api/production/schedule');
  assert.equal(schedule.days.length, 14, 'the default window is a fortnight');
  assert.equal(new Date(`${schedule.start}T00:00:00Z`).getUTCDay(), 1, 'the window anchors on a Monday');
  assert.ok(Array.isArray(schedule.lines) && schedule.lines.length > 0);
  assert.ok(Array.isArray(schedule.scheduled));
  assert.ok(Array.isArray(schedule.unscheduled));
  // a released batch has left the floor and does not appear on the schedule
  assert.ok(!schedule.scheduled.some((wo) => wo.stage === 'complete'));

  // drop a work order onto a specific line and the first day of the window
  const wo = db.find('workOrders', { stage: { $nin: ['complete', 'cancelled'] } })[0];
  const targetLine = schedule.lines[0];
  const plannedStart = `${schedule.days[1].date}T08:00:00.000Z`;
  const moved = await post(`/api/production/${wo.id}/schedule`, { line: targetLine, plannedStart });
  assert.equal(moved.line, targetLine);
  assert.equal(moved.plannedStart, plannedStart);

  const after = await get('/api/production/schedule');
  assert.ok(after.scheduled.some((row) => row.id === wo.id && row.line === targetLine));

  // an end before the start is refused and nothing changes
  const bad = await api('POST', `/api/production/${wo.id}/schedule`, { plannedEnd: `${schedule.days[0].date}T08:00:00.000Z` }, { raw: true });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /before planned start/);
});

test('a non-admin role is blocked from writes it does not own', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'mbell@enovascience.com', password: 'enova2026' }); // warehouse

  const me = await get('/api/auth/me');
  assert.equal(me.user.role, 'warehouse');
  assert.equal(me.permissions['inventory.write'], true);
  assert.equal(me.permissions['quotes.write'], false);

  const refused = await api('POST', '/api/data/quotes', { quoteNumber: 'Q-NOPE', title: 'Nope' }, { raw: true });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /cannot write quotes/);

  const disposition = await api('POST', `/api/inventory/lots/${db.findOne('lots', {}).id}/disposition`, { status: 'released' }, { raw: true });
  assert.equal(disposition.status, 403, 'only quality may dispose of a lot');

  // but the warehouse can do warehouse work
  const positions = await get('/api/inventory/positions?limit=5');
  assert.ok(positions.rows.length > 0);
});

test('changing a password invalidates other sessions', async () => {
  const changed = await post('/api/auth/password', { currentPassword: 'enova2026', newPassword: 'a-much-longer-passphrase' });
  assert.equal(changed.ok, true);
  const short = await api('POST', '/api/auth/password', { currentPassword: 'a-much-longer-passphrase', newPassword: 'short' }, { raw: true });
  assert.equal(short.status, 422);
  const stillSignedIn = await get('/api/auth/me');
  assert.equal(stillSignedIn.user.email, 'mbell@enovascience.com');
  assert.equal(stillSignedIn.user.mustChangePassword, false);
});

test('live sync pushes database changes to connected clients', async () => {
  await post('/api/auth/logout');
  const login = await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream`, {
    headers: { Authorization: `Bearer ${login.token}` },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const readEvent = async (name, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    let buffer = '';
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (!block.includes(`event: ${name}`)) continue;
        return JSON.parse(block.split('data: ')[1]);
      }
    }
    throw new Error(`timed out waiting for a "${name}" event`);
  };

  const hello = await readEvent('hello');
  assert.equal(hello.you.email ?? hello.you.name, 'Joe Bradfield');

  await post('/api/data/tasks', { title: 'Realtime smoke test', status: 'todo' });
  const change = await readEvent('change');
  assert.equal(change.collection, 'tasks');
  assert.equal(change.op, 'insert');
  assert.equal(change.record.title, 'Realtime smoke test');
  assert.equal(change.actorName, 'Joe Bradfield');

  controller.abort();
});

test('admin health reports the file-system database honestly', async () => {
  const health = await get('/api/admin/health');
  assert.match(health.database.engine, /enova-fsdb/);
  assert.ok(health.database.totalRecords > 500);
  assert.ok(health.database.collections.workOrders.live > 0);
  assert.ok(health.files.path.endsWith('files'));

  const backup = await post('/api/admin/backup');
  assert.ok(backup.stamp);
  assert.ok(fs.existsSync(path.join(backup.path, 'workOrders.json')), 'a backup set contains a snapshot per collection');

  const exported = await get('/api/admin/export/formulas');
  assert.equal(exported.collection, 'formulas');
  assert.ok(exported.records.length >= 8);
});

test('the data on disk is plain, readable JSON', async () => {
  db.checkpoint();
  const snapshot = JSON.parse(fs.readFileSync(path.join(dataDir, 'db', 'formulas.json'), 'utf8'));
  assert.equal(snapshot.collection, 'formulas');
  assert.ok(snapshot.records.some((r) => r.code === 'F-4001'));
  assert.ok(snapshot.savedAt);
});

test('a product locks on customer approval and refuses edits until revised', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const project = db.find('projects', {}).find((p) => p.formulaId) ?? db.find('projects', {})[0];
  assert.ok(project, 'there is a project to work with');

  // open by default, and freely editable
  const before = await get(`/api/data/projects/${project.id}`);
  assert.equal(before.lockState ?? 'open', 'open');
  const openEdit = await patch(`/api/data/projects/${project.id}`, { notes: 'edited while open' });
  assert.equal(openEdit.notes, 'edited while open');

  // recording the customer's approval locks it as the production-of-record
  const locked = await post(`/api/projects/${project.id}/record-approval`, { signedName: 'Dana Rivera', signedTitle: 'VP Product' });
  assert.equal(locked.lockState, 'locked');
  assert.equal(locked.approval.signedName, 'Dana Rivera');

  // the project itself can no longer be edited through the generic API
  const blockedProject = await api('PATCH', `/api/data/projects/${project.id}`, { notes: 'should be refused' }, { raw: true });
  assert.equal(blockedProject.status, 409);
  assert.match(blockedProject.body.error, /locked/i);

  // and neither can its formula, through the formula-specific route
  const childFormula = db.find('formulas', { projectId: project.id })[0];
  if (childFormula) {
    const blockedFormula = await api('POST', `/api/commerce/formulas/${childFormula.id}/approve`, {}, { raw: true });
    assert.equal(blockedFormula.status, 409, 'a locked product freezes its formula too');
  }

  // opening a revision reopens it and preserves the approved snapshot
  const revised = await post(`/api/projects/${project.id}/revise`, { reason: 'customer requested a flavour change' });
  assert.equal(revised.lockState, 'open');
  assert.equal(revised.productRevision, (project.productRevision ?? 1) + 1);
  assert.ok((revised.approvalHistory ?? []).length >= 1, 'the approval is kept in the history');

  // editable again
  const reopened = await patch(`/api/data/projects/${project.id}`, { notes: 'editing after revise' });
  assert.equal(reopened.notes, 'editing after revise');
});

test('opening a revision is limited to the product.revise roles', async () => {
  const worker = db.find('users', { role: 'production', active: true })[0];
  assert.ok(worker, 'there is a production user to test with');
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: worker.email, password: 'enova2026' });
  const anyProject = db.find('projects', {})[0];
  const denied = await api('POST', `/api/projects/${anyProject.id}/revise`, {}, { raw: true });
  assert.equal(denied.status, 403, 'production cannot open a product revision');
});

test('the customer approval page works by token, hides cost, and locks on signature', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const project = db.find('projects', {}).find((p) => p.formulaId && (p.lockState ?? 'open') === 'open')
    ?? db.find('projects', {}).find((p) => (p.lockState ?? 'open') === 'open');
  assert.ok(project);
  const requested = await post(`/api/projects/${project.id}/request-approval`, {});
  const token = requested.approvalToken;
  assert.ok(token);

  // the page reads without any session — the token is the only credential
  const pkgRes = await fetch(`${base}/api/public/approval/${token}`);
  assert.equal(pkgRes.status, 200);
  const pkg = await pkgRes.json();
  assert.equal(pkg.project.id, project.id);
  // no internal economics ever cross to the customer
  assert.ok(!/cogs|margin|overhead|labor|costperunit|saleprice/i.test(JSON.stringify(pkg)), 'cost fields are not exposed');

  // approval requires the confirmation flag
  const noAgree = await fetch(`${base}/api/public/approval/${token}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signedName: 'Pat Buyer' }),
  });
  assert.equal(noAgree.status, 422);

  const signed = await fetch(`${base}/api/public/approval/${token}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedName: 'Pat Buyer', signedTitle: 'Owner', agree: true }),
  });
  assert.equal(signed.status, 200);

  const locked = db.get('projects', project.id);
  assert.equal(locked.lockState, 'locked');
  assert.equal(locked.approval.method, 'customer-signature');
  assert.equal(locked.approval.signedName, 'Pat Buyer');

  // the token is spent
  const dead = await fetch(`${base}/api/public/approval/${token}`);
  assert.equal(dead.status, 410);
});

test('a customer can request changes, which reopens the product and notifies the team', async () => {
  const project = db.find('projects', {}).find((p) => (p.lockState ?? 'open') === 'open');
  assert.ok(project);
  const requested = await post(`/api/projects/${project.id}/request-approval`, {});
  const token = requested.approvalToken;

  const res = await fetch(`${base}/api/public/approval/${token}/request-changes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedName: 'Pat Buyer', comment: 'Please raise the vitamin D to 2000 IU.' }),
  });
  assert.equal(res.status, 200);

  const reopened = db.get('projects', project.id);
  assert.equal(reopened.lockState, 'open');
  assert.equal(reopened.approvalToken, '');
  assert.ok(reopened.approvalHistory.some((a) => a.decision === 'changes_requested'));
});

test('samples mint a number, group on the board, and advance with date stamps', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const created = await post('/api/samples', { productName: 'Test D3 gummy', type: 'customer', quantity: 6 });
  assert.match(created.sampleNumber, /^S-\d{4}-\d{4}$/);
  assert.equal(created.status, 'requested');

  const board = await get('/api/samples/board');
  const requested = board.columns.find((c) => c.value === 'requested');
  assert.ok(requested.cards.some((s) => s.id === created.id));

  const shipped = await post(`/api/samples/${created.id}/move`, { status: 'shipped' });
  assert.equal(shipped.status, 'shipped');
  assert.ok(shipped.shippedAt, 'shipping stamps the date');

  const fb = await post(`/api/samples/${created.id}/feedback`, { outcome: 'approved', feedback: 'Loved it' });
  assert.equal(fb.status, 'approved');
  assert.equal(fb.outcome, 'approved');
  assert.ok(fb.respondedAt);
});

test('a quote request converts into a linked project and draft formula', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const rfq = await post('/api/rfqs', { productName: 'Zinc lozenge', format: 'tablet', targetQty: 50000, source: 'website' });
  assert.match(rfq.rfqNumber, /^R-\d{4}-\d{4}$/);
  assert.equal(rfq.status, 'new');

  const converted = await post(`/api/rfqs/${rfq.id}/convert`);
  assert.ok(converted.project.id && converted.formula.id);
  assert.equal(converted.rfq.projectId, converted.project.id);
  assert.equal(converted.rfq.status, 'quoting');
  // the formula is linked back to the project and starts as a draft
  const formula = db.get('formulas', converted.formula.id);
  assert.equal(formula.projectId, converted.project.id);
  assert.equal(formula.status, 'draft');
  assert.equal(formula.format, 'tablet');

  // converting again is refused
  const again = await api('POST', `/api/rfqs/${rfq.id}/convert`, {}, { raw: true });
  assert.equal(again.status, 409);
});

test('global search reaches the new modules and reports read', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });
  const found = await get('/api/search?q=Ashwagandha');
  assert.ok(found.groups.some((g) => g.collection === 'rfqs' && g.results.length), 'a seeded quote request is findable in global search');

  const overview = await get('/api/reports/overview');
  assert.ok(Array.isArray(overview.throughput) && overview.throughput.length === 12);
  assert.ok(overview.inventory.total > 0);
});

test('a project and its formula stay linked both ways on every write', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  // project -> formula: creating a project that names a formula stamps the formula
  const formula = await post('/api/data/formulas', { code: 'F-LINK-1', name: 'Link test formula' });
  const project = await post('/api/data/projects', { code: 'P-LINK-1', name: 'Link test project', formulaId: formula.id });
  assert.equal(db.get('formulas', formula.id).projectId, project.id);

  // formula -> project: a formula that names a project fills the project's empty slot
  const project2 = await post('/api/data/projects', { code: 'P-LINK-2', name: 'Link test project 2' });
  const formula2 = await post('/api/data/formulas', { code: 'F-LINK-2', name: 'Link test formula 2', projectId: project2.id });
  assert.equal(db.get('projects', project2.id).formulaId, formula2.id);

  // and re-pointing a project on a patch follows the new formula
  const formula3 = await post('/api/data/formulas', { code: 'F-LINK-3', name: 'Link test formula 3' });
  await patch(`/api/data/projects/${project.id}`, { formulaId: formula3.id });
  assert.equal(db.get('formulas', formula3.id).projectId, project.id);
});

test('MRP nets demand against supply week by week and plans buys by date', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const plan = await get('/api/planning/mrp?weeks=8');
  assert.equal(plan.weeks.length, 8);
  assert.ok(plan.items.length > 0, 'the floor and order book create requirements');

  // the running balance is internally consistent for every item, every week
  for (const item of plan.items) {
    let prev = item.onHand;
    for (const c of item.cells) {
      const expected = prev + c.supply + c.planned - c.demand;
      assert.ok(Math.abs(c.projected - expected) < 0.01, `${item.itemCode} ${c.week}: ${c.projected} vs ${expected}`);
      prev = c.projected;
    }
  }

  // an open work order's unissued material is demand
  const wo = db.find('workOrders').find((w) => !['complete', 'cancelled'].includes(w.stage)
    && w.materials.some((m) => m.itemId && (m.plannedQty - (m.issuedQty || 0)) > 0));
  const material = wo.materials.find((m) => m.itemId && (m.plannedQty - (m.issuedQty || 0)) > 0);
  const row = plan.items.find((i) => i.itemId === material.itemId);
  assert.ok(row && row.cells.reduce((s, c) => s + c.demand, 0) > 0, 'work-order material appears as demand');

  // a planned buy is dated back by the lead time and drafts into a PO at the planned quantity
  const buy = plan.buys.find((b) => {
    const item = db.get('items', b.itemId);
    const vendor = item?.defaultVendorId ? db.get('vendors', item.defaultVendorId) : null;
    return vendor && vendor.status !== 'disqualified';
  });
  if (buy) {
    assert.ok(Date.parse(buy.orderBy) <= Date.parse(buy.week), 'order-by date precedes the week of need');
    const drafted = await post('/api/purchasing/draft-from-suggestions', { itemIds: [buy.itemId], qtyById: { [buy.itemId]: buy.qty }, note: 'Planned by MRP' });
    assert.ok(drafted.count >= 1);
    const line = drafted.created.flatMap((po) => po.lines).find((l) => l.itemId === buy.itemId);
    assert.equal(line.qty, buy.qty, 'the PO line carries the MRP-planned quantity');
  }
});

test('recording batch output puts a real finished-goods lot into stock at actual cost', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const wo = db.find('workOrders').find((w) => w.formulaId && !['complete', 'cancelled'].includes(w.stage));
  const out = await post(`/api/production/${wo.id}/output`, { actualQty: 1000 });
  assert.ok(out.outputLotId, 'the batch now points at the lot it produced');

  const lot = db.get('lots', out.outputLotId);
  assert.equal(lot.status, 'quarantine', 'output waits for QA release');
  assert.equal(lot.qtyOnHand, 1000);
  assert.equal(lot.workOrderId, wo.id);

  const item = db.get('items', lot.itemId);
  assert.equal(item.type, 'finished_good', 'the produced item is a real, stockable item');
  assert.equal(item.madeByFormulaId, wo.formulaId);
  assert.equal(db.get('formulas', wo.formulaId).producesItemId, item.id, 'formula and item link both ways');

  // recording output again corrects the same lot instead of creating a second
  const again = await post(`/api/production/${wo.id}/output`, { actualQty: 1200 });
  assert.equal(again.outputLotId, out.outputLotId);
  assert.equal(db.get('lots', out.outputLotId).qtyOnHand, 1200);
  assert.equal(db.find('lots', { workOrderId: wo.id }).length, 1);
});

test('MRP plans a made intermediate as a batch and pulls its ingredients as dependent demand', async () => {
  const raw = db.find('items', { type: 'raw_material' })[0];
  // a blend formula: one unit = 1 g of blend, all of it this raw material
  const blend = await post('/api/data/formulas', {
    code: 'F-BLEND-1', name: 'Test blend', format: 'powder', servingsPerUnit: 1, totalFormatWeightMg: 1000,
    actives: [{ itemId: raw.id, code: raw.itemCode, name: raw.name, targetMg: 1000 }],
  });
  // the stockable intermediate it produces, linked from the item side
  const blendItem = await post('/api/data/items', { itemCode: 'WIP-BLEND-1', name: 'Test blend (bulk)', type: 'work_in_process', uom: 'kg', madeByFormulaId: blend.id, leadTimeDays: 7 });
  assert.equal(db.get('formulas', blend.id).producesItemId, blendItem.id, 'item and formula link both ways');

  // a fill formula that consumes the blend
  const fill = await post('/api/data/formulas', {
    code: 'F-FILL-1', name: 'Test fill', format: 'capsule', servingsPerUnit: 30,
    actives: [{ itemId: blendItem.id, code: 'WIP-BLEND-1', name: 'Test blend', targetMg: 500 }],
  });
  // an uncovered confirmed order for the fill, three weeks out
  const customer = db.find('customers')[0];
  const due = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  await post('/api/data/salesOrders', {
    orderNumber: 'SO-MRP-1', customerId: customer.id, status: 'confirmed',
    lines: [{ formulaId: fill.id, description: 'fill', qty: 10000, uom: 'ea', unitPrice: 1, shipped: 0 }],
    subtotal: 10000, total: 10000, requestedShipDate: due, promisedShipDate: due,
  });

  const plan = await get('/api/planning/mrp?weeks=8');
  const blendRow = plan.items.find((i) => i.itemId === blendItem.id);
  assert.ok(blendRow, 'the fill order creates demand for the blend');
  assert.ok(blendRow.plannedOrders.length > 0 && blendRow.plannedOrders.every((o) => o.kind === 'make'), 'a made item is planned as a batch');
  assert.ok(plan.makes.some((m) => m.itemId === blendItem.id) && !plan.buys.some((b) => b.itemId === blendItem.id), 'never a purchase');

  const rawRow = plan.items.find((i) => i.itemId === raw.id);
  assert.ok(rawRow && rawRow.sources.some((s) => s.type === 'plannedBatch' && s.id === blendItem.id), 'the planned blend batch pulls its raw material as dependent demand');
  // and the ingredient is due before the blend is: one level earlier in the horizon
  const blendWeek = blendRow.plannedOrders[0].week;
  const rawFromBlend = rawRow.sources.find((s) => s.type === 'plannedBatch' && s.id === blendItem.id).week;
  assert.ok(rawFromBlend <= blendWeek);
});

test('a batch carries its standard cost from planning and reports variance against actual', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  // plan a batch from a formula: the standard is frozen on the work order
  const formula = db.findOne('formulas', { code: 'F-4004' });
  const wo = await post('/api/production/from-formula', { formulaId: formula.id, plannedQty: 5000 });
  assert.ok(wo.standardUnitCost > 0, 'standard material cost per unit is snapshotted at planning');
  assert.ok(Math.abs(wo.standardMaterialCost - wo.standardUnitCost * 5000) < 0.01);

  // issue one material line from a released lot so there is an actual cost, then record output
  const line = wo.materials.findIndex((m) => m.itemId && db.find('lots', { itemId: m.itemId, status: 'released' }).some((l) => l.qtyOnHand > 0));
  assert.ok(line >= 0, 'a material with released stock exists');
  const lot = db.find('lots', { itemId: wo.materials[line].itemId, status: 'released' }).find((l) => l.qtyOnHand > 0);
  const issueQty = Math.min(wo.materials[line].plannedQty, lot.qtyOnHand);
  await post(`/api/production/${wo.id}/issue`, { index: line, lotId: lot.id, qty: issueQty });
  const out = await post(`/api/production/${wo.id}/output`, { actualQty: 4800 });
  assert.ok(out.actualUnitCost >= 0);
  assert.ok(Math.abs(out.actualMaterialCost - issueQty * lot.unitCost) < 0.01, 'actual cost is the issued quantity at the lot cost');

  // the variance report sees it and its arithmetic is right
  const overview = await get('/api/reports/overview');
  const row = overview.variance.rows.find((r) => r.id === wo.id);
  assert.ok(row, 'the batch appears in the variance report');
  assert.ok(Math.abs(row.unitVariance - (out.actualUnitCost - wo.standardUnitCost)) < 0.0001);
  assert.equal(row.yieldPct, 96);
  assert.equal(row.favorable, row.totalVariance <= 0);

  const csv = await fetch(`${base}/api/reports/export/cost-variance`, { headers: { Cookie: jar() } });
  assert.equal(csv.status, 200);
  assert.match((await csv.text()).split('\n')[0], /Standard \$\/unit,Actual \$\/unit/);
});

test('a routing drives batch steps, fixes standard labor, sizes the run, and captures actual time', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  // the standard set is seeded and adding it again is a no-op
  const seeded = db.find('routings');
  assert.ok(seeded.length >= 5, 'standard routings are seeded');
  const again = await post('/api/production/routings/defaults');
  assert.equal(again.added, 0);

  // a formula-specific routing wins over the format default
  const routing = await post('/api/data/routings', {
    code: 'RT-TEST', name: 'Test capsule routing', format: 'capsule', hoursPerShift: 8,
    operations: [
      { seq: 1, name: 'Dispensing', workCenter: 'Blending', setupMin: 30, runRatePerHour: 0, crew: 2, laborRate: 30, requiresSignature: false },
      { seq: 2, name: 'Encapsulation', workCenter: 'Encapsulation 1', setupMin: 60, runRatePerHour: 60000, crew: 2, laborRate: 30, requiresSignature: false },
      { seq: 3, name: 'Bulk sampling', workCenter: 'Encapsulation 1', setupMin: 15, runRatePerHour: 0, crew: 1, laborRate: 32, requiresSignature: true },
    ],
  });
  const formula = db.findOne('formulas', { code: 'F-4001' });
  await patch(`/api/data/formulas/${formula.id}`, { routingId: routing.id });

  const monday = new Date('2026-09-07T08:00:00Z').toISOString();
  const wo = await post('/api/production/from-formula', { formulaId: formula.id, plannedQty: 120000, plannedStart: monday });
  assert.equal(wo.routingId, routing.id);
  assert.equal(wo.line, 'Blending', 'the first work center becomes the line');
  assert.deepEqual(wo.steps.map((s) => s.name), ['Dispensing', 'Encapsulation', 'Bulk sampling']);
  assert.equal(wo.steps[1].plannedMin, 180, '60 setup + 120000/60000 h run');
  assert.equal(wo.steps[1].standardLaborCost, 180, '3 h × 2 crew × $30');
  assert.equal(wo.standardLaborMin, 225);
  assert.equal(wo.standardLaborCost, 30 + 180 + 8);
  // 225 min on an 8 h shift is one working day, so the run ends the day it starts
  assert.equal(wo.plannedEnd.slice(0, 10), '2026-09-07');

  // clock on, clock off, and log missed minutes
  const on = await post(`/api/production/${wo.id}/steps/1/time`, { action: 'start' });
  assert.ok(on.steps[1].timeEntries.some((e) => !e.endedAt), 'an open entry');
  assert.ok(on.actualStart, 'first clock-on starts the run');
  const twice = await api('POST', `/api/production/${wo.id}/steps/1/time`, { action: 'start' }, { raw: true });
  assert.equal(twice.status, 409);
  const off = await post(`/api/production/${wo.id}/steps/1/time`, { action: 'stop' });
  assert.ok(off.steps[1].timeEntries.every((e) => e.endedAt), 'entry closed');
  const logged = await post(`/api/production/${wo.id}/steps/1/time`, { minutes: 200, note: 'changeover overran' });
  assert.equal(logged.steps[1].actualMin, 200);
  assert.equal(logged.steps[1].actualLaborCost, 200, '200 min × 2 crew × $30/h');
  assert.equal(logged.actualLaborMin, 200);
  assert.equal(logged.actualLaborCost, 200);

  // the variance report carries the labor side once output exists
  const line = wo.materials.findIndex((m) => m.itemId && db.find('lots', { itemId: m.itemId, status: 'released' }).some((l) => l.qtyOnHand > 0));
  const lot = db.find('lots', { itemId: wo.materials[line].itemId, status: 'released' }).find((l) => l.qtyOnHand > 0);
  await post(`/api/production/${wo.id}/issue`, { index: line, lotId: lot.id, qty: Math.min(wo.materials[line].plannedQty, lot.qtyOnHand) });
  await post(`/api/production/${wo.id}/output`, { actualQty: 118000 });
  const overview = await get('/api/reports/overview');
  const row = overview.variance.rows.find((r) => r.id === wo.id);
  assert.ok(row, 'batch appears in the variance report');
  assert.equal(row.standardLaborCost, 218);
  assert.equal(row.actualLaborCost, 200);
  assert.equal(row.laborVariance, -18);
  const csv = await fetch(`${base}/api/reports/export/cost-variance`, { headers: { Cookie: jar() } }).then((r) => r.text());
  assert.match(csv.split('\n')[0], /Standard labor \$,Actual labor \$,Labor variance \$/);

  // a closed batch refuses more time
  for (let i = 0; i < wo.steps.length; i++) await post(`/api/production/${wo.id}/steps/${i}`, { done: true });
  await post(`/api/production/${wo.id}/move`, { stage: 'complete' });
  const closed = await api('POST', `/api/production/${wo.id}/steps/1/time`, { minutes: 5 }, { raw: true });
  assert.equal(closed.status, 409);
});

test('a physical count is scheduled, counted blind, reviewed against tolerance, recounted and posted', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const location = db.find('locations').find((l) => db.find('lots', { locationId: l.id }).some((lot) => lot.qtyOnHand > 0));
  const sheet = await post('/api/inventory/counts', { scope: 'location', locationId: location.id, blind: true, tolerancePct: 2 });
  assert.equal(sheet.status, 'scheduled');
  assert.ok(sheet.lines.length >= 2, 'the sheet lists the lots on hand there');
  assert.ok(sheet.lines.every((l) => l.locationId === location.id && l.expectedQty > 0 && l.itemName));

  const started = await post(`/api/inventory/counts/${sheet.id}/start`);
  assert.equal(started.status, 'counting');

  // count every line: the first one matches, the second is 10% short, the rest match
  for (const [i, line] of sheet.lines.entries()) {
    const counted = i === 1 ? Number((line.expectedQty * 0.9).toFixed(3)) : line.expectedQty;
    await post(`/api/inventory/counts/${sheet.id}/lines/${i}`, { countedQty: counted });
  }
  const counted = await get(`/api/inventory/counts/${sheet.id}`);
  assert.equal(counted.summary.counted, sheet.lines.length);
  assert.equal(counted.summary.outOfTolerance, 1);
  assert.equal(counted.lines[1].outOfTolerance, true);
  assert.ok(counted.lines[1].varianceValue < 0);

  // review, then posting is refused while a line sits outside tolerance
  const review = await post(`/api/inventory/counts/${sheet.id}/review`);
  assert.equal(review.status, 'review');
  const refused = await api('POST', `/api/inventory/counts/${sheet.id}/post`, {}, { raw: true });
  assert.equal(refused.status, 422);

  // recount the flagged line; it comes back matching the book, and the sheet posts cleanly
  const recount = await post(`/api/inventory/counts/${sheet.id}/recount`, { indexes: [1] });
  assert.equal(recount.status, 'counting');
  assert.equal(recount.lines[1].countedQty, null);
  assert.equal(recount.lines[1].recount, true);
  const shortBy = 0.5;
  const finalQty = Number((sheet.lines[1].expectedQty - shortBy).toFixed(3));
  await post(`/api/inventory/counts/${sheet.id}/lines/1`, { countedQty: finalQty, note: 'spillage on the floor' });
  await post(`/api/inventory/counts/${sheet.id}/review`);
  const before = db.get('lots', sheet.lines[1].lotId).qtyOnHand;
  const posted = await post(`/api/inventory/counts/${sheet.id}/post`, { acceptOutOfTolerance: true, reason: 'accepted after recount' });
  assert.equal(posted.status, 'closed');
  assert.equal(db.get('lots', sheet.lines[1].lotId).qtyOnHand, finalQty, 'the lot now holds what was counted');
  assert.equal(db.get('lots', sheet.lines[0].lotId).qtyOnHand, sheet.lines[0].expectedQty, 'a matching count leaves the lot alone');
  const txn = db.find('inventoryTxns', { refId: sheet.id, type: 'count' });
  assert.equal(txn.length, 1, 'one count transaction per adjusted lot');
  assert.ok(Math.abs(txn[0].qty - (finalQty - before)) < 0.0005);
  assert.match(txn[0].reason, /spillage/);
  assert.equal(posted.postedLines, 1);
  assert.ok(posted.postedValue <= 0);

  // closed sheets are final
  const again = await api('POST', `/api/inventory/counts/${sheet.id}/post`, {}, { raw: true });
  assert.equal(again.status, 409);

  // the accuracy report sees it
  const overview = await get('/api/reports/overview');
  const row = overview.accuracy.rows.find((r) => r.id === sheet.id);
  assert.ok(row, 'posted count is in the accuracy report');
  assert.equal(row.lines, sheet.lines.length);
  const csv = await fetch(`${base}/api/reports/export/count-accuracy`, { headers: { Cookie: jar() } }).then((r) => r.text());
  assert.match(csv.split('\n')[0], /Accuracy %,Net adjustment \$/);
});

test('the passwd CLI helper resets an account with a one-time password and reactivates it', async () => {
  const { setPassword } = await import('./db/passwd.js');
  const target = db.find('users').find((u) => u.email !== 'jbradfield@enovascience.com' && u.active);
  db.update('users', target.id, { active: false });

  const minted = setPassword(db, { email: target.email.toUpperCase() });
  assert.match(minted.temporary, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  assert.equal(minted.user.active, true, 'the account is reactivated');
  assert.equal(minted.user.mustChangePassword, true);

  await post('/api/auth/logout');
  const session = await post('/api/auth/login', { email: target.email, password: minted.temporary });
  assert.equal(session.user?.id ?? session.id, target.id);
  assert.equal((session.user ?? session).mustChangePassword, true, 'the app will ask for a new one');

  assert.throws(() => setPassword(db, { email: target.email, password: 'short' }), /at least 10/);
  assert.throws(() => setPassword(db, { email: 'nobody@enovascience.com' }), /No account/);
  const chosen = setPassword(db, { email: target.email, password: 'a proper passphrase' });
  assert.equal(chosen.temporary, null);
  assert.equal(chosen.user.mustChangePassword, false);
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: target.email, password: 'a proper passphrase' });
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });
});

test('the product journey reports each hand-off and the next action, and moves as records are created', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  // a brand-new project: only the project step is live, the formula is the next thing to do
  const project = await post('/api/data/projects', { code: 'P-JOURNEY', name: 'Journey test product', customerId: db.find('customers')[0].id, type: 'new_product', stage: 'intake' });
  let related = await get(`/api/projects/${project.id}/related`);
  const keys = related.journey.steps.map((s) => s.key);
  assert.deepEqual(keys, ['request', 'project', 'formula', 'quote', 'approval', 'order', 'batch', 'qa', 'shipment']);
  assert.equal(related.journey.steps[0].status, 'skipped', 'no RFQ behind it');
  assert.equal(related.journey.steps[1].status, 'current');
  assert.equal(related.journey.steps[2].status, 'todo');
  assert.equal(related.journey.next.key, 'formula');
  assert.match(related.journey.next.to, new RegExp(`/formulations/new\\?projectId=${project.id}`));

  // add a formula: the formula step is current and the quote is next
  const formula = await post('/api/data/formulas', { code: 'F-JOURNEY', name: 'Journey formula', format: 'capsule', projectId: project.id, servingsPerUnit: 30, actives: [{ itemId: db.find('items', { type: 'raw_material' })[0].id, name: 'Test', targetMg: 100, pricePerKg: 20 }] });
  related = await get(`/api/projects/${project.id}/related`);
  assert.equal(related.journey.steps[2].status, 'current');
  assert.equal(related.journey.steps[2].record.id, formula.id);
  assert.equal(related.journey.steps[3].status, 'todo');
  assert.match(related.journey.steps[3].action.to, /\/quotes\/new\?formulaId=/);

  // a quote created from the formula inherits the project and shows on the journey
  const quote = await post('/api/commerce/quotes', { formulaId: formula.id });
  assert.equal(quote.projectId, project.id, 'quote inherits the formula\'s project');
  related = await get(`/api/projects/${project.id}/related`);
  assert.equal(related.journey.steps[3].status, 'current');
  assert.equal(related.journey.steps[3].record.id, quote.id);
  // the formula is still a draft, so finishing it stays the next hand-off ahead of sending the quote
  assert.equal(related.journey.next.key, 'formula');
  await post(`/api/commerce/formulas/${formula.id}/approve`, {});
  related = await get(`/api/projects/${project.id}/related`);
  assert.equal(related.journey.steps[2].status, 'done');
  assert.equal(related.journey.next.key, 'quote');
  assert.ok(related.journey.progress >= 0);

  // the dashboard flow strip counts it
  const dashboard = await get('/api/dashboard');
  const tile = dashboard.flow.find((t) => t.key === 'projects');
  assert.ok(tile && tile.count >= 1 && tile.link === '/development');
  assert.ok(dashboard.flow.some((t) => t.key === 'quotes' && t.count >= 1));
});

test('SO# and MO# follow the product: orders and batches carry the project, show in its numbers, and can be linked by hand', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const project = db.findOne('projects', { code: 'P-JOURNEY' });
  const formula = db.findOne('formulas', { code: 'F-JOURNEY' });
  // a batch planned from the formula belongs to the project
  const wo = await post('/api/production/from-formula', { formulaId: formula.id, plannedQty: 1000 });
  assert.equal(wo.projectId, project.id);
  // an order raised from the quote does too
  const quote = db.find('quotes', { formulaId: formula.id })[0];
  await post(`/api/commerce/quotes/${quote.id}/recompute`, { tiers: [{ qty: 1000, labor: { encapsulationPer1000: 15, packagingPer1000: 10, qcPctOfProduction: 0.12 }, overheadRate: 0.9, margin: 0.4 }], coaFee: 0 });
  const so = await post(`/api/commerce/quotes/${quote.id}/to-order`, { qty: 1000, customerPo: 'PO-TEST-1' });
  assert.equal(so.projectId, project.id);

  const related = await get(`/api/projects/${project.id}/related`);
  assert.deepEqual(related.numbers.salesOrders.map((x) => x.number), [so.orderNumber]);
  assert.ok(related.numbers.workOrders.some((x) => x.number === wo.woNumber));
  assert.equal(related.numbers.formula.code, 'F-JOURNEY');
  assert.equal(related.salesOrders.total, 1);

  // an unrelated seeded order can be attached and detached by hand
  const other = db.find('salesOrders').find((x) => x.projectId !== project.id);
  await post(`/api/projects/${project.id}/link`, { salesOrderId: other.id });
  assert.equal(db.get('salesOrders', other.id).projectId, project.id);
  assert.equal((await get(`/api/projects/${project.id}/related`)).numbers.salesOrders.length, 2);
  await post(`/api/projects/${project.id}/link`, { salesOrderId: other.id, detach: true });
  assert.equal(db.get('salesOrders', other.id).projectId, '');

  // a generic record created with only a quote id derives its project
  const raw = await post('/api/data/salesOrders', { orderNumber: 'SO-DERIVED-1', customerId: project.customerId, quoteId: quote.id, lines: [], status: 'draft' });
  assert.equal(db.get('salesOrders', raw.id).projectId, project.id, 'projectId derived from the quote');

  // and the SO# is searchable
  const hits = await get(`/api/search?q=${encodeURIComponent(so.orderNumber)}`);
  const flat = JSON.stringify(hits);
  assert.match(flat, new RegExp(so.orderNumber));
});

test('quotes price labour from the routing, take a typed price and show GP, and only sell gummies and capsules in bulk', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });
  const formula = db.findOne('formulas', { code: 'F-4004' }); // a gummy with a routing

  // the labour picker offers the routing, the benchmarks and (once batches finish) actuals
  const options = await get(`/api/commerce/formulas/${formula.id}/labour?qty=10000`);
  assert.equal(options.routing.source, 'routing');
  assert.ok(options.routing.lines.length >= 5 && options.routing.perUnit > 0);
  assert.ok(options.routing.lines.every((l) => typeof l.minutes === 'number' && typeof l.crew === 'number'));
  assert.equal(options.bulkAllowed, true);
  assert.ok(options.bands.depositPer1000 > 0);

  // a computed tier carries the routing's lines and a margin-derived price
  const priced = await post('/api/commerce/quotes/compute', { formulaId: formula.id, tiers: [{ qty: 10000, laborMode: 'routing', margin: 0.4 }] });
  const tier = priced.tiers[0];
  assert.equal(tier.laborSource, 'routing');
  assert.ok(tier.laborLines.some((l) => /Depositing/.test(l.label) && l.minutes > 0));
  assert.equal(tier.priceSource, 'margin');
  assert.equal(tier.gpPct, 40);
  // bulk leaves bottling out and reports a per-thousand price
  const bulkOptions = await get(`/api/commerce/formulas/${formula.id}/labour?qty=10000&bulk=true`);
  assert.ok(!bulkOptions.routing.lines.some((l) => /Bottling|Labelling|Case packing/.test(l.label)), 'no packaging operations in bulk');
  assert.ok(bulkOptions.routing.perUnit < options.routing.perUnit);

  // set the price directly: the margin and GP are read back from it
  const set = await post('/api/commerce/quotes/compute', { formulaId: formula.id, tiers: [{ qty: 10000, laborMode: 'routing', margin: 0.4, priceOverride: 2.5 }] });
  assert.equal(set.tiers[0].priceSource, 'set');
  assert.equal(Number(set.tiers[0].salePricePerUnit), 2.5);
  assert.ok(Math.abs(Number(set.tiers[0].gpPerUnit) - (2.5 - Number(set.tiers[0].cogsPerUnit))) < 0.0001);
  assert.ok(Math.abs(set.tiers[0].gpPct - ((2.5 - Number(set.tiers[0].cogsPerUnit)) / 2.5) * 100) < 0.11);

  // a tablet cannot be bulk; a gummy can
  const tablet = db.find('formulas').find((f) => f.format === 'tablet');
  const refused = await api('PATCH', `/api/data/formulas/${tablet.id}`, { isBulk: true }, { raw: true });
  assert.equal(refused.status, 422);
  await patch(`/api/data/formulas/${formula.id}`, { isBulk: true });
  const bulkQuote = await post('/api/commerce/quotes/compute', { formulaId: formula.id, tiers: [{ qty: 10000, margin: 0.4 }] });
  assert.ok(Number(bulkQuote.tiers[0].per1000) > 0, 'bulk product is priced per thousand');
  assert.equal(bulkQuote.tiers[0].laborSource, 'routing');
  await patch(`/api/data/formulas/${formula.id}`, { isBulk: false });

  // a customer's defaults shape new quotes for them
  const customer = db.get('customers', formula.customerId);
  await patch(`/api/data/customers/${customer.id}`, { defaultMargin: 0.33, laborRateFactor: 0.9 });
  const theirs = await post('/api/commerce/quotes/compute', { formulaId: formula.id, customerId: customer.id });
  assert.ok(theirs.tiers.every((t) => t.margin === 0.33), 'default margin applied to every tier');
  assert.ok(Number(theirs.tiers[0].laborPerUnit) < Number(priced.tiers[0].laborPerUnit), 'negotiated labour factor lowers labour');
  await patch(`/api/data/customers/${customer.id}`, { defaultMargin: 0, laborRateFactor: 1 });
});

test('a shipped order becomes a repeat order, and reordering raises the next SO at the agreed price', async () => {
  const shipped = db.find('salesOrders').find((so) => ['shipped', 'invoiced', 'closed'].includes(so.status) && so.lines?.[0]?.formulaId);
  const saved = await post(`/api/commerce/templates/from-order/${shipped.id}`);
  assert.ok(saved.template.id && saved.template.customerId === shipped.customerId);
  const usedBefore = saved.template.timesUsed || 0;
  assert.equal(saved.template.unitPrice, shipped.lines[0].unitPrice);
  const again = await post(`/api/commerce/templates/from-order/${shipped.id}`);
  assert.equal(again.created, false, 'saving twice reuses the template');

  const order = await post(`/api/commerce/templates/${saved.template.id}/reorder`, { customerPo: 'PO-REPEAT-7', qty: 1200 });
  assert.match(order.orderNumber, /^SO-/);
  assert.equal(order.status, 'confirmed');
  assert.equal(order.customerPo, 'PO-REPEAT-7');
  assert.equal(order.lines[0].qty, 1200);
  assert.equal(order.lines[0].unitPrice, shipped.lines[0].unitPrice);
  assert.equal(order.projectId, saved.template.projectId);
  assert.equal(db.get('orderTemplates', saved.template.id).timesUsed, usedBefore + 1);
});

async function postCsv(url, csv, filename = 'data.csv') {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), filename);
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: cookies.size ? { Cookie: jar() } : {},
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

test('the CSV importer previews without writing, then commits and upserts', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const csv = 'Name,Email,Role,Title\nMaria Lopez,mlopez@enovascience.com,quality,QA Analyst\nBad Row,not-an-email,quality,\n';

  // dry run: reports one create and one error, writes nothing
  const preview = await postCsv('/api/import/users', csv);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.committed, false);
  assert.equal(preview.body.create, 1);
  assert.equal(preview.body.errors, 1);
  assert.equal(db.findOne('users', { email: 'mlopez@enovascience.com' }), null);

  // commit: the valid row lands, the bad one is skipped
  const commit = await postCsv('/api/import/users?commit=true', csv);
  assert.equal(commit.body.committed, true);
  assert.equal(commit.body.create, 1);
  const created = db.findOne('users', { email: 'mlopez@enovascience.com' });
  assert.ok(created, 'the valid row was imported');
  assert.equal(created.mustChangePassword, true, 'imported users must set their own password');

  // re-importing the same key updates in place rather than duplicating
  const again = await postCsv('/api/import/users?commit=true', 'Name,Email,Role,Title\nMaria Lopez,mlopez@enovascience.com,quality,Senior QA\n');
  assert.equal(again.body.update, 1);
  assert.equal(again.body.create, 0);
  assert.equal(db.find('users', { email: 'mlopez@enovascience.com' }).length, 1);
  assert.equal(db.findOne('users', { email: 'mlopez@enovascience.com' }).title, 'Senior QA');
});

test('an import template downloads as a CSV with the right columns', async () => {
  const res = await fetch(`${base}/api/import/items/template`, { headers: { Cookie: jar() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /csv/);
  const text = await res.text();
  assert.match(text.split('\n')[0], /Item Code,Name,Type/);
});

// Runs last: it clears the database, so nothing may depend on data after it.
test('reset clears the demo data, keeps settings, and keeps me signed in', async () => {
  await post('/api/auth/logout');
  await post('/api/auth/login', { email: 'jbradfield@enovascience.com', password: 'enova2026' });

  const guard = await api('POST', '/api/admin/reset', {}, { raw: true });
  assert.equal(guard.status, 400, 'reset needs the typed confirmation');

  const done = await post('/api/admin/reset', { confirm: 'ERASE' });
  assert.equal(done.ok, true);
  assert.equal(db.count('workOrders'), 0);
  assert.equal(db.count('formulas'), 0);
  assert.equal(db.count('customers'), 0);

  assert.ok(db.findOne('users', { email: 'jbradfield@enovascience.com' }), 'the account performing the reset survives');
  assert.ok(db.count('settings') > 0, 'settings are kept');

  const me = await get('/api/auth/me');
  assert.equal(me.user.email, 'jbradfield@enovascience.com', 'still signed in after the reset');
});
