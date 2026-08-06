import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { logActivity, diffDetail } from './audit';
import type {
  ActivityRow,
  Customer,
  DataQualityFlag,
  Employee,
  GateCatalogRow,
  GateStatus,
  InventoryItem,
  OrderGate,
  ProductionOrder,
  Project,
  ProjectConfidence,
  ProjectCost,
  ProjectIngredient,
  ProjectTier,
  Shipment,
  StageHistoryRow,
} from './types';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function must<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('no data');
  return data;
}

/* The canonical project-stage ladder. erp_projects.stage is free text in the
   data (17 distinct values); this maps each to a phase for grouping. */
export const PROJECT_STAGE_PHASE: Record<string, string> = {
  'Not Started': 'intake',
  'Pending Information': 'intake',
  'In Progress': 'intake',
  'Formulation/Sample Development': 'rnd',
  'Formulation Review': 'rnd',
  'Lab/Sampling': 'rnd',
  'Sample Sent to Customer': 'rnd',
  'Submitted for Tiered Pricing': 'quoting',
  'BID Process': 'quoting',
  'Bid Revision': 'quoting',
  'BID Sent': 'quoting',
  MFSO: 'commercial',
  'PO Submitted': 'commercial',
  'In Production': 'production',
  Completed: 'closed',
  Cancelled: 'closed',
  'On Hold': 'hold',
};

export const PHASE_ORDER = ['intake', 'rnd', 'quoting', 'commercial', 'production', 'closed', 'hold'];

export const PHASE_LABEL: Record<string, string> = {
  intake: 'Intake',
  rnd: 'R&D / Sampling',
  quoting: 'Quoting',
  commercial: 'Commercial',
  production: 'Production',
  closed: 'Closed',
  hold: 'On Hold',
};

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await supabase.from('employees').select('*').order('name');
      return must(data, error);
    },
    staleTime: 5 * 60_000,
  });
}

export function useGateCatalog() {
  return useQuery({
    queryKey: ['gate_catalog'],
    queryFn: async (): Promise<GateCatalogRow[]> => {
      const { data, error } = await supabase
        .from('erp_gate_catalog')
        .select('*')
        .order('gate_order');
      return must(data, error);
    },
    staleTime: 30 * 60_000,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async (): Promise<ProductionOrder[]> => {
      const { data, error } = await supabase
        .from('erp_production_orders')
        .select('*')
        .order('stage')
        .order('delivery_date', { ascending: true, nullsFirst: false });
      return must(data, error);
    },
  });
}

