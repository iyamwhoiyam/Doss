import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reviewLabel, parseLabel, parseFactRow, upcCheckDigitValid,
  generateSupplementFacts, renderSupplementFactsText, CHECKLIST,
} from './labelEngine.js';

/** A clean, compliant 60-count capsule label. */
const goodLabel = {
  pdp: `NORDVITA
Immune Defense Complex
Dietary Supplement
60 Capsules`,
  information: `Supplement Facts
Serving Size: 2 Capsules
Servings Per Container: 30

Amount Per Serving   % Daily Value
Vitamin D (as cholecalciferol)   25 mcg (1,000 IU)   125%
Vitamin C (as ascorbic acid)   250 mg   278%
Zinc (as zinc bisglycinate chelate)   15 mg   136%
Elderberry (Sambucus nigra) fruit extract, standardized to 10:1   150 mg   †

† Daily Value not established.

Other Ingredients: Microcrystalline cellulose, hypromellose (capsule), magnesium stearate, silicon dioxide.

Distributed By: Nordvita Health LLC, 4820 Commerce Parkway, Suite 210, Boulder, CO 80301

012345678905`,
  leftSide: `Suggested Use: Take 2 capsules daily with food, or as directed by your healthcare professional.

Supports a healthy immune response.

WARNING: KEEP OUT OF REACH OF CHILDREN. If you are pregnant, nursing, or taking medication, consult your healthcare professional before use. Do not use if the safety seal is broken or missing. Store in a cool, dry place away from direct sunlight.

These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.

Rev. 3 - 04/26`,
};

const rowState = (result, id) => result.checklist.find((c) => c.id === id).state;
const findingsFor = (result, id) => result.findings.filter((f) => f.rowId === id);

test('the checklist has all 41 rows and the 20 evidence-blocked ones are never ticked', () => {
  assert.equal(CHECKLIST.length, 41);
  const result = reviewLabel({ panels: goodLabel, source: 'text' });
  const blocked = CHECKLIST.filter((c) => c.needs !== 'copy');
  assert.equal(blocked.length, 20);
  for (const item of blocked) {
    assert.equal(rowState(result, item.id), 'not_reviewed', `row ${item.id} must not be ticked from copy alone`);
    assert.ok(result.checklist.find((c) => c.id === item.id).comment.length > 20, `row ${item.id} must say what to look at`);
  }
  assert.equal(result.metrics.notReviewed, 20);
});

test('a clean label produces no required corrections', () => {
  const result = reviewLabel({ panels: goodLabel, source: 'text' });
  const required = result.findings.filter((f) => f.type === 'required');
  assert.deepEqual(required.map((f) => `${f.rowId}: ${f.issue}`), []);
  assert.equal(result.metrics.fail, 0);
  assert.equal(result.metrics.completionPct, 51); // 21 of 41 rows settled from copy
});

test('panel copy is parsed into the fields a reviewer needs', () => {
  const parsed = parseLabel(goodLabel);
  assert.equal(parsed.brand, 'NORDVITA');
  assert.equal(parsed.productName, 'Immune Defense Complex');
  assert.equal(parsed.statementOfIdentity, true);
  assert.deepEqual(parsed.netQuantity, { value: 60, unit: 'capsules', text: '60 Capsules' });
  assert.equal(parsed.supplementFacts.servingsPerContainer, 30);
  assert.equal(parsed.supplementFacts.servingCount, 2);
  assert.equal(parsed.supplementFacts.rows.length, 4);
  assert.equal(parsed.firm.relationship, 'Distributed By');
  assert.match(parsed.streetAddress, /4820 Commerce Parkway/);
  assert.equal(parsed.upc, '012345678905');
  assert.deepEqual(parsed.revisionMark, { revision: '3', date: '04/26', text: 'Rev. 3 - 04/26' });
  assert.equal(parsed.disclaimer.exact, true);
  assert.equal(parsed.otherIngredients.length, 4);
});

test('a Supplement Facts row parses name, amount, unit, IU equivalent and %DV', () => {
  const row = parseFactRow('Vitamin D (as cholecalciferol)   25 mcg (1,000 IU)   125%');
  assert.equal(row.name, 'Vitamin D (as cholecalciferol)');
  assert.equal(row.amount, 25);
  assert.equal(row.unit, 'mcg');
  assert.equal(row.iuEquivalent, 1000);
  assert.equal(row.declaredDv, 125);
  assert.equal(row.nutrient.key, 'vitamin_d');
});

