# Putting Enova Ops online

This gets the platform running on a real server that the whole team can reach in
a browser. No database to set up, no build pipeline — one server, one command.

The app keeps all of its data (records, uploaded documents, the audit trail,
backups) in a single folder on disk, so it wants a **server with a real disk**,
not a serverless host. A small DigitalOcean Droplet is the simplest home; any
Ubuntu machine works the same way.

---

## The 10-minute version

### 1. Create a Droplet

On DigitalOcean: **Create → Droplet**.

- **Image:** Ubuntu 24.04 (LTS)
- **Size:** Basic → Regular → **$12/mo** (2 GB RAM) is comfortable for 25 people. The $6 (1 GB) tier also runs it.
- **Authentication:** add your SSH key (or set a password).
- Create it, and note the **public IP address** it gives you.

### 2. Run one command

SSH in and run the setup script:

```bash
ssh root@YOUR_SERVER_IP

curl -fsSL https://raw.githubusercontent.com/iyamwhoiyam/Doss/claude/enova-production-platform-m07q1z/deploy/setup-droplet.sh | sudo bash
```

It installs Docker, pulls the code, builds the app, and starts it. The first
build takes a couple of minutes; when it finishes it prints the address.

### 3. Open it

Go to **http://YOUR_SERVER_IP/** in a browser.

Sign in as **`jbradfield@enovascience.com`** — first-time password
**`enova2026`** — and you'll be asked to set your own. That's the administrator
account; create the rest of the team under **Admin → People**.

That's it. It's live.

---

## Adding a domain and HTTPS (later, optional)

Running on a bare IP over plain HTTP is fine to get going, but for daily use a
real address like `ops.enovascience.com` with the padlock is nicer — and it's
two small steps.

1. **Point DNS at the server.** In whoever hosts `enovascience.com`'s DNS, add
   an **A record**: `ops` → `YOUR_SERVER_IP`.
2. **Tell the app its domain.** On the server:

   ```bash
   cd /opt/enova-ops
   nano .env
   ```

   Set:

   ```
   SITE_ADDRESS=ops.enovascience.com
   ALLOW_INSECURE_COOKIE=0
   ```

   Then:

   ```bash
   docker compose up -d
   ```

Caddy fetches a free Let's Encrypt certificate automatically and serves the app
over HTTPS from then on, renewing it on its own. Nothing else to do.

---

## Running it

Everything runs through Docker Compose from `/opt/enova-ops`.

| Task | Command |
| --- | --- |
| See the logs | `docker compose logs -f app` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` (data is kept) |
| Start again | `docker compose up -d` |
| Update to the latest code | `sudo bash deploy/setup-droplet.sh` |
| Health check | `curl localhost/api/health` |

The server also writes its own rolling backups every six hours (kept for about a
week) inside its data volume, on top of anything you copy off the box.

---

## Backups

All data lives in one Docker volume, `enova-data`. To copy it off the server:

```bash
# a dated tarball of the whole database, uploads and audit trail
docker run --rm -v enova-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/enova-backup-$(date +%F).tgz -C /data .
```

Move that file somewhere safe (another machine, object storage, a drive). To
restore onto a fresh server, reverse it:

```bash
docker run --rm -v enova-data:/data -v "$PWD":/backup busybox \
  tar xzf /backup/enova-backup-YYYY-MM-DD.tgz -C /data
docker compose restart
```

You can also trigger a backup and download an export from inside the app at any
time under **Admin → Database**.

---

## Why not Vercel / Supabase / App Platform?

Those are serverless — their containers have **no persistent local disk**, so
the file-system database this app is built around would be wiped on every
redeploy. Running there would mean rewriting the storage layer onto a hosted
Postgres, which is a different project. A Droplet (or any VM with a disk — Render
and Fly.io with a volume work identically) keeps the app exactly as built.

---

## Troubleshooting

**The page doesn't load.** Give the first build a minute (`docker compose logs -f
app` shows progress). Check the DigitalOcean **firewall / networking** allows
inbound 80 and 443 — the setup script opens them in `ufw`, but a cloud firewall
attached to the Droplet is separate.

**Sign-in doesn't stick on the bare IP.** That needs `ALLOW_INSECURE_COOKIE=1`
in `.env` (the default). Once you move to a domain with HTTPS, set it to `0`.

**HTTPS certificate won't issue.** Let's Encrypt needs the domain's DNS to point
at the server and ports 80 and 443 reachable from the internet. Confirm the A
record resolves (`dig ops.enovascience.com`) and try `docker compose restart
caddy`.
