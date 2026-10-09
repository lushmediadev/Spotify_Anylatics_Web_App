# Changelog

### 2026-10-09 - Logo cho tài khoản chỉ dùng Youtube
- Tài khoản có duy nhất workspace Youtube giữ logo YTM trên mọi trang, gồm Settings/Profile/Users; refresh quyền cũng cập nhật branding. Dùng effective grants nên user kế thừa áp dụng cùng manager.
- Tăng app.js cache version; logo trên tài khoản nhiều workspace tiếp tục theo tab đang mở.
- Xác minh: 561 backend + 80 frontend/browser tests passed; browser Settings/Users/Profile giữ logo Youtube. Rollout app-only `68a5d3a`, public assets cập nhật và health OK; Caddy/ID các container khác giữ nguyên, có rollback image `spoticheck-rollback:pre-youtube-brand-68a5d3a`.
### 2026-10-09 - Workspace cho manager và user kế thừa
- Admin tích chọn Youtube, Spotify, Youtube-Spotify khi tạo/sửa manager; user dưới quyền kế thừa live grants, manager không chọn hoặc sửa workspace cho user. Sidebar/default landing và API enforce cùng quyền; refresh/đổi view khi thu hồi.
- Migration thêm nullable JSON workspace_access, API thêm workspaces array; legacy manager giữ Youtube, admin/standalone user giữ đủ ba; không đổi dữ liệu/ownership hoặc standalone YTM.
- Kiểm thử: grant combinations, create/edit/prefill, inheritance/reassign/revocation, chống privilege tampering và foreign data access; 561 backend tests passed, UI local chọn hai workspace và edit prefill đúng.
- Hoàn tất: 80 frontend/browser tests pass; PostgreSQL copy preflight đạt 14 manager/user combinations, migration idempotent và inheritance với cùng token. Rollout app-only `9039535`, production scope/public health OK; 3 users, 626 items, 4043 snapshots giữ nguyên count/hash ID. Backup `/opt/spoticheck/backups/workspaces-9039535/spoticheck.sql.gz`; Caddy và container khác giữ nguyên.
### 2026-10-05 - Manager quản lý user dưới quyền
- Mở Users cho manager; tạo user tự gắn manager_id, admin thấy cùng tài khoản trong danh sách toàn bộ. Admin reset-password mọi tài khoản; manager chỉ sửa/reset-password/activate/delete assigned users, không nâng role hoặc reassign.
- Khóa/refresh target row khi quản lý để chặn quyền stale sau admin reassign; dữ liệu workspace vẫn own-account-only. Không đổi route/payload/schema; tăng app.js cache version và cập nhật hướng dẫn tạo tài khoản.
- Kiểm thử HTTP tạo/sửa/reset/reassign và phủ nhận foreign targets, stale cached scope, privacy của account response; browser local manager xác nhận Users, phạm vi danh sách và User-only create form.
- Xác minh: 531 backend + 71 frontend/browser tests passed; PostgreSQL disposable preflight đạt create/admin visibility/password-reset login/foreign denial/concurrent reassign lock. Rollout app-only commit `03d3dc7`; production manager/admin read-only scope checks và public health OK, account/item counts giữ nguyên. Backup `/opt/spoticheck/backups/manager-users-03d3dc7/spoticheck.sql.gz`; Caddy và container khác giữ nguyên.

### 2026-10-05 - Nhãn và logo sidebar theo workspace
- Bỏ banner Admin Mode khỏi group rail dùng chung; quyền tài khoản và quản lý Users giữ nguyên.
- Tab YouTube Link Checker dùng đúng SVG logo sidebar của YTM; chuyển sang mọi tab khác khôi phục logo SpotiCheck. Tăng cache version của `app.js`.
- Xác minh: JavaScript syntax, frontend contract/browser checks và backend tests; rollout app-only, kiểm tra browser chuyển tab và public health.

### 2026-10-05 - Rollout SpotiCheck lên VPS
- Đã triển khai commit `a629384` bằng `docker compose -f docker-compose.vps.yml --env-file .env up -d --no-deps --no-build app`; image chạy mới khớp source, container `healthy`, public/origin `/api/health` đều OK.
- Backup mới: `/opt/spoticheck/backups/rollout-20261005-065454/spoticheck.sql.gz`, gzip đã kiểm tra; giữ image rollback cũ. 624 Spotify items và 4041 snapshots giữ nguyên số lượng/hash ID; migration tạo 3 playlist độc lập, 4 associations hợp lệ, YTM tích hợp rỗng.
- Xác minh: 527 backend và 71 frontend/browser tests passed; runtime GET cho admin/manager đúng 200/403; browser login đúng SpotiCheck, không có console error. Caddyfile/hash và ID các container khác giữ nguyên; standalone YTM health OK.
- Task trước đã hoàn tất; nguyên nhân cụ thể của lần chặn execution layer trước đó chưa có bằng chứng, lệnh rollout lần này thực thi thành công.

### 2026-10-05 - Independent YouTube workspaces
- Changed: URL-only playlist editor, no checker picker/unlink menu; collapsed channels show a Playlist count column. Playlist records and snapshots are cloned into an independent scope while preserving original checker data.
- Added: separate YouTube Link Checker using original YTM visual/metrics, shared login/own API keys, own ytm_* groups/history/preferences and double-click group rename. No old YTM data imported; standalone site untouched.
- Permissions: manager is limited to YTM and own shared key/profile settings; Spotify, combined channels and account-management APIs deny manager access.
- Safety: scoped list/export/delete queries, global raw-cache reference checks and exact crawl-row resolution prevent cross-workspace side effects. Added idempotent migration and disposable PostgreSQL preflight script.
- Verification: 527 backend and 71 frontend/browser tests passed; local smoke verified original YTM visual, group double-click, paste-only edit, collapsed counts and manager-only navigation. PostgreSQL copy preflight passed: 624 checker rows preserved and 3 legacy playlists migrated. Production deployment remains pending after the execution layer blocked the restart command.