export function useOrder(ref: string | undefined) {
  return useQuery({
    queryKey: ['order', ref],
    enabled: !!ref,
    queryFn: async (): Promise<ProductionOrder | null> => {
      const { data, error } = await supabase
        .from('erp_production_orders')
        .select('*')
        .eq('ref', ref!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useOrderGates(ref: string | undefined) {
  return useQuery({
    queryKey: ['order_gates', ref],
    enabled: !!ref,
    queryFn: async (): Promise<OrderGate[]> => {
      const { data, error } = await supabase
        .from('erp_order_gates')
        .select('*')
        .eq('order_ref', ref!)
        .order('gate_order');
      return must(data, error);
    },
  });
}

export function useAllGates() {
  return useQuery({
    queryKey: ['all_gates'],
    queryFn: async (): Promise<OrderGate[]> => {
      const { data, error } = await supabase
        .from('erp_order_gates')
        .select('*')
        .order('order_ref')
        .order('gate_order');
      return must(data, error);
    },
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from('erp_projects')
        .select('*')
        .eq('archived', false)
        .order('date_received', { ascending: false, nullsFirst: false });
      return must(data, error);
    },
  });
}

export function useProject(pn: string | undefined) {
  return useQuery({
    queryKey: ['project', pn],
    enabled: !!pn,
    queryFn: async () => {
      const [proj, ing, tiers, costs, conf, hist] = await Promise.all([
        supabase.from('erp_projects').select('*').eq('pn', pn!).maybeSingle(),
        supabase.from('erp_project_ingredients').select('*').eq('pn', pn!).order('line_no'),
        supabase.from('erp_project_tiers').select('*').eq('pn', pn!).order('units'),
        supabase.from('erp_project_costs').select('*').eq('pn', pn!).maybeSingle(),
        supabase.from('erp_project_confidence').select('*').eq('pn', pn!).maybeSingle(),
        supabase
          .from('erp_project_stage_history')
          .select('*')
          .eq('pn', pn!)
          .order('ts', { ascending: false })
          .limit(20),
      ]);
      if (proj.error) throw new Error(proj.error.message);
      return {
        project: proj.data as Project | null,
        ingredients: (ing.data ?? []) as ProjectIngredient[],
        tiers: (tiers.data ?? []) as ProjectTier[],
        costs: (costs.data ?? null) as ProjectCost | null,
        confidence: (conf.data ?? null) as ProjectConfidence | null,
        history: (hist.data ?? []) as StageHistoryRow[],
      };
    },
  });
}

export function useFlags(status: 'open' | 'all' = 'open') {
  return useQuery({
    queryKey: ['flags', status],
    queryFn: async (): Promise<DataQualityFlag[]> => {
      let q = supabase
        .from('erp_data_quality_flags')
        .select('*')
        .order('severity')
        .order('created_at', { ascending: false });
      if (status === 'open') q = q.eq('status', 'open');
      const { data, error } = await q;
      return must(data, error);
    },
  });
}

export function useInventory(search: string, category: string | null) {
  return useQuery({
    queryKey: ['inventory', search, category],
    queryFn: async (): Promise<InventoryItem[]> => {
      let q = supabase.from('erp_inventory_items').select('*').order('sku').limit(300);
      if (search) q = q.or(`sku.ilike.%${search}%,description.ilike.%${search}%`);
      if (category) q = q.eq('category', category);
      const { data, error } = await q;
      return must(data, error);
    },
  });
}

export function useInventoryCategories() {
  return useQuery({
    queryKey: ['inventory_categories'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('erp_inventory_items')
        .select('category')
        .not('category', 'is', null);
      const rows = must(data, error) as { category: string }[];
      return [...new Set(rows.map((r) => r.category))].sort();
    },
    staleTime: 10 * 60_000,
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: async (): Promise<Customer[]> => {
      const { data, error } = await supabase.from('erp_customers').select('*').order('name');
      return must(data, error);
    },
    staleTime: 5 * 60_000,
  });
}

export function useShipments(limit = 100) {
  return useQuery({
    queryKey: ['shipments', limit],
    queryFn: async (): Promise<Shipment[]> => {
      const { data, error } = await supabase
        .from('erp_shipments')
        .select('*')
        .order('ship_date', { ascending: false, nullsFirst: false })
        .limit(limit);
      return must(data, error);
    },
  });
}

export function useActivity(limit = 50) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase
        .from('erp_activity_log')
        .select('*')
        .order('ts', { ascending: false })
        .limit(limit);
      return must(data, error);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations — every one writes erp_activity_log                       */
/* ------------------------------------------------------------------ */

export interface Actor {
  actor: string;
  actor_email: string;
}

export function useSetGateStatus(actor: Actor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { gate: OrderGate; status: GateStatus; note?: string }) => {
      const { gate, status, note } = args;
      const patch: Record<string, unknown> = {
        status,
        status_date: new Date().toISOString().slice(0, 10),
      };
      if (note !== undefined) patch.note = note;
      const { error } = await supabase.from('erp_order_gates').update(patch).eq('id', gate.id);
      if (error) throw new Error(error.message);
      await logActivity({
        ...actor,
        entity: 'order_gate',
        entity_ref: `${gate.order_ref}/${gate.gate_key}`,
        action: `gate_${status}`,
        detail: diffDetail(
          { status: gate.status, note: gate.note },
          { status, note: note ?? gate.note },
        ),
      });
      return args;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['order_gates', v.gate.order_ref] });
      qc.invalidateQueries({ queryKey: ['all_gates'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useUpdateOrder(actor: Actor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { order: ProductionOrder; patch: Partial<ProductionOrder> }) => {
      const { order, patch } = args;
      const { error } = await supabase
        .from('erp_production_orders')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', order.id);
      if (error) throw new Error(error.message);
      await logActivity({
        ...actor,
        entity: 'production_order',
        entity_ref: order.ref,
        action: 'order_update',
        detail: diffDetail(order as unknown as Record<string, unknown>, patch),
      });
      return args;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', v.order.ref] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useSetProjectStage(actor: Actor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { project: Project; stage: string }) => {
      const { project, stage } = args;
      const { error } = await supabase
        .from('erp_projects')
        .update({ stage, updated_at: new Date().toISOString() })
        .eq('pn', project.pn);
      if (error) throw new Error(error.message);
      // Stage history is its own table — mirror the ERP convention.
      await supabase.from('erp_project_stage_history').insert({
        pn: project.pn,
        from_stage: project.stage,
        to_stage: stage,
        actor: actor.actor,
        ts: new Date().toISOString(),
      });
      await logActivity({
        ...actor,
        entity: 'project',
        entity_ref: project.pn,
        action: 'stage_change',
        detail: `${project.stage ?? '∅'} → ${stage}`,
      });
      return args;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project', v.project.pn] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useUpdateProjectNotes(actor: Actor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { project: Project; notes: string }) => {
      const { project, notes } = args;
      const { error } = await supabase
        .from('erp_projects')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('pn', project.pn);
      if (error) throw new Error(error.message);
      await logActivity({
        ...actor,
        entity: 'project',
        entity_ref: project.pn,
        action: 'notes_update',
        detail: diffDetail({ notes: project.notes }, { notes }),
      });
      return args;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['project', v.project.pn] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useResolveFlag(actor: Actor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { flag: DataQualityFlag; resolution: 'resolved' | 'dismissed' }) => {
      const { flag, resolution } = args;
      const { error } = await supabase
        .from('erp_data_quality_flags')
        .update({
          status: resolution,
          resolved_at: new Date().toISOString(),
          resolved_by: actor.actor_email,
        })
        .eq('id', flag.id);
      if (error) throw new Error(error.message);
      await logActivity({
        ...actor,
        entity: 'dq_flag',
        entity_ref: `${flag.source_table}/${flag.source_ref}`,
        action: `flag_${resolution}`,
        detail: `${flag.field}: ${flag.observed_value ?? '∅'}${flag.suggested_value ? ` (suggested ${flag.suggested_value})` : ''}`,
      });
      return args;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flags'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
