import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFormula, buildQuote, runCompliance, defaultTiers, suggestLabour } from './quoteEngine.js';

/** 60ct capsule, 1 capsule per serving, 600 mg shell fill. */
const capsuleFormula = {
  format: 'capsule',
  isBulk: false,
  servingSize: '1 capsule',
  servingsPerUnit: 60,
  totalFormatWeightMg: 600,
  capsuleShellSize: '0',
  overagePct: 5,
  actives: [
    { code: 'ALT-RP-1001', name: 'Vitamin C (ascorbic acid)', targetMg: 250, pricePerKg: 6, priceSource: 'Enova price list' },
    { code: 'ALT-RP-1002', name: 'Zinc bisglycinate chelate', targetMg: 15, pricePerKg: 45, priceSource: 'Enova price list' },
  ],
  excipients: [
    { code: 'ALT-RP-2001', name: 'Magnesium stearate', inputMg: 6, pricePerKg: 7 },
    { code: 'ALT-RP-2002', name: 'Silicon dioxide', inputMg: 3, pricePerKg: 8 },
    { code: 'ALT-RP-2003', name: 'Microcrystalline cellulose', isBaseFill: true, pricePerKg: 5 },
  ],
  packaging: [
    { code: 'ALT-PK-250', name: 'PET amber bottle 250cc', costPerUnit: 0.32 },
    { code: 'ALT-PK-CAP', name: 'CR cap 38mm', costPerUnit: 0.08 },
    { code: 'ALT-PK-LBL', name: 'Wrap label', costPerUnit: 0.09 },
  ],
  services: [{ name: 'Encapsulation', costPerUnit: 0.0115 }, { name: 'Bottling', costPerUnit: 0.0075 }],
};

test('overage is applied to actives and the base fill takes the remainder', () => {
  const built = buildFormula(capsuleFormula);
  const [vitC, zinc] = built.ingredients.actives;
  assert.equal(vitC.inputMg, '262.5000');            // 250 × 1.05
  assert.equal(zinc.inputMg, '15.7500');             // 15 × 1.05
  const base = built.ingredients.excipients.at(-1);
  assert.equal(base.name, 'Microcrystalline cellulose');
  // 600 − (262.5 + 15.75 + 6 + 3) = 312.75
  assert.equal(base.inputMg, '312.7500');
  assert.equal(built.product.totalInputMg, '600.00');
  assert.equal(built.product.fillUtilisationPct, '100.0');
});

test('exact ingredient costs roll up to raw materials per unit', () => {
  const built = buildFormula(capsuleFormula);
  // Vitamin C: 262.5 mg × ($6 / 1e6 mg) = $0.001575/serving × 60 servings = $0.0945
  assert.equal(built.ingredients.actives[0].costPerServing, '0.00157500');
  assert.equal(built.ingredients.actives[0].costPerUnit, '0.094500');
  // Zinc: 15.75 × 45e-6 = 0.00070875 → × 60 = 0.042525
  assert.equal(built.ingredients.actives[1].costPerUnit, '0.042525');
  // Mg stearate 6 × 7e-6 × 60 = 0.00252; SiO2 3 × 8e-6 × 60 = 0.00144; MCC 312.75 × 5e-6 × 60 = 0.093825
  const expected = 0.0945 + 0.042525 + 0.00252 + 0.00144 + 0.093825;
  assert.equal(built.costSummary.rawMaterialsPerUnit, expected.toFixed(6));
  assert.equal(built.costSummary.packagingPerUnit, '0.490000');
  assert.equal(built.costSummary.servicesPerUnit, '0.019000');
});

test('bulk formulas drop every packaging line but keep services', () => {
  const built = buildFormula({ ...capsuleFormula, isBulk: true });
  assert.deepEqual(built.packaging, []);
  assert.equal(built.costSummary.packagingPerUnit, '0.000000');
  assert.equal(built.costSummary.servicesPerUnit, '0.019000');
});

