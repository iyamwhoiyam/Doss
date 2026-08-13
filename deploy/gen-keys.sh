#!/bin/sh
# Generates deploy/.env: the stack's secrets (database password, JWT secret)
# and the two API keys (anon + service_role) signed with that secret.
# Run once before the first `docker compose up`. Refuses to overwrite.
set -e
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "deploy/.env already exists — refusing to overwrite it."
  echo "Delete it first if you really want new keys (existing logins keep working;"
  echo "the database password only applies on first boot of a fresh db volume)."
  exit 1
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

sign() {
  h=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '%s' "$1" | b64url)
  s=$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

IAT=$(date +%s)
EXP=$((IAT + 315360000)) # ~10 years

ANON_KEY=$(sign "{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}")
SERVICE_ROLE_KEY=$(sign "{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}")

cat > .env <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by gen-keys.sh — DO NOT COMMIT.
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
# Where browsers reach the hub. Fine as-is for the Mac mini itself;
# create-user.sh uses it too.
SITE_URL=http://localhost:8080
WEB_PORT=8080
EOF

chmod 600 .env
echo "Wrote deploy/.env"
echo "Next: docker compose up -d --build"
