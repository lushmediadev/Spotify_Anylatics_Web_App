# YouTube Channel & Playlist

## Responsibility
- Crawl public channel metadata/view counts via YouTube Data API and associate existing Spotify playlists with channels.
- Does not upload videos, inspect private channel data, or replace the standalone YouTube Manager deployment.

## Entry Points
- API: `/api/youtube/keys`, `/keys/check`, `/channels` and channel refresh/playlist operations.
- UI: Channel & Playlist navigation and API & Export Settings.
- Workspace APIs: `/api/youtube/preferences`, group rename/delete/clear, channel move/batch delete. Ordering lives in additive `youtube_workspace_preferences`, separate from Spotify UI preferences.
- Channel groups: `/api/youtube/groups` creates owner-scoped named groups, including empty groups. UI displays individual groups only; there is no All Channels aggregate entry.

## Key Files
- `backend/app/models/youtube.py`, `backend/app/schemas/youtube.py`
- `backend/app/api/youtube.py`, `backend/app/services/youtube.py`, `backend/app/services/youtube_jobs.py`
- `backend/app/services/youtube_workspace.py`: owner locking, preference validation/pruning and safe channel management.
- `backend/app/utils/youtube_urls.py`
- `frontend/channels.js`, `frontend/channels.css`; shell integration in `frontend/app.js` and `frontend/index.html`.

## Depends On
- Existing authentication owner predicates, PostgreSQL/SQLAlchemy, Spotify Item serialization and crawl tasks.
- Google YouTube Data API v3 `channels.list`; keys are configured by each account.

## Invariants
- API keys are readable/writable only by their owner; background refresh uses the channel owner's keys.
- Channel and playlist owners must match. Multiple channels may refer to the same playlist.
- Unlinking/deleting a channel never deletes the underlying Spotify Item.
- New pasted Spotify playlists use explicit group `Channel Playlists`; aggregate All Links remains read-only for creation.
- Runtime schema changes are additive. No automatic data migration from the old YTM service.
- Channel view deltas compare stored snapshots, not fabricated daily estimates.

## Known Pitfalls
- Keys must enable YouTube Data API v3 and permit backend requests; browser-referrer-only keys will fail on the VPS.
- Legacy `/c/` URLs cannot be reliably resolved by `channels.list`; use a channel ID or @handle.
- UI polling reads stored state; it does not call Google repeatedly. Explicit refresh performs a crawl.
- List requests may be paged internally, but the UI has a single scrollable group list without Prev/Next. Ignore stale responses after changing owner/group.
- Header/group controls mount into shared shell hosts. Keep Spotify background updates out of those hosts while the channel view is active.
- Never include API key strings in logs, fixtures, screenshots, Git, or deployment documentation.

## Interaction Parity
- Group and channel order is persisted per account on the server; polling must respect saved order rather than reset to creation order.
- Moving a channel moves its channel-playlist section together. Deleting a group moves surviving channels into Ungrouped; clearing a group deletes its YouTube tracking records only.
- Playlist selection/reordering is scoped to one parent channel. Unlinking affects only that association, never the Spotify Item or other channels using it.
- The explicit delete-link action is different: after warning/confirmation it calls the existing own-only Spotify Item deletion API, removing the Item and all its channel associations. It does not delete the upstream playlist on Spotify.
- Edit picker selections are maintained independently of visible group/search results; saving includes checked IDs hidden by filters.
- Clipboard (Playlist), TXT and Excel reuse Spotify export helpers and the admin's global clipboard line limit. Refresh selected playlists targets exact owned Item IDs, not the entire Spotify list.
- Keyboard shortcuts apply only to the active channel view and never consume text editing inside inputs/dialogs.
- Column resizing is stored per account in the current browser; group/channel/attached-playlist order is stored on the server. Sorting is a view operation and disables drag reorder until cleared.

## Related Decisions
- Additive YouTube integration and many-to-many playlist references in `docs/DECISIONS.md`.

## Verification
- Backend: `cd backend; .\venv\Scripts\python.exe -m pytest -q`.
- Frontend: `node --test frontend/tests/ui_contract.test.mjs frontend/tests/channels.test.mjs`; browser suite requires Playwright/Chrome or `PLAYWRIGHT_MODULE_PATH`.
- Loopback UI fixture: `backend\venv\Scripts\python.exe frontend/tests/channel_preview.py`, then open `http://127.0.0.1:8010/login.html` with dummy credentials. Never expose this fixture server publicly.