test('a wrong % Daily Value is caught and the correct figure proposed', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace('250 mg   278%', '250 mg   417%'),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 17), 'fail');
  const finding = findingsFor(result, 17)[0];
  assert.match(finding.issue, /Vitamin C declares 417%/);
  assert.match(finding.issue, /is 278%/);
  assert.equal(finding.authority, '21 CFR 101.36(b)(2)(iii); 21 CFR 101.9(c)(8)');
});

test('IU as the primary unit is rejected under the 2016 label rule', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace('25 mcg (1,000 IU)   125%', '1000 IU   125%'),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 15), 'fail');
  assert.match(findingsFor(result, 15)[0].issue, /declared in IU/);
});

test('nutrients out of regulation order are reordered in the proposed wording', () => {
  // The 2016 label rule leads the vitamin block with Vitamin D, so putting
  // Vitamin C first is a defect even though it reads alphabetically.
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace(
      'Vitamin D (as cholecalciferol)   25 mcg (1,000 IU)   125%\nVitamin C (as ascorbic acid)   250 mg   278%',
      'Vitamin C (as ascorbic acid)   250 mg   278%\nVitamin D (as cholecalciferol)   25 mcg (1,000 IU)   125%',
    ),
  };
  assert.equal(parseLabel(panels).supplementFacts.rows[0].nutrient.key, 'vitamin_c');
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 12), 'fail');
  const finding = findingsFor(result, 12)[0];
  assert.equal(finding.proposedWording, 'Vitamin D, Vitamin C, Zinc');
  assert.match(finding.authority, /101\.36\(b\)\(2\)\(i\)/);
});

test('a proprietary blend on the panel is checked, but a product name is not mistaken for one', () => {
  // "Immune Defense Complex" is the product name on the PDP — not a blend row.
  const clean = reviewLabel({ panels: goodLabel, source: 'text' });
  assert.equal(rowState(clean, 18), 'na');

  const withBlend = {
    ...goodLabel,
    information: goodLabel.information.replace(
      'Elderberry (Sambucus nigra) fruit extract, standardized to 10:1   150 mg   †',
      'Immune Support Blend   †',
    ),
  };
  const result = reviewLabel({ panels: withBlend, source: 'text' });
  assert.equal(rowState(result, 18), 'fail');
  assert.match(findingsFor(result, 18)[0].issue, /without a total weight/);
});

test('servings per container that does not reconcile with the net quantity fails', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace('Servings Per Container: 30', 'Servings Per Container: 60'),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 9), 'fail');
  assert.match(findingsFor(result, 9)[0].proposedWording, /Servings Per Container: 30/);
});

test('directions that disagree with the declared serving size are caught with the fix', () => {
  const panels = {
    ...goodLabel,
    leftSide: goodLabel.leftSide.replace('Take 2 capsules daily', 'Take 2 to 4 capsules daily'),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 30), 'fail');
  const finding = findingsFor(result, 30)[0];
  assert.match(finding.issue, /2 to 4 capsules/);
  assert.equal(finding.proposedWording, '2 capsules');
});

test('an undeclared major allergen is caught from the ingredient list', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace('silicon dioxide.', 'silicon dioxide, soy lecithin.'),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 25), 'fail');
  const finding = findingsFor(result, 25)[0];
  assert.match(finding.issue, /Soybeans/);
  assert.match(finding.proposedWording, /^Contains: /);
  assert.match(finding.authority, /FALCPA/);
});

test('an iron-containing label without the overdose warning is a required correction', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace(
      'Zinc (as zinc bisglycinate chelate)   15 mg   136%',
      'Iron (as ferrous bisglycinate)   18 mg   100%',
    ),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 31), 'fail');
  const finding = findingsFor(result, 31)[0];
  assert.equal(finding.type, 'required');
  assert.equal(finding.authority, '21 CFR 101.17(e)');
  assert.match(finding.proposedWording, /leading cause of fatal poisoning/);
});

test('a bare "Manufactured:" fails the Enova relationship-disclosure house rule', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace('Distributed By:', 'Manufactured:'),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 27), 'fail');
  assert.match(findingsFor(result, 27)[0].issue, /"Distributed By" or "Manufactured For"/);
});

test('a firm statement with no street address fails', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace(
      'Nordvita Health LLC, 4820 Commerce Parkway, Suite 210, Boulder, CO 80301',
      'Nordvita Health LLC, nordvita.com, 1-800-555-0134',
    ),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 27), 'fail');
  assert.match(findingsFor(result, 27)[0].authority, /Enova Label Review Master Template row 32/);
});

