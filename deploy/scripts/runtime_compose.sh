#!/usr/bin/env bash
# Source after DEPLOY_DIR is set. The untracked selector keeps legacy hosts intact.
SPOTICHECK_COMPOSE_FILE="docker-compose.vps.yml"
if [[ -f "${DEPLOY_DIR}/.compose-file" ]]; then
  IFS= read -r SPOTICHECK_COMPOSE_FILE < "${DEPLOY_DIR}/.compose-file"
fi
case "${SPOTICHECK_COMPOSE_FILE}" in
  docker-compose.vps.yml|docker-compose.nginx.yml) ;;
  *) echo "Unsupported SpotiCheck Compose file" >&2; exit 1 ;;
esac
SPOTICHECK_COMPOSE=(docker compose -f "${SPOTICHECK_COMPOSE_FILE}" --env-file .env)
