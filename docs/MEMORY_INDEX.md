# SpotiCheck Memory Index

Read this after `AGENTS.md` and `docs/PROJECT_BRIEF.md`.

## Routing

- UI, filters, row rendering, group rail, drag/drop: read `docs/UI_SYSTEM.md`, then inspect `frontend/app.js` around the relevant functions.
- API contracts, item list performance, exports: inspect `backend/app/api/` and `backend/app/database.py`.
- Runtime and VPS deploy: inspect `deploy/docker-compose.vps.yml`, `deploy/Caddyfile`, and helper scripts before changing deploy behavior.
- Architecture decisions: read `docs/DECISIONS_INDEX.md` first, then `docs/DECISIONS.md` only if detail is needed.
- Roles, manager assignment, and resource permissions: read `docs/modules/access-control.md` and `backend/app/services/auth.py`.
- Historical context: use `docs/PROJECT_CONTEXT.md`, `docs/WORKLOG.md`, and `docs/CHANGELOG.md` only when the current task needs older background.

## Current High-Value Context

- Large accounts can have hundreds of Spotify links; frontend must avoid rendering all expensive UI work in one blocking frame.
- Admin user filtering must reset list/group scope immediately and ignore stale in-flight responses from the previous user.
- The backend item list endpoint should keep latest metrics queries set-based and indexed rather than doing per-item lookups.
