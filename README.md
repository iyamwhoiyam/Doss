# Enova Ops

The operating system for Enova Science — production, product development,
quality, supply, inventory, customer documents, formulation costing and label
review, in one place, live for everyone.

One Node process serves the whole platform. There is no external database, no
message broker and no build pipeline beyond Vite: **the data directory is the
deployment.**

```bash
npm install
npm run dev          # API on :4000, app on :5173 (proxied)
```

Open http://localhost:5173. On first boot the database seeds itself with the
Enova reference set — the 25-person roster, the ingredient and packaging
catalogue from the internal price list, approved vendors, customers, live
formulas and quotes, projects across every pipeline stage, work orders on the
floor, lots in the racks, and label reviews mid-flight.

Sign in as any seeded person; the default password is `enova2026` and everyone
is asked to choose their own at first sign-in. The operations lead is
`jbradfield@enovascience.com`.

For production:

```bash
npm run build && npm start   # one process on :4000, serving the built app
```

---

## What it does

| Module | What it covers |
| --- | --- |
| **Dashboard** | Live KPIs, the floor by stage, twelve weeks of throughput, everything that needs attention, your own work, the activity stream |
| **Production** | Drag-and-drop stage board, electronic batch records, material issue against specific lots, in-process QC checks, deviations, QA release |
| **Schedule** | Line-by-line planning timeline — drag a batch onto a line and a day to reschedule it, with daily capacity load and a tray of batches awaiting a slot |
| **Inventory** | On-hand by item and lot, receiving, QA disposition, adjustments, transfers, cycle counts, reorder and expiry alerts, full lot genealogy |
| **Vendors & POs** | Vendor qualification and scorecards, purchase order lifecycle, receiving against a PO, reorder suggestions that draft POs per vendor |
| **Development** | Stage-gated project pipeline with milestones, gate checks, requirements and risks |
| **Formulations** | The master formula: drag-to-reorder ingredients, live cost roll-up, compliance gates, revisions, generated Supplement Facts |
| **Quotes & costing** | Tiered cost generator — COGS, labour, overhead, COA amortisation, per-tier margin — plus the client-facing bid sheet |
| **Label review** | The 41-row Enova checklist, a 21 CFR rules engine over panel copy, a findings register with accept/deny, two-person sign-off, corrected proof |
| **Customers** | Accounts, contacts, the commercial history, and the customer document vault |
| **Documents** | Versioned document management with expiry tracking and a compliance watchlist |
| **Orders** | Sales orders through to shipment, tied to the batches that made them |
| **Admin** | Database health, backups, exports, the audit trail, people, sessions and settings |

Every page updates live. When someone drags a work order across the board, moves
stock or approves a label, everyone else sees it without refreshing.

---

## Architecture

```
shared/domain.js        one vocabulary — statuses, stages, roles, permissions
                        imported by both the server and the app so they cannot drift

server/
  db/engine.js          the file-system database
  db/schema.js          collections, fields, indexes, per-collection permissions
  db/seed.js            the Enova reference data
  calc/quoteEngine.js   deterministic costing and compliance
  calc/labelEngine.js   the 41-row checklist and the 21 CFR rules engine
  routes/               auth, generic CRUD, production, inventory, purchasing,
                        commerce, labels, documents, insights, admin
  lib/                  auth, realtime (SSE), events, http helpers

src/                    React app — design system, boards, builders, pages
data/                   the database itself (created on first boot, gitignored)
```

### The database

A purpose-built document store that lives entirely on the file system. Every
record is a plain JSON object in a file you can open, read, diff and copy.

Durability follows the shape a real database uses:

1. **Write-ahead log.** Every mutation is appended synchronously to
   `data/db/wal/<collection>.log` before it is acknowledged. A crash mid-write
   loses at most the record being appended, never the collection.
2. **Atomic snapshots.** `data/db/<collection>.json` is rewritten temp →
   `fsync` → `rename`, so a snapshot is never half-written.
3. **Replay on boot.** The snapshot is loaded and the WAL replayed on top, so
   the recovered state always equals the last acknowledged write. A torn final
   WAL line is discarded; everything before it survives.

On top of that: secondary indexes, an operator-based query layer (`$gte`,
`$in`, `$like`, `$or`, `$search`, …), optimistic concurrency via record
versions, soft delete with restore, transactions that roll back on failure, an
append-only audit trail (one NDJSON file per day, every field change attributed
to a person), and rolling backups.

