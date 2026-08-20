/**
 * Production floor: work orders, the drag-and-drop stage board, batch steps,
 * material issue and QA release.
 *
 * The board is the primary interface, so stage moves are a first-class endpoint
 * rather than a generic patch: moving a card has consequences (materials get
 * issued, stock gets consumed, a batch record gets signed) and those must happen
 * inside one transaction that either lands completely or not at all.
 */

import { Router } from 'express';

import { WORK_ORDER_STAGES, can, enumValues } from '../../shared/domain.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, num, requireFields } from '../lib/http.js';
import { logActivity, notify } from '../lib/events.js';

const STAGE_ORDER = enumValues(WORK_ORDER_STAGES);

/** Sequential order value that drops a card between two neighbours. */
export function orderBetween(before, after) {
  if (before == null && after == null) return 1000;
  if (before == null) return after - 100;
  if (after == null) return before + 100;
  return (before + after) / 2;
}

export function productionRouter(db) {
  const router = Router();

  // -- the board --
  router.get('/board', route((req, res) => {
    const where = {};
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.line) where.line = String(req.query.line);
    if (req.query.supervisorId) where.supervisorId = String(req.query.supervisorId);

    const all = db.find('workOrders', Object.keys(where).length ? where : undefined, { sort: 'boardOrder' });
    const columns = WORK_ORDER_STAGES.map((stage) => {
      const cards = all.filter((wo) => wo.stage === stage.value);
      return {
        ...stage,
        count: cards.length,
        overWip: Boolean(stage.wipLimit && cards.length > stage.wipLimit),
        plannedUnits: cards.reduce((sum, wo) => sum + (wo.plannedQty || 0), 0),
        cards,
      };
    });
    res.json({
      columns,
      cancelled: all.filter((wo) => wo.stage === 'cancelled').length,
      total: all.length,
    });
  }));

  /**
   * Move a card. Handles both a stage change and a reorder inside a column, and
   * applies the side effects each stage transition carries.
   */
  router.post('/:id/move', requirePermission('production.write'), route((req, res) => {
    const { stage, beforeOrder, afterOrder } = req.body ?? {};
    const wo = db.getOrFail('workOrders', req.params.id);
    const ctx = actorContext(req);

    if (stage && !STAGE_ORDER.includes(stage) && stage !== 'cancelled') {
      throw new HttpError(422, `"${stage}" is not a production stage`);
    }

    const patch = { boardOrder: orderBetween(beforeOrder ?? null, afterOrder ?? null) };
    if (stage && stage !== wo.stage) {
      patch.stage = stage;
      patch.stageEnteredAt = new Date().toISOString();

      // Guard rails that exist on the floor, enforced here rather than by convention.
      if (stage === 'in_process') {
        const unissued = wo.materials.filter((m) => !m.issuedQty);
        if (unissued.length) {
          throw new HttpError(409, `${unissued.length} material${unissued.length > 1 ? 's have' : ' has'} not been issued yet: ${unissued.slice(0, 3).map((m) => m.name).join(', ')}. Stage the batch before starting the run.`);
        }
        if (!wo.actualStart) patch.actualStart = new Date().toISOString();
      }
      if (stage === 'complete') {
        if (!can(req.user.role, 'production.release')) {
          throw new HttpError(403, 'Only QA or operations can release a batch to finished goods');
        }
        const openDeviations = (wo.deviations ?? []).filter((d) => d.status === 'open');
        if (openDeviations.length) {
          throw new HttpError(409, `This batch has ${openDeviations.length} open deviation${openDeviations.length > 1 ? 's' : ''}. Close them before release.`);
        }
        const unfinished = (wo.steps ?? []).filter((s) => !s.done);
        if (unfinished.length) {
          throw new HttpError(409, `${unfinished.length} batch step${unfinished.length > 1 ? 's are' : ' is'} not signed off: ${unfinished.slice(0, 3).map((s) => s.name).join(', ')}.`);
        }
        patch.actualEnd = new Date().toISOString();
        patch.releasedBy = req.user.id;
        patch.releasedAt = new Date().toISOString();
        if (wo.actualQty && wo.plannedQty) patch.yieldPct = Number(((wo.actualQty / wo.plannedQty) * 100).toFixed(1));
      }
      if (stage === 'qc_hold' && !req.body.holdReason && !wo.holdReason) {
        throw new HttpError(422, 'A QC hold needs a reason so the floor knows what it is waiting on');
      }
      if (req.body.holdReason !== undefined) patch.holdReason = req.body.holdReason;
      if (stage !== 'qc_hold') patch.holdReason = '';
    }

    const updated = db.update('workOrders', wo.id, patch, ctx);
    if (patch.stage) {
      logActivity(db, req, {
        type: 'work_order',
        title: `${wo.woNumber} moved to ${WORK_ORDER_STAGES.find((s) => s.value === patch.stage)?.label ?? patch.stage}`,
        detail: wo.productName,
        tone: patch.stage === 'qc_hold' ? 'warning' : patch.stage === 'complete' ? 'success' : 'progress',
        refType: 'workOrder',
        refId: wo.id,
        link: `/production/${wo.id}`,
      });
      if (patch.stage === 'qc_hold') {
        for (const user of db.find('users', { role: 'quality', active: true })) {
          notify(db, user.id, {
            title: `${wo.woNumber} is on QC hold`,
            body: patch.holdReason || wo.holdReason || 'Awaiting quality disposition.',
            link: `/production/${wo.id}`,
            severity: 'warning',
          });
        }
      }
    }
    res.json(updated);
  }));

  // -- batch steps --
  router.post('/:id/steps/:index', requirePermission('production.write'), route((req, res) => {
    const wo = db.getOrFail('workOrders', req.params.id);
    const index = num(req.params.index, -1);
    const step = wo.steps?.[index];
    if (!step) throw new HttpError(404, 'That batch step does not exist');

    const done = req.body?.done ?? !step.done;
    const steps = wo.steps.map((s, i) => (i === index ? {
      ...s,
      done,
      doneBy: done ? req.user.id : '',
      doneAt: done ? new Date().toISOString() : null,
      notes: req.body?.notes ?? s.notes,
    } : s));
    res.json(db.update('workOrders', wo.id, { steps }, actorContext(req)));
  }));

  // -- QC checks --
  router.post('/:id/qc/:index', requirePermission('production.write'), route((req, res) => {
    const wo = db.getOrFail('workOrders', req.params.id);
    const index = num(req.params.index, -1);
    if (!wo.qcChecks?.[index]) throw new HttpError(404, 'That QC check does not exist');
    const { result, status } = req.body ?? {};
    if (status && !['pending', 'pass', 'fail'].includes(status)) throw new HttpError(422, 'A QC check is pending, pass or fail');

    const qcChecks = wo.qcChecks.map((c, i) => (i === index ? {
      ...c,
      result: result ?? c.result,
      status: status ?? c.status,
      checkedBy: req.user.id,
      checkedAt: new Date().toISOString(),
    } : c));

    const patch = { qcChecks };
    // A failed check pulls the batch onto QC hold rather than letting it run on.
    if (status === 'fail' && wo.stage !== 'qc_hold') {
      patch.stage = 'qc_hold';
      patch.stageEnteredAt = new Date().toISOString();
      patch.holdReason = `${qcChecks[index].name} failed: ${result ?? 'out of specification'}`;
    }
    const updated = db.update('workOrders', wo.id, patch, actorContext(req));
    if (patch.stage === 'qc_hold') {
      logActivity(db, req, {
        type: 'work_order',
        title: `${wo.woNumber} placed on QC hold`,
        detail: patch.holdReason,
        tone: 'warning',
        refType: 'workOrder',
        refId: wo.id,
        link: `/production/${wo.id}`,
      });
    }
    res.json(updated);
  }));

  // -- deviations --
  router.post('/:id/deviations', requirePermission('production.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['summary']);
    const wo = db.getOrFail('workOrders', req.params.id);
    const deviations = [...(wo.deviations ?? []), {
      id: `DEV-${String((wo.deviations?.length ?? 0) + 1).padStart(2, '0')}`,
      raisedBy: req.user.id,
      raisedAt: new Date().toISOString(),
      summary: req.body.summary,
      status: 'open',
      disposition: '',
    }];
    res.json(db.update('workOrders', wo.id, {
      deviations,
      stage: wo.stage === 'complete' ? wo.stage : 'qc_hold',
      holdReason: wo.stage === 'complete' ? wo.holdReason : req.body.summary,
    }, actorContext(req)));
  }));

  router.patch('/:id/deviations/:devId', requirePermission('production.release'), route((req, res) => {
    const wo = db.getOrFail('workOrders', req.params.id);
    const deviations = (wo.deviations ?? []).map((d) => (d.id === req.params.devId ? {
      ...d,
      status: req.body?.status ?? d.status,
      disposition: req.body?.disposition ?? d.disposition,
      closedBy: req.body?.status === 'closed' ? req.user.id : d.closedBy,
      closedAt: req.body?.status === 'closed' ? new Date().toISOString() : d.closedAt ?? null,
    } : d));
    res.json(db.update('workOrders', wo.id, { deviations }, actorContext(req)));
  }));

  /**
   * Issue a material line to the batch: draws the quantity from a specific lot,
   * writes the inventory transaction and stamps the batch record. All or nothing.
   */
  router.post('/:id/issue', requirePermission('production.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['index', 'lotId', 'qty']);
    const { index, lotId, qty } = req.body;
    const ctx = actorContext(req);

    const result = db.transaction((tx) => {
      const wo = tx.getOrFail('workOrders', req.params.id);
      const material = wo.materials?.[index];
      if (!material) throw new HttpError(404, 'That material line does not exist');

      const lot = tx.getOrFail('lots', lotId);
      if (lot.itemId !== material.itemId) throw new HttpError(422, 'That lot is not the item this line calls for');
      if (lot.status !== 'released') throw new HttpError(409, `Lot ${lot.lotNumber} is ${lot.status} — only released lots can be issued to production`);
      const amount = num(qty);
      if (amount <= 0) throw new HttpError(422, 'Issue quantity must be greater than zero');
      if (amount > lot.qtyOnHand) throw new HttpError(409, `Lot ${lot.lotNumber} has ${lot.qtyOnHand} ${lot.uom} on hand; you asked to issue ${amount}`);

      const remaining = Number((lot.qtyOnHand - amount).toFixed(4));
      tx.update('lots', lot.id, {
        qtyOnHand: remaining,
        status: remaining === 0 ? 'consumed' : lot.status,
      }, ctx);

      tx.insert('inventoryTxns', {
        txnNumber: tx.nextSequence('TXN', 'T-{n:6}'),
        type: 'issue',
        itemId: material.itemId,
        lotId: lot.id,
        qty: -amount,
        uom: lot.uom,
        fromLocationId: lot.locationId,
        refType: 'workOrder',
        refId: wo.id,
        reason: `Issued to ${wo.woNumber} — ${material.name}`,
        unitCost: lot.unitCost,
        balanceAfter: remaining,
        performedAt: new Date().toISOString(),
      }, ctx);

      const materials = wo.materials.map((m, i) => (i === index ? {
        ...m,
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        issuedQty: Number(((m.issuedQty ?? 0) + amount).toFixed(4)),
        issuedAt: new Date().toISOString(),
        issuedBy: req.user.id,
      } : m));
      return tx.update('workOrders', wo.id, { materials }, ctx);
    }, ctx);

    res.json(result);
  }));

  /** Record the actual output and post it to finished goods. */
  router.post('/:id/output', requirePermission('production.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['actualQty']);
    const ctx = actorContext(req);
    const result = db.transaction((tx) => {
      const wo = tx.getOrFail('workOrders', req.params.id);
      const actualQty = num(req.body.actualQty);
      const patch = {
        actualQty,
        yieldPct: wo.plannedQty ? Number(((actualQty / wo.plannedQty) * 100).toFixed(1)) : 0,
      };
      const fg = tx.findOne('locations', { code: 'FG-01' });
      tx.insert('inventoryTxns', {
        txnNumber: tx.nextSequence('TXN', 'T-{n:6}'),
        type: 'receipt',
        itemId: wo.formulaId,
        qty: actualQty,
        uom: wo.uom,
        toLocationId: fg?.id ?? '',
        refType: 'workOrder',
        refId: wo.id,
        reason: `Finished goods from ${wo.woNumber} batch ${wo.batchNumber}`,
        balanceAfter: actualQty,
        performedAt: new Date().toISOString(),
      }, ctx);
      return tx.update('workOrders', wo.id, patch, ctx);
    }, ctx);
    res.json(result);
  }));

  /** Create a work order straight from a formula, exploding its bill of materials. */
  router.post('/from-formula', requirePermission('production.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['formulaId', 'plannedQty']);
    const ctx = actorContext(req);

    const result = db.transaction((tx) => {
      const formula = tx.getOrFail('formulas', req.body.formulaId);
      const plannedQty = num(req.body.plannedQty);
      const overage = 1 + (formula.overagePct ?? 5) / 100;
      const servings = formula.servingsPerUnit || 1;

      const materials = [...formula.actives, ...formula.excipients]
        .filter((ing) => !ing.isBaseFill)
        .map((ing) => {
          const perServingMg = (ing.targetMg ?? ing.inputMg ?? 0) * (ing.inputMg != null ? 1 : overage);
          return {
            itemId: ing.itemId ?? '',
            itemCode: ing.code,
            name: ing.name,
            lotId: '',
            lotNumber: '',
            plannedQty: Number(((perServingMg * servings * plannedQty) / 1_000_000).toFixed(4)),
            issuedQty: 0,
            uom: 'kg',
            issuedAt: null,
            issuedBy: '',
          };
        });

      const steps = (req.body.steps ?? [
        'Sanitation verification', 'Dispensing / weighing', 'Blending', 'Blend uniformity sample',
        'Processing', 'In-process weight check', 'Bulk sampling', 'Packaging', 'Labelling', 'Case packing',
      ]).map((name) => ({ name, done: false, doneBy: '', doneAt: null, requiresSignature: /sampl|verif|check/i.test(name), notes: '' }));

      return tx.insert('workOrders', {
        woNumber: tx.nextSequence('WO', 'WO-{yyyy}-{n:4}'),
        batchNumber: tx.nextSequence('BATCH', 'B{yy}{n:4}'),
        stage: 'planned',
        priority: req.body.priority ?? 'normal',
        productName: formula.name,
        formulaId: formula.id,
        customerId: formula.customerId,
        salesOrderId: req.body.salesOrderId ?? '',
        line: req.body.line ?? '',
        plannedQty,
        uom: 'ea',
        plannedStart: req.body.plannedStart ?? null,
        plannedEnd: req.body.plannedEnd ?? null,
        supervisorId: req.body.supervisorId ?? req.user.id,
        materials,
        steps,
        qcChecks: [
          { name: 'Blend uniformity (RSD)', spec: '≤ 5.0%', result: '', status: 'pending', checkedBy: '', checkedAt: null },
          { name: 'Average weight', spec: '± 7.5% of target', result: '', status: 'pending', checkedBy: '', checkedAt: null },
          { name: 'Moisture', spec: '≤ 6.0%', result: '', status: 'pending', checkedBy: '', checkedAt: null },
          { name: 'Microbial (TPC)', spec: '≤ 3000 cfu/g', result: '', status: 'pending', checkedBy: '', checkedAt: null },
        ],
        boardOrder: 1000,
        stageEnteredAt: new Date().toISOString(),
        tags: [formula.format],
      }, ctx);
    }, ctx);

    logActivity(db, req, {
      type: 'work_order',
      title: `${result.woNumber} created`,
      detail: `${result.productName} · ${result.plannedQty.toLocaleString()} units`,
      tone: 'accent',
      refType: 'workOrder',
      refId: result.id,
      link: `/production/${result.id}`,
    });
    res.status(201).json(result);
  }));

  /** Material availability for a work order — what is short before staging starts. */
  router.get('/:id/availability', route((req, res) => {
    const wo = db.getOrFail('workOrders', req.params.id);
    const rows = (wo.materials ?? []).map((material) => {
      const lots = db.find('lots', { itemId: material.itemId, status: 'released' }, { sort: 'expiresAt' });
      const available = lots.reduce((sum, l) => sum + (l.qtyOnHand || 0), 0);
      const required = Math.max(0, (material.plannedQty ?? 0) - (material.issuedQty ?? 0));
      return {
        ...material,
        available: Number(available.toFixed(4)),
        required: Number(required.toFixed(4)),
        short: Number(Math.max(0, required - available).toFixed(4)),
        lots: lots.map((l) => ({ id: l.id, lotNumber: l.lotNumber, qtyOnHand: l.qtyOnHand, uom: l.uom, expiresAt: l.expiresAt, locationId: l.locationId })),
      };
    });
    res.json({ rows, shortCount: rows.filter((r) => r.short > 0).length });
  }));

  return router;
}
