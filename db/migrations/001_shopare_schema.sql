-- Shopare schema — identical to the `shopare_blank_schema` migration applied
-- to the hosted Supabase project. Runs on a fresh Supabase-compatible
-- Postgres (needs the anon/authenticated roles and auth.email(); both exist
-- in supabase/postgres images and on supabase.com).

create extension if not exists pg_trgm with schema extensions;

-- ── Customers ────────────────────────────────────────────────────────────
create table public.shopare_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  contact_name text,
  email text,
  phone text,
  address text,
  notes text,
  merged_into uuid references public.shopare_customers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Hard block on exact duplicates (case/whitespace-insensitive) among live customers.
create unique index shopare_customers_name_uniq on public.shopare_customers (normalized_name) where merged_into is null;
create index shopare_customers_name_trgm on public.shopare_customers using gin (normalized_name extensions.gin_trgm_ops);

-- ── SKUs (the "vehicles" of a customer) ──────────────────────────────────
create table public.shopare_skus (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.shopare_customers(id),
  sku_code text not null check (btrim(sku_code) <> ''),
  product_name text not null,
  dosage_form text,
  serving_size text,
  servings_per_unit numeric,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  unique (customer_id, sku_code)
);

-- ── Canned jobs (approved, paid-for production formulations) ─────────────
create table public.shopare_canned_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  customer_id uuid references public.shopare_customers(id),
  sku_id uuid references public.shopare_skus(id),
  dosage_form text,
  description text,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shopare_canned_job_ingredients (
  id bigint generated always as identity primary key,
  canned_job_id uuid not null references public.shopare_canned_jobs(id) on delete cascade,
  line_no int not null,
  name text not null check (btrim(name) <> ''),
  ingredient_sku text,
  amount_per_serving numeric not null check (amount_per_serving > 0),
  unit text not null default 'mg',
  category text,
  notes text,
  unique (canned_job_id, line_no)
);

create table public.shopare_canned_job_labor (
  id bigint generated always as identity primary key,
  canned_job_id uuid not null references public.shopare_canned_jobs(id) on delete cascade,
  seq int not null default 0,
  stage text not null,
  hours numeric not null default 0 check (hours >= 0),
  people numeric not null default 1,
  labor_rate numeric not null default 0,
  note text
);

-- Formulation lock: BOM rows can only change while the canned job is draft.
create or replace function public.shopare_guard_bom() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.shopare_canned_jobs
    where id = coalesce(new.canned_job_id, old.canned_job_id);
  if v_status is distinct from 'draft' then
    raise exception 'Formulation is locked (canned job is %). Ingredients only change while draft.', v_status;
  end if;
  return coalesce(new, old);
end $$;
create trigger shopare_bom_guard
  before insert or update or delete on public.shopare_canned_job_ingredients
  for each row execute function public.shopare_guard_bom();

-- Activation gate: a canned job cannot go active with an empty formulation.
create or replace function public.shopare_guard_job_status() returns trigger
language plpgsql as $$
begin
  if new.status = 'active' and old.status = 'draft' then
    if not exists (select 1 from public.shopare_canned_job_ingredients where canned_job_id = new.id) then
      raise exception 'Cannot activate a canned job with no ingredients';
    end if;
    new.activated_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger shopare_job_status
  before update on public.shopare_canned_jobs
  for each row execute function public.shopare_guard_job_status();

-- ── Projects (repair orders) ─────────────────────────────────────────────
create sequence public.shopare_ro_seq start 1001;

