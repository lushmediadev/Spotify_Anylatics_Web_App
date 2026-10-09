# SpotiCheck Root Rules

## Build / Test / Run

- Backend dev server: `cd backend && .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010`
- Backend tests: `cd backend && .\venv\Scripts\python.exe -m pytest -q`
- Frontend syntax check: `node --check D:\Spotify_AnylaticsWeb_App\frontend\app.js`
- Frontend contract tests: `node --test D:\Spotify_AnylaticsWeb_App\frontend\tests\ui_contract.test.mjs`
- Docker build reference: `docker build -t spoticheck D:\Spotify_AnylaticsWeb_App`
- VPS stack build/run (current Nginx host): `cd D:\Spotify_AnylaticsWeb_App\deploy && docker compose -f docker-compose.nginx.yml --env-file .env up -d --build`
- VPS helper install: `sudo /opt/spoticheck/app/deploy/scripts/install_helpers.sh`
- VPS helper usage: `spoticheck status|logs|backup|redeploy|update|migrate-from-url|set-admin`
- Mail stack build/run: `cd D:\Spotify_AnylaticsWeb_App\deploy\mail && docker compose --env-file .env up -d`
- Mail helper usage: `mailops status|logs|up|restart|dns-records|add-account|update-account|delete-account|add-alias|delete-alias|list-accounts|list-aliases|dkim-generate|dkim-show|use-caddy-cert`

## Coding Conventions

- Keep diffs minimal and preserve the deployed UI unless the task explicitly changes behavior.
- Use vanilla JS patterns already present in `frontend/app.js`; avoid introducing frameworks or build steps.
- Keep backend responses backward compatible with the existing frontend contract.
- Prefer helper functions over duplicating title/export formatting logic across UI and API layers.
- Use plain digit strings for spreadsheet/export values unless the existing contract requires formatted text.

## Module Boundaries

- `frontend/` may call backend APIs but must not depend on backend Python internals.
- `backend/app/api/` coordinates HTTP contracts and export formatting.
- `backend/app/services/` owns Spotify/network/data-fetch logic.
- `backend/app/models/` and `backend/app/schemas/` define persistence and typed payload structures.
- `deploy/` owns VPS/runtime orchestration only; it must not change API contracts or frontend behavior.
- `deploy/mail/` owns the self-hosted mail stack only; it must not reuse `80/443` directly because the shared Caddy stack already owns those ports.
- `final3.html` is design reference only; do not use it as a runtime source of truth.

## Debug Workflow

- Reproduce on `http://127.0.0.1:8010` first, then compare with deployed web behavior if the task is UI-sensitive.
- For title/export issues, verify both backend export helpers and frontend display helpers.
- After JS changes, bump cache query params in `frontend/index.html` when local browsers may hold stale assets.
- Before signoff, run backend tests, frontend contract checks, and a browser smoke check for the changed flow.

## Regression Checklist

- List rows still render with the original layout and controls.
- Copy/export titles match UI display titles for track and album items.
- Spreadsheet rows keep the expected column layout for the deployed branch.
- Local app still serves from FastAPI without adding a frontend build step.
- VPS deploy config still routes `GET /api/health` through the public domain to the same FastAPI app.
- Mail DNS and TLS changes must preserve the existing web routes while keeping mail records `DNS only` in Cloudflare.

## Refactor Safety

- Do not change API routes, payload keys, or export column contracts without a migration plan.
- Do not replace the deployed Shine UI structure with the older local variant.
- Do not remove fallback handling for partially populated Spotify/raw payloads.
