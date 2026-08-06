# Enova AMP — Operations Hub

The primary employee dashboard and operational system for **Enova Science**. Runs against the
live `enova-brain` Supabase project (550 projects, ~100 production orders, 23-gate order
lifecycle, 1,700+ inventory items, per-employee role model).

```
┌─ marketing/        the public product page (static, no build)
├─ src/              the app (React 18 + Vite + TypeScript)
│  ├─ lib/           supabase client, session/roles, queries, audit trail
│  ├─ pages/         MyDay, Orders, OrderDetail, Projects, ProjectDetail,
│  │                 DataQuality, Inventory, Shipments, Activity, Login
│  └─ components/    Shell (nav), shared bits
└─ db/migrations/    001_revoke_anon_write.sql  ← NOT YET APPLIED, read it
```

## Run it

```bash
cp .env.example .env       # fill in the publishable key
npm install
npm run dev                # http://localhost:5173
```

Sign in with an Enova Supabase auth account (7 exist today; accounts are provisioned
centrally — there is no self-signup).

## What it does

| Surface | Backed by | Writes |
|---|---|---|
| **My Day** | your `employees` row + gate ownership | — |
| **Production Orders** | `erp_production_orders` — kanban across the 8 lifecycle stages, or list view | block/unblock order |
| **Order detail** | `erp_order_gates` — the full 23-gate ladder | complete / block / reopen any gate, with note |
| **Projects & Quotes** | `erp_projects` + ingredients, tiers, costs, `erp_project_confidence` | move stage (recorded in `erp_project_stage_history`), edit notes |
| **Data Quality** | `erp_data_quality_flags` — 371 flags, 367 open at build time | resolve / dismiss |
| **Inventory** | `erp_inventory_items` | read-only |
| **Shipments** | `erp_shipments` | read-only |
| **Activity Log** | `erp_activity_log` | every mutation in the app writes here |

**Every write is audited.** All mutations go through `src/lib/queries.ts`, which pairs the
primary write with an `erp_activity_log` row carrying actor, entity, action, and a
before→after diff.

## Role model

`employees.role` (9 roles: executive, product_development, rd_scientist, lab_technician,
lab_manager, qc_specialist, production_manager, product_specialist, admin) drives **My Day**:
gates are matched to you by owner name first, then by your role's departments
(`src/pages/MyDay.tsx`, `ROLE_DEPTS`). It intentionally does **not** hide pages — everyone
can see everything; the role decides what's front-of-mind, and RLS (not the UI) is the
security boundary.

## ⚠ Security: apply the migration

`db/migrations/001_revoke_anon_write.sql` fixes a real finding: the **anon role currently
has SELECT/INSERT/UPDATE policies** on `erp_projects`, `erp_production_orders`,
`erp_order_gates`, and SELECT on `erp_inventory_items`. Anyone with the publishable key —
which is public by design — can modify live ERP data without signing in.

The migration drops those anon policies and adds the authenticated-role policies the app
needs (`erp_data_quality_flags` update, `erp_activity_log` insert/select,
`erp_project_stage_history` insert). It is committed for review, **not applied**. Before
applying, confirm nothing else (a status page, a webhook) uses the anon key to write.

## Design decisions worth knowing

- **No generated types.** `src/lib/types.ts` covers the ~20 tables the app touches, hand
  written from the live schema. The DB has 70+ tables; generating all of them buries signal.
- **Stage vocabulary is descriptive, not prescriptive.** `erp_projects.stage` is free text
  with 17 distinct live values; the app groups them into phases (`PROJECT_STAGE_PHASE`) and
  offers the canonical list when moving, but never rewrites values it didn't set.
- **The audit log is best-effort by choice.** A failed audit insert logs to the console but
  doesn't roll back the primary write — the DB row itself is the durable record; the log is
  the human-readable trail.
- **My Day gate-matching is heuristic.** Gate owners in `erp_gate_catalog` are first names
  (including Christine and Vivian, who have no `employees` row yet). Name match wins;
  department match is the fallback. Add their employee rows and it tightens automatically.
