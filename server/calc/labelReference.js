/**
 * Reference data for the label review engine.
 *
 * Daily Values and declaration units follow the 2016 Nutrition and Supplement
 * Facts label rule (21 CFR 101.9(c)(8)(iv) and 101.36), which retired IU as the
 * primary declaration for vitamins A, D and E and moved folate to mcg DFE and
 * niacin to mg NE. `order` is the sequence 21 CFR 101.36(b)(2) requires.
 */

/** Adults and children 4+ years. */
export const DAILY_VALUES = [
  // macro block — appears first when declared
  { key: 'calories', name: 'Calories', unit: '', dv: null, order: 10, aliases: ['calories', 'energy'] },
  { key: 'total_fat', name: 'Total Fat', unit: 'g', dv: 78, order: 20, aliases: ['total fat', 'fat'] },
  { key: 'saturated_fat', name: 'Saturated Fat', unit: 'g', dv: 20, order: 21, aliases: ['saturated fat'] },
  { key: 'trans_fat', name: 'Trans Fat', unit: 'g', dv: null, order: 22, aliases: ['trans fat'] },
  { key: 'cholesterol', name: 'Cholesterol', unit: 'mg', dv: 300, order: 30, aliases: ['cholesterol'] },
  { key: 'sodium', name: 'Sodium', unit: 'mg', dv: 2300, order: 40, aliases: ['sodium'] },
  { key: 'total_carbohydrate', name: 'Total Carbohydrate', unit: 'g', dv: 275, order: 50, aliases: ['total carbohydrate', 'total carb', 'carbohydrate'] },
  { key: 'dietary_fiber', name: 'Dietary Fiber', unit: 'g', dv: 28, order: 51, aliases: ['dietary fiber', 'fiber'] },
  { key: 'total_sugars', name: 'Total Sugars', unit: 'g', dv: null, order: 52, aliases: ['total sugars', 'sugars'] },
  { key: 'added_sugars', name: 'Includes Added Sugars', unit: 'g', dv: 50, order: 53, aliases: ['added sugars', 'includes added sugars'] },
  { key: 'sugar_alcohol', name: 'Sugar Alcohol', unit: 'g', dv: null, order: 54, aliases: ['sugar alcohol', 'erythritol', 'xylitol'] },
  { key: 'protein', name: 'Protein', unit: 'g', dv: 50, order: 60, aliases: ['protein'] },

  // the four that lead the vitamin/mineral block on the 2016 label
  { key: 'vitamin_d', name: 'Vitamin D', unit: 'mcg', dv: 20, order: 70, iuFactor: 40, aliases: ['vitamin d', 'vitamin d3', 'vitamin d2', 'cholecalciferol', 'ergocalciferol'] },
  { key: 'calcium', name: 'Calcium', unit: 'mg', dv: 1300, order: 71, aliases: ['calcium'] },
  { key: 'iron', name: 'Iron', unit: 'mg', dv: 18, order: 72, aliases: ['iron', 'ferrous', 'ferric'] },
  { key: 'potassium', name: 'Potassium', unit: 'mg', dv: 4700, order: 73, aliases: ['potassium'] },

  // remaining vitamins, in regulation order
  { key: 'vitamin_a', name: 'Vitamin A', unit: 'mcg RAE', dv: 900, order: 80, aliases: ['vitamin a', 'retinol', 'beta-carotene', 'beta carotene'] },
  { key: 'vitamin_c', name: 'Vitamin C', unit: 'mg', dv: 90, order: 81, aliases: ['vitamin c', 'ascorbic acid', 'ascorbate'] },
  { key: 'vitamin_e', name: 'Vitamin E', unit: 'mg', dv: 15, order: 82, iuFactor: 1 / 0.67, aliases: ['vitamin e', 'tocopherol', 'tocopheryl'] },
  { key: 'vitamin_k', name: 'Vitamin K', unit: 'mcg', dv: 120, order: 83, aliases: ['vitamin k', 'phytonadione', 'menaquinone', 'mk-7', 'mk7'] },
  { key: 'thiamin', name: 'Thiamin', unit: 'mg', dv: 1.2, order: 84, aliases: ['thiamin', 'thiamine', 'vitamin b1', 'b1'] },
  { key: 'riboflavin', name: 'Riboflavin', unit: 'mg', dv: 1.3, order: 85, aliases: ['riboflavin', 'vitamin b2', 'b2'] },
  { key: 'niacin', name: 'Niacin', unit: 'mg NE', dv: 16, order: 86, aliases: ['niacin', 'niacinamide', 'nicotinamide', 'vitamin b3', 'b3'] },
  { key: 'vitamin_b6', name: 'Vitamin B6', unit: 'mg', dv: 1.7, order: 87, aliases: ['vitamin b6', 'b6', 'pyridoxine', 'pyridoxal'] },
  { key: 'folate', name: 'Folate', unit: 'mcg DFE', dv: 400, order: 88, aliases: ['folate', 'folic acid', '5-mthf', 'methylfolate'] },
  { key: 'vitamin_b12', name: 'Vitamin B12', unit: 'mcg', dv: 2.4, order: 89, aliases: ['vitamin b12', 'b12', 'cyanocobalamin', 'methylcobalamin'] },
  { key: 'biotin', name: 'Biotin', unit: 'mcg', dv: 30, order: 90, aliases: ['biotin', 'vitamin b7'] },
  { key: 'pantothenic_acid', name: 'Pantothenic Acid', unit: 'mg', dv: 5, order: 91, aliases: ['pantothenic acid', 'vitamin b5', 'pantothenate'] },
  { key: 'choline', name: 'Choline', unit: 'mg', dv: 550, order: 92, aliases: ['choline', 'bitartrate'] },

  // remaining minerals, in regulation order
  { key: 'phosphorus', name: 'Phosphorus', unit: 'mg', dv: 1250, order: 100, aliases: ['phosphorus'] },
  { key: 'iodine', name: 'Iodine', unit: 'mcg', dv: 150, order: 101, aliases: ['iodine', 'iodide', 'kelp'] },
  { key: 'magnesium', name: 'Magnesium', unit: 'mg', dv: 420, order: 102, aliases: ['magnesium'] },
  { key: 'zinc', name: 'Zinc', unit: 'mg', dv: 11, order: 103, aliases: ['zinc'] },
  { key: 'selenium', name: 'Selenium', unit: 'mcg', dv: 55, order: 104, aliases: ['selenium', 'selenomethionine'] },
  { key: 'copper', name: 'Copper', unit: 'mg', dv: 0.9, order: 105, aliases: ['copper'] },
  { key: 'manganese', name: 'Manganese', unit: 'mg', dv: 2.3, order: 106, aliases: ['manganese'] },
  { key: 'chromium', name: 'Chromium', unit: 'mcg', dv: 35, order: 107, aliases: ['chromium', 'chromax'] },
  { key: 'molybdenum', name: 'Molybdenum', unit: 'mcg', dv: 45, order: 108, aliases: ['molybdenum'] },
  { key: 'chloride', name: 'Chloride', unit: 'mg', dv: 2300, order: 109, aliases: ['chloride'] },
];

