/**
 * Material requirements planning — time-phased, level by level.
 *
 * For every item, walk the horizon week by week:
 *
 *   projected on-hand = last week's projected + scheduled receipts + planned orders − requirements
 *
 * Requirements come from the floor (open work orders, what is still unissued)
 * and from the order book (confirmed sales orders not yet covered by a work
 * order, exploded one level through their formula). Scheduled receipts are open
 * purchase-order lines. When the balance would dip below safety stock a planned
 * order is raised, dated back by lead time.
 *
 * A made item — an intermediate blend another formula consumes — is planned as a
 * batch, not a purchase, and only its *planned* batches are exploded into
 * raw-material demand. That is what keeps blend already on the shelf from
 * double-counting its ingredients: dependent demand is netted a level at a time.
 */

import { explodeFormula } from './bom.js';
import { itemPosition } from '../routes/inventory.js';

const DAY = 86_400_000;
const MAX_LEVELS = 5;
const OPEN_WO = new Set(['planned', 'released', 'staging', 'in_process', 'qc_hold', 'qa_review']);
const OPEN_SO = new Set(['confirmed', 'in_production', 'ready', 'partially_shipped']);
const OPEN_PO = new Set(['approved', 'sent', 'partial']);

function mondayOf(ms) {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.getTime();
}
const r3 = (n) => Number(n.toFixed(3));

