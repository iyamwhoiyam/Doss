/**
 * Vendor supply: purchase order lifecycle, receiving against a PO, vendor
 * scorecards and the reorder suggestion engine.
 */

import { Router } from 'express';

import { VENDOR_STATUS, labelOf } from '../../shared/domain.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, num, requireFields } from '../lib/http.js';
import { logActivity, notifyRole } from '../lib/events.js';
import { itemPosition } from './inventory.js';

const DAY = 86400000;

function totals(lines, freight = 0, tax = 0) {
  const subtotal = Number((lines ?? []).reduce((sum, l) => sum + num(l.qty) * num(l.unitCost), 0).toFixed(2));
  return { subtotal, freight: num(freight), tax: num(tax), total: Number((subtotal + num(freight) + num(tax)).toFixed(2)) };
}

export function purchasingRouter(db) {
  const router = Router();

  /** What needs ordering, and from whom — driven by live stock positions. */
  router.get('/reorder-suggestions', route((_req, res) => {
    const rows = [];
    for (const item of db.find('items', { active: true })) {
      const position = itemPosition(db, item);
      const belowReorder = item.reorderPoint > 0 && position.released <= item.reorderPoint;
      if (!belowReorder) continue;
      const covered = position.onOrder >= (item.reorderQty || 0);
      const vendor = item.defaultVendorId ? db.get('vendors', item.defaultVendorId) : null;
      rows.push({
        itemId: item.id,
        itemCode: item.itemCode,
        name: item.name,
        uom: item.uom,
        released: position.released,
        onHand: position.onHand,
        onOrder: position.onOrder,
        reorderPoint: item.reorderPoint,
        suggestedQty: Math.max(0, (item.reorderQty || 0) - position.onOrder),
        unitCost: item.costPerUom,
        estimatedCost: Number((Math.max(0, (item.reorderQty || 0) - position.onOrder) * (item.costPerUom || 0)).toFixed(2)),
        leadTimeDays: item.leadTimeDays || vendor?.leadTimeDays || 21,
        vendorId: vendor?.id ?? '',
        vendorName: vendor?.name ?? 'No preferred vendor',
        vendorStatus: vendor?.status ?? 'pending',
        covered,
        severity: position.released <= (item.safetyStock || 0) ? 'danger' : 'warning',
      });
    }
    rows.sort((a, b) => (a.severity === b.severity ? b.estimatedCost - a.estimatedCost : a.severity === 'danger' ? -1 : 1));
    res.json({ rows, total: rows.length, estimatedSpend: Number(rows.reduce((s, r) => s + (r.covered ? 0 : r.estimatedCost), 0).toFixed(2)) });
  }));

  /** Draft one PO per vendor from a set of suggested item lines. */
  router.post('/draft-from-suggestions', requirePermission('po.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['itemIds']);
    const ctx = actorContext(req);
    const created = db.transaction((tx) => {
      const byVendor = new Map();
      for (const itemId of req.body.itemIds) {
        const item = tx.getOrFail('items', itemId);
        const vendorId = item.defaultVendorId;
        if (!vendorId) throw new HttpError(422, `${item.name} has no preferred vendor — set one before drafting a purchase order`);
        const position = itemPosition(db, item);
        const qty = Math.max(0, (item.reorderQty || 0) - position.onOrder);
        if (qty <= 0) continue;
        if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
        byVendor.get(vendorId).push({
          itemId: item.id, itemCode: item.itemCode, description: item.name,
          qty, uom: item.uom, unitCost: item.costPerUom, received: 0,
          expectedDate: new Date(Date.now() + (item.leadTimeDays || 21) * DAY).toISOString().slice(0, 10),
          lotIds: [],
        });
      }
      if (!byVendor.size) throw new HttpError(422, 'Nothing to order — every selected item is already covered by an open purchase order');

      return [...byVendor.entries()].map(([vendorId, lines]) => {
        const vendor = tx.getOrFail('vendors', vendorId);
        if (vendor.status === 'disqualified') throw new HttpError(409, `${vendor.name} is disqualified — no purchase order can be raised against it`);
        return tx.insert('purchaseOrders', {
          poNumber: tx.nextSequence('PO', 'PO-{yyyy}-{n:4}'),
          vendorId,
          status: 'draft',
          buyerId: vendor.buyerId || req.user.id,
          lines,
          ...totals(lines),
          currency: 'USD',
          expectedAt: new Date(Date.now() + (vendor.leadTimeDays || 21) * DAY).toISOString(),
          terms: vendor.paymentTerms,
          shipTo: db.findOne('settings', { key: 'company.address' })?.value ?? '',
          notes: 'Drafted from reorder suggestions.',
        }, ctx);
      });
    }, ctx);
    res.status(201).json({ created, count: created.length });
  }));

  /** Recalculate totals whenever lines change — never trust a client-side sum. */
  router.patch('/:id/lines', requirePermission('po.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['lines']);
    const po = db.getOrFail('purchaseOrders', req.params.id);
    if (['received', 'closed', 'cancelled'].includes(po.status)) {
      throw new HttpError(409, `A ${po.status} purchase order cannot be edited`);
    }
    const lines = req.body.lines.map((l) => ({ ...l, qty: num(l.qty), unitCost: num(l.unitCost), received: num(l.received) }));
    res.json(db.update('purchaseOrders', po.id, {
      lines,
      ...totals(lines, req.body.freight ?? po.freight, req.body.tax ?? po.tax),
    }, actorContext(req)));
  }));

  router.post('/:id/submit', requirePermission('po.write'), route((req, res) => {
    const po = db.getOrFail('purchaseOrders', req.params.id);
    if (po.status !== 'draft') throw new HttpError(409, `This purchase order is already ${po.status.replace('_', ' ')}`);
    if (!po.lines?.length) throw new HttpError(422, 'Add at least one line before submitting for approval');
    const updated = db.update('purchaseOrders', po.id, { status: 'pending_approval' }, actorContext(req));
    notifyRole(db, 'purchasing', { title: `${po.poNumber} needs approval`, body: `$${po.total.toLocaleString()} to ${db.get('vendors', po.vendorId)?.name}`, link: `/purchasing/${po.id}`, severity: 'info' });
    res.json(updated);
  }));

  router.post('/:id/approve', requirePermission('po.approve'), route((req, res) => {
    const po = db.getOrFail('purchaseOrders', req.params.id);
    if (!['draft', 'pending_approval'].includes(po.status)) throw new HttpError(409, `This purchase order is already ${po.status.replace('_', ' ')}`);
    const vendor = db.getOrFail('vendors', po.vendorId);
    if (vendor.status !== 'approved' && !req.body?.overrideReason) {
      throw new HttpError(409, `${vendor.name} is ${labelOf(VENDOR_STATUS, vendor.status).toLowerCase()} — approving a purchase order against an unqualified vendor needs a written override reason.`);
    }
    const updated = db.update('purchaseOrders', po.id, {
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: new Date().toISOString(),
      notes: req.body?.overrideReason ? `${po.notes}\n\nApproved against an unqualified vendor: ${req.body.overrideReason}`.trim() : po.notes,
    }, actorContext(req));
    logActivity(db, req, {
      type: 'purchase_order', title: `${po.poNumber} approved`, detail: `${vendor.name} · $${po.total.toLocaleString()}`,
      tone: 'success', refType: 'purchaseOrder', refId: po.id, link: `/purchasing/${po.id}`,
    });
    res.json(updated);
  }));

  router.post('/:id/send', requirePermission('po.write'), route((req, res) => {
    const po = db.getOrFail('purchaseOrders', req.params.id);
    if (po.status !== 'approved') throw new HttpError(409, 'A purchase order is approved before it is sent to the vendor');
    const updated = db.update('purchaseOrders', po.id, { status: 'sent', orderedAt: new Date().toISOString() }, actorContext(req));
    logActivity(db, req, {
      type: 'purchase_order', title: `${po.poNumber} sent to vendor`, detail: db.get('vendors', po.vendorId)?.name ?? '',
      tone: 'progress', refType: 'purchaseOrder', refId: po.id, link: `/purchasing/${po.id}`,
    });
    res.json(updated);
  }));

  router.post('/:id/cancel', requirePermission('po.approve'), route((req, res) => {
    requireFields(req.body ?? {}, ['reason']);
    const po = db.getOrFail('purchaseOrders', req.params.id);
    if (['received', 'closed'].includes(po.status)) throw new HttpError(409, 'That purchase order has already been received');
    res.json(db.update('purchaseOrders', po.id, {
      status: 'cancelled',
      notes: `${po.notes}\n\nCancelled by ${req.user.name}: ${req.body.reason}`.trim(),
    }, actorContext(req)));
  }));

  /** Vendor scorecard built from the actual receipt history. */
  router.get('/vendors/:id/scorecard', route((req, res) => {
    const vendor = db.getOrFail('vendors', req.params.id);
    const orders = db.find('purchaseOrders', { vendorId: vendor.id });
    const received = orders.filter((po) => ['received', 'partial', 'closed'].includes(po.status));
    const onTime = received.filter((po) => po.receivedAt && po.expectedAt && Date.parse(po.receivedAt) <= Date.parse(po.expectedAt));
    const lots = db.find('lots', { vendorId: vendor.id });
    const rejected = lots.filter((l) => l.status === 'rejected');
    const missingCoa = lots.filter((l) => !l.coaReceived && l.status !== 'rejected');
    const qualification = vendor.qualification ?? {};
    const qualExpiry = qualification.expiresAt ? Math.round((Date.parse(qualification.expiresAt) - Date.now()) / DAY) : null;

    res.json({
      vendor,
      orders: { total: orders.length, open: orders.filter((po) => ['approved', 'sent', 'partial'].includes(po.status)).length, spend: Number(orders.reduce((s, po) => s + (po.total || 0), 0).toFixed(2)) },
      delivery: { received: received.length, onTime: onTime.length, onTimePct: received.length ? Math.round((onTime.length / received.length) * 100) : null },
      quality: { lots: lots.length, rejected: rejected.length, rejectRatePct: lots.length ? Number(((rejected.length / lots.length) * 100).toFixed(1)) : 0, missingCoa: missingCoa.length },
      qualification: {
        ...qualification,
        daysUntilExpiry: qualExpiry,
        state: qualExpiry === null ? 'unknown' : qualExpiry < 0 ? 'expired' : qualExpiry < 60 ? 'expiring' : 'current',
      },
      items: db.find('items', { defaultVendorId: vendor.id }, { select: ['itemCode', 'name', 'uom', 'costPerUom'] }),
      recentOrders: db.find('purchaseOrders', { vendorId: vendor.id }, { sort: '-createdAt', limit: 10 }),
    });
  }));

  return router;
}