test('a tier rolls labour, overhead and amortised COA into COGS and prices at margin', () => {
  const quote = buildQuote({
    formula: capsuleFormula,
    coaFee: 120,
    tiers: [{
      qty: 10000,
      labor: { encapsulationPer1000: 15, packagingPer1000: 10, qcPctOfProduction: 0.12 },
      overheadRate: 0.9,
      margin: 0.45,
    }],
  });
  const tier = quote.tiers[0];
  // labour: (15 + 10)/1000 = 0.025 production; QC 12% = 0.003; total 0.028
  assert.equal(tier.laborPerUnit, '0.028000');
  assert.equal(tier.overheadPerUnit, '0.025200');   // 0.028 × 0.9
  assert.equal(tier.coaPerUnit, '0.012000');        // $120 / 10,000
  // raw 0.23481 + packaging 0.49 + services 0.019 + labour 0.028 + overhead 0.0252 + COA 0.012
  const cogs = 0.80901;
  assert.equal(tier.cogsPerUnit, '0.8090');   // displayed at 4dp
  // sale = cogs / (1 − 0.45). Downstream figures are derived from the *unrounded*
  // COGS so the engine reproduces the live Excel formula chain exactly.
  assert.equal(tier.salePricePerUnit, (cogs / 0.55).toFixed(4));
  assert.equal(tier.extendedTotal, ((cogs / 0.55) * 10000).toFixed(2));
  assert.equal(tier.marginDollars, ((cogs / 0.55 - cogs) * 10000).toFixed(2));
  assert.equal(tier.batchCogs, (cogs * 10000).toFixed(2));
});

test('COA amortisation and labour both fall as quantity rises', () => {
  const quote = buildQuote({ formula: capsuleFormula, tiers: defaultTiers('capsule') });
  const [t10k, , , t100k] = quote.tiers;
  assert.equal(t10k.coaPerUnit, '0.012000');
  assert.equal(t100k.coaPerUnit, '0.001200');
  assert.ok(Number(t100k.laborPerUnit) < Number(t10k.laborPerUnit), 'labour must scale down with volume');
  assert.ok(Number(t100k.overheadRate) < Number(t10k.overheadRate), 'overhead rate must step down with volume');
  assert.ok(Number(t100k.cogsPerUnit) < Number(t10k.cogsPerUnit));
});

test('overhead is never zero, including on a bulk order', () => {
  const quote = buildQuote({ formula: { ...capsuleFormula, isBulk: true }, tiers: defaultTiers('powder', [50000]) });
  assert.ok(Number(quote.tiers[0].overheadPerUnit) > 0);
});

test('a tier with no margin leaves the price blank rather than guessing', () => {
  const quote = buildQuote({ formula: capsuleFormula, tiers: [{ qty: 5000, labor: { encapsulationPer1000: 15 }, margin: null }] });
  assert.equal(quote.tiers[0].salePricePerUnit, null);
  assert.equal(quote.tiers[0].extendedTotal, null);
  assert.ok(Number(quote.tiers[0].cogsPerUnit) > 0, 'COGS is still built');
});

test('vitamin D3 above the 4,000 IU upper limit blocks the formula', () => {
  const { flags, worst } = runCompliance({
    format: 'gummy',
    totalFormatWeightMg: 2500,
    actives: [{ name: 'Vitamin D3 (cholecalciferol)', targetMg: 0.125, labelClaim: 5000, labelUnit: 'IU' }],
  }, { totalInputMg: 2500 });
  const d3 = flags.find((f) => f.check === 'Vitamin D3 upper limit');
  assert.equal(d3.status, 'BLOCK');
  assert.match(d3.detail, /5,000 IU/);
  assert.equal(worst, 'BLOCK');
});

test('vitamin D3 between 2,000 and 4,000 IU warns instead of blocking', () => {
  const { flags } = runCompliance({
    actives: [{ name: 'Vitamin D3', targetMg: 0.05, labelClaim: 2000, labelUnit: 'IU' }],
  }, {});
  assert.equal(flags.find((f) => f.check === 'Vitamin D3 upper limit').status, 'WARN');
});

