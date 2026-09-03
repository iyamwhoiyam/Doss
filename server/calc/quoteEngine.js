/**
 * Enova deterministic formulation & quote engine.
 *
 * Every number that reaches a customer — overage, per-ingredient cost, COGS,
 * labour, overhead, COA amortisation, tiered sale price — is produced here and
 * nowhere else. Arithmetic runs on decimal.js so the API, the on-screen cost
 * builder and any exported workbook agree to the last digit.
 *
 * The rules encoded here are Enova's, not generic manufacturing ones:
 *   • 5% overage on every ingredient (target = label claim, input = what is weighed)
 *   • exactly one excipient carries the base fill and is computed as the remainder
 *   • $120 flat COA fee per SKU, amortised across the tier quantity
 *   • labour scales down per unit as quantity rises; overhead is a % of direct labour
 *   • overhead is never zero, including on bulk orders
 */

import Decimal from 'decimal.js';
import { CAPSULE_SHELLS, QUOTE_DEFAULTS, overheadRateForQty } from '../../shared/domain.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const D = (v) => new Decimal(v ?? 0);
const MG_PER_KG = D(1_000_000);

/** IU → mg conversion factors for the vitamins Enova declares in IU. */
const IU_TO_MG = {
  d3: D(1).div(40_000_000),        // 1 IU cholecalciferol = 0.000000025 g = 0.000025 mg
  e_natural: D('0.00067'),         // 1 IU d-alpha-tocopherol = 0.67 mg AT
  e_synthetic: D('0.00045'),       // 1 IU dl-alpha-tocopherol = 0.45 mg AT
};

const D3_UPPER_LIMIT_IU = 4000;
const D3_DISCLOSURE_IU = 2000;

/** CITES Appendix I/II botanicals that block a formula until permits are on file. */
const CITES_BOTANICALS = [
  { match: /pygeum|prunus\s+africana/i, name: 'Pygeum africanum (Prunus africana)', appendix: 'II' },
  { match: /hoodia/i, name: 'Hoodia gordonii', appendix: 'II' },
  { match: /guaiac|guaiacum/i, name: 'Guaiacum spp.', appendix: 'II' },
  { match: /aquilaria|agarwood|oud/i, name: 'Aquilaria spp. (agarwood)', appendix: 'II' },
  { match: /panax\s+quinquefolius|american\s+ginseng/i, name: 'Panax quinquefolius (American ginseng)', appendix: 'II' },
  { match: /nardostachys|jatamansi/i, name: 'Nardostachys grandiflora', appendix: 'II' },
  { match: /saussurea\s+costus|costus\s+root/i, name: 'Saussurea costus', appendix: 'I' },
  { match: /dioscorea\s+deltoidea/i, name: 'Dioscorea deltoidea', appendix: 'II' },
  { match: /cistanche/i, name: 'Cistanche deserticola', appendix: 'II' },
  { match: /aloe\s+ferox/i, name: 'Aloe ferox', appendix: 'II' },
];

/** Ingredient families that trigger a California Prop 65 heavy-metals note. */
const PROP65_FAMILIES = [
  { match: /extract|botanical|herb|root|leaf|bark|rhizome/i, why: 'Botanical extract — heavy metals uptake from soil' },
  { match: /ashwagandha|turmeric|curcumin|triphala|brahmi|bacopa|shatavari|moringa/i, why: 'Ayurvedic botanical — historically elevated lead/arsenic findings' },
  { match: /kelp|seaweed|spirulina|chlorella|algae|fucoidan/i, why: 'Marine algae — arsenic and cadmium accumulation' },
  { match: /coral\s+calcium|oyster\s+shell|bone\s+meal|dolomite/i, why: 'Mineral-source calcium — lead contamination risk' },
  { match: /fish\s*oil|krill|cod\s*liver|marine|sardine|anchovy/i, why: 'Marine-derived — mercury and PCB testing expected' },
  { match: /cocoa|cacao|chocolate/i, why: 'Cocoa — cadmium and lead Prop 65 litigation history' },
  { match: /mushroom|reishi|chaga|lion.?s\s*mane|cordyceps/i, why: 'Fungal biomass — heavy metals concentration' },
];