### 2026-10-05 - Independent GitHub repository
- Migrated: `lushmediadev/Spotify_Anylatics_Web_App` recreated as an independent public repository with the same name, full committed history and local branches; old fork removed after read-back/ref verification.
- Local origin now targets lushmediadev; previous source remains available as shinemusic. No application code, runtime data or VPS deployment changed.
- Backup: `D:\GitHub_Migration_Backups\lushmediadev-20261005` contains original fork mirrors, local bundles and verified replacement mirrors.

### 2026-10-03 - Complete playlist picker groups
- Fixed: group filter merges own custom groups, all-type item summary groups and playlist groups; empty groups and track/album-only groups no longer disappear.
- Changed: single-channel context menu puts Edit playlists before Add Channel. Existing visual, ownership and playlist-only selection remain unchanged.
- Verification: 522 backend and 70 frontend/browser tests passed; covers full group options, empty-group filtering, retained hidden selections and edit-first menu order. Local fixture smoke verified.

### 2026-10-03 - Playlist editor visual parity
- Updated: existing picker layout uses shared light surfaces, typography, rounded inputs, monochrome checkboxes, compact cover rows and icon buttons. Styling is scoped to the editor; filtering, selection and save contracts remain unchanged.
- Short-screen fix: scroll only the dialog body so Cancel/Save remain visible.
- Verification: 522 backend and 70 frontend/browser tests passed, including 390px dialog bounds, footer visibility and hidden selection preservation; local fixture visual smoke checked.

### 2026-10-03 - Playlist picker and deletion clarity
- Added: context-menu icons and a separately confirmed delete-link action; unlink remains parent-channel-only, while deleting a Spotify Item removes its tracking and all channel associations.
- Edit picker: filter by Spotify group, search title/owner/ID/link, show cover thumbnails and selected count, retain hidden checked choices across filters.
- Scope: reuse existing own-only Spotify deletion API; no schema or ownership change.
- Verification: 522 backend and 70 frontend/browser tests passed; filter persistence, thumbnail rendering, own-ID deletion, cancelled confirmation and separate unlink behavior covered.

### 2026-10-03 - Channel interaction parity
- Added: persisted per-account group/channel/attached-playlist order and group/channel batch management; compatible additive APIs with strict own-resource validation.
- UI: group and row drag/drop, multi-selection, group rename/delete/clear, channel move, clipboard shortcuts and playlist-specific context actions reuse existing visual patterns.
- Safety: unlink/delete operations preserve original Spotify records; playlist exports reuse existing global clipboard limits and formatters.
- Verification: 522 backend and 67 frontend/browser tests passed; covers real dragTo, multi-selection, filtered hidden rows, sorting/resize, polling races, failed-order rollback, own scope and atomic group/channel operations. Additive preference table leaves existing tracking records untouched.
- Deployment: `899137e` pushed/pulled through GitHub; app-only VPS rebuild healthy and new preference table verified. Authenticated public APIs/assets and real PostgreSQL order/paging/move/rename/Ungrouped/clear/delete tests passed, with fixture writes rolled back. Caddy unchanged. Backup: `/opt/spoticheck/backups/postgres/pre-channel-interactions-20261003-055523.sql.gz`; rollback image: `spoticheck-rollback:pre-channel-interactions`.

### 2026-10-03 - Own-account data only
- Removed: admin/manager account filter and cross-account frontend data targets; group preferences use own-profile routes.
- Changed: resource authorization is own-account-only for admin, manager and user. Role-based account management and admin global settings remain separate.
- Migration: no row reassignment or schema change; API routes/payload fields remain compatible, but cross-account resource access is denied.
- Verification: 480 backend and 53 frontend/browser tests passed; foreign admin/assigned-manager resource targets are denied, account management still works, and private group preferences are redacted from other-account management responses. VPS has no unowned Spotify rows.
- Deployment: `87009e1` pushed/pulled through GitHub; app-only rebuild healthy and Caddy unchanged. Authenticated public API checks and real PostgreSQL admin/manager/user scope checks passed; fixture writes rolled back. Backup: `/opt/spoticheck/backups/postgres/pre-own-account-scope-20261003-043022.sql.gz`; rollback image: `spoticheck-rollback:pre-own-account-scope`.

### 2026-10-03 - Compact combined channel/playlist rows
- Removed: repeated playlist column headers and User / Updated cells in the combined workspace.
- Changed: playlist count sits beside CHANNEL instead of the group subtitle; channel/playlist rows use 76px minimum height with 44px covers and compact column headers.
- Scope: Channel & Playlist presentation only; Spotify list, data ownership, API and association logic unchanged.
- Verification: 50 frontend/browser and 443 backend tests passed; browser measurements confirm 76px channel/playlist rows and no repeated child headers or User / Updated cells.
- Deployment: `ebff7f3` pushed/pulled through GitHub; app-only VPS rebuild healthy and public JS/CSS hashes verified. Caddy unchanged. Backup: `/opt/spoticheck/backups/postgres/pre-compact-channel-ui-20261003-035840.sql.gz`; rollback image: `spoticheck-rollback:pre-compact-channel-ui`.

### 2026-10-03 - Align Channel & Playlist with the original dashboard
- Changed: channel tools move into the shared topbar, group controls stay in the left rail, and the workspace reuses the original hero/KPI/row typography and status/metric components.
- Fixed: Spotify background group synchronization no longer overwrites another view's title; channel hero selects the first filtered channel banner using YouTube Manager logic.
- Removed: row Edit buttons and visible pagination. Edit remains in the right-click/keyboard context menu; API paging remains internal to complete group loading.
- Verification: no backend diff; 443 backend and 50 frontend/browser tests passed. Checked shared shell/hero/row styling, right-click editor, empty groups, more than 50 channels, stale owner responses and 390px mobile layout; header no longer overlaps hero. Avatar/owner/time formatting reuses Spotify helpers.
- Deployment: `2f05a03` pushed to GitHub and pulled on VPS; app-only rebuild healthy. Authenticated channel/Spotify APIs return 200; public JS/CSS hashes match deployed files. Shared Caddy hash unchanged. Backup: `/opt/spoticheck/backups/postgres/pre-channel-ui-parity-20261003-013419.sql.gz`; rollback image: `spoticheck-rollback:pre-channel-ui-parity`.

