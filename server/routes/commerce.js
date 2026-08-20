/**
 * Formulations, the cost generator and quotes.
 *
 * The cost engine is the single source of truth for every number, so these
 * routes never do arithmetic — they assemble an engine input from stored records
 * and hand the result straight back. That is what keeps the on-screen cost
 * builder, the saved quote and any export in agreement.
 */

import { Router } from 'express';

import { buildQuote, buildFormula, runCompliance, defaultTiers, suggestLabour } from '../calc/quoteEngine.js';
import { generateSupplementFacts, renderSupplementFactsText } from '../calc/labelEngine.js';
import { QUOTE_DEFAULTS, FORMULA_FORMATS, overheadRateForQty } from '../../shared/domain.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, num, requireFields } from '../lib/http.js';
import { logActivity, notify } from '../lib/events.js';

/** Merge stored catalogue prices into a formula's ingredient lines. */
function withLivePricing(db, formula) {
  const price = (line) => {
    if (!line.itemId) return line;
    const item = db.get('items', line.itemId);
    if (!item) return line;
    return {
      ...line,
      pricePerKg: item.pricePerKg || line.pricePerKg,
      costPerUnit: item.type === 'packaging' ? item.costPerUom : line.costPerUnit,
      priceSource: item.priceSource || 'Enova price list',
      brandOwner: item.brandOwner || line.brandOwner,
      form: item.form || line.form,
    };
  };
  return {
    ...formula,
    actives: (formula.actives ?? []).map(price),
    excipients: (formula.excipients ?? []).map(price),
    packaging: (formula.packaging ?? []).map(price),
  };
}

