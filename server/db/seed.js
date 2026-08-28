/**
 * Seed the Enova Ops database.
 *
 * Runs once against an empty database (or with `--force` to rebuild from
 * scratch) and lays down a working Enova: the 25-person roster, the ingredient
 * and packaging catalogue drawn from the internal price list, approved vendors,
 * customers, live formulas and quotes, projects in every pipeline stage, work
 * orders on the floor, lots in the racks, and a label review mid-flight.
 *
 * Every value is generated from a fixed seed, so the same command always
 * produces the same database — which makes it safe to demo, diff and reset.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from './engine.js';
import { schema } from './schema.js';
import { hashPassword } from '../lib/auth.js';
import { buildQuote, defaultTiers, suggestLabour } from '../calc/quoteEngine.js';
import { reviewLabel } from '../calc/labelEngine.js';
import { overheadRateForQty } from '../../shared/domain.js';

// ── deterministic randomness ───────────────────────────────────────────────
function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260820);
const pick = (list) => list[Math.floor(rng() * list.length)];
const pickN = (list, n) => [...list].sort(() => rng() - 0.5).slice(0, n);
const int = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const money = (min, max, dp = 2) => Number((rng() * (max - min) + min).toFixed(dp));
const chance = (p) => rng() < p;

const DAY = 86400000;
const now = () => new Date();
const iso = (d) => new Date(d).toISOString();
const daysAgo = (n) => iso(Date.now() - n * DAY);
const daysAhead = (n) => iso(Date.now() + n * DAY);
const dateOnly = (n) => iso(Date.now() + n * DAY).slice(0, 10);

// ── the people ─────────────────────────────────────────────────────────────
const STAFF = [
  ['Jordan Bradfield', 'jbradfield@enovascience.com', 'admin', 'Director of Operations', 'Operations'],
  ['Marisol Vega', 'mvega@enovascience.com', 'executive', 'Chief Executive Officer', 'Executive'],
  ['Curtis Okonkwo', 'cokonkwo@enovascience.com', 'executive', 'VP Commercial', 'Executive'],
  ['Priya Raghavan', 'praghavan@enovascience.com', 'operations', 'Plant Manager', 'Operations'],
  ['Devin Marsh', 'dmarsh@enovascience.com', 'operations', 'Production Planner', 'Operations'],
  ['Alina Toma', 'atoma@enovascience.com', 'operations', 'Scheduling Coordinator', 'Operations'],
  ['Grace Whitfield', 'gwhitfield@enovascience.com', 'quality', 'QA Manager', 'Quality'],
  ['Hassan Bakri', 'hbakri@enovascience.com', 'quality', 'QC Analyst', 'Quality'],
  ['Renata Silva', 'rsilva@enovascience.com', 'quality', 'Document Control Specialist', 'Quality'],
  ['Tomás Herrera', 'therrera@enovascience.com', 'quality', 'Label Compliance Reviewer', 'Quality'],
  ['Dr. Naomi Feldman', 'nfeldman@enovascience.com', 'rd', 'Director of R&D', 'R&D'],
  ['Ellis Chen', 'echen@enovascience.com', 'rd', 'Senior Formulator', 'R&D'],
  ['Farrah Osei', 'fosei@enovascience.com', 'rd', 'Formulation Scientist', 'R&D'],
  ['Kip Andersen', 'kandersen@enovascience.com', 'rd', 'Pilot Plant Technician', 'R&D'],
  ['Bianca Ruiz', 'bruiz@enovascience.com', 'sales', 'VP Business Development', 'Commercial'],
  ['Trevor Lindqvist', 'tlindqvist@enovascience.com', 'sales', 'Account Manager', 'Commercial'],
  ['Simone Achebe', 'sachebe@enovascience.com', 'sales', 'Account Manager', 'Commercial'],
  ['Wes Kaplan', 'wkaplan@enovascience.com', 'sales', 'Customer Success Manager', 'Commercial'],
  ['Nadia Petrov', 'npetrov@enovascience.com', 'purchasing', 'Purchasing Manager', 'Supply Chain'],
  ['Omar Haddad', 'ohaddad@enovascience.com', 'purchasing', 'Buyer', 'Supply Chain'],
  ['Luis Cabrera', 'lcabrera@enovascience.com', 'production', 'Production Supervisor', 'Production'],
  ['Dana Kowalski', 'dkowalski@enovascience.com', 'production', 'Line Lead — Gummy', 'Production'],
  ['Ibrahim Sow', 'isow@enovascience.com', 'production', 'Line Lead — Encapsulation', 'Production'],
  ['Kelsey Nguyen', 'knguyen@enovascience.com', 'warehouse', 'Warehouse Supervisor', 'Warehouse'],
  ['Marcus Bell', 'mbell@enovascience.com', 'warehouse', 'Receiving Clerk', 'Warehouse'],
];

const ACCENTS = ['#2FBF9B', '#4C8DF6', '#C8972A', '#B15CD1', '#E4734A', '#3FB2E0', '#7BC043', '#E45B7C'];

// ── ingredient catalogue (Enova internal price list, midpoint of each band) ──
// [code, name, category, form, $/kg, { branded, brandOwner, labelName, allergens }]
const ACTIVES = [
  ['ALT-RP-1001', 'Vitamin C', 'Vitamin', 'Ascorbic acid USP', 6],
  ['ALT-RP-1002', 'Vitamin D3', 'Vitamin', 'Cholecalciferol 100,000 IU/g', 45],
  ['ALT-RP-1003', 'Vitamin D3 (high potency)', 'Vitamin', 'Cholecalciferol 1,000,000 IU/g', 225],
  ['ALT-RP-1004', 'Vitamin E (natural)', 'Vitamin', 'd-alpha-tocopherol', 30],
  ['ALT-RP-1005', 'Vitamin E (synthetic)', 'Vitamin', 'dl-alpha-tocopherol', 15],
  ['ALT-RP-1006', 'Vitamin B12', 'Vitamin', 'Cyanocobalamin 1%', 300],
  ['ALT-RP-1007', 'Vitamin B12 (methyl)', 'Vitamin', 'Methylcobalamin 1%', 600],
  ['ALT-RP-1008', 'Folate', 'Vitamin', 'Folic acid', 75],
  ['ALT-RP-1009', 'Quatrefolic® 5-MTHF', 'Vitamin', 'Glucosamine salt of 5-MTHF', 1150, { branded: true, brandOwner: 'Gnosis by Lesaffre' }],
  ['ALT-RP-1010', 'Zinc gluconate', 'Mineral', 'Zinc gluconate USP', 22],
  ['ALT-RP-1011', 'Zinc bisglycinate chelate', 'Mineral', 'TRAACS® zinc bisglycinate', 45, { branded: true, brandOwner: 'Albion Laboratories' }],
  ['ALT-RP-1012', 'Magnesium oxide', 'Mineral', 'Magnesium oxide USP', 5],
  ['ALT-RP-1013', 'Magnesium glycinate', 'Mineral', 'Magnesium bisglycinate chelate', 22],
  ['ALT-RP-1014', 'Magnesium citrate', 'Mineral', 'Magnesium citrate', 15],
  ['ALT-RP-1015', 'Calcium carbonate', 'Mineral', 'Calcium carbonate USP', 4],
  ['ALT-RP-1016', 'Calcium citrate', 'Mineral', 'Calcium citrate', 11],
  ['ALT-RP-1017', 'Ferrochel® iron', 'Mineral', 'Ferrous bisglycinate chelate', 60, { branded: true, brandOwner: 'Albion Laboratories' }],
  ['ALT-RP-1018', 'Sodium selenate', 'Mineral', 'Sodium selenate', 150],
  ['ALT-RP-1019', 'SelenoExcell®', 'Mineral', 'High-selenium yeast', 450, { branded: true, brandOwner: 'Cypress Systems' }],
  ['ALT-RP-1020', 'Chromax® chromium picolinate', 'Mineral', 'Chromium picolinate', 120, { branded: true, brandOwner: 'Nutrition 21 / Lonza' }],
  ['ALT-RP-1021', 'Potassium iodide', 'Mineral', 'Potassium iodide USP', 85],
  ['ALT-RP-1022', 'Kaneka Q10® CoQ10', 'Specialty', 'Ubiquinone', 300, { branded: true, brandOwner: 'Kaneka Corporation' }],
  ['ALT-RP-1023', 'Kaneka QH® ubiquinol', 'Specialty', 'Ubiquinol', 600, { branded: true, brandOwner: 'Kaneka Corporation' }],
  ['ALT-RP-1024', 'Fish oil concentrate', 'Specialty', 'Omega-3 60% EE', 25, { allergens: ['Fish'] }],
  ['ALT-RP-1025', 'Elderberry extract 5:1', 'Botanical', 'Sambucus nigra fruit extract', 60],
  ['ALT-RP-1026', 'Elderberry extract 10:1', 'Botanical', 'Sambucus nigra fruit extract', 115],
  ['ALT-RP-1027', 'KSM-66® Ashwagandha', 'Botanical', 'Withania somnifera root, 5% withanolides', 115, { branded: true, brandOwner: 'Ixoreal Biomed' }],
  ['ALT-RP-1028', 'Ashwagandha extract', 'Botanical', 'Withania somnifera root, 2.5% withanolides', 35],
  ['ALT-RP-1029', 'Curcumin 95%', 'Botanical', 'Curcuma longa rhizome extract', 50],
  ['ALT-RP-1030', 'BCM-95® curcumin', 'Botanical', 'Curcumin + turmeric essential oil', 150, { branded: true, brandOwner: 'Arjuna Natural / DolCas' }],
  ['ALT-RP-1031', 'BioPerine®', 'Botanical', 'Piper nigrum fruit extract, 95% piperine', 120, { branded: true, brandOwner: 'Sabinsa Corporation' }],
  ['ALT-RP-1032', 'Melatonin', 'Specialty', 'Melatonin USP', 350],
  ['ALT-RP-1033', 'Suntheanine® L-Theanine', 'Amino acid', 'L-Theanine', 90, { branded: true, brandOwner: 'Taiyo International' }],
  ['ALT-RP-1034', 'L-Theanine', 'Amino acid', 'L-Theanine', 35],
  ['ALT-RP-1035', 'Collagen peptides (bovine)', 'Specialty', 'Hydrolyzed type I/III', 25],
  ['ALT-RP-1036', 'Verisol® collagen peptides', 'Specialty', 'Bioactive collagen peptides', 90, { branded: true, brandOwner: 'GELITA AG' }],
  ['ALT-RP-1037', 'D-Biotin 2%', 'Vitamin', 'D-Biotin trituration', 150],
  ['ALT-RP-1038', 'FloraGLO® lutein 20%', 'Specialty', 'Lutein beadlet', 140, { branded: true, brandOwner: 'Kemin Industries' }],
  ['ALT-RP-1039', 'Zeaxanthin 5%', 'Specialty', 'Zeaxanthin', 350],
  ['ALT-RP-1040', 'Glucosamine sulfate 2KCl', 'Specialty', 'Glucosamine sulfate', 18, { allergens: ['Crustacean shellfish'] }],
  ['ALT-RP-1041', 'Chondroitin sulfate', 'Specialty', 'Bovine chondroitin sulfate', 55],
  ['ALT-RP-1042', 'OptiMSM®', 'Specialty', 'Methylsulfonylmethane', 13, { branded: true, brandOwner: 'Bergstrom Nutrition' }],
  ['ALT-RP-1043', 'CarnoSyn® beta-alanine', 'Amino acid', 'Beta-alanine', 25, { branded: true, brandOwner: 'Natural Alternatives International' }],
  ['ALT-RP-1044', 'Creapure® creatine monohydrate', 'Amino acid', 'Creatine monohydrate', 14, { branded: true, brandOwner: 'AlzChem' }],
  ['ALT-RP-1045', 'Carnipure® L-carnitine tartrate', 'Amino acid', 'L-Carnitine tartrate', 50, { branded: true, brandOwner: 'Lonza' }],
  ['ALT-RP-1046', 'Bacognize® bacopa', 'Botanical', 'Bacopa monnieri whole plant, 45% bacosides', 105, { branded: true, brandOwner: 'Verdure Sciences' }],
  ['ALT-RP-1047', "Lion's mane extract", 'Botanical', 'Hericium erinaceus fruiting body, 30% polysaccharides', 55],
  ['ALT-RP-1048', 'Rhodiola extract', 'Botanical', 'Rhodiola rosea root, 3% rosavins', 55],
  ['ALT-RP-1049', 'Vitamin K2 MenaQ7®', 'Vitamin', 'Menaquinone-7', 950, { branded: true, brandOwner: 'Gnosis by Lesaffre' }],
  ['ALT-RP-1050', 'Vitamin B6', 'Vitamin', 'Pyridoxal-5-phosphate', 260],
];

const EXCIPIENTS = [
  ['ALT-RP-2001', 'Gummy base — pectin', 'Base', 'Pectin/sugar matrix', 16, { baseFill: true }],
  ['ALT-RP-2002', 'Gummy base — gelatin (bovine)', 'Base', 'Bovine gelatin matrix', 14, { baseFill: true }],
  ['ALT-RP-2003', 'Microcrystalline cellulose', 'Filler', 'MCC 102', 5.5, { baseFill: true }],
  ['ALT-RP-2004', 'Citric acid', 'Acidulant', 'Citric acid anhydrous', 3.5],
  ['ALT-RP-2005', 'Malic acid', 'Acidulant', 'Malic acid', 4.5],
  ['ALT-RP-2006', 'Natural flavor — mixed berry', 'Flavor', 'Natural flavor', 40],
  ['ALT-RP-2007', 'Natural flavor — citrus', 'Flavor', 'Natural flavor', 38],
  ['ALT-RP-2008', 'Natural color — beet juice', 'Color', 'Beet juice concentrate', 65],
  ['ALT-RP-2009', 'Carnauba wax', 'Coating', 'Carnauba wax', 14],
  ['ALT-RP-2010', 'Sucrose', 'Sweetener', 'Granulated sucrose', 1],
  ['ALT-RP-2011', 'Glucose syrup', 'Sweetener', 'Glucose syrup 42 DE', 1],
  ['ALT-RP-2012', 'Magnesium stearate', 'Lubricant', 'Vegetable magnesium stearate', 7],
  ['ALT-RP-2013', 'Silicon dioxide', 'Flow agent', 'Colloidal silicon dioxide', 8.5],
  ['ALT-RP-2014', 'Dicalcium phosphate', 'Filler', 'Dicalcium phosphate dihydrate', 3.5],
  ['ALT-RP-2015', 'Croscarmellose sodium', 'Disintegrant', 'Croscarmellose sodium', 15],
  ['ALT-RP-2016', 'Stearic acid', 'Lubricant', 'Stearic acid NF', 5.5],
  ['ALT-RP-2017', 'HPMC coating', 'Coating', 'Film coating system', 35],
  ['ALT-RP-2018', 'Maltodextrin', 'Filler', 'Maltodextrin DE 10', 2],
  ['ALT-RP-2019', 'Stevia Reb A 97%', 'Sweetener', 'Steviol glycoside', 105],
  ['ALT-RP-2020', 'Monk fruit extract', 'Sweetener', 'Mogroside V 50%', 175],
];

// [code, name, category, $/unit, uom]
const PACKAGING = [
  ['ALT-PK-3001', 'PET amber bottle 100cc', 'Bottle', 0.24],
  ['ALT-PK-3002', 'PET amber bottle 150cc', 'Bottle', 0.275],
  ['ALT-PK-3003', 'PET amber bottle 250cc', 'Bottle', 0.35],
  ['ALT-PK-3004', 'PET amber bottle 500cc', 'Bottle', 0.475],
  ['ALT-PK-3005', 'HDPE white bottle 250cc', 'Bottle', 0.29],
  ['ALT-PK-3006', 'PET jar 250cc', 'Jar', 0.425],
  ['ALT-PK-3007', 'PET jar 500cc', 'Jar', 0.60],
  ['ALT-PK-3008', 'PET jar 1000cc', 'Jar', 0.85],
  ['ALT-PK-3009', 'Glass amber bottle 2 oz', 'Bottle', 0.625],
  ['ALT-PK-3010', 'Glass amber bottle 4 oz', 'Bottle', 0.85],
  ['ALT-PK-3011', 'CR cap 38mm', 'Closure', 0.085],
  ['ALT-PK-3012', 'CR cap 45mm', 'Closure', 0.10],
  ['ALT-PK-3013', 'Flip-top cap', 'Closure', 0.13],
  ['ALT-PK-3014', 'Dropper cap assembly', 'Closure', 0.325],
  ['ALT-PK-3015', 'Induction liner', 'Closure', 0.035],
  ['ALT-PK-3016', 'Shrink band', 'Closure', 0.055],
  ['ALT-PK-3017', 'Front panel label', 'Label', 0.08],
  ['ALT-PK-3018', 'Back panel label', 'Label', 0.08],
  ['ALT-PK-3019', '2-piece wrap label', 'Label', 0.14],
  ['ALT-PK-3020', 'Shrink sleeve', 'Label', 0.21],
  ['ALT-PK-3021', 'Silica gel packet 1g', 'Desiccant', 0.045],
  ['ALT-PK-3022', 'Stick pack film', 'Flexible', 0.14],
  ['ALT-PK-3023', 'Sachet foil pouch', 'Flexible', 0.175],
  ['ALT-PK-3024', 'Stand-up pouch 1 lb', 'Flexible', 0.45],
  ['ALT-PK-3025', 'Master case (corrugated)', 'Case', 2.75],
  ['ALT-PK-3026', 'Capsule shell size 0 HPMC', 'Capsule shell', 0.013],
  ['ALT-PK-3027', 'Capsule shell size 00 HPMC', 'Capsule shell', 0.015],
  ['ALT-PK-3028', 'Capsule shell size 0 gelatin', 'Capsule shell', 0.0095],
];

const VENDORS = [
  ['V-1001', 'Meridian Nutraceutical Supply', 'raw_material', 'approved', 21, 'Salt Lake City, UT'],
  ['V-1002', 'Cascade Botanicals Inc.', 'raw_material', 'approved', 35, 'Portland, OR'],
  ['V-1003', 'Aldera Fine Chemicals', 'raw_material', 'approved', 28, 'Newark, NJ'],
  ['V-1004', 'Sabinsa Corporation', 'raw_material', 'approved', 30, 'East Windsor, NJ'],
  ['V-1005', 'Ixoreal Biomed USA', 'raw_material', 'approved', 42, 'Los Angeles, CA'],
  ['V-1006', 'Northbridge Packaging Group', 'packaging', 'approved', 18, 'Chicago, IL'],
  ['V-1007', 'ClearPak Containers', 'packaging', 'approved', 24, 'Atlanta, GA'],
  ['V-1008', 'Anchor Label & Print', 'packaging', 'approved', 14, 'Dallas, TX'],
  ['V-1009', 'Capsugel Direct', 'packaging', 'approved', 26, 'Greenwood, SC'],
  ['V-1010', 'Vantage Analytical Laboratories', 'lab', 'approved', 10, 'Denver, CO'],
  ['V-1011', 'Precision Assay Labs', 'lab', 'probation', 15, 'Phoenix, AZ'],
  ['V-1012', 'Summit Freight Logistics', 'logistics', 'approved', 3, 'Reno, NV'],
  ['V-1013', 'Halcyon Ingredients LLC', 'raw_material', 'pending', 45, 'Miami, FL'],
  ['V-1014', 'Brightline Sterilization Services', 'service', 'approved', 7, 'Sacramento, CA'],
  ['V-1015', 'Trident Marine Nutrients', 'raw_material', 'approved', 40, 'Seattle, WA'],
];

const CUSTOMERS = [
  ['C-2001', 'Nordvita Health', 'strategic', 'active', 'Direct-to-consumer supplements'],
  ['C-2002', 'Verdant Wellness Co.', 'key', 'active', 'Natural products retail'],
  ['C-2003', 'Kestrel Performance Labs', 'key', 'active', 'Sports nutrition'],
  ['C-2004', 'Lumen Beauty Group', 'standard', 'active', 'Beauty from within'],
  ['C-2005', 'Harbor & Vine', 'standard', 'active', 'Premium grocery private label'],
  ['C-2006', 'Solace Sleep Co.', 'new', 'active', 'Sleep and relaxation'],
  ['C-2007', 'Ardent Pediatrics Nutrition', 'key', 'on_hold', "Children's supplements"],
  ['C-2008', 'Meridian Vet Health', 'standard', 'prospect', 'Companion animal supplements'],
  ['C-2009', 'BlueRidge Naturals', 'standard', 'active', 'Regional retail brand'],
  ['C-2010', 'Ossian Longevity', 'strategic', 'active', 'Longevity and healthy ageing'],
  ['C-2011', 'Tidewater Botanicals', 'standard', 'inactive', 'Herbal tinctures'],
  ['C-2012', 'Correlate Health Systems', 'new', 'prospect', 'Practitioner channel'],
];

const LOCATIONS = [
  ['WH-01', 'Main Warehouse', 'warehouse', null, false],
  ['RM-A', 'Raw Material Rack A', 'rack', 'WH-01', false],
  ['RM-B', 'Raw Material Rack B', 'rack', 'WH-01', false],
  ['RM-C', 'Raw Material Rack C', 'rack', 'WH-01', false],
  ['PK-A', 'Packaging Rack A', 'rack', 'WH-01', false],
  ['PK-B', 'Packaging Rack B', 'rack', 'WH-01', false],
  ['COLD-01', 'Cold Room 2-8°C', 'cold', 'WH-01', true],
  ['QUAR-01', 'Quarantine Cage', 'quarantine', 'WH-01', false],
  ['PROD-01', 'Production Floor — Gummy Line', 'production', null, false],
  ['PROD-02', 'Production Floor — Encapsulation', 'production', null, false],
  ['PROD-03', 'Production Floor — Blending', 'production', null, false],
  ['FG-01', 'Finished Goods', 'warehouse', null, false],
  ['SHIP-01', 'Shipping Dock', 'shipping', null, false],
];

// ── seed ───────────────────────────────────────────────────────────────────
export function seed(db, { verbose = true } = {}) {
  const log = verbose ? (...args) => console.log('[seed]', ...args) : () => {};
  const sys = { actorId: 'system', actorName: 'Seed' };
  const byCode = {};

  // -- settings --
  const settings = [
    ['company.name', 'Enova Science', 'Company name', 'company'],
    ['company.legalName', 'Enova Science LLC', 'Legal entity', 'company'],
    ['company.address', '1180 Innovation Way, Suite 300, Reno, NV 89502', 'Facility address', 'company'],
    ['company.phone', '(775) 555-0180', 'Main line', 'company'],
    ['company.fdaRegistration', '1234567890', 'FDA food facility registration', 'compliance'],
    ['brand.navy', '#1B3A5C', 'Brand navy', 'brand'],
    ['brand.teal', '#1D7A6B', 'Brand teal', 'brand'],
    ['brand.gold', '#C8972A', 'Brand gold', 'brand'],
    ['quote.coaFee', 120, 'Flat COA fee per SKU', 'quoting'],
    ['quote.overagePct', 5, 'Standard ingredient overage', 'quoting'],
    ['quote.leadTimeWeeks', 8, 'Standard lead time from deposit + approved artwork', 'quoting'],
    ['quote.paymentTerms', '50% deposit, balance due prior to shipment', 'Standard payment terms', 'quoting'],
    ['quote.validDays', 30, 'Quote validity window', 'quoting'],
    ['quote.masterBidLoaded', false, 'MASTER BID tier page uploaded — labour and overhead confirmed', 'quoting'],
    ['inventory.expiryWarningDays', 90, 'Warn this many days before a lot expires', 'inventory'],
    ['inventory.retestWindowDays', 365, 'Retest interval for released raw materials', 'inventory'],
    ['production.lines', ['Gummy Line 1', 'Gummy Line 2', 'Encapsulation 1', 'Encapsulation 2', 'Tablet Press', 'Sachet / Stick Pack', 'Blending', 'Tincture'], 'Production lines', 'production'],
    ['documents.expiryWarningDays', 45, 'Warn this many days before a document expires', 'documents'],
  ];
  for (const [key, value, label, category] of settings) {
    db.insert('settings', { key, value, label, category }, sys);
  }

  // -- users --
  const users = STAFF.map(([name, email, role, title, department], i) => {
    const initials = name.replace(/^Dr\.\s+/, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return db.insert('users', {
      name, email, role, title, department, initials,
      phone: `(775) 555-0${(200 + i).toString().padStart(3, '0')}`,
      accentColor: ACCENTS[i % ACCENTS.length],
      active: true,
      mustChangePassword: true,
      ...hashPassword('enova2026'),
      preferences: { theme: 'dark', density: 'comfortable' },
    }, sys);
  });
  const byRole = (role) => users.filter((u) => u.role === role);
  const userFor = (role) => pick(byRole(role));
  log(`${users.length} users (default password: enova2026)`);

  // -- locations --
  const locations = {};
  for (const [code, name, type, parent, temp] of LOCATIONS) {
    locations[code] = db.insert('locations', {
      code, name, type, temperatureControlled: temp,
      parentId: parent ? locations[parent]?.id ?? '' : '',
      capacity: type === 'rack' ? int(40, 120) : 0,
      active: true,
    }, sys);
  }

  // -- vendors --
  const vendors = VENDORS.map(([code, name, category, status, leadTimeDays, city]) => db.insert('vendors', {
    code, name, category, status, leadTimeDays,
    website: `https://${name.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
    address: { city: city.split(', ')[0], state: city.split(', ')[1], country: 'USA' },
    paymentTerms: pick(['Net 30', 'Net 45', 'Net 15', '2/10 Net 30']),
    minimumOrder: pick([0, 500, 1000, 2500]),
    buyerId: userFor('purchasing').id,
    contacts: [{
      name: pick(['Alex Moreno', 'Sam Whitaker', 'Dana Fields', 'Priya Shah', 'Chris Duval', 'Robin Yates']),
      title: 'Account Representative',
      email: `sales@${name.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
      phone: `(${int(200, 899)}) 555-0${int(100, 999)}`,
      primary: true,
    }],
    qualification: {
      auditedAt: status === 'approved' ? daysAgo(int(60, 700)) : null,
      expiresAt: status === 'approved' ? daysAhead(int(-30, 600)) : null,
      certifications: status === 'approved' ? pickN(['NSF GMP', 'ISO 9001', 'Organic (USDA)', 'Kosher', 'Halal', 'SQF'], int(1, 3)) : [],
      questionnaireOnFile: status === 'approved',
    },
    rating: { quality: money(3.2, 5, 1), delivery: money(3, 5, 1), responsiveness: money(3, 5, 1) },
    notes: status === 'probation' ? 'Two late COAs in the last quarter — under review by QA.' : '',
    tags: [category],
  }, sys));
  const vendorByCode = Object.fromEntries(vendors.map((v) => [v.code, v]));

  // -- items --
  const rmVendors = vendors.filter((v) => v.category === 'raw_material' && v.status === 'approved');
  const pkVendors = vendors.filter((v) => v.category === 'packaging');
  const items = [];

  const makeItem = (data) => {
    const row = db.insert('items', data, sys);
    items.push(row);
    byCode[row.itemCode] = row;
    return row;
  };

  for (const [itemCode, name, category, form, pricePerKg, opts = {}] of [...ACTIVES, ...EXCIPIENTS]) {
    const isExcipient = itemCode.startsWith('ALT-RP-2');
    makeItem({
      itemCode, name, category, form,
      type: 'raw_material',
      uom: 'kg',
      pricePerKg,
      costPerUom: pricePerKg,
      priceSource: 'Enova price list',
      reorderPoint: isExcipient ? int(40, 150) : int(5, 60),
      reorderQty: isExcipient ? int(100, 400) : int(25, 150),
      safetyStock: isExcipient ? int(20, 60) : int(3, 25),
      leadTimeDays: int(14, 45),
      defaultVendorId: (opts.brandOwner && vendors.find((v) => v.name.startsWith(opts.brandOwner.split(' ')[0]))?.id) || pick(rmVendors).id,
      defaultLocationId: pick([locations['RM-A'], locations['RM-B'], locations['RM-C'], locations['COLD-01']]).id,
      shelfLifeDays: int(540, 1095),
      storageConditions: category === 'Specialty' ? '2–8°C, protect from light' : 'Ambient, dry, below 25°C',
      allergens: opts.allergens ?? [],
      isBranded: Boolean(opts.branded),
      brandOwner: opts.brandOwner ?? '',
      labelName: name,
      requiresCoa: true,
      active: true,
      tags: [category.toLowerCase(), ...(opts.baseFill ? ['base-fill'] : []), ...(opts.branded ? ['branded'] : [])],
    });
  }

  for (const [itemCode, name, category, costPerUom] of PACKAGING) {
    makeItem({
      itemCode, name, category,
      type: 'packaging',
      uom: 'ea',
      costPerUom,
      pricePerKg: 0,
      priceSource: 'Enova price list',
      reorderPoint: int(2000, 12000),
      reorderQty: int(10000, 60000),
      safetyStock: int(1000, 5000),
      leadTimeDays: int(14, 40),
      defaultVendorId: pick(pkVendors).id,
      defaultLocationId: pick([locations['PK-A'], locations['PK-B']]).id,
      shelfLifeDays: 1825,
      storageConditions: 'Ambient, dry',
      requiresCoa: false,
      active: true,
      tags: [category.toLowerCase()],
    });
  }
  log(`${items.length} catalogue items`);

  // -- customers --
  const customers = CUSTOMERS.map(([code, name, tier, status, industry], i) => db.insert('customers', {
    code, name, tier, status, industry,
    website: `https://${name.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
    ownerId: byRole('sales')[i % byRole('sales').length].id,
    paymentTerms: pick(['Net 30', 'Net 45', '50% deposit / Net 30']),
    creditLimit: pick([50000, 100000, 250000, 500000]),
    logoTint: ACCENTS[i % ACCENTS.length],
    billingAddress: { line1: `${int(100, 9800)} ${pick(['Commerce', 'Harbor', 'Summit', 'Willow', 'Foundry', 'Beacon'])} ${pick(['Pkwy', 'Ave', 'Blvd', 'St'])}`, city: pick(['Boulder', 'Austin', 'Portland', 'Nashville', 'San Diego', 'Chicago']), state: pick(['CO', 'TX', 'OR', 'TN', 'CA', 'IL']), postalCode: String(int(10000, 99999)), country: 'USA' },
    contacts: [
      { name: pick(['Jamie Ellery', 'Rowan Pace', 'Casey Lindt', 'Morgan Vale', 'Avery Sinclair', 'Quinn Ashford']), title: 'Director of Product', email: `product@${name.toLowerCase().replace(/[^a-z]+/g, '')}.com`, phone: `(${int(200, 899)}) 555-0${int(100, 999)}`, primary: true },
      { name: pick(['Skyler Ruiz', 'Devon Marsh', 'Blake Turner', 'Reese Coleman']), title: 'Regulatory Affairs', email: `regulatory@${name.toLowerCase().replace(/[^a-z]+/g, '')}.com`, phone: `(${int(200, 899)}) 555-0${int(100, 999)}`, primary: false },
    ],
    tags: [tier],
    notes: status === 'on_hold' ? 'On credit hold pending resolution of the 2026-Q2 invoice.' : '',
  }, sys));
  const customerByCode = Object.fromEntries(customers.map((c) => [c.code, c]));

  // -- formulas --
  const rmByName = (name) => items.find((i) => i.name === name);
  const pkByName = (name) => items.find((i) => i.name === name);

  const line = (name, targetMg, extra = {}) => {
    const item = rmByName(name);
    return {
      itemId: item?.id ?? null,
      code: item?.itemCode ?? 'TBD',
      name: item?.name ?? name,
      form: item?.form ?? '',
      targetMg,
      pricePerKg: item?.pricePerKg ?? 0,
      priceSource: item ? 'Enova price list' : 'Confirm with Purchasing',
      brandOwner: item?.brandOwner ?? '',
      ...extra,
    };
  };
  const exc = (name, opts = {}) => {
    const item = rmByName(name);
    return {
      itemId: item?.id ?? null,
      code: item?.itemCode ?? 'TBD',
      name: item?.name ?? name,
      pricePerKg: item?.pricePerKg ?? 0,
      priceSource: 'Enova price list',
      targetMg: opts.targetMg ?? null,
      inputMg: opts.inputMg ?? null,
      isBaseFill: Boolean(opts.isBaseFill),
    };
  };
  const pack = (name) => {
    const item = pkByName(name);
    return { itemId: item?.id ?? null, code: item?.itemCode ?? 'TBD', name, costPerUnit: item?.costPerUom ?? 0, priceSource: 'Enova price list' };
  };

  const FORMULA_SPECS = [
    {
      code: 'F-4001', name: 'Immune Defense Gummy — Elderberry + Zinc + C', customer: 'C-2001', format: 'gummy',
      servingSize: '2 gummies', servingsPerUnit: 30, totalFormatWeightMg: 5000, status: 'approved',
      actives: [
        line('Elderberry extract 10:1', 100),
        line('Vitamin C', 90),
        line('Zinc gluconate', 5),
        line('Vitamin D3', 0.025, { labelClaim: 1000, labelUnit: 'IU' }),
      ],
      excipients: [
        exc('Citric acid', { inputMg: 60 }), exc('Malic acid', { inputMg: 30 }),
        exc('Natural flavor — mixed berry', { inputMg: 40 }), exc('Natural color — beet juice', { inputMg: 12 }),
        exc('Carnauba wax', { inputMg: 6 }), exc('Gummy base — pectin', { isBaseFill: true }),
      ],
      packaging: [pack('PET jar 250cc'), pack('CR cap 45mm'), pack('2-piece wrap label'), pack('Induction liner'), pack('Shrink band')],
      services: [{ name: 'Gummy manufacturing', costPerUnit: 0.0375, basis: '$37.50/1,000 gummies' }, { name: 'Bottling / packaging', costPerUnit: 0.0075, basis: '$7.50/1,000 units' }],
      claims: ['Supports a healthy immune response', 'Supports antioxidant defenses'],
    },
    {
      code: 'F-4002', name: 'Calm & Focus Capsule — Ashwagandha + L-Theanine', customer: 'C-2006', format: 'capsule',
      servingSize: '2 capsules', servingsPerUnit: 30, totalFormatWeightMg: 1300, capsuleShellSize: '00', status: 'approved',
      actives: [
        line('KSM-66® Ashwagandha', 600),
        line('Suntheanine® L-Theanine', 200),
        line('Magnesium glycinate', 100),
        line('Vitamin B6', 1.7),
      ],
      excipients: [exc('Magnesium stearate', { inputMg: 10 }), exc('Silicon dioxide', { inputMg: 6 }), exc('Microcrystalline cellulose', { isBaseFill: true })],
      packaging: [pack('PET amber bottle 250cc'), pack('CR cap 38mm'), pack('Front panel label'), pack('Back panel label'), pack('Silica gel packet 1g'), pack('Induction liner')],
      services: [{ name: 'Encapsulation', costPerUnit: 0.0135, basis: '$13.50/1,000 capsules' }, { name: 'Bottling / packaging', costPerUnit: 0.0075, basis: '$7.50/1,000 units' }],
      claims: ['Supports a calm, focused state of mind', 'Helps the body adapt to everyday stress'],
    },
    {
      code: 'F-4003', name: 'Performance Pre-Load Stick Pack', customer: 'C-2003', format: 'stick_pack',
      servingSize: '1 stick pack (8 g)', servingsPerUnit: 30, totalFormatWeightMg: 8000, status: 'approved',
      actives: [
        line('CarnoSyn® beta-alanine', 3200),
        line('Creapure® creatine monohydrate', 3000),
        line('Carnipure® L-carnitine tartrate', 1000),
        line('Vitamin B12 (methyl)', 0.5),
      ],
      excipients: [
        exc('Citric acid', { inputMg: 200 }), exc('Natural flavor — citrus', { inputMg: 180 }),
        exc('Stevia Reb A 97%', { inputMg: 60 }), exc('Silicon dioxide', { inputMg: 40 }),
        exc('Maltodextrin', { isBaseFill: true }),
      ],
      packaging: [pack('Stick pack film'), pack('Master case (corrugated)')],
      services: [{ name: 'Blending', costPerUnit: 0.009, basis: '$9.00/1,000 servings' }, { name: 'Stick pack filling', costPerUnit: 0.0225, basis: '$22.50/1,000 units' }],
      claims: ['Supports muscular endurance', 'Supports energy metabolism'],
    },
    {
      code: 'F-4004', name: 'Radiance Collagen Gummy', customer: 'C-2004', format: 'gummy',
      servingSize: '2 gummies', servingsPerUnit: 30, totalFormatWeightMg: 5600, status: 'in_review',
      actives: [
        line('Verisol® collagen peptides', 2500),
        line('Vitamin C', 60),
        line('D-Biotin 2%', 0.25),
        line('Zinc bisglycinate chelate', 5),
      ],
      excipients: [
        exc('Citric acid', { inputMg: 55 }), exc('Natural flavor — citrus', { inputMg: 45 }),
        exc('Carnauba wax', { inputMg: 6 }), exc('Gummy base — pectin', { isBaseFill: true }),
      ],
      packaging: [pack('PET jar 500cc'), pack('CR cap 45mm'), pack('Shrink sleeve'), pack('Induction liner')],
      services: [{ name: 'Gummy manufacturing', costPerUnit: 0.042, basis: '$42.00/1,000 gummies' }, { name: 'Bottling / packaging', costPerUnit: 0.0085, basis: '$8.50/1,000 units' }],
      claims: ['Supports skin elasticity', 'Supports healthy hair and nails'],
    },
    {
      code: 'F-4005', name: 'Longevity NAD+ Support Capsule', customer: 'C-2010', format: 'capsule',
      servingSize: '2 capsules', servingsPerUnit: 30, totalFormatWeightMg: 1200, capsuleShellSize: '00', status: 'draft',
      actives: [
        line('Kaneka QH® ubiquinol', 100),
        line('Bacognize® bacopa', 300),
        line('Rhodiola extract', 200),
        line('Vitamin K2 MenaQ7®', 0.09),
      ],
      excipients: [exc('Magnesium stearate', { inputMg: 10 }), exc('Silicon dioxide', { inputMg: 6 }), exc('Microcrystalline cellulose', { isBaseFill: true })],
      packaging: [pack('PET amber bottle 150cc'), pack('CR cap 38mm'), pack('2-piece wrap label'), pack('Silica gel packet 1g')],
      services: [{ name: 'Encapsulation', costPerUnit: 0.0145, basis: '$14.50/1,000 capsules' }, { name: 'Bottling / packaging', costPerUnit: 0.008, basis: '$8.00/1,000 units' }],
      claims: ['Supports cellular energy production', 'Supports healthy ageing'],
    },
    {
      code: 'F-4006', name: 'Joint Mobility Tablet', customer: 'C-2009', format: 'tablet',
      servingSize: '2 tablets', servingsPerUnit: 45, totalFormatWeightMg: 2100, status: 'approved',
      actives: [line('Glucosamine sulfate 2KCl', 750), line('Chondroitin sulfate', 300), line('OptiMSM®', 500), line('Curcumin 95%', 100), line('BioPerine®', 5)],
      excipients: [
        exc('Dicalcium phosphate', { inputMg: 60 }), exc('Croscarmellose sodium', { inputMg: 40 }),
        exc('Stearic acid', { inputMg: 20 }), exc('Silicon dioxide', { inputMg: 10 }),
        exc('HPMC coating', { inputMg: 35 }), exc('Microcrystalline cellulose', { isBaseFill: true }),
      ],
      packaging: [pack('HDPE white bottle 250cc'), pack('CR cap 38mm'), pack('Front panel label'), pack('Back panel label'), pack('Silica gel packet 1g')],
      services: [{ name: 'Tablet compression', costPerUnit: 0.0145, basis: '$14.50/1,000 tablets' }, { name: 'Bottling / packaging', costPerUnit: 0.0075, basis: '$7.50/1,000 units' }],
      claims: ['Supports joint comfort and mobility'],
    },
    {
      code: 'F-4007', name: 'Bulk Magnesium Glycinate Powder', customer: 'C-2005', format: 'powder', isBulk: true,
      servingSize: '3 g', servingsPerUnit: 1, totalFormatWeightMg: 3000, status: 'approved',
      actives: [line('Magnesium glycinate', 2000)],
      excipients: [exc('Silicon dioxide', { inputMg: 20 }), exc('Maltodextrin', { isBaseFill: true })],
      packaging: [],
      services: [{ name: 'Blending', costPerUnit: 0.008, basis: '$8.00/1,000 servings' }],
      claims: ['Supports muscle and nerve function'],
    },
    {
      code: 'F-4008', name: "Children's Multivitamin Gummy", customer: 'C-2007', format: 'gummy',
      servingSize: '1 gummy', servingsPerUnit: 60, totalFormatWeightMg: 2500, status: 'in_review',
      actives: [
        line('Vitamin C', 30), line('Vitamin D3', 0.0125, { labelClaim: 500, labelUnit: 'IU' }),
        line('Vitamin E (natural)', 4.5, { labelClaim: 6.7, labelUnit: 'IU' }),
        line('Zinc gluconate', 2.5), line('Vitamin B12 (methyl)', 0.0018), line('D-Biotin 2%', 0.15),
      ],
      excipients: [
        exc('Citric acid', { inputMg: 40 }), exc('Natural flavor — mixed berry', { inputMg: 30 }),
        exc('Natural color — beet juice', { inputMg: 10 }), exc('Carnauba wax', { inputMg: 4 }),
        exc('Gummy base — pectin', { isBaseFill: true }),
      ],
      packaging: [pack('PET jar 250cc'), pack('CR cap 45mm'), pack('2-piece wrap label'), pack('Induction liner'), pack('Shrink band')],
      services: [{ name: 'Gummy manufacturing', costPerUnit: 0.0375, basis: '$37.50/1,000 gummies' }, { name: 'Bottling / packaging', costPerUnit: 0.0075, basis: '$7.50/1,000 units' }],
      claims: ['Supports growth and development', 'Supports immune health'],
    },
  ];

  const formulas = FORMULA_SPECS.map((spec) => db.insert('formulas', {
    code: spec.code,
    name: spec.name,
    revision: spec.status === 'approved' ? int(2, 4) : 1,
    status: spec.status,
    customerId: customerByCode[spec.customer]?.id ?? '',
    format: spec.format,
    isBulk: Boolean(spec.isBulk),
    servingSize: spec.servingSize,
    servingsPerUnit: spec.servingsPerUnit,
    unitsPerBatch: pick([10000, 25000, 50000]),
    totalFormatWeightMg: spec.totalFormatWeightMg,
    capsuleShellSize: spec.capsuleShellSize ?? '',
    overagePct: 5,
    actives: spec.actives,
    excipients: spec.excipients,
    packaging: spec.packaging,
    services: spec.services,
    claims: spec.claims,
    allergens: [...new Set(spec.actives.flatMap((a) => items.find((i) => i.id === a.itemId)?.allergens ?? []))],
    ownerId: userFor('rd').id,
    approvedBy: spec.status === 'approved' ? byRole('rd')[0].id : '',
    approvedAt: spec.status === 'approved' ? daysAgo(int(30, 300)) : null,
    tags: [spec.format],
    notes: '',
  }, sys));
  const formulaByCode = Object.fromEntries(formulas.map((f) => [f.code, f]));
  log(`${formulas.length} formulas`);

  // -- quotes (computed through the engine, not hand-written) --
  const QUOTE_SPECS = [
    ['F-4001', 'C-2001', 'accepted', [25000, 50000, 100000], [0.42, 0.38, 0.34]],
    ['F-4002', 'C-2006', 'sent', [10000, 25000, 50000], [0.46, 0.43, 0.40]],
    ['F-4003', 'C-2003', 'accepted', [10000, 25000, 50000], [0.44, 0.41, 0.37]],
    ['F-4004', 'C-2004', 'draft', [10000, 25000, 50000], [0.48, 0.45, 0.42]],
    ['F-4005', 'C-2010', 'draft', [5000, 10000, 25000], [0.50, 0.47, 0.44]],
    ['F-4006', 'C-2009', 'sent', [25000, 50000], [0.40, 0.36]],
    ['F-4008', 'C-2007', 'revised', [50000, 100000], [0.38, 0.34]],
  ];
  const quotes = QUOTE_SPECS.map(([formulaCode, customerCode, status, quantities, margins], i) => {
    const formula = formulaByCode[formulaCode];
    const tiers = quantities.map((qty, t) => ({
      qty,
      labor: suggestLabour(formula.format, qty),
      overheadRate: overheadRateForQty(qty),
      margin: margins[t],
    }));
    const customer = customerByCode[customerCode];
    // mint every document number through the sequence generator so the counters
    // stay in step with the seeded data and the next API-created record follows on
    const quoteNumber = db.nextSequence('QUOTE', 'Q-{yyyy}-{n:4}');
    const result = buildQuote({
      formula,
      tiers,
      coaFee: 120,
      meta: { customer: customer.name, productName: formula.name, quoteRef: quoteNumber },
    });
    return db.insert('quotes', {
      quoteNumber,
      title: formula.name,
      customerId: customer.id,
      formulaId: formula.id,
      status,
      revision: status === 'revised' ? 2 : 1,
      ownerId: customer.ownerId,
      coaFee: 120,
      tiers,
      snapshot: { code: formula.code, name: formula.name, format: formula.format, revision: formula.revision },
      result,
      leadTimeWeeks: 8,
      paymentTerms: '50% deposit, balance due prior to shipment',
      validUntil: daysAhead(status === 'draft' ? 30 : int(-10, 25)),
      sentAt: status === 'draft' ? null : daysAgo(int(3, 60)),
      decidedAt: status === 'accepted' ? daysAgo(int(1, 30)) : null,
      notes: status === 'revised' ? 'Revision 2 — customer asked to drop the 10,000-unit tier and re-price at 50k/100k.' : '',
      tags: [formula.format],
    }, sys);
  });
  log(`${quotes.length} quotes priced through the engine`);

  // -- projects --
  const PROJECT_SPECS = [
    ['P-5001', 'Nordvita Sleep Gummy — melatonin-free', 'C-2001', 'formulation', 'new_product', 'F-4001'],
    ['P-5002', 'Solace Calm Capsule launch', 'C-2006', 'validation', 'new_product', 'F-4002'],
    ['P-5003', 'Kestrel Pre-Load stick pack scale-up', 'C-2003', 'scale_up', 'line_extension', 'F-4003'],
    ['P-5004', 'Lumen Radiance collagen gummy', 'C-2004', 'sampling', 'new_product', 'F-4004'],
    ['P-5005', 'Ossian NAD+ longevity capsule', 'C-2010', 'feasibility', 'new_product', 'F-4005'],
    ['P-5006', 'BlueRidge joint tablet cost reduction', 'C-2009', 'launched', 'cost_down', 'F-4006'],
    ['P-5007', 'Harbor & Vine bulk magnesium', 'C-2005', 'launched', 'private_label', 'F-4007'],
    ['P-5008', "Ardent children's multivitamin", 'C-2007', 'pilot', 'new_product', 'F-4008'],
    ['P-5009', 'Verdant adaptogen line — 3 SKUs', 'C-2002', 'intake', 'new_product', null],
    ['P-5010', 'Correlate practitioner vitamin D3+K2', 'C-2012', 'intake', 'new_product', null],
    ['P-5011', 'Tidewater tincture reformulation', 'C-2011', 'on_hold', 'reformulation', null],
    ['P-5012', 'Meridian Vet joint chew feasibility', 'C-2008', 'feasibility', 'new_product', null],
  ];
  const projects = PROJECT_SPECS.map(([code, name, customerCode, stage, type, formulaCode], i) => {
    const formula = formulaCode ? formulaByCode[formulaCode] : null;
    const owner = userFor('rd');
    return db.insert('projects', {
      code, name, stage, type,
      customerId: customerByCode[customerCode].id,
      formulaId: formula?.id ?? '',
      quoteId: quotes.find((q) => q.formulaId === formula?.id)?.id ?? '',
      format: formula?.format ?? '',
      ownerId: owner.id,
      teamIds: pickN(users.filter((u) => ['rd', 'quality', 'operations', 'sales'].includes(u.role)).map((u) => u.id), int(2, 4)),
      priority: pick(['normal', 'normal', 'high', 'critical', 'low']),
      health: stage === 'on_hold' ? 'off_track' : pick(['on_track', 'on_track', 'on_track', 'at_risk']),
      targetLaunch: daysAhead(int(20, 240)),
      brief: `${customerByCode[customerCode].name} brief: ${name}. Target format ${formula?.format ?? 'to be confirmed'}, retail channel, clean-label positioning.`,
      requirements: [
        { label: 'Vegan / gelatin-free', met: chance(0.6) },
        { label: 'Gluten-free claim', met: chance(0.8) },
        { label: 'No artificial colours', met: chance(0.9) },
        { label: 'Third-party heavy metals COA', met: chance(0.5) },
      ],
      milestones: [
        { name: 'Brief signed off', due: dateOnly(-int(20, 90)), done: true, doneAt: daysAgo(int(20, 90)) },
        { name: 'Bench sample to customer', due: dateOnly(-int(1, 40)), done: i % 3 !== 2, doneAt: i % 3 !== 2 ? daysAgo(int(1, 40)) : null },
        { name: 'Pilot batch', due: dateOnly(int(5, 45)), done: ['scale_up', 'launched', 'validation'].includes(stage), doneAt: null },
        { name: 'Label approved', due: dateOnly(int(10, 70)), done: stage === 'launched', doneAt: null },
        { name: 'First commercial run', due: dateOnly(int(30, 150)), done: stage === 'launched', doneAt: null },
      ],
      gateChecks: [
        { gate: 'feasibility', label: 'Cost target achievable', passed: !['intake', 'feasibility'].includes(stage), by: owner.id },
        { gate: 'pilot', label: 'Pilot yield ≥ 92%', passed: ['validation', 'scale_up', 'launched'].includes(stage), by: owner.id },
        { gate: 'validation', label: 'Stability study initiated', passed: ['scale_up', 'launched'].includes(stage), by: owner.id },
      ],
      risks: stage === 'on_hold'
        ? [{ label: 'Customer paused funding', severity: 'high', owner: owner.id }]
        : chance(0.4) ? [{ label: pick(['Branded ingredient lead time 12+ weeks', 'Awaiting customer artwork', 'Second supplier not yet qualified']), severity: pick(['medium', 'high']), owner: owner.id }] : [],
      progress: { intake: 5, feasibility: 18, formulation: 35, sampling: 50, pilot: 68, validation: 80, scale_up: 92, launched: 100, on_hold: 40, cancelled: 0 }[stage] ?? 10,
      boardOrder: (i + 1) * 100,
      stageEnteredAt: daysAgo(int(2, 45)),
      tags: [type],
      notes: '',
    }, sys);
  });
  log(`${projects.length} development projects`);

  // -- lots + inventory transactions --
  const stockItems = items.filter((i) => i.type === 'raw_material' || i.type === 'packaging');
  const lots = [];
  let txnSeq = 0;
  const nextTxn = () => { txnSeq++; return db.nextSequence('TXN', 'T-{n:6}'); };
  for (const item of stockItems) {
    const lotCount = item.type === 'packaging' ? int(1, 2) : int(1, 3);
    for (let l = 0; l < lotCount; l++) {
      const receivedDaysAgo = int(5, 400);
      const isPackaging = item.type === 'packaging';
      const qty = isPackaging ? int(4000, 60000) : Number((rng() * 180 + 8).toFixed(2));
      const consumed = Number((qty * rng() * 0.7).toFixed(2));
      // only material that needs a certificate of analysis waits in quarantine;
      // packaging goes straight to the rack
      const status = item.requiresCoa && l === 0 && chance(0.14) ? 'quarantine'
        : item.requiresCoa && chance(0.04) ? 'on_hold'
          : 'released';
      const expires = receivedDaysAgo > 300 && chance(0.35)
        ? daysAhead(int(-20, 60))
        : daysAhead(item.shelfLifeDays - receivedDaysAgo);
      const lot = db.insert('lots', {
        lotNumber: `${item.itemCode.split('-').at(-1)}-${String(2600 + lots.length)}`,
        itemId: item.id,
        vendorId: item.defaultVendorId,
        vendorLot: `${pick(['A', 'B', 'C', 'M', 'X'])}${int(10000, 99999)}`,
        status,
        qtyReceived: qty,
        qtyOnHand: Number(Math.max(0, qty - consumed).toFixed(2)),
        uom: item.uom,
        locationId: status === 'quarantine' ? locations['QUAR-01'].id : item.defaultLocationId,
        unitCost: item.costPerUom,
        receivedAt: daysAgo(receivedDaysAgo),
        manufacturedAt: daysAgo(receivedDaysAgo + int(10, 60)),
        // packaging does not expire; only material with a shelf life carries a date
        expiresAt: isPackaging ? null : expires,
        retestAt: isPackaging ? null : daysAhead(365 - receivedDaysAgo),
        coaReceived: !item.requiresCoa || status !== 'quarantine',
        testResults: item.requiresCoa && status === 'released' ? [
          { test: 'Identity', method: 'FTIR', spec: 'Conforms', result: 'Conforms', pass: true },
          { test: 'Heavy metals', method: 'ICP-MS', spec: '< 10 ppm', result: `${money(0.2, 4)} ppm`, pass: true },
          { test: 'Microbial (TPC)', method: 'USP <2021>', spec: '< 1000 cfu/g', result: `${int(10, 400)} cfu/g`, pass: true },
        ] : [],
        dispositionBy: status === 'released' ? byRole('quality')[0].id : '',
        dispositionAt: status === 'released' ? daysAgo(receivedDaysAgo - 2) : null,
        notes: status === 'quarantine' ? 'Awaiting COA from vendor before disposition.' : '',
      }, sys);
      lots.push(lot);

      db.insert('inventoryTxns', {
        txnNumber: nextTxn(),
        type: 'receipt', itemId: item.id, lotId: lot.id, qty, uom: item.uom,
        toLocationId: lot.locationId, refType: 'lot', refId: lot.id,
        reason: 'Goods receipt', unitCost: item.costPerUom, balanceAfter: qty,
        performedAt: lot.receivedAt,
      }, sys);
      if (consumed > 0) {
        db.insert('inventoryTxns', {
          txnNumber: nextTxn(),
          type: 'issue', itemId: item.id, lotId: lot.id, qty: -consumed, uom: item.uom,
          fromLocationId: lot.locationId, refType: 'workOrder', refId: '',
          reason: 'Issued to production', unitCost: item.costPerUom, balanceAfter: lot.qtyOnHand,
          performedAt: daysAgo(Math.max(1, receivedDaysAgo - int(2, 30))),
        }, sys);
      }
    }
  }
  log(`${lots.length} lots, ${txnSeq} inventory transactions`);

  // -- purchase orders --
  const purchaseOrders = [];
  for (let i = 0; i < 14; i++) {
    const vendor = pick(vendors.filter((v) => ['raw_material', 'packaging'].includes(v.category)));
    const candidates = items.filter((it) => it.defaultVendorId === vendor.id);
    const chosen = pickN(candidates.length ? candidates : items, int(1, 4));
    const linesOut = chosen.map((it) => {
      const qty = it.type === 'packaging' ? int(5000, 40000) : int(25, 250);
      return {
        itemId: it.id, itemCode: it.itemCode, description: it.name,
        qty, uom: it.uom, unitCost: it.costPerUom,
        received: 0, expectedDate: dateOnly(int(-20, 45)), lotIds: [],
      };
    });
    const subtotal = Number(linesOut.reduce((s, l) => s + l.qty * l.unitCost, 0).toFixed(2));
    const freight = Number((subtotal * 0.03 + 40).toFixed(2));
    const status = pick(['draft', 'pending_approval', 'approved', 'sent', 'sent', 'partial', 'received', 'received']);
    if (status === 'received') linesOut.forEach((l) => { l.received = l.qty; });
    if (status === 'partial') linesOut.forEach((l, n) => { l.received = n === 0 ? l.qty : Math.floor(l.qty / 2); });
    purchaseOrders.push(db.insert('purchaseOrders', {
      poNumber: db.nextSequence('PO', 'PO-{yyyy}-{n:4}'),
      vendorId: vendor.id,
      status,
      buyerId: vendor.buyerId || userFor('purchasing').id,
      lines: linesOut,
      subtotal, freight, tax: 0,
      total: Number((subtotal + freight).toFixed(2)),
      currency: 'USD',
      orderedAt: ['draft', 'pending_approval'].includes(status) ? null : daysAgo(int(3, 70)),
      expectedAt: daysAhead(int(-15, 40)),
      receivedAt: status === 'received' ? daysAgo(int(1, 20)) : null,
      approvedBy: ['draft', 'pending_approval'].includes(status) ? '' : byRole('purchasing')[0].id,
      approvedAt: ['draft', 'pending_approval'].includes(status) ? null : daysAgo(int(4, 71)),
      terms: vendor.paymentTerms,
      shipTo: 'Enova Science, 1180 Innovation Way, Suite 300, Reno, NV 89502',
      notes: '',
    }, sys));
  }
  log(`${purchaseOrders.length} purchase orders`);

  // -- sales orders --
  const salesOrders = [];
  for (let i = 0; i < 16; i++) {
    const quote = pick(quotes);
    const formula = formulas.find((f) => f.id === quote.formulaId);
    const tier = pick(quote.tiers);
    const engineTier = quote.result.tiers.find((t) => t.qty === tier.qty) ?? quote.result.tiers[0];
    const unitPrice = Number(engineTier.salePricePerUnit ?? 0);
    const status = pick(['draft', 'confirmed', 'confirmed', 'in_production', 'in_production', 'ready', 'shipped', 'shipped', 'invoiced', 'closed']);
    const subtotal = Number((unitPrice * tier.qty).toFixed(2));
    salesOrders.push(db.insert('salesOrders', {
      orderNumber: db.nextSequence('SO', 'SO-{yyyy}-{n:4}'),
      customerId: quote.customerId,
      status,
      priority: pick(['normal', 'normal', 'high', 'low']),
      customerPo: `${pick(['PO', 'ORD', 'REQ'])}-${int(10000, 99999)}`,
      quoteId: quote.id,
      ownerId: quote.ownerId,
      lines: [{
        formulaId: formula?.id ?? '', description: quote.title, qty: tier.qty, uom: 'ea',
        unitPrice, shipped: ['shipped', 'invoiced', 'closed'].includes(status) ? tier.qty : 0,
      }],
      subtotal,
      freight: Number((subtotal * 0.015).toFixed(2)),
      total: Number((subtotal * 1.015).toFixed(2)),
      requestedShipDate: dateOnly(int(-30, 90)),
      promisedShipDate: dateOnly(int(-25, 95)),
      shippedAt: ['shipped', 'invoiced', 'closed'].includes(status) ? daysAgo(int(1, 40)) : null,
      notes: '',
      tags: [],
    }, sys));
  }
  log(`${salesOrders.length} sales orders`);

  // -- work orders --
  const STAGE_MIX = ['planned', 'planned', 'planned', 'released', 'released', 'staging', 'staging', 'in_process', 'in_process', 'in_process', 'qc_hold', 'qa_review', 'qa_review', 'complete', 'complete', 'complete', 'complete', 'complete'];
  const workOrders = [];
  STAGE_MIX.forEach((stage, i) => {
    const so = pick(salesOrders);
    const formula = formulas.find((f) => f.id === so.lines[0].formulaId) ?? pick(formulas);
    const plannedQty = so.lines[0].qty || 10000;
    const done = stage === 'complete';
    const started = !['planned', 'released'].includes(stage);
    const actualQty = done ? Math.round(plannedQty * money(0.92, 1.01, 4)) : 0;
    // A couple of freshly-planned batches arrive without a line or a start date —
    // they sit in the schedule's "awaiting a slot" tray until someone places them.
    const awaitingSlot = stage === 'planned' && (i === 1 || i === 2);

    const materials = [...formula.actives, ...formula.excipients].slice(0, 8).map((ing) => {
      const item = items.find((it) => it.id === ing.itemId);
      const lot = lots.find((lt) => lt.itemId === ing.itemId && lt.status === 'released');
      const perUnitMg = (ing.targetMg ?? ing.inputMg ?? 200) * 1.05 * (formula.servingsPerUnit || 1);
      const plannedKg = Number(((perUnitMg * plannedQty) / 1_000_000).toFixed(3));
      return {
        itemId: ing.itemId, itemCode: ing.code, name: ing.name,
        lotId: lot?.id ?? '', lotNumber: lot?.lotNumber ?? '',
        plannedQty: plannedKg,
        issuedQty: started ? Number((plannedKg * money(0.98, 1.02, 4)).toFixed(3)) : 0,
        uom: item?.uom ?? 'kg',
        issuedAt: started ? daysAgo(int(1, 12)) : null,
        issuedBy: started ? userFor('warehouse').id : '',
      };
    });

    const stepNames = {
      gummy: ['Sanitation verification', 'Slurry preparation', 'Active dispersion', 'Depositing', 'Curing (24h)', 'De-moulding', 'Wax coating', 'Bulk sampling', 'Bottling', 'Labelling', 'Case packing'],
      capsule: ['Sanitation verification', 'Dispensing / weighing', 'Blending (V-blender 20 min)', 'Blend uniformity sample', 'Encapsulation', 'Weight check (every 30 min)', 'Polishing / sorting', 'Bulk sampling', 'Bottling', 'Induction sealing', 'Labelling', 'Case packing'],
      tablet: ['Sanitation verification', 'Dispensing / weighing', 'Blending', 'Compression', 'Hardness / friability check', 'Coating', 'Bulk sampling', 'Bottling', 'Labelling', 'Case packing'],
      stick_pack: ['Sanitation verification', 'Dispensing / weighing', 'Blending', 'Blend uniformity sample', 'Stick pack filling', 'Seal integrity check', 'Case packing'],
      powder: ['Sanitation verification', 'Dispensing / weighing', 'Blending', 'Blend uniformity sample', 'Bulk packaging', 'Case packing'],
    }[formula.format] ?? ['Sanitation verification', 'Dispensing / weighing', 'Processing', 'Bulk sampling', 'Packaging'];

    const progressIndex = done ? stepNames.length
      : stage === 'qa_review' ? stepNames.length - 1
        : stage === 'in_process' ? int(2, stepNames.length - 3)
          : stage === 'qc_hold' ? int(3, 6)
            : stage === 'staging' ? 1 : 0;

    workOrders.push(db.insert('workOrders', {
      woNumber: db.nextSequence('WO', 'WO-{yyyy}-{n:4}'),
      batchNumber: db.nextSequence('BATCH', 'B{yy}{n:4}'),
      stage,
      priority: pick(['normal', 'normal', 'high', 'critical', 'low']),
      productName: formula.name,
      formulaId: formula.id,
      customerId: so.customerId,
      salesOrderId: so.id,
      line: awaitingSlot ? '' : pick({
        gummy: ['Gummy Line 1', 'Gummy Line 2'],
        capsule: ['Encapsulation 1', 'Encapsulation 2'],
        softgel: ['Encapsulation 1', 'Encapsulation 2'],
        tablet: ['Tablet Press'],
        tincture: ['Tincture'],
        sachet: ['Sachet / Stick Pack'],
        stick_pack: ['Sachet / Stick Pack'],
      }[formula.format] ?? ['Blending']),
      plannedQty,
      actualQty,
      uom: 'ea',
      plannedStart: awaitingSlot ? null : daysAgo(int(-25, 25)),
      plannedEnd: awaitingSlot ? null : daysAhead(int(-15, 35)),
      actualStart: started ? daysAgo(int(1, 20)) : null,
      // completed batches are spread across the quarter so the throughput chart
      // shows a real production history rather than one recent spike
      actualEnd: done ? daysAgo(int(2, 84)) : null,
      supervisorId: userFor('production').id,
      operatorIds: pickN(byRole('production').map((u) => u.id), 2),
      materials,
      steps: stepNames.map((name, s) => ({
        name,
        done: s < progressIndex,
        doneBy: s < progressIndex ? userFor('production').id : '',
        doneAt: s < progressIndex ? daysAgo(int(1, 14)) : null,
        requiresSignature: /sampling|uniformity|verification|check/i.test(name),
        notes: '',
      })),
      qcChecks: [
        { name: 'Blend uniformity (RSD)', spec: '≤ 5.0%', result: started ? `${money(1.2, 4.6, 1)}%` : '', status: started ? 'pass' : 'pending', checkedBy: started ? byRole('quality')[1].id : '', checkedAt: started ? daysAgo(int(1, 10)) : null },
        { name: 'Average weight', spec: '± 7.5% of target', result: started ? `${money(-3.5, 3.5, 1)}%` : '', status: started ? 'pass' : 'pending', checkedBy: started ? byRole('quality')[1].id : '', checkedAt: started ? daysAgo(int(1, 10)) : null },
        { name: 'Moisture', spec: '≤ 6.0%', result: done ? `${money(2.1, 5.4, 1)}%` : '', status: done ? 'pass' : 'pending', checkedBy: done ? byRole('quality')[1].id : '', checkedAt: done ? daysAgo(int(1, 10)) : null },
        { name: 'Microbial (TPC)', spec: '≤ 3000 cfu/g', result: done ? `${int(20, 900)} cfu/g` : '', status: done ? 'pass' : 'pending', checkedBy: done ? byRole('quality')[1].id : '', checkedAt: done ? daysAgo(int(1, 8)) : null },
      ],
      deviations: stage === 'qc_hold'
        ? [{ id: 'DEV-01', raisedBy: byRole('quality')[1].id, raisedAt: daysAgo(2), summary: 'Blend uniformity RSD 6.2% — outside the 5.0% specification on the second sample set.', status: 'open', disposition: '' }]
        : done && chance(0.2)
          ? [{ id: 'DEV-01', raisedBy: userFor('production').id, raisedAt: daysAgo(int(5, 20)), summary: 'Depositor downtime 42 minutes — mould temperature drift.', status: 'closed', disposition: 'No product impact. Preventive maintenance scheduled.' }]
          : [],
      yieldPct: done ? Number(((actualQty / plannedQty) * 100).toFixed(1)) : 0,
      holdReason: stage === 'qc_hold' ? 'Blend uniformity out of specification — awaiting QA disposition' : '',
      boardOrder: (i + 1) * 100,
      stageEnteredAt: daysAgo(int(1, 10)),
      releasedBy: done ? byRole('quality')[0].id : '',
      releasedAt: done ? daysAgo(int(1, 12)) : null,
      notes: '',
      tags: [formula.format],
    }, sys));
  });
  // Attribute the seeded consumption to the batches that used it, so lot
  // genealogy traces forward from a raw material to the customer who received it.
  for (const wo of workOrders) {
    if (['planned', 'released'].includes(wo.stage)) continue;
    for (const material of wo.materials) {
      if (!material.lotId || !material.issuedQty) continue;
      const orphan = db.find('inventoryTxns', { lotId: material.lotId, type: 'issue', refId: '' })[0];
      if (!orphan) continue;
      db.update('inventoryTxns', orphan.id, {
        refType: 'workOrder',
        refId: wo.id,
        reason: `Issued to ${wo.woNumber} — ${material.name}`,
      }, sys);
    }
  }
  log(`${workOrders.length} work orders`);

  // -- documents --
  const DOC_TEMPLATES = [
    ['Master Services Agreement', 'contract', 'customer'],
    ['Quality Agreement', 'contract', 'customer'],
    ['Signed Quote', 'quote', 'customer'],
    ['Customer Purchase Order', 'purchase_order', 'customer'],
    ['Approved Label Artwork', 'artwork', 'customer'],
    ['Certificate of Insurance', 'insurance', 'vendor'],
    ['Supplier Qualification Questionnaire', 'certificate', 'vendor'],
    ['NSF GMP Certificate', 'certificate', 'vendor'],
    ['Certificate of Analysis', 'coa', 'lot'],
    ['Raw Material Specification', 'spec', 'item'],
    ['Safety Data Sheet', 'sds', 'item'],
  ];
  const documents = [];
  const addDoc = (name, category, ownerType, ownerId, extra = {}) => {
    const version = extra.currentVersion ?? int(1, 3);
    documents.push(db.insert('documents', {
      name, category, ownerType, ownerId,
      customerId: ownerType === 'customer' ? ownerId : extra.customerId ?? '',
      vendorId: ownerType === 'vendor' ? ownerId : '',
      status: extra.status ?? pick(['approved', 'approved', 'approved', 'in_review', 'draft']),
      currentVersion: version,
      versions: Array.from({ length: version }, (_, v) => ({
        version: v + 1,
        filename: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${v + 1}.pdf`,
        fileId: '',
        size: int(80_000, 2_400_000),
        mime: 'application/pdf',
        uploadedBy: userFor('quality').id,
        uploadedAt: daysAgo(int(10, 500) - v * 30),
        notes: v === 0 ? 'Initial issue' : 'Revision',
        placeholder: true,
      })),
      effectiveDate: daysAgo(int(10, 400)),
      expiresAt: extra.expiresAt ?? (['certificate', 'insurance', 'coa'].includes(category) ? daysAhead(int(-30, 400)) : null),
      reviewerId: userFor('quality').id,
      approvedBy: userFor('quality').id,
      approvedAt: daysAgo(int(5, 300)),
      description: extra.description ?? '',
      confidential: category === 'contract',
      tags: [category],
    }, sys));
  };

  for (const customer of customers) {
    for (const [name, category] of DOC_TEMPLATES.filter(([, , owner]) => owner === 'customer')) {
      if (chance(0.75)) addDoc(`${customer.name} — ${name}`, category, 'customer', customer.id);
    }
  }
  for (const vendor of vendors) {
    for (const [name, category] of DOC_TEMPLATES.filter(([, , owner]) => owner === 'vendor')) {
      if (chance(0.7)) addDoc(`${vendor.name} — ${name}`, category, 'vendor', vendor.id);
    }
  }
  for (const lot of pickN(lots.filter((l) => l.status === 'released'), 40)) {
    const item = items.find((i) => i.id === lot.itemId);
    addDoc(`COA — ${item?.name} lot ${lot.lotNumber}`, 'coa', 'lot', lot.id, { status: 'approved', currentVersion: 1, expiresAt: lot.expiresAt });
  }
  for (const item of pickN(items.filter((i) => i.type === 'raw_material'), 30)) {
    addDoc(`${item.name} — Raw Material Specification`, 'spec', 'item', item.id, { status: 'approved' });
    if (chance(0.6)) addDoc(`${item.name} — Safety Data Sheet`, 'sds', 'item', item.id, { status: 'approved' });
  }
  for (const formula of formulas) {
    addDoc(`${formula.code} — Master Formula`, 'formula', 'formula', formula.id, { status: formula.status === 'approved' ? 'approved' : 'in_review', customerId: formula.customerId });
  }
  log(`${documents.length} documents`);

  // -- label reviews (run through the engine) --
  const LABEL_SPECS = [
    {
      formula: 'F-4001', customer: 'C-2001', product: 'Immune Defense Gummy', brand: 'Nordvita', revision: 'Rev. 3 - 04/26', status: 'in_review',
      panels: {
        pdp: 'NORDVITA\nImmune Defense Gummy\nElderberry + Zinc + Vitamin C\nDietary Supplement\n60 Gummies',
        information: `Supplement Facts
Serving Size: 2 Gummies
Servings Per Container: 30

Amount Per Serving   % Daily Value
Vitamin D (as cholecalciferol)   25 mcg (1,000 IU)   125%
Vitamin C (as ascorbic acid)   90 mg   100%
Zinc (as zinc gluconate)   5 mg   45%
Elderberry (Sambucus nigra) fruit extract 10:1   100 mg   †

† Daily Value not established.

Other Ingredients: Glucose syrup, sucrose, pectin, citric acid, malic acid, natural mixed berry flavor, beet juice (color), carnauba wax.

Distributed By: Nordvita Health LLC, 4820 Commerce Parkway, Suite 210, Boulder, CO 80301

012345678905`,
        leftSide: `Suggested Use: Take 2 to 4 gummies daily, or as directed by your healthcare professional.

Supports a healthy immune response. Helps prevent colds and flu.

WARNING: KEEP OUT OF REACH OF CHILDREN. If you are pregnant, nursing, or taking medication, consult your healthcare professional before use. Store in a cool, dry place.

These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.

Rev. 3 - 04/26`,
      },
    },
    {
      formula: 'F-4002', customer: 'C-2006', product: 'Calm & Focus Capsule', brand: 'Solace', revision: 'Rev. 1 - 06/26', status: 'corrections_requested',
      panels: {
        pdp: 'SOLACE\nCalm & Focus\nDietary Supplement\n60 Capsules',
        information: `Supplement Facts
Serving Size: 2 Capsules
Servings Per Container: 30

Amount Per Serving   % Daily Value
Vitamin B6 (as pyridoxal-5-phosphate)   1.7 mg   100%
Magnesium (as magnesium bisglycinate chelate)   100 mg   24%
KSM-66 Ashwagandha root extract   600 mg   †
L-Theanine   200 mg   †

† Daily Value not established.

Other Ingredients: Hypromellose (capsule), magnesium stearate, silicon dioxide, microcrystalline cellulose.

Manufactured: Solace Sleep Co., Austin, TX

01234567890`,
        leftSide: `Suggested Use: Take 2 capsules in the evening.

Supports a calm, focused state of mind.

Rev. 1 - 06/26`,
      },
    },
    {
      formula: 'F-4006', customer: 'C-2009', product: 'Joint Mobility Tablet', brand: 'BlueRidge Naturals', revision: 'Rev. 2 - 02/26', status: 'approved',
      panels: {
        pdp: 'BLUERIDGE NATURALS\nJoint Mobility\nDietary Supplement\n90 Tablets',
        information: `Supplement Facts
Serving Size: 2 Tablets
Servings Per Container: 45

Amount Per Serving   % Daily Value
Glucosamine Sulfate 2KCl   750 mg   †
Methylsulfonylmethane (OptiMSM®)   500 mg   †
Chondroitin Sulfate   300 mg   †
Turmeric (Curcuma longa) rhizome extract, standardized to 95% curcuminoids   100 mg   †
Black Pepper (Piper nigrum) fruit extract, standardized to 95% piperine (BioPerine®)   5 mg   †

† Daily Value not established.

Other Ingredients: Microcrystalline cellulose, dicalcium phosphate, croscarmellose sodium, stearic acid, silicon dioxide, hypromellose coating.

Contains: Crustacean shellfish (shrimp, crab).

Distributed By: BlueRidge Naturals Inc., 2210 Foundry Street, Asheville, NC 28801

036000291452`,
        leftSide: `Suggested Use: Take 2 tablets daily with food, or as directed by your healthcare professional.

Supports joint comfort and mobility.

WARNING: KEEP OUT OF REACH OF CHILDREN. If you are pregnant, nursing, or taking medication, consult your healthcare professional before use. Do not use if the safety seal is broken or missing. Store in a cool, dry place away from direct sunlight.

These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.

Rev. 2 - 02/26`,
      },
    },
  ];

  const labelReviews = LABEL_SPECS.map((spec, i) => {
    const formula = formulaByCode[spec.formula];
    const result = reviewLabel({ panels: spec.panels, formula, source: 'text' });
    return db.insert('labelReviews', {
      reviewNumber: db.nextSequence('LABEL', 'L-{yyyy}-{n:3}'),
      productName: spec.product,
      brand: spec.brand,
      customerId: customerByCode[spec.customer].id,
      formulaId: formula.id,
      projectId: projects.find((p) => p.formulaId === formula.id)?.id ?? '',
      status: spec.status,
      labelRevision: spec.revision,
      source: 'text',
      receivedAt: daysAgo(int(2, 25)),
      panels: spec.panels,
      checklist: result.checklist,
      findings: spec.status === 'approved'
        ? result.findings.map((f) => ({ ...f, decision: 'accepted', decidedBy: byRole('quality')[3].id, decidedAt: daysAgo(int(1, 10)) }))
        : result.findings,
      supplementFacts: {},
      metrics: result.metrics,
      reviewerId: byRole('quality')[3].id,
      reviewedAt: daysAgo(int(1, 20)),
      approverId: spec.status === 'approved' ? byRole('quality')[0].id : '',
      approvedAt: spec.status === 'approved' ? daysAgo(int(1, 8)) : null,
      documentIds: [],
      notes: '',
      tags: [],
    }, sys);
  });
  log(`${labelReviews.length} label reviews`);

  // -- cycle counts --
  for (let i = 0; i < 3; i++) {
    const location = pick([locations['RM-A'], locations['RM-B'], locations['PK-A']]);
    const scope = pickN(lots.filter((l) => l.locationId === location.id), 8);
    const status = ['closed', 'counting', 'scheduled'][i];
    db.insert('cycleCounts', {
      countNumber: db.nextSequence('COUNT', 'CC-{yyyy}-{n:3}'),
      locationId: location.id,
      status,
      scheduledFor: dateOnly(i === 2 ? int(3, 14) : -int(1, 20)),
      lines: scope.map((lot) => {
        const counted = status === 'scheduled' ? null : Number((lot.qtyOnHand * money(0.97, 1.03, 4)).toFixed(2));
        return {
          lotId: lot.id, lotNumber: lot.lotNumber, itemId: lot.itemId,
          expectedQty: lot.qtyOnHand, countedQty: counted,
          variance: counted === null ? null : Number((counted - lot.qtyOnHand).toFixed(2)),
          countedBy: counted === null ? '' : userFor('warehouse').id,
        };
      }),
      countedBy: status === 'scheduled' ? '' : userFor('warehouse').id,
      closedBy: status === 'closed' ? byRole('warehouse')[0].id : '',
      closedAt: status === 'closed' ? daysAgo(int(1, 15)) : null,
      notes: '',
    }, sys);
  }

  // -- shipments --
  for (const [i, so] of salesOrders.filter((s) => ['shipped', 'invoiced', 'closed'].includes(s.status)).entries()) {
    db.insert('shipments', {
      shipmentNumber: db.nextSequence('SHIP', 'SH-{yyyy}-{n:4}'),
      salesOrderId: so.id,
      customerId: so.customerId,
      status: pick(['delivered', 'delivered', 'in_transit']),
      carrier: pick(['FedEx Freight', 'XPO Logistics', 'Old Dominion', 'UPS Ground']),
      service: pick(['LTL', 'Ground', 'Expedited']),
      trackingNumber: `1Z${int(100000, 999999)}${int(1000000, 9999999)}`,
      cartons: int(8, 120),
      weightLb: int(120, 2400),
      cost: money(180, 2400),
      lines: so.lines.map((l) => ({ description: l.description, qty: l.qty })),
      shippedAt: so.shippedAt,
      deliveredAt: daysAgo(int(1, 20)),
      notes: '',
    }, sys);
  }

  // -- tasks --
  const TASK_TEMPLATES = [
    ['Chase COA from vendor', 'quality'], ['Review batch record before release', 'quality'],
    ['Confirm branded ingredient pricing with supplier', 'purchasing'], ['Schedule pilot batch', 'operations'],
    ['Send revised quote to customer', 'sales'], ['Update master formula revision', 'rd'],
    ['Cycle count Rack B', 'warehouse'], ['Qualify second supplier', 'purchasing'],
    ['Close out deviation DEV-01', 'quality'], ['Book stability study slot', 'rd'],
    ['Approve label artwork revision', 'quality'], ['Reconcile shipping variance', 'warehouse'],
  ];
  const tasks = [];
  for (let i = 0; i < 34; i++) {
    const [title, role] = pick(TASK_TEMPLATES);
    const status = pick(['todo', 'todo', 'doing', 'doing', 'blocked', 'done', 'done']);
    const ref = pick([
      { refType: 'workOrder', refId: pick(workOrders).id },
      { refType: 'project', refId: pick(projects).id },
      { refType: 'purchaseOrder', refId: pick(purchaseOrders).id },
      { refType: 'labelReview', refId: pick(labelReviews).id },
      { refType: '', refId: '' },
    ]);
    tasks.push(db.insert('tasks', {
      title,
      description: '',
      status,
      priority: pick(['low', 'normal', 'normal', 'high', 'critical']),
      // every fourth task lands with the operations lead, so the admin account
      // has a populated "my work" view on a fresh install
      assigneeId: i % 4 === 0 ? users[0].id : userFor(role).id,
      dueDate: dateOnly(int(-6, 21)),
      ...ref,
      refLabel: '',
      boardOrder: (i + 1) * 100,
      completedAt: status === 'done' ? daysAgo(int(1, 12)) : null,
      tags: [],
    }, sys));
  }
  log(`${tasks.length} tasks`);

  // -- activity feed --
  const ACTIVITY = [
    ['work_order', 'Work order released to the floor', 'accent'],
    ['lot', 'Lot released by QA', 'success'],
    ['quote', 'Quote sent to customer', 'info'],
    ['document', 'Document approved', 'success'],
    ['purchase_order', 'Purchase order sent to vendor', 'progress'],
    ['label_review', 'Label review findings raised', 'warning'],
    ['project', 'Project advanced a stage gate', 'accent'],
    ['inventory', 'Cycle count variance recorded', 'warning'],
  ];
  for (let i = 0; i < 40; i++) {
    const [type, title, tone] = pick(ACTIVITY);
    const actor = pick(users);
    db.insert('activity', {
      type, title, tone,
      detail: pick([
        `${pick(workOrders).woNumber} · ${pick(formulas).name}`,
        `${pick(customers).name}`,
        `${pick(vendors).name}`,
        `${pick(items).name}`,
      ]),
      actorId: actor.id,
      actorName: actor.name,
      refType: type,
      refId: '',
      link: '',
    }, { actorId: actor.id, actorName: actor.name });
  }

  // -- notifications --
  for (const user of pickN(users, 12)) {
    db.insert('notifications', {
      userId: user.id,
      title: pick(['A lot you released is expiring', 'You were assigned a task', 'A quote you own was accepted', 'A work order moved to QC hold']),
      body: pick(['Review before the end of the week.', 'Due in 3 days.', 'No action needed — for your awareness.']),
      link: pick(['/inventory', '/my-work', '/quotes', '/production']),
      severity: pick(['info', 'info', 'warning', 'success']),
      read: chance(0.4),
    }, sys);
  }

  // -- saved views --
  const SAVED_VIEWS = [
    ['Expiring in 90 days', 'inventory', { filter: { expiring: 90 }, sort: 'expiresAt' }, true],
    ['Quarantined lots', 'inventory', { filter: { status: 'quarantine' } }, true],
    ['My open quotes', 'quotes', { filter: { status: ['draft', 'sent'], mine: true } }, false],
    ['Overdue purchase orders', 'purchasing', { filter: { overdue: true } }, true],
    ['At-risk projects', 'development', { filter: { health: 'at_risk' } }, true],
    ['Labels awaiting sign-off', 'labels', { filter: { status: ['in_review', 'corrections_requested'] } }, true],
  ];
  SAVED_VIEWS.forEach(([name, module, config, shared], i) => {
    db.insert('savedViews', { name, module, config, shared, ownerId: users[0].id, boardOrder: (i + 1) * 100 }, sys);
  });

  db.checkpoint();
  return db.stats();
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dir = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
  const force = process.argv.includes('--force');
  if (force && fs.existsSync(dir)) {
    fs.rmSync(path.join(dir, 'db'), { recursive: true, force: true });
    fs.rmSync(path.join(dir, 'audit'), { recursive: true, force: true });
    console.log(`[seed] cleared ${dir}`);
  }
  const db = new Database({ dir, schema }).open();
  if (db.count('users') > 0 && !force) {
    console.log('[seed] database already has users — pass --force to rebuild');
    process.exit(0);
  }
  const stats = seed(db);
  db.close();
  console.log(`[seed] done — ${stats.totalRecords} records in ${dir}`);
}

export { STAFF, ACTIVES, EXCIPIENTS, PACKAGING };