### 2026-10-02 - YouTube channels and group-only navigation
- Added: owner-scoped YouTube API keys/check/rotation, public channel view snapshots, persisted empty channel groups and shared Spotify playlist associations.
- UI: Channel & Playlist matches existing light visual, shows playlists by default, supports Edit, grouped search/filter and refresh; profile remains accessible from avatar and global clipboard setting is preserved.
- Changed: removed All Links/All Channels entries; both pages select a named group, and Spotify group deletion moves surviving links to Ungrouped.
- Verification: 443 backend and 41 frontend/browser tests passed; desktop/mobile smoke and empty-group creation checked on loopback fixtures. Channel timestamps explicitly use Vietnam time and normalize naive UTC backend values.
- Deployment: `9f12f6f` pushed to GitHub and pulled on VPS; app-only rebuild healthy. Authenticated YouTube/settings/Spotify summary APIs return 200; PostgreSQL group/key isolation/manager associations and rollback checks passed. Caddy hash unchanged. Backup: `/opt/spoticheck/backups/postgres/pre-youtube-integration-20261002-103105.sql.gz`; rollback image: `spoticheck-rollback:pre-youtube-integration`. No old YTM data/key migration; real Google crawl requires an owner-configured key.

### 2026-10-02 16:20 - Restore original Spotify hero cover treatment
- Changed: hero retains the original colored cover/filter and dark gradient, with light heading/subtitle and translucent KPI chips inside the light dashboard.
- Fixed: removed the light-theme white overlay that obscured cover colors; cover selection logic remains unchanged.
- Affected files: frontend/style.css, frontend/index.html, frontend/login.html, docs/UI_SYSTEM.md.
- Impact/Risk: Hero-only visual change; bumped shared stylesheet version for both pages.

### 2026-10-02 16:03 - Light theme and assigned-manager roles
- Added: manager role, admin manager-assignment controls, nullable UUID manager_id migration, scoped account/link/job permissions, and permission integration tests.
- Changed: dashboard, login, settings and dialogs use the YouTube Manager white/grayscale palette while Spotify logo remains green.
- Fixed: manager scope consistently applies to list, export, refresh, grouping, and deletion; frontend refreshes account role on bootstrap.
- Affected files: backend auth/models/schemas/database/API, frontend JS/HTML/CSS, tests, UI_SYSTEM and access-control memory.
- Impact/Risk: Additive migration preserves existing users and links; existing users remain unassigned until admin selects a manager. Local validation: 233 backend and 26 frontend tests passed.
- Deployment: GitHub commit `779ad3d` pulled to VPS, app healthy; PostgreSQL migration and transaction-rollback manager scope checks passed, authenticated `/auth/me`, `/auth/users`, preferences and items return 200. Pre-release backup: `/opt/spoticheck/backups/postgres/pre-light-manager-20261002-1603.sql.gz`. Existing VPS Caddy changes preserved.

### 2026-06-12 11:35 - Smooth link-list loading with scope cache
- Added: frontend scope cache for paged link lists plus lightweight background warming for remaining pages.
- Changed: group/search/sort interactions now try cached rows first and keep the current view responsive while fresh data loads.
- Fixed: repeated skeleton/placeholder flashes when switching between small groups or reusing recently viewed scopes.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Low to medium; frontend-only behavior change. First-time uncached scopes can still show loading, but cached and prefetched scopes render immediately.

