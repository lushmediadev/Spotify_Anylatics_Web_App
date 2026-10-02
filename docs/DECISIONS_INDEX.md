# SpotiCheck Decisions Index

Canonical detail lives in `docs/DECISIONS.md`. This file lists active decisions worth checking first.

| Area | Active decision | Detail source |
| --- | --- | --- |
| UI source | Preserve Shine dashboard layout and do targeted changes only. | `docs/DECISIONS.md` |
| Palette | Use YouTube Manager light grayscale tokens; retain the green Spotify logo. | `docs/UI_SYSTEM.md` |
| Roles | Admin, manager, user; manager scope follows assigned user accounts. | `docs/modules/access-control.md` |
| YouTube integration | Owner-scoped API keys and channel-playlist references, without duplicating Spotify metrics or migrating old YTM automatically. | `docs/modules/youtube-channel-playlist.md` |
| User scope | Admin filtering must inspect one real account scope at a time, not silently aggregate all users. | `docs/DECISIONS.md` |
| Link ownership | Deduplicate Spotify links per user, not globally. | `docs/DECISIONS.md` |
| Clipboard export | Admin controls one global playlist clipboard line limit, persisted in `app_settings`. | `docs/DECISIONS.md` |
| Group navigation | Both Spotify and channel pages show individual groups only; new links require an explicit group. Backend aggregate queries remain for discovery. | `docs/UI_SYSTEM.md` |
| Deployment source | GitHub `main` is the source of truth; VPS updates pull a tested commit via `spoticheck update`. | `docs/DECISIONS.md` |
| Link ordering | Default list order is oldest-created first, so newly added links append at the end; explicit sorts and manual row order remain supported. | `docs/DECISIONS.md` |
| Group labels | Admin group labels should stay clean visually while ownership remains enforced internally. | `docs/DECISIONS.md` |
| VPS deploy | Docker Compose + Caddy + PostgreSQL is the production path. | `docs/DECISIONS.md` |
| Performance | Large list views must prefer set-based backend queries and incremental frontend rendering. | `docs/CHANGELOG.md` |
