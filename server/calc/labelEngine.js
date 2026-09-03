/**
 * Enova label review engine.
 *
 * Runs the 41-row Enova Label Review Checklist over submitted panel copy and
 * returns a signed-record-shaped result: every row carries a state, and every
 * defect becomes a finding with its authority and the corrected wording.
 *
 * Two rules from the Enova review doctrine are load-bearing here and are
 * enforced in code rather than left to judgement:
 *
 *   1. **Never mark an item compliant without evidence.** Twenty of the forty-one
 *      rows depend on where things sit on the artwork, how they are drawn, or on
 *      a file that is not the label (the Master Formula, the substantiation file,
 *      a trademark licence). Those come back as `not_reviewed` with the specific
 *      thing to look at — never ticked, never quietly skipped.
 *   2. **Absence read by OCR is not evidence of absence.** When the copy came
 *      from an image, a missing element is reported as *confirm against the
 *      artwork* (a recommendation). Only a text layer makes absence a required
 *      correction.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DAILY_VALUES, matchNutrient, MAJOR_ALLERGENS, MANDATORY_WARNINGS,
  DISEASE_CLAIM_TERMS, proposeClaimRewrite, DSHEA_DISCLAIMER, FUNCTIONAL_INGREDIENTS,
} from './labelReference.js';

export const CHECKLIST = JSON.parse(
  readFileSync(fileURLToPath(new URL('../data/label-checklist.json', import.meta.url)), 'utf8'),
);

const PANEL_KEYS = ['pdp', 'information', 'leftSide', 'rightSide', 'other'];
const PANEL_LABELS = {
  pdp: 'Principal display panel',
  information: 'Information panel',
  leftSide: 'Left side panel',
  rightSide: 'Right side panel',
  other: 'Other copy',
};

const COUNT_UNITS = 'capsules?|caps|tablets?|tabs|gummies|gummy|softgels?|chews?|lozenges?|packets?|sachets?|stick ?packs?|servings?|count|ct|pieces?';
const WEIGHT_UNITS = 'fl\\.? ?oz|oz|lbs?|kg|g|mg|mcg|ml|l|liters?';

// ── parsing ────────────────────────────────────────────────────────────────
const clean = (s) => String(s ?? '').replace(/\r/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
const lines = (s) => clean(s).split('\n').map((l) => l.trim()).filter(Boolean);

function sectionAfter(text, headings, stopHeadings = []) {
  const pattern = new RegExp(`(?:${headings.join('|')})\\s*[:\\-]?\\s*`, 'i');
  const match = pattern.exec(text);
  if (!match) return null;
  let rest = text.slice(match.index + match[0].length);
  const stop = new RegExp(`\\n\\s*(?:${[...stopHeadings, 'other ingredients', 'contains', 'warning', 'caution', 'suggested use', 'directions', 'distributed by', 'manufactured for', 'manufactured by', 'supplement facts', 'store ', 'these statements'].join('|')})`, 'i');
  const end = stop.exec(rest);
  if (end) rest = rest.slice(0, end.index);
  return clean(rest);
}

/** Parse one Supplement Facts body line into a nutrient row. */
export function parseFactRow(line) {
  const raw = clean(line);
  if (!raw || /^supplement facts$/i.test(raw)) return null;
  if (/^(serving size|servings per|amount per|% ?daily value|daily value)/i.test(raw)) return null;

  // "Vitamin D3 (as cholecalciferol)  25 mcg (1,000 IU)  125%"
  const dvMatch = /(?:^|\s)(<?\s?[\d.,]+)\s*%\s*(?:\*+|†)?\s*$/.exec(raw);
  const declaredDv = dvMatch ? Number(dvMatch[1].replace(/[<,\s]/g, '')) : null;
  const footnoteMark = /[†*‡]\s*$/.test(raw) || /\*\*?\s*$/.test(raw);
  let body = dvMatch ? raw.slice(0, dvMatch.index) : raw.replace(/[†*‡]+\s*$/, '');

  const amountMatch = /([\d.,]+)\s*(mcg RAE|mcg DFE|mg NE|mcg|mg|g|IU|iu|mL|ml|L|billion CFU|CFU)\b/i.exec(body);
  const parenIu = /\(\s*([\d.,]+)\s*IU\s*\)/i.exec(body);

  let name = body;
  if (amountMatch) name = body.slice(0, amountMatch.index);
  name = clean(name).replace(/[.\s·…]+$/, '').replace(/\s{2,}/g, ' ');

  const indent = /^\s{2,}|^\s*[-–•]/.test(line);
  return {
    raw,
    name,
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null,
    unit: amountMatch ? amountMatch[2].replace(/^iu$/, 'IU') : null,
    iuEquivalent: parenIu ? Number(parenIu[1].replace(/,/g, '')) : null,
    declaredDv,
    footnoteMark,
    indent,
    nutrient: matchNutrient(name),
  };
}

/**
 * Turn submitted panel copy into a structured label.
 * @param {object} panels  { pdp, information, leftSide, rightSide, other }
 */
