/**
 * Shared domain vocabulary — imported by both the API server and the React app
 * so the two can never drift. Plain ESM JavaScript with a `.d.ts` companion.
 *
 * Anything that appears in a dropdown, a board column, a status pill or a
 * validation `enum` should be defined here exactly once.
 */

// ── people ─────────────────────────────────────────────────────────────────
export const ROLES = {
  admin: { label: 'Administrator', rank: 100, blurb: 'Full access, including users, settings and data tools' },
  executive: { label: 'Executive', rank: 90, blurb: 'Read-everything plus approvals and pricing' },
  operations: { label: 'Operations Manager', rank: 80, blurb: 'Production, inventory, purchasing and scheduling' },
  quality: { label: 'Quality / QA', rank: 75, blurb: 'Lot disposition, label review sign-off, deviations, documents' },
  rd: { label: 'R&D / Formulation', rank: 70, blurb: 'Projects, formulas, samples and cost builds' },
  sales: { label: 'Sales / Account Mgmt', rank: 65, blurb: 'Customers, quotes, orders and customer documents' },
  purchasing: { label: 'Purchasing', rank: 60, blurb: 'Vendors, purchase orders and receiving' },
  production: { label: 'Production', rank: 50, blurb: 'Work orders, batch steps and material issue' },
  warehouse: { label: 'Warehouse', rank: 45, blurb: 'Receiving, put-away, picking, counts and shipping' },
  viewer: { label: 'Viewer', rank: 10, blurb: 'Read-only access across the platform' },
};

export const ROLE_KEYS = Object.keys(ROLES);

/** Capability → the roles that hold it. `admin` implicitly holds everything. */
export const PERMISSIONS = {
  'users.manage': ['admin'],
  'settings.manage': ['admin'],
  'data.manage': ['admin'],
  'customers.write': ['admin', 'sales', 'executive', 'operations'],
  'documents.write': ['admin', 'sales', 'quality', 'rd', 'operations', 'purchasing'],
  'documents.approve': ['admin', 'quality', 'executive'],
  'vendors.write': ['admin', 'purchasing', 'quality', 'operations'],
  'po.write': ['admin', 'purchasing', 'operations'],
  'po.approve': ['admin', 'purchasing', 'operations', 'executive'],
  'inventory.write': ['admin', 'warehouse', 'operations', 'production', 'purchasing'],
  'inventory.dispose': ['admin', 'quality'],
  'projects.write': ['admin', 'rd', 'operations', 'sales', 'executive'],
  'formulas.write': ['admin', 'rd', 'operations'],
  'formulas.approve': ['admin', 'rd', 'quality', 'executive'],
  'quotes.write': ['admin', 'sales', 'rd', 'operations', 'executive'],
  'quotes.send': ['admin', 'sales', 'executive'],
  'orders.write': ['admin', 'sales', 'operations', 'executive'],
  'production.write': ['admin', 'operations', 'production'],
  'production.release': ['admin', 'operations', 'quality'],
  'labels.write': ['admin', 'quality', 'rd', 'sales'],
  'labels.approve': ['admin', 'quality', 'executive'],
  'samples.write': ['admin', 'sales', 'rd', 'quality', 'operations'],
  // Product change control: who can send a product for customer approval / lock
  // it, and who can open a revision once it is customer-approved.
  'product.lock': ['admin', 'executive', 'sales', 'quality'],
  'product.revise': ['admin', 'executive', 'rd', 'quality'],
  'tasks.write': ROLE_KEYS,
  'cost.view': ['admin', 'executive', 'operations', 'rd', 'purchasing', 'sales'],
};

export function can(role, permission) {
  if (role === 'admin') return true;
  return (PERMISSIONS[permission] ?? []).includes(role);
}

// Samples sent to customers, labs or held as retention.
export const SAMPLE_TYPES = [
  { value: 'customer', label: 'Customer sample', tone: 'accent' },
  { value: 'lab', label: 'Lab submission', tone: 'info' },
  { value: 'retention', label: 'Retention', tone: 'neutral' },
  { value: 'internal', label: 'Internal / R&D', tone: 'progress' },
];

