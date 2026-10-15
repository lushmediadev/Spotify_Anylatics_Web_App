/* Owner filter shared by YouTube Checker, Channel & Playlist and Spotify Checker.
 * Admins pick any account, managers pick themselves or one of their users; the choice applies to
 * every workspace. Plain users never see it. Rendered into #manager-filter-wrap in the group panel.
 */
(function () {
    'use strict';

    const state = { host: null, owners: [], selfId: '', value: '', open: false, query: '', listeners: new Set() };
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
    const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' };

    function idOf(user) { return String(user?.id || user?._id || ''); }
    function nameOf(user) { return user?.display_name || user?.username || 'User'; }
    function managerOf(user) {
        const managerId = String(user?.manager_id || '');
        return managerId ? state.owners.find(owner => idOf(owner) === managerId) : null;
    }
    /* "User (manager)" — the same label rows use through ownerLabel(name, managerName). */
    function ownerLabel(name, managerName) {
        return managerName ? `${name} (${managerName})` : String(name || '');
    }
    function labelOf(user) {
        const manager = managerOf(user);
        return ownerLabel(nameOf(user), manager ? nameOf(manager) : '');
    }
    function selected() { return state.owners.find(owner => idOf(owner) === state.value) || null; }
    function enabled() { return state.owners.length > 1; }

    function render() {
        const host = state.host;
        if (!host) return;
        host.hidden = !enabled();
        if (host.hidden) { host.innerHTML = ''; return; }
        const current = selected();
        const query = state.query.trim().toLocaleLowerCase();
        const options = state.owners.filter(owner => !query
            || `${labelOf(owner)} ${owner.username || ''} ${ROLE_LABELS[owner.role] || ''}`.toLocaleLowerCase().includes(query));
        host.innerHTML = `<div class="owner-filter${state.open ? ' is-open' : ''}" data-owner-filter>
            <button type="button" class="owner-filter-trigger" data-owner-trigger aria-haspopup="listbox" aria-expanded="${state.open}" title="View the workspace of another account">
                <span class="material-icons-round" aria-hidden="true">person</span>
                <span class="owner-filter-label">${escapeHtml(current ? labelOf(current) : 'Choose owner')}</span>
                ${current && idOf(current) !== state.selfId ? '<span class="owner-filter-badge">Viewing</span>' : ''}
                <span class="material-icons-round owner-filter-chevron" aria-hidden="true">expand_more</span>
            </button>
            <div class="owner-filter-menu" data-owner-menu${state.open ? '' : ' hidden'}>
                <label class="owner-filter-search-wrap"><span class="material-icons-round" aria-hidden="true">search</span>
                    <input type="search" class="owner-filter-search" data-owner-search placeholder="Search user..." aria-label="Search user" autocomplete="off" value="${escapeHtml(state.query)}"></label>
                <div class="owner-filter-options" role="listbox" aria-label="Owners">${options.map(owner => `<button type="button" role="option" class="owner-filter-option${idOf(owner) === state.value ? ' is-selected' : ''}" aria-selected="${idOf(owner) === state.value}" data-owner-option="${escapeHtml(idOf(owner))}">
                    <span class="owner-filter-option-name">${escapeHtml(labelOf(owner))}${idOf(owner) === state.selfId ? ' <em>(you)</em>' : ''}</span>
                    <span class="owner-filter-role">${escapeHtml(ROLE_LABELS[owner.role] || '')}</span>
                </button>`).join('') || '<p class="owner-filter-empty">No matching user</p>'}</div>
            </div>
        </div>`;
    }

    function setOpen(open) {
        if (state.open === open) return;
        state.open = open;
        if (!open) state.query = '';
        render();
        if (open) state.host?.querySelector('[data-owner-search]')?.focus();
    }

    function select(id) {
        const next = String(id || state.selfId);
        setOpen(false);
        if (next === state.value) return;
        state.value = next;
        render();
        state.listeners.forEach(listener => { try { listener(next); } catch (error) { console.warn(error); } });
    }

    function mount(host) {
        if (!host || state.host === host) return api;
        state.host = host;
        host.classList.add('owner-filter-wrap');
        host.addEventListener('click', event => {
            const option = event.target.closest('[data-owner-option]');
            if (option) { select(option.dataset.ownerOption); return; }
            if (event.target.closest('[data-owner-trigger]')) setOpen(!state.open);
        });
        host.addEventListener('input', event => {
            if (!event.target.matches('[data-owner-search]')) return;
            state.query = event.target.value;
            const caret = event.target.selectionStart;
            render();
            const input = host.querySelector('[data-owner-search]');
            input?.focus();
            input?.setSelectionRange(caret, caret);
        });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.open) { event.stopPropagation(); setOpen(false); host.querySelector('[data-owner-trigger]')?.focus(); }
            if (event.key === 'Enter' && event.target.matches('[data-owner-search]')) {
                event.preventDefault();
                const first = host.querySelector('[data-owner-option]');
                if (first) select(first.dataset.ownerOption);
            }
        });
        document.addEventListener('pointerdown', event => { if (state.open && !host.contains(event.target)) setOpen(false); });
        render();
        return api;
    }

    /* users: the /auth/users list (already scoped by the backend); selfId: the signed-in account. */
    function setOwners(users, selfId) {
        const self = String(selfId || '');
        const accountChanged = self !== state.selfId;
        state.selfId = self;
        const rank = owner => (idOf(owner) === self ? 0 : 1);
        state.owners = (Array.isArray(users) ? users : []).filter(idOf)
            .sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b), 'vi', { sensitivity: 'base' }));
        if (accountChanged || !state.owners.some(owner => idOf(owner) === state.value)) {
            const before = state.value;
            state.value = self;
            render();
            if (before && before !== self) state.listeners.forEach(listener => { try { listener(self); } catch (error) { console.warn(error); } });
            return;
        }
        render();
    }

    function reset(selfId) { setOwners([], selfId); }
    /* The account whose data the workspaces show; the signed-in account by default. */
    function value() { return state.value || state.selfId; }
    function isSelf() { return value() === state.selfId; }
    function onChange(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); }

    const api = { mount, setOwners, reset, value, isSelf, onChange, select, ownerLabel };
    window.OwnerFilterUI = api;
}());
