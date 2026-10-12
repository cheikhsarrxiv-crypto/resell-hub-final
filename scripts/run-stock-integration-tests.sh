#!/usr/bin/env bash
#
# Launches an isolated, throwaway local PostgreSQL container, points
# DATABASE_URL/DIRECT_URL at it, applies the schema, runs the real-DB
# stock-reservation integration suite, and tears the container down —
# touching ONLY the exact container this script itself creates.
#
# Safety properties (see ADKSY stock-integration-test guard review):
#   - Refuses to run at all if a container named $CONTAINER_NAME already
#     exists, rather than reusing, renaming, or removing it.
#   - Captures the exact container ID docker run returns, and only ever
#     removes that ID — never "the container named X" at cleanup time,
#     which could by then be a different container if something raced.
#   - Cleans up on both success and failure (trap on EXIT), but only
#     ever the container this invocation created.
#   - Never touches StockService.ts, the Prisma migration, or any
#     non-local database — DATABASE_URL/DIRECT_URL are set to the local
#     container's own URL, overriding (for this script's process only)
#     anything already exported in the calling shell.
#
# This script has NOT been executed as part of preparing it. Run it
# yourself, after separately authorizing Docker/database access.

set -euo pipefail

CONTAINER_NAME="adksy-stock-test"
IMAGE="postgres:15-alpine"
HOST_PORT="5433"
DB_NAME="stock_test"
DB_USER="test"
DB_PASSWORD="test"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "A container named '$CONTAINER_NAME' already exists — refusing to touch it." >&2
  echo "Inspect it yourself (docker ps -a --filter name=$CONTAINER_NAME), remove or rename it, then re-run this script." >&2
  exit 1
fi

echo "Starting isolated local PostgreSQL container ($CONTAINER_NAME)..."
CONTAINER_ID="$(docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "${HOST_PORT}:5432" \
  "$IMAGE")"

cleanup() {
  local exit_code=$?
  echo "Cleaning up container ${CONTAINER_ID} (exit code was ${exit_code})..."
  # Only ever remove the exact container ID this invocation created above
  # — never the name alone, which could in principle refer to a
  # different container by the time cleanup runs.
  docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

echo "Waiting for PostgreSQL to accept connections..."
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_ID" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${HOST_PORT}/${DB_NAME}"
export DIRECT_URL="$DATABASE_URL"

echo "Applying schema (prisma db push) to the local test container only..."
npx prisma db push

echo "Running the PostgreSQL stock-reservation integration suite..."
npm run test:integration:postgres
