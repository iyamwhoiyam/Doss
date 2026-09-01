/**
 * Reporting and exports.
 *
 * A handful of read-only rollups computed straight off the collections — no data
 * warehouse, just the same file-system database everything else uses. Each
 * report also exports as CSV so it drops into a spreadsheet.
 */

import { Router } from 'express';

import { requirePermission } from '../lib/auth.js';
import { route } from '../lib/http.js';
import { toCsv } from '../lib/csv.js';

const DAY = 86_400_000;

/** Monday (UTC) of the week a date falls in, as YYYY-MM-DD. */
function weekKey(iso) {
  const d = new Date(iso);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function throughput(db, weeks = 12) {
  const start = Date.now() - weeks * 7 * DAY;
  const buckets = new Map();
  for (let i = weeks - 1; i >= 0; i--) buckets.set(weekKey(new Date(Date.now() - i * 7 * DAY).toISOString()), 0);
  for (const wo of db.find('workOrders', { stage: 'complete' })) {
    if (!wo.actualEnd || Date.parse(wo.actualEnd) < start) continue;
    const key = weekKey(wo.actualEnd);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + (wo.actualQty || 0));
  }
  return [...buckets.entries()].map(([week, units]) => ({ week, units }));
}

function inventoryValuation(db) {
  const rows = new Map();
  for (const lot of db.find('lots')) {
    if (!lot.qtyOnHand || lot.qtyOnHand <= 0) continue;
    const item = lot.itemId ? db.get('items', lot.itemId) : null;
    const key = lot.itemId || 'unknown';
    const value = (lot.qtyOnHand || 0) * (lot.unitCost || 0);
    const row = rows.get(key) ?? { item: item?.name ?? '(unknown item)', itemCode: item?.itemCode ?? '', qty: 0, uom: lot.uom, value: 0 };
    row.qty += lot.qtyOnHand;
    row.value += value;
    rows.set(key, row);
  }
  const list = [...rows.values()]
    .map((r) => ({ ...r, qty: Number(r.qty.toFixed(3)), value: Number(r.value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
  return { rows: list, total: Number(list.reduce((s, r) => s + r.value, 0).toFixed(2)) };
}

function pipeline(db) {
  const rfqs = db.find('rfqs');
  const counts = {};
  for (const r of rfqs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const won = counts.won ?? 0;
  const lost = counts.lost ?? 0;
  const decided = won + lost;
  const openValue = rfqs
    .filter((r) => !['won', 'lost'].includes(r.status))
    .reduce((s, r) => s + (r.targetQty || 0) * (r.targetPrice || 0), 0);
  return {
    counts,
    won, lost,
    winRate: decided ? Number(((won / decided) * 100).toFixed(1)) : 0,
    openValue: Number(openValue.toFixed(2)),
    open: rfqs.length - decided,
  };
}

function delivery(db) {
  const orders = db.find('salesOrders').filter((o) => o.shippedAt && o.promisedShipDate);
  let onTime = 0;
  const rows = orders.map((o) => {
    const ok = Date.parse(o.shippedAt) <= Date.parse(o.promisedShipDate) + DAY; // same-day counts
    if (ok) onTime += 1;
    return { orderNumber: o.orderNumber, promised: o.promisedShipDate?.slice(0, 10), shipped: o.shippedAt?.slice(0, 10), onTime: ok };
  });
  return { total: orders.length, onTime, late: orders.length - onTime, rate: orders.length ? Number(((onTime / orders.length) * 100).toFixed(1)) : 0, rows };
}

/**
 * Standard vs actual: for every batch that has recorded output, the material
 * cost per unit it was planned at against what the issued lots actually cost,
 * plus yield. Only batches carrying both numbers qualify — a batch with output
 * but nothing issued has no actual cost to judge yet.
 */
function variance(db) {
  const r = (n, dp) => Number(n.toFixed(dp));
  const rows = db.find('workOrders')
    .filter((wo) => wo.actualQty > 0 && (wo.actualMaterialCost || 0) > 0 && (wo.actualUnitCost || 0) > 0 && (wo.standardUnitCost || 0) > 0)
    .map((wo) => {
      const std = wo.standardUnitCost;
      const act = wo.actualUnitCost;
      const unitVariance = r(act - std, 4);
      const totalVariance = r((wo.actualMaterialCost || act * wo.actualQty) - std * wo.actualQty, 2);
      // Labor only counts once the floor has clocked something against the batch.
      const stdLabor = wo.standardLaborCost || 0;
      const actLabor = wo.actualLaborCost || 0;
      const laborVariance = actLabor > 0 ? r(actLabor - stdLabor, 2) : null;
      return {
        id: wo.id, woNumber: wo.woNumber, batchNumber: wo.batchNumber, productName: wo.productName, stage: wo.stage,
        plannedQty: wo.plannedQty, actualQty: wo.actualQty,
        yieldPct: wo.plannedQty ? r((wo.actualQty / wo.plannedQty) * 100, 1) : null,
        standardUnitCost: std, actualUnitCost: act,
        unitVariance, unitVariancePct: r((unitVariance / std) * 100, 1),
        totalVariance, favorable: totalVariance <= 0,
        standardLaborCost: stdLabor, actualLaborCost: actLabor, laborVariance,
        standardLaborMin: wo.standardLaborMin || 0, actualLaborMin: wo.actualLaborMin || 0,
      };
    })
    .sort((a, b) => Math.abs(b.totalVariance) - Math.abs(a.totalVariance));
  return {
    rows,
    batches: rows.length,
    totalVariance: r(rows.reduce((s, x) => s + x.totalVariance, 0), 2),
    laborVariance: r(rows.reduce((s, x) => s + (x.laborVariance ?? 0), 0), 2),
    avgYield: rows.length ? r(rows.reduce((s, x) => s + (x.yieldPct ?? 0), 0) / rows.length, 1) : null,
  };
}

const CSV = {
  'cost-variance': (db) => toCsv(
    ['Work order', 'Batch', 'Product', 'Planned qty', 'Actual qty', 'Yield %', 'Standard $/unit', 'Actual $/unit', 'Variance $/unit', 'Variance %', 'Total variance $', 'Standard labor min', 'Actual labor min', 'Standard labor $', 'Actual labor $', 'Labor variance $'],
    variance(db).rows.map((x) => ({
      'Work order': x.woNumber, Batch: x.batchNumber, Product: x.productName, 'Planned qty': x.plannedQty, 'Actual qty': x.actualQty,
      'Yield %': x.yieldPct ?? '', 'Standard $/unit': x.standardUnitCost, 'Actual $/unit': x.actualUnitCost,
      'Variance $/unit': x.unitVariance, 'Variance %': x.unitVariancePct, 'Total variance $': x.totalVariance,
      'Standard labor min': x.standardLaborMin, 'Actual labor min': x.actualLaborMin,
      'Standard labor $': x.standardLaborCost, 'Actual labor $': x.actualLaborCost, 'Labor variance $': x.laborVariance ?? '',
    })),
  ),
  'inventory-valuation': (db) => {
    const { rows } = inventoryValuation(db);
    return toCsv(['Item code', 'Item', 'Quantity', 'UOM', 'Value (USD)'],
      rows.map((r) => ({ 'Item code': r.itemCode, Item: r.item, Quantity: r.qty, UOM: r.uom, 'Value (USD)': r.value })));
  },
  'production-throughput': (db) => toCsv(['Week starting', 'Units produced'],
    throughput(db, 12).map((r) => ({ 'Week starting': r.week, 'Units produced': r.units }))),
  'quote-pipeline': (db) => {
    const p = pipeline(db);
    return toCsv(['Status', 'Count'], Object.entries(p.counts).map(([Status, Count]) => ({ Status, Count })));
  },
  'on-time-delivery': (db) => {
    const d = delivery(db);
    return toCsv(['Order', 'Promised', 'Shipped', 'On time'],
      d.rows.map((r) => ({ Order: r.orderNumber, Promised: r.promised, Shipped: r.shipped, 'On time': r.onTime ? 'yes' : 'no' })));
  },
};

export function reportsRouter(db) {
  const router = Router();
  router.use(requirePermission('cost.view'));

  router.get('/overview', route((_req, res) => {
    res.json({
      throughput: throughput(db, 12),
      inventory: inventoryValuation(db),
      pipeline: pipeline(db),
      delivery: delivery(db),
      variance: variance(db),
    });
  }));

  router.get('/export/:report', route((req, res) => {
    const build = CSV[req.params.report];
    if (!build) return res.status(404).json({ error: `Unknown report "${req.params.report}"` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enova-${req.params.report}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(build(db));
  }));

  return router;
}
