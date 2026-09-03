# Running Enova Ops

Everything an administrator needs, in one place. Nothing here requires a
database administrator, a cloud account or a migration tool.

---

## Deploying

The platform is one Node process and one directory.

```bash
git clone <repo> && cd Doss
npm install
npm run build
DATA_DIR=/srv/enova/data PORT=4000 NODE_ENV=production npm start
```

Put it behind whatever terminates TLS for you (nginx, Caddy, a load balancer)
and point it at port 4000. Session cookies are marked `secure` when
`NODE_ENV=production`; if you are deliberately running without TLS on an
internal network, set `ALLOW_INSECURE_COOKIE=1` — and understand what that
means before you do.

A systemd unit is all the supervision it needs:

```ini
[Unit]
Description=Enova Ops
After=network.target

[Service]
Type=simple
User=enova
WorkingDirectory=/srv/enova/app
Environment=NODE_ENV=production
Environment=DATA_DIR=/srv/enova/data
Environment=PORT=4000
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`SIGTERM` flushes every pending write and closes the database cleanly, so
`systemctl restart` is safe at any moment.

---

## The data directory

```
data/
  db/<collection>.json      the authoritative snapshot for one collection
  db/wal/<collection>.log   the write-ahead log since the last checkpoint
  db/_meta.json             document-number sequences (WO-2026-0001, Q-2026-0004, …)
  files/<yyyy>/<mm>/        uploaded documents, named by an opaque id
  audit/<yyyy-mm-dd>.ndjson one line per write, forever
  backups/<timestamp>/      rolling snapshot sets
```

Every file is plain UTF-8 JSON. You can read them, grep them, diff them and put
them in version control if you want to.

### Backing up

Copying `data/` is a complete backup. The safest sequence:

1. **Admin → Back up now** (or `POST /api/admin/backup`) — flushes pending
   writes, then copies every snapshot into `data/backups/<timestamp>/`.
2. Copy the whole `data/` directory wherever your backups live.

The server also takes a backup set every six hours on its own and keeps the last
24, so there is always about a week of history on disk.

### Restoring

Stop the process, replace `data/db/` with the snapshot set you want, delete
`data/db/wal/` (its contents are older than the snapshot you just restored), and
start again. Uploaded files live in `data/files/` and are not part of a snapshot
set — restore them from your own backup.

### Health

**Admin → Database** shows the record count and on-disk size per collection,
pending writes, writes since boot, the size of the uploaded-file store and the
audit log, backup sets, live connections and process memory. `Checkpoint` forces
every pending write to disk immediately; you never need it, but it is there
before a maintenance window.

---

## People and access

**Admin → People** creates accounts. A new account is issued a temporary
password, shown once, and the person must choose their own at first sign-in.
Resetting a password signs out every session that account has open.

**Admin → Sessions** lists every signed-in browser, with the option to sign one
out. Sessions expire after 14 days.

The last active administrator cannot be deactivated, and nobody can deactivate
their own account.

### Roles

| Role | Holds |
| --- | --- |
| Administrator | Everything, including people, settings and data tools |
| Executive | Read everything, plus approvals and pricing |
| Operations Manager | Production, inventory, purchasing and scheduling |
| Quality / QA | Lot disposition, label sign-off, deviations, documents |
| R&D / Formulation | Projects, formulas, samples and cost builds |
| Sales / Account Mgmt | Customers, quotes, orders and customer documents |
| Purchasing | Vendors, purchase orders and receiving |
| Production | Work orders, batch steps and material issue |
| Warehouse | Receiving, put-away, picking, counts and shipping |
| Viewer | Read-only |

Permissions are defined once in `shared/domain.js` and enforced by the server.
The interface hides what a role cannot do, but the hiding is cosmetic — the API
is the boundary.

---

## Settings

**Admin → Settings**, grouped by category. The ones that change behaviour:

| Key | Effect |
| --- | --- |
| `quote.coaFee` | The flat COA fee amortised into every quote (default $120) |
| `quote.overagePct` | Standard ingredient overage (default 5%) |
| `quote.leadTimeWeeks` | Lead time printed on quotes |
| `quote.paymentTerms` | Payment terms printed on quotes |
| `quote.validDays` | How long a sent quote stays valid |
| `quote.masterBidLoaded` | Turn on once the MASTER BID tier page has replaced the benchmark labour and overhead rates |
| `inventory.expiryWarningDays` | How far ahead an expiry alert fires (default 90) |
| `inventory.retestWindowDays` | Retest interval stamped on released raw material |
| `documents.expiryWarningDays` | How far ahead a document expiry warning fires |
| `production.lines` | The production lines offered when scheduling a batch |

Settings are records like any other, so a change is versioned and lands in the
audit trail with the name of whoever made it.

---

## The audit trail

Every write is appended to `data/audit/<date>.ndjson` with the collection, the
record, the operation, the person, and a field-level diff. It is append-only:
nothing in the application deletes or rewrites it.

Read it in **Admin → Audit trail**, filtered by collection, or per record from
any detail page (`GET /api/data/:collection/:id/history`). On disk it is one
JSON object per line, so `grep` and `jq` work exactly as you would expect:

```bash
jq -c 'select(.collection=="lots" and .op=="update")' data/audit/2026-08-20.ndjson
```

Where the platform requires a written override — releasing a lot without a COA,
approving against an unqualified vendor, sending a quote over a blocking
compliance finding, signing a label review single-handed — the reason is stored
on the record *and* in the audit line.

---

## Exporting

**Admin → Database → Export** downloads any collection as JSON, or:

```bash
curl -b cookies.txt http://localhost:4000/api/admin/export/formulas > formulas.json
```

The export is the same shape as what is on disk, minus redacted fields
(password hashes never leave the server).

---

## When something goes wrong

**The app will not start.** Check the log. A corrupt snapshot is reported by
name and the collection recovers from its WAL alone; restore that one file from
`data/backups/` if you need the rest of it.

**A record looks wrong.** Open its history from the detail page. The audit trail
shows every change, who made it and when. Archived records are recoverable —
`DELETE` is a soft delete, and **restore** brings it back. Permanent removal is
an admin-only purge that refuses to touch anything not already archived.

**Live updates stopped.** The presence dot in the top bar turns into a spinner
when the stream drops; it reconnects on its own with a backoff up to 15 seconds.
Data is never lost by this — the page refetches on reconnect.

**Stock and the ledger disagree.** They cannot, by construction: every quantity
change goes through a transaction that writes both the lot balance and the
ledger entry, or neither. If a physical count differs, post it as an adjustment
or a cycle count so the variance is recorded rather than silently absorbed.
