# YouTube Channel & Playlist

## Responsibility
- Crawl public channel metadata/view counts via YouTube Data API and associate existing Spotify playlists with channels.
- Does not upload videos, inspect private channel data, or replace the standalone YouTube Manager deployment.

## Entry Points
- API: `/api/youtube/keys`, `/keys/check`, `/channels` and channel refresh/playlist operations.
- UI: Channel & Playlist navigation and API & Export Settings.
- Channel groups: `/api/youtube/groups` creates owner-scoped named groups, including empty groups. UI displays individual groups only; there is no All Channels aggregate entry.

## Key Files
- `backend/app/models/youtube.py`, `backend/app/schemas/youtube.py`
- `backend/app/api/youtube.py`, `backend/app/services/youtube.py`, `backend/app/services/youtube_jobs.py`
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
- Never include API key strings in logs, fixtures, screenshots, Git, or deployment documentation.

## Related Decisions
- Additive YouTube integration and many-to-many playlist references in `docs/DECISIONS.md`.

## Verification
- Backend: `cd backend; .\venv\Scripts\python.exe -m pytest -q`.
- Frontend: `node --test frontend/tests/ui_contract.test.mjs frontend/tests/channels.test.mjs`; browser suite requires Playwright/Chrome or `PLAYWRIGHT_MODULE_PATH`.
- Loopback UI fixture: `backend\venv\Scripts\python.exe frontend/tests/channel_preview.py`, then open `http://127.0.0.1:8010/login.html` with dummy credentials. Never expose this fixture server publicly.
