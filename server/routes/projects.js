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
