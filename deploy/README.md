# Deploying Shopare on the Mac mini (the hub)

One machine runs everything: the database, the auth service, the data API,
and the web app. Everyone on the network uses it from a browser — nothing to
install on their machines. Data lives on the mini, not in any cloud.

```
Browsers on your network ──▶ http://<mac-mini>:8080
                                 │  nginx (web container)
                 ┌───────────────┼──────────────────┐
                 │ static app    │ /auth/v1 → auth  │ /rest/v1 → rest
                 │               ▼                  ▼
                 │            GoTrue           PostgREST
                 │               └──────┬───────────┘
                 │                      ▼
                 │                  Postgres  (db container, Docker volume)
```

## One-time setup

**1. Install Docker on the Mac mini.**
[Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) or
[OrbStack](https://orbstack.dev) (lighter). Open it once so the engine runs,
and in its settings enable "Start at login."

**2. Get the code.**

```sh
git clone https://github.com/iyamwhoiyam/Doss.git
cd Doss
git checkout claude/start-from-scratch-b9xiru
```

**3. Generate the hub's secrets** (database password, JWT secret, API keys):

```sh
cd deploy
./gen-keys.sh
```

This writes `deploy/.env`. It is git-ignored — never commit it, and keep a
copy somewhere safe (password manager).

**4. Start the stack:**

```sh
docker compose up -d --build
```

First run downloads images and builds the app (a few minutes). The database
schema is applied automatically on the first boot of the empty database.
Check that all four containers are up:

```sh
docker compose ps
```

**5. Create logins** (public signup is disabled; accounts are admin-created):

```sh
./create-user.sh you@enovascience.com 'a-strong-password'
./create-user.sh teammate@enovascience.com 'another-password'
```

**6. Open the app.**
On the mini: <http://localhost:8080>. From any other machine on the network:
`http://<mac-mini-name>.local:8080` (find the name in System Settings →
General → Sharing, e.g. `http://enova-mini.local:8080`) or use the mini's IP.
Give the mini a static IP / DHCP reservation in your router so the address
never changes.

## Day-to-day operations

| Task | Command (from `deploy/`) |
| --- | --- |
| See status | `docker compose ps` |
| View logs | `docker compose logs -f web` (or `auth`, `rest`, `db`) |
| Restart everything | `docker compose restart` |
| Stop / start | `docker compose down` / `docker compose up -d` |
| Update to new app code | `git pull && docker compose up -d --build web` |
| Add a login | `./create-user.sh email password` |
| Manual backup | `./backup.sh` |

The containers restart automatically after a reboot or crash
(`restart: unless-stopped`), as long as Docker itself starts at login.

## Backups (do this)

`./backup.sh` writes a compressed full dump to `deploy/backups/` and keeps
the last 30. Schedule it nightly on the mini:

```sh
crontab -e
# add (adjust the path):
0 2 * * * cd /Users/YOU/Doss/deploy && ./backup.sh >> backups/backup.log 2>&1
```

Restore into a fresh stack:

```sh
gunzip -c backups/shopare-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U postgres -d postgres
```

Also back up `deploy/.env` — without it, existing sessions and keys can't be
reproduced. For real disaster-safety, sync `deploy/backups/` somewhere off
the mini (external disk, another machine, cloud drive).

## Direct database access (optional)

Postgres is reachable only from the mini itself on `localhost:5432`
(user `postgres`, password = `POSTGRES_PASSWORD` from `deploy/.env`):

```sh
docker compose exec db psql -U postgres -d postgres
```

## Troubleshooting

- **A container keeps restarting** — `docker compose logs <name>`. Most
  common cause: `deploy/.env` missing or edited after first boot. The
  database password is baked into the db volume on first initialization; if
  you regenerate keys, either restore the old `POSTGRES_PASSWORD` or reset
  the volume (`docker compose down -v` — **destroys all data**, restore from
  backup after).
- **Login fails with "invalid credentials"** — recreate the user with
  `./create-user.sh`; check `docker compose logs auth`.
- **App loads but every request errors** — check `docker compose logs rest`;
  usually the db wasn't healthy yet, `docker compose restart rest` fixes it.
- **Schema didn't apply** (fresh install only): apply manually:
  `docker compose exec -T db psql -U postgres -d postgres < ../db/migrations/001_shopare_schema.sql`

## Honest caveat

This stack was assembled from pinned, widely used images (Supabase Postgres,
GoTrue, PostgREST, nginx) and the exact schema already proven on the hosted
project, but the build sandbox it was authored in cannot download Docker
images, so the compose stack itself has not been booted end-to-end there.
The first `docker compose up` on the mini is the real test — if anything
misbehaves, grab `docker compose logs` and hand them back to Claude.

## Security notes

- The app is HTTP on the LAN. Don't port-forward 8080 to the internet as-is;
  if remote access is needed, put it behind Tailscale (easiest) or a
  reverse proxy with TLS.
- All data access requires a signed-in user; the anon key alone can read
  nothing (RLS denies it everything).
- `deploy/.env` holds the master secrets. Keep it out of git (already
  ignored) and out of chat/email.
