/**
 * Inventory control and monitoring: on-hand by item and lot, receiving,
 * adjustments, transfers, QA disposition, cycle counts and the alert engine
 * (below reorder point, expiring, quarantined, COA missing).
 *
 * Every quantity change goes through one of these endpoints so that the lot
 * balance and the transaction ledger can never disagree — a generic PATCH on a
 * lot's `qtyOnHand` would let them drift.
 */

import { Router } from 'express';

import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, num, requireFields, queryOptions } from '../lib/http.js';
import { logActivity, notifyRole } from '../lib/events.js';

const DAY = 86400000;
const daysUntil = (iso) => (iso ? Math.round((Date.parse(iso) - Date.now()) / DAY) : null);

/** On-hand, allocated and alert state for one catalogue item. */
export function itemPosition(db, item, { expiryWarningDays = 90 } = {}) {
  const lots = db.find('lots', { itemId: item.id });
  const live = lots.filter((l) => !['consumed', 'rejected'].includes(l.status));
  const onHand = live.reduce((sum, l) => sum + (l.qtyOnHand || 0), 0);
  const released = live.filter((l) => l.status === 'released').reduce((sum, l) => sum + (l.qtyOnHand || 0), 0);
  const quarantined = live.filter((l) => l.status === 'quarantine').reduce((sum, l) => sum + (l.qtyOnHand || 0), 0);
  const onHold = live.filter((l) => l.status === 'on_hold').reduce((sum, l) => sum + (l.qtyOnHand || 0), 0);

  const expiring = live.filter((l) => {
    const d = daysUntil(l.expiresAt);
    return d !== null && d <= expiryWarningDays && l.qtyOnHand > 0;
  });
  const expired = expiring.filter((l) => daysUntil(l.expiresAt) < 0);
  const missingCoa = live.filter((l) => item.requiresCoa && !l.coaReceived && l.qtyOnHand > 0);

  const openPoQty = db.find('purchaseOrders', { status: { $in: ['approved', 'sent', 'partial'] } })
    .flatMap((po) => po.lines ?? [])
    .filter((l) => l.itemId === item.id)
    .reduce((sum, l) => sum + Math.max(0, (l.qty || 0) - (l.received || 0)), 0);

  const alerts = [];
  if (item.reorderPoint > 0 && released <= item.reorderPoint) {
    alerts.push({
      kind: openPoQty > 0 ? 'reorder_covered' : 'below_reorder',
      severity: released <= (item.safetyStock || 0) ? 'danger' : 'warning',
      message: released <= (item.safetyStock || 0)
        ? `${released.toLocaleString()} ${item.uom} released — at or below safety stock (${item.safetyStock})`
        : `${released.toLocaleString()} ${item.uom} released — at or below the reorder point (${item.reorderPoint})`,
      suggestion: openPoQty > 0
        ? `${openPoQty.toLocaleString()} ${item.uom} already on order`
        : `Raise a purchase order for ${(item.reorderQty || 0).toLocaleString()} ${item.uom}`,
    });
  }
  if (expired.length) {
    alerts.push({ kind: 'expired', severity: 'danger', message: `${expired.length} lot${expired.length > 1 ? 's have' : ' has'} passed its expiry date`, suggestion: 'Quarantine and dispose, or request a retest' });
  } else if (expiring.length) {
    alerts.push({ kind: 'expiring', severity: 'warning', message: `${expiring.length} lot${expiring.length > 1 ? 's expire' : ' expires'} within ${expiryWarningDays} days`, suggestion: 'Consume first or plan a retest' });
  }
  if (quarantined > 0) {
    alerts.push({ kind: 'quarantine', severity: 'info', message: `${quarantined.toLocaleString()} ${item.uom} awaiting disposition`, suggestion: 'QA review required before this stock can be used' });
  }
  if (missingCoa.length) {
    alerts.push({ kind: 'missing_coa', severity: 'warning', message: `${missingCoa.length} lot${missingCoa.length > 1 ? 's have' : ' has'} no COA on file`, suggestion: 'Chase the vendor before disposition' });
  }

  return {
    ...item,
    onHand: Number(onHand.toFixed(4)),
    released: Number(released.toFixed(4)),
    quarantined: Number(quarantined.toFixed(4)),
    onHold: Number(onHold.toFixed(4)),
    onOrder: Number(openPoQty.toFixed(4)),
    lotCount: live.length,
    value: Number((onHand * (item.costPerUom || 0)).toFixed(2)),
    nextExpiry: live.filter((l) => l.expiresAt).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0]?.expiresAt ?? null,
    alerts,
  };
}

