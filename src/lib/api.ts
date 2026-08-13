import { supabase } from './supabase';
import type {
  Activity,
  CannedJob,
  CannedJobIngredient,
  CannedJobLabor,
  Customer,
  DupCandidate,
  Project,
  ProjectService,
  ProjectStatus,
  ServiceIngredient,
  ServiceLabor,
  ServiceStatus,
  SimilarCustomer,
  Sku,
} from './types';

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new ApiError(res.error.message, res.error.code);
  return res.data as T;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof ApiError && err.code === '23505';
}

/* ── Customers ─────────────────────────────────────────────────────────── */

export interface CustomerListRow extends Customer {
  skus: { count: number }[];
  projects: { count: number }[];
}

export async function listCustomers(search: string): Promise<CustomerListRow[]> {
  let q = supabase
    .from('shopare_customers')
    .select('*, skus:shopare_skus(count), projects:shopare_projects(count)')
    .is('merged_into', null)
    .order('name');
  if (search.trim()) q = q.ilike('name', `%${search.trim()}%`);
  return unwrap(await q) as unknown as CustomerListRow[];
}

export interface CustomerInput {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  return unwrap(
    await supabase.from('shopare_customers').insert(input).select().single(),
  ) as Customer;
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>): Promise<Customer> {
  return unwrap(
    await supabase
      .from('shopare_customers')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single(),
  ) as Customer;
}

export async function similarCustomers(name: string): Promise<SimilarCustomer[]> {
  if (!name.trim()) return [];
  return unwrap(
    await supabase.rpc('shopare_similar_customers', { p_name: name }),
  ) as SimilarCustomer[];
}

export async function duplicateCandidates(): Promise<DupCandidate[]> {
  return unwrap(await supabase.rpc('shopare_duplicate_candidates')) as DupCandidate[];
}

export async function mergeCustomers(survivorId: string, duplicateId: string): Promise<void> {
  unwrap(
    await supabase.rpc('shopare_merge_customers', {
      p_survivor: survivorId,
      p_duplicate: duplicateId,
    }),
  );
}

/* ── SKUs ──────────────────────────────────────────────────────────────── */

export async function listCustomerSkus(customerId: string): Promise<Sku[]> {
  return unwrap(
    await supabase
      .from('shopare_skus')
      .select('*')
      .eq('customer_id', customerId)
      .order('sku_code'),
  ) as Sku[];
}

export interface SkuInput {
  customer_id: string;
  sku_code: string;
  product_name: string;
  dosage_form?: string | null;
  serving_size?: string | null;
  servings_per_unit?: number | null;
  notes?: string | null;
}

export async function createSku(input: SkuInput): Promise<Sku> {
  return unwrap(await supabase.from('shopare_skus').insert(input).select().single()) as Sku;
}

/* ── Canned jobs ───────────────────────────────────────────────────────── */

export interface CannedJobFull extends CannedJob {
  ingredients: CannedJobIngredient[];
  labor: CannedJobLabor[];
  customer: { name: string } | null;
}

export async function listCannedJobs(): Promise<CannedJobFull[]> {
  const rows = unwrap(
    await supabase
      .from('shopare_canned_jobs')
      .select(
        '*, ingredients:shopare_canned_job_ingredients(*), labor:shopare_canned_job_labor(*), customer:shopare_customers(name)',
      )
      .order('created_at', { ascending: false }),
  ) as unknown as CannedJobFull[];
  for (const r of rows) {
    r.ingredients.sort((a, b) => a.line_no - b.line_no);
    r.labor.sort((a, b) => a.seq - b.seq);
  }
  return rows;
}

export interface CannedJobInput {
  name: string;
  customer_id?: string | null;
  sku_id?: string | null;
  dosage_form?: string | null;
  description?: string | null;
}

export interface IngredientLineInput {
  line_no: number;
  name: string;
  ingredient_sku: string | null;
  amount_per_serving: number;
  unit: string;
  category: string | null;
}

export interface LaborLineInput {
  seq: number;
  stage: string;
  hours: number;
  people: number;
  labor_rate: number;
  note: string | null;
}

export async function saveCannedJob(
  job: CannedJobInput,
  ingredients: IngredientLineInput[],
  labor: LaborLineInput[],
  existingId?: string,
): Promise<string> {
  let jobId = existingId;
  if (jobId) {
    unwrap(
      await supabase
        .from('shopare_canned_jobs')
        .update({ ...job })
        .eq('id', jobId),
    );
    unwrap(await supabase.from('shopare_canned_job_ingredients').delete().eq('canned_job_id', jobId));
    unwrap(await supabase.from('shopare_canned_job_labor').delete().eq('canned_job_id', jobId));
  } else {
    const created = unwrap(
      await supabase.from('shopare_canned_jobs').insert(job).select('id').single(),
    ) as { id: string };
    jobId = created.id;
  }
  if (ingredients.length) {
    unwrap(
      await supabase
        .from('shopare_canned_job_ingredients')
        .insert(ingredients.map((l) => ({ ...l, canned_job_id: jobId }))),
    );
  }
  if (labor.length) {
    unwrap(
      await supabase
        .from('shopare_canned_job_labor')
        .insert(labor.map((l) => ({ ...l, canned_job_id: jobId }))),
    );
  }
  return jobId;
}

