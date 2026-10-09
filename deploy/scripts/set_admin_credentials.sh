#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/runtime_compose.sh"

usage() {
  cat <<'EOF'
Usage:
  spoticheck set-admin [--current <current_admin>] [--username <new_username>] [--password <new_password>]

Notes:
  - At least one of --username or --password is required.
  - If --current is omitted, the script auto-selects the only admin user.
  - If --password is omitted, the script prompts securely.
EOF
}

current_username=""
new_username=""
new_password=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --current)
      [[ $# -ge 2 ]] || { echo "Missing value for --current" >&2; exit 1; }
      current_username="$2"
      shift 2
      ;;
    --username)
      [[ $# -ge 2 ]] || { echo "Missing value for --username" >&2; exit 1; }
      new_username="$2"
      shift 2
      ;;
    --password)
      [[ $# -ge 2 ]] || { echo "Missing value for --password" >&2; exit 1; }
      new_password="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${new_username}" && -z "${new_password}" ]]; then
  echo "At least one of --username or --password is required." >&2
  usage >&2
  exit 1
fi

if [[ -z "${new_password}" ]]; then
  read -r -s -p "New admin password: " new_password
  echo
fi

if [[ ${#new_password} -lt 4 ]]; then
  echo "Password must be at least 4 characters." >&2
  exit 1
fi

cd "${DEPLOY_DIR}"

"${SPOTICHECK_COMPOSE[@]}" exec -T app \
  env CURRENT_USERNAME="${current_username}" NEW_USERNAME="${new_username}" NEW_PASSWORD="${new_password}" \
  python - <<'PY'
import asyncio
import json
import os
import sys

from sqlalchemy import select

from app.database import async_session
from app.models.user import User
from app.services.auth import hash_password

INTERNAL_EMAIL_DOMAIN = "users.spoticheck.local"


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


async def main() -> None:
    current_username = (os.environ.get("CURRENT_USERNAME") or "").strip()
    new_username = (os.environ.get("NEW_USERNAME") or "").strip()
    new_password = os.environ["NEW_PASSWORD"]

    async with async_session() as session:
        if current_username:
            result = await session.execute(select(User).where(User.username == current_username))
            admin = result.scalar_one_or_none()
            if admin is None:
                fail(f"Admin user '{current_username}' was not found.")
            if admin.role != "admin":
                fail(f"User '{current_username}' exists but is not an admin.")
        else:
            result = await session.execute(select(User).where(User.role == "admin").order_by(User.created_at))
            admins = list(result.scalars())
            if not admins:
                fail("No admin user found in the database.")
            if len(admins) > 1:
                fail(
                    "Multiple admin users found. Re-run with --current. Available admins: "
                    + ", ".join(user.username for user in admins),
                    code=2,
                )
            admin = admins[0]

        original_username = admin.username
        changed = {
            "current_username": original_username,
            "updated_username": original_username,
            "password_updated": True,
        }

        if new_username and new_username != admin.username:
            existing = await session.execute(
                select(User).where(User.username == new_username, User.id != admin.id)
            )
            if existing.scalar_one_or_none() is not None:
                fail(f"Username '{new_username}' is already in use.")

            email = (admin.email or "").strip().lower()
            if not email or email.endswith("@" + INTERNAL_EMAIL_DOMAIN):
                admin.email = f"{new_username.lower()}@{INTERNAL_EMAIL_DOMAIN}"
            admin.username = new_username
            changed["updated_username"] = new_username

        admin.password_hash = hash_password(new_password)
        await session.commit()
        print(json.dumps(changed, ensure_ascii=True))


asyncio.run(main())
PY
