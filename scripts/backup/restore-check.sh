#!/usr/bin/env bash
# Restores an encrypted backup into a throwaway Postgres 17 and checks it (Blueprint 4: "a restore
# test each quarter"): the restore must succeed with no errors, every migration must be there, and
# the nightly invariant check must find nothing. Prints each table's row count.
#
#   BACKUP_PASSPHRASE=… scripts/backup/restore-check.sh fairshare.dump.gpg
#
# Needs Docker, gpg, and the repo's dependencies installed (pnpm install), for the invariant check.
set -euo pipefail

file=${1:?usage: restore-check.sh <backup file>}
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
PG_IMAGE=${PG_IMAGE:-postgres:17-alpine}
PORT=${RESTORE_PORT:-5544}
NAME="fairshare-restore-check-$$"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=fairshare \
  "$PG_IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U restore -d fairshare -q && break
  sleep 1
done
# The image's init restarts the server once; wait until it answers queries for real.
for _ in $(seq 1 30); do
  docker exec "$NAME" psql -U restore -d fairshare -qAtc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done

psql() { docker exec -i "$NAME" psql -U restore -d fairshare -v ON_ERROR_STOP=1 -qAt "$@"; }

# Roles are cluster-wide, so a dump doesn't carry them; its GRANTs need them (migration 0003).
psql -c 'CREATE ROLE fairshare_app NOLOGIN' -c 'CREATE ROLE fairshare_readonly NOLOGIN'

echo "Restoring $file …"
gpg --batch --quiet --decrypt --passphrase-fd 3 "$file" 3<<<"$BACKUP_PASSPHRASE" |
  docker exec -i "$NAME" pg_restore -U restore -d fairshare --no-owner --exit-on-error

expected=$(find "$ROOT/packages/db/migrations" -maxdepth 1 -name '*.sql' | wc -l)
applied=$(psql -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')
if [ "$applied" != "$expected" ]; then
  echo "::error::The backup has $applied migrations; this code has $expected." >&2
  exit 1
fi
echo "Migrations: $applied of $expected."

# The data's guards came back too: the ledger checks (I1–I3, I9) and the append-only log (I11).
expected_triggers=$(grep -ohE 'CREATE (CONSTRAINT )?TRIGGER [a-z_]+' "$ROOT"/packages/db/migrations/*.sql |
  awk '{print $NF}' | LC_ALL=C sort | tr '\n' ' ')
restored_triggers=$(psql -c "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname COLLATE \"C\"" |
  tr '\n' ' ')
if [ "$restored_triggers" != "$expected_triggers" ]; then
  echo "::error::Triggers restored: $restored_triggers; expected: $expected_triggers" >&2
  exit 1
fi
echo "Triggers: $restored_triggers"

echo "Rows per table:"
psql -F $'\t' -c "
  SELECT table_name,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name" | column -t

DATABASE_URL="postgres://restore:restore@127.0.0.1:$PORT/fairshare" \
  pnpm --dir "$ROOT" --silent --filter @fairshare/db exec tsx src/scripts/check-invariants.ts
echo "Restore check passed."
