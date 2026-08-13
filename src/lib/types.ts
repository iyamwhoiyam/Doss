export interface Customer {
  id: string;
  name: string;
  normalized_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sku {
  id: string;
  customer_id: string;
  sku_code: string;
  product_name: string;
  dosage_form: string | null;
  serving_size: string | null;
  servings_per_unit: number | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
}

export type CannedJobStatus = 'draft' | 'active' | 'retired';

export interface CannedJob {
  id: string;
  name: string;
  customer_id: string | null;
  sku_id: string | null;
  dosage_form: string | null;
  description: string | null;
  status: CannedJobStatus;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CannedJobIngredient {
  id: number;
  canned_job_id: string;
  line_no: number;
  name: string;
  ingredient_sku: string | null;
  amount_per_serving: number;
  unit: string;
  category: string | null;
  notes: string | null;
}

export interface CannedJobLabor {
  id: number;
  canned_job_id: string;
  seq: number;
  stage: string;
  hours: number;
  people: number;
  labor_rate: number;
  note: string | null;
}

export const PROJECT_STATUSES = [
  'estimate',
  'approved',
  'in_production',
  'qa',
  'ready',
  'invoiced',
  'closed',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  estimate: 'Estimate',
  approved: 'Approved',
  in_production: 'In Production',
  qa: 'QA',
  ready: 'Ready',
  invoiced: 'Invoiced',
  closed: 'Closed',
};

export interface Project {
  id: string;
  ro_number: number;
  customer_id: string;
  sku_id: string | null;
  title: string;
  status: ProjectStatus;
  batch_units: number | null;
  customer_po: string | null;
  promised_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ServiceStatus = 'pending' | 'in_progress' | 'done';

export interface ProjectService {
  id: string;
  project_id: string;
  canned_job_id: string;
  name: string;
  status: ServiceStatus;
  created_at: string;
}

export interface ServiceLabor {
  id: number;
  service_id: string;
  seq: number;
  stage: string;
  hours: number;
  people: number;
  labor_rate: number;
  source: 'canned' | 'manual';
  note: string | null;
}

export interface ServiceIngredient {
  id: number;
  service_id: string;
  line_no: number;
  name: string;
  ingredient_sku: string | null;
  amount_per_serving: number | null;
  unit: string;
  category: string | null;
  source: string;
}

export interface SimilarCustomer {
  id: string;
  name: string;
  sim: number;
}

export interface DupCandidate {
  id_a: string;
  name_a: string;
  id_b: string;
  name_b: string;
  sim: number;
}

export interface Activity {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
}
