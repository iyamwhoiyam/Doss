-- ─────────────────────────────────────────────────────────────────────────
-- 001_revoke_anon_write.sql  (NOT YET APPLIED — review before running)
--
-- Finding (2026-08-06): the `anon` role currently has SELECT + INSERT +
-- UPDATE policies on core ERP tables in the enova-brain project. Anyone
-- holding the publishable anon key — which ships in every browser bundle —
-- can read and MODIFY production orders, gates, and projects without
-- signing in.
--
-- This migration removes every anon-role policy on those tables. The AMP
-- app always runs authenticated, so it is unaffected. If some existing
-- integration (a public status page, a Zapier hook using the anon key)
-- relies on anon access, identify it BEFORE applying and either give it a
-- service-role key server-side or scope it a narrow SELECT-only policy.
--
-- Apply via: Supabase MCP apply_migration, or the SQL editor.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists erp_projects_anon_sel          on public.erp_projects;
drop policy if exists erp_projects_anon_upd          on public.erp_projects;

drop policy if exists erp_production_orders_anon_sel on public.erp_production_orders;
drop policy if exists erp_production_orders_anon_ins on public.erp_production_orders;
drop policy if exists erp_production_orders_anon_upd on public.erp_production_orders;

drop policy if exists erp_order_gates_anon_sel       on public.erp_order_gates;
drop policy if exists erp_order_gates_anon_ins       on public.erp_order_gates;
drop policy if exists erp_order_gates_anon_upd       on public.erp_order_gates;

drop policy if exists erp_inventory_items_anon_sel   on public.erp_inventory_items;

-- The app needs authenticated write access to two more tables that today
-- may only have read policies. Idempotent creates:

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'erp_data_quality_flags'
      and policyname = 'erp_dq_flags_auth_upd'
  ) then
    create policy erp_dq_flags_auth_upd on public.erp_data_quality_flags
      for update to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'erp_activity_log'
      and policyname = 'erp_activity_log_auth_ins'
  ) then
    create policy erp_activity_log_auth_ins on public.erp_activity_log
      for insert to authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'erp_activity_log'
      and policyname = 'erp_activity_log_auth_sel'
  ) then
    create policy erp_activity_log_auth_sel on public.erp_activity_log
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'erp_project_stage_history'
      and policyname = 'erp_stage_history_auth_ins'
  ) then
    create policy erp_stage_history_auth_ins on public.erp_project_stage_history
      for insert to authenticated with check (true);
  end if;
end $$;
