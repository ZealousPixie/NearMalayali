#!/usr/bin/env bash
# Runs the database test-suite against a throwaway database on a plain
# Postgres + PostGIS + pgTAP server.
#
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./scripts/db-test.sh
#
# Steps: create a fresh database, apply the Supabase shim, apply every
# migration in order, apply the test helpers, then run each pgTAP file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB:-nearmalayali_test}"
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}"

psql -q -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"

run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }

run "$ROOT/supabase/tests/shim/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  run "$f"
done
run "$ROOT/supabase/tests/shim/test_helpers.sql"

pg_prove -d "$DB" --ext .sql -r "$ROOT/supabase/tests/database"