### 2026-03-20 10:55 - Bootstrap shared-VPS mail stack
- Added: `deploy/mail/` with `docker-compose.yml`, `.env.example`, `README.md`, `AGENTS.md`, and helper scripts for `mailops`, self-signed bootstrap TLS, and switching to Caddy-issued certificates.
- Changed: root `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, and `docs/WORKLOG.md` now document the new mail stack and the requirement to keep mail DNS records `DNS only`.
- Fixed: prepared a mail deployment path that coexists with the current Caddy-owned `80/443` stack instead of conflicting with the existing web apps.
- Affected files: `AGENTS.md`, `deploy/Caddyfile`, `deploy/mail/**`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; the mail stack is ready to deploy on the VPS, but full mail cutover still depends on `A mail`, `MX`, and `PTR/rDNS` changes outside the repo.

### 2026-03-19 15:21 - Add Spotify admin credential helper
- Added: `deploy/scripts/set_admin_credentials.sh` for rotating persisted admin username/password inside PostgreSQL.
- Changed: `spoticheck` wrapper and deploy docs now expose the `set-admin` operation and explain the single-admin auto-detect behavior.
- Fixed: clarified that admin login is no longer driven by env vars after the VPS migration; the helper now updates the live `users` row directly.
- Affected files: `deploy/scripts/spoticheck.sh`, `deploy/scripts/set_admin_credentials.sh`, `deploy/README.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; updates operational tooling only, and existing JWT sessions remain valid until they expire or the user logs out.

### 2026-03-16 11:20 - Sync to Shine baseline and restore multi-artist titles
- Added: root `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `backend/tests/test_multi_artist_titles.py`, `frontend/tests/ui_contract.test.mjs`.
- Changed: local workspace moved to `shinemusic/main` baseline commit `de59c2a`; track/album title formatting now uses the full artist list in UI and export helpers.
- Fixed: stale single-artist prefixes in copied/exported track and album titles; local app cache now refreshes with the new JS bundle version.
- Affected files: `backend/app/api/items.py`, `frontend/app.js`, `frontend/index.html`, docs and test files above.
- Impact/Risk: local UI now matches the Shine branch baseline with only the multi-artist title diff layered on top; existing stale DB rows still depend on available `artist_names` data.

### 2026-03-16 11:50 - Enforce per-user duplicate skipping for Add Link
- Added: `backend/tests/test_crawl_user_dedupe.py`.
- Changed: crawl responses now report duplicate skips and accepted batch indices so the frontend can map created jobs correctly.
- Fixed: the same user can no longer add the same Spotify link multiple times, while different users can still track the same link independently.
- Affected files: `backend/app/api/crawl.py`, `backend/app/schemas/crawl.py`, `frontend/app.js`, `frontend/index.html`, test files above.
- Impact/Risk: duplicate prevention is now scoped to `user_id`; pre-existing duplicate rows already in the database are not auto-merged by this patch.

### 2026-03-16 11:58 - Restrict admin All Links to admin-owned rows
- Added: frontend contract coverage for admin self-scope and duplicate-toggle removal.
- Changed: admin default filter label is now `My Links`; admin list fetches default to the admin user's own `user_id`.
- Fixed: `All Links` in admin mode no longer shows every user's rows, and the Add Link modal no longer exposes the removed duplicate checkbox.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, docs above.
- Impact/Risk: global all-user aggregation is no longer available from the default admin state; selecting another user remains supported.

### 2026-03-16 12:08 - Fix incomplete album and track artist titles
- Added: backend regression coverage for album artist extraction from nested track data.
- Changed: normalized album payloads now keep top-level `artist_names`/`artists`, and crawler formatting uses the full artist list for album titles too.
- Fixed: UI and export album titles no longer collapse to only the first artist when the raw response still contains the complete credited list.
- Affected files: `backend/app/api/items.py`, `backend/app/services/spotify_client.py`, `backend/app/services/crawler.py`, `backend/tests/test_multi_artist_titles.py`.
- Impact/Risk: existing rows still depend on stored raw track artist data for fallback; rows with incomplete raw data may need recrawl.

### 2026-03-16 12:15 - Remove pseudo admin filter option
- Added: frontend contract coverage for defaulting the admin filter to a real user selection.
- Changed: the admin user dropdown now lists only actual users and defaults to the admin account itself.
- Fixed: `All Links` semantics now consistently mean all links of the currently selected user without showing a synthetic `My Links` option.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, docs above.
- Impact/Risk: any workflow expecting an empty admin filter state no longer applies; admin self-scope is now explicit via the selected admin user.
### 2026-03-17 16:10 - Expand admin user management and remove hidden list cap
- Added: Backend regression tests for admin username updates and unbounded item listing; frontend `Stt` column with resize support.
- Changed: Admin Users modal now edits `username`; admin group labels now show only the base group name; frontend asset bundle version bumped to `v=20260317-70`.
- Fixed: Removed the hidden `100`-row dashboard cap that made users think they could not add more links.
- Affected files: `backend/app/api/auth.py`, `backend/app/api/items.py`, `backend/app/schemas/auth.py`, `backend/tests/test_admin_user_updates.py`, `frontend/app.js`, `frontend/index.html`, `frontend/style.css`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low to medium; list loading is now unbounded, so extremely large datasets may cost more render time, but current tests and local smoke checks passed.
### 2026-03-17 16:45 - Secure move-items contract
- Added: Focused pytest coverage for `POST /items/move` to assert the `ItemMoveRequest` workflow across user and admin scopes.
- Changed: Unauthorized move tests now simulate filtered queries (zero rows) so the endpoint consistently returns HTTP 404 instead of updating unrelated rows.
- Fixed: The backend contract now guarantees a no-op response for a user moving another user's link while still returning the expected `moved` count and `group` payload on successful moves.
- Affected files: `backend/tests/test_items_move.py`
- Impact/Risk: Low; reinforces backend authorization before the frontend handles move actions, and no UI changes were required.
### 2026-03-17 17:00 - Add move interactions for selected links
- Added: Internal move clipboard shortcuts (`Ctrl/Cmd+C`, `Ctrl/Cmd+X`, `Ctrl/Cmd+V`), row-context `Move to group` submenu, sidebar row-to-group drag/drop, and `Selected` KPI chips in the hero/footer.
- Changed: Save-style actions in admin/settings inputs can now submit with `Enter`; frontend bundle version bumped to `v=20260317-71`.
- Fixed: Multi-link moves no longer depend on manual per-row edits because users can paste into a group, paste before a selected row, or drag the current selection onto another group.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; keyboard shortcuts now intercept `Ctrl/Cmd+C/X/V` in `linkchecker` when focus is outside text inputs, so future clipboard-related features in that view should reuse the same gating rules.
### 2026-03-17 17:10 - Widen footer Selected spacing
- Added: Minimum width and tabular number alignment for the footer `Selected` stat.
- Changed: Frontend asset bundle version bumped to `v=20260317-73`.
- Fixed: Larger selected counts no longer crowd the divider and `API Status` area in the footer.
- Affected files: `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; purely presentational footer spacing update.
### 2026-03-17 17:25 - Add group-colored search highlights in All Links
- Added: Deterministic group accent colors for matched sidebar cards and list rows during `All Links` searches.
- Changed: Search now forces a sidebar rerender so group cards react immediately to the current query; frontend assets bumped to `v=20260317-74`.
- Fixed: Search results in `All Links` no longer lose group context because rows and their owning group cards now glow with the same accent color.
- Affected files: `frontend/app.js`, `frontend/style.css`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low to medium; adds more visual emphasis only during `All Links` search mode and leaves normal group browsing unchanged.
### 2026-03-17 17:32 - Smooth search highlight cards
- Added: More even full-card glow treatment for search-matched group cards and list rows.
- Changed: Frontend asset bundle version bumped to `v=20260317-75`.
- Fixed: Search highlights no longer look like a separate vertical line; the tint now follows the card shape more cleanly.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 17:38 - Restore rounded left accent without search borders
- Added: Rounded inset accent lines on the left edge of search-highlighted group cards and list rows.
- Changed: Frontend asset bundle version bumped to `v=20260317-76`.
- Fixed: Search highlight cards now keep the accent stripe while dropping the surrounding border/outline emphasis.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 17:43 - Remove outer glow from search highlights
- Added: Tighter inset positioning for the rounded left accent line on search-highlighted cards.
- Changed: Frontend asset bundle version bumped to `v=20260317-77`.
- Fixed: Search-highlighted group cards and rows no longer bleed glow outside their card bounds.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 17:54 - Refine search accent line and STT divider
- Added: A dedicated header divider between `STT` and `Asset Details` so the first column boundary now matches the rest of the table header.
- Changed: Search-highlight accent lines on sidebar group cards and list rows now use an inset pill shape with a softer inner edge; frontend assets bumped to `v=20260317-79`.
- Fixed: The previous full-height straight stripe looked too rigid inside rounded cards and the header lacked the vertical separator after `STT`.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 18:21 - Stabilize large batch adds and add Checked sorting
- Added: `POST /api/jobs/batch` for batch crawl-status polling, `CRAWL_TASK_MAX_CONCURRENCY` for bounded worker fan-out, and a `Checked` header menu with `Error First`, `Crawling First`, `Active First`, `Newest Check`, and `Oldest Check`.
- Changed: Frontend pending-job polling now requests statuses in bulk instead of one HTTP call per job; frontend bundle version bumped to `v=20260317-80`.
- Fixed: Large add batches no longer overwhelm the DB pool through combined crawl-task fan-out and per-job polling, and error rows can now be surfaced quickly for cleanup.
- Affected files: `backend/app/api/jobs.py`, `backend/app/config.py`, `backend/app/schemas/job.py`, `backend/app/services/crawler.py`, `backend/tests/test_jobs_batch.py`, `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; job status polling contract changed from single-job bursts to an additional batch endpoint, and crawl throughput is now intentionally capped to protect DB stability during large imports.
### 2026-03-17 18:31 - Reposition Checked sort control
- Added: Inline positioning rules so the `Checked` sort control now sits directly after the `Checked` label and its dropdown anchors from that inline trigger.
- Changed: Frontend bundle version bumped to `v=20260317-81`.
- Fixed: The `Checked` sort UI no longer feels detached at the edge of the column and now reads as part of the header text.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational layout adjustment only.
### 2026-03-17 18:33 - Keep Checked sort dropdown inside viewport
- Added: Dynamic dropdown alignment for the `Checked` sort menu so it flips inward when opened near the right edge of the table header.
- Changed: Tightened the inline spacing between the `Checked` label and sort trigger; frontend bundle version bumped to `v=20260317-82`.
- Fixed: The `Checked` dropdown no longer overflows outside the visible table area, and the trigger now sits immediately after the header text instead of leaving a wide gap.
- Affected files: `frontend/style.css`, `frontend/app.js`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; UI positioning change only.
### 2026-03-18 11:18 - Diagnose group highlight color collision
- Added: Root-cause analysis confirming the current search highlight accents come from an eight-color fixed palette.
- Changed: No runtime code changes; diagnosis only.
- Fixed: N/A.
- Affected files: `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; informational only.
### 2026-03-18 11:34 - Remove highlight color collisions across groups
- Added: Hash-based HSL accent generation helpers so each group highlight color is derived from the full group name instead of a small shared palette.
- Changed: Frontend asset bundle version bumped to `v=20260318-84`, and the UI contract test now checks for the new color-generation helpers.
- Fixed: `All Links` search highlights no longer make different groups such as `Follow > 5` and `312` appear to share the same group color.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; highlight colors will shift for existing groups, but each group now gets a more reliable distinct accent.
### 2026-03-19 11:17 - Migrate deployment target from Railway to VPS
- Added: A tracked `deploy/` stack with `docker-compose.vps.yml`, `Caddyfile`, `.env.example`, `README.md`, and `deploy/AGENTS.md` for repeatable VPS deployment.
- Changed: Root `AGENTS.md` now includes the VPS build/run command and deploy module boundary; the VPS itself was provisioned with Docker/Compose, a `deploy` operator user, and the repo cloned to `/opt/spoticheck/app`.
- Fixed: The project no longer depends on Railway runtime setup for app hosting; the new VPS stack already serves the app and healthcheck on `82.197.71.6` pending DNS cutover.
- Affected files: `AGENTS.md`, `deploy/AGENTS.md`, `deploy/.env.example`, `deploy/Caddyfile`, `deploy/docker-compose.vps.yml`, `deploy/README.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; public cutover is still blocked on updating the Cloudflare DNS record to the VPS, and existing Railway PostgreSQL data has not been migrated because source DB credentials were not available.
### 2026-03-19 11:57 - Migrate Railway data and add automated VPS ops
- Added: `deploy/scripts/backup_postgres.sh`, `deploy/scripts/migrate_from_database_url.sh`, `deploy/scripts/redeploy.sh`, `deploy/scripts/update_app.sh`, `deploy/scripts/spoticheck.sh`, `deploy/scripts/install_helpers.sh`, and `deploy/systemd/spoticheck-backup.{service,timer}`.
- Changed: `docs/PROJECT_CONTEXT.md` now reflects VPS deployment as the current runtime, and the VPS now exposes a one-command `spoticheck` wrapper plus daily PostgreSQL backups to `/opt/spoticheck/backups/postgres`.
- Fixed: Railway PostgreSQL data was migrated into the VPS database, and the migration flow now handles PostgreSQL 17 source dumps restoring into the PostgreSQL 16 target stack.
- Affected files: `AGENTS.md`, `deploy/AGENTS.md`, `deploy/README.md`, `deploy/scripts/backup_postgres.sh`, `deploy/scripts/migrate_from_database_url.sh`, `deploy/scripts/redeploy.sh`, `deploy/scripts/update_app.sh`, `deploy/scripts/spoticheck.sh`, `deploy/scripts/install_helpers.sh`, `deploy/systemd/spoticheck-backup.service`, `deploy/systemd/spoticheck-backup.timer`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; automated backups now exist and data is present on the VPS, but future `spoticheck update` runs still depend on the upstream Git repo state and should be watched if remote changes touch locally modified tracked files.
### 2026-03-19 14:08 - Add shared reverse-proxy route for video app and recover stack isolation
- Added: A second site block in `deploy/Caddyfile` for `video.jazzrelaxation.com`.
- Changed: `deploy/docker-compose.vps.yml` now gives the Caddy container `host.docker.internal:host-gateway` access so it can proxy to other internal app ports on the same VPS, and project memory now records the requirement for unique Docker Compose project names across repos.
- Fixed: Restored the Spotify stack after a temporary service collision caused by two repos deploying from directories named `deploy`; public health for `https://spotify.jazzrelaxation.com/api/health` returned to `200`.
- Affected files: `deploy/Caddyfile`, `deploy/docker-compose.vps.yml`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; Spotify is healthy again, but any future multi-app VPS rollout must keep unique compose project names and `video.jazzrelaxation.com` still needs Cloudflare DNS cutover before the shared Caddy can issue its certificate.
### 2026-03-19 15:20 - Add SpotiCheck admin credential helper
- Added: `deploy/scripts/set_admin_credentials.sh` for rotating persisted admin username/password inside PostgreSQL.
- Changed: `spoticheck` wrapper and deploy docs now expose the `set-admin` operation.
- Fixed: clarified that changing `.env` alone does not update migrated user credentials.
- Affected files: `deploy/scripts/set_admin_credentials.sh`, `deploy/scripts/spoticheck.sh`, `deploy/README.md`, `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`.
- Impact/Risk: low; updates runtime operations only, and existing JWT sessions remain valid until expiry.
### 2026-03-20 14:35 - Add live DNS cutover helper for mail stack
- Added: `mailops dns-records` to print the exact `A/MX/SPF/DKIM/DMARC/PTR` values needed for Cloudflare and the VPS provider.
- Changed: Mail docs and project memory now record the bootstrapped mailboxes plus the current live blocker state (`A mail` + `PTR/rDNS`).
- Fixed: Manual copy/paste of the DKIM TXT payload is no longer required from the raw opendkim file path.
- Affected files: `AGENTS.md`, `deploy/mail/AGENTS.md`, `deploy/mail/.env.example`, `deploy/mail/README.md`, `deploy/mail/scripts/mailops.sh`, `docs/PROJECT_CONTEXT.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; helper output reduces operator error, but mail cutover still cannot finish until public DNS and reverse DNS are updated.
### 2026-03-20 15:15 - Retarget mail stack to congmail.top
- Added: documentation and runtime guidance for `congmail.top` as the active self-hosted mail domain.
- Changed: mail stack config, Caddy hostname, cert paths, and project memory now target `mail.congmail.top` instead of `mail.jazzrelaxation.com`.
- Fixed: removed the mismatch between the user's chosen mail domain and the repo/runtime instructions that still referenced the old domain.
- Affected files: `deploy/Caddyfile`, `deploy/mail/.env.example`, `deploy/mail/README.md`, `deploy/mail/AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; the new domain still will not serve mail from this VPS until public `A mail.congmail.top` is changed from `206.189.91.58` to `82.197.71.6`.
### 2026-03-20 15:35 - Switch live VPS mail runtime to congmail.top
- Added: bootstrap `@congmail.top` mailboxes/aliases plus a fresh DKIM key for `congmail.top` on the live VPS.
- Changed: the VPS hostname and live mail `.env` now target `mail.congmail.top`, and Caddy has been force-recreated to manage TLS for that hostname.
- Fixed: the live mail runtime no longer points at the old `jazzrelaxation.com` domain internally.
- Affected files: `deploy/Caddyfile`, `deploy/mail/.env.example`, `deploy/mail/README.md`, `deploy/mail/scripts/mailops.sh`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; SMTP/IMAP on the VPS is ready, but Let's Encrypt still fails until public DNS for `mail.congmail.top` stops resolving to `206.189.91.58`.
### 2026-03-20 16:00 - Finalize congmail.top mail TLS with Caddy fullchain import
- Added: `docker-data/dms/custom-certs` mount path plus helper logic to copy Caddy-issued fullchain/key into the documented `docker-mailserver` manual-cert location.
- Changed: `mailops use-caddy-cert` now forces `MAIL_SSL_TYPE=manual`, rewrites the internal cert paths to `/tmp/dms/custom-certs/*`, and recreates the mail container with the copied cert material.
- Fixed: `mail.congmail.top` now serves a valid Let's Encrypt certificate not only on HTTPS, but also on SMTPS `465` and SMTP `STARTTLS` `587`.
- Affected files: `deploy/mail/docker-compose.yml`, `deploy/mail/.env.example`, `deploy/mail/README.md`, `deploy/mail/scripts/use_caddy_cert.sh`, `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; live mail TLS is now valid externally, and future helper runs follow the documented DMS custom-certs flow instead of relying on the shared Caddy volume path inside the container.
### 2026-03-20 16:10 - Remove legacy jazzrelaxation mailboxes and add client setup note
- Added: `deploy/mail/CLIENT_SETUP.md` plus `mailops delete-account` / `mailops delete-alias` helper commands for routine cleanup.
- Changed: root mail helper documentation now covers the full create/update/delete account lifecycle.
- Fixed: removed the stale `@jazzrelaxation.com` mailbox and alias bootstrap state from the live VPS, leaving only `@congmail.top` accounts.
- Affected files: `AGENTS.md`, `deploy/mail/README.md`, `deploy/mail/CLIENT_SETUP.md`, `deploy/mail/scripts/mailops.sh`, `docs/PROJECT_CONTEXT.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; runtime state is cleaner and the operator now has one-line helper commands for future mailbox cleanup.
### 2026-03-24 15:10 - Sync shared VPS Caddy route into GitHub and ignore mail runtime state
- Added: `.gitignore` now excludes `deploy/mail/docker-data/` so VPS-side mail runtime files no longer appear as repo changes.
- Changed: `deploy/Caddyfile` now tracks the live `lush.congmail.top` reverse-proxy block that existed only on the VPS.
- Fixed: the repo can be synchronized with the live VPS without treating mail data as code, which keeps future VPS edits and Git operations cleaner.
- Affected files: `.gitignore`, `deploy/Caddyfile`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this aligns GitHub with the live shared reverse proxy while avoiding accidental versioning of mail runtime state.
### 2026-03-24 15:10 - Add Spotify link-aware search in Link Checker
- Added: `docs/UI_SYSTEM.md` was recreated to document the current dashboard visual system after the reset.
- Changed: frontend search now matches Spotify URLs, Spotify URIs, display titles, subtitles, and parsed `type + spotify_id` values instead of only plain text fields.
- Fixed: pasting a link like `https://open.spotify.com/playlist/...` into the top search box now returns the tracked row as expected.
- Affected files: `docs/UI_SYSTEM.md`, `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this is a frontend-only search behavior change and keeps the existing layout/UI intact.
### 2026-03-24 16:30 - Deploy Spotify link-aware search update to VPS
- Added: no new runtime features beyond the already-tracked search update; this entry records the production rollout.
- Changed: VPS repo `/opt/spoticheck/app` and the running Docker stack were updated to commit `8effc04`.
- Fixed: live app on `spotify.jazzrelaxation.com` now includes the Spotify link-aware search behavior from the local patch.
- Affected files: `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; rollout completed cleanly and `https://spotify.jazzrelaxation.com/api/health` returned `ok` after rebuild.
### 2026-06-11 09:25 - Fix slow Spotify item list response
- Changed: `/api/items` now loads only the newest raw response per Spotify ID and the latest two snapshots per item instead of hydrating full history through the ORM.
- Added: database indexes for latest raw-response and recent snapshot lookups.
- Fixed: large user lists no longer spend tens of seconds building item responses, avoiding Cloudflare 524 timeouts on the dashboard.
- Affected files: `backend/app/api/items.py`, `backend/app/database.py`, `docs/CHANGELOG.md`
- Impact/Risk: Low; API response shape is unchanged, only query strategy and supporting indexes changed.
### 2026-06-11 10:05 - Smooth large Spotify list switching
- Changed: admin user switching now clears the previous scope immediately, ignores stale in-flight responses, and shows the selected user's cached groups before fresh data arrives.
- Changed: large link lists now render rows in animation-frame batches and use a lighter render signature to reduce main-thread blocking.
- Added: concise project memory routing files required by the repo rules.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/PROJECT_BRIEF.md`, `docs/MEMORY_INDEX.md`, `docs/DECISIONS_INDEX.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; this touches frontend state/render flow while keeping API contracts unchanged.
### 2026-06-11 10:55 - Load large Spotify user lists in two phases
- Changed: admin user switching now requests a small first page of links immediately, then loads the remaining rows in the background with `offset`.
- Fixed: users with hundreds of links no longer have to wait for the full payload before the first rows appear.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; group counts can update once after the background page completes, but API contracts stay unchanged.
### 2026-06-11 11:20 - Virtualize large Spotify list loading
- Added: `/api/items/summary` for fast counts and group totals without returning every row.
- Changed: the frontend now loads list rows by backend pages, sends sort/search scope to the API, and renders only the visible viewport instead of merging the full user list in the background.
- Fixed: switching to users with hundreds of links no longer blocks scrolling while the remaining rows are appended to the DOM.
- Affected files: `backend/app/api/items.py`, `backend/app/schemas/item.py`, `backend/tests/test_admin_user_updates.py`, `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; this changes the list loading contract while preserving existing `/api/items` payload keys.
### 2026-06-11 11:45 - Exclude VPS runtime mail data from Docker build context
- Fixed: Docker builds on the VPS no longer scan `deploy/mail/docker-data`, which can contain root-owned mail config files and block deploy-user builds.
- Affected files: `.dockerignore`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this only narrows the Docker build context and does not change runtime code.
### 2026-06-11 12:10 - Preserve scroll position in virtual Spotify lists
- Fixed: virtual list rendering now computes the visible range before clearing rows and keeps the full virtual height during rerender, preventing the list from snapping back to the top while scrolling.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this is scoped to frontend scroll rendering for paged lists.
### 2026-06-11 12:35 - Stop virtual list scroll restoration during user scroll
- Fixed: virtual page loads and scroll-driven renders no longer restore an old `scrollTop`, preventing queued render frames from pulling the link list back to the top while the user scrolls.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this only changes virtual list scroll behavior and keeps explicit preserve-scroll callers intact.
### 2026-06-11 14:25 - Keep virtual pages warm during large-list operations
- Changed: virtual scrolling now prefetches adjacent pages, preserves loaded page cache on same-scope reloads, and skips background sync resets for large active lists.
- Fixed: `Refresh All` loads the full current backend scope before starting a batch, so large groups are not limited to the first rendered page.
- Fixed: batch refresh polling no longer reloads the full list after every completed job; it updates loaded rows and performs one canonical reload when the batch finishes.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; this changes large-list cache and refresh behavior while keeping API contracts unchanged.
### 2026-06-11 14:45 - Restore drag reorder for virtual Spotify rows
- Fixed: row drag/drop now updates the virtual item cache immediately instead of only reordering the loaded `state.items` copy.
- Changed: `/api/items` applies saved row order from `ui_preferences` for unsorted paged lists when the stored order covers the current scope.
- Affected files: `backend/app/api/items.py`, `backend/tests/test_items_move.py`, `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; this restores custom row order after virtual paging without changing response payload keys.
### 2026-09-09 09:05 - Diagnose playlist duplicate versus URL search mismatch
- Added: no code or data changes; recorded the live diagnosis.
- Changed: confirmed playlist `37i9dQZF1DWV7EzJMK2FUI` exists for user `admin` and duplicate detection is behaving as designed.
- Fixed: no runtime fix in this diagnostic task; identified that backend search does not normalize full Spotify URLs before querying stored IDs.
- Affected files: `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; pasted full URLs can still show an empty search result until backend URL normalization is implemented.
### 2026-09-09 09:05 - Fix URL-aware Spotify search and add-link recognition
- Added: add-link modal preview showing `Playlist`, `Track`, `Album`, or `Artist`, parsed Spotify ID, and invalid-line status before submit.
- Changed: backend item and summary searches now recognize full Spotify URLs and Spotify URIs by parsing `type + spotify_id`.
- Fixed: searching `https://open.spotify.com/playlist/37i9dQZF1DWV7EzJMK2FUI` now returns the existing admin item instead of showing a false empty result.
- Affected files: `backend/app/api/items.py`, `backend/tests/test_items_move.py`, `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; duplicate detection remains per-user and the live app was rebuilt without changing database contents.
### 2026-09-09 09:05 - Add global clipboard line setting and lock All Links creation
- Added: admin-only global setting for playlist clipboard line count, persisted in the new `app_settings` table and applied to all accounts.
- Changed: `Clipboard (Playlist)` now copies up to the configured number of track lines; settings UI validates values from `1` to `2000`.
- Fixed: `All Links` is now a monitoring-only scope for new creation; the UI disables add controls there and backend crawl endpoints reject new ungrouped links.
- Affected files: `backend/app/models/app_setting.py`, `backend/app/models/__init__.py`, `backend/app/api/auth.py`, `backend/app/api/crawl.py`, `frontend/app.js`, `frontend/index.html`, tests, and project docs.
- Impact/Risk: Medium; users must select an explicit group before adding new links, while existing data and refresh flows are preserved. The VPS rollout completed with `deploy-app-1` healthy.
### 2026-09-11 10:20 - Lock All Links creation and append new links to list end
- Added: regression coverage for group-only creation and stable append ordering.
- Changed: add modal no longer offers `All Links`; default backend list order uses `created_at ASC` plus `id ASC`, and optimistic new rows append instead of prepend.
- Fixed: users cannot create new ungrouped links through the UI or crawl API, and new links no longer jump to the top due to `updated_at`.
- Affected files: `frontend/app.js`, `frontend/index.html`, `backend/app/api/items.py`, `backend/tests/test_items_move.py`, `frontend/tests/ui_contract.test.mjs`, docs.
- Impact/Risk: Medium; existing unsorted lists may reorder to oldest-created first, while explicit sort controls and manual row ordering continue to work.
### 2026-09-11 10:45 - Preserve dragged row order when stored preferences are incomplete
- Added: regression coverage for missing row-order keys during drag persistence.
- Changed: frontend row-order persistence now merges stable current rows and avoids saving temporary crawl IDs.
- Fixed: a drag no longer reverts when the stored order covers fewer rows than the active group; the complete loaded list becomes the persistence base.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this affects only persisted display ordering and does not change item data or ownership.
### 2026-09-09 09:57 - Fix playlist export using incomplete cached track data
- Added: regression coverage for refetching a playlist whose cached track page is incomplete.
- Changed: export hydration now checks `tracks_expected`/`track_count` and `deep_crawl_complete` before reusing cached playlist tracks.
- Fixed: a playlist with `367` tracks cached as only `100` no longer exports just the first `100`; it is refetched before the configured clipboard limit is applied.
- Affected files: `backend/app/api/items.py`, `backend/tests/test_items_move.py`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; incomplete playlist exports are more accurate and may issue additional Spotify requests.
### 2026-09-09 10:10 - Fix Pathfinder playlist pagination without `nextOffset`
- Added: regression coverage for multi-page Pathfinder playlist responses that omit `nextOffset`.
- Changed: playlist pagination derives the next offset from the current page size when the response has no explicit `nextOffset`.
- Fixed: live export for the `367`-track playlist now returns `367` rows instead of `100`; the frontend applies the admin-configured `200`-line clipboard cap afterward.
- Affected files: `backend/app/services/spotify_client.py`, `backend/tests/test_spotify_playlist.py`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; playlist fetches now continue across all available pages up to `PLAYLIST_MAX_TRACKS`.
### 2026-09-09 10:15 - Standardize GitHub-first SpotiCheck deployment
- Added: deployment documentation covering GitHub `main` as source of truth, `spoticheck update` as the release command, and controlled rollback through Git history.
- Changed: recorded why earlier hotfixes were copied directly to the VPS and clarified that this is no longer the standard release path.
- Fixed: no runtime behavior changed; deployment drift is now explicitly documented for future operations.
- Affected files: `deploy/README.md`, `docs/DECISIONS.md`, `docs/DECISIONS_INDEX.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; this improves release traceability without including `.env` secrets or database volumes in Git.
### 2026-09-09 10:25 - Push tested Spotify hotfixes and resynchronize VPS from GitHub
- Added: ignore rules for VPS-only Caddy backup files and runtime backup directories.
- Changed: verified the VPS fast-forwarded to GitHub commit `e52f214` and that `spoticheck update` rebuilds the healthy production stack.
- Fixed: removed deployment drift from the prior direct-copy workflow; the VPS now follows the GitHub release path.
- Affected files: `.gitignore`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`, and VPS helper file modes.
- Impact/Risk: Low; runtime secrets/data remain untouched and the public Spotify health endpoint remains `200 OK`.
