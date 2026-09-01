/**
 * Material requirements planning — time-phased.
 *
 * For every ingredient, walk the horizon week by week:
 *
 *   projected on-hand = last week's projected + scheduled receipts + planned buys − requirements
 *
 * Requirements come from the floor (open work orders, what is still unissued)
 * and from the order book (confirmed sales orders not yet covered by a work
 * order, exploded through their formula). Scheduled receipts are open purchase
 * order lines. When projected on-hand would dip below safety stock, a planned
 * buy is raised in that week and dated back by the lead time — so the answer is
 * always "order this much, by this date".
 */

import { explodeFormula } from './bom.js';
import { itemPosition } from '../routes/inventory.js';

const DAY = 86_400_000;
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

  // per item: demand[] and supply[] by bucket, plus who asked
  const rows = new Map();
  const row = (itemId) => {
    if (!rows.has(itemId)) rows.set(itemId, { demand: new Array(weeks).fill(0), supply: new Array(weeks).fill(0), sources: [] });
    return rows.get(itemId);
  };
  const addDemand = (itemId, iso, qty, source) => {
    if (!itemId || !(qty > 0)) return;
    const b = bucketOf(iso);
    if (b >= weeks) return;
    const r = row(itemId); r.demand[b] += qty; r.sources.push({ ...source, week: weekList[b], qty: r3(qty) });
  };
  const addSupply = (itemId, iso, qty, source) => {
    if (!itemId || !(qty > 0)) return;
    const b = bucketOf(iso);
    if (b >= weeks) return;
    const r = row(itemId); r.supply[b] += qty; r.sources.push({ ...source, week: weekList[b], qty: r3(qty) });
  };

  // ── demand: the floor ─────────────────────────────────────────────────────
  const openWos = db.find('workOrders').filter((wo) => OPEN_WO.has(wo.stage));
  const coveredOrders = new Set(openWos.map((wo) => wo.salesOrderId).filter(Boolean));
  for (const wo of openWos) {
    for (const m of wo.materials ?? []) {
      const remaining = (m.plannedQty || 0) - (m.issuedQty || 0);
      addDemand(m.itemId, wo.plannedStart, remaining, { type: 'workOrder', ref: wo.woNumber, id: wo.id });
    }
  }

  // ── demand: the order book, where no batch exists yet ─────────────────────
  for (const so of db.find('salesOrders').filter((o) => OPEN_SO.has(o.status))) {
    if (coveredOrders.has(so.id)) continue;
    const when = so.promisedShipDate || so.requestedShipDate || null;
    for (const line of so.lines ?? []) {
      const units = (line.qty || 0) - (line.shipped || 0);
      if (!line.formulaId || units <= 0) continue;
      const formula = db.get('formulas', line.formulaId);
      if (!formula) continue;
      for (const need of explodeFormula(formula, units)) {
        addDemand(need.itemId, when, need.qty, { type: 'salesOrder', ref: so.orderNumber, id: so.id });
      }
    }
  }

  // ── supply: open purchase orders ──────────────────────────────────────────
  for (const po of db.find('purchaseOrders').filter((p) => OPEN_PO.has(p.status))) {
    for (const line of po.lines ?? []) {
      const remaining = (line.qty || 0) - (line.received || 0);
      addSupply(line.itemId, line.expectedDate || po.expectedAt, remaining, { type: 'purchaseOrder', ref: po.poNumber, id: po.id });
    }
  }

  // ── net it out ────────────────────────────────────────────────────────────
  const items = [];
  const buys = [];
  for (const [itemId, r] of rows) {
    const item = db.get('items', itemId);
    if (!item) continue;
    const vendor = item.defaultVendorId ? db.get('vendors', item.defaultVendorId) : null;
    const leadTimeDays = item.leadTimeDays || vendor?.leadTimeDays || 21;
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
        // cover the shortfall back up to safety, never less than the standard reorder lot
        planned = r3(Math.max(item.reorderQty || 0, safety - after));
        const orderBy = new Date(start + i * 7 * DAY - leadTimeDays * DAY).toISOString().slice(0, 10);
        const late = Date.parse(orderBy) < mondayOf(now);
        plannedOrders.push({ week: weekList[i], qty: planned, orderBy, late });
        buys.push({ itemId, itemCode: item.itemCode, name: item.name, uom: item.uom, qty: planned, week: weekList[i], orderBy, late, vendorId: item.defaultVendorId || '', vendorName: vendor?.name ?? '' });
        if (shortWeek === null) shortWeek = weekList[i];
      }
      projected = r3(after + planned);
      cells.push({ week: weekList[i], demand, supply, planned, projected });
    }
    if (!r.demand.some((d) => d > 0) && !r.supply.some((s) => s > 0)) continue;
    items.push({
      itemId, itemCode: item.itemCode, name: item.name, uom: item.uom,
      onHand, safetyStock: safety, leadTimeDays, reorderQty: item.reorderQty || 0,
      vendorId: item.defaultVendorId || '', vendorName: vendor?.name ?? '',
      cells, shortWeek, plannedOrders, sources: r.sources,
    });
  }
  // shortages first, then by how soon
  items.sort((a, b) => (a.shortWeek ?? '9999') < (b.shortWeek ?? '9999') ? -1 : (a.shortWeek ?? '9999') > (b.shortWeek ?? '9999') ? 1 : a.name.localeCompare(b.name));
  buys.sort((a, b) => a.orderBy.localeCompare(b.orderBy));

  return {
    start: weekList[0], weeks: weekList, generatedAt: new Date(now).toISOString(),
    items, buys,
    summary: { items: items.length, short: items.filter((i) => i.shortWeek).length, late: buys.filter((b) => b.late).length, buys: buys.length },
  };
}