export function inventoryRouter(db) {
  const router = Router();
  const setting = (key, fallback) => db.findOne('settings', { key })?.value ?? fallback;

  // -- positions: the main inventory grid --
  router.get('/positions', route((req, res) => {
    const options = queryOptions(req, ['name', 'itemCode', 'category', 'form', 'tags']);
    const expiryWarningDays = num(setting('inventory.expiryWarningDays', 90), 90);
    const { rows, total } = db.query('items', {
      ...options,
      sort: options.sort ?? 'name',
      where: { active: true, ...(options.where ?? {}) },
    });
    const positions = rows.map((item) => itemPosition(db, item, { expiryWarningDays }));

    const filter = req.query.alert;
    const filtered = filter
      ? positions.filter((p) => p.alerts.some((a) => a.kind === filter))
      : positions;

    res.json({
      rows: filtered,
      total: filter ? filtered.length : total,
      totals: {
        value: Number(positions.reduce((s, p) => s + p.value, 0).toFixed(2)),
        items: positions.length,
        withAlerts: positions.filter((p) => p.alerts.length).length,
      },
    });
  }));

  router.get('/items/:id/position', route((req, res) => {
    const item = db.getOrFail('items', req.params.id);
    const position = itemPosition(db, item, { expiryWarningDays: num(setting('inventory.expiryWarningDays', 90), 90) });
    res.json({
      ...position,
      lots: db.find('lots', { itemId: item.id }, { sort: 'expiresAt' }),
      transactions: db.find('inventoryTxns', { itemId: item.id }, { sort: '-performedAt', limit: 60 }),
    });
  }));

  // -- alerts across the whole catalogue --
  router.get('/alerts', route((_req, res) => {
    const expiryWarningDays = num(setting('inventory.expiryWarningDays', 90), 90);
    const rows = [];
    for (const item of db.find('items', { active: true })) {
      const position = itemPosition(db, item, { expiryWarningDays });
      for (const alert of position.alerts) {
        rows.push({
          itemId: item.id, itemCode: item.itemCode, itemName: item.name, uom: item.uom,
          onHand: position.onHand, released: position.released, reorderPoint: item.reorderPoint,
          ...alert,
        });
      }
    }
    const rank = { danger: 0, warning: 1, info: 2 };
    rows.sort((a, b) => rank[a.severity] - rank[b.severity] || a.itemName.localeCompare(b.itemName));
    res.json({ rows, total: rows.length, bySeverity: { danger: rows.filter((r) => r.severity === 'danger').length, warning: rows.filter((r) => r.severity === 'warning').length, info: rows.filter((r) => r.severity === 'info').length } });
  }));

  // -- receiving --
  router.post('/receive', requirePermission('inventory.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['itemId', 'qty']);
    const ctx = actorContext(req);
    const result = db.transaction((tx) => {
      const item = tx.getOrFail('items', req.body.itemId);
      const qty = num(req.body.qty);
      if (qty <= 0) throw new HttpError(422, 'Received quantity must be greater than zero');

      const quarantine = tx.findOne('locations', { code: 'QUAR-01' });
      const locationId = req.body.locationId || (item.requiresCoa ? quarantine?.id : item.defaultLocationId) || item.defaultLocationId;
      const receivedAt = req.body.receivedAt ?? new Date().toISOString();
      // packaging has no shelf life, so it carries no expiry unless one is given
      const expiresAt = req.body.expiresAt
        ?? (item.type === 'packaging'
          ? null
          : new Date(Date.parse(receivedAt) + (item.shelfLifeDays || 730) * DAY).toISOString());

      const lot = tx.insert('lots', {
        lotNumber: req.body.lotNumber || tx.nextSequence('LOT', 'L{yy}-{n:5}'),
        itemId: item.id,
        vendorId: req.body.vendorId || item.defaultVendorId,
        vendorLot: req.body.vendorLot ?? '',
        purchaseOrderId: req.body.purchaseOrderId ?? '',
        status: item.requiresCoa ? 'quarantine' : 'released',
        qtyReceived: qty,
        qtyOnHand: qty,
        uom: req.body.uom || item.uom,
        locationId,
        unitCost: num(req.body.unitCost, item.costPerUom),
        receivedAt,
        manufacturedAt: req.body.manufacturedAt ?? null,
        expiresAt,
        retestAt: new Date(Date.parse(receivedAt) + num(setting('inventory.retestWindowDays', 365), 365) * DAY).toISOString(),
        coaReceived: Boolean(req.body.coaReceived),
        notes: req.body.notes ?? '',
      }, ctx);

      tx.insert('inventoryTxns', {
        txnNumber: tx.nextSequence('TXN', 'T-{n:6}'),
        type: 'receipt',
        itemId: item.id,
        lotId: lot.id,
        qty,
        uom: lot.uom,
        toLocationId: locationId,
        refType: req.body.purchaseOrderId ? 'purchaseOrder' : 'lot',
        refId: req.body.purchaseOrderId || lot.id,
        reason: req.body.reason || 'Goods receipt',
        unitCost: lot.unitCost,
        balanceAfter: qty,
        performedAt: receivedAt,
      }, ctx);

      // roll the received quantity onto the purchase order line
      if (req.body.purchaseOrderId) {
        const po = tx.getOrFail('purchaseOrders', req.body.purchaseOrderId);
        const lines = (po.lines ?? []).map((l) => (l.itemId === item.id
          ? { ...l, received: Number(((l.received ?? 0) + qty).toFixed(4)), lotIds: [...(l.lotIds ?? []), lot.id] }
          : l));
        const complete = lines.every((l) => (l.received ?? 0) >= l.qty);
        tx.update('purchaseOrders', po.id, {
          lines,
          status: complete ? 'received' : 'partial',
          receivedAt: complete ? new Date().toISOString() : po.receivedAt,
        }, ctx);
      }
      return lot;
    }, ctx);

    const item = db.get('items', result.itemId);
    logActivity(db, req, {
      type: 'lot',
      title: `Lot ${result.lotNumber} received`,
      detail: `${result.qtyReceived} ${result.uom} of ${item?.name}`,
      tone: 'success',
      refType: 'lot',
      refId: result.id,
      link: `/inventory/${result.itemId}`,
    });
    if (result.status === 'quarantine') notifyRole(db, 'quality', { title: `Lot ${result.lotNumber} is in quarantine`, body: `${item?.name} — awaiting COA review and disposition.`, link: '/inventory?alert=quarantine', severity: 'warning' });
    res.status(201).json(result);
  }));

  // -- QA disposition --
  router.post('/lots/:id/disposition', requirePermission('inventory.dispose'), route((req, res) => {
    requireFields(req.body ?? {}, ['status']);
    const { status, notes } = req.body;
    if (!['released', 'rejected', 'on_hold', 'quarantine'].includes(status)) {
      throw new HttpError(422, 'Disposition must be released, rejected, on hold or quarantine');
    }
    const lot = db.getOrFail('lots', req.params.id);
    const item = db.get('items', lot.itemId);
    if (status === 'released' && item?.requiresCoa && !lot.coaReceived && !req.body.coaReceived) {
      throw new HttpError(409, `${item.name} requires a certificate of analysis before release. Attach the COA or mark it received.`);
    }

    const ctx = actorContext(req);
    const patch = {
      status,
      notes: notes ?? lot.notes,
      dispositionBy: req.user.id,
      dispositionAt: new Date().toISOString(),
    };
    if (req.body.coaReceived !== undefined) patch.coaReceived = Boolean(req.body.coaReceived);
    if (status === 'released' && lot.status === 'quarantine') {
      patch.locationId = req.body.locationId || item?.defaultLocationId || lot.locationId;
    }
    const updated = db.update('lots', lot.id, patch, ctx);

    if (status === 'rejected') {
      db.insert('inventoryTxns', {
        txnNumber: db.nextSequence('TXN', 'T-{n:6}'),
        type: 'scrap',
        itemId: lot.itemId,
        lotId: lot.id,
        qty: -lot.qtyOnHand,
        uom: lot.uom,
        fromLocationId: lot.locationId,
        refType: 'lot',
        refId: lot.id,
        reason: notes || 'Rejected by QA',
        unitCost: lot.unitCost,
        balanceAfter: 0,
        performedAt: new Date().toISOString(),
      }, ctx);
      db.update('lots', lot.id, { qtyOnHand: 0 }, ctx);
    }

    logActivity(db, req, {
      type: 'lot',
      title: `Lot ${lot.lotNumber} ${status === 'released' ? 'released by QA' : status.replace('_', ' ')}`,
      detail: item?.name ?? '',
      tone: status === 'released' ? 'success' : status === 'rejected' ? 'danger' : 'warning',
      refType: 'lot',
      refId: lot.id,
      link: `/inventory/${lot.itemId}`,
    });
    res.json(db.get('lots', lot.id) ?? updated);
  }));

  // -- adjustment --
  router.post('/adjust', requirePermission('inventory.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['lotId', 'newQty', 'reason']);
    const ctx = actorContext(req);
    const result = db.transaction((tx) => {
      const lot = tx.getOrFail('lots', req.body.lotId);
      const newQty = num(req.body.newQty);
      if (newQty < 0) throw new HttpError(422, 'On-hand quantity cannot be negative');
      const delta = Number((newQty - lot.qtyOnHand).toFixed(4));
      if (delta === 0) return lot;

      tx.insert('inventoryTxns', {
        txnNumber: tx.nextSequence('TXN', 'T-{n:6}'),
        type: 'adjustment',
        itemId: lot.itemId,
        lotId: lot.id,
        qty: delta,
        uom: lot.uom,
        fromLocationId: delta < 0 ? lot.locationId : '',
        toLocationId: delta > 0 ? lot.locationId : '',
        refType: 'lot',
        refId: lot.id,
        reason: req.body.reason,
        unitCost: lot.unitCost,
        balanceAfter: newQty,
        performedAt: new Date().toISOString(),
      }, ctx);
      return tx.update('lots', lot.id, { qtyOnHand: newQty, status: newQty === 0 ? 'consumed' : lot.status }, ctx);
    }, ctx);
    res.json(result);
  }));

  // -- transfer --
  router.post('/transfer', requirePermission('inventory.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['lotId', 'toLocationId']);
    const ctx = actorContext(req);
    const result = db.transaction((tx) => {
      const lot = tx.getOrFail('lots', req.body.lotId);
      const to = tx.getOrFail('locations', req.body.toLocationId);
      const qty = req.body.qty === undefined ? lot.qtyOnHand : num(req.body.qty);
      if (qty <= 0 || qty > lot.qtyOnHand) throw new HttpError(422, `Transfer quantity must be between 0 and ${lot.qtyOnHand}`);

      tx.insert('inventoryTxns', {
        txnNumber: tx.nextSequence('TXN', 'T-{n:6}'),
        type: 'transfer',
        itemId: lot.itemId,
        lotId: lot.id,
        qty,
        uom: lot.uom,
        fromLocationId: lot.locationId,
        toLocationId: to.id,
        refType: 'lot',
        refId: lot.id,
        reason: req.body.reason || `Transfer to ${to.name}`,
        balanceAfter: lot.qtyOnHand,
        performedAt: new Date().toISOString(),
      }, ctx);

      // a partial move splits the lot so each location carries its own balance
      if (qty < lot.qtyOnHand) {
        tx.update('lots', lot.id, { qtyOnHand: Number((lot.qtyOnHand - qty).toFixed(4)) }, ctx);
        const { id, createdAt, updatedAt, version, deletedAt, ...rest } = lot;
        return tx.insert('lots', {
          ...rest,
          lotNumber: `${lot.lotNumber}-${to.code}`,
          qtyOnHand: qty,
          qtyReceived: qty,
          locationId: to.id,
        }, ctx);
      }
      return tx.update('lots', lot.id, { locationId: to.id }, ctx);
    }, ctx);
    res.json(result);
  }));

  // -- cycle counts / physical inventory --

  /** Fresh book figures for a sheet's lines, and the totals the review screen shows. */
  const summarise = (count) => {
    const tolerance = Number(count.tolerancePct ?? setting('inventory.countTolerancePct', 2)) || 0;
    const lines = (count.lines ?? []).map((line) => {
      const counted = line.countedQty === null || line.countedQty === undefined ? null : Number(line.countedQty);
      const variance = counted === null ? null : Number((counted - line.expectedQty).toFixed(4));
      const pct = variance === null ? null : line.expectedQty ? Number(((variance / line.expectedQty) * 100).toFixed(2)) : (variance ? 100 : 0);
      return {
        ...line,
        variance,
        variancePct: pct,
        varianceValue: variance === null ? null : Number((variance * (line.unitCost || 0)).toFixed(2)),
        outOfTolerance: pct !== null && Math.abs(pct) > tolerance,
      };
    });
    const counted = lines.filter((l) => l.countedQty !== null && l.countedQty !== undefined);
    const withVariance = counted.filter((l) => l.variance !== 0);
    return {
      lines,
      tolerancePct: tolerance,
      summary: {
        lines: lines.length,
        counted: counted.length,
        withVariance: withVariance.length,
        outOfTolerance: lines.filter((l) => l.outOfTolerance).length,
        recounts: lines.filter((l) => l.recount).length,
        netQty: Number(withVariance.reduce((s, l) => s + l.variance, 0).toFixed(4)),
        netValue: Number(withVariance.reduce((s, l) => s + (l.varianceValue || 0), 0).toFixed(2)),
        absValue: Number(withVariance.reduce((s, l) => s + Math.abs(l.varianceValue || 0), 0).toFixed(2)),
        accuracyPct: counted.length ? Number(((counted.filter((l) => !l.outOfTolerance).length / counted.length) * 100).toFixed(1)) : null,
      },
    };
  };

  const enrich = (count) => {
    const { lines, summary, tolerancePct } = summarise(count);
    return {
      ...count,
      tolerancePct,
      summary,
      lines: lines.map((line) => {
        const item = db.get('items', line.itemId);
        const lot = db.get('lots', line.lotId);
        return { ...line, itemName: item?.name ?? '(unknown item)', itemCode: item?.itemCode ?? '', lotStatus: lot?.status ?? '', locationId: lot?.locationId ?? '', bookQty: lot?.qtyOnHand ?? line.expectedQty };
      }),
    };
  };

  /** The lots a count sheet covers — everything with stock in scope. */
  const lotsInScope = (scope, { locationId, itemIds }) => {
    let lots = db.find('lots').filter((l) => (l.qtyOnHand || 0) > 0 && !['consumed', 'rejected'].includes(l.status));
    if (scope === 'location') lots = lots.filter((l) => l.locationId === locationId);
    if (scope === 'items') lots = lots.filter((l) => itemIds.includes(l.itemId));
    return lots.sort((a, b) => (a.locationId || '').localeCompare(b.locationId || '') || a.lotNumber.localeCompare(b.lotNumber));
  };

  router.get('/counts/:id', route((req, res) => {
    res.json(enrich(db.getOrFail('cycleCounts', req.params.id)));
  }));

  /** Schedule a count sheet: snapshot the book quantity of every lot in scope. */
  router.post('/counts', requirePermission('inventory.write'), route((req, res) => {
    const { scope = 'location', locationId = '', itemIds = [], scheduledFor = null, blind = true, tolerancePct, notes = '' } = req.body ?? {};
    if (scope === 'location' && !locationId) throw new HttpError(422, 'Pick the location to count');
    if (scope === 'items' && !itemIds.length) throw new HttpError(422, 'Pick at least one item to count');
    if (scope === 'location') db.getOrFail('locations', locationId);
    const lots = lotsInScope(scope, { locationId, itemIds });
    if (!lots.length) throw new HttpError(422, 'Nothing is on hand in that scope, so there is nothing to count');

    const count = db.insert('cycleCounts', {
      countNumber: db.nextSequence('COUNT', 'CC-{yyyy}-{n:3}'),
      locationId: scope === 'location' ? locationId : '',
      scope, itemIds: scope === 'items' ? itemIds : [], blind: Boolean(blind),
      tolerancePct: tolerancePct != null ? num(tolerancePct, 2) : num(setting('inventory.countTolerancePct', 2), 2),
      status: 'scheduled',
      scheduledFor: scheduledFor || new Date().toISOString(),
      lines: lots.map((lot) => ({
        lotId: lot.id, lotNumber: lot.lotNumber, itemId: lot.itemId, uom: lot.uom, unitCost: lot.unitCost || 0,
        expectedQty: lot.qtyOnHand, countedQty: null, variance: null, countedBy: '', countedAt: null, recount: false, note: '',
      })),
      countedBy: '', notes,
    }, actorContext(req));

    logActivity(db, req, {
      type: 'inventory', title: `Count ${count.countNumber} scheduled`,
      detail: `${count.lines.length} lots · ${scope === 'location' ? db.get('locations', locationId)?.name : scope === 'items' ? `${itemIds.length} items` : 'whole warehouse'}`,
      tone: 'info', refType: 'cycleCount', refId: count.id, link: `/inventory/counts/${count.id}`,
    });
    res.status(201).json(enrich(count));
  }));

  /** Start counting: the book quantity is re-snapshotted so the sheet is current. */
  router.post('/counts/:id/start', requirePermission('inventory.write'), route((req, res) => {
    const count = db.getOrFail('cycleCounts', req.params.id);
    if (!['scheduled', 'counting'].includes(count.status)) throw new HttpError(409, `A ${count.status} count cannot be started`);
    const lines = count.lines.map((line) => ({ ...line, expectedQty: db.get('lots', line.lotId)?.qtyOnHand ?? line.expectedQty }));
    res.json(enrich(db.update('cycleCounts', count.id, { status: 'counting', startedAt: count.startedAt ?? new Date().toISOString(), lines, countedBy: count.countedBy || req.user.id }, actorContext(req))));
  }));

  /** Record one line's count. Blind or not, the response echoes the whole sheet. */
  router.post('/counts/:id/lines/:index', requirePermission('inventory.write'), route((req, res) => {
    const count = db.getOrFail('cycleCounts', req.params.id);
    if (!['scheduled', 'counting', 'review'].includes(count.status)) throw new HttpError(409, `A ${count.status} count no longer takes entries`);
    const index = num(req.params.index, -1);
    if (!count.lines[index]) throw new HttpError(404, 'That count line does not exist');
    const { countedQty, note } = req.body ?? {};
    const counted = countedQty === null || countedQty === '' || countedQty === undefined ? null : num(countedQty, NaN);
    if (counted !== null && (!Number.isFinite(counted) || counted < 0)) throw new HttpError(422, 'Counted quantity must be zero or more');
    const now = new Date().toISOString();
    const lines = count.lines.map((line, i) => (i === index ? {
      ...line,
      countedQty: counted,
      variance: counted === null ? null : Number((counted - line.expectedQty).toFixed(4)),
      countedBy: counted === null ? '' : req.user.id,
      countedAt: counted === null ? null : now,
      recount: counted === null ? line.recount : false,
      note: note ?? line.note,
    } : line));
    const patch = { lines };
    if (count.status === 'scheduled') { patch.status = 'counting'; patch.startedAt = now; }
    if (!count.countedBy) patch.countedBy = req.user.id;
    res.json(enrich(db.update('cycleCounts', count.id, patch, actorContext(req))));
  }));

  /** Send the sheet to review once every line has a count. */
  router.post('/counts/:id/review', requirePermission('inventory.write'), route((req, res) => {
    const count = db.getOrFail('cycleCounts', req.params.id);
    if (count.status !== 'counting') throw new HttpError(409, `A ${count.status} count cannot go to review`);
    const missing = count.lines.filter((l) => l.countedQty === null || l.countedQty === undefined);
    if (missing.length && !req.body?.allowUncounted) throw new HttpError(422, `${missing.length} line${missing.length === 1 ? ' has' : 's have'} no count yet`);
    res.json(enrich(db.update('cycleCounts', count.id, { status: 'review', reviewedAt: new Date().toISOString() }, actorContext(req))));
  }));

  /** Ask for a recount of the given lines: their counts are cleared and the sheet reopens. */
  router.post('/counts/:id/recount', requirePermission('inventory.write'), route((req, res) => {
    const count = db.getOrFail('cycleCounts', req.params.id);
    if (!['counting', 'review'].includes(count.status)) throw new HttpError(409, `A ${count.status} count cannot be recounted`);
    const indexes = new Set((req.body?.indexes ?? []).map((i) => num(i, -1)));
    if (!indexes.size) throw new HttpError(422, 'Pick the lines to recount');
    const lines = count.lines.map((line, i) => (indexes.has(i) ? { ...line, countedQty: null, variance: null, countedBy: '', countedAt: null, recount: true } : line));
    res.json(enrich(db.update('cycleCounts', count.id, { status: 'counting', lines }, actorContext(req))));
  }));

  router.post('/counts/:id/cancel', requirePermission('inventory.write'), route((req, res) => {
    const count = db.getOrFail('cycleCounts', req.params.id);
    if (count.status === 'closed') throw new HttpError(409, 'A posted count cannot be cancelled');
    res.json(enrich(db.update('cycleCounts', count.id, { status: 'cancelled', closedBy: req.user.id, closedAt: new Date().toISOString() }, actorContext(req))));
  }));

  /**
   * Post the sheet: every counted line whose count differs from the lot's current
   * book quantity becomes a count transaction, so the ledger explains each
   * change and the lot lands on what was physically there.
   */
  router.post('/counts/:id/post', requirePermission('inventory.write'), route((req, res) => {
    const ctx = actorContext(req);
    const result = db.transaction((tx) => {
      const count = tx.getOrFail('cycleCounts', req.params.id);
      if (count.status === 'closed') throw new HttpError(409, 'This cycle count is already posted');
      if (count.status === 'cancelled') throw new HttpError(409, 'This cycle count was cancelled');
      const { lines: checked } = summarise(count);
      const blocking = checked.filter((l) => l.outOfTolerance && !l.recount && !req.body?.acceptOutOfTolerance);
      if (blocking.length) throw new HttpError(422, `${blocking.length} line${blocking.length === 1 ? ' is' : 's are'} outside the ${count.tolerancePct ?? 2}% tolerance — recount them, or post with the variances accepted`);

      let postedValue = 0;
      let postedLines = 0;
      const now = new Date().toISOString();
      const lines = count.lines.map((line) => {
        if (line.countedQty === null || line.countedQty === undefined) return line;
        const lot = tx.get('lots', line.lotId);
        if (!lot) return line;
        const delta = Number((line.countedQty - lot.qtyOnHand).toFixed(4));
        if (delta === 0) return { ...line, posted: true, postedDelta: 0 };
        tx.insert('inventoryTxns', {
          txnNumber: tx.nextSequence('TXN', 'T-{n:6}'),
          type: 'count',
          itemId: lot.itemId,
          lotId: lot.id,
          qty: delta,
          uom: lot.uom,
          toLocationId: lot.locationId,
          refType: 'cycleCount',
          refId: count.id,
          reason: `Cycle count ${count.countNumber}${line.note ? ` — ${line.note}` : ''}`,
          unitCost: lot.unitCost,
          balanceAfter: line.countedQty,
          performedAt: now,
        }, ctx);
        tx.update('lots', lot.id, { qtyOnHand: line.countedQty }, ctx);
        postedValue += delta * (lot.unitCost || 0);
        postedLines += 1;
        return { ...line, posted: true, postedDelta: delta };
      });
      return tx.update('cycleCounts', count.id, {
        status: 'closed',
        lines,
        closedBy: req.user.id,
        closedAt: now,
        postedValue: Number(postedValue.toFixed(2)),
        postedLines,
      }, ctx);
    }, ctx);

    logActivity(db, req, {
      type: 'inventory',
      title: `Cycle count ${result.countNumber} posted`,
      detail: `${result.postedLines} lot${result.postedLines === 1 ? '' : 's'} adjusted · net ${result.postedValue < 0 ? '−' : ''}$${Math.abs(result.postedValue).toFixed(2)}`,
      tone: 'info',
      refType: 'cycleCount',
      refId: result.id,
      link: `/inventory/counts/${result.id}`,
    });
    res.json(enrich(result));
  }));

  /** Lot genealogy: which work orders consumed this lot, and which customers received them. */
  router.get('/lots/:id/trace', route((req, res) => {
    const lot = db.getOrFail('lots', req.params.id);
    const item = db.get('items', lot.itemId);
    const issues = db.find('inventoryTxns', { lotId: lot.id, type: 'issue' });
    const workOrders = issues
      .map((t) => db.get('workOrders', t.refId))
      .filter(Boolean)
      .map((wo) => ({
        id: wo.id, woNumber: wo.woNumber, batchNumber: wo.batchNumber, stage: wo.stage,
        productName: wo.productName, customerId: wo.customerId, actualQty: wo.actualQty,
        salesOrderId: wo.salesOrderId,
      }));
    const salesOrders = [...new Set(workOrders.map((w) => w.salesOrderId).filter(Boolean))]
      .map((id) => db.get('salesOrders', id))
      .filter(Boolean);
    const shipments = salesOrders.flatMap((so) => db.find('shipments', { salesOrderId: so.id }));

    res.json({
      lot,
      item,
      vendor: lot.vendorId ? db.get('vendors', lot.vendorId) : null,
      purchaseOrder: lot.purchaseOrderId ? db.get('purchaseOrders', lot.purchaseOrderId) : null,
      transactions: db.find('inventoryTxns', { lotId: lot.id }, { sort: 'performedAt' }),
      workOrders,
      salesOrders,
      shipments,
      customers: [...new Set(salesOrders.map((s) => s.customerId))].map((id) => db.get('customers', id)).filter(Boolean),
    });
  }));

  return router;
}
