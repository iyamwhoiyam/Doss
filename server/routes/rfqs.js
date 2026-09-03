/**
 * Quote requests (RFQ intake).
 *
 * The front door for new business: a request comes in, gets triaged on the
 * board, and — when it's worth pursuing — converts in one click into a project
 * and a draft formula, ready for the costing tools. The request then tracks
 * through to won or lost.
 */

import { Router } from 'express';

import { RFQ_STATUS, FORMULA_FORMATS, enumValues } from '../../shared/domain.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, requireFields, num } from '../lib/http.js';
import { logActivity } from '../lib/events.js';
import { orderBetween } from './production.js';

const STATUS = enumValues(RFQ_STATUS);
const FORMATS = enumValues(FORMULA_FORMATS);

export function rfqsRouter(db) {
  const router = Router();

  router.get('/board', route((req, res) => {
    const where = {};
    if (req.query.ownerId) where.ownerId = String(req.query.ownerId);
    const all = db.find('rfqs', Object.keys(where).length ? where : undefined, { sort: 'boardOrder' });
    const columns = RFQ_STATUS.map((stage) => {
      const cards = all.filter((r) => r.status === stage.value);
      return { ...stage, count: cards.length, cards };
    });
    res.json({ columns, total: all.length });
  }));

  /** Capture a new request. */
  router.post('/', requirePermission('quotes.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['productName']);
    const ctx = actorContext(req);
    const now = new Date().toISOString();
    const rfq = db.insert('rfqs', {
      rfqNumber: db.nextSequence('RFQ', 'R-{yyyy}-{n:4}'),
      status: 'new',
      productName: req.body.productName,
      customerId: req.body.customerId ?? '',
      customerName: req.body.customerName ?? '',
      contactName: req.body.contactName ?? '',
      contactEmail: req.body.contactEmail ?? '',
      source: req.body.source ?? 'email',
      format: req.body.format ?? '',
      servingSize: req.body.servingSize ?? '',
      desiredActives: req.body.desiredActives ?? '',
      targetQty: num(req.body.targetQty, 0),
      targetPrice: num(req.body.targetPrice, 0),
      priority: req.body.priority ?? 'normal',
      dueDate: req.body.dueDate ?? null,
      ownerId: req.body.ownerId ?? req.user.id,
      boardOrder: 1000,
      stageEnteredAt: now,
      notes: req.body.notes ?? '',
      tags: [],
    }, ctx);
    logActivity(db, req, {
      type: 'rfq', title: `${rfq.rfqNumber} — new quote request`, detail: `${rfq.productName}${rfq.customerName ? ` · ${rfq.customerName}` : ''}`,
      tone: 'accent', refType: 'rfq', refId: rfq.id, link: '/rfqs',
    });
    res.status(201).json(rfq);
  }));

  /** Move a card between pipeline columns. */
  router.post('/:id/move', requirePermission('quotes.write'), route((req, res) => {
    const { status, beforeOrder, afterOrder } = req.body ?? {};
    const rfq = db.getOrFail('rfqs', req.params.id);
    if (status && !STATUS.includes(status)) throw new HttpError(422, `"${status}" is not an RFQ status`);
    const patch = { boardOrder: orderBetween(beforeOrder ?? null, afterOrder ?? null) };
    if (status && status !== rfq.status) {
      patch.status = status;
      patch.stageEnteredAt = new Date().toISOString();
      if (status === 'won') patch.outcome = 'won';
      if (status === 'lost') { patch.outcome = 'lost'; if (req.body.lostReason) patch.lostReason = req.body.lostReason; }
    }
    const updated = db.update('rfqs', rfq.id, patch, actorContext(req));
    if (patch.status) {
      logActivity(db, req, {
        type: 'rfq', title: `${rfq.rfqNumber} → ${RFQ_STATUS.find((s) => s.value === patch.status)?.label ?? patch.status}`,
        detail: rfq.productName, tone: patch.status === 'won' ? 'success' : patch.status === 'lost' ? 'danger' : 'progress',
        refType: 'rfq', refId: rfq.id, link: '/rfqs',
      });
    }
    res.json(updated);
  }));

  /**
   * Turn a request into a project and a draft formula, linked both ways, and
   * move the request to Quoting. One click from "worth pursuing" to "ready to
   * cost".
   */
  router.post('/:id/convert', requirePermission('quotes.write'), route((req, res) => {
    const ctx = actorContext(req);
    const result = db.transaction((tx) => {
      const rfq = tx.getOrFail('rfqs', req.params.id);
      if (rfq.projectId) throw new HttpError(409, 'This request has already been converted to a project');

      const format = FORMATS.includes(rfq.format) ? rfq.format : undefined;
      const formula = tx.insert('formulas', {
        code: tx.nextSequence('FORMULA', 'F-{yyyy}-{n:4}'),
        name: rfq.productName,
        status: 'draft',
        customerId: rfq.customerId,
        ...(format ? { format } : {}),
        ...(rfq.servingSize ? { servingSize: rfq.servingSize } : {}),
        ownerId: rfq.ownerId || req.user.id,
        notes: rfq.desiredActives ? `Requested ingredients: ${rfq.desiredActives}` : '',
      }, ctx);

      const project = tx.insert('projects', {
        code: tx.nextSequence('PROJECT', 'P-{yyyy}-{n:4}'),
        name: rfq.productName,
        customerId: rfq.customerId,
        stage: 'intake',
        type: 'new_product',
        priority: rfq.priority ?? 'normal',
        ownerId: rfq.ownerId || req.user.id,
        formulaId: formula.id,
        format: format ?? '',
        targetLaunch: rfq.dueDate ?? null,
        brief: rfq.notes || `From quote request ${rfq.rfqNumber}.`,
        stageEnteredAt: new Date().toISOString(),
      }, ctx);

      tx.update('formulas', formula.id, { projectId: project.id }, ctx);
      const updatedRfq = tx.update('rfqs', rfq.id, {
        projectId: project.id, formulaId: formula.id,
        status: rfq.status === 'new' || rfq.status === 'reviewing' ? 'quoting' : rfq.status,
        stageEnteredAt: new Date().toISOString(),
      }, ctx);
      return { rfq: updatedRfq, project, formula };
    }, ctx);

    logActivity(db, req, {
      type: 'rfq', title: `${result.rfq.rfqNumber} converted to ${result.project.code}`,
      detail: `${result.project.name} — project and draft formula created`,
      tone: 'success', refType: 'project', refId: result.project.id, link: `/development/${result.project.id}`,
    });
    res.status(201).json(result);
  }));

  return router;
}