/** Branded ingredients that must carry a trademark and supplier attribution. */
const BRANDED_MARKS = [
  ['bioperine', 'BioPerine®', 'Sabinsa Corporation'],
  ['ksm-66', 'KSM-66®', 'Ixoreal Biomed'],
  ['sensoril', 'Sensoril®', 'Natreon Inc.'],
  ['shoden', 'Shoden®', 'Arjuna Natural'],
  ['bacognize', 'Bacognize®', 'Verdure Sciences'],
  ['synapsa', 'Synapsa®', 'Kemin Industries'],
  ['pycnogenol', 'Pycnogenol®', 'Horphag Research'],
  ['meriva', 'Meriva®', 'Indena'],
  ['longvida', 'Longvida®', 'Verdure Sciences'],
  ['bcm-95', 'BCM-95®', 'Arjuna Natural / DolCas'],
  ['curcuwin', 'CurcuWIN®', 'OmniActive Health'],
  ['boswellin', 'Boswellin®', 'Sabinsa Corporation'],
  ['apresflex', 'AprèsFlex®', 'Laila Nutraceuticals'],
  ['uc-ii', 'UC-II®', 'Lonza'],
  ['verisol', 'Verisol®', 'GELITA AG'],
  ['fortigel', 'FORTIGEL®', 'GELITA AG'],
  ['peptan', 'Peptan®', 'Rousselot'],
  ['biocell', 'BioCell Collagen®', 'BioCell Technology'],
  ['astareal', 'AstaReal®', 'AstaReal AB'],
  ['ferrochel', 'Ferrochel®', 'Albion Laboratories'],
  ['traacs', 'TRAACS®', 'Albion Laboratories'],
  ['chromax', 'Chromax®', 'Nutrition 21 / Lonza'],
  ['selenoexcell', 'SelenoExcell®', 'Cypress Systems'],
  ['optizinc', 'OptiZinc®', 'InterHealth Nutraceuticals'],
  ['aquamin', 'Aquamin®', 'Marigot Ltd.'],
  ['quatrefolic', 'Quatrefolic®', 'Gnosis by Lesaffre'],
  ['metafolin', 'Metafolin®', 'Merck KGaA'],
  ['menaq7', 'MenaQ7®', 'Gnosis by Lesaffre'],
  ['kaneka', 'Kaneka Q10® / Kaneka QH®', 'Kaneka Corporation'],
  ['quali-c', 'Quali-C®', 'DSM'],
  ['carnosyn', 'CarnoSyn®', 'Natural Alternatives International'],
  ['carnipure', 'Carnipure®', 'Lonza'],
  ['sustamine', 'Sustamine®', 'Kyowa Hakko'],
  ['creapure', 'Creapure®', 'AlzChem'],
  ['optimsm', 'OptiMSM®', 'Bergstrom Nutrition'],
  ['suntheanine', 'Suntheanine®', 'Taiyo International'],
  ['floraglo', 'FloraGLO®', 'Kemin Industries'],
  ['sabinsa', 'Sabinsa branded ingredient', 'Sabinsa Corporation'],
];

// ── small helpers ──────────────────────────────────────────────────────────
const fixed = (d, places) => D(d).toFixed(places, Decimal.ROUND_HALF_UP);

/**
 * How many physical pieces make up one serving — 2 for a "2 capsules" serving.
 * `totalFormatWeightMg` is the whole serving, so shell and mould checks have to
 * divide by this before comparing against a per-piece capacity.
 */