export const SAMPLE_STATUS = [
  { value: 'requested', label: 'Requested', tone: 'neutral', blurb: 'Sample asked for, not yet made' },
  { value: 'prepared', label: 'Prepared', tone: 'info', blurb: 'Pulled and packed, ready to ship' },
  { value: 'shipped', label: 'Shipped', tone: 'progress', blurb: 'On its way to the recipient' },
  { value: 'delivered', label: 'Delivered', tone: 'progress', blurb: 'Received by the recipient' },
  { value: 'reviewing', label: 'With customer', tone: 'warning', blurb: 'Awaiting feedback' },
  { value: 'approved', label: 'Approved', tone: 'success', blurb: 'Customer approved the sample' },
  { value: 'rejected', label: 'Changes needed', tone: 'danger', blurb: 'Customer wants changes' },
];

// Incoming requests for a quote, from first contact to won/lost.
export const RFQ_STATUS = [
  { value: 'new', label: 'New', tone: 'accent', blurb: 'Just came in — needs triage' },
  { value: 'reviewing', label: 'Reviewing', tone: 'info', blurb: 'Being scoped and qualified' },
  { value: 'quoting', label: 'Quoting', tone: 'progress', blurb: 'Formula and cost build underway' },
  { value: 'quoted', label: 'Quoted', tone: 'warning', blurb: 'Quote sent, awaiting the customer' },
  { value: 'won', label: 'Won', tone: 'success', blurb: 'Converted to a project' },
  { value: 'lost', label: 'Lost', tone: 'danger', blurb: 'Did not proceed' },
];

export const RFQ_SOURCE = [
  { value: 'website', label: 'Website' },
  { value: 'email', label: 'Email' },
  { value: 'referral', label: 'Referral' },
  { value: 'trade_show', label: 'Trade show' },
  { value: 'existing', label: 'Existing customer' },
  { value: 'other', label: 'Other' },
];

// A product (a Project and its formula, label and price) is fully editable while
// `open`, awaits the customer while `pending_approval`, and is frozen as the
// production-of-record once `locked` — changes then require a new revision.
export const PRODUCT_LOCK_STATES = [
  { value: 'open', label: 'In development', tone: 'progress', blurb: 'Fully editable — nothing is committed yet' },
  { value: 'pending_approval', label: 'Awaiting customer', tone: 'warning', blurb: 'Sent to the customer to review and sign off' },
  { value: 'locked', label: 'Customer-approved', tone: 'success', blurb: 'Locked as the production-of-record — changes need a revision' },
];