export async function setCannedJobStatus(id: string, status: CannedJob['status']): Promise<void> {
  unwrap(await supabase.from('shopare_canned_jobs').update({ status }).eq('id', id));
}

/* ── Projects ──────────────────────────────────────────────────────────── */

export interface ProjectListRow extends Project {
  customer: { name: string } | null;
  sku: { sku_code: string; product_name: string } | null;
}

export async function listProjects(): Promise<ProjectListRow[]> {
  return unwrap(
    await supabase
      .from('shopare_projects')
      .select('*, customer:shopare_customers(name), sku:shopare_skus(sku_code, product_name)')
      .order('ro_number', { ascending: false }),
  ) as unknown as ProjectListRow[];
}

export interface ProjectInput {
  customer_id: string;
  sku_id?: string | null;
  title: string;
  batch_units?: number | null;
  customer_po?: string | null;
  promised_date?: string | null;
  notes?: string | null;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const project = unwrap(
    await supabase.from('shopare_projects').insert(input).select().single(),
  ) as Project;
  await logActivity('project', project.id, 'created', { title: project.title });
  return project;
}

export async function updateProject(
  id: string,
  input: Partial<ProjectInput> & { status?: ProjectStatus },
): Promise<void> {
  unwrap(
    await supabase
      .from('shopare_projects')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id),
  );
}

export interface ServiceDetail extends ProjectService {
  labor: ServiceLabor[];
  ingredients: ServiceIngredient[];
}

export interface ProjectDetailData extends Project {
  customer: Customer;
  sku: Sku | null;
  services: ServiceDetail[];
}

export async function getProject(id: string): Promise<ProjectDetailData> {
  const row = unwrap(
    await supabase
      .from('shopare_projects')
      .select(
        `*,
         customer:shopare_customers(*),
         sku:shopare_skus(*),
         services:shopare_project_services(*, labor:shopare_service_labor(*), ingredients:shopare_service_ingredients(*))`,
      )
      .eq('id', id)
      .single(),
  ) as unknown as ProjectDetailData;
  row.services.sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const s of row.services) {
    s.labor.sort((a, b) => a.seq - b.seq || a.id - b.id);
    s.ingredients.sort((a, b) => a.line_no - b.line_no);
  }
  return row;
}

/* The generator: the ONLY way ingredient lines land on a project. */
export async function addServiceToProject(projectId: string, cannedJobId: string): Promise<void> {
  unwrap(
    await supabase.rpc('shopare_add_service', {
      p_project: projectId,
      p_canned_job: cannedJobId,
    }),
  );
}

export async function removeService(serviceId: string): Promise<void> {
  unwrap(await supabase.from('shopare_project_services').delete().eq('id', serviceId));
}

export async function setServiceStatus(serviceId: string, status: ServiceStatus): Promise<void> {
  unwrap(await supabase.from('shopare_project_services').update({ status }).eq('id', serviceId));
}

/* ── Labor lines (canned defaults are editable; manual lines addable) ──── */

export interface ManualLaborInput {
  service_id: string;
  stage: string;
  hours: number;
  people: number;
  labor_rate: number;
  note?: string | null;
}

export async function addLaborLine(input: ManualLaborInput): Promise<void> {
  unwrap(
    await supabase
      .from('shopare_service_labor')
      .insert({ ...input, source: 'manual', seq: 999 }),
  );
}

export async function updateLaborLine(
  id: number,
  input: Partial<Pick<ServiceLabor, 'stage' | 'hours' | 'people' | 'labor_rate' | 'note'>>,
): Promise<void> {
  unwrap(await supabase.from('shopare_service_labor').update(input).eq('id', id));
}

export async function deleteLaborLine(id: number): Promise<void> {
  unwrap(await supabase.from('shopare_service_labor').delete().eq('id', id));
}

/* ── Activity ──────────────────────────────────────────────────────────── */

export async function logActivity(
  entity: string,
  entityId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  await supabase.from('shopare_activity').insert({
    entity,
    entity_id: entityId,
    action,
    detail: detail ?? null,
    actor: data.user?.email ?? null,
  });
}

export async function listActivity(entity: string, entityId: string): Promise<Activity[]> {
  return unwrap(
    await supabase
      .from('shopare_activity')
      .select('*')
      .eq('entity', entity)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(30),
  ) as Activity[];
}
