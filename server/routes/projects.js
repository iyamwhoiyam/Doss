/**
 * Product change control for projects.
 *
 * A project is the production-of-record for its formula, label, packaging and
 * price. It moves through three lock states:
 *
 *   open → pending_approval → locked  (and, via a revision, back to open)
 *
 * While open, everything is editable. `request-approval` sends it to the
 * customer (and mints the link the customer will sign — Phase 3). Approval —
 * recorded here internally, or by the customer's signature — locks the product.
 * `revise` opens a new revision, leaving the approved one frozen in the history.
 */

import { randomBytes } from 'node:crypto';

import { Router } from 'express';

import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, requireFields } from '../lib/http.js';
import { logActivity, notifyRole } from '../lib/events.js';
import { productJourney } from '../calc/journey.js';

/**
 * Freeze a project as the customer-approved production-of-record. Shared by the
 * internal "record approval" action and (later) the customer's own signature.
 */
export function lockProduct(db, project, approval, ctx) {
  const stamped = { ...approval, revision: project.productRevision ?? 1, at: approval.at ?? new Date().toISOString() };
  return db.update('projects', project.id, {
    lockState: 'locked',
    approval: stamped,
    approvalHistory: [...(project.approvalHistory ?? []), stamped],
    approvalToken: '',
  }, ctx);
}