```
data/
  db/<collection>.json     the authoritative snapshot
  db/wal/<collection>.log  the write-ahead log
  db/_meta.json            document-number sequences
  files/<yyyy>/<mm>/       uploaded documents
  audit/<yyyy-mm-dd>.ndjson
  backups/<timestamp>/
```

Backing the whole system up is `cp -r data`. Moving it is `scp`.

### Live sync

One Server-Sent Events stream per browser. Database changes are broadcast to
every signed-in client, which invalidates the matching query caches — batched on
a short timer so a transaction touching three collections costs one refetch
each, not three re-renders. The same channel carries presence, so you can see
who else is on the record you are editing.

### The engines

Two deterministic calculators, both covered by tests, both the single source of
truth for the numbers they produce.

**Quote engine** (`server/calc/quoteEngine.js`) — Enova's rules, not generic
manufacturing ones: 5% overage on every ingredient, exactly one excipient
carrying the base fill as the remainder of the format weight, a flat $120 COA
fee amortised across the tier, labour that scales down with volume, overhead as
a percentage of direct labour that steps down in bands, and overhead that is
never zero — including on bulk orders. Arithmetic runs on `decimal.js`, so the
on-screen cost builder, the saved quote and any export agree to the last digit.

It also runs the compliance gates on every change: the vitamin D3 4,000 IU upper
limit, vitamin E IU → mg AT conversion (and the 49% difference between the
natural and synthetic factors), CITES-listed botanicals, branded-ingredient
trademark attribution, Prop 65 heavy-metals families, capsule shell capacity
against the declared shell size, and any ingredient with no price on file.

**Label engine** (`server/calc/labelEngine.js`) — the 41-row Enova Label Review
Checklist with its evidence rule enforced in code. Twenty of the forty-one rows
depend on where things sit on the artwork, how they are drawn, or on a file that
is not the label; those come back as **Not reviewed** with the specific thing to
look at, and the API refuses to mark one compliant without a recorded comment.
The twenty-one rows the copy *can* settle run through a 21 CFR Part 101 rules
engine that recomputes every % Daily Value against the 2016 Daily Values, checks
nutrient order and units (IU is no longer a primary declaration), reconciles net
quantity, servings per container and the directions against each other and
against the master formula, catches undeclared major allergens, checks the
mandatory ingredient warnings, validates the UPC check digit, and rewrites
disease claims into lawful structure/function wording without touching the
customer's trademark.

Absence read by OCR is not evidence of absence: when the copy came from an
image, a missing element is reported as *confirm against the artwork*, and a
read below ~10 pixels per letter or 45% confidence is refused outright rather
than carried into a review.

---

## Roles

Ten roles, from `admin` down to `viewer`, each holding a named set of
capabilities defined once in `shared/domain.js`. The server enforces them; the
app only hides what the API would refuse, so the two can never disagree.

Some rules are deliberately hard to route around, because on a plant floor they
are the point:

- a batch cannot start with unstaged materials, and cannot be released with
  unfinished steps or open deviations;
- a lot that requires a certificate of analysis cannot be released without one;
- a purchase order against an unqualified vendor needs a written override, and
  the override is recorded on the order;
- a quote with a blocking compliance finding cannot be sent without a written
  reason;
- a label review needs a decision on every finding and two named signatures.

Every one of those overrides is written into the record and the audit trail.

---

## Development

```bash
npm run dev          # API + app with hot reload
npm test             # 87 tests: db engine, both calculators, the HTTP API
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production bundle
npm run seed         # rebuild the database from scratch (--force)
```

Configuration is by environment variable, all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `DATA_DIR` | `./data` | Where the database lives |
| `API_ORIGIN` | `http://127.0.0.1:4000` | Dev-server proxy target |
| `NODE_ENV` | — | `production` sets a secure session cookie |

There is also a browser smoke test that drives the real application — signing
in, dragging a work order across the board, rescheduling a batch onto a
production line, watching a formula re-price, hitting the guard rails — against a
running server:

```bash
npx playwright install chromium
DATA_DIR=/tmp/enova-smoke PORT=4200 node server/index.js &
node scripts/browser-smoke.mjs
```

The unit and API suite boots a real server against a throwaway data directory and drives
the real flows — signing in, dragging a work order, issuing material against a
lot, pricing a quote, running a label review, receiving against a purchase
order — so a passing suite means the platform works, not that the units do.