test('a disease claim is rewritten without destroying the customer trademark', () => {
  const panels = {
    ...goodLabel,
    pdp: 'ACNEVEYA\nCystic Acne Formula\nDietary Supplement\n60 Capsules',
    leftSide: `${goodLabel.leftSide}\nClinically shown to treat cystic acne.`,
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 35), 'fail');
  const finding = result.findings.find((f) => f.rowId === 35 && /treat cystic acne/i.test(f.evidence));
  assert.match(finding.proposedWording, /support skin health/i);
  assert.doesNotMatch(finding.proposedWording, /ACNEVEYA/i, 'the brand mark must not be rewritten');
  assert.equal(finding.authority, '21 U.S.C. §343(r)(6); 21 CFR 101.93(g)');
});

test('a missing DSHEA disclaimer is raised against row 33', () => {
  const panels = {
    ...goodLabel,
    leftSide: goodLabel.leftSide.replace(/These statements[^]*?disease\./, ''),
  };
  const result = reviewLabel({ panels, source: 'text' });
  const finding = findingsFor(result, 33)[0];
  assert.equal(finding.type, 'required');
  assert.equal(finding.authority, '21 CFR 101.93(b)-(d)');
  assert.match(finding.proposedWording, /^These statements have not been evaluated/);
});

test('absence read by OCR becomes a confirm-against-artwork recommendation', () => {
  const panels = { ...goodLabel, leftSide: goodLabel.leftSide.replace(/These statements[^]*?disease\./, '') };
  const result = reviewLabel({ panels, source: 'image', ocr: { pixelsPerLetter: 22, confidence: 0.82 } });
  const finding = findingsFor(result, 33)[0];
  assert.equal(finding.type, 'recommendation');
  assert.match(finding.issue, /read by OCR/);
});

test('a read too poor to use is refused rather than reviewed', () => {
  const result = reviewLabel({ panels: goodLabel, source: 'image', ocr: { pixelsPerLetter: 6, confidence: 0.3 } });
  assert.equal(result.readQuality.usable, false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.metrics.notReviewed, 41);
  assert.match(result.checklist[0].comment, /print PDF or a 300 dpi export/);
});

test('a botanical missing its plant part or standardisation is flagged', () => {
  const panels = {
    ...goodLabel,
    information: goodLabel.information.replace(
      'Elderberry (Sambucus nigra) fruit extract, standardized to 10:1   150 mg   †',
      'Elderberry Extract   150 mg   †',
    ),
  };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 21), 'fail');
  assert.match(findingsFor(result, 21)[0].issue, /Latin binomial/);
});

test('a bad UPC check digit is caught and the correct digit proposed', () => {
  assert.equal(upcCheckDigitValid('012345678905'), true);
  assert.equal(upcCheckDigitValid('012345678901'), false);
  const panels = { ...goodLabel, information: goodLabel.information.replace('012345678905', '012345678901') };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(rowState(result, 38), 'fail');
  assert.equal(findingsFor(result, 38)[0].proposedWording, '012345678905');
});

test('a label claim that disagrees with the master formula is caught against row 14', () => {
  const formula = {
    code: 'F-1042',
    servingsPerUnit: 30,
    actives: [
      { name: 'Vitamin C', targetMg: 250, labelClaim: 500, labelUnit: 'mg' },
    ],
  };
  const result = reviewLabel({ panels: goodLabel, source: 'text', formula });
  const finding = findingsFor(result, 14)[0];
  assert.equal(finding.type, 'required');
  assert.match(finding.issue, /declares 250 mg on the label but the master formula F-1042/);
  assert.equal(finding.proposedWording, 'Vitamin C 500 mg');
});

