#!/bin/bash
# First-boot init (docker-entrypoint-initdb.d): make sure the service roles
# GoTrue and PostgREST connect as share the stack password. The supabase/
# postgres image already creates these roles; we just align credentials.
# Runs before zz-02-shopare.sql (alphabetical order).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  alter role authenticator with password '${POSTGRES_PASSWORD}';
  alter role supabase_auth_admin with password '${POSTGRES_PASSWORD}';
EOSQL