test('vitamin E in IU is converted and the source form is challenged', () => {
  const { flags } = runCompliance({
    actives: [{ name: 'Vitamin E (d-alpha-tocopherol)', targetMg: 20.1, labelClaim: 30, labelUnit: 'IU' }],
  }, {});
  const e = flags.find((f) => f.check === 'Vitamin E IU conversion');
  assert.equal(e.status, 'WARN');
  assert.match(e.detail, /20\.10 mg alpha-tocopherol/);
  assert.match(e.detail, /0\.67 mg AT/);
});

test('a CITES-listed botanical blocks the formula', () => {
  const { flags, worst } = runCompliance({ actives: [{ name: 'Pygeum africanum bark extract', targetMg: 100 }] }, {});
  const cites = flags.find((f) => f.check === 'CITES-listed botanical');
  assert.equal(cites.status, 'BLOCK');
  assert.match(cites.detail, /Appendix II/);
  assert.equal(worst, 'BLOCK');
});

test('a branded ingredient without its trademark is flagged with the owner', () => {
  const { flags } = runCompliance({ actives: [{ name: 'BioPerine black pepper extract', targetMg: 5 }] }, {});
  const mark = flags.find((f) => f.check === 'Branded ingredient attribution');
  assert.equal(mark.status, 'WARN');
  assert.match(mark.detail, /BioPerine®/);
  assert.match(mark.detail, /Sabinsa Corporation/);
});

test('a correctly attributed branded ingredient passes', () => {
  const { flags } = runCompliance({
    actives: [{ name: 'KSM-66® Ashwagandha root extract', targetMg: 300, brandOwner: 'Ixoreal Biomed' }],
  }, {});
  assert.equal(flags.find((f) => f.check === 'Branded ingredient attribution').status, 'PASS');
});

test('capsule fill over the shell maximum blocks and names the next size up', () => {
  const { flags } = runCompliance(
    { format: 'capsule', capsuleShellSize: '1', actives: [] },
    { totalInputMg: 720 },
  );
  const shell = flags.find((f) => f.check === 'Capsule shell capacity');
  assert.equal(shell.status, 'BLOCK');
  assert.match(shell.detail, /size 00 shell/);
});

test('a formula whose actives overflow the format weight is blocked', () => {
  const overloaded = {
    ...capsuleFormula,
    totalFormatWeightMg: 300,
    actives: [{ name: 'Vitamin C', targetMg: 500, pricePerKg: 6 }],
  };
  const quote = buildQuote({ formula: overloaded, tiers: [{ qty: 10000, margin: 0.4 }] });
  const base = quote.compliance.find((f) => f.check === 'Base fill');
  assert.equal(base.status, 'BLOCK');
  assert.equal(quote.complianceWorst, 'BLOCK');
  // the base fill clamps at zero rather than going negative
  assert.equal(quote.ingredients.excipients.at(-1).inputMg, '0.0000');
});

test('an unpriced ingredient warns rather than silently costing zero', () => {
  const { flags } = runCompliance({
    actives: [{ name: 'Mystery botanical', targetMg: 100, pricePerKg: 0 }],
    excipients: [],
  }, {});
  const pricing = flags.find((f) => f.check === 'Ingredient pricing');
  assert.equal(pricing.status, 'WARN');
  assert.match(pricing.detail, /Mystery botanical/);
});

test('the engine is deterministic — same input, identical output', () => {
  const input = { formula: capsuleFormula, tiers: defaultTiers('capsule') };
  const a = buildQuote(input);
  const b = buildQuote(input);
  delete a.meta.generatedAt;
  delete b.meta.generatedAt;
  assert.deepEqual(a, b);
});

test('suggested labour sits inside the published benchmark band', () => {
  const low = suggestLabour('gummy', 5000);
  const high = suggestLabour('gummy', 250000);
  assert.ok(low.depositPer1000 <= 60 && low.depositPer1000 >= 35);
  assert.ok(high.depositPer1000 <= low.depositPer1000, 'high volume must not cost more per unit');
  assert.equal(high.depositPer1000, 35);
});