test('the Supplement Facts generator orders nutrients, converts IU and footnotes non-DV rows', () => {
  const panel = generateSupplementFacts({
    servingSize: '2 Gummies',
    servingsPerUnit: 30,
    actives: [
      { name: 'Elderberry extract', targetMg: 100 },
      { name: 'Zinc', form: 'zinc citrate', targetMg: 11, labelClaim: 11, labelUnit: 'mg' },
      { name: 'Vitamin D3', form: 'cholecalciferol', targetMg: 0.025, labelClaim: 1000, labelUnit: 'IU' },
      { name: 'Vitamin C', form: 'ascorbic acid', targetMg: 90, labelClaim: 90, labelUnit: 'mg' },
    ],
    excipients: [{ name: 'Pectin' }, { name: 'Citric acid' }],
  });

  // regulation order: Vitamin D leads the block, then the remaining vitamins,
  // then the remaining minerals, then ingredients with no Daily Value
  assert.deepEqual(panel.rows.map((r) => r.name), ['Vitamin D', 'Vitamin C', 'Zinc', 'Elderberry extract']);
  const d = panel.rows[0];
  assert.equal(d.amount, 25);           // 1000 IU ÷ 40 = 25 mcg
  assert.equal(d.unit, 'mcg');
  assert.equal(d.iuEquivalent, 1000);
  assert.equal(d.pctDv, 125);           // 25 / 20 mcg DV
  assert.equal(panel.rows[1].pctDv, 100); // Vitamin C 90 / 90 mg
  assert.equal(panel.rows.at(-1).pctDv, null);
  assert.deepEqual(panel.footnotes, ['† Daily Value not established.']);

  const text = renderSupplementFactsText(panel);
  assert.match(text, /Vitamin D \(as cholecalciferol\)\t25 mcg \(1000 IU\)\t125%/);
  assert.match(text, /Other Ingredients: Pectin, Citric acid\./);
});

test('a generated panel passes its own review', () => {
  const panel = generateSupplementFacts({
    servingSize: '2 Capsules',
    servingsPerUnit: 30,
    actives: [
      { name: 'Vitamin C', form: 'ascorbic acid', targetMg: 250, labelClaim: 250, labelUnit: 'mg' },
      { name: 'Zinc', form: 'zinc bisglycinate chelate', targetMg: 15, labelClaim: 15, labelUnit: 'mg' },
    ],
    excipients: [{ name: 'Microcrystalline cellulose' }],
  });
  const panels = { ...goodLabel, information: `${renderSupplementFactsText(panel)}\n\nDistributed By: Nordvita Health LLC, 4820 Commerce Parkway, Suite 210, Boulder, CO 80301\n\n012345678905` };
  const result = reviewLabel({ panels, source: 'text' });
  assert.equal(result.findings.filter((f) => f.type === 'required').length, 0);
  assert.equal(rowState(result, 17), 'pass');
});

test('a rewritten disease claim reads as lawful copy, never as mangled text', () => {
  const panels = {
    ...goodLabel,
    leftSide: `${goodLabel.leftSide}\nHelps prevent colds and flu.`,
  };
  const result = reviewLabel({ panels, source: 'text' });
  const finding = result.findings.find((f) => f.rowId === 35 && /prevent colds/i.test(f.evidence));
  assert.equal(finding.proposedWording, 'Supports a healthy immune response.');
  assert.doesNotMatch(finding.proposedWording, /\b(\w+) \1\b/i, 'no duplicated words');
  assert.doesNotMatch(finding.proposedWording, /prevent|treat|cure/i);
});

test('a disease claim with no lawful rewrite returns an instruction, not mangled copy', () => {
  const panels = { ...goodLabel, leftSide: `${goodLabel.leftSide}\nReverses osteoporosis and cancer.` };
  const result = reviewLabel({ panels, source: 'text' });
  const finding = result.findings.find((f) => f.rowId === 35 && /cancer/i.test(f.evidence));
  assert.match(finding.proposedWording, /^Rewrite as a structure\/function claim/);
});

test('a label claim in IU is reconciled against a formula claim in mcg', () => {
  const formula = {
    code: 'F-4001',
    servingsPerUnit: 30,
    actives: [
      // 1,000 IU of vitamin D is exactly the 25 mcg the label declares
      { name: 'Vitamin D3', targetMg: 0.025, labelClaim: 1000, labelUnit: 'IU' },
    ],
  };
  const result = reviewLabel({ panels: goodLabel, source: 'text', formula });
  assert.deepEqual(result.findings.filter((f) => f.rowId === 14), [], 'the same dose in two units is not a mismatch');
});

test('a genuine dose mismatch across units is still caught', () => {
  const formula = {
    code: 'F-4001',
    servingsPerUnit: 30,
    actives: [{ name: 'Vitamin D3', targetMg: 0.05, labelClaim: 2000, labelUnit: 'IU' }],
  };
  const result = reviewLabel({ panels: goodLabel, source: 'text', formula });
  const finding = result.findings.find((f) => f.rowId === 14);
  assert.equal(finding.type, 'required');
  assert.match(finding.issue, /declares 25 mcg on the label but the master formula F-4001 carries a label claim of 2000 IU/);
});
