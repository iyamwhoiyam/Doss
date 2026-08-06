/* Hand-written types for the slice of `enova-brain` this app touches.
   Kept narrow on purpose: the database has 70+ tables and generating all of
   them buries the ones that matter. */

export type EmployeeRole =
  | 'executive'
  | 'product_development'
  | 'rd_scientist'
  | 'lab_technician'
  | 'lab_manager'
  | 'qc_specialist'
  | 'production_manager'
  | 'product_specialist'
  | 'admin';

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  email: string;
  active: boolean;
  created_at: string | null;
}

export interface StudioRole {
  email: string;
  role: string;
  updated_at: string | null;
}

/** erp_gate_catalog — the 23 gates that make up an order's lifecycle. */
export interface GateCatalogRow {
  gate_key: string;
  gate_order: number;
  stage_no: number;
  stage_name: string;
  department: string;
  owner_role: string | null;
}

export type GateStatus = 'done' | 'in_progress' | 'blocked';

export interface OrderGate {
  id: number;
  order_ref: string;
  gate_key: string;
  gate_order: number | null;
  stage_no: number | null;
  stage_name: string | null;
  department: string | null;
  owner: string | null;
  status: GateStatus | null;
  status_date: string | null;
  note: string | null;
}

export interface ProductionOrder {
  id: number;
  ref: string;
  customer: string | null;
  abbr: string | null;
  is_domestic: boolean | null;
  product: string | null;
  sales_rep: string | null;
  project_pn: string | null;
  customer_po: string | null;
  so_no: string | null;
  mo_refs: string | null;
  amount: number | null;
  unit_price: number | null;
  qty: number | null;
  unit: string | null;
  contract_date: string | null;
  delivery_date: string | null;
  stage: number | null;
  stage_name: string | null;
  status: string | null;
  pct: number | null;
  blocked: boolean | null;
  next_gate: string | null;
  next_stage: number | null;
  next_owner: string | null;
  next_dept: string | null;
  deposit_received: boolean | null;
  final_received: boolean | null;
  docs_outstanding: string[] | null;
  order_issues: string | null;
  priority: string | null;
  tags: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Project {
  pn: string;
  customer_id: string | null;
  customer_name: string | null;
  product: string | null;
  dosage_form: string | null;
  is_bulk: boolean | null;
  stage: string | null;
  pm: string | null;
  rep: string | null;
  date_received: string | null;
  servings_per_unit: number | null;
  serving_size: string | null;
  batch_units: number | null;
  moq: number | null;
  overage: number | null;
  material_loss: number | null;
  revision: number | null;
  mfso_signed: boolean | null;
  archived: boolean | null;
  keep_active: boolean | null;
  keep_visible: boolean | null;
  notes: string | null;
  updated_at: string | null;
  bid_priced: boolean | null;
  has_formula: boolean | null;
}

export interface ProjectIngredient {
  id: number;
  pn: string;
  line_no: number | null;
  name: string | null;
  sku: string | null;
  input_mg: number | null;
  potency_pct: number | null;
  overage: number | null;
  ai_suggested: boolean | null;
  matched: boolean | null;
}

export interface ProjectTier {
  id: number;
  pn: string;
  units: number | null;
  price: number | null;
  margin: number | null;
}

export interface ProjectCost {
  pn: string;
  cogs_per_unit: number | null;
  materials_cpu: number | null;
  active_cpu: number | null;
  base_cpu: number | null;
  shell_cpu: number | null;
  pkg_cpu: number | null;
  labor_per_unit: number | null;
  overhead_cpu: number | null;
  overhead_pct: number | null;
  source: string | null;
}

export interface ProjectConfidence {
  pn: string;
  n_lines: number | null;
  n_priced: number | null;
  n_unpriced: number | null;
  materials_known: number | null;
  exposure_usd: number | null;
  cogs: number | null;
  exposure_pct_cogs: number | null;
  lead_price: number | null;
  margin_usd: number | null;
  exposure_pct_margin: number | null;
  confidence: 'GREEN' | 'AMBER' | 'RED' | string | null;
  verdict: string | null;
  unpriced_skus: unknown;
  computed_at: string | null;
}

export interface StageHistoryRow {
  id: number;
  pn: string;
  from_stage: string | null;
  to_stage: string | null;
  actor: string | null;
  ts: string | null;
}

export type FlagSeverity = 'error' | 'warn' | 'review';
export type FlagStatus = 'open' | 'resolved' | 'dismissed';

export interface DataQualityFlag {
  id: number;
  source_table: string | null;
  source_ref: string | null;
  field: string | null;
  observed_value: string | null;
  suggested_value: string | null;
  severity: FlagSeverity | null;
  reason: string | null;
  status: FlagStatus | null;
  flagged_by: string | null;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface InventoryItem {
  sku: string;
  description: string | null;
  uom: string | null;
  category: string | null;
  unit_cost: number | null;
  on_hand: number | null;
  potency_pct: number | null;
  source: string | null;
  supplier: string | null;
  updated_at: string | null;
}

export interface Customer {
  id: string;
  name: string | null;
  created_at: string | null;
}

export interface Shipment {
  id: number;
  order_ref: string | null;
  customer: string | null;
  ship_date: string | null;
  description: string | null;
  boxes: number | null;
  units_per_box: number | null;
  total_units: number | null;
  tracking: string | null;
  shipping_cost: number | null;
  units_ordered: number | null;
  balance: number | null;
  notes: string | null;
}

export interface ActivityRow {
  id: number;
  ts: string | null;
  actor: string | null;
  actor_email: string | null;
  entity: string | null;
  entity_ref: string | null;
  action: string | null;
  detail: string | null;
}

export interface FormulaBlueprint {
  id: number;
  name: string | null;
  dosage_form: string | null;
  indication: string | null;
  servings: number | null;
  source_kind: string | null;
  source_pn: string | null;
  status: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}
