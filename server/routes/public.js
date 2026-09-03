/**
 * The customer approval page — the one part of the platform that answers without
 * a login.
 *
 * A project awaiting approval has a single-use, unguessable token. That token is
 * the only credential: it exposes a redacted view of the product (the spec, the
 * label, and the sell price — never cost, margin or anything internal) and lets
 * the customer e-sign an approval, which locks the product, or request changes,
 * which returns it to development and pings the team.
 */

import { Router } from 'express';

import { HttpError } from '../lib/auth.js';
import { route, requireFields } from '../lib/http.js';
import { logActivity, notifyRole } from '../lib/events.js';
import { lockProduct } from './projects.js';

/** The customer-safe view of a product. Only sell-side numbers ever appear. */
function packageFor(db, project) {
  const customer = project.customerId ? db.get('customers', project.customerId) : null;
  const formula = project.formulaId ? db.get('formulas', project.formulaId) : null;
  const label = db.find('labelReviews', { projectId: project.id })[0]
    ?? (formula ? db.find('labelReviews', { formulaId: formula.id })[0] : null);
  const quote = project.quoteId
    ? db.get('quotes', project.quoteId)
    : db.find('quotes', { projectId: project.id })[0];

  const ingredients = formula
    ? [...(formula.actives ?? []), ...(formula.excipients ?? [])]
        .filter((i) => !i.isBaseFill)
        .map((i) => ({ name: i.labelName || i.name, amount: i.targetMg ?? i.inputMg ?? null, unit: 'mg' }))
    : [];

  // Only the sale price per tier — every cost/margin field is deliberately dropped.
  const tiers = (quote?.result?.tiers ?? []).map((t) => ({
    quantity: Number(t.qty),
    unitPrice: Number(t.salePricePerUnit),
  }));

  return {
    project: { id: project.id, name: project.name, code: project.code, revision: project.productRevision ?? 1 },
    customer: customer?.name ?? '',
    requestedAt: project.approvalRequestedAt ?? null,
    product: formula ? {
      name: formula.name,
      format: formula.format,
      servingSize: formula.servingSize,
      servingsPerUnit: formula.servingsPerUnit,
      ingredients,
      packaging: (formula.packaging ?? []).map((p) => p.name || p.labelName).filter(Boolean),
      allergens: formula.allergens ?? [],
      claims: formula.claims ?? [],
    } : null,
    label: label ? {
      productName: label.productName, brand: label.brand,
      revision: label.labelRevision, status: label.status,
    } : null,
    price: {
      currency: 'USD',
      leadTimeWeeks: quote?.leadTimeWeeks ?? null,
      paymentTerms: quote?.paymentTerms ?? '',
      tiers,
    },
  };
}

export function publicRouter(db) {
  const router = Router();

  const projectByToken = (token) => {
    const project = token ? db.findOne('projects', { approvalToken: token }) : null;
    if (!project || project.deletedAt || project.lockState !== 'pending_approval' || project.approvalToken !== token) {
      throw new HttpError(410, 'This approval link is no longer active. Please contact your Enova representative for a current link.');
    }
    return project;
  };

  /** The product the customer is being asked to approve. */
  router.get('/approval/:token', route((req, res) => {
    res.json(packageFor(db, projectByToken(req.params.token)));
  }));

  /** The customer's e-signature — approves and locks the product. */
  router.post('/approval/:token/approve', route((req, res) => {
    requireFields(req.body ?? {}, ['signedName', 'agree']);
    if (req.body.agree !== true) throw new HttpError(422, 'Please confirm your approval to continue.');
    const project = projectByToken(req.params.token);
    const signedName = String(req.body.signedName).trim();
    const actor = { user: { id: 'customer', name: signedName } };

    lockProduct(db, project, {
      decision: 'approved',
      method: 'customer-signature',
      signedName,
      signedTitle: String(req.body.signedTitle ?? '').trim(),
      note: String(req.body.note ?? '').trim(),
      ip: req.ip,
      byName: signedName,
    }, { actorId: 'customer', actorName: signedName });

    logActivity(db, actor, {
      type: 'project',
      title: `${project.name} approved by the customer`,
      detail: `Signed by ${signedName} — locked as the production-of-record`,
      tone: 'success',
      refType: 'project',
      refId: project.id,
      link: `/development/${project.id}`,
    });
    notifyRole(db, 'sales', {
      title: `${project.name} approved by the customer`,
      body: `Signed by ${signedName}. It is now locked as the production-of-record.`,
      link: `/development/${project.id}`,
      severity: 'success',
    });
    res.json({ ok: true, approvedAt: new Date().toISOString() });
  }));

  /** Not yet — the customer wants changes. Reopen and tell the team. */
  router.post('/approval/:token/request-changes', route((req, res) => {
    requireFields(req.body ?? {}, ['signedName', 'comment']);
    const project = projectByToken(req.params.token);
    const signedName = String(req.body.signedName).trim();
    const comment = String(req.body.comment).trim();
    const actor = { user: { id: 'customer', name: signedName } };

    db.update('projects', project.id, {
      lockState: 'open',
      approvalToken: '',
      approvalRequestedAt: null,
      approvalHistory: [...(project.approvalHistory ?? []), {
        decision: 'changes_requested', method: 'customer', signedName, note: comment,
        at: new Date().toISOString(), revision: project.productRevision ?? 1,
      }],
    }, { actorId: 'customer', actorName: signedName });

    logActivity(db, actor, {
      type: 'project',
      title: `${project.name}: customer requested changes`,
      detail: comment.slice(0, 160),
      tone: 'warning',
      refType: 'project',
      refId: project.id,
      link: `/development/${project.id}`,
    });
    for (const role of ['sales', 'rd']) {
      notifyRole(db, role, {
        title: `${project.name}: customer requested changes`,
        body: comment,
        link: `/development/${project.id}`,
        severity: 'warning',
      });
    }
    res.json({ ok: true });
  }));

  return router;
}
