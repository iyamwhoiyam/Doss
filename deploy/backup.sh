#!/bin/sh
# Dumps the whole database to deploy/backups/, keeping the last 30 dumps.
# Schedule it (see README) — a hub without backups is a time bomb.
set -e
cd "$(dirname "$0")"
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U postgres -d postgres | gzip > "backups/shopare-${STAMP}.sql.gz"
ls -t backups/shopare-*.sql.gz | tail -n +31 | xargs rm -f 2> /dev/null || true
echo "Backup written: backups/shopare-${STAMP}.sql.gz"