const ALIAS_INDEX = (() => {
  const index = [];
  for (const nutrient of DAILY_VALUES) {
    for (const alias of nutrient.aliases) index.push({ alias, nutrient });
  }
  // longest alias first so "vitamin b12" beats "vitamin b1"
  return index.sort((a, b) => b.alias.length - a.alias.length);
})();

/** Match a free-text ingredient name to a Daily Value nutrient, or null. */
export function matchNutrient(name) {
  const haystack = String(name ?? '').toLowerCase();
  return ALIAS_INDEX.find(({ alias }) => haystack.includes(alias))?.nutrient ?? null;
}

/** The nine major food allergens under FALCPA as amended by the FASTER Act (2021). */
export const MAJOR_ALLERGENS = [
  { name: 'Milk', patterns: [/\bmilk\b/i, /\bwhey\b/i, /\bcasein\b/i, /\blactose\b/i, /\bdairy\b/i] },
  { name: 'Eggs', patterns: [/\begg\b/i, /\bovalbumin\b/i, /\balbumen\b/i] },
  { name: 'Fish', patterns: [/\bfish\b/i, /\bcod\b/i, /\bsardine/i, /\banchov/i, /\btilapia\b/i, /\bsalmon\b/i] },
  { name: 'Crustacean shellfish', patterns: [/\bshrimp\b/i, /\bcrab\b/i, /\blobster\b/i, /\bkrill\b/i, /\bglucosamine\b/i] },
  { name: 'Tree nuts', patterns: [/\balmond/i, /\bcashew/i, /\bwalnut/i, /\bpecan/i, /\bpistachio/i, /\bcoconut\b/i, /\bhazelnut/i] },
  { name: 'Peanuts', patterns: [/\bpeanut/i, /\barachis\b/i] },
  { name: 'Wheat', patterns: [/\bwheat\b/i, /\bgluten\b/i, /\bsemolina\b/i, /\bspelt\b/i] },
  { name: 'Soybeans', patterns: [/\bsoy\b/i, /\bsoya\b/i, /\bsoybean/i, /\blecithin\b/i] },
  { name: 'Sesame', patterns: [/\bsesame\b/i, /\btahini\b/i] },
];

