# SpotiCheck Project Brief

## Purpose

SpotiCheck tracks public Spotify metrics for Artist, Track, Album, and Playlist links: `monthly_listeners`, `playcount`, `followers`, and related metadata.

## Stack

- Frontend: static HTML + Tailwind CDN + vanilla JavaScript in `frontend/`.
- Backend: Python FastAPI, SQLAlchemy async, PostgreSQL, `httpx`, and Playwright fallback.
- Runtime: single FastAPI service serves API plus static frontend.
- Deploy: Docker Compose + Caddy + PostgreSQL on VPS `82.197.71.6`.
- Canonical GitHub origin: `https://github.com/lushmediadev/Spotify_Anylatics_Web_App.git`, an independent public repository. The `shinemusic` remote preserves the previous source; VPS remotes were not changed during the repository migration.

## Main Modules

- `frontend/app.js`: dashboard state, user/group filters, list rendering, export actions, drag/drop, and UI interactions.
- `frontend/index.html`: static shell and asset cache query params.
- `frontend/channels.js`: YouTube channels and linked Spotify playlists; see `docs/modules/youtube-channel-playlist.md`.
- `backend/app/api/`: HTTP routes and response contracts.
- `backend/app/services/`: Spotify fetch/crawl logic.
- `backend/app/database.py`: async DB setup and runtime indexes.
- `deploy/`: VPS compose, Caddy, helpers, and backup scripts.
- Role permissions: see `docs/modules/access-control.md`; shared owner predicates live in `backend/app/services/auth.py`.

## Build And Test

- Frontend syntax: `node --check D:\Spotify_AnylaticsWeb_App\frontend\app.js`
- Frontend contract: `node --test D:\Spotify_AnylaticsWeb_App\frontend\tests\ui_contract.test.mjs`
- Backend tests: `cd backend && .\venv\Scripts\python.exe -m pytest -q`
- Local backend: `cd backend && .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010`

## Invariants

- Preserve the deployed Shine UI structure unless the user explicitly asks for a redesign.
- Keep API payload keys backward compatible unless there is a migration plan.
- After changing `frontend/app.js` or CSS, bump cache query params in `frontend/index.html`.
- `final3.html` is a design reference only, not runtime source.
- All roles see and operate only their own resource data. Role-based account management is separate; ownership is enforced server-side.
