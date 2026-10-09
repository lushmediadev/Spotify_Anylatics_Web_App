#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/runtime_compose.sh"
cd "${DEPLOY_DIR}"

"${SPOTICHECK_COMPOSE[@]}" up -d --build
"${SPOTICHECK_COMPOSE[@]}" ps