/** Ingredients that carry their own mandatory warning statement. */
export const MANDATORY_WARNINGS = [
  {
    trigger: /\biron\b|ferrous|ferric|carbonyl iron/i,
    exclude: /iron-free|no iron/i,
    name: 'Iron accidental-overdose warning',
    authority: '21 CFR 101.17(e)',
    required: /accidental overdose|fatal poisoning|leading cause of fatal poisoning/i,
    wording:
      'WARNING: Accidental overdose of iron-containing products is a leading cause of fatal poisoning in children under 6. Keep this product out of reach of children. In case of accidental overdose, call a doctor or poison control center immediately.',
  },
  {
    trigger: /\bphenylalanine\b|\baspartame\b/i,
    name: 'Phenylketonurics warning',
    authority: '21 CFR 172.804(e)',
    required: /phenylketonurics/i,
    wording: 'PHENYLKETONURICS: Contains Phenylalanine.',
  },
  {
    trigger: /\bpotassium\b/i,
    exclude: /potassium (iodide|sorbate|benzoate)/i,
    minMg: 99,
    name: 'Potassium salt warning',
    authority: '21 CFR 101.17(f)',
    required: /potassium.*(only under|physician|supervision)/i,
    wording: 'Take only under the supervision of a physician.',
  },
  {
    trigger: /\bvitamin k\b|phytonadione|menaquinone|\bmk-?7\b/i,
    name: 'Vitamin K anticoagulant interaction',
    authority: 'Enova house rule — anticoagulant interaction',
    required: /anticoagulant|blood[- ]thinn|warfarin/i,
    wording: 'If you are taking an anticoagulant (blood thinner), consult your healthcare professional before use.',
    severity: 'recommendation',
  },
  {
    trigger: /\bmelatonin\b/i,
    name: 'Melatonin drowsiness warning',
    authority: 'Enova house rule — sedative effect',
    required: /drowsiness|operate machinery|driving/i,
    wording: 'Do not use while driving or operating machinery. May cause drowsiness.',
    severity: 'recommendation',
  },
];

/** Words that turn a structure/function claim into an unlawful disease claim. */
export const DISEASE_CLAIM_TERMS = [
  'acne', 'alzheimer', 'anxiety disorder', 'arthritis', 'asthma', 'cancer', 'cardiovascular disease',
  'cholesterol lowering', 'covid', 'cure', 'depression', 'diabetes', 'diagnose', 'eczema',
  'heart disease', 'hypertension', 'infection', 'inflammatory bowel', 'insomnia', 'menopause symptoms',
  'migraine', 'obesity', 'osteoporosis', 'prevent', 'psoriasis', 'treat', 'ulcer',
];

/**
 * Safer structure/function wording for the most common disease-claim phrasings.
 *
 * Order matters. The verb phrases run first so "helps prevent X" collapses to
 * "supports X" rather than leaving a stranded "helps" in front of the
 * replacement; the objects run second so the thing being claimed about is
 * restated as a structure or function rather than a disease.
 */
