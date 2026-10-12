# Frontend Delta Rules

- Preserve the deployed Shine layout, spacing, and control placement unless the task explicitly changes UI.
- Keep shell/Spotify logic in `app.js`, Channel & Playlist in `channels.js`, YouTube Link Checker in `ytm/app.js` and the shared group rail in `group-rail.js`; there is no frontend build pipeline on this branch.
- When changing display labels, ensure the same helper feeds row rendering and clipboard/export fallbacks.
- After modifying asset-loaded JS/CSS, bump the version query string in `index.html` to avoid stale browser cache.
