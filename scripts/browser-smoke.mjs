/**
 * Browser smoke test.
 *
 * Drives the real application in a real browser against a running server: signs
 * in, drags a work order across the production board, proves the move survived
 * a reload, proves the floor guard rail refuses an unstaged batch, searches
 * every module from the command palette, edits a formula and watches it
 * re-price, and confirms a label review will not approve with undecided
 * findings.
 *
 * Unlike `npm test`, this needs a browser and a server:
 *
 *   npx playwright install chromium
 *   DATA_DIR=/tmp/enova-smoke PORT=4200 node server/index.js &
 *   node scripts/browser-smoke.mjs
 *
 * It mutates the database it runs against, so point it at a throwaway
 * DATA_DIR — a second run against the same directory starts from the state the
 * first one left behind.
 */

import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4200';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 2560, height: 1100 } });
const fails = [];
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails.push(label); };

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.fill('input[type=email]', 'jbradfield@enovascience.com');
for (const pw of ['EnovaOps2026!', 'enova2026']) {
  if (!(await page.locator('input[type=email]').count())) break;
  await page.fill('input[type=password]', pw);
  await page.click('button[type=submit]');
  await page.waitForTimeout(1400);
}
await page.waitForSelector('.app', { timeout: 20000 });
if (await page.locator('input[autocomplete=current-password]').count()) {
  await page.fill('input[autocomplete=current-password]', 'enova2026');
  await page.fill('input[autocomplete=new-password]', 'EnovaOps2026!');
  await page.click('.modal-foot button[type=submit]');
  await page.waitForTimeout(1500);
}
check(await page.locator('.app').isVisible(), 'sign in reaches the app shell');

// ── drag a work order between board columns ────────────────────────────────
await page.goto(`${base}/production`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.board-card', { timeout: 15000 });
await page.waitForTimeout(1200);

const cols = page.locator('.board-col');
const plannedCol = cols.nth(0);
const releasedCol = cols.nth(1);
const beforePlanned = Number(await plannedCol.locator('.board-col-count').innerText());
const beforeReleased = Number(await releasedCol.locator('.board-col-count').innerText());
const card = plannedCol.locator('.board-card').first();
const woNumber = (await card.locator('.mono').first().innerText()).trim();

const from = await card.boundingBox();
const to = await releasedCol.locator('.board-col-body').boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + 24);
await page.mouse.down();
await page.mouse.move(from.x + from.width / 2 + 40, from.y + 40, { steps: 8 });
await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 18 });
await page.mouse.up();
await page.waitForTimeout(2200);

const afterPlanned = Number(await plannedCol.locator('.board-col-count').innerText());
const afterReleased = Number(await releasedCol.locator('.board-col-count').innerText());
check(afterPlanned === beforePlanned - 1 && afterReleased === beforeReleased + 1,
  `dragging ${woNumber} moves it Planned ${beforePlanned}->${afterPlanned}, Released ${beforeReleased}->${afterReleased}`);

// the move must have persisted, not just re-rendered
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.board-card', { timeout: 15000 });
await page.waitForTimeout(1500);
const persisted = await page.locator('.board-col').nth(1).locator('.board-card', { hasText: woNumber }).count();
check(persisted === 1, `${woNumber} is still in Released after a reload`);

// ── the guard rail actually fires ──────────────────────────────────────────
const plannedCard = page.locator('.board-col').nth(0).locator('.board-card').first();
const inProcess = page.locator('.board-col').nth(3);
check((await inProcess.locator('.board-col-title').innerText()).trim() === 'In process', 'the fourth column is In process');
const f2 = await plannedCard.boundingBox();
const t2 = await inProcess.locator('.board-col-body').boundingBox();
await page.mouse.move(f2.x + f2.width / 2, f2.y + 24);
await page.mouse.down();
await page.mouse.move(f2.x + 60, f2.y + 40, { steps: 8 });
await page.mouse.move(t2.x + t2.width / 2, t2.y + 60, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(2500);
const toastCount = await page.locator('.toast').count();
const toastText = toastCount ? await page.locator('.toast').first().innerText() : '';
void toastCount;
check(/not been issued/i.test(toastText), `starting an unstaged batch is refused: "${toastText.split('\n')[0]}"`);

// ── the command palette searches across modules ────────────────────────────
await page.keyboard.press('Escape');
await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
await page.waitForSelector('.palette', { timeout: 5000 });
await page.fill('.palette-input', 'elderberry');
await page.waitForTimeout(1400);
const hits = await page.locator('.palette-item').count();
check(hits > 1, `palette returns ${hits} results for "elderberry"`);
await page.keyboard.press('Escape');

// ── editing a formula re-prices live ───────────────────────────────────────
await page.goto(`${base}/formulations`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
await page.locator('button.card').first().click();
await page.waitForSelector('.ing-row', { timeout: 15000 });
await page.waitForTimeout(2000);
const cogsBefore = await page.locator('.kpi-value').first().innerText();
const targetInput = page.locator('.ing-row input').first();
await targetInput.click();
await targetInput.press('Control+a');
await targetInput.type('250');
await page.waitForTimeout(2500);
const cogsAfter = await page.locator('.kpi-value').first().innerText();
check(cogsBefore !== cogsAfter, `raising an active re-prices live: ${cogsBefore} -> ${cogsAfter}`);

// ── the label review refuses to approve with undecided findings ────────────
await page.goto(`${base}/labels`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await page.locator('table.data tbody tr').first().click();
await page.waitForSelector('.page-title', { timeout: 15000 });
await page.waitForTimeout(1600);
const approve = page.locator('button', { hasText: 'Approve' }).first();
const approveDisabled = await approve.isDisabled().catch(() => null);
const undecided = await page.locator('.badge', { hasText: 'undecided' }).count();
check(undecided === 0 || approveDisabled === true, 'approve is blocked while findings are undecided');

console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED` : '\nall checks passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