export const CLAIM_REWRITES = [
  // verb phrases
  [/\bhelps?\s+(?:to\s+)?(?:prevent|treat|cure)s?\b/gi, 'supports'],
  [/\bto\s+(?:prevent|treat|cure)s?\b/gi, 'to support'],
  [/\b(?:prevents|treats|cures)\b/gi, 'supports'],
  [/\b(?:prevent|treat|cure)\b/gi, 'support'],
  [/\bfights?\b/gi, 'supports the body against'],
  // objects
  [/\bcolds?\s+and\s+(?:the\s+)?flu\b/gi, 'a healthy immune response'],
  [/\bcolds?\s*(?:&|and)\s*influenza\b/gi, 'a healthy immune response'],
  [/\b(?:common\s+)?colds?\b/gi, 'a healthy immune response'],
  [/\b(?:the\s+)?flu\b/gi, 'a healthy immune response'],
  [/\bcystic acne\b/gi, 'skin health'],
  [/\bacne\b/gi, 'skin health'],
  [/\bhigh blood pressure\b/gi, 'healthy blood pressure already in the normal range'],
  [/\bhigh cholesterol\b/gi, 'healthy cholesterol levels already in the normal range'],
  [/\bdiabetes\b/gi, 'healthy blood sugar already in the normal range'],
  [/\bosteoporosis\b/gi, 'bone health'],
  [/\bdepression\b/gi, 'a positive mood'],
  [/\banxiety\b/gi, 'a calm state of mind'],
  [/\binsomnia\b/gi, 'restful sleep'],
  [/\barthritis\b/gi, 'joint comfort'],
  [/\binflammation\b/gi, 'a healthy inflammatory response'],
  [/\bmigraines?\b/gi, 'head comfort'],
  [/\bulcers?\b/gi, 'digestive comfort'],
  [/\binfections?\b/gi, 'a healthy immune response'],
];

/**
 * Apply the rewrites and return corrected wording only if it actually reads as
 * a lawful structure/function claim. A mangled sentence is worse than none —
 * the reviewer gets an instruction instead.
 */
export function proposeClaimRewrite(sentence) {
  let out = String(sentence ?? '');
  for (const [pattern, replacement] of CLAIM_REWRITES) out = out.replace(pattern, replacement);
  out = out
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')          // "helps helps" -> "helps"
    .replace(/\bsupports\s+support\b/gi, 'supports')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .trim();
  if (out && out[0] !== out[0].toUpperCase()) out = out[0].toUpperCase() + out.slice(1);

  if (!out || out.toLowerCase() === String(sentence).toLowerCase()) return null;
  // if a disease term survived the rewrite, the sentence still is not lawful
  const survived = DISEASE_CLAIM_TERMS.some((term) => new RegExp(`\\b${term}`, 'i').test(out));
  return survived ? null : out;
}

/** The DSHEA disclaimer, verbatim, as 21 CFR 101.93(c) requires it. */
export const DSHEA_DISCLAIMER =
  'These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.';

/** Preservatives and colourants that must state their function in the ingredient list. */
export const FUNCTIONAL_INGREDIENTS = [
  { match: /potassium sorbate/i, name: 'Potassium sorbate', role: 'preservative' },
  { match: /sodium benzoate/i, name: 'Sodium benzoate', role: 'preservative' },
  { match: /citric acid/i, name: 'Citric acid', role: 'acidulant', optional: true },
  { match: /ascorbic acid/i, name: 'Ascorbic acid', role: 'preservative', optional: true },
  { match: /tocopherols?/i, name: 'Mixed tocopherols', role: 'preservative', optional: true },
  { match: /bht|butylated hydroxytoluene/i, name: 'BHT', role: 'preservative' },
  { match: /fd&c|fd & c/i, name: 'FD&C colour', role: 'color' },
  { match: /titanium dioxide/i, name: 'Titanium dioxide', role: 'color' },
  { match: /annatto/i, name: 'Annatto', role: 'color' },
  { match: /turmeric \(color\)|curcumin \(color\)/i, name: 'Turmeric', role: 'color' },
  { match: /beet\s*(root)?\s*(juice|powder)/i, name: 'Beet juice', role: 'color' },
  { match: /spirulina extract/i, name: 'Spirulina extract', role: 'color' },
  { match: /carmine|cochineal/i, name: 'Carmine', role: 'color' },
];

/** Minimum type sizes the panel doctrine requires, in points. */
export const TYPE_RULES = {
  bodyMinPt: 6,          // 1/16 inch cap height ≈ 6 pt for supplement facts body copy
  pdpMinPt: 6,
  disclaimerMinPt: 6,
};