export function unitsPerServing(formula) {
  const match = /^\s*([\d.]+)/.exec(String(formula?.servingSize ?? ''));
  const n = match ? Number(match[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
const flag = (check, status, detail, extra = {}) => ({ check, status, detail, ...extra });

function labelClaimToMg(claim, unit, form = '') {
  const value = D(claim ?? 0);
  switch ((unit ?? 'mg').toLowerCase()) {
    case 'iu':
      if (/d3|cholecalciferol|vitamin\s*d/i.test(form)) return value.mul(IU_TO_MG.d3);
      if (/dl-alpha|synthetic/i.test(form)) return value.mul(IU_TO_MG.e_synthetic);
      if (/tocopherol|vitamin\s*e/i.test(form)) return value.mul(IU_TO_MG.e_natural);
      return value.mul(IU_TO_MG.e_natural);
    case 'mcg':
    case 'µg':
    case 'ug':
      return value.div(1000);
    case 'g':
      return value.mul(1000);
    default:
      return value;
  }
}

// ── compliance ─────────────────────────────────────────────────────────────
/**
 * Run the Enova safety and labelling gates over a formula.
 * @returns {{flags: object[], worst: 'PASS'|'WARN'|'BLOCK'}}
 */
export function runCompliance(formula, computed) {
  const flags = [];
  const actives = formula.actives ?? [];

  // 1A — Vitamin D3 upper limit
  const d3 = actives.filter((a) => /d3|cholecalciferol|vitamin\s*d/i.test(`${a.name} ${a.form ?? ''}`));
  if (d3.length) {
    const totalIu = d3.reduce((sum, a) => {
      if ((a.labelUnit ?? '').toLowerCase() === 'iu') return sum.plus(D(a.labelClaim ?? 0));
      return sum.plus(D(a.targetMg ?? 0).div(IU_TO_MG.d3)); // mg mass back to IU
    }, D(0));
    const iu = Number(totalIu.toFixed(0));
    if (iu > D3_UPPER_LIMIT_IU) {
      flags.push(flag('Vitamin D3 upper limit', 'BLOCK',
        `${iu.toLocaleString()} IU per serving exceeds the 4,000 IU adult tolerable upper intake level. Reduce the dose or route this through a qualified health professional review.`,
        { authority: 'IOM/NAM Tolerable Upper Intake Level; FDA DV basis 21 CFR 101.9' }));
    } else if (iu >= D3_DISCLOSURE_IU) {
      flags.push(flag('Vitamin D3 upper limit', 'WARN',
        `${iu.toLocaleString()} IU per serving is within the legal range but above 2,000 IU — add a disclosure statement and confirm the customer wants this level.`,
        { authority: 'IOM/NAM Tolerable Upper Intake Level' }));
    } else {
      flags.push(flag('Vitamin D3 upper limit', 'PASS', `${iu.toLocaleString()} IU per serving is within the 4,000 IU upper limit.`));
    }
  }

  // 1B — Vitamin E IU → mg AT
  for (const a of actives.filter((x) => /vitamin\s*e|tocopherol/i.test(`${x.name} ${x.form ?? ''}`))) {
    const synthetic = /dl-alpha|synthetic/i.test(`${a.name} ${a.form ?? ''}`);
    const factor = synthetic ? IU_TO_MG.e_synthetic : IU_TO_MG.e_natural;
    const source = synthetic ? 'synthetic dl-alpha-tocopherol (1 IU = 0.45 mg AT)' : 'natural d-alpha-tocopherol (1 IU = 0.67 mg AT)';
    if ((a.labelUnit ?? '').toLowerCase() === 'iu') {
      const mgAt = D(a.labelClaim ?? 0).mul(factor).mul(1000);
      flags.push(flag('Vitamin E IU conversion', synthetic ? 'PASS' : 'WARN',
        `${a.name}: ${a.labelClaim} IU = ${fixed(mgAt, 2)} mg alpha-tocopherol as ${source}.` +
        (synthetic ? '' : ' Confirm the source form with the customer — the conversion factor differs by 49% between natural and synthetic.'),
        { authority: '21 CFR 101.9(c)(8)(iv)' }));
    } else {
      flags.push(flag('Vitamin E IU conversion', 'WARN',
        `${a.name} is declared in mass. Confirm whether the customer expects an IU claim on the label; if so, convert using ${source}.`,
        { authority: '21 CFR 101.9(c)(8)(iv)' }));
    }
  }

  // 1C — CITES-listed botanicals
  for (const a of actives) {
    const hit = CITES_BOTANICALS.find((c) => c.match.test(`${a.name} ${a.form ?? ''}`));
    if (hit) {
      flags.push(flag('CITES-listed botanical', 'BLOCK',
        `${a.name} matches ${hit.name}, CITES Appendix ${hit.appendix}. An import permit and chain-of-custody documentation are required before this ingredient can be purchased.`,
        { authority: 'CITES Appendices I & II; 50 CFR Part 23' }));
    }
  }

  // 1D — branded ingredient attribution
  for (const a of actives) {
    const raw = (a.name ?? '').toLowerCase();
    const mark = BRANDED_MARKS.find(([needle]) => raw.includes(needle));
    if (!mark) continue;
    const [, proper, owner] = mark;
    const attributed = /[®™]/.test(a.name) && (a.brandOwner || raw.includes(owner.split(' ')[0].toLowerCase()));
    flags.push(flag('Branded ingredient attribution', attributed ? 'PASS' : 'WARN',
      attributed
        ? `${a.name} carries its trademark and supplier attribution (${owner}).`
        : `${a.name} is a branded ingredient. Declare it as ${proper} and attribute it to ${owner} on the formula and the label.`,
      { authority: 'Supplier licence agreement; 15 U.S.C. §1114' }));
  }

  // 1E — Prop 65 / heavy metals
  const prop65 = [];
  for (const a of actives) {
    const hit = PROP65_FAMILIES.find((p) => p.match.test(`${a.name} ${a.form ?? ''}`));
    if (hit) prop65.push(`${a.name} (${hit.why})`);
  }
  if (prop65.length) {
    flags.push(flag('Prop 65 / heavy metals', 'WARN',
      `Third-party heavy metals testing is recommended before release for California distribution: ${prop65.join('; ')}.`,
      { authority: 'California Proposition 65 (Health & Safety Code §25249.6)' }));
  }

  // 1F — capsule shell capacity
  if (formula.format === 'capsule' && formula.capsuleShellSize) {
    const shell = CAPSULE_SHELLS[formula.capsuleShellSize];
    const pieces = unitsPerServing(formula);
    const fill = D(computed?.totalInputMg ?? 0).div(pieces);
    const per = pieces > 1 ? ` per capsule (${pieces} capsules per serving)` : '';
    if (shell) {
      if (fill.gt(shell.max)) {
        // the smallest shell that still holds the fill, not merely the first that fits
        const next = Object.entries(CAPSULE_SHELLS)
          .sort((a, b) => a[1].max - b[1].max)
          .find(([, r]) => fill.lte(r.max));
        flags.push(flag('Capsule shell capacity', 'BLOCK',
          `${fixed(fill, 1)} mg fill${per} exceeds the ${shell.max} mg maximum for a size ${formula.capsuleShellSize} shell.` +
          (next ? ` Move to a size ${next[0]} shell (${next[1].min}–${next[1].max} mg).` : ' No standard shell holds this fill — split the serving across two capsules.'),
          { authority: 'Enova capsule fill standard' }));
      } else if (fill.lt(shell.min)) {
        flags.push(flag('Capsule shell capacity', 'WARN',
          `${fixed(fill, 1)} mg fill${per} is below the ${shell.min} mg minimum for a size ${formula.capsuleShellSize} shell — add MCC filler or drop to a smaller shell to avoid rattle and weight-variation failures.`,
          { authority: 'Enova capsule fill standard' }));
      } else {
        flags.push(flag('Capsule shell capacity', 'PASS',
          `${fixed(fill, 1)} mg fill${per} sits inside the ${shell.min}–${shell.max} mg window for a size ${formula.capsuleShellSize} shell.`));
      }
    }
  }

  // Gummy weight sanity
  if (formula.format === 'gummy') {
    const pieces = unitsPerServing(formula);
    const perPiece = D(formula.totalFormatWeightMg ?? 0).div(pieces);
    if (perPiece.lte(0)) {
      flags.push(flag('Gummy weight', 'WARN', 'Total gummy weight was not stated. The engine assumed 2,500 mg per piece — confirm with the operator.'));
    } else if (perPiece.lt(1500) || perPiece.gt(5000)) {
      flags.push(flag('Gummy weight', 'WARN',
        `${fixed(perPiece, 0)} mg per gummy is outside the usual 2,000–3,500 mg range. Confirm the depositor mould before quoting.`));
    } else {
      flags.push(flag('Gummy weight', 'PASS', `${fixed(perPiece, 0)} mg per gummy, ${pieces} per serving.`));
    }
  }

  // Base fill sanity — the remainder must be positive
  if (computed?.baseFillShortfall) {
    flags.push(flag('Base fill', 'BLOCK',
      `Actives and excipients total ${fixed(computed.totalNonBaseInputMg, 1)} mg, which exceeds the ${fixed(formula.totalFormatWeightMg, 1)} mg format weight. There is no room for the base fill — raise the format weight or cut the dose.`,
      { authority: 'Enova formulation standard' }));
  }

  // Pricing provenance
  const unpriced = [...(formula.actives ?? []), ...(formula.excipients ?? [])]
    .filter((i) => !i.isBaseFill && !(Number(i.pricePerKg) > 0));
  if (unpriced.length) {
    flags.push(flag('Ingredient pricing', 'WARN',
      `No price on file for: ${unpriced.map((i) => i.name).join(', ')}. Confirm with Purchasing before the quote leaves the building — these lines cost $0.00 as built.`,
      { authority: 'Enova quoting standard' }));
  }

  const worst = flags.some((f) => f.status === 'BLOCK') ? 'BLOCK'
    : flags.some((f) => f.status === 'WARN') ? 'WARN' : 'PASS';
  return { flags, worst };
}

// ── formula skeleton ───────────────────────────────────────────────────────
/**
 * Apply overage, resolve the base fill remainder and cost every ingredient line.
 * Pure function of the formula — no tier information involved.
 */
export function buildFormula(formula) {
  const overage = D(1).plus(D(formula.overagePct ?? QUOTE_DEFAULTS.overagePct).div(100));
  const servings = D(formula.servingsPerUnit ?? 1);
  const formatWeight = D(formula.totalFormatWeightMg ?? 0);

  const priceLine = (line, inputMg) => {
    const pricePerMg = D(line.pricePerKg ?? 0).div(MG_PER_KG);
    const costPerServing = inputMg.mul(pricePerMg);
    const costPerUnit = costPerServing.mul(servings);
    return {
      code: line.code ?? 'TBD',
      itemId: line.itemId ?? null,
      name: line.name,
      form: line.form ?? '',
      targetMg: fixed(line.targetMg ?? 0, 4),
      inputMg: fixed(inputMg, 4),
      labelClaim: line.labelClaim ?? null,
      labelUnit: line.labelUnit ?? null,
      pricePerKg: fixed(line.pricePerKg ?? 0, 2),
      pricePerMg: pricePerMg.toFixed(12),
      priceSource: line.priceSource ?? 'Confirm with Purchasing',
      costPerServing: fixed(costPerServing, 8),
      costPerUnit: fixed(costPerUnit, 6),
      isBaseFill: Boolean(line.isBaseFill),
      _inputMg: inputMg,
      _costPerUnit: costPerUnit,
    };
  };

  // Actives always take overage.
  const actives = (formula.actives ?? []).map((a) => {
    const target = D(a.targetMg ?? 0);
    return priceLine(a, target.mul(overage));
  });

  // Excipients: `inputMg` is an exact weight (no overage); `targetMg` takes overage.
  const nonBase = (formula.excipients ?? []).filter((e) => !e.isBaseFill).map((e) =>
    priceLine(e, e.inputMg != null && e.inputMg !== ''
      ? D(e.inputMg)
      : D(e.targetMg ?? 0).mul(overage)),
  );

  const totalNonBaseInputMg = [...actives, ...nonBase].reduce((sum, l) => sum.plus(l._inputMg), D(0));
  const baseSource = (formula.excipients ?? []).find((e) => e.isBaseFill);
  const remainder = formatWeight.minus(totalNonBaseInputMg);
  const baseFillShortfall = Boolean(baseSource) && remainder.lt(0);
  const base = baseSource ? priceLine(baseSource, Decimal.max(remainder, D(0))) : null;

  const excipients = base ? [...nonBase, base] : nonBase;

  const ingredientLines = [...actives, ...excipients];
  const rawMaterialsPerUnit = ingredientLines.reduce((sum, l) => sum.plus(l._costPerUnit), D(0));
  const totalInputMg = ingredientLines.reduce((sum, l) => sum.plus(l._inputMg), D(0));

  const packagingLines = (formula.isBulk ? [] : (formula.packaging ?? [])).map((p) => ({
    code: p.code ?? 'TBD',
    itemId: p.itemId ?? null,
    name: p.name,
    costPerUnit: fixed(p.costPerUnit ?? 0, 6),
    priceSource: p.priceSource ?? 'Confirm with Purchasing',
    _cost: D(p.costPerUnit ?? 0),
  }));
  const packagingPerUnit = packagingLines.reduce((sum, p) => sum.plus(p._cost), D(0));

  const serviceLines = (formula.services ?? []).map((s) => ({
    name: s.name,
    costPerUnit: fixed(s.costPerUnit ?? 0, 6),
    basis: s.basis ?? '',
    _cost: D(s.costPerUnit ?? 0),
  }));
  const servicesPerUnit = serviceLines.reduce((sum, s) => sum.plus(s._cost), D(0));

  const strip = (line) => { const { _inputMg, _costPerUnit, _cost, ...rest } = line; return rest; };

  return {
    product: {
      format: formula.format,
      isBulk: Boolean(formula.isBulk),
      servingSize: formula.servingSize ?? '',
      servingsPerUnit: Number(servings),
      totalFormatWeightMg: fixed(formatWeight, 2),
      totalInputMg: fixed(totalInputMg, 2),
      capsuleShellSize: formula.capsuleShellSize ?? null,
      unitsPerServing: unitsPerServing(formula),
      perPieceWeightMg: fixed(formatWeight.div(unitsPerServing(formula)), 2),
      overagePct: Number(formula.overagePct ?? QUOTE_DEFAULTS.overagePct),
      fillUtilisationPct: formatWeight.gt(0) ? fixed(totalInputMg.div(formatWeight).mul(100), 1) : '0.0',
    },
    ingredients: {
      actives: actives.map(strip),
      excipients: excipients.map(strip),
    },
    packaging: packagingLines.map(strip),
    services: serviceLines.map(strip),
    costSummary: {
      rawMaterialsPerUnit: fixed(rawMaterialsPerUnit, 6),
      packagingPerUnit: fixed(packagingPerUnit, 6),
      servicesPerUnit: fixed(servicesPerUnit, 6),
    },
    _internal: {
      rawMaterialsPerUnit,
      packagingPerUnit,
      servicesPerUnit,
      totalInputMg,
      totalNonBaseInputMg,
      baseFillShortfall,
    },
  };
}

// ── labour ─────────────────────────────────────────────────────────────────
const LABOUR_KEYS = [
  ['blendingPer1000', 'Blending / mixing'],
  ['fillPer1000', 'Fill'],
  ['encapsulationPer1000', 'Encapsulation'],
  ['depositPer1000', 'Gummy deposit'],
  ['compressionPer1000', 'Tablet compression'],
  ['packagingPer1000', 'Packaging / bottling'],
];

function buildLabour(labor = {}) {
  const lines = [];
  let production = D(0);
  // Explicit lines (from the routing's real minutes, or from actual batches)
  // take precedence over the per-thousand benchmark bands.
  if (Array.isArray(labor.lines) && labor.lines.length) {
    for (const line of labor.lines) {
      const perUnit = D(line.perUnit ?? 0);
      if (perUnit.isZero()) continue;
      production = production.plus(perUnit);
      lines.push({
        label: line.label, ratePer1000: fixed(perUnit.mul(1000), 2), perUnit: fixed(perUnit, 6),
        minutes: line.minutes ?? null, crew: line.crew ?? null, rate: line.rate ?? null, costPerBatch: line.costPerBatch ?? null,
        _perUnit: perUnit,
      });
    }
  } else for (const [key, label] of LABOUR_KEYS) {
    const rate = D(labor[key] ?? 0);
    if (rate.isZero()) continue;
    const perUnit = rate.div(1000);
    production = production.plus(perUnit);
    lines.push({ label, ratePer1000: fixed(rate, 2), perUnit: fixed(perUnit, 6), _perUnit: perUnit });
  }
  const qcPct = D(labor.qcPctOfProduction ?? QUOTE_DEFAULTS.qcPctOfProduction);
  const qc = production.mul(qcPct);
  if (qc.gt(0)) {
    lines.push({
      label: `QC / inspection (${fixed(qcPct.mul(100), 0)}% of production labour)`,
      ratePer1000: fixed(qc.mul(1000), 2),
      perUnit: fixed(qc, 6),
      _perUnit: qc,
    });
  }
  const total = production.plus(qc);
  return { lines: lines.map(({ _perUnit, ...rest }) => rest), total, production, qc, source: labor.source ?? (Array.isArray(labor.lines) && labor.lines.length ? 'lines' : 'bands') };
}

// ── tiers ──────────────────────────────────────────────────────────────────
function buildTier(tier, built, coaFee) {
  const qty = D(tier.qty ?? 0);
  const labour = buildLabour(tier.labor ?? {});
  const overheadRate = tier.overheadRate != null ? D(tier.overheadRate) : D(overheadRateForQty(Number(qty)));
  const overheadPerUnit = labour.total.mul(overheadRate);
  const coaPerUnit = qty.gt(0) ? D(coaFee).div(qty) : D(0);

  const cogs = built._internal.rawMaterialsPerUnit
    .plus(built._internal.packagingPerUnit)
    .plus(built._internal.servicesPerUnit)
    .plus(labour.total)
    .plus(overheadPerUnit)
    .plus(coaPerUnit);

  // Price either follows a margin, or is set outright — in which case the
  // margin is read back from it so GP is always visible.
  let margin = tier.margin == null || tier.margin === '' ? null : D(tier.margin);
  let salePrice = null;
  let extended = null;
  let marginDollars = null;
  let priceSource = 'margin';
  const override = tier.priceOverride == null || tier.priceOverride === '' ? null : D(tier.priceOverride);
  if (override !== null && override.gt(0)) {
    salePrice = override;
    margin = cogs.gt(0) ? override.minus(cogs).div(override) : D(0);
    priceSource = 'set';
  } else if (margin !== null && margin.lt(1) && margin.gte(0)) {
    salePrice = cogs.div(D(1).minus(margin));
  }
  if (salePrice !== null) {
    extended = salePrice.mul(qty);
    marginDollars = salePrice.minus(cogs).mul(qty);
  }

  return {
    qty: Number(qty),
    laborLines: labour.lines,
    laborPerUnit: fixed(labour.total, 6),
    overheadRate: Number(overheadRate.toFixed(4)),
    overheadPerUnit: fixed(overheadPerUnit, 6),
    coaPerUnit: fixed(coaPerUnit, 6),
    rawMaterialsPerUnit: fixed(built._internal.rawMaterialsPerUnit, 6),
    packagingPerUnit: fixed(built._internal.packagingPerUnit, 6),
    servicesPerUnit: fixed(built._internal.servicesPerUnit, 6),
    cogsPerUnit: fixed(cogs, 4),
    margin: margin === null ? null : Number(margin.toFixed(4)),
    salePricePerUnit: salePrice === null ? null : fixed(salePrice, 4),
    extendedTotal: extended === null ? null : fixed(extended, 2),
    marginDollars: marginDollars === null ? null : fixed(marginDollars, 2),
    gpPerUnit: salePrice === null ? null : fixed(salePrice.minus(cogs), 4),
    gpPct: salePrice === null || salePrice.isZero() ? null : Number(salePrice.minus(cogs).div(salePrice).mul(100).toFixed(1)),
    priceSource,
    laborSource: labour.source,
    laborPerBatch: fixed(labour.total.mul(qty), 2),
    // Bulk product is quoted per thousand pieces as well as per piece.
    per1000: built.product?.isBulk && salePrice !== null ? fixed(salePrice.mul(1000), 2) : null,
    batchCogs: fixed(cogs.mul(qty), 2),
  };
}

// ── public entry point ─────────────────────────────────────────────────────
/**
 * Build a complete quote from a formula plus tier assumptions.
 *
 * @param {object} input
 * @param {object} input.formula   formula record (actives, excipients, packaging, services)
 * @param {object[]} input.tiers   [{ qty, labor, overheadRate, margin }]
 * @param {number} [input.coaFee]  flat COA fee per SKU (default $120)
 * @param {object} [input.meta]    customer / product / reference labels, passed through
 */
export function buildQuote({ formula, tiers = [], coaFee = QUOTE_DEFAULTS.coaFee, meta = {} }) {
  if (!formula) throw new Error('buildQuote requires a formula');
  const built = buildFormula(formula);
  const compliance = runCompliance(formula, {
    totalInputMg: built._internal.totalInputMg,
    totalNonBaseInputMg: built._internal.totalNonBaseInputMg,
    baseFillShortfall: built._internal.baseFillShortfall,
  });

  const sortedTiers = [...tiers].sort((a, b) => Number(a.qty ?? 0) - Number(b.qty ?? 0));
  const tierResults = sortedTiers.map((tier) => buildTier(tier, built, coaFee));

  const { _internal, ...publicBuild } = built;
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      engine: 'enova-quote-engine/1.0',
      coaFee: fixed(coaFee, 2),
      leadTimeWeeks: meta.leadTimeWeeks ?? QUOTE_DEFAULTS.leadTimeWeeks,
      paymentTerms: meta.paymentTerms ?? QUOTE_DEFAULTS.paymentTerms,
      ...meta,
    },
    ...publicBuild,
    costSummary: {
      ...publicBuild.costSummary,
      coaFee: fixed(coaFee, 2),
    },
    compliance: compliance.flags,
    complianceWorst: compliance.worst,
    tiers: tierResults,
  };
}

/**
 * Suggested labour rates for a format at a given quantity, interpolating the
 * benchmark band (low volume pays the top of the band, high volume the bottom).
 * These are flagged as benchmarks until the MASTER BID tier page overrides them.
 */
export function suggestLabour(format, qty) {
  const bands = {
    gummy: { deposit: [35, 60], packaging: [8, 15] },
    capsule: { encapsulation: [12, 20], packaging: [8, 15] },
    tablet: { compression: [10, 18], packaging: [8, 15] },
    sachet: { fill: [18, 30], packaging: [6, 12] },
    stick_pack: { fill: [18, 30], packaging: [6, 12] },
    tincture: { fill: [25, 45], packaging: [8, 15] },
    powder: { blending: [6, 12], packaging: [6, 12] },
    softgel: { encapsulation: [14, 24], packaging: [8, 15] },
  }[format] ?? { blending: [6, 12], packaging: [8, 15] };

  // 10k units pays the top of the band, 100k+ the bottom, log-interpolated between.
  const q = Math.max(1000, Number(qty) || 10000);
  const t = Math.min(1, Math.max(0, (Math.log10(q) - 4) / 1));
  const pick = ([low, high]) => Number((high - (high - low) * t).toFixed(2));

  const labor = { qcPctOfProduction: QUOTE_DEFAULTS.qcPctOfProduction };
  const keyFor = { deposit: 'depositPer1000', encapsulation: 'encapsulationPer1000', compression: 'compressionPer1000', fill: 'fillPer1000', blending: 'blendingPer1000', packaging: 'packagingPer1000' };
  for (const [name, band] of Object.entries(bands)) labor[keyFor[name]] = pick(band);
  labor.blendingPer1000 ??= pick([6, 12]);
  return labor;
}

/** A sensible starting tier ladder when the customer has not named one. */
export function defaultTiers(format, quantities = [10000, 25000, 50000, 100000], margins = [0.45, 0.42, 0.38, 0.35]) {
  return quantities.map((qty, i) => ({
    qty,
    labor: suggestLabour(format, qty),
    overheadRate: overheadRateForQty(qty),
    margin: margins[i] ?? margins.at(-1),
  }));
}

export { BRANDED_MARKS, CITES_BOTANICALS, PROP65_FAMILIES, labelClaimToMg };
