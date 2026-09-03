/**
 * Label review.
 *
 * A review at Enova is a signed quality record, not an opinion: two people put
 * their names on it and a customer's printed component is released against it.
 * These routes enforce that — a review cannot be approved while a finding is
 * undecided, and the person who approves cannot be the person who reviewed.
 */

import { Router } from 'express';

import { reviewLabel, generateSupplementFacts, renderSupplementFactsText, CHECKLIST, PANEL_LABELS } from '../calc/labelEngine.js';
import { DSHEA_DISCLAIMER } from '../calc/labelReference.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, requireFields } from '../lib/http.js';
import { logActivity, notify } from '../lib/events.js';
import { assertUnlocked } from '../lib/lock.js';

export function labelsRouter(db) {
  const router = Router();

  /** The blank checklist, for the UI to render before a review exists. */
  router.get('/checklist', route((_req, res) => {
    res.json({
      rows: CHECKLIST,
      panels: PANEL_LABELS,
      disclaimer: DSHEA_DISCLAIMER,
      categories: [...new Set(CHECKLIST.map((c) => c.cat))],
      evidenceBlocked: CHECKLIST.filter((c) => c.needs !== 'copy').length,
    });
  }));

  /** Run the engine over submitted copy without saving — the live preview. */
  router.post('/analyze', requirePermission('labels.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['panels']);
    const formula = req.body.formulaId ? db.get('formulas', req.body.formulaId) : null;
    res.json(reviewLabel({
      panels: req.body.panels,
      formula,
      source: req.body.source ?? 'text',
      ocr: req.body.ocr ?? null,
    }));
  }));

  /** Create a stored review from submitted copy. */
  router.post('/', requirePermission('labels.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['productName', 'panels']);
    const ctx = actorContext(req);
    const created = db.transaction((tx) => {
      const formula = req.body.formulaId ? tx.get('formulas', req.body.formulaId) : null;
      const result = reviewLabel({
        panels: req.body.panels,
        formula,
        source: req.body.source ?? 'text',
        ocr: req.body.ocr ?? null,
      });
      return tx.insert('labelReviews', {
        reviewNumber: tx.nextSequence('LABEL', 'L-{yyyy}-{n:3}'),
        productName: req.body.productName,
        brand: req.body.brand ?? result.parsed.brand ?? '',
        customerId: req.body.customerId ?? formula?.customerId ?? '',
        projectId: req.body.projectId ?? '',
        formulaId: req.body.formulaId ?? '',
        status: 'in_review',
        labelRevision: req.body.labelRevision ?? result.parsed.revisionMark?.text ?? '',
        source: req.body.source ?? 'text',
        receivedAt: new Date().toISOString(),
        panels: req.body.panels,
        checklist: result.checklist,
        findings: result.findings,
        supplementFacts: formula ? generateSupplementFacts(formula) : {},
        metrics: result.metrics,
        reviewerId: req.user.id,
        reviewedAt: new Date().toISOString(),
        notes: req.body.notes ?? '',
        tags: [],
      }, ctx);
    }, ctx);

    logActivity(db, req, {
      type: 'label_review',
      title: `${created.reviewNumber} opened — ${created.metrics.requiredCorrections} required correction${created.metrics.requiredCorrections === 1 ? '' : 's'}`,
      detail: `${created.brand} ${created.productName}`.trim(),
      tone: created.metrics.requiredCorrections ? 'warning' : 'success',
      refType: 'labelReview', refId: created.id, link: `/labels/${created.id}`,
    });
    res.status(201).json(created);
  }));

  /** Re-run the engine after the copy has been corrected. */
  router.post('/:id/rerun', requirePermission('labels.write'), route((req, res) => {
    assertUnlocked(db, 'labelReviews', req.params.id);
    const review = db.getOrFail('labelReviews', req.params.id);
    if (review.status === 'released') throw new HttpError(409, 'A released review is a closed record. Open a new revision instead.');

    const panels = req.body?.panels ?? review.panels;
    const formula = review.formulaId ? db.get('formulas', review.formulaId) : null;
    const result = reviewLabel({ panels, formula, source: req.body?.source ?? review.source, ocr: req.body?.ocr ?? null });

    // Decisions already taken on findings that still apply are carried forward,
    // so a re-run does not silently reset a reviewer's judgement.
    const previous = new Map((review.findings ?? []).map((f) => [`${f.rowId}::${f.issue}`, f]));
    const findings = result.findings.map((f) => {
      const prior = previous.get(`${f.rowId}::${f.issue}`);
      return prior ? { ...f, id: prior.id, decision: prior.decision, decidedBy: prior.decidedBy, decidedAt: prior.decidedAt } : f;
    });

    res.json(db.update('labelReviews', review.id, {
      panels,
      checklist: result.checklist,
      findings,
      metrics: result.metrics,
      reviewerId: req.user.id,
      reviewedAt: new Date().toISOString(),
      status: result.metrics.requiredCorrections ? 'corrections_requested' : 'in_review',
    }, actorContext(req)));
  }));

  /** A reviewer's judgement on a single checklist row. */
  router.post('/:id/checklist/:rowId', requirePermission('labels.write'), route((req, res) => {
    assertUnlocked(db, 'labelReviews', req.params.id);
    const review = db.getOrFail('labelReviews', req.params.id);
    const rowId = Number(req.params.rowId);
    const { state, comment } = req.body ?? {};
    if (state && !['pass', 'fail', 'not_reviewed', 'na'].includes(state)) {
      throw new HttpError(422, 'A checklist row is compliant, a required correction, not reviewed, or not applicable');
    }
    const row = (review.checklist ?? []).find((c) => c.id === rowId);
    if (!row) throw new HttpError(404, `Checklist row ${rowId} does not exist`);
    if (state === 'pass' && row.needs !== 'copy' && !comment) {
      throw new HttpError(422, `Row ${rowId} cannot be marked compliant without a comment recording the evidence — it is settled against the artwork or a separate file, not the copy.`);
    }

    const checklist = review.checklist.map((c) => (c.id === rowId
      ? { ...c, state: state ?? c.state, comment: comment ?? c.comment, decidedBy: req.user.id, decidedAt: new Date().toISOString() }
      : c));
    const tally = (s) => checklist.filter((c) => c.state === s).length;
    const metrics = {
      ...review.metrics,
      pass: tally('pass'),
      fail: tally('fail'),
      na: tally('na'),
      notReviewed: tally('not_reviewed'),
      reviewed: checklist.length - tally('not_reviewed'),
      completionPct: Math.round(((checklist.length - tally('not_reviewed')) / checklist.length) * 100),
    };
    res.json(db.update('labelReviews', review.id, { checklist, metrics }, actorContext(req)));
  }));

  /** Accept or deny a finding. Nothing is released until every finding has one. */
  router.post('/:id/findings/:findingId', requirePermission('labels.write'), route((req, res) => {
    assertUnlocked(db, 'labelReviews', req.params.id);
    requireFields(req.body ?? {}, ['decision']);
    const { decision, note, proposedWording } = req.body;
    if (!['pending', 'accepted', 'denied'].includes(decision)) throw new HttpError(422, 'A finding is pending, accepted or denied');
    if (decision === 'denied' && !note) throw new HttpError(422, 'Denying a finding needs a reason — the record has to say why the defect was not corrected');

    const review = db.getOrFail('labelReviews', req.params.id);
    const findings = (review.findings ?? []).map((f) => (f.id === req.params.findingId ? {
      ...f,
      decision,
      note: note ?? f.note ?? '',
      proposedWording: proposedWording ?? f.proposedWording,
      decidedBy: req.user.id,
      decidedAt: new Date().toISOString(),
    } : f));
    if (!findings.some((f) => f.id === req.params.findingId)) throw new HttpError(404, 'That finding does not exist');

    res.json(db.update('labelReviews', review.id, { findings }, actorContext(req)));
  }));

  /** Approve the review. Requires a second person and a decision on every finding. */
  router.post('/:id/approve', requirePermission('labels.approve'), route((req, res) => {
    assertUnlocked(db, 'labelReviews', req.params.id);
    const review = db.getOrFail('labelReviews', req.params.id);
    const undecided = (review.findings ?? []).filter((f) => f.decision === 'pending');
    if (undecided.length) {
      throw new HttpError(409, `${undecided.length} finding${undecided.length > 1 ? 's have' : ' has'} no decision yet. Every finding is accepted or denied before a label is approved.`);
    }
    if (review.reviewerId === req.user.id && !req.body?.soleReviewerReason) {
      throw new HttpError(409, 'A label review is signed by two people. Ask a second reviewer to approve, or record why you are signing both roles.');
    }
    const updated = db.update('labelReviews', review.id, {
      status: 'approved',
      approverId: req.user.id,
      approvedAt: new Date().toISOString(),
      notes: req.body?.soleReviewerReason
        ? `${review.notes}\n\nSigned by one reviewer: ${req.body.soleReviewerReason}`.trim()
        : review.notes,
    }, actorContext(req));

    logActivity(db, req, {
      type: 'label_review', title: `${review.reviewNumber} approved`, detail: `${review.brand} ${review.productName}`.trim(),
      tone: 'success', refType: 'labelReview', refId: review.id, link: `/labels/${review.id}`,
    });
    if (review.reviewerId && review.reviewerId !== req.user.id) {
      notify(db, review.reviewerId, { title: `${review.reviewNumber} approved`, body: `${req.user.name} signed off your review.`, link: `/labels/${review.id}`, severity: 'success' });
    }
    res.json(updated);
  }));

  /** Release the approved label as the final component of record. */
  router.post('/:id/release', requirePermission('labels.approve'), route((req, res) => {
    assertUnlocked(db, 'labelReviews', req.params.id);
    const review = db.getOrFail('labelReviews', req.params.id);
    if (review.status !== 'approved') throw new HttpError(409, 'Only an approved review can be released as the final label');
    res.json(db.update('labelReviews', review.id, { status: 'released' }, actorContext(req)));
  }));

  /** The corrected copy: accepted findings applied to the submitted panels. */
  router.get('/:id/corrected-proof', route((req, res) => {
    const review = db.getOrFail('labelReviews', req.params.id);
    const accepted = (review.findings ?? []).filter((f) => f.decision === 'accepted' && f.proposedWording);
    const panels = { ...review.panels };
    const applied = [];
    const manual = [];

    for (const finding of accepted) {
      let done = false;
      if (finding.evidence) {
        for (const [key, text] of Object.entries(panels)) {
          if (typeof text === 'string' && text.includes(finding.evidence)) {
            panels[key] = text.replace(finding.evidence, finding.proposedWording);
            applied.push({ ...finding, panel: key });
            done = true;
            break;
          }
        }
      }
      // Findings raised because something was absent have nothing to replace —
      // the printer adds them, so they are listed rather than silently dropped.
      if (!done) manual.push(finding);
    }

    res.json({
      reviewNumber: review.reviewNumber,
      productName: review.productName,
      panels,
      applied,
      manual,
      denied: (review.findings ?? []).filter((f) => f.decision === 'denied'),
      note: 'This is a proof, not artwork. The printer must make the same edits in the source file — label PDFs arrive with type outlined, so replacement copy here is set in a substitute face.',
    });
  }));

  /** Generate the compliant panel from the linked formula and attach it. */
  router.post('/:id/generate-panel', requirePermission('labels.write'), route((req, res) => {
    assertUnlocked(db, 'labelReviews', req.params.id);
    const review = db.getOrFail('labelReviews', req.params.id);
    if (!review.formulaId) throw new HttpError(409, 'Link a master formula to this review before generating a Supplement Facts panel');
    const formula = db.getOrFail('formulas', review.formulaId);
    const panel = generateSupplementFacts(formula);
    const updated = db.update('labelReviews', review.id, { supplementFacts: panel }, actorContext(req));
    res.json({ review: updated, panel, text: renderSupplementFactsText(panel) });
  }));

  return router;
}