create table public.shopare_projects (
  id uuid primary key default gen_random_uuid(),
  ro_number bigint not null unique default nextval('public.shopare_ro_seq'),
  customer_id uuid not null references public.shopare_customers(id),
  sku_id uuid references public.shopare_skus(id),
  title text not null,
  status text not null default 'estimate'
    check (status in ('estimate','approved','in_production','qa','ready','invoiced','closed')),
  batch_units numeric,
  customer_po text,
  promised_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shopare_project_services (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.shopare_projects(id) on delete cascade,
  canned_job_id uuid not null references public.shopare_canned_jobs(id),
  name text not null,
  status text not null default 'pending' check (status in ('pending','in_progress','done')),
  created_at timestamptz not null default now()
);

create table public.shopare_service_labor (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.shopare_project_services(id) on delete cascade,
  seq int not null default 0,
  stage text not null check (btrim(stage) <> ''),
  hours numeric not null default 0 check (hours >= 0),
  people numeric not null default 1 check (people > 0),
  labor_rate numeric not null default 0 check (labor_rate >= 0),
  source text not null default 'manual' check (source in ('canned','manual')),
  note text
);

-- Generated ONLY by shopare_add_service(); clients get no write policy here.
create table public.shopare_service_ingredients (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.shopare_project_services(id) on delete cascade,
  line_no int not null,
  name text not null,
  ingredient_sku text,
  amount_per_serving numeric,
  unit text not null default 'mg',
  category text,
  source text not null default 'generator'
);

create table public.shopare_activity (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id text not null,
  action text not null,
  detail jsonb,
  actor text,
  created_at timestamptz not null default now()
);

-- ── RPCs ─────────────────────────────────────────────────────────────────
-- Adding a canned job to a project copies its locked BOM + default labor.
create or replace function public.shopare_add_service(p_project uuid, p_canned_job uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_job shopare_canned_jobs; v_service uuid;
begin
  select * into v_job from shopare_canned_jobs where id = p_canned_job;
  if not found then raise exception 'Canned job not found'; end if;
  if v_job.status <> 'active' then
    raise exception 'Only active canned jobs can be added to a project';
  end if;
  insert into shopare_project_services (project_id, canned_job_id, name)
    values (p_project, p_canned_job, v_job.name) returning id into v_service;
  insert into shopare_service_ingredients
      (service_id, line_no, name, ingredient_sku, amount_per_serving, unit, category)
    select v_service, i.line_no, i.name, i.ingredient_sku, i.amount_per_serving, i.unit, i.category
    from shopare_canned_job_ingredients i
    where i.canned_job_id = p_canned_job order by i.line_no;
  insert into shopare_service_labor (service_id, seq, stage, hours, people, labor_rate, source, note)
    select v_service, l.seq, l.stage, l.hours, l.people, l.labor_rate, 'canned', l.note
    from shopare_canned_job_labor l
    where l.canned_job_id = p_canned_job order by l.seq;
  insert into shopare_activity (entity, entity_id, action, detail, actor)
    values ('project', p_project::text, 'service_added',
            jsonb_build_object('canned_job', v_job.name), auth.email());
  return v_service;
end $$;

-- Merge duplicate customers: repoint children, tombstone the duplicate.
create or replace function public.shopare_merge_customers(p_survivor uuid, p_duplicate uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_survivor = p_duplicate then raise exception 'Cannot merge a customer into itself'; end if;
  if exists (select 1 from shopare_customers where id in (p_survivor, p_duplicate) and merged_into is not null) then
    raise exception 'One of these customers is already merged';
  end if;
  update shopare_skus set customer_id = p_survivor where customer_id = p_duplicate;
  update shopare_projects set customer_id = p_survivor where customer_id = p_duplicate;
  update shopare_canned_jobs set customer_id = p_survivor where customer_id = p_duplicate;
  update shopare_customers
     set merged_into = p_survivor, updated_at = now()
   where id = p_duplicate;
  update shopare_customers
     set contact_name = coalesce(contact_name, (select contact_name from shopare_customers where id = p_duplicate)),
         email        = coalesce(email,        (select email from shopare_customers where id = p_duplicate)),
         phone        = coalesce(phone,        (select phone from shopare_customers where id = p_duplicate)),
         address      = coalesce(address,      (select address from shopare_customers where id = p_duplicate)),
         updated_at   = now()
   where id = p_survivor;
  insert into shopare_activity (entity, entity_id, action, detail, actor)
    values ('customer', p_survivor::text, 'merge',
            jsonb_build_object('merged_id', p_duplicate), auth.email());
end $$;

-- Near-duplicate pairs among live customers (for the merge review panel).
create or replace function public.shopare_duplicate_candidates(p_threshold real default 0.5)
returns table (id_a uuid, name_a text, id_b uuid, name_b text, sim real)
language sql stable security definer set search_path = public, extensions as $$
  select a.id, a.name, b.id, b.name, similarity(a.normalized_name, b.normalized_name)
  from shopare_customers a
  join shopare_customers b on a.id < b.id
  where a.merged_into is null and b.merged_into is null
    and similarity(a.normalized_name, b.normalized_name) >= p_threshold
  order by 5 desc
$$;

-- Typo guard for create/import: live customers similar to a candidate name.
create or replace function public.shopare_similar_customers(p_name text, p_threshold real default 0.45)
returns table (id uuid, name text, sim real)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.name,
         similarity(c.normalized_name, lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')))
  from shopare_customers c
  where c.merged_into is null
    and similarity(c.normalized_name, lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))) >= p_threshold
  order by 3 desc limit 8
$$;

-- ── Security: signed-in employees only; anon gets nothing ────────────────
alter table public.shopare_customers              enable row level security;
alter table public.shopare_skus                   enable row level security;
alter table public.shopare_canned_jobs            enable row level security;
alter table public.shopare_canned_job_ingredients enable row level security;
alter table public.shopare_canned_job_labor       enable row level security;
alter table public.shopare_projects               enable row level security;
alter table public.shopare_project_services       enable row level security;
alter table public.shopare_service_labor          enable row level security;
alter table public.shopare_service_ingredients    enable row level security;
alter table public.shopare_activity               enable row level security;

create policy shopare_customers_auth  on public.shopare_customers              for all to authenticated using (true) with check (true);
create policy shopare_skus_auth       on public.shopare_skus                   for all to authenticated using (true) with check (true);
create policy shopare_jobs_auth       on public.shopare_canned_jobs            for all to authenticated using (true) with check (true);
create policy shopare_job_ing_auth    on public.shopare_canned_job_ingredients for all to authenticated using (true) with check (true);
create policy shopare_job_labor_auth  on public.shopare_canned_job_labor       for all to authenticated using (true) with check (true);
create policy shopare_projects_auth   on public.shopare_projects               for all to authenticated using (true) with check (true);
create policy shopare_services_auth   on public.shopare_project_services       for all to authenticated using (true) with check (true);
create policy shopare_labor_auth      on public.shopare_service_labor          for all to authenticated using (true) with check (true);
-- Ingredient lines on a project: READ ONLY. No insert/update/delete policy —
-- rows exist only via shopare_add_service (the generator).
create policy shopare_ing_read        on public.shopare_service_ingredients    for select to authenticated using (true);
create policy shopare_activity_read   on public.shopare_activity               for select to authenticated using (true);
create policy shopare_activity_ins    on public.shopare_activity               for insert to authenticated with check (true);

grant execute on function public.shopare_add_service(uuid, uuid) to authenticated;
grant execute on function public.shopare_merge_customers(uuid, uuid) to authenticated;
grant execute on function public.shopare_duplicate_candidates(real) to authenticated;
grant execute on function public.shopare_similar_customers(text, real) to authenticated;
revoke execute on function public.shopare_add_service(uuid, uuid) from anon;
revoke execute on function public.shopare_merge_customers(uuid, uuid) from anon;
revoke execute on function public.shopare_duplicate_candidates(real) from anon;
revoke execute on function public.shopare_similar_customers(text, real) from anon;

-- Self-hosted Postgres does not apply Supabase Cloud's default privileges,
-- so grant table/sequence access explicitly (RLS still gates row access).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