export function projectsRouter(db) {
  const router = Router();

  /** Send the product to the customer for sign-off, minting the approval link. */
  /**
   * Everything the project page shows besides the project itself, in one
   * round trip: the formulas, quotes, label reviews, batches, samples and
   * tasks that hang off it. One request instead of seven.
   */
  router.get('/:id/related', route((req, res) => {
    const project = db.getOrFail('projects', req.params.id);
    const list = (collection, where, sort) => {
      const rows = db.find(collection, where, sort ? { sort } : undefined);
      return { rows, total: rows.length };
    };
    // Quotes belong to the project directly, or through its formula (older quotes were only linked that way).
    const quoteRows = db.find('quotes').filter((q) => q.projectId === project.id || (project.formulaId && q.formulaId === project.formulaId));
    const quotes = { rows: quoteRows, total: quoteRows.length };
    const quoteIds = new Set(quoteRows.map((q) => q.id));
    const byDate = (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    const workOrders = db.find('workOrders').filter((wo) => wo.projectId === project.id || (project.formulaId && wo.formulaId === project.formulaId)).sort(byDate);
    const salesOrders = db.find('salesOrders').filter((so) => so.projectId === project.id || quoteIds.has(so.quoteId)).sort(byDate);
    const formula = project.formulaId ? db.get('formulas', project.formulaId) : null;
    res.json({
      formulas: list('formulas', { projectId: project.id }),
      quotes,
      labelReviews: list('labelReviews', { projectId: project.id }),
      workOrders: { rows: workOrders, total: workOrders.length },
      salesOrders: { rows: salesOrders, total: salesOrders.length },
      samples: list('samples', { projectId: project.id }, '-createdAt'),
      tasks: list('tasks', { refId: project.id }, 'boardOrder'),
      journey: productJourney(db, project),
      // The reference numbers everyone quotes on the phone, in one place.
      numbers: {
        project: project.code,
        formula: formula ? { id: formula.id, code: formula.code, revision: formula.revision } : null,
        quotes: quotes.rows.map((q) => ({ id: q.id, number: q.quoteNumber, status: q.status })),
        salesOrders: salesOrders.map((so) => ({ id: so.id, number: so.orderNumber, customerPo: so.customerPo, status: so.status })),
        workOrders: workOrders.map((wo) => ({ id: wo.id, number: wo.woNumber, batchNumber: wo.batchNumber, stage: wo.stage })),
      },
    });
  }));

  /**
   * Attach an existing order or batch to this project (or detach it). The
   * record's projectId is the link, so it shows up in the numbers, the journey
   * and every list that filters by project.
   */
  router.post('/:id/link', requirePermission('projects.write'), route((req, res) => {
    const project = db.getOrFail('projects', req.params.id);
    const { salesOrderId, workOrderId, detach = false } = req.body ?? {};
    const ctx = actorContext(req);
    if (!salesOrderId && !workOrderId) throw new HttpError(422, 'Pick an order or a batch to link');
    const changed = [];
    if (salesOrderId) {
      const so = db.getOrFail('salesOrders', salesOrderId);
      changed.push(db.update('salesOrders', so.id, { projectId: detach ? '' : project.id }, ctx).orderNumber);
    }
    if (workOrderId) {
      const wo = db.getOrFail('workOrders', workOrderId);
      changed.push(db.update('workOrders', wo.id, { projectId: detach ? '' : project.id }, ctx).woNumber);
    }
    logActivity(db, req, {
      type: 'project', title: `${changed.join(', ')} ${detach ? 'detached from' : 'linked to'} ${project.code}`, detail: project.name,
      tone: 'info', refType: 'project', refId: project.id, link: `/development/${project.id}`,
    });
    res.json({ ok: true, changed });
  }));

  router.post('/:id/request-approval', requirePermission('product.lock'), route((req, res) => {
    const project = db.getOrFail('projects', req.params.id);
    if (project.lockState === 'locked') throw new HttpError(409, 'This product is already customer-approved. Open a revision to change it first.');
    const ctx = actorContext(req);
    const token = randomBytes(24).toString('base64url');
    const updated = db.update('projects', project.id, {
      lockState: 'pending_approval',
      approvalToken: token,
      approvalRequestedAt: new Date().toISOString(),
    }, ctx);
    logActivity(db, req, {
      type: 'project',
      title: `${project.name} sent for customer approval`,
      detail: `Revision ${project.productRevision ?? 1}`,
      tone: 'progress',
      refType: 'project',
      refId: project.id,
      link: `/development/${project.id}`,
    });
    res.json({ ...updated, approvalLink: `/approve/${token}` });
  }));

  /** Retract an approval request, returning the product to development. */
  router.post('/:id/cancel-approval', requirePermission('product.lock'), route((req, res) => {
    const project = db.getOrFail('projects', req.params.id);
    if (project.lockState !== 'pending_approval') throw new HttpError(409, 'This product is not awaiting approval');
    res.json(db.update('projects', project.id, { lockState: 'open', approvalToken: '', approvalRequestedAt: null }, actorContext(req)));
  }));

  /**
   * Record the customer's approval internally (e.g. a signed sheet on file) and
   * lock the product. The customer-signs-in-app path (Phase 3) locks the same
   * way, through lockProduct().
   */
  router.post('/:id/record-approval', requirePermission('product.lock'), route((req, res) => {
    requireFields(req.body ?? {}, ['signedName']);
    const project = db.getOrFail('projects', req.params.id);
    if (project.lockState === 'locked') throw new HttpError(409, 'This product is already locked');
    const ctx = actorContext(req);
    const updated = lockProduct(db, project, {
      decision: 'approved',
      method: 'recorded',
      signedName: String(req.body.signedName).trim(),
      signedTitle: String(req.body.signedTitle ?? '').trim(),
      note: String(req.body.note ?? '').trim(),
      evidenceDocId: req.body.evidenceDocId ?? '',
      byUserId: req.user.id,
      byName: req.user.name,
    }, ctx);
    logActivity(db, req, {
      type: 'project',
      title: `${project.name} approved by customer`,
      detail: `Locked as production-of-record · revision ${project.productRevision ?? 1} · signed ${req.body.signedName}`,
      tone: 'success',
      refType: 'project',
      refId: project.id,
      link: `/development/${project.id}`,
    });
    res.json(updated);
  }));

  /** Open a new revision of a locked product, reopening it for editing. */
  router.post('/:id/revise', requirePermission('product.revise'), route((req, res) => {
    const project = db.getOrFail('projects', req.params.id);
    if (project.lockState === 'open') throw new HttpError(409, 'This product is already open for editing');
    const ctx = actorContext(req);
    const nextRevision = (project.productRevision ?? 1) + 1;
    const updated = db.update('projects', project.id, {
      lockState: 'open',
      productRevision: nextRevision,
      approval: {},
      approvalToken: '',
      approvalRequestedAt: null,
    }, ctx);
    logActivity(db, req, {
      type: 'project',
      title: `${project.name} — revision ${nextRevision} opened`,
      detail: req.body?.reason ? String(req.body.reason) : 'Reopened for changes after customer approval',
      tone: 'warning',
      refType: 'project',
      refId: project.id,
      link: `/development/${project.id}`,
    });
    notifyRole(db, 'quality', {
      title: `${project.name} reopened for revision ${nextRevision}`,
      body: 'The previously approved spec is frozen in the approval history.',
      link: `/development/${project.id}`,
      severity: 'info',
    });
    res.json(updated);
  }));

  return router;
}