export function parseLabel(panels = {}) {
  const byPanel = {};
  for (const key of PANEL_KEYS) byPanel[key] = clean(panels[key] ?? '');
  const all = PANEL_KEYS.map((k) => byPanel[k]).filter(Boolean).join('\n\n');
  const pdp = byPanel.pdp || all;

  // ── principal display panel ──
  const pdpLines = lines(pdp);
  const identity = /dietary supplement/i.test(pdp);
  const netQtyMatch =
    new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s*(${COUNT_UNITS})\\b`, 'i').exec(pdp) ??
    new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s*(${WEIGHT_UNITS})\\b`, 'i').exec(pdp);
  const netQuantity = netQtyMatch
    ? { value: Number(netQtyMatch[1].replace(/,/g, '')), unit: netQtyMatch[2].toLowerCase(), text: netQtyMatch[0] }
    : null;

  const brand = pdpLines[0] ?? '';
  const productName = pdpLines.find((l, i) => i > 0 && !/dietary supplement/i.test(l) && !netQtyMatch?.[0].includes(l)) ?? pdpLines[1] ?? '';

  // ── supplement facts ──
  const sfpStart = /supplement facts/i.exec(all);
  let factLinesRaw = [];
  if (sfpStart) {
    const after = all.slice(sfpStart.index);
    const stop = /\n\s*(other ingredients|contains|allergen|warning|caution|suggested use|directions|distributed by|manufactured (for|by))/i.exec(after);
    factLinesRaw = (stop ? after.slice(0, stop.index) : after).split('\n');
  }
  const factRows = factLinesRaw
    .map(parseFactRow)
    // keep unweighed blend declarations too — a blend with no total weight is
    // itself the defect row 18 exists to catch
    .filter((r) => r && (r.amount !== null || r.nutrient || /\b(blend|matrix|proprietary|complex)\b/i.test(r.name)));

  const servingSizeMatch = /serving size\s*[:\-]?\s*([^\n]+)/i.exec(all);
  const servingsMatch = /servings? per container\s*[:\-]?\s*(?:about\s*)?([\d,]+)/i.exec(all);
  const servingSizeText = servingSizeMatch ? clean(servingSizeMatch[1]) : null;
  const servingCountMatch = servingSizeText
    ? new RegExp(`([\\d.,]+)\\s*(${COUNT_UNITS}|${WEIGHT_UNITS})`, 'i').exec(servingSizeText)
    : null;

  // ── ingredient list & allergens ──
  const otherIngredientsText = sectionAfter(all, ['other ingredients', 'inactive ingredients']);
  const otherIngredients = otherIngredientsText
    ? otherIngredientsText.replace(/\.$/, '').split(/,(?![^(]*\))/).map(clean).filter(Boolean)
    : [];
  const containsMatch = /\bcontains\s*[:\-]?\s*([^\n.]+)/i.exec(all);
  const allergenStatement = containsMatch ? clean(containsMatch[1]) : null;

  // ── firm statement ──
  const firmMatch = /(distributed by|manufactured for|manufactured by|manufactured|packed for|produced for)\s*[:\-]?\s*([^\n]*(?:\n(?!\s*\n)[^\n]*){0,3})/i.exec(all);
  const firm = firmMatch
    ? { relationship: clean(firmMatch[1]), block: clean(firmMatch[2]) }
    : null;
  const streetAddress = firm
    ? /\d+\s+[\w.'-]+(?:\s+[\w.'-]+){0,4}\s+(street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|parkway|pkwy\.?|highway|hwy\.?|circle|cir\.?|place|pl\.?|suite|ste\.?|unit)\b/i.exec(firm.block)?.[0] ?? null
    : null;

  // ── use, warnings, claims ──
  const directions = sectionAfter(all, ['suggested use', 'directions for use', 'directions', 'recommended use']);
  const directionsCount = directions
    ? new RegExp(`(?:take|chew|consume|mix)?\\s*([\\d]+)(?:\\s*(?:to|–|-)\\s*([\\d]+))?\\s*(${COUNT_UNITS})`, 'i').exec(directions)
    : null;
  const warningsText = sectionAfter(all, ['warnings?', 'cautions?'], ['suggested use']);
  const disclaimerPresent = /have not been evaluated by the (u\.?s\.?\s*)?food and drug administration/i.test(all);
  const disclaimerExact = all.replace(/\s+/g, ' ').includes(DSHEA_DISCLAIMER.replace(/\s+/g, ' '));

  const upcMatch = /\b(\d{12}|\d{13})\b/.exec(all);
  const revisionMatch = /rev\.?\s*#?\s*(\d+)\s*[-–—]\s*(\d{1,2}\/\d{2,4})/i.exec(all);
  const lotMatch = /\b(lot|batch)\s*[#:]?\s*([A-Z0-9-]{4,})/i.exec(all);
  const expMatch = /\b(exp(?:iration|iry|\.)?|best by|use by)\s*[#:]?\s*([A-Z0-9/\- ]{4,})/i.exec(all);

  return {
    panels: byPanel,
    text: all,
    brand,
    productName,
    statementOfIdentity: identity,
    netQuantity,
    supplementFacts: {
      present: Boolean(sfpStart),
      servingSize: servingSizeText,
      servingCount: servingCountMatch ? Number(servingCountMatch[1].replace(/,/g, '')) : null,
      servingUnit: servingCountMatch ? servingCountMatch[2].toLowerCase() : null,
      servingsPerContainer: servingsMatch ? Number(servingsMatch[1].replace(/,/g, '')) : null,
      rows: factRows,
      footnotes: (all.match(/^[†*‡].+$/gim) ?? []).map(clean),
    },
    otherIngredients,
    allergenStatement,
    firm,
    streetAddress,
    directions,
    directionsCount: directionsCount
      ? { min: Number(directionsCount[1]), max: directionsCount[2] ? Number(directionsCount[2]) : Number(directionsCount[1]), unit: directionsCount[3].toLowerCase() }
      : null,
    warnings: warningsText,
    disclaimer: { present: disclaimerPresent, exact: disclaimerExact },
    upc: upcMatch ? upcMatch[1] : null,
    revisionMark: revisionMatch ? { revision: revisionMatch[1], date: revisionMatch[2], text: revisionMatch[0] } : null,
    lot: lotMatch ? lotMatch[2] : null,
    expiry: expMatch ? clean(expMatch[2]) : null,
  };
}

// ── UPC ────────────────────────────────────────────────────────────────────
export function upcCheckDigitValid(code) {
  if (!/^\d{12}$/.test(code)) return null; // only UPC-A is checkable here
  const digits = code.split('').map(Number);
  const sum = digits.slice(0, 11).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[11];
}

// ── rules engine ───────────────────────────────────────────────────────────
/**
 * Rounding increments 21 CFR 101.9(c)(8)(iv) requires for vitamin and mineral
 * quantitative amounts on the Supplement Facts panel.
 */
function incrementFor(value) {
  if (value < 10) return 0.1;
  if (value < 50) return 1;
  return 10;
}

const roundedToIncrement = (value) => {
  const inc = incrementFor(value);
  return Math.abs(value / inc - Math.round(value / inc)) < 1e-9;
};

class ReviewContext {
  constructor({ parsed, formula, source, evidenceIsSoft }) {
    this.parsed = parsed;
    this.formula = formula ?? null;
    this.source = source;
    this.evidenceIsSoft = evidenceIsSoft;
    this.states = new Map();
    this.findings = [];
  }

  set(rowId, state, comment) {
    this.states.set(rowId, { state, comment });
  }

  /**
   * Record a defect. `absence` marks a finding raised because something could
   * not be found — those soften to a recommendation when the copy came from OCR.
   */
  finding({ rowId, type = 'required', issue, authority, proposedWording = '', evidence = '', absence = false }) {
    const soft = absence && this.evidenceIsSoft;
    this.findings.push({
      id: `F${String(this.findings.length + 1).padStart(2, '0')}`,
      rowId,
      type: soft ? 'recommendation' : type,
      issue: soft ? `${issue} The copy was read by OCR, so this is a request to confirm against the artwork, not a confirmed omission.` : issue,
      authority,
      proposedWording,
      evidence,
      decision: 'pending',
      decidedBy: null,
      decidedAt: null,
    });
    return this.findings.at(-1);
  }

  fail(rowId, comment, finding) {
    this.set(rowId, 'fail', comment);
    if (finding) this.finding({ rowId, ...finding });
  }

  pass(rowId, comment) { this.set(rowId, 'pass', comment); }
  na(rowId, comment) { this.set(rowId, 'na', comment); }
  unreviewed(rowId, comment) { this.set(rowId, 'not_reviewed', comment); }
}

/** Supplement Facts rows that declare a proprietary blend rather than a nutrient. */
function blendRows(ctx) {
  return ctx.parsed.supplementFacts.rows.filter(
    (r) => !r.nutrient && /\b(blend|matrix|proprietary|complex)\b/i.test(r.name),
  );
}

// -- individual rules, one per checklist row that copy can settle ------------
const RULES = {
  // Row 3 — net quantity value and unit
  3(ctx) {
    const { netQuantity, supplementFacts } = ctx.parsed;
    if (!netQuantity) {
      return ctx.fail(3, 'No net quantity of contents found in the panel copy.', {
        issue: 'The principal display panel does not declare a net quantity of contents.',
        authority: '21 CFR 101.105; 21 CFR 101.36(b)(1)',
        proposedWording: '60 Capsules',
        absence: true,
      });
    }
    const countable = new RegExp(`^(${COUNT_UNITS})$`, 'i').test(netQuantity.unit);
    if (!countable && !new RegExp(`^(${WEIGHT_UNITS})$`, 'i').test(netQuantity.unit)) {
      return ctx.fail(3, `"${netQuantity.text}" does not use a recognised unit of measure.`, {
        issue: `The net quantity "${netQuantity.text}" is not stated in a numerical count, weight or volume measure.`,
        authority: '21 CFR 101.105(a)',
        proposedWording: '60 Capsules',
      });
    }
    const expected = supplementFacts.servingsPerContainer && supplementFacts.servingCount
      ? supplementFacts.servingsPerContainer * supplementFacts.servingCount
      : null;
    if (countable && expected && Math.abs(expected - netQuantity.value) > 0.5) {
      return ctx.fail(3, `Net quantity ${netQuantity.value} does not reconcile with ${supplementFacts.servingsPerContainer} servings × ${supplementFacts.servingCount} per serving = ${expected}.`, {
        issue: `The panel declares ${netQuantity.text}, but ${supplementFacts.servingsPerContainer} servings per container at ${supplementFacts.servingCount} ${supplementFacts.servingUnit} per serving works out to ${expected}.`,
        authority: '21 CFR 101.105; 21 CFR 101.36(b)(2)(i)',
        proposedWording: `${expected} ${netQuantity.unit}`,
        evidence: `${netQuantity.text} vs ${supplementFacts.servingsPerContainer} × ${supplementFacts.servingCount}`,
      });
    }
    ctx.pass(3, `Declared as "${netQuantity.text}"${expected ? `, which reconciles with the serving statement (${supplementFacts.servingsPerContainer} × ${supplementFacts.servingCount})` : ''}.`);
  },

  // Row 8 — serving size
  8(ctx) {
    const { servingSize, servingCount } = ctx.parsed.supplementFacts;
    if (!servingSize) {
      return ctx.fail(8, 'No serving size declared.', {
        issue: 'The Supplement Facts panel does not declare a serving size.',
        authority: '21 CFR 101.36(b)(1)',
        proposedWording: 'Serving Size: 2 Capsules',
        absence: true,
      });
    }
    if (servingCount === null) {
      return ctx.fail(8, `Serving size "${servingSize}" has no numerical value and unit.`, {
        issue: `The serving size reads "${servingSize}" without a countable quantity and unit of measure.`,
        authority: '21 CFR 101.36(b)(1)',
        proposedWording: 'Serving Size: 2 Capsules',
      });
    }
    ctx.pass(8, `Serving size declared as "${servingSize}".`);
  },

  // Row 9 — servings per container vs net quantity and the master formula
  9(ctx) {
    const { servingsPerContainer, servingCount } = ctx.parsed.supplementFacts;
    const net = ctx.parsed.netQuantity;
    if (servingsPerContainer === null) {
      return ctx.fail(9, 'Servings per container is not declared.', {
        issue: 'The Supplement Facts panel does not state servings per container.',
        authority: '21 CFR 101.36(b)(1)',
        proposedWording: 'Servings Per Container: 30',
        absence: true,
      });
    }
    if (net && servingCount) {
      const expected = net.value / servingCount;
      if (Math.abs(expected - servingsPerContainer) > 0.5) {
        return ctx.fail(9, `Declared ${servingsPerContainer}; ${net.text} at ${servingCount} per serving gives ${expected}.`, {
          issue: `Servings per container is declared as ${servingsPerContainer}, but ${net.text} divided by a ${servingCount}-${net.unit.replace(/s$/, '')} serving is ${expected % 1 === 0 ? expected : expected.toFixed(1)}.`,
          authority: '21 CFR 101.36(b)(2)(i)',
          proposedWording: `Servings Per Container: ${Math.floor(expected)}`,
          evidence: `${net.text} ÷ ${servingCount}`,
        });
      }
    }
    const mfServings = ctx.formula?.servingsPerUnit;
    if (mfServings && Math.abs(mfServings - servingsPerContainer) > 0.5) {
      return ctx.fail(9, `Declared ${servingsPerContainer}; the master formula says ${mfServings}.`, {
        issue: `The label declares ${servingsPerContainer} servings per container. The linked master formula (${ctx.formula.code}) is built at ${mfServings} servings per unit.`,
        authority: '21 CFR 111.70(b); 21 CFR 101.36(b)(2)(i)',
        proposedWording: `Servings Per Container: ${mfServings}`,
      });
    }
    ctx.pass(9, `Declared as ${servingsPerContainer}${net ? `, consistent with ${net.text}` : ''}${mfServings ? ' and with the master formula' : ''}.`);
  },

  // Row 12 — nutrient ordering
  12(ctx) {
    const rows = ctx.parsed.supplementFacts.rows.filter((r) => r.nutrient);
    if (rows.length < 2) return ctx.na(12, 'Fewer than two Daily Value nutrients are declared, so no order can be assessed.');
    const seen = rows.map((r) => ({ name: r.nutrient.name, order: r.nutrient.order }));
    const sorted = [...seen].sort((a, b) => a.order - b.order);
    const misplaced = seen.filter((s, i) => s.name !== sorted[i].name);
    if (misplaced.length) {
      return ctx.fail(12, `Nutrients are out of regulation order (${seen.map((s) => s.name).join(' → ')}).`, {
        issue: `The Supplement Facts panel lists ${seen.map((s) => s.name).join(', ')}. 21 CFR 101.36(b)(2)(i) fixes the order of nutrients with a Daily Value.`,
        authority: '21 CFR 101.36(b)(2)(i); 21 CFR 101.9(c)',
        proposedWording: sorted.map((s) => s.name).join(', '),
        evidence: `found: ${seen.map((s) => s.name).join(' → ')}`,
      });
    }
    ctx.pass(12, `${seen.length} Daily Value nutrients are in the order 21 CFR 101.36(b)(2)(i) requires.`);
  },

  // Row 13 — nutrients properly declared
  13(ctx) {
    const rows = ctx.parsed.supplementFacts.rows;
    if (!rows.length) {
      return ctx.fail(13, 'No nutrient rows could be read from the Supplement Facts panel.', {
        issue: 'No nutrient or dietary ingredient rows were found in the Supplement Facts panel.',
        authority: '21 CFR 101.36(b)(2)',
        absence: true,
      });
    }
    const problems = [];
    for (const row of rows) {
      if (!row.nutrient) continue;
      const named = new RegExp(row.nutrient.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(row.name);
      if (!named) problems.push(`"${row.name}" should be declared as "${row.nutrient.name}"`);
      // source form must be disclosed for chelates and salts
      if (/chelate|glycinate|citrate|oxide|gluconate|picolinate|bisglycinate|ascorbate|cholecalciferol|tocopher/i.test(row.name)
        && !/\(as .+\)/i.test(row.raw)) {
        problems.push(`"${row.name}" states a source form but not in the "(as …)" construction`);
      }
    }
    if (problems.length) {
      return ctx.fail(13, problems.join('; '), {
        issue: `Nutrient declarations are not in the required form: ${problems.join('; ')}.`,
        authority: '21 CFR 101.36(b)(2)(i)',
        proposedWording: 'Vitamin D (as cholecalciferol)',
      });
    }
    ctx.pass(13, `${rows.length} rows read; every Daily Value nutrient uses its regulation name and discloses its source form.`);
  },

  // Row 15 — units of measure
  15(ctx) {
    const rows = ctx.parsed.supplementFacts.rows.filter((r) => r.nutrient && r.unit);
    if (!rows.length) return ctx.na(15, 'No quantified Daily Value nutrients to check.');
    const wrong = [];
    for (const row of rows) {
      const expected = row.nutrient.unit;
      if (!expected) continue;
      const declared = row.unit;
      if (/^IU$/i.test(declared)) {
        wrong.push(`${row.nutrient.name} is declared in IU; the 2016 label rule requires ${expected} (IU may follow in parentheses)`);
        continue;
      }
      const base = expected.split(' ')[0];
      if (declared.toLowerCase() !== base.toLowerCase() && declared.toLowerCase() !== expected.toLowerCase()) {
        wrong.push(`${row.nutrient.name} is declared in ${declared}; the required unit is ${expected}`);
      } else if (expected.includes(' ') && declared.toLowerCase() === base.toLowerCase()) {
        wrong.push(`${row.nutrient.name} is declared in ${declared}; it must read ${expected}`);
      }
    }
    if (wrong.length) {
      return ctx.fail(15, wrong.join('; '), {
        issue: `Unit of measure errors: ${wrong.join('; ')}.`,
        authority: '21 CFR 101.36(b)(2)(ii); 21 CFR 101.9(c)(8)(iv)',
        proposedWording: rows.map((r) => `${r.nutrient.name} ${r.amount ?? ''} ${r.nutrient.unit}`).join(' · '),
      });
    }
    ctx.pass(15, `All ${rows.length} quantified nutrients use the units the 2016 label rule requires.`);
  },

  // Row 16 — minimum reportable quantities and increments
  16(ctx) {
    const rows = ctx.parsed.supplementFacts.rows.filter((r) => r.nutrient?.dv && r.amount !== null);
    if (!rows.length) return ctx.na(16, 'No Daily Value nutrients with a quantified amount.');
    const notes = [];
    for (const row of rows) {
      const pct = (row.amount / row.nutrient.dv) * 100;
      if (pct < 2) notes.push(`${row.nutrient.name} is at ${pct.toFixed(1)}% DV — below the 2% reporting threshold, so it may be omitted or must be declared as a "less than 2%" footnote`);
      if (!roundedToIncrement(row.amount)) {
        notes.push(`${row.nutrient.name} at ${row.amount} ${row.unit} is not expressed in the required increment (${incrementFor(row.amount)})`);
      }
    }
    if (notes.length) {
      return ctx.fail(16, notes.join('; '), {
        type: 'recommendation',
        issue: `Quantitative amounts need adjusting: ${notes.join('; ')}.`,
        authority: '21 CFR 101.9(c)(8)(iv); 21 CFR 101.36(b)(2)(ii)',
      });
    }
    ctx.pass(16, `All ${rows.length} nutrients are above the reporting threshold and expressed in permitted increments.`);
  },

  // Row 17 — % Daily Value accuracy
  17(ctx) {
    const rows = ctx.parsed.supplementFacts.rows.filter((r) => r.nutrient?.dv && r.amount !== null);
    if (!rows.length) return ctx.na(17, 'No nutrients with an established Daily Value are declared.');
    const errors = [];
    const missing = [];
    for (const row of rows) {
      let amount = row.amount;
      // normalise to the DV's own unit before comparing
      const dvUnit = row.nutrient.unit.split(' ')[0].toLowerCase();
      const declaredUnit = (row.unit ?? '').toLowerCase();
      if (declaredUnit === 'mcg' && dvUnit === 'mg') amount /= 1000;
      if (declaredUnit === 'mg' && dvUnit === 'mcg') amount *= 1000;
      if (declaredUnit === 'g' && dvUnit === 'mg') amount *= 1000;
      if (declaredUnit === 'iu' && row.nutrient.iuFactor) amount /= row.nutrient.iuFactor;
      const expected = Math.round((amount / row.nutrient.dv) * 100);
      if (row.declaredDv === null) {
        missing.push(`${row.nutrient.name} (should read ${expected}%)`);
      } else if (Math.abs(row.declaredDv - expected) > 1) {
        errors.push(`${row.nutrient.name} declares ${row.declaredDv}% but ${row.amount} ${row.unit} of a ${row.nutrient.dv} ${row.nutrient.unit} Daily Value is ${expected}%`);
      }
    }
    if (errors.length || missing.length) {
      const all = [...errors, ...(missing.length ? [`no % Daily Value shown for ${missing.join(', ')}`] : [])];
      return ctx.fail(17, all.join('; '), {
        issue: `% Daily Value problems: ${all.join('; ')}.`,
        authority: '21 CFR 101.36(b)(2)(iii); 21 CFR 101.9(c)(8)',
        proposedWording: missing.length ? missing.join('; ') : errors.map((e) => e.split(' declares ')[0]).join(', '),
      });
    }
    ctx.pass(17, `Every % Daily Value recomputes correctly against the 2016 Daily Values (${rows.length} nutrients checked).`);
  },

  // Row 18 — proprietary blend formatting
  18(ctx) {
    // Only rows inside the Supplement Facts panel count. "Immune Defense Complex"
    // on the display panel is a product name, not a blend declaration.
    const blends = blendRows(ctx);
    if (!blends.length) return ctx.na(18, 'The Supplement Facts panel declares no proprietary blend.');
    const unweighed = blends.filter((r) => r.amount === null);
    if (unweighed.length) {
      return ctx.fail(18, `${unweighed.map((r) => r.name).join(', ')} declare no total weight.`, {
        issue: `${unweighed.map((r) => r.name).join(', ')} appear on the panel without a total weight for the blend.`,
        authority: '21 CFR 101.36(c)',
        proposedWording: `${unweighed[0].name} 450 mg †`,
      });
    }
    ctx.pass(18, `${blends.map((r) => `"${r.name}" (${r.amount} ${r.unit})`).join(', ')} declare a total blend weight.`);
  },

  // Row 19 — blend amount and footnote
  19(ctx) {
    if (!blendRows(ctx).length) return ctx.na(19, 'No proprietary blend is declared.');
    const footnoted = ctx.parsed.supplementFacts.footnotes.some((f) => /daily value not established/i.test(f));
    if (!footnoted) {
      return ctx.fail(19, 'The blend carries no "Daily Value not established" footnote.', {
        issue: 'A proprietary blend is declared without the dagger footnote stating that a Daily Value has not been established.',
        authority: '21 CFR 101.36(b)(2)(iii)(B)',
        proposedWording: '† Daily Value not established.',
        absence: true,
      });
    }
    ctx.pass(19, 'The blend is footnoted with "Daily Value not established".');
  },

  // Row 20 — non-DV dietary ingredients footnoted
  20(ctx) {
    const rows = ctx.parsed.supplementFacts.rows;
    const nonDv = rows.filter((r) => !r.nutrient?.dv && r.amount !== null);
    if (!nonDv.length) return ctx.na(20, 'Every declared ingredient has an established Daily Value.');
    const footnoted = ctx.parsed.supplementFacts.footnotes.some((f) => /daily value not established/i.test(f));
    const unmarked = nonDv.filter((r) => !r.footnoteMark && r.declaredDv === null);
    if (!footnoted) {
      return ctx.fail(20, `${nonDv.length} ingredients have no established Daily Value and the panel carries no footnote.`, {
        issue: `${nonDv.map((r) => r.name).join(', ')} have no established Daily Value, and the panel does not carry the required footnote.`,
        authority: '21 CFR 101.36(b)(3)(ii)',
        proposedWording: '† Daily Value not established.',
        absence: true,
      });
    }
    if (unmarked.length) {
      return ctx.fail(20, `${unmarked.map((r) => r.name).join(', ')} are not marked with the footnote symbol.`, {
        type: 'recommendation',
        issue: `${unmarked.map((r) => r.name).join(', ')} carry no dagger linking them to the "Daily Value not established" footnote.`,
        authority: '21 CFR 101.36(b)(3)(ii)',
        proposedWording: unmarked.map((r) => `${r.name} ${r.amount} ${r.unit} †`).join('; '),
      });
    }
    ctx.pass(20, `${nonDv.length} non-Daily-Value ingredients are amount-declared and footnoted.`);
  },

  // Row 21 — botanical referencing
  21(ctx) {
    const rows = ctx.parsed.supplementFacts.rows;
    const botanicals = rows.filter((r) =>
      /extract|root|leaf|bark|fruit|seed|flower|rhizome|herb|aerial|whole plant/i.test(r.name) ||
      /ashwagandha|turmeric|elderberry|ginseng|bacopa|rhodiola|echinacea|milk thistle|saw palmetto|ginkgo|valerian/i.test(r.name));
    if (!botanicals.length) return ctx.na(21, 'No botanical ingredients are declared.');
    const problems = [];
    for (const row of botanicals) {
      const hasLatin = /\(([A-Z][a-z]+ [a-z]+)/.test(row.raw) || /[A-Z][a-z]+ [a-z]+\s*(root|leaf|bark|fruit|seed|flower|rhizome|aerial)/.test(row.raw);
      const hasPart = /\b(root|leaf|leaves|bark|fruit|seed|flower|rhizome|aerial part|whole (herb|plant)|berry|berries)\b/i.test(row.raw);
      const hasRatio = /\d+\s*:\s*\d+|standardi[sz]ed|\d+\s*%/i.test(row.raw);
      const missing = [];
      if (!hasLatin) missing.push('Latin binomial');
      if (!hasPart) missing.push('plant part');
      if (!hasRatio) missing.push('extract ratio or standardisation');
      if (missing.length) problems.push(`${row.name} is missing its ${missing.join(', ')}`);
    }
    if (problems.length) {
      return ctx.fail(21, problems.join('; '), {
        issue: `Botanical referencing is incomplete: ${problems.join('; ')}.`,
        authority: '21 CFR 101.36(b)(3)(ii); 21 CFR 101.4(h)',
        proposedWording: 'Ashwagandha (Withania somnifera) root extract, standardised to 5% withanolides',
      });
    }
    ctx.pass(21, `All ${botanicals.length} botanicals name the Latin binomial, the plant part and the extract basis.`);
  },

  // Row 24 — preservatives and colourants identified
  24(ctx) {
    const list = ctx.parsed.otherIngredients;
    if (!list.length) {
      return ctx.fail(24, 'No "Other Ingredients" declaration was found.', {
        issue: 'The label carries no "Other Ingredients" statement, so preservatives and colourants cannot be identified.',
        authority: '21 CFR 101.4(a); 21 CFR 101.36(d)',
        proposedWording: 'Other Ingredients: Microcrystalline cellulose, magnesium stearate, silicon dioxide.',
        absence: true,
      });
    }
    const problems = [];
    for (const ingredient of list) {
      const hit = FUNCTIONAL_INGREDIENTS.find((f) => f.match.test(ingredient));
      if (!hit || hit.optional) continue;
      const declared = new RegExp(`\\(([^)]*\\b${hit.role}\\b[^)]*)\\)`, 'i').test(ingredient);
      if (!declared) problems.push(`${hit.name} is listed without its function — it must read "${hit.name} (${hit.role})"`);
    }
    if (problems.length) {
      return ctx.fail(24, problems.join('; '), {
        issue: `Functional ingredients are not identified: ${problems.join('; ')}.`,
        authority: '21 CFR 101.22(k)',
        proposedWording: problems.map((p) => p.split('it must read "')[1]?.replace(/"$/, '')).filter(Boolean).join('; '),
      });
    }
    ctx.pass(24, `${list.length} other ingredients read; every preservative and colourant states its function.`);
  },

  // Row 25 — allergen disclosure
  25(ctx) {
    const haystack = [
      ...ctx.parsed.otherIngredients,
      ...ctx.parsed.supplementFacts.rows.map((r) => r.name),
    ].join(' ; ');
    const detected = MAJOR_ALLERGENS.filter((a) => a.patterns.some((p) => p.test(haystack)));
    if (!detected.length) {
      return ctx.pass(25, 'No major food allergen was detected in the declared ingredients.');
    }
    const statement = ctx.parsed.allergenStatement ?? '';
    const undeclared = detected.filter((a) => !new RegExp(a.name.split(' ')[0], 'i').test(statement));
    if (undeclared.length) {
      return ctx.fail(25, `${undeclared.map((a) => a.name).join(', ')} detected in the ingredients but not in a "Contains" statement.`, {
        issue: `${undeclared.map((a) => a.name).join(', ')} appear in the ingredient declaration but are not disclosed in a "Contains" statement.`,
        authority: 'FALCPA §203; FASTER Act 2021; 21 U.S.C. §343(w)',
        proposedWording: `Contains: ${detected.map((a) => a.name).join(', ')}.`,
        evidence: `matched in: ${haystack.slice(0, 160)}`,
      });
    }
    ctx.pass(25, `Contains statement declares ${detected.map((a) => a.name).join(', ')}, matching the ingredient list.`);
  },

  // Row 27 — firm statement with a physical street address
  27(ctx) {
    const { firm, streetAddress } = ctx.parsed;
    if (!firm) {
      return ctx.fail(27, 'No manufacturer or distributor statement was found.', {
        issue: 'The information panel carries no statement of the firm responsible for the product.',
        authority: '21 CFR 101.5; 21 CFR 101.36(b)(5)',
        proposedWording: 'Distributed By: Enova Science, 123 Example Parkway, Suite 100, City, ST 00000',
        absence: true,
      });
    }
    // Enova house rule, tighter than the regulation
    if (!/^(distributed by|manufactured for)$/i.test(firm.relationship.replace(/[:.]/g, '').trim())) {
      return ctx.fail(27, `"${firm.relationship}" does not disclose the relationship to the firm.`, {
        issue: `The panel reads "${firm.relationship}". The Enova guideline requires the relationship to be disclosed with "Distributed By" or "Manufactured For" — a bare "Manufactured" does not disclose it.`,
        authority: '21 CFR 101.5(a); Enova Label Review Master Template',
        proposedWording: `Distributed By: ${firm.block.split('\n')[0]}`,
      });
    }
    if (!streetAddress) {
      return ctx.fail(27, 'The firm statement carries no physical street address.', {
        issue: `The "${firm.relationship}" block does not include a physical street address. Checklist row 32 of the master template requires a street address; email, website and phone are optional.`,
        authority: '21 CFR 101.5(d); Enova Label Review Master Template row 32',
        proposedWording: `${firm.relationship} ${firm.block.split('\n')[0]}, 123 Example Parkway, Suite 100, City, ST 00000`,
        absence: true,
      });
    }
    ctx.pass(27, `"${firm.relationship}" with a physical street address (${streetAddress}).`);
  },

  // Row 29 — suggested use present
  29(ctx) {
    if (!ctx.parsed.directions) {
      return ctx.fail(29, 'No suggested use or directions statement was found.', {
        issue: 'The label carries no suggested use / directions statement.',
        authority: '21 CFR 101.36(b)(1); Enova panel doctrine (left side panel)',
        proposedWording: 'Suggested Use: Take 2 capsules daily with food, or as directed by your healthcare professional.',
        absence: true,
      });
    }
    if (!/\b(daily|per day|twice|morning|evening|with (food|water|a meal))\b/i.test(ctx.parsed.directions)) {
      return ctx.fail(29, `"${ctx.parsed.directions}" does not state a frequency.`, {
        type: 'recommendation',
        issue: `The suggested use reads "${ctx.parsed.directions}" without stating how often to take it.`,
        authority: '21 CFR 101.36(b)(1)',
        proposedWording: `${ctx.parsed.directions.replace(/\.$/, '')} daily with food.`,
      });
    }
    ctx.pass(29, `Suggested use present: "${ctx.parsed.directions}".`);
  },

  // Row 30 — suggested use consistent with the serving size
  30(ctx) {
    const use = ctx.parsed.directionsCount;
    const serving = ctx.parsed.supplementFacts.servingCount;
    if (!use || serving === null) {
      return ctx.unreviewed(30, 'Either the suggested use or the serving size has no countable quantity, so the two cannot be reconciled from the copy.');
    }
    if (use.min !== serving || use.max !== serving) {
      const range = use.min === use.max ? `${use.min}` : `${use.min} to ${use.max}`;
      return ctx.fail(30, `Directions say ${range} ${use.unit}; the panel declares a ${serving}-${use.unit.replace(/s$/, '')} serving.`, {
        issue: `The directions say ${range} ${use.unit} while the Supplement Facts panel declares a serving size of ${serving}. A range that does not match the declared serving makes the % Daily Values unverifiable.`,
        authority: '21 CFR 101.36(b)(1); 21 CFR 101.9(b)',
        proposedWording: `${serving} ${use.unit}`,
        evidence: ctx.parsed.directions,
      });
    }
    ctx.pass(30, `Directions (${use.min} ${use.unit}) match the declared ${serving}-unit serving size.`);
  },

  // Row 31 — ingredient-triggered mandatory warnings
  31(ctx) {
    const ingredientText = [
      ...ctx.parsed.supplementFacts.rows.map((r) => r.raw),
      ...ctx.parsed.otherIngredients,
    ].join(' ; ');
    const warnings = ctx.parsed.warnings ?? '';
    const triggered = MANDATORY_WARNINGS.filter((w) =>
      w.trigger.test(ingredientText) && !(w.exclude && w.exclude.test(ingredientText)));
    if (!triggered.length) return ctx.pass(31, 'No ingredient on this label triggers a mandatory warning statement.');

    const missing = triggered.filter((w) => !w.required.test(`${warnings} ${ctx.parsed.text}`));
    if (missing.length) {
      for (const w of missing) {
        ctx.finding({
          rowId: 31,
          type: w.severity ?? 'required',
          issue: `${w.name}: the label declares an ingredient that triggers this statement, but the statement was not found.`,
          authority: w.authority,
          proposedWording: w.wording,
          absence: true,
        });
      }
      return ctx.set(31, 'fail', `Missing: ${missing.map((w) => w.name).join('; ')}.`);
    }
    ctx.pass(31, `Present: ${triggered.map((w) => w.name).join('; ')}.`);
  },

  // Row 32 — general cautions
  32(ctx) {
    const text = ctx.parsed.text;
    const checks = [
      { name: 'Keep out of reach of children', re: /keep out of (the )?reach of children/i, wording: 'KEEP OUT OF REACH OF CHILDREN.' },
      { name: 'Pregnancy / nursing', re: /pregnant|nursing|lactating/i, wording: 'If you are pregnant, nursing, or taking medication, consult your healthcare professional before use.' },
      { name: 'Consult a physician', re: /consult (your|a) (healthcare|health care|physician|doctor)/i, wording: 'Consult your healthcare professional before use.' },
      { name: 'Tamper evidence', re: /do not use if (the )?(seal|safety seal|band|shrink band)/i, wording: 'Do not use if the safety seal is broken or missing.' },
      { name: 'Storage', re: /store (in|at)|keep (in a )?(cool|dry)/i, wording: 'Store in a cool, dry place away from direct sunlight.' },
    ];
    const missing = checks.filter((c) => !c.re.test(text));
    if (missing.length) {
      for (const m of missing) {
        ctx.finding({
          rowId: 32,
          type: m.name === 'Keep out of reach of children' ? 'required' : 'recommendation',
          issue: `${m.name} statement was not found on the label.`,
          authority: m.name === 'Keep out of reach of children' ? '21 CFR 101.17(e); industry standard of care' : 'Enova panel doctrine (left side panel cautions)',
          proposedWording: m.wording,
          absence: true,
        });
      }
      return ctx.set(32, 'fail', `Missing: ${missing.map((m) => m.name).join('; ')}.`);
    }
    ctx.pass(32, 'Keep-out-of-reach, pregnancy, physician, tamper-evidence and storage cautions are all present.');
  },

  // Row 35 — claims must not be disease claims
  35(ctx) {
    const text = ctx.parsed.text;
    const hits = [];
    for (const term of DISEASE_CLAIM_TERMS) {
      const re = new RegExp(`[^.!?\\n]*\\b${term}\\w*\\b[^.!?\\n]*[.!?]?`, 'gi');
      for (const sentence of text.match(re) ?? []) {
        const trimmed = clean(sentence);
        // the DSHEA disclaimer itself contains "diagnose, treat, cure, or prevent"
        if (/have not been evaluated/i.test(trimmed)) continue;
        if (/not intended to diagnose/i.test(trimmed)) continue;
        if (trimmed.length < 6) continue;
        hits.push({ term, sentence: trimmed });
      }
    }
    if (hits.length) {
      for (const hit of hits.slice(0, 6)) {
        const corrected = proposeClaimRewrite(hit.sentence);
        ctx.finding({
          rowId: 35,
          type: 'required',
          issue: `"${hit.sentence}" reads as a disease claim ("${hit.term}"). A dietary supplement may not claim to diagnose, treat, cure or prevent a disease without an approved health claim.`,
          authority: '21 U.S.C. §343(r)(6); 21 CFR 101.93(g)',
          proposedWording: corrected
            ?? 'Rewrite as a structure/function claim describing the effect on normal structure or function — no lawful wording preserves this sentence.',
          evidence: hit.sentence,
        });
      }
      return ctx.set(35, 'fail', `${hits.length} statement(s) read as disease claims.`);
    }
    if (!/\b(supports?|helps? (maintain|support|promote)|promotes?|maintains?)\b/i.test(text)) {
      return ctx.na(35, 'No structure/function or health claims appear in the submitted copy.');
    }
    ctx.pass(35, 'Claims read as structure/function statements; no disease claim language was found.');
  },

  // Row 38 — UPC
  38(ctx) {
    const upc = ctx.parsed.upc;
    if (!upc) {
      return ctx.fail(38, 'No UPC digits were found in the copy.', {
        type: 'recommendation',
        issue: 'No UPC was found. Confirm whether this SKU is sold at retail and requires one.',
        authority: 'GS1 US retail requirement (not an FDA requirement)',
        absence: true,
      });
    }
    const valid = upcCheckDigitValid(upc);
    if (valid === false) {
      return ctx.fail(38, `UPC ${upc} fails its check digit.`, {
        issue: `The UPC-A ${upc} does not pass the GS1 modulo-10 check digit. A printed barcode with a bad check digit will not scan at retail.`,
        authority: 'GS1 General Specifications §7.9',
        proposedWording: `${upc.slice(0, 11)}${(10 - (upc.slice(0, 11).split('').reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10}`,
      });
    }
    ctx.pass(38, valid ? `UPC-A ${upc} passes its GS1 check digit.` : `${upc.length}-digit code ${upc} present (EAN-13 check digit not verified here).`);
  },
};

/** The DSHEA disclaimer is judged against row 33, whose box border needs artwork. */
function reviewDisclaimer(ctx) {
  const { present, exact } = ctx.parsed.disclaimer;
  if (!present) {
    ctx.finding({
      rowId: 33,
      type: 'required',
      issue: 'The DSHEA disclaimer was not found on the label.',
      authority: '21 CFR 101.93(b)-(d)',
      proposedWording: DSHEA_DISCLAIMER,
      absence: true,
    });
  } else if (!exact) {
    ctx.finding({
      rowId: 33,
      type: 'required',
      issue: 'The DSHEA disclaimer is present but does not match the wording 21 CFR 101.93(c) prescribes.',
      authority: '21 CFR 101.93(c)',
      proposedWording: DSHEA_DISCLAIMER,
      evidence: /[^.]*have not been evaluated[^.]*\.[^.]*\./i.exec(ctx.parsed.text)?.[0] ?? '',
    });
  }
}

/**
 * Convert an amount into one comparable scale (the nutrient's own unit, or
 * milligrams when there is no matched nutrient). Returns null when the units
 * cannot be reconciled — the caller then asks a person to look rather than
 * inventing a mismatch.
 */
function toComparable(amount, unit, nutrient) {
  const from = String(unit ?? '').toLowerCase().split(' ')[0];
  const target = (nutrient?.unit ?? 'mg').toLowerCase().split(' ')[0];
  if (from === 'iu') {
    if (!nutrient?.iuFactor) return null;
    return amount / nutrient.iuFactor;             // IU -> the nutrient's own unit
  }
  const TO_MG = { mcg: 0.001, µg: 0.001, ug: 0.001, mg: 1, g: 1000 };
  if (!(from in TO_MG) || !(target in TO_MG)) return from === target ? amount : null;
  return (amount * TO_MG[from]) / TO_MG[target];
}

/** Cross-check the declared panel against the linked master formula. */
function reviewAgainstFormula(ctx) {
  if (!ctx.formula) return;
  const rows = ctx.parsed.supplementFacts.rows;
  for (const active of ctx.formula.actives ?? []) {
    // match on the resolved nutrient first — "Vitamin C" must not bind to the
    // "Vitamin D" row just because both start with the word "Vitamin"
    const activeNutrient = matchNutrient(active.name);
    const normalised = String(active.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const row = rows.find((r) => activeNutrient && r.nutrient?.key === activeNutrient.key)
      ?? rows.find((r) => r.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(normalised));
    if (!row) {
      ctx.finding({
        rowId: 14,
        type: 'recommendation',
        issue: `${active.name} is in master formula ${ctx.formula.code} but no matching row was read on the Supplement Facts panel.`,
        authority: '21 CFR 111.70(b); 21 CFR 101.36(b)(2)',
        proposedWording: `${active.name} ${active.labelClaim ?? active.targetMg} ${active.labelUnit ?? 'mg'}`,
        absence: true,
      });
      continue;
    }
    const claim = Number(active.labelClaim ?? active.targetMg);
    const claimUnit = active.labelUnit ?? 'mg';
    if (row.amount === null || !Number.isFinite(claim)) continue;

    // Compare like with like: 25 mcg of vitamin D and a 1,000 IU formula claim
    // are the same dose, and flagging them as a mismatch would be a false alarm.
    const labelAmount = toComparable(row.amount, row.unit, row.nutrient ?? activeNutrient);
    const formulaAmount = toComparable(claim, claimUnit, row.nutrient ?? activeNutrient);
    if (labelAmount === null || formulaAmount === null) {
      ctx.finding({
        rowId: 14,
        type: 'recommendation',
        issue: `${active.name} is declared in ${row.unit ?? 'no unit'} on the label and ${claimUnit} in master formula ${ctx.formula.code}. The two cannot be reconciled automatically — check them by hand.`,
        authority: '21 CFR 111.70(b)',
        proposedWording: `${active.name} ${claim} ${claimUnit}`,
        evidence: row.raw,
      });
      continue;
    }
    if (Math.abs(labelAmount - formulaAmount) / Math.max(formulaAmount, 1e-9) > 0.02) {
      ctx.finding({
        rowId: 14,
        type: 'required',
        issue: `${active.name} declares ${row.amount} ${row.unit} on the label but the master formula ${ctx.formula.code} carries a label claim of ${claim} ${claimUnit}.`,
        authority: '21 CFR 111.70(b); 21 CFR 101.36(b)(2)(ii)',
        proposedWording: `${active.name} ${claim} ${claimUnit}`,
        evidence: row.raw,
      });
    }
  }
}

// ── public entry point ─────────────────────────────────────────────────────
/**
 * Review a label.
 *
 * @param {object} input
 * @param {object} input.panels   panel copy keyed by panel
 * @param {object} [input.formula] linked master formula for cross-checks
 * @param {string} [input.source] 'text' | 'pdf' | 'image' | 'artwork'
 * @param {object} [input.ocr]    { pixelsPerLetter, confidence } when the copy was read by OCR
 */
export function reviewLabel({ panels = {}, formula = null, source = 'text', ocr = null } = {}) {
  const parsed = parseLabel(panels);
  const evidenceIsSoft = source === 'image' || source === 'artwork' || Boolean(ocr);
  const ctx = new ReviewContext({ parsed, formula, source, evidenceIsSoft });

  // Read quality gate — a compliance engine run on noise invents findings.
  const readQuality = ocr
    ? {
      usable: (ocr.pixelsPerLetter ?? 99) >= 10 && (ocr.confidence ?? 1) >= 0.45,
      pixelsPerLetter: ocr.pixelsPerLetter ?? null,
      confidence: ocr.confidence ?? null,
    }
    : { usable: true, pixelsPerLetter: null, confidence: null };

  if (!readQuality.usable) {
    return {
      parsed,
      readQuality,
      checklist: CHECKLIST.map((item) => ({
        ...item,
        state: 'not_reviewed',
        comment: 'The submitted copy could not be read reliably enough to review. Supply the print PDF or a 300 dpi export, or paste the panel copy.',
      })),
      findings: [],
      metrics: { total: CHECKLIST.length, reviewed: 0, pass: 0, fail: 0, notReviewed: CHECKLIST.length, na: 0, completionPct: 0, requiredCorrections: 0, recommendations: 0 },
      generatedAt: new Date().toISOString(),
    };
  }

  // Rows the copy can settle.
  for (const [rowId, rule] of Object.entries(RULES)) {
    try {
      rule(ctx);
    } catch (err) {
      ctx.unreviewed(Number(rowId), `The rule for this row could not complete: ${err.message}. Review by hand.`);
    }
  }
  reviewDisclaimer(ctx);
  reviewAgainstFormula(ctx);

  // Rows that need the artwork or a file that is not the label are never ticked.
  const checklist = CHECKLIST.map((item) => {
    const decided = ctx.states.get(item.id);
    if (decided) return { ...item, ...decided };
    const reason = item.needs === 'art'
      ? (item.look || 'This item is about placement, drawing or print appearance and cannot be settled from the copy.')
      : 'This item is settled against the Master Formula, the substantiation file or a trademark licence agreement — none of which is the label.';
    return { ...item, state: 'not_reviewed', comment: reason };
  });

  const tally = (state) => checklist.filter((c) => c.state === state).length;
  const metrics = {
    total: checklist.length,
    pass: tally('pass'),
    fail: tally('fail'),
    na: tally('na'),
    notReviewed: tally('not_reviewed'),
    reviewed: checklist.length - tally('not_reviewed'),
    completionPct: Math.round(((checklist.length - tally('not_reviewed')) / checklist.length) * 100),
    requiredCorrections: ctx.findings.filter((f) => f.type === 'required').length,
    recommendations: ctx.findings.filter((f) => f.type === 'recommendation').length,
  };

  return { parsed, readQuality, checklist, findings: ctx.findings, metrics, generatedAt: new Date().toISOString() };
}

// ── Supplement Facts generator ─────────────────────────────────────────────
/**
 * Build a compliant Supplement Facts panel from a master formula: correct
 * nutrient order, 2016 units, recomputed % Daily Values, and the dagger
 * footnote for ingredients with no established Daily Value.
 */
export function generateSupplementFacts(formula) {
  if (!formula) throw new Error('generateSupplementFacts requires a formula');
  const rows = [];
  let needsFootnote = false;

  for (const active of formula.actives ?? []) {
    const nutrient = matchNutrient(active.name);
    const claimUnit = (active.labelUnit ?? 'mg').toLowerCase();
    let amount = Number(active.labelClaim ?? active.targetMg ?? 0);
    let unit = active.labelUnit ?? 'mg';
    let iuNote = null;

    if (nutrient) {
      // convert the declared claim into the unit the 2016 rule requires
      const target = nutrient.unit.split(' ')[0].toLowerCase();
      if (claimUnit === 'iu' && nutrient.iuFactor) {
        iuNote = amount;
        amount = amount / nutrient.iuFactor;
        unit = nutrient.unit;
      } else if (claimUnit === 'mg' && target === 'mcg') {
        amount *= 1000; unit = nutrient.unit;
      } else if (claimUnit === 'mcg' && target === 'mg') {
        amount /= 1000; unit = nutrient.unit;
      } else {
        unit = nutrient.unit;
      }
    }

    const inc = incrementFor(amount);
    const displayAmount = Math.round(amount / inc) * inc;
    const pctDv = nutrient?.dv ? Math.round((amount / nutrient.dv) * 100) : null;
    if (pctDv === null) needsFootnote = true;

    rows.push({
      name: nutrient?.name ?? active.name,
      sourceForm: active.form || (/\(as /i.test(active.name) ? '' : ''),
      display: nutrient && active.form ? `${nutrient.name} (as ${active.form})` : active.name,
      amount: Number(displayAmount.toFixed(3)),
      unit,
      iuEquivalent: iuNote,
      pctDv,
      footnote: pctDv === null,
      order: nutrient?.order ?? 900 + rows.length,
      hasDv: pctDv !== null,
    });
  }

  rows.sort((a, b) => a.order - b.order);

  const otherIngredients = (formula.excipients ?? [])
    .filter((e) => !/^(gummy base|mcc|microcrystalline)/i.test(e.name) || true)
    .map((e) => e.name);

  return {
    servingSize: formula.servingSize ?? '1 serving',
    servingsPerContainer: formula.servingsPerUnit ?? null,
    rows,
    otherIngredients,
    footnotes: needsFootnote ? ['† Daily Value not established.'] : [],
    dvBasis: 'Percent Daily Values are based on a 2,000 calorie diet.',
    generatedAt: new Date().toISOString(),
  };
}

/** Render the generated panel as the plain-text block a reviewer can paste. */
export function renderSupplementFactsText(panel) {
  const out = ['Supplement Facts'];
  out.push(`Serving Size: ${panel.servingSize}`);
  if (panel.servingsPerContainer) out.push(`Servings Per Container: ${panel.servingsPerContainer}`);
  out.push('');
  out.push('Amount Per Serving\t% Daily Value');
  for (const row of panel.rows) {
    const amount = `${row.amount} ${row.unit}${row.iuEquivalent ? ` (${row.iuEquivalent} IU)` : ''}`;
    out.push(`${row.display}\t${amount}\t${row.pctDv === null ? '†' : `${row.pctDv}%`}`);
  }
  if (panel.footnotes.length) { out.push(''); out.push(...panel.footnotes); }
  if (panel.otherIngredients.length) {
    out.push('');
    out.push(`Other Ingredients: ${panel.otherIngredients.join(', ')}.`);
  }
  return out.join('\n');
}

export { PANEL_KEYS, PANEL_LABELS, DAILY_VALUES };
