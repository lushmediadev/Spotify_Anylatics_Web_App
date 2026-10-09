#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/runtime_compose.sh"
cd "${DEPLOY_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing ${DEPLOY_DIR}/.env" >&2
  exit 1
fi

set -a
source .env
set +a

BACKUP_ROOT="${BACKUP_ROOT:-/opt/spoticheck/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP_FILE="${BACKUP_ROOT}/${POSTGRES_DB}_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_ROOT}"

"${SPOTICHECK_COMPOSE[@]}" exec -T db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists --no-owner --no-acl \
  | gzip -9 > "${BACKUP_FILE}"

find "${BACKUP_ROOT}" -type f -name '*.sql.gz' -mtime +"${RETENTION_DAYS}" -delete

echo "Backup created: ${BACKUP_FILE}"
