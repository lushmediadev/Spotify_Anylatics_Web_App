# Independent YouTube workspaces

## Status
- Implemented locally: paste-only independent playlist workspace, collapsed counts, isolated original YTM interface/API and manager-only YTM gates.
- User confirmed no YTM data import. Standalone YTM site must remain unchanged and running.
- Pending: final test results, PostgreSQL disposable-copy preflight, GitHub-first app-only VPS deployment and live verification. Production database backup is mandatory before migration.

## Requested Outcome
- Channel & Playlist accepts pasted Spotify playlist URLs only; remove Link Checker picker and unlink context action.
- Playlist tracking in this workspace must be independent of Spotify Link Checker, including deletion, updates and history.
- Show a Playlist count column in the otherwise empty metric/owner region for collapsed channel rows; preserve expanded playlist metric columns.
- Add standalone YouTube Manager as a separate side tab, retaining its original visual, metrics and interactions. Group rename uses double-click instead of an edit icon.
- Manager can use YouTube Link Checker only; enforce server-side access as well as navigation. Shared own API-key settings remain available; clarify any account-management impact during implementation.

## Verified Code Facts
- `ChannelPlaylist.item_id` references `items.id`; pasted URLs currently reuse any owned matching playlist or create a Link Checker Item in group `Channel Playlists`.
- `replace_playlists` supports existing Item IDs and URLs; removing the picker alone does not isolate data.
- Exact Item UUIDs are already stored on channel crawl jobs, allowing independent records with the same Spotify ID without changing upstream crawl semantics.
- Standalone source: `D:\Youtube_manager`; frontend is vanilla JS with its own shell/style. Backend uses separate string-ID User/Item/Job/Snapshot tables, global API keys and account-management policies that cannot be copied blindly into this app's UUID models/own-only resources.
- Canonical GitHub origin is lushmediadev. VPS still points to shinemusicllc and needs a safe remote update before the next deployment; preserve Caddy and other services.

## Safety And Verification Gates
- Additive, idempotent migration; preserve original Link Checker Items and snapshots. Clone existing channel associations into independent records before switching the workspace.
- Do not import ignored local .env/database/runtime files or publish API keys.
- Namespace YTM API/data/group preferences separately from Channel & Playlist and Spotify.
- Back up production DBs before data migration; test actual PostgreSQL constraints and rollback fixtures, not SQLite tests alone.
- Verify manager denial for Spotify/channel/playlist/account-management APIs, plus own YouTube/API-key access; do not rely on hiding icons.
- Regression: existing tracking/export/delete behavior, collapsed/mixed rows, paste-only edit, duplicate URLs, polling, group rename, separate workspace ownership and persisted order.
- GitHub-first deployment; no YTM shutdown or old data deletion without user authorization after verification.