export function planRequirements(db, { weeks = 12, now = Date.now() } = {}) {
  const start = mondayOf(now);
  const bucketOf = (iso) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(t)) return 0;
    const i = Math.floor((t - start) / (7 * DAY));
    return i < 0 ? 0 : i; // anything overdue lands in the current week
  };
  const weekList = Array.from({ length: weeks }, (_, i) => new Date(start + i * 7 * DAY).toISOString().slice(0, 10));

  const rows = new Map();
  const row = (itemId) => {
    if (!rows.has(itemId)) rows.set(itemId, { demand: new Array(weeks).fill(0), supply: new Array(weeks).fill(0), sources: [] });
    return rows.get(itemId);
  };
  const addDemand = (itemId, bucket, qty, source) => {
    if (!itemId || !(qty > 0) || bucket >= weeks) return;
    const r = row(itemId); r.demand[bucket] += qty; r.sources.push({ ...source, week: weekList[bucket], qty: r3(qty) });
  };
  const addSupply = (itemId, bucket, qty, source) => {
    if (!itemId || !(qty > 0) || bucket >= weeks) return;
    const r = row(itemId); r.supply[bucket] += qty; r.sources.push({ ...source, week: weekList[bucket], qty: r3(qty) });
  };

  // ── independent demand: the floor ─────────────────────────────────────────
  const openWos = db.find('workOrders').filter((wo) => OPEN_WO.has(wo.stage));
  const coveredOrders = new Set(openWos.map((wo) => wo.salesOrderId).filter(Boolean));
  for (const wo of openWos) {
    for (const m of wo.materials ?? []) {
      addDemand(m.itemId, bucketOf(wo.plannedStart), (m.plannedQty || 0) - (m.issuedQty || 0), { type: 'workOrder', ref: wo.woNumber, id: wo.id });
    }
  }
  // ── independent demand: the order book, where no batch exists yet ─────────
  for (const so of db.find('salesOrders').filter((o) => OPEN_SO.has(o.status))) {
    if (coveredOrders.has(so.id)) continue;
    const bucket = bucketOf(so.promisedShipDate || so.requestedShipDate || null);
    for (const line of so.lines ?? []) {
      const units = (line.qty || 0) - (line.shipped || 0);
      if (!line.formulaId || units <= 0) continue;
      const formula = db.get('formulas', line.formulaId);
      if (!formula) continue;
      for (const need of explodeFormula(formula, units)) {
        addDemand(need.itemId, bucket, need.qty, { type: 'salesOrder', ref: so.orderNumber, id: so.id });
      }
    }
  }
  // ── supply: open purchase orders ──────────────────────────────────────────
  for (const po of db.find('purchaseOrders').filter((p) => OPEN_PO.has(p.status))) {
    for (const line of po.lines ?? []) {
      addSupply(line.itemId, bucketOf(line.expectedDate || po.expectedAt), (line.qty || 0) - (line.received || 0), { type: 'purchaseOrder', ref: po.poNumber, id: po.id });
    }
  }

  // ── net one item across the horizon ───────────────────────────────────────
  const itemCache = new Map();
  const itemOf = (id) => { if (!itemCache.has(id)) itemCache.set(id, db.get('items', id)); return itemCache.get(id); };

  function net(itemId) {
    const item = itemOf(itemId);
    const r = rows.get(itemId);
    if (!item || !r) return null;
    const made = Boolean(item.madeByFormulaId);
    const vendor = !made && item.defaultVendorId ? db.get('vendors', item.defaultVendorId) : null;
    const leadTimeDays = item.leadTimeDays || vendor?.leadTimeDays || (made ? 7 : 21);
    const safety = item.safetyStock || 0;
    const onHand = r3(itemPosition(db, item).released);

    let projected = onHand;
    let shortWeek = null;
    const cells = [];
    const plannedOrders = [];
    for (let i = 0; i < weeks; i++) {
      const demand = r3(r.demand[i]);
      const supply = r3(r.supply[i]);
      let planned = 0;
      const after = projected + supply - demand;
      if (after < safety) {
        planned = r3(Math.max(item.reorderQty || 0, safety - after));
        const orderBy = new Date(start + i * 7 * DAY - leadTimeDays * DAY).toISOString().slice(0, 10);
        plannedOrders.push({ week: weekList[i], bucket: i, qty: planned, orderBy, late: Date.parse(orderBy) < mondayOf(now), kind: made ? 'make' : 'buy' });
        if (shortWeek === null) shortWeek = weekList[i];
      }
      projected = r3(after + planned);
      cells.push({ week: weekList[i], demand, supply, planned, projected });
    }
    return {
      itemId, itemCode: item.itemCode, name: item.name, uom: item.uom,
      onHand, safetyStock: safety, leadTimeDays, reorderQty: item.reorderQty || 0,
      made, madeByFormulaId: item.madeByFormulaId || '',
      vendorId: item.defaultVendorId || '', vendorName: vendor?.name ?? '',
      cells, shortWeek, plannedOrders,
    };
  }

  // ── level-by-level: planned batches of a made item become demand below it ──
  const results = new Map();
  const contributions = new Map(); // made itemId -> [{ childId, bucket, qty }] it has pushed down
  let queue = [...rows.keys()];
  for (let level = 0; level < MAX_LEVELS && queue.length; level++) {
    const next = new Set();
    for (const itemId of queue) {
      const res = net(itemId);
      if (!res) continue;
      results.set(itemId, res);
      if (!res.made) continue;

      // Replace whatever this item pushed down last pass with its current planned batches.
      for (const c of contributions.get(itemId) ?? []) {
        const child = rows.get(c.childId);
        if (child) { child.demand[c.bucket] -= c.qty; child.sources = child.sources.filter((s) => !(s.type === 'plannedBatch' && s.id === itemId && s.week === weekList[c.bucket])); }
        next.add(c.childId);
      }
      const pushed = [];
      const sub = db.get('formulas', res.madeByFormulaId);
      const kgPerUnit = sub ? ((sub.totalFormatWeightMg || 0) * (sub.servingsPerUnit || 1)) / 1_000_000 : 0;
      if (sub && kgPerUnit > 0) {
        for (const order of res.plannedOrders) {
          // The batch must be made before it is needed: its ingredients are due a lead time earlier.
          const bucket = Math.max(0, order.bucket - Math.ceil(res.leadTimeDays / 7));
          const units = order.qty / kgPerUnit;
          for (const need of explodeFormula(sub, units)) {
            if (!need.itemId) continue;
            addDemand(need.itemId, bucket, need.qty, { type: 'plannedBatch', ref: res.itemCode, id: itemId });
            pushed.push({ childId: need.itemId, bucket, qty: need.qty });
            next.add(need.itemId);
          }
        }
      }
      contributions.set(itemId, pushed);
    }
    queue = [...next];
  }

  const items = [...results.values()].filter((res) => {
    const r = rows.get(res.itemId);
    return r.demand.some((d) => d > 0.0005) || r.supply.some((s) => s > 0.0005);
  }).map((res) => ({ ...res, sources: rows.get(res.itemId).sources }));

  const buys = [];
  const makes = [];
  for (const res of items) {
    for (const o of res.plannedOrders) {
      const entry = { itemId: res.itemId, itemCode: res.itemCode, name: res.name, uom: res.uom, qty: o.qty, week: o.week, orderBy: o.orderBy, late: o.late };
      if (res.made) makes.push({ ...entry, formulaId: res.madeByFormulaId });
      else buys.push({ ...entry, vendorId: res.vendorId, vendorName: res.vendorName });
    }
  }
  items.sort((a, b) => (a.shortWeek ?? '9999') < (b.shortWeek ?? '9999') ? -1 : (a.shortWeek ?? '9999') > (b.shortWeek ?? '9999') ? 1 : a.name.localeCompare(b.name));
  buys.sort((a, b) => a.orderBy.localeCompare(b.orderBy));
  makes.sort((a, b) => a.orderBy.localeCompare(b.orderBy));

  return {
    start: weekList[0], weeks: weekList, generatedAt: new Date(now).toISOString(),
    items, buys, makes,
    summary: { items: items.length, short: items.filter((i) => i.shortWeek).length, late: buys.filter((b) => b.late).length + makes.filter((m) => m.late).length, buys: buys.length, makes: makes.length },
  };
}
