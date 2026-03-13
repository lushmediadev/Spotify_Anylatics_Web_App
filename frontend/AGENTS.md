# Frontend Rules (Overrides Root)

## Scope

Applies only to `frontend/`.

## Differences from root

- No framework build step; edit static files directly (`index.html`, `style.css`, `app.js`).
- Keep DOM IDs, `data-*` attributes, and CSS variable names stable unless required by ticket.
- Selection, context-menu, clipboard, and export UX logic lives in `app.js`; prefer extending existing handlers over adding parallel flows.
- For regression checks, manually verify keyboard shortcuts, right-click menus, drag-drop, and clipboard/export behavior in browser.
