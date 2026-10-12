# SpotiCheck UI System

## Visual direction

- Light-only desktop dashboard with fixed left rail, dedicated group rail, and dense list workspace.
- The list view uses a wide photographic hero strip; preserve that existing pattern instead of introducing new wrappers or alternate shells.
- After login, open YouTube Link Checker by default for accounts with YouTube access; otherwise select the first permitted workspace.
- Use the exact YouTube Manager grayscale palette from `D:\Youtube_manager\frontend\style.css`; use the supplied red YouTube play mark throughout the product, while retaining semantic status colors and functional group accents.

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
- Login branding uses the supplied red YouTube play mark with the YoutubeCheck name; retain the compact centered brand header and the existing sign-in form layout.

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

- Sidebar: icon-first collapsed rail with tooltip labels; YouTube Link Checker is first among workspace links.
- Group rail: flat stacked list with subtle selected and search-match states
- Search: rounded light grayscale input in the top bar
- Rows: cover thumbnail + title/meta on the left, metrics grid on the right
- Buttons:
  - `btn-accent`: black filled primary action with white text
  - `btn-ghost`: transparent secondary action with thin border
- Modals: centered light dialog with black-alpha backdrop and no detached decorative chrome
- Hero is a photographic exception to the light chrome: preserve the Spotify cover selection, color filter, and dark gradient from the original UI. Use light heading/subtitle text and translucent dark KPI chips; never wash out the cover with a white overlay.
- Dynamically inserted Manager assignment fields inherit the same custom dropdown palette without role-specific CSS.
- Both HTML pages (`index.html`, `login.html`) declare `data-theme="light"` and native controls use `color-scheme: light`.
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
- All three workspaces share one row geometry: 104px minimum row height (also the virtual-list row height), 70px covers with 4px radius, 46px header cells, Inter Tight 15px/700 titles. Channel & Playlist keeps its playlist count beside CHANNEL and omits group subtitles, repeated child headers and child User / Updated cells.
- Channel edits are right-click/keyboard context-menu actions, not row Edit buttons. No visible page controls; backend paging is internal and must load the complete selected group.
- Playlist context actions have matching icons and confirmed independent deletion, without an Unlink command. Spotify Link Checker is unaffected.
- Edit playlists is URL-only, prefilled with the channel's existing URLs; no checker groups/search/picker. Channel menus prioritize Edit playlists before Add Channel.
- Collapsed channel rows use the empty owner cell for playlist counts. Header is Playlist when all rows are collapsed and Owner / Playlist for mixed expansion.
- YouTube Link Checker renders in-page (`#ytm-panel`, `ytm/app.js` exposing `window.YouTubeChecker`) — no iframe. It uses the shared topbar (`#ytm-header-tools`), hero, footer, Link Checker row component (`custom-grid-row`, `list-asset-*`, `checked-stack`) and API client (`api._fetchRaw('/ytm/…')`, so 401/403 handling is shared). `ytm/style.css` only holds the channel grid. Accounts whose only effective workspace is Youtube retain that logo on Settings, account and Users too; other accounts use SpotiCheck outside the YTM tab. Own keys are configured in the shared Settings page.
- Admin tạo/sửa Manager có fieldset Workspace dưới Role: native checkbox monochrome cho Youtube, Spotify, Youtube-Spotify, multi-select ít nhất một. User forms và manager create/edit không có workspace selector.
- Sidebar chỉ hiện workspace trong effective grant; landing chọn workspace hợp lệ đầu tiên, [] về Settings. Manager có thêm Users; Users lists self plus assigned accounts và chỉ tạo role User, không có reassignment controls. Refresh quyền khi navigation/focus/30s hoặc API403; dừng/hủy cache và chuyển view nếu quyền bị thu hồi.
- Edit playlists visual is scoped to `.chp-playlist-editor`: shared light surfaces, 14px inputs, bold list titles, monochrome checkboxes and icon actions. Only its body scrolls so Save/Cancel stay visible on short/mobile screens.
- Spotify background sync cannot update another view's header/title/controls.
- No account filter or Admin Mode banner in the group rail. Spotify and Channel & Playlist always use the signed-in account; role labels stay in account/profile and authorized Users management remains available.
- Channel interaction patterns match Link Checker: Ctrl/Cmd and Shift selection, group/row drag/drop with persistent order, scoped context menus, and keyboard actions. Preserve whole channel sections on move and parent-specific playlist associations on unlink.
- Channel columns support local per-account width resizing/reset and name/view/delta/checked sorting. Disable manual row reorder while a column sort is active; clearing sort restores server order.
- One group panel header (Groups title, `#btn-new-group`, `#group-search`) serves the rail of the visible workspace; each workspace has its own rail container (`#group-list`, `#channel-group-rail`, `#ytm-group-list`) rendered by `GroupRailUI.mount()` in `group-rail.js`, styled only by `group-rail.css`.
- Group interaction is identical everywhere: click selects immediately (Ctrl/Cmd and Shift extend the selection where the workspace supports multi-select); double-click or F2 renames inline (Enter saves, Esc cancels, blur saves a changed name); `+`/context menu creates inline; trash on hover, Delete key or context menu deletes after the shared `GroupRailUI.confirm` dialog (never `window.confirm`/`prompt`). When the rail is hidden (narrow screens) create/rename fall back to the shared `GroupRailUI.prompt` dialog. Right-click menu: Create Group, Rename Group, Delete Group; rename/delete are disabled on blank space and protected aggregate groups. Spotify and channel rails contain named groups only; YTM retains its All Channels scope. Opening a page selects its first available group before rendering rows; no-group state shows a hint to create a group, not an aggregate list.
- Rail re-renders patch classes/counts in place when the group list itself did not change, so drag & drop and keyboard focus survive background refreshes.
- Narrow screens (≤767px) use one topbar layout for every workspace: title, full-width search, then wrapped buttons; hero KPIs wrap. Hero titles stay on one line (ellipsis) and column labels never wrap (ellipsis + `title`).
- Settings hosts per-account YouTube API keys and admin-only global clipboard settings. Own profile/password remain accessible through the sidebar avatar.
