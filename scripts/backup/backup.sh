#!/usr/bin/env bash
# Dumps the database and encrypts the dump (Blueprint 4 "Backups": a nightly pg_dump to storage).
#
#   DATABASE_URL=… BACKUP_PASSPHRASE=… scripts/backup/backup.sh fairshare.dump.gpg
#
# DATABASE_URL: a role that can read everything, sequences and Drizzle's migration table included
# (the database's own user; fairshare_readonly isn't enough for pg_dump). pg_dump runs in a
# Postgres 17 container, so its version matches the server's whatever this machine has. The dump
# is in custom format (compressed), encrypted with AES-256 under BACKUP_PASSPHRASE: the storage
# never sees anything readable. Keep the passphrase somewhere other than the storage, or the
# backups can't be restored.
set -euo pipefail

out=${1:?usage: backup.sh <output file>}
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
PG_IMAGE=${PG_IMAGE:-postgres:17-alpine}

# A half-written file must never look like a backup.
trap 'rm -f "$out.partial"' EXIT

docker run --rm --network host -e DATABASE_URL "$PG_IMAGE" \
  sh -c 'pg_dump --format=custom --compress=9 --no-owner "$DATABASE_URL"' |
  gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
    --passphrase-fd 3 --output "$out.partial" 3<<<"$BACKUP_PASSPHRASE"

mv "$out.partial" "$out"
echo "Backup written: $out ($(du -h "$out" | cut -f1))"