export function commerceRouter(db) {
  const router = Router();
  const setting = (key, fallback) => db.findOne('settings', { key })?.value ?? fallback;

  // ── formulations ─────────────────────────────────────────────────────────

  /** Cost a formula that is already saved, at live catalogue prices. */
  router.get('/formulas/:id/cost', route((req, res) => {
    const formula = withLivePricing(db, db.getOrFail('formulas', req.params.id));
    const qty = num(req.query.qty, formula.unitsPerBatch || 10000);
    const built = buildQuote({
      formula,
      coaFee: num(setting('quote.coaFee', QUOTE_DEFAULTS.coaFee), 120),
      tiers: [{ qty, labor: suggestLabour(formula.format, qty), overheadRate: overheadRateForQty(qty), margin: null }],
      meta: { productName: formula.name, formulaCode: formula.code },
    });
    res.json({ formula, ...built, masterBidLoaded: Boolean(setting('quote.masterBidLoaded', false)) });
  }));

  /** Cost an unsaved formula — the live preview behind the formula builder. */
  router.post('/formulas/preview', route((req, res) => {
    requireFields(req.body ?? {}, ['formula']);
    const formula = withLivePricing(db, req.body.formula);
    const qty = num(req.body.qty, 10000);
    res.json(buildQuote({
      formula,
      coaFee: num(req.body.coaFee ?? setting('quote.coaFee', 120), 120),
      tiers: req.body.tiers ?? [{ qty, labor: suggestLabour(formula.format, qty), overheadRate: overheadRateForQty(qty), margin: null }],
      meta: { productName: formula.name ?? 'Untitled formula' },
    }));
  }));

  /** Compliance only — cheap enough to call on every keystroke in the builder. */
  router.post('/formulas/compliance', route((req, res) => {
    const formula = req.body?.formula ?? {};
    const built = buildFormula(formula);
    res.json(runCompliance(formula, {
      totalInputMg: built._internal.totalInputMg,
      totalNonBaseInputMg: built._internal.totalNonBaseInputMg,
      baseFillShortfall: built._internal.baseFillShortfall,
    }));
  }));

  /** Cut a new revision instead of editing an approved formula in place. */
  router.post('/formulas/:id/revise', requirePermission('formulas.write'), route((req, res) => {
    const ctx = actorContext(req);
    const created = db.transaction((tx) => {
      const source = tx.getOrFail('formulas', req.params.id);
      const { id, createdAt, updatedAt, version, deletedAt, code, ...rest } = source;
      const next = tx.insert('formulas', {
        ...rest,
        code: `${code.replace(/-r\d+$/i, '')}-r${(source.revision ?? 1) + 1}`,
        revision: (source.revision ?? 1) + 1,
        status: 'draft',
        supersedesId: source.id,
        approvedBy: '',
        approvedAt: null,
        notes: req.body?.notes ?? '',
      }, ctx);
      if (source.status === 'approved') tx.update('formulas', source.id, { status: 'superseded' }, ctx);
      return next;
    }, ctx);
    res.status(201).json(created);
  }));

  router.post('/formulas/:id/approve', requirePermission('formulas.approve'), route((req, res) => {
    const formula = withLivePricing(db, db.getOrFail('formulas', req.params.id));
    const built = buildFormula(formula);
    const compliance = runCompliance(formula, {
      totalInputMg: built._internal.totalInputMg,
      totalNonBaseInputMg: built._internal.totalNonBaseInputMg,
      baseFillShortfall: built._internal.baseFillShortfall,
    });
    if (compliance.worst === 'BLOCK' && !req.body?.overrideReason) {
      throw new HttpError(409, `This formula has ${compliance.flags.filter((f) => f.status === 'BLOCK').length} blocking compliance finding(s). Resolve them, or approve with a written override reason.`);
    }
    const updated = db.update('formulas', formula.id, {
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: new Date().toISOString(),
      notes: req.body?.overrideReason ? `${formula.notes}\n\nApproved over a blocking finding: ${req.body.overrideReason}` : formula.notes,
    }, actorContext(req));

    logActivity(db, req, {
      type: 'formula', title: `${formula.code} approved`, detail: formula.name,
      tone: 'success', refType: 'formula', refId: formula.id, link: `/formulations/${formula.id}`,
    });
    res.json({ formula: updated, compliance });
  }));

  /** Ingredient picker: catalogue search shaped for the formula builder. */
  router.get('/ingredients', route((req, res) => {
    const q = String(req.query.q ?? '').trim();
    const type = req.query.type ? String(req.query.type) : undefined;
    const where = { active: true };
    if (type) where.type = type;
    if (q) where.$search = { value: q, fields: ['name', 'itemCode', 'category', 'form', 'brandOwner'] };
    const rows = db.find('items', where, { sort: 'name', limit: num(req.query.limit, 60) });
    res.json({
      rows: rows.map((item) => ({
        id: item.id, itemCode: item.itemCode, name: item.name, type: item.type,
        category: item.category, form: item.form, uom: item.uom,
        pricePerKg: item.pricePerKg, costPerUom: item.costPerUom,
        priceSource: item.priceSource, isBranded: item.isBranded, brandOwner: item.brandOwner,
        allergens: item.allergens, labelName: item.labelName,
      })),
      total: rows.length,
    });
  }));

  // ── quotes ───────────────────────────────────────────────────────────────

  /** Price a quote without saving it — the live tier table in the cost generator. */
  router.post('/quotes/compute', requirePermission('quotes.write'), route((req, res) => {
    const formula = req.body?.formulaId
      ? withLivePricing(db, db.getOrFail('formulas', req.body.formulaId))
      : withLivePricing(db, req.body?.formula ?? {});
    const tiers = req.body?.tiers?.length ? req.body.tiers : defaultTiers(formula.format ?? 'capsule');
    const customer = req.body?.customerId ? db.get('customers', req.body.customerId) : null;

    res.json(buildQuote({
      formula,
      tiers,
      coaFee: num(req.body?.coaFee ?? setting('quote.coaFee', 120), 120),
      meta: {
        customer: customer?.name ?? '',
        productName: formula.name ?? '',
        formulaCode: formula.code ?? '',
        leadTimeWeeks: num(setting('quote.leadTimeWeeks', 8), 8),
        paymentTerms: setting('quote.paymentTerms', QUOTE_DEFAULTS.paymentTerms),
        masterBidLoaded: Boolean(setting('quote.masterBidLoaded', false)),
      },
    }));
  }));

  /** Create a quote from a formula, computing and storing the engine result. */
  router.post('/quotes', requirePermission('quotes.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['formulaId']);
    const ctx = actorContext(req);
    const created = db.transaction((tx) => {
      const formula = withLivePricing(db, tx.getOrFail('formulas', req.body.formulaId));
      const tiers = req.body.tiers?.length ? req.body.tiers : defaultTiers(formula.format);
      const customer = req.body.customerId
        ? tx.get('customers', req.body.customerId)
        : formula.customerId ? tx.get('customers', formula.customerId) : null;
      const quoteNumber = tx.nextSequence('QUOTE', 'Q-{yyyy}-{n:4}');
      const coaFee = num(req.body.coaFee ?? setting('quote.coaFee', 120), 120);

      const result = buildQuote({
        formula,
        tiers,
        coaFee,
        meta: { customer: customer?.name ?? '', productName: formula.name, formulaCode: formula.code, quoteRef: quoteNumber },
      });

      return tx.insert('quotes', {
        quoteNumber,
        title: req.body.title || formula.name,
        customerId: customer?.id ?? '',
        formulaId: formula.id,
        projectId: req.body.projectId ?? '',
        status: 'draft',
        revision: 1,
        ownerId: req.user.id,
        coaFee,
        tiers,
        snapshot: { code: formula.code, name: formula.name, format: formula.format, revision: formula.revision },
        result,
        leadTimeWeeks: num(setting('quote.leadTimeWeeks', 8), 8),
        paymentTerms: setting('quote.paymentTerms', QUOTE_DEFAULTS.paymentTerms),
        validUntil: new Date(Date.now() + num(setting('quote.validDays', 30), 30) * 86400000).toISOString(),
        notes: req.body.notes ?? '',
        tags: [formula.format],
      }, ctx);
    }, ctx);
    res.status(201).json(created);
  }));

  /** Re-price a saved quote — after a tier edit, a margin change or a price update. */
  router.post('/quotes/:id/recompute', requirePermission('quotes.write'), route((req, res) => {
    const quote = db.getOrFail('quotes', req.params.id);
    const formula = withLivePricing(db, db.getOrFail('formulas', quote.formulaId));
    const tiers = req.body?.tiers ?? quote.tiers;
    const coaFee = num(req.body?.coaFee ?? quote.coaFee, 120);
    const customer = quote.customerId ? db.get('customers', quote.customerId) : null;

    const result = buildQuote({
      formula,
      tiers,
      coaFee,
      meta: { customer: customer?.name ?? '', productName: formula.name, formulaCode: formula.code, quoteRef: quote.quoteNumber },
    });
    res.json(db.update('quotes', quote.id, {
      tiers,
      coaFee,
      result,
      snapshot: { code: formula.code, name: formula.name, format: formula.format, revision: formula.revision },
    }, actorContext(req)));
  }));

  router.post('/quotes/:id/send', requirePermission('quotes.send'), route((req, res) => {
    const quote = db.getOrFail('quotes', req.params.id);
    const blocking = (quote.result?.compliance ?? []).filter((f) => f.status === 'BLOCK');
    if (blocking.length && !req.body?.overrideReason) {
      throw new HttpError(409, `This quote carries ${blocking.length} blocking compliance finding(s): ${blocking.map((f) => f.check).join(', ')}. Resolve them or send with a written override reason.`);
    }
    const unpriced = (quote.result?.tiers ?? []).filter((t) => t.salePricePerUnit === null);
    if (unpriced.length) throw new HttpError(409, `${unpriced.length} tier(s) still have no margin set, so they carry no sale price.`);

    const updated = db.update('quotes', quote.id, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + num(setting('quote.validDays', 30), 30) * 86400000).toISOString(),
    }, actorContext(req));

    const customer = db.get('customers', quote.customerId);
    logActivity(db, req, {
      type: 'quote', title: `${quote.quoteNumber} sent`, detail: `${customer?.name ?? ''} · ${quote.title}`,
      tone: 'info', refType: 'quote', refId: quote.id, link: `/quotes/${quote.id}`,
    });
    if (customer?.ownerId && customer.ownerId !== req.user.id) {
      notify(db, customer.ownerId, { title: `${quote.quoteNumber} was sent to ${customer.name}`, body: quote.title, link: `/quotes/${quote.id}`, severity: 'info' });
    }
    res.json(updated);
  }));

  router.post('/quotes/:id/decide', requirePermission('quotes.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['decision']);
    const decision = req.body.decision;
    if (!['accepted', 'declined'].includes(decision)) throw new HttpError(422, 'A quote is accepted or declined');
    const quote = db.getOrFail('quotes', req.params.id);
    const updated = db.update('quotes', quote.id, {
      status: decision,
      decidedAt: new Date().toISOString(),
      notes: req.body.notes ? `${quote.notes}\n\n${req.body.notes}`.trim() : quote.notes,
    }, actorContext(req));

    logActivity(db, req, {
      type: 'quote',
      title: `${quote.quoteNumber} ${decision}`,
      detail: quote.title,
      tone: decision === 'accepted' ? 'success' : 'danger',
      refType: 'quote', refId: quote.id, link: `/quotes/${quote.id}`,
    });
    res.json(updated);
  }));

  /** Turn an accepted quote into a sales order at a chosen tier. */
  router.post('/quotes/:id/to-order', requirePermission('orders.write'), route((req, res) => {
    requireFields(req.body ?? {}, ['qty']);
    const ctx = actorContext(req);
    const created = db.transaction((tx) => {
      const quote = tx.getOrFail('quotes', req.params.id);
      const qty = num(req.body.qty);
      const tier = (quote.result?.tiers ?? []).find((t) => t.qty === qty);
      if (!tier) throw new HttpError(422, `This quote has no ${qty.toLocaleString()}-unit tier. Available tiers: ${(quote.result?.tiers ?? []).map((t) => t.qty.toLocaleString()).join(', ')}`);
      if (tier.salePricePerUnit === null) throw new HttpError(409, 'That tier has no margin set, so it carries no sale price');

      const unitPrice = Number(tier.salePricePerUnit);
      const subtotal = Number((unitPrice * qty).toFixed(2));
      return tx.insert('salesOrders', {
        orderNumber: tx.nextSequence('SO', 'SO-{yyyy}-{n:4}'),
        customerId: quote.customerId,
        status: 'confirmed',
        priority: req.body.priority ?? 'normal',
        customerPo: req.body.customerPo ?? '',
        quoteId: quote.id,
        ownerId: quote.ownerId || req.user.id,
        lines: [{ formulaId: quote.formulaId, description: quote.title, qty, uom: 'ea', unitPrice, shipped: 0 }],
        subtotal,
        freight: 0,
        total: subtotal,
        requestedShipDate: req.body.requestedShipDate ?? null,
        promisedShipDate: req.body.promisedShipDate ?? null,
        notes: `Converted from quote ${quote.quoteNumber}.`,
      }, ctx);
    }, ctx);

    logActivity(db, req, {
      type: 'order', title: `${created.orderNumber} created from quote`, detail: created.lines[0].description,
      tone: 'success', refType: 'salesOrder', refId: created.id, link: `/orders/${created.id}`,
    });
    res.status(201).json(created);
  }));

  /** Generate a compliant Supplement Facts panel from a formula. */
  router.get('/formulas/:id/supplement-facts', route((req, res) => {
    const formula = db.getOrFail('formulas', req.params.id);
    const panel = generateSupplementFacts(formula);
    res.json({ panel, text: renderSupplementFactsText(panel) });
  }));

  /** Format metadata the builder uses for defaults and labour suggestions. */
  router.get('/formats', route((_req, res) => {
    res.json({
      formats: FORMULA_FORMATS,
      defaults: QUOTE_DEFAULTS,
      masterBidLoaded: Boolean(setting('quote.masterBidLoaded', false)),
    });
  }));

  return router;
}
