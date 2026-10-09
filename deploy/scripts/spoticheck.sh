#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/runtime_compose.sh"
APP_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  spoticheck status
  spoticheck logs [service]
  spoticheck backup
  spoticheck redeploy
  spoticheck update
  spoticheck migrate-from-url <postgresql_url>
  spoticheck set-admin [--current <current_username>] [--username <new_username>] [--password <new_password>]
EOF
}

command="${1:-}"
shift || true

case "${command}" in
  status)
    cd "${DEPLOY_DIR}"
    "${SPOTICHECK_COMPOSE[@]}" ps
    ;;
  logs)
    cd "${DEPLOY_DIR}"
    if [[ $# -gt 0 ]]; then
      "${SPOTICHECK_COMPOSE[@]}" logs -f "$@"
    else
      "${SPOTICHECK_COMPOSE[@]}" logs -f app
    fi
    ;;
  backup)
    "${SCRIPT_DIR}/backup_postgres.sh"
    ;;
  redeploy)
    "${SCRIPT_DIR}/redeploy.sh"
    ;;
  update)
    "${SCRIPT_DIR}/update_app.sh"
    ;;
  migrate-from-url)
    "${SCRIPT_DIR}/migrate_from_database_url.sh" "$@"
    ;;
  set-admin)
    "${SCRIPT_DIR}/set_admin_credentials.sh" "$@"
    ;;
  *)
    usage
    exit 1
    ;;
esac
