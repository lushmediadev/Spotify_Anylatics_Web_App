# SpotiCheck UI System

## Visual direction

- Light-only desktop dashboard with fixed left rail, dedicated group rail, and dense list workspace.
- The list view uses a wide photographic hero strip; preserve that existing pattern instead of introducing new wrappers or alternate shells.
- Use the exact YouTube Manager grayscale palette from `D:\Youtube_manager\frontend\style.css`; retain Spotify logo SVG green `#1DB954`, semantic status colors, and functional group accents.

## Core palette

- App background / surface 0: `#ffffff`
- Surface 1 (rails, settings, forms): `#f9f9f9`
- Surface 2 (hover, search): `#f2f2f2`
- Surface 3 (selection): `#e5e5e5`
- Main text / primary actions: `#0f0f0f`; primary action hover: `#272727`
- Muted text: `#606060`
- Borders: black alpha, soft `0.08`, medium `0.14`
- Status/type text uses readable darker semantic hues on light surfaces; group accent RGB variables still control search and drag/drop indicators.

## Typography

- Primary font stack: `"Inter", "Inter Tight", system-ui, sans-serif`
- Headings use `Inter Tight`
- Body text is compact, mostly `13px` to `15px`
- Existing uppercase micro-labels and table labels should only be adjusted when the task explicitly changes copy structure

## Layout and spacing

- Sidebar width: `64px`
- Group rail width: `280px`
- Top bar height: `80px`
- Layout is tight and spreadsheet-like, with thin dividers and restrained spacing

## Radius and shape

- Group items and table rows: around `8px`
- Inputs and dropdowns: around `14px`
- Modal shell: `16px`
- Search and primary action pills: fully rounded

## Component patterns

- Sidebar: icon-first collapsed rail with tooltip labels
- Group rail: flat stacked list with subtle selected and search-match states
- Search: rounded light grayscale input in the top bar
- Rows: cover thumbnail + title/meta on the left, metrics grid on the right
- Buttons:
  - `btn-accent`: black filled primary action with white text
  - `btn-ghost`: transparent secondary action with thin border
- Modals: centered light dialog with black-alpha backdrop and no detached decorative chrome
- Hero is a photographic exception to the light chrome: preserve the Spotify cover selection, color filter, and dark gradient from the original UI. Use light heading/subtitle text and translucent dark KPI chips; never wash out the cover with a white overlay.
- Dynamically inserted Manager assignment fields inherit the same custom dropdown palette without role-specific CSS.
- Both HTML pages declare `data-theme="light"` and native controls use `color-scheme: light`.
- Scoped compatibility CSS maps legacy white text/border/background utilities and admin cards emitted by `app.js`; do not change runtime markup just to recolor it.
- Keep JS/CSS cache query versions current in both pages; login uses inline auth logic, not `app.js`.

## UI guardrails

- Preserve the deployed Shine layout and current control placement
- Keep list rows dense; do not convert them into card-heavy layouts
- Search/filter tasks should stay behavioral unless a visual change is explicitly required
- New UI work should inherit the existing palette, spacing rhythm, and typography rather than introduce a separate design language
- Channel & Playlist uses the shared shell and channel group rail: a flat channel summary followed by visible playlist rows, with collapse-all as an optional control.
- Channel search/refresh/add belong in the existing topbar, never in a second toolbar below it. Group search and creation belong in the left group rail, including the empty-group state.
- Channel workspace reuses `.playlist-hero`, `.hero-kpi`, list typography, covers, status dots and metric badges. Its hero takes the first filtered YouTube channel banner using the YTM cover URL logic.
- Channel & Playlist rows are compact: 76px minimum height and 44px covers, matching YouTube Manager density. Playlist count sits beside CHANNEL; group subtitles, repeated child headers and child User / Updated cells are omitted. Spotify's separate list sizing is unchanged.
- Channel edits are right-click/keyboard context-menu actions, not row Edit buttons. No visible page controls; backend paging is internal and must load the complete selected group.
- Spotify background sync cannot update another view's header/title/controls.
- No account filter in the group rail. Spotify and Channel & Playlist always use the signed-in account; role badge and authorized Users management remain available.
- Both Spotify and channel rails contain named groups and New Group only, without All Links/All Channels entries. Opening a page selects its first available group before rendering rows; no-group state offers group creation, not an aggregate list.
- Settings hosts per-account YouTube API keys and admin-only global clipboard settings. Own profile/password remain accessible through the sidebar avatar.
