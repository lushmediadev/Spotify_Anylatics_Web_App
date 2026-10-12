(() => {
    const MENU_ACTIONS = [
        ['create', 'create_new_folder', 'Tạo nhóm'],
        ['rename', 'edit', 'Đổi tên nhóm'],
        ['delete', 'delete', 'Xóa nhóm']
    ];

    function closeMenu() {
        document.querySelector('.group-rail-context-menu')?.remove();
        document.__groupRailMenuAbort?.abort();
        document.__groupRailMenuAbort = null;
    }

    function showContextMenu(event, groupName, disabled, callbacks) {
        closeMenu();
        const menu = document.createElement('div');
        menu.className = 'group-rail-context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Group actions');
        menu.innerHTML = MENU_ACTIONS.map(([action, icon, label]) => `
            <button type="button" class="group-rail-context-item${action === 'delete' ? ' is-danger' : ''}"
                role="menuitem" data-group-rail-action="${action}"${disabled[action] ? ' disabled aria-disabled="true"' : ''}>
                <span class="material-symbols-rounded" aria-hidden="true">${icon}</span>
                <span>${label}</span>
            </button>`).join('');
        menu.addEventListener('click', (clickEvent) => {
            const button = clickEvent.target.closest('[data-group-rail-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.groupRailAction;
            closeMenu();
            const callbackName = { create: 'onCreate', rename: 'onRename', delete: 'onDelete' }[action];
            callbacks[callbackName]?.(groupName);
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

    function bindContextMenu(root, options) {
        if (!root || root.dataset.groupRailContextBound === 'true') return;
        root.dataset.groupRailContextBound = 'true';
        root.addEventListener('contextmenu', (event) => {
            if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
            const groupElement = event.target.closest(options.groupSelector);
            if (!groupElement && options.blankArea === false) return;
            const groupName = groupElement ? options.getGroupName(groupElement) : '';
            const protectedGroup = !groupName || options.isProtectedGroup?.(groupName, groupElement) === true;
            event.preventDefault();
            event.stopPropagation();
            options.onOpenGroup?.(groupName, groupElement);
            showContextMenu(event, groupName, {
                create: false,
                rename: protectedGroup,
                delete: protectedGroup
            }, options);
        });
    }

    window.GroupRailUI = { bindContextMenu, closeContextMenu: closeMenu };
})();
