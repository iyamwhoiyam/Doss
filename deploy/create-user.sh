#!/bin/sh
# Creates a login for the app (signup is disabled — accounts are admin-created).
# Usage: ./create-user.sh someone@company.com 'their-password'
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "deploy/.env not found — run ./gen-keys.sh and start the stack first." >&2
  exit 1
fi
. ./.env

EMAIL="$1"
PASSWORD="$2"
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Usage: $0 email password" >&2
  exit 1
fi

curl -fsS -X POST "${SITE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"email_confirm\":true}" \
  > /dev/null

echo "Created user ${EMAIL} — they can sign in at ${SITE_URL}"
