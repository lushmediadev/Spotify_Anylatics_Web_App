# SpotiCheck Root Rules

## Scope

This file defines repository-wide rules. Subfolder `AGENTS.md` files may override for their scope.

## Build/Test/Lint

- Backend run: `cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8010`
- Backend tests: `cd backend && venv\Scripts\python.exe -m pytest`
- Backend lint (if installed): `cd backend && venv\Scripts\python.exe -m ruff check app`
- Frontend serve static: `cd frontend && python -m http.server 8080`
- Full app smoke check: open `http://localhost:8010` and verify login, link list, group actions, export/copy actions.

## Coding Conventions

- Keep API contract stable (`/api/*` payload shapes and status codes).
- Prefer minimal diffs; avoid broad refactors for feature tickets.
- Keep frontend as vanilla JS + existing patterns in `frontend/app.js`.
- Keep backend typing and async patterns consistent with existing FastAPI/SQLAlchemy code.
- Add focused tests for behavior changes.

## Module Boundaries

- `frontend/*` must not import backend internals; only communicate through HTTP API.
- `backend/app/api/*` handles HTTP layer only.
- `backend/app/services/*` handles business logic/integrations.
- `backend/app/models/*` and `backend/app/database.py` handle persistence concerns.
- Avoid cross-layer shortcuts (e.g., API router performing crawler internals directly).

## Debug Workflow

1. Reproduce on local app (`http://localhost:8010`).
2. Check backend logs and browser console/network.
3. Confirm request payload + response shape.
4. Patch with minimal blast radius.
5. Re-run relevant tests and a manual smoke checklist.

## Regression Checklist

- Auth login still works.
- Add link (single + batch) still works.
- Group select/rename/delete/drag still works.
- Copy and export output formats stay valid.
- Item list rendering and metric sorting still works.

## Refactor Safety Rules

- Do not change API/JSON contract without explicit migration plan.
- Do not rename DB columns/tables without migration.
- For UX changes, preserve existing interactions unless ticket explicitly changes them.
