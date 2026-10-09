# SpotiCheck Memory Index

Read this after `AGENTS.md` and `docs/PROJECT_BRIEF.md`.

## Routing

- UI, filters, row rendering, group rail, drag/drop: read `docs/UI_SYSTEM.md`, then inspect `frontend/app.js` around the relevant functions.
- API contracts, item list performance, exports: inspect `backend/app/api/` and `backend/app/database.py`.
- Runtime and VPS deploy: new Nginx host uses `deploy/docker-compose.nginx.yml`, `deploy/nginx/ytm.lushmedia.net.conf`, untracked `.compose-file` selector and helper scripts; read `deploy/README.md`. `docker-compose.vps.yml`/`Caddyfile` are legacy/shared-host reference only.
- Architecture decisions: read `docs/DECISIONS_INDEX.md` first, then `docs/DECISIONS.md` only if detail is needed.
- Roles, manager assignment, and resource permissions: read `docs/modules/access-control.md` and `backend/app/services/auth.py`.
- YouTube API keys, channel crawl, and channel-playlist associations: read `docs/modules/youtube-channel-playlist.md`.
- Historical context: use `docs/PROJECT_CONTEXT.md`, `docs/WORKLOG.md`, and `docs/CHANGELOG.md` only when the current task needs older background.

## Current High-Value Context

- Large accounts can have hundreds of Spotify links; frontend must avoid rendering all expensive UI work in one blocking frame.
- Every data view uses the signed-in account only, including admin/manager. User management permissions remain separate; ignore stale responses from an earlier login.
- The backend item list endpoint should keep latest metrics queries set-based and indexed rather than doing per-item lookups.
