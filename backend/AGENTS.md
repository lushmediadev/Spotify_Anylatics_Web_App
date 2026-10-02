# Backend Delta Rules

- Keep FastAPI route contracts stable; frontend expects current JSON shapes and export response formats.
- Put Spotify parsing/fetch logic in `app/services`, not in route handlers.
- When fixing export formatting, cover both direct item fields and `raw_map` fallback data.
- Prefer focused pytest coverage in `backend/tests/` for each formatting regression.
- For resource access, reuse ownership predicates from `app/services/auth.py`; role/assignment policy is in `docs/modules/access-control.md`.
