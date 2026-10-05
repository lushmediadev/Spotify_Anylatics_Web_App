# SpotiCheck Decisions Index

Canonical detail lives in `docs/DECISIONS.md`. This file lists active decisions worth checking first.

| Area | Active decision | Detail source |
| --- | --- | --- |
| UI source | Preserve Shine dashboard layout and do targeted changes only. | `docs/DECISIONS.md` |
| Palette | Use YouTube Manager light grayscale tokens; retain the green Spotify logo. | `docs/UI_SYSTEM.md` |
| Roles | Admin quản lý tất cả tài khoản; manager quản lý assigned users và own YouTube Link Checker/personal/key settings. | `docs/modules/access-control.md` |
| YouTube integration | Independent pasted playlist records plus a separate YTM workspace; shared login/own API keys, no old YTM data import or deployment changes. | `docs/modules/youtube-channel-playlist.md` |
| Workspace interactions | Persist workspace-specific order; URL-only edits and confirmed deletion do not affect Spotify checker records. | `docs/modules/youtube-channel-playlist.md` |
| User scope | Every role accesses its own resource data only; managing accounts does not grant access to their links/channels/groups. | `docs/modules/access-control.md` |
| Link ownership | Deduplicate Spotify links per user, not globally. | `docs/DECISIONS.md` |
| Clipboard export | Admin controls one global playlist clipboard line limit, persisted in `app_settings`. | `docs/DECISIONS.md` |
| Group navigation | Both Spotify and channel pages show individual groups only; new links require an explicit group. Backend aggregate queries remain for discovery. | `docs/UI_SYSTEM.md` |
| Deployment source | GitHub `main` is the source of truth; VPS updates pull a tested commit via `spoticheck update`. | `docs/DECISIONS.md` |
| Link ordering | Default list order is oldest-created first, so newly added links append at the end; explicit sorts and manual row order remain supported. | `docs/DECISIONS.md` |
| Group labels | Admin group labels should stay clean visually while ownership remains enforced internally. | `docs/DECISIONS.md` |
| VPS deploy | Docker Compose + Caddy + PostgreSQL is the production path. | `docs/DECISIONS.md` |
| Performance | Large list views must prefer set-based backend queries and incremental frontend rendering. | `docs/CHANGELOG.md` |
