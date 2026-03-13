# Backend Rules (Overrides Root)

## Scope

Applies only to `backend/`.

## Differences from root

- Use project venv Python for all commands: `venv\Scripts\python.exe`.
- Keep business logic in `app/services/*`; routers in `app/api/*` should remain thin.
- Preserve async DB/session patterns from `app/database.py` and existing dependency injection.
- For naming/normalization changes (track/album/export), add/update service-level tests first where possible.
- If tests are absent, add targeted `pytest` tests under `backend/tests/` with minimal fixtures.
