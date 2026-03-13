# SpotiCheck Analytics - Changelog

### 2026-03-13 15:35 - rule_bootstrap_multi_agent
- Added: Root/subfolder `AGENTS.md` files and missing `docs/CHANGELOG.md`.
- Changed: Standardized build/test/lint commands, boundaries, debug workflow, regression checklist.
- Fixed: Missing governance baseline for project-level tasks.
- Affected files: `AGENTS.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`, `docs/CHANGELOG.md`, `docs/WORKLOG.md`.
- Impact/Risk: Low risk, documentation/process only.

### 2026-03-13 15:56 - clear_actions_scope
- Added: Backend tests for clear-by-group behavior (`backend/tests/test_clear_items.py`).
- Changed: `DELETE /items` now applies normalized group matching and treats `all/all links` as clear-all scope.
- Fixed: Group clear semantics for context-menu driven flow are now stable for legacy group naming (`ownerId::group`).
- Affected files: `backend/app/api/items.py`, `backend/tests/test_clear_items.py`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`.
- Impact/Risk: Low-medium; query behavior for group clear is broader (case-insensitive/normalized), intended for safer matching.

### 2026-03-13 17:35 - data_integrity_dedupe_naming
- Added: Backend unit tests for naming/dedupe logic (`backend/tests/test_data_integrity.py`).
- Changed: Crawl payload supports `remove_duplicates`; frontend submit flow now sends this flag.
- Fixed: Album title formatting now includes all artists; track naming no longer duplicates artist prefix.
- Affected files: `backend/app/schemas/crawl.py`, `backend/app/api/crawl.py`, `backend/app/services/spotify_client.py`, `backend/app/services/spotify_web_scraper.py`, `backend/app/services/crawler.py`, `frontend/app.js`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`.
- Impact/Risk: Medium; dedupe behavior now reuses existing rows in same user/group scope and removes duplicate DB rows.
