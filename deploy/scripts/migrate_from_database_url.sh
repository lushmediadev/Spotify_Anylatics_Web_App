#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/runtime_compose.sh"
cd "${DEPLOY_DIR}"
APP_STOPPED=0

cleanup() {
  if [[ "${APP_STOPPED}" == "1" ]]; then
    "${SPOTICHECK_COMPOSE[@]}" up -d app >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

if [[ ! -f .env ]]; then
  echo "Missing ${DEPLOY_DIR}/.env" >&2
  exit 1
fi

SOURCE_DATABASE_URL="${1:-${SOURCE_DATABASE_URL:-}}"
if [[ -z "${SOURCE_DATABASE_URL}" ]]; then
  echo "Usage: SOURCE_DATABASE_URL=postgresql://... $(basename "$0")" >&2
  echo "Or: $(basename "$0") postgresql://..." >&2
  exit 1
fi

set -a
source .env
set +a

IMPORT_ROOT="${IMPORT_ROOT:-/opt/spoticheck/backups/imports}"
SOURCE_PG_CLIENT_IMAGE="${SOURCE_PG_CLIENT_IMAGE:-postgres:17-alpine}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DUMP_FILE="${IMPORT_ROOT}/source-import-${TIMESTAMP}.sql.gz"

mkdir -p "${IMPORT_ROOT}"

"${SCRIPT_DIR}/backup_postgres.sh"

echo "Dumping source database to ${DUMP_FILE}"
docker run --rm \
  -e SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL}" \
  "${SOURCE_PG_CLIENT_IMAGE}" \
  sh -lc 'pg_dump "$SOURCE_DATABASE_URL" --clean --if-exists --no-owner --no-acl' \
  | gzip -9 > "${DUMP_FILE}"

echo "Restoring dump into local VPS PostgreSQL"
"${SPOTICHECK_COMPOSE[@]}" stop app
APP_STOPPED=1
gzip -dc "${DUMP_FILE}" \
  | sed '/^SET transaction_timeout = 0;$/d' \
  | "${SPOTICHECK_COMPOSE[@]}" exec -T db \
      psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"
"${SPOTICHECK_COMPOSE[@]}" up -d app
APP_STOPPED=0

echo "Migration completed from source URL into ${POSTGRES_DB}"
