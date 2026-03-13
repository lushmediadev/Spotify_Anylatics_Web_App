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

### 2026-03-13 18:10 - selection_clear_owner_copy_export
- Added: Group context menu actions for `clear-list` and `delete-group`; owner sort UI control wiring; right-click empty-list context menu entrypoint.
- Changed: Group selection supports multi-select/delete/drag and `Ctrl+A` select all groups.
- Fixed: Clipboard submenu options removed from UI; copy now targets selected rows only. Export number formatting uses plain digits; playlist/album multi-export keeps side-by-side columns.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/style.css`, `backend/app/api/items.py`, `backend/app/services/crawler.py`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`.
- Impact/Risk: Medium; interaction model nhom/link context menu thay doi nhe, can smoke test UI thuc te tren data that.

### 2026-03-13 16:02 - finalize_scope_commit_and_test
- Added: Contract smoke tests for frontend UI wiring (`frontend/tests/ui_contract.test.mjs`) and additional backend export-format assertions (`backend/tests/test_export_format.py`).
- Changed: Consolidated final verification pass for scope 1..8 and synced project memory docs.
- Fixed: Final regression gap check before handoff/commit.
- Affected files: `frontend/tests/ui_contract.test.mjs`, `backend/tests/test_export_format.py`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`.
- Impact/Risk: Low; tests are lightweight contract checks, not full E2E browser flows.

### 2026-03-13 16:04 - selection_ui_agent_validation
- Added: Frontend behavior tests in `backend/tests/test_selection_ui.py` with Node VM execution of `frontend/app.js`.
- Changed: Test suite now checks `Ctrl+A` group select-all and multi-group drag block reorder behavior.
- Fixed: Added automated guard for empty-list-area context menu and multi-group delete selection wiring in `frontend/app.js`.
- Affected files: `backend/tests/test_selection_ui.py`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`.
- Impact/Risk: Low; test-only hardening for selection-ui scope.
