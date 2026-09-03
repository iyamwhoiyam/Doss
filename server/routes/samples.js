/**
 * Sample tracking: samples sent to customers and labs, from request through to
 * the customer's verdict.
 *
 * The board is the primary view — moving a card advances its status and stamps
 * the matching date (shipped, delivered, responded), the same pattern the
 * production floor uses.
 */

import { Router } from 'express';

import { SAMPLE_STATUS, enumValues } from '../../shared/domain.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, requireFields, num } from '../lib/http.js';
import { logActivity, notify } from '../lib/events.js';
import { orderBetween } from './production.js';

const STATUS = enumValues(SAMPLE_STATUS);

export function samplesRouter(db) {
  const router = Router();

  /** The board, grouped by status. */
  router.get('/board', route((req, res) => {
    const where = {};
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.type) where.type = String(req.query.type);
    const all = db.find('samples', Object.keys(where).length ? where : undefined, { sort: 'boardOrder' });
    const columns = SAMPLE_STATUS.map((stage) => {
      const cards = all.filter((s) => s.status === stage.value);
      return { ...stage, count: cards.length, cards };
    });
    res.json({ columns, total: all.length });
  }));

  /** Log a new sample, minting its number. */
  router.post('/', requirePermission('samples.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['productName']);
    const ctx = actorContext(req);
    const now = new Date().toISOString();
    const sample = db.insert('samples', {
      sampleNumber: db.nextSequence('SAMPLE', 'S-{yyyy}-{n:4}'),
      type: req.body.type ?? 'customer',
      status: 'requested',
      productName: req.body.productName,
      projectId: req.body.projectId ?? '',
      customerId: req.body.customerId ?? '',
      formulaId: req.body.formulaId ?? '',
      lotId: req.body.lotId ?? '',
      lotNumber: req.body.lotNumber ?? '',
      quantity: num(req.body.quantity, 1),
      uom: req.body.uom ?? 'ea',
      recipientName: req.body.recipientName ?? '',
      recipientCompany: req.body.recipientCompany ?? '',
      shipTo: req.body.shipTo ?? '',
      requestedById: req.user.id,
      ownerId: req.body.ownerId ?? req.user.id,
      requestedAt: now,
      boardOrder: 1000,
      stageEnteredAt: now,
      notes: req.body.notes ?? '',
      tags: [],
    }, ctx);
    logActivity(db, req, {
      type: 'sample', title: `${sample.sampleNumber} requested`, detail: sample.productName,
      tone: 'accent', refType: 'sample', refId: sample.id, link: '/samples',
    });
    res.status(201).json(sample);
  }));

  /** Move a card: change status (with the right date stamp) and/or reorder. */
  router.post('/:id/move', requirePermission('samples.write'), route((req, res) => {
    const { status, beforeOrder, afterOrder } = req.body ?? {};
    const sample = db.getOrFail('samples', req.params.id);
    if (status && !STATUS.includes(status)) throw new HttpError(422, `"${status}" is not a sample status`);

    const patch = { boardOrder: orderBetween(beforeOrder ?? null, afterOrder ?? null) };
    const now = new Date().toISOString();
    if (status && status !== sample.status) {
      patch.status = status;
      patch.stageEnteredAt = now;
      if (status === 'shipped' && !sample.shippedAt) patch.shippedAt = now;
      if (status === 'delivered' && !sample.deliveredAt) patch.deliveredAt = now;
      if (status === 'reviewing' && !sample.dueBy) {
        patch.dueBy = new Date(Date.now() + 14 * 86_400_000).toISOString();
      }
      if (status === 'approved' || status === 'rejected') {
        patch.respondedAt = now;
        patch.outcome = status === 'approved' ? 'approved' : 'changes';
      }
    }
    const updated = db.update('samples', sample.id, patch, actorContext(req));
    if (patch.status) {
      logActivity(db, req, {
        type: 'sample',
        title: `${sample.sampleNumber} → ${SAMPLE_STATUS.find((s) => s.value === patch.status)?.label ?? patch.status}`,
        detail: sample.productName,
        tone: patch.status === 'approved' ? 'success' : patch.status === 'rejected' ? 'danger' : 'progress',
        refType: 'sample', refId: sample.id, link: '/samples',
      });
      if ((patch.status === 'approved' || patch.status === 'rejected') && sample.ownerId) {
        notify(db, sample.ownerId, {
          title: `${sample.sampleNumber} ${patch.status === 'approved' ? 'approved' : 'needs changes'}`,
          body: sample.productName,
          link: '/samples',
          severity: patch.status === 'approved' ? 'success' : 'warning',
        });
      }
    }
    res.json(updated);
  }));

  /** Record the customer's verdict and feedback. */
  router.post('/:id/feedback', requirePermission('samples.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['outcome']);
    const outcome = req.body.outcome;
    if (!['approved', 'changes', 'rejected'].includes(outcome)) throw new HttpError(422, 'Outcome is approved, changes or rejected');
    const sample = db.getOrFail('samples', req.params.id);
    const status = outcome === 'approved' ? 'approved' : 'rejected';
    const updated = db.update('samples', sample.id, {
      outcome, feedback: req.body.feedback ?? sample.feedback,
      status, respondedAt: new Date().toISOString(), stageEnteredAt: new Date().toISOString(),
    }, actorContext(req));
    logActivity(db, req, {
      type: 'sample', title: `${sample.sampleNumber} feedback: ${outcome}`, detail: req.body.feedback ?? sample.productName,
      tone: outcome === 'approved' ? 'success' : 'warning', refType: 'sample', refId: sample.id, link: '/samples',
    });
    res.json(updated);
  }));

  return router;
}
