# Shopare

A shop-management system for Enova, built on the workflow of an automotive
repair shop platform — but for supplement manufacturing. Started completely
blank: no data is read from, written to, or linked with any prior Enova
system.

## The mapping

| Auto-repair concept | Shopare equivalent |
| --- | --- |
| Customer | Customer (brand / client) |
| Vehicles on a customer | **SKUs** on a customer (expandable dropdown per row) |
| Repair order (RO) | **Project** (`RO #1001…`, status workflow) |
| Canned job (standard service) | **Canned job** — an approved production formulation. Created when a first-time customer approves a sample and pays for the bulk run, or for an in-house formulation. |
| Parts on an RO | **Ingredient lines** — generated only from the canned job's locked formulation. They cannot be added or edited on a project. |
| Labor time | **Labor lines** — canned jobs carry included time; more can be added per project. |

## Correctness guarantees (enforced in the database, not just the UI)

- **No duplicate customers.** A unique index on the normalized name blocks
  exact duplicates (case/whitespace-insensitive). Fuzzy matching (pg_trgm)
  flags near-duplicates and typos on entry, on bulk import, and in a
  "Review duplicates" panel with one-click merge.
- **Merging is lossless.** SKUs, projects and canned jobs move to the kept
  customer; missing contact fields backfill; the duplicate is archived, not
  deleted.
- **The generator is the only source of project ingredients.** The
  `shopare_service_ingredients` table has a read-only policy for clients;
  rows are inserted exclusively by the `shopare_add_service` function, which
  copies the canned job's formulation.
- **Formulations lock on activation.** A trigger rejects any ingredient
  change once a canned job leaves draft, and a canned job cannot activate
  with an empty formulation.

## Stack

- React 18 + TypeScript + Vite, React Router
- Supabase (Postgres + auth). All `shopare_*` tables require a signed-in
  user; the anon role has no access. Schema lives in the
  `shopare_blank_schema` migration on the Supabase project.

## Run it (local development)

```sh
cp .env.example .env
npm install
npm run dev
```

Sign in with an existing workspace account (Supabase auth).

## Deploy it (self-hosted hub)

The `deploy/` directory contains a complete Docker Compose stack that runs
the whole system — Postgres, auth, data API, and the web app — on one
machine (e.g. a Mac mini) with no cloud dependency. See
[`deploy/README.md`](deploy/README.md) for the step-by-step guide.
