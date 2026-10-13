/* Shared group rail used by Link Checker, Channel & Playlist and YouTube Link Checker.
 * One markup, one inline editor, one confirm dialog and one set of mouse/keyboard rules:
 * click selects, double-click/F2 renames inline, Delete/trash/context menu deletes after confirmation.
 */
(() => {
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    const MENU_ACTIONS = [
        ['create', 'create_new_folder', 'Create Group'],
        ['rename', 'edit', 'Rename Group'],
        ['delete', 'delete', 'Delete Group']
    ];

    function closeMenu() {
        document.querySelector('.group-rail-context-menu')?.remove();
        document.__groupRailMenuAbort?.abort();
        document.__groupRailMenuAbort = null;
    }

    function showContextMenu(event, key, disabled, run) {
        closeMenu();
        const menu = document.createElement('div');
        menu.className = 'group-rail-context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Group actions');
        menu.innerHTML = MENU_ACTIONS.map(([action, icon, label]) => `
            <button type="button" class="group-rail-context-item${action === 'delete' ? ' is-danger' : ''}"
                role="menuitem" data-group-rail-action="${action}"${disabled[action] ? ' disabled aria-disabled="true"' : ''}>
                <span class="material-icons-round" aria-hidden="true">${icon}</span>
                <span>${label}</span>
            </button>`).join('');
        menu.addEventListener('click', (clickEvent) => {
            const button = clickEvent.target.closest('[data-group-rail-action]');
            if (!button || button.disabled) return;
            closeMenu();
            run(button.dataset.groupRailAction, key);
        });
        document.body.appendChild(menu);
        const padding = 8;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(padding, Math.min(event.clientX, innerWidth - rect.width - padding))}px`;
        menu.style.top = `${Math.max(padding, Math.min(event.clientY, innerHeight - rect.height - padding))}px`;

        const abort = new AbortController();
        document.__groupRailMenuAbort = abort;
        document.addEventListener('pointerdown', (pointerEvent) => {
            if (!menu.contains(pointerEvent.target)) closeMenu();
        }, { capture: true, signal: abort.signal });
        document.addEventListener('keydown', (keyEvent) => {
            if (keyEvent.key === 'Escape') closeMenu();
        }, { signal: abort.signal });
        window.addEventListener('resize', closeMenu, { once: true, signal: abort.signal });
        document.addEventListener('scroll', closeMenu, { capture: true, once: true, signal: abort.signal });
        menu.querySelector('button:not(:disabled)')?.focus();
    }

    /** Promise-based confirm dialog shared by every workspace (replaces window.confirm). */
    function confirmDialog({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true }) {
        return new Promise((resolve) => {
            const previousFocus = document.activeElement;
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay group-rail-confirm open';
            overlay.innerHTML = `
                <div class="modal-content group-rail-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="group-rail-confirm-title" aria-describedby="group-rail-confirm-message">
                    <h2 id="group-rail-confirm-title">${esc(title)}</h2>
                    <p id="group-rail-confirm-message">${esc(message)}</p>
                    <div class="group-rail-confirm-actions">
                        <button type="button" class="btn-ghost" data-confirm="cancel">${esc(cancelLabel)}</button>
                        <button type="button" class="btn-accent${danger ? ' is-danger' : ''}" data-confirm="ok">${esc(confirmLabel)}</button>
                    </div>
                </div>`;
            const finish = (value) => {
                overlay.remove();
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(value);
            };
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) return finish(false);
                const button = event.target.closest('[data-confirm]');
                if (button) finish(button.dataset.confirm === 'ok');
            });
            overlay.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
                if (event.key === 'Tab') {
                    const buttons = [...overlay.querySelectorAll('button')];
                    const index = buttons.indexOf(document.activeElement);
                    event.preventDefault();
                    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
                }
            });
            document.body.appendChild(overlay);
            overlay.querySelector('[data-confirm="ok"]').focus();
        });
    }

    /** Name prompt used when the rail itself is hidden (narrow screens), so create/rename still work. */
    function promptDialog({ title, value = '', confirmLabel = 'Save', cancelLabel = 'Cancel' }) {
        return new Promise((resolve) => {
            const previousFocus = document.activeElement;
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay group-rail-confirm open';
            overlay.innerHTML = `
                <form class="modal-content group-rail-confirm-card" role="dialog" aria-modal="true" aria-labelledby="group-rail-prompt-title">
                    <h2 id="group-rail-prompt-title">${esc(title)}</h2>
                    <input class="group-rail-prompt-input" name="name" type="text" maxlength="128" autocomplete="off" value="${esc(value)}" aria-label="${esc(title)}" required>
                    <div class="group-rail-confirm-actions">
                        <button type="button" class="btn-ghost" data-confirm="cancel">${esc(cancelLabel)}</button>
                        <button type="submit" class="btn-accent">${esc(confirmLabel)}</button>
                    </div>
                </form>`;
            const finish = (result) => {
                overlay.remove();
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(result);
            };
            const input = overlay.querySelector('input');
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay || event.target.closest('[data-confirm="cancel"]')) finish(null);
            });
            overlay.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
            });
            overlay.querySelector('form').addEventListener('submit', (event) => {
                event.preventDefault();
                if (input.value.trim()) finish(input.value.trim());
            });
            document.body.appendChild(overlay);
            input.focus();
            input.select();
        });
    }

    function itemClasses(item) {
        return [
            'group-item',
            item.selected ? 'group-item-selected' : '',
            item.multi ? 'group-item-multi' : '',
            item.className || '',
        ].filter(Boolean).join(' ');
    }

    function countClasses(item) {
        return `group-count${item.countClass ? ` ${item.countClass}` : ''}`;
    }

    /** Everything that needs new DOM nodes; selection/drag/count changes are patched in place instead. */
    function structureOf(rail) {
        return JSON.stringify([
            rail.items.map((item) => [String(item.key), item.label, Boolean(item.protected), item.countId || '']),
            rail.edit ? [rail.edit.mode, rail.edit.key] : null,
        ]);
    }

    function itemHtml(rail, item) {
        const { keyAttr } = rail.adapter;
        const key = String(item.key);
        if (rail.edit?.mode === 'rename' && rail.edit.key === key) return editorHtml(rail.edit, item);
        const classes = itemClasses(item);
        return `<div class="${classes}" role="button" tabindex="0" aria-pressed="${item.selected ? 'true' : 'false'}"
                data-rail-key="${esc(key)}"${keyAttr ? ` ${keyAttr}="${esc(key)}"` : ''}
                draggable="${item.draggable ? 'true' : 'false'}"${item.style ? ` style="${esc(item.style)}"` : ''}>
            <span class="material-icons-round group-rail-icon" aria-hidden="true">folder</span>
            <span class="group-rail-name" title="${esc(item.label)}">${esc(item.label)}</span>
            <span class="${countClasses(item)}"${item.countId ? ` id="${esc(item.countId)}"` : ''}>${esc(item.count ?? '')}</span>
            ${item.protected ? '' : `<button type="button" class="group-rail-delete" data-rail-delete tabindex="-1" aria-label="Delete group ${esc(item.label)}" title="Delete group"><span class="material-icons-round" aria-hidden="true">delete</span></button>`}
        </div>`;
    }

    function editorHtml(edit) {
        const label = edit.mode === 'create' ? 'New group name' : 'Rename group';
        return `<div class="group-item group-rail-editor" data-rail-editor>
            <span class="material-icons-round group-rail-icon" aria-hidden="true">folder</span>
            <input class="group-rail-input" data-rail-input type="text" maxlength="128" autocomplete="off"
                value="${esc(edit.value)}" placeholder="${label}" aria-label="${label}">
            <button type="button" class="group-rail-editor-btn is-save" data-rail-save aria-label="Save" title="Save (Enter)"><span class="material-icons-round" aria-hidden="true">check</span></button>
            <button type="button" class="group-rail-editor-btn" data-rail-cancel aria-label="Cancel" title="Cancel (Esc)"><span class="material-icons-round" aria-hidden="true">close</span></button>
        </div>`;
    }

    function mount(root, adapter) {
        if (!root) return null;
        if (root.__groupRail) return root.__groupRail;
        const rail = {
            root,
            adapter: { keyAttr: '', ...adapter },
            items: [],
            edit: null,
            busy: false,
            rendering: false,
        };
        const find = (key) => rail.items.find((item) => String(item.key) === String(key));
        const isProtected = (key) => !key || find(key)?.protected === true;
        const report = (err) => (rail.adapter.onError || console.error)(err);

        function paint() {
            const input = root.querySelector('[data-rail-input]');
            const caret = input && input === document.activeElement ? [input.selectionStart, input.selectionEnd] : null;
            const focusedKey = root.contains(document.activeElement) ? document.activeElement.dataset?.railKey : null;
            const html = rail.items.map((item) => itemHtml(rail, item)).join('')
                + (rail.edit?.mode === 'create' ? editorHtml(rail.edit) : '')
                + (rail.items.length || rail.edit ? '' : `<p class="group-rail-empty">${esc(rail.adapter.emptyText || 'No groups yet.')}</p>`);
            if (root.__groupRailHtml === html && root.childElementCount) return;
            const structure = structureOf(rail);
            if (root.__groupRailStructure === structure && root.childElementCount) {
                patch();
                root.__groupRailHtml = html;
                return;
            }
            rail.rendering = true;
            root.innerHTML = html;
            root.__groupRailHtml = html;
            root.__groupRailStructure = structure;
            rail.rendering = false;
            if (caret) {
                const next = root.querySelector('[data-rail-input]');
                if (next) { next.focus(); next.setSelectionRange(...caret); }
            } else if (focusedKey) {
                [...root.querySelectorAll('[data-rail-key]')]
                    .find((node) => node.dataset.railKey === focusedKey)
                    ?.focus({ preventScroll: true });
            }
        }

        // Same groups in the same order: update state classes/counts on the live nodes. Replacing the
        // nodes would cancel an in-progress HTML5 drag and lose keyboard focus.
        function patch() {
            const nodes = root.querySelectorAll('[data-rail-key]');
            rail.items.forEach((item) => {
                const node = [...nodes].find((candidate) => candidate.dataset.railKey === String(item.key));
                if (!node) return;
                const classes = itemClasses(item);
                if (node.className !== classes) node.className = classes;
                node.setAttribute('aria-pressed', item.selected ? 'true' : 'false');
                node.setAttribute('draggable', item.draggable ? 'true' : 'false');
                if ((node.getAttribute('style') || '') !== (item.style || '')) {
                    if (item.style) node.setAttribute('style', item.style); else node.removeAttribute('style');
                }
                const count = node.querySelector('.group-count');
                if (count) {
                    const text = String(item.count ?? '');
                    if (count.textContent !== text) count.textContent = text;
                    const countClass = countClasses(item);
                    if (count.className !== countClass) count.className = countClass;
                }
            });
        }

        function focusEditor(select = true) {
            const input = root.querySelector('[data-rail-input]');
            if (!input) return;
            input.focus();
            if (select) input.select();
            input.scrollIntoView({ block: 'nearest' });
        }

        const isRailVisible = () => root.getClientRects().length > 0;
        async function promptEdit(title, confirmLabel) {
            const edit = rail.edit;
            const value = await promptDialog({ title, value: edit.value, confirmLabel });
            if (rail.edit !== edit) return;
            if (value == null) { rail.edit = null; return; }
            edit.value = value;
            await api.commit();
            if (rail.edit === edit) rail.edit = null;
        }

        const api = {
            render(items) {
                rail.items = Array.isArray(items) ? items : [];
                if (rail.edit?.mode === 'rename' && !find(rail.edit.key)) rail.edit = null;
                paint();
            },
            refresh: paint,
            get editing() { return Boolean(rail.edit); },
            startCreate() {
                if (rail.busy) return;
                rail.edit = { mode: 'create', key: '', original: '', value: '' };
                if (!isRailVisible()) return promptEdit('Create Group', 'Create');
                paint();
                focusEditor();
            },
            startRename(key) {
                const item = find(key);
                if (!item || item.protected || rail.busy) return;
                rail.edit = { mode: 'rename', key: String(key), original: item.label, value: item.label };
                if (!isRailVisible()) return promptEdit('Rename Group', 'Save');
                paint();
                focusEditor();
            },
            cancelEdit() {
                if (!rail.edit || rail.busy) return;
                rail.edit = null;
                paint();
            },
            async commit() {
                const edit = rail.edit;
                if (!edit || rail.busy) return;
                const name = edit.value.trim();
                if (!name || (edit.mode === 'rename' && name === edit.original)) return api.cancelEdit();
                rail.busy = true;
                root.querySelector('[data-rail-input]')?.setAttribute('disabled', '');
                try {
                    const result = edit.mode === 'create'
                        ? await rail.adapter.onCreate(name)
                        : await rail.adapter.onRename(edit.key, name);
                    if (result === false) return;
                    if (rail.edit === edit) rail.edit = null;
                } catch (err) {
                    report(err);
                } finally {
                    rail.busy = false;
                    paint();
                    if (rail.edit) focusEditor(false);
                }
            },
            async requestDelete(key) {
                if (isProtected(key) || rail.busy) return;
                const keys = (rail.adapter.deleteTargets?.(String(key)) || [String(key)])
                    .map(String)
                    .filter((value) => !isProtected(value));
                if (!keys.length) return;
                const subject = keys.length > 1
                    ? `${keys.length} selected groups`
                    : `group "${find(keys[0])?.label || keys[0]}"`;
                const ok = await confirmDialog({
                    title: 'Delete Group',
                    message: `Delete ${subject}? ${rail.adapter.deleteNote || ''}`.trim(),
                    confirmLabel: 'Delete Group',
                });
                if (!ok) return;
                try {
                    await rail.adapter.onDelete(keys);
                } catch (err) {
                    report(err);
                }
            },
        };
        root.__groupRail = api;

        root.addEventListener('click', (event) => {
            if (event.target.closest('[data-rail-save]')) { api.commit(); return; }
            if (event.target.closest('[data-rail-cancel]')) { api.cancelEdit(); return; }
            if (event.target.closest('[data-rail-editor]')) return;
            const del = event.target.closest('[data-rail-delete]');
            const item = event.target.closest('[data-rail-key]');
            if (del && item) {
                event.preventDefault();
                event.stopPropagation();
                api.requestDelete(item.dataset.railKey);
                return;
            }
            if (!item) { rail.adapter.onBlankClick?.(event); return; }
            if (event.detail > 1) return; // second click of a double-click: dblclick handles it
            rail.adapter.onSelect(item.dataset.railKey, event);
        });

        root.addEventListener('dblclick', (event) => {
            if (event.target.closest('[data-rail-delete], [data-rail-editor]')) return;
            const item = event.target.closest('[data-rail-key]');
            if (!item) return;
            event.preventDefault();
            api.startRename(item.dataset.railKey);
        });

        root.addEventListener('input', (event) => {
            if (event.target.matches('[data-rail-input]') && rail.edit) rail.edit.value = event.target.value;
        });

        root.addEventListener('keydown', (event) => {
            if (event.target.matches('[data-rail-input]')) {
                if (event.key === 'Enter') { event.preventDefault(); api.commit(); }
                else if (event.key === 'Escape') { event.preventDefault(); api.cancelEdit(); }
                event.stopPropagation();
                return;
            }
            const item = event.target.closest('[data-rail-key]');
            if (!item || event.target !== item) return;
            const key = item.dataset.railKey;
            let handled = true;
            if (event.key === 'Enter' || event.key === ' ') rail.adapter.onSelect(key, event);
            else if (event.key === 'F2') api.startRename(key);
            else if (event.key === 'Delete') api.requestDelete(key);
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const items = [...root.querySelectorAll('[data-rail-key]')];
                items[items.indexOf(item) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
            } else handled = false;
            if (handled) { event.preventDefault(); event.stopPropagation(); }
        });

        root.addEventListener('focusout', (event) => {
            if (rail.rendering || rail.busy || !event.target.matches('[data-rail-input]')) return;
            if (event.relatedTarget?.closest?.('[data-rail-editor]')) return;
            if (rail.edit?.value.trim()) api.commit(); else api.cancelEdit();
        });

        root.addEventListener('contextmenu', (event) => {
            if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
            const item = event.target.closest('[data-rail-key]');
            const key = item?.dataset.railKey || '';
            event.preventDefault();
            event.stopPropagation();
            if (key) rail.adapter.onContextOpen?.(key);
            const locked = isProtected(key);
            showContextMenu(event, key, { create: false, rename: locked, delete: locked }, (action, target) => {
                if (action === 'create') api.startCreate();
                else if (action === 'rename') api.startRename(target);
                else if (action === 'delete') api.requestDelete(target);
            });
        });

        return api;
    }

    window.GroupRailUI = { mount, confirm: confirmDialog, prompt: promptDialog, closeContextMenu: closeMenu, escape: esc };
})();
