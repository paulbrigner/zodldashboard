#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/db/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not found in PATH" >&2
  exit 1
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL_CMD=(psql "$DATABASE_URL")
else
  : "${PGHOST:?PGHOST or DATABASE_URL must be set}"
  : "${PGPORT:=5432}"
  : "${PGDATABASE:?PGDATABASE or DATABASE_URL must be set}"
  : "${PGUSER:?PGUSER or DATABASE_URL must be set}"

  PSQL_CMD=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE")
fi

shopt -s nullglob
MIGRATIONS=("$MIGRATIONS_DIR"/*.sql)

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "No migration files found in $MIGRATIONS_DIR" >&2
  exit 1
fi

for migration in "${MIGRATIONS[@]}"; do
  echo "Applying $(basename "$migration")"
  "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -f "$migration"
done

echo "All migrations applied."
