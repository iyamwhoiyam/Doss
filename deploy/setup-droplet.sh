#!/usr/bin/env bash
#
# Stand up Enova Ops on a fresh Ubuntu server (a DigitalOcean Droplet, or any
# Ubuntu 22.04/24.04 box) in one command. Safe to run again to update — it pulls
# the latest code and rebuilds without touching the data.
#
#   curl -fsSL <raw-url>/deploy/setup-droplet.sh | sudo bash
#
# or, from a checkout:  sudo bash deploy/setup-droplet.sh
#
# Override any of these with environment variables:
#   REPO_URL   git remote to deploy from
#   BRANCH     branch to deploy
#   APP_DIR    where to put the checkout   (default /opt/enova-ops)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/iyamwhoiyam/Doss.git}"
BRANCH="${BRANCH:-claude/enova-production-platform-m07q1z}"
APP_DIR="${APP_DIR:-/opt/enova-ops}"

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (prefix with sudo)." >&2
  exit 1
fi

# 1. Docker (with the compose plugin) --------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already installed"
fi

# 2. The code --------------------------------------------------------------
if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning $REPO_URL ($BRANCH) into $APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  say "Updating existing checkout in $APP_DIR"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi

cd "$APP_DIR"

# 3. Config (only created the first time, so your edits are kept) -----------
if [ ! -f .env ]; then
  say "Writing a default .env (bare-IP HTTP; edit later to add a domain)"
  cp .env.example .env
fi

# 4. Firewall — let web traffic in if ufw is managing it -------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Opening ports 80 and 443 in the firewall"
  ufw allow 80/tcp  >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
fi

# 5. Swap — a small Droplet does not have the RAM to build the client bundle
#    on its own, and without swap the build silently thrashes instead of
#    finishing. Add a 2 GB swap file once, on low-memory machines.
TOTAL_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [ "${TOTAL_MB:-0}" -lt 2500 ] && ! swapon --show | grep -q .; then
  say "Adding a 2 GB swap file (server has ${TOTAL_MB} MB RAM)"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 6. Build and launch ------------------------------------------------------
say "Building and starting Enova Ops"
docker compose up -d --build

IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
say "Done. Enova Ops is starting up."
cat <<EOF

  Open   http://${IP}/
  Sign in as jbradfield@enovascience.com  (first-time password: enova2026)

  Watch it come up:   cd ${APP_DIR} && docker compose logs -f app
  Update later:       sudo bash ${APP_DIR}/deploy/setup-droplet.sh
  Add a domain/HTTPS: edit ${APP_DIR}/.env  (see DEPLOY.md)

EOF