// ── shared status vocabularies ─────────────────────────────────────────────
/** Tone drives the colour of a status pill: see `--tone-*` tokens in the CSS. */
export const TONES = ['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'accent'];

const s = (value, label, tone) => ({ value, label, tone });

export const CUSTOMER_STATUS = [
  s('prospect', 'Prospect', 'info'),
  s('active', 'Active', 'success'),
  s('on_hold', 'On hold', 'warning'),
  s('inactive', 'Inactive', 'neutral'),
];

export const CUSTOMER_TIERS = [
  s('strategic', 'Strategic', 'accent'),
  s('key', 'Key account', 'info'),
  s('standard', 'Standard', 'neutral'),
  s('new', 'New', 'progress'),
];

export const VENDOR_STATUS = [
  s('approved', 'Approved', 'success'),
  s('pending', 'Pending qualification', 'warning'),
  s('probation', 'Probation', 'warning'),
  s('disqualified', 'Disqualified', 'danger'),
];

export const VENDOR_CATEGORIES = [
  s('raw_material', 'Raw material', 'info'),
  s('packaging', 'Packaging', 'info'),
  s('service', 'Service', 'neutral'),
  s('lab', 'Laboratory', 'accent'),
  s('logistics', 'Logistics', 'neutral'),
];

export const ITEM_TYPES = [
  s('raw_material', 'Raw material', 'info'),
  s('packaging', 'Packaging', 'accent'),
  s('finished_good', 'Finished good', 'success'),
  s('work_in_process', 'Work in process', 'progress'),
  s('consumable', 'Consumable', 'neutral'),
];

export const UOMS = ['kg', 'g', 'mg', 'L', 'mL', 'ea', 'case', 'roll', 'lb'];

export const LOT_STATUS = [
  s('quarantine', 'Quarantine', 'warning'),
  s('released', 'Released', 'success'),
  s('on_hold', 'On hold', 'warning'),
  s('rejected', 'Rejected', 'danger'),
  s('consumed', 'Consumed', 'neutral'),
  s('expired', 'Expired', 'danger'),
];

export const LOCATION_TYPES = [
  s('warehouse', 'Warehouse', 'neutral'),
  s('rack', 'Rack', 'neutral'),
  s('bin', 'Bin', 'neutral'),
  s('cold', 'Cold storage', 'info'),
  s('quarantine', 'Quarantine cage', 'warning'),
  s('production', 'Production floor', 'progress'),
  s('shipping', 'Shipping dock', 'accent'),
];

export const TXN_TYPES = [
  s('receipt', 'Receipt', 'success'),
  s('issue', 'Issue to production', 'progress'),
  s('adjustment', 'Adjustment', 'warning'),
  s('transfer', 'Transfer', 'info'),
  s('return', 'Return to stock', 'info'),
  s('scrap', 'Scrap', 'danger'),
  s('ship', 'Shipped', 'accent'),
  s('count', 'Cycle count', 'neutral'),
];

export const PO_STATUS = [
  s('draft', 'Draft', 'neutral'),
  s('pending_approval', 'Pending approval', 'warning'),
  s('approved', 'Approved', 'info'),
  s('sent', 'Sent to vendor', 'progress'),
  s('partial', 'Partially received', 'progress'),
  s('received', 'Received', 'success'),
  s('closed', 'Closed', 'neutral'),
  s('cancelled', 'Cancelled', 'danger'),
];

export const SO_STATUS = [
  s('draft', 'Draft', 'neutral'),
  s('confirmed', 'Confirmed', 'info'),
  s('in_production', 'In production', 'progress'),
  s('ready', 'Ready to ship', 'accent'),
  s('partially_shipped', 'Partially shipped', 'progress'),
  s('shipped', 'Shipped', 'success'),
  s('invoiced', 'Invoiced', 'success'),
  s('closed', 'Closed', 'neutral'),
  s('cancelled', 'Cancelled', 'danger'),
];

export const PRIORITIES = [
  s('low', 'Low', 'neutral'),
  s('normal', 'Normal', 'info'),
  s('high', 'High', 'warning'),
  s('critical', 'Critical', 'danger'),
];

export const HEALTH = [
  s('on_track', 'On track', 'success'),
  s('at_risk', 'At risk', 'warning'),
  s('off_track', 'Off track', 'danger'),
];

// ── boards (drag-and-drop columns) ─────────────────────────────────────────
/**
 * Product development pipeline. `gate` marks a stage that a project may not
 * leave until its gate checks are recorded.
 */
export const PROJECT_STAGES = [
  { value: 'intake', label: 'Intake', tone: 'neutral', blurb: 'Brief received, scoping the ask' },
  { value: 'feasibility', label: 'Feasibility', tone: 'info', gate: true, blurb: 'Can we make it, at what cost' },
  { value: 'formulation', label: 'Formulation', tone: 'progress', blurb: 'Building and costing the formula' },
  { value: 'sampling', label: 'Sampling', tone: 'progress', blurb: 'Bench samples with the customer' },
  { value: 'pilot', label: 'Pilot batch', tone: 'accent', gate: true, blurb: 'Scaled trial run on the line' },
  { value: 'validation', label: 'Validation', tone: 'accent', gate: true, blurb: 'Stability, potency, label lock' },
  { value: 'scale_up', label: 'Scale-up', tone: 'warning', blurb: 'First commercial run planned' },
  { value: 'launched', label: 'Launched', tone: 'success', blurb: 'In commercial production' },
];

export const PROJECT_TERMINAL = [
  s('on_hold', 'On hold', 'warning'),
  s('cancelled', 'Cancelled', 'danger'),
];

export const PROJECT_TYPES = [
  s('new_product', 'New product', 'accent'),
  s('reformulation', 'Reformulation', 'info'),
  s('line_extension', 'Line extension', 'progress'),
  s('private_label', 'Private label', 'neutral'),
  s('cost_down', 'Cost reduction', 'warning'),
];

/** Production floor board. `wipLimit` is advisory and shown on the column. */
export const WORK_ORDER_STAGES = [
  { value: 'planned', label: 'Planned', tone: 'neutral', blurb: 'Scheduled, materials not yet staged' },
  { value: 'released', label: 'Released', tone: 'info', blurb: 'Batch record issued to the floor' },
  { value: 'staging', label: 'Staging', tone: 'progress', wipLimit: 6, blurb: 'Weighing and kitting materials' },
  { value: 'in_process', label: 'In process', tone: 'progress', wipLimit: 4, blurb: 'Running on the line' },
  { value: 'qc_hold', label: 'QC hold', tone: 'warning', blurb: 'Waiting on a test result or decision' },
  { value: 'qa_review', label: 'QA review', tone: 'accent', blurb: 'Batch record review before release' },
  { value: 'complete', label: 'Complete', tone: 'success', blurb: 'Released to finished goods' },
];

export const WORK_ORDER_TERMINAL = [s('cancelled', 'Cancelled', 'danger')];

export const TASK_STATUS = [
  { value: 'todo', label: 'To do', tone: 'neutral' },
  { value: 'doing', label: 'In progress', tone: 'progress' },
  { value: 'blocked', label: 'Blocked', tone: 'danger' },
  { value: 'done', label: 'Done', tone: 'success' },
];

// ── formulation ────────────────────────────────────────────────────────────
export const FORMULA_FORMATS = [
  { value: 'gummy', label: 'Gummy', defaultWeightMg: 2500, laborPer1000: [35, 60], service: 'Gummy manufacturing' },
  { value: 'capsule', label: 'Capsule', defaultWeightMg: 600, laborPer1000: [12, 20], service: 'Encapsulation' },
  { value: 'tablet', label: 'Tablet', defaultWeightMg: 900, laborPer1000: [10, 18], service: 'Tablet compression' },
  { value: 'sachet', label: 'Sachet', defaultWeightMg: 5000, laborPer1000: [18, 30], service: 'Sachet filling' },
  { value: 'stick_pack', label: 'Stick pack', defaultWeightMg: 5000, laborPer1000: [18, 30], service: 'Stick pack filling' },
  { value: 'tincture', label: 'Tincture', defaultWeightMg: 1000, laborPer1000: [25, 45], service: 'Liquid filling' },
  { value: 'powder', label: 'Bulk powder', defaultWeightMg: 10000, laborPer1000: [6, 12], service: 'Blending' },
  { value: 'softgel', label: 'Softgel', defaultWeightMg: 800, laborPer1000: [14, 24], service: 'Softgel encapsulation' },
];

export const FORMULA_STATUS = [
  s('draft', 'Draft', 'neutral'),
  s('in_review', 'In review', 'warning'),
  s('approved', 'Approved', 'success'),
  s('superseded', 'Superseded', 'neutral'),
  s('retired', 'Retired', 'danger'),
];

export const QUOTE_STATUS = [
  s('draft', 'Draft', 'neutral'),
  s('sent', 'Sent', 'info'),
  s('accepted', 'Accepted', 'success'),
  s('declined', 'Declined', 'danger'),
  s('revised', 'Revised', 'progress'),
  s('expired', 'Expired', 'warning'),
];

/** Capsule shell fill windows, in mg — used by the capacity compliance check. */
export const CAPSULE_SHELLS = {
  '000': { min: 950, max: 1400 },
  '00': { min: 700, max: 950 },
  '0': { min: 500, max: 680 },
  '1': { min: 400, max: 500 },
  '2': { min: 300, max: 400 },
  '3': { min: 200, max: 300 },
};

/** Enova standing rules that the cost engine applies to every quote. */
export const QUOTE_DEFAULTS = {
  overagePct: 5,
  coaFee: 120,
  leadTimeWeeks: 8,
  paymentTerms: '50% deposit, balance due prior to shipment',
  validDays: 30,
  qcPctOfProduction: 0.12,
};

/** Overhead as a fraction of direct labour, stepping down with volume. */
export const OVERHEAD_BANDS = [
  { upTo: 10000, rate: 0.925, label: '≤ 10,000 units' },
  { upTo: 50000, rate: 0.75, label: '10,001 – 50,000' },
  { upTo: 100000, rate: 0.575, label: '50,001 – 100,000' },
  { upTo: Infinity, rate: 0.425, label: '100,001+' },
];

export function overheadRateForQty(qty) {
  return (OVERHEAD_BANDS.find((band) => qty <= band.upTo) ?? OVERHEAD_BANDS.at(-1)).rate;
}

// ── documents & labels ─────────────────────────────────────────────────────
export const DOCUMENT_CATEGORIES = [
  s('coa', 'Certificate of analysis', 'success'),
  s('spec', 'Specification', 'info'),
  s('sds', 'Safety data sheet', 'warning'),
  s('artwork', 'Label artwork', 'accent'),
  s('contract', 'Contract / MSA', 'neutral'),
  s('quote', 'Quote', 'info'),
  s('purchase_order', 'Customer PO', 'progress'),
  s('batch_record', 'Batch record', 'progress'),
  s('sop', 'SOP', 'neutral'),
  s('certificate', 'Certification', 'success'),
  s('insurance', 'Insurance', 'neutral'),
  s('formula', 'Master formula', 'accent'),
  s('other', 'Other', 'neutral'),
];

export const DOCUMENT_STATUS = [
  s('draft', 'Draft', 'neutral'),
  s('in_review', 'In review', 'warning'),
  s('approved', 'Approved', 'success'),
  s('expired', 'Expired', 'danger'),
  s('superseded', 'Superseded', 'neutral'),
];

export const DOCUMENT_OWNER_TYPES = ['customer', 'vendor', 'item', 'lot', 'project', 'formula', 'workOrder', 'labelReview', 'purchaseOrder', 'salesOrder', 'general'];

export const LABEL_REVIEW_STATUS = [
  s('draft', 'Draft', 'neutral'),
  s('in_review', 'In review', 'progress'),
  s('corrections_requested', 'Corrections requested', 'warning'),
  s('approved', 'Approved', 'success'),
  s('released', 'Released', 'accent'),
];

/** The state a single checklist row can be left in. */
export const CHECKLIST_STATES = [
  s('pass', 'Compliant', 'success'),
  s('fail', 'Correction required', 'danger'),
  s('not_reviewed', 'Not reviewed', 'neutral'),
  s('na', 'Not applicable', 'neutral'),
];

export const FINDING_TYPES = [
  s('required', 'Required correction', 'danger'),
  s('recommendation', 'Recommendation', 'warning'),
];

export const FINDING_DECISIONS = [
  s('pending', 'Pending', 'neutral'),
  s('accepted', 'Accepted', 'success'),
  s('denied', 'Denied', 'danger'),
];

// ── navigation ─────────────────────────────────────────────────────────────
/** The left-hand navigation. `perm` hides a section a role cannot use. */
export const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: 'dashboard' },
    { to: '/my-work', label: 'My work', icon: 'check' },
  ] },
  // In the order work flows through the building: sell it, develop it, make it, ship it.
  { group: 'Sell', items: [
    { to: '/rfqs', label: 'Quote requests', icon: 'clipboard' },
    { to: '/customers', label: 'Customers', icon: 'building' },
    { to: '/quotes', label: 'Quotes & costing', icon: 'calculator' },
    { to: '/orders', label: 'Orders & shipments', icon: 'cart' },
  ] },
  { group: 'Develop', items: [
    { to: '/development', label: 'Projects', icon: 'flask' },
    { to: '/formulations', label: 'Formulations', icon: 'beaker' },
    { to: '/samples', label: 'Samples', icon: 'send' },
    { to: '/labels', label: 'Label review', icon: 'label' },
  ] },
  { group: 'Make', items: [
    { to: '/planning', label: 'Planning', icon: 'target', perm: 'cost.view' },
    { to: '/purchasing', label: 'Purchasing', icon: 'truck' },
    { to: '/inventory', label: 'Inventory', icon: 'boxes' },
    { to: '/production', label: 'Production', icon: 'factory' },
    { to: '/schedule', label: 'Schedule', icon: 'calendar' },
    { to: '/routings', label: 'Routings', icon: 'sliders' },
  ] },
  { group: 'Records', items: [
    { to: '/documents', label: 'Documents', icon: 'folder' },
    { to: '/activity', label: 'Activity', icon: 'activity' },
    { to: '/reports', label: 'Reports', icon: 'chart', perm: 'cost.view' },
  ] },
  { group: 'System', items: [
    { to: '/admin', label: 'Admin', icon: 'settings', perm: 'settings.manage' },
  ] },
];

// ── lookup helpers ─────────────────────────────────────────────────────────
export function optionsFrom(list) {
  return list.map((o) => ({ value: o.value, label: o.label }));
}

export function findOption(list, value) {
  return list.find((o) => o.value === value) ?? { value, label: value ?? '—', tone: 'neutral' };
}

export function toneOf(list, value) {
  return findOption(list, value).tone ?? 'neutral';
}

export function labelOf(list, value) {
  return findOption(list, value).label;
}

export const enumValues = (list) => list.map((o) => o.value);
