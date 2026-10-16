(function () {
    'use strict';

    const PAGE_SIZE = 100;
    const state = {
        request: null, getUser: () => null, onItemChanged: null, host: null,
        visible: false, userId: '', group: '', search: '', filter: 'all', offset: 0,
        items: [], groups: [], total: 0, collapsed: new Set(), generation: 0,
        controller: null, timer: null, debounce: null, modal: null, menu: null,
        loading: false, pendingRender: false, settingsGeneration: 0, rail: null, hasKeys: true, bulkBusy: false,
        tools: null, groupSearch: '', groupItems: [], selected: new Set(), onGroupChanged: null,
        formatChecked: null, formatUpdatedAt: null, renderUserCell: null, renderPlaylistOwnerCell: null,
        preferences: { group_order: [], channel_orders: {}, playlist_orders: {} }, preferencesLoaded: false,
        preferenceQueue: Promise.resolve(), writePending: 0, scope: 0, drag: null, scrollFrame: null,
        groupSelected: new Set(), playlistSelected: new Set(), focusKind: 'channels', anchors: {}, cut: null,
        runPlaylistAction: null, copyLinks: null, previewImage: null, exportChannels: null, sort: null,
        widths: null, resize: null, actorId: '', getOwner: null
    };
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
    const number = value => value == null ? '-' : new Intl.NumberFormat('vi-VN').format(value);
    const date = value => {
        if (!value) return '-';
        const input = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
            && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value + 'Z' : value;
        const parsed = new Date(input);
        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    };
    const NO_SYSTEM_KEY = 'No system API key configured — contact an admin.';
    const isAdmin = () => state.getUser()?.role === 'admin';
    // state.userId is the workspace owner being shown; state.actorId the signed-in account.
    const sameActor = () => state.actorId === String(state.getUser()?.id || '');
    const scoped = path => state.userId ? `${path}${path.includes('?') ? '&' : '?'}user_id=${encodeURIComponent(state.userId)}` : path;
    function safeUrl(value) {
        try {
            const url = new URL(value);
            return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : '';
        } catch (_) { return ''; }
    }
    function link(value, title) {
        const url = safeUrl(value);
        return url ? `<a class="list-title-link" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title);
    }
    function image(value) {
        const url = safeUrl(value);
        return url ? `<img class="list-cover-image" src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="list-cover-image chp-cover-empty" aria-hidden="true"></span>';
    }
    function playlistTitle(item) {
        const title = item.name || 'Unknown';
        const owner = (item.owner_name || item.artist_names?.[0] || '').trim();
        return owner && !title.toLowerCase().startsWith(`${owner.toLowerCase()} - `) ? `${owner} - ${title}` : title;
    }
    function errorText(error) {
        return typeof error?.message === 'string' ? error.message : 'The request could not be completed. Please try again.';
    }
    function api(path, method = 'GET', body, signal) {
        if (!state.request) return Promise.reject(new Error('ChannelPlaylists.init() has not been called.'));
        const options = { method };
        if (body !== undefined) options.body = JSON.stringify(body);
        if (signal) options.signal = signal;
        return Promise.resolve().then(() => state.request(path, options));
    }
    function query(offset = 0, unfiltered = false) {
        const params = new URLSearchParams({ filter: unfiltered ? 'all' : state.filter, limit: String(PAGE_SIZE), offset: String(offset) });
        if (state.userId) params.set('user_id', state.userId);
        if (state.group) params.set('group', state.group);
        if (state.search && !unfiltered) params.set('search', state.search);
        return `/youtube/channels?${params}`;
    }
    function message(text, isError = false) {
        const node = state.host?.querySelector('.chp-status');
        if (node) { node.textContent = text; node.classList.toggle('chp-error', isError); }
    }
    function mount() {
        const host = document.getElementById('channels-panel');
        if (!host) throw new Error('Missing #channels-panel.');
        if (state.host === host && host.querySelector('.playlist-hero')) return;
        state.host = host;
        host.classList.add('chp-root');
        state.tools = document.getElementById('channel-header-tools');
        if (!state.tools) throw new Error('Missing #channel-header-tools in .topbar.');
        state.tools.classList.add('chp-header-tools', 'flex', 'items-center', 'gap-4');
        state.tools.innerHTML = `<div class="relative group"><span class="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-secondary-text text-xl">search</span><input class="chp-search search-pill bg-row-hover border-none rounded-full pl-10 pr-4 py-2 text-sm w-64 focus:ring-1 focus:ring-primary placeholder:text-secondary-text transition-all" type="search" placeholder="Search channels..." aria-label="Search channels"></div>
            <button type="button" class="btn-ghost flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 hover:border-white transition-colors text-sm font-bold cursor-pointer" data-chp-action="refresh-all"><span class="material-icons-round text-lg">refresh</span>Refresh All</button>
            <button type="button" class="btn-accent flex items-center gap-2 px-6 py-2 rounded-full bg-primary hover:bg-primary/90 text-white transition-all text-sm font-bold cursor-pointer" data-chp-action="add"><span class="material-icons-round text-lg">add</span>Add Channel</button>
            <label class="chp-mobile-groups">Group <select class="chp-groups" aria-label="Channel groups"></select></label><button type="button" class="chp-new-group-toolbar group-rail-add-btn" data-chp-action="new-group" aria-label="New group" title="New group"><span class="material-icons-round" aria-hidden="true">add</span></button>`;
        state.tools.addEventListener('click', panelClick);
        host.innerHTML = `<section class="playlist-hero px-5 py-8 mb-0"><div class="flex items-end justify-between gap-6"><div><p class="text-[11px] uppercase tracking-[0.16em] text-secondary-text font-bold">Live Monitoring</p><h2 class="text-[30px] leading-none font-bold mt-2">Channel &amp; Playlist</h2><p class="text-sm text-secondary-text mt-2">Track YouTube channels and their linked Spotify playlists.</p></div><div class="chp-kpis flex items-center gap-4 text-xs">${['Channels', 'Active', 'Errors', 'Crawling', 'Selected'].map(key => `<span class="hero-kpi"><b data-chp-kpi="${key}">0</b><em>${key}</em></span>`).join('')}</div></div></section>
            <div class="chp-key-warning" hidden></div><div class="chp-status" role="status" aria-live="polite"></div><div class="chp-list" aria-label="Channel list"></div>
            <footer class="chp-footer"><span class="chp-footer-stats"><span><b>Channels:</b> <span data-chp-footer="channels">0</span></span><span><b>Playlists:</b> <span data-chp-footer="playlists">0</span></span></span>
                <span><b>Selected:</b> <span data-chp-footer="selected">0</span></span>
                <span class="footer-selection-actions" data-chp-selection-actions hidden>
                    <button type="button" class="footer-selection-btn" data-chp-action="clear-selection" title="Clear selection" aria-label="Clear selection"><span class="material-icons-round" aria-hidden="true">close</span></button>
                    <button type="button" class="footer-selection-btn is-danger" data-chp-action="delete-selection" title="Delete selected rows" aria-label="Delete selected rows"><span class="material-icons-round" aria-hidden="true">delete</span></button>
                </span></footer>`;
        host.addEventListener('click', panelClick);
        host.addEventListener('contextmenu', event => {
            const playlist = event.target.closest('[data-chp-playlist]');
            if (playlist) { event.preventDefault(); openPlaylistMenu(playlist, event.clientX, event.clientY); return; }
            const row = event.target.closest('[data-chp-channel]');
            if (!row) { event.preventDefault(); actionMenu([['add', 'Add Channel'], ['clear', 'Clear Group']], event.clientX, event.clientY, action => action === 'add' ? openAdd() : clearGroup()); return; }
            event.preventDefault();
            openMenu(row.dataset.chpChannel, event.clientX, event.clientY);
        });
        host.addEventListener('keydown', event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            const playlist = event.target.closest('[data-chp-playlist]');
            if (playlist) { event.preventDefault(); const rect = playlist.getBoundingClientRect(); openPlaylistMenu(playlist, rect.left + 40, rect.bottom); return; }
            const row = event.target.closest('[data-chp-channel]');
            if (!row) return;
            event.preventDefault();
            const rect = row.getBoundingClientRect();
            openMenu(row.dataset.chpChannel, rect.left + 40, rect.bottom);
        });
        state.tools.querySelector('.chp-search').addEventListener('input', event => {
            state.search = event.target.value.trim();
            invalidate();
            clearTimeout(state.debounce);
            state.debounce = setTimeout(() => changeScope(false), 300);
        });
        state.tools.querySelector('.chp-groups').addEventListener('change', event => { state.group = event.target.value; changeScope(); });
        host.addEventListener('click', event => {
            if (event.target.matches('.list-cover-image') && state.previewImage && event.target.src) { state.previewImage(event.target.src); return; }
            const check = event.target.closest('[data-row-check]');
            if (check) {
                // Checkbox = Ctrl/Cmd-click toggle; Shift extends the range.
                const toggle = { ctrlKey: !event.shiftKey, shiftKey: event.shiftKey };
                const playlistRow = check.closest('[data-chp-playlist]');
                if (playlistRow) selectRows('playlist', playlistRow.dataset.chpPlaylist, toggle);
                else selectChannel(check.closest('[data-chp-channel]')?.dataset.chpChannel, toggle);
                return;
            }
            const noteEdit = event.target.closest('[data-chp-note-edit]');
            if (noteEdit) { startNoteEdit(noteEdit.closest('[data-chp-note]')); return; }
            if (event.target.closest('a, button, input, select, textarea')) return;
            const playlist = event.target.closest('[data-chp-playlist]');
            if (playlist) { selectRows('playlist', playlist.dataset.chpPlaylist, event); playlist.focus(); return; }
            const row = event.target.closest('[data-chp-channel]');
            if (row) { selectChannel(row.dataset.chpChannel, event); row.focus(); }
        });
        host.addEventListener('keydown', event => {
            if (event.target.matches('[data-chp-channel]') && [' ', 'Enter'].includes(event.key)) {
                event.preventDefault(); selectChannel(event.target.dataset.chpChannel, event);
            }
        });
        host.addEventListener('focusout', () => setTimeout(flushRender, 0));
        host.addEventListener('dblclick', event => {
            if (event.button !== 0 || state.modal || state.drag || state.resize
                || event.target.closest('a, button, input, select, textarea, img, [data-chp-resize]')) return;
            // Notes are edited with the pencil button; a double-click on them does nothing.
            if (event.target.closest('[data-chp-note]')) return;
            const row = event.target.closest('[data-chp-channel]');
            if (!row) return;
            event.preventDefault();
            setPlaylistCollapsed(row.dataset.chpChannel, !state.collapsed.has(row.dataset.chpChannel));
        });
        host.addEventListener('pointerdown', startResize);
        host.addEventListener('dblclick', event => {
            if (!event.target.closest('[data-chp-resize]')) return;
            event.preventDefault(); event.stopImmediatePropagation(); state.widths = null; applyWidths(); saveWidths();
        });
        bindDrag(host);
    }
    function selectChannel(id, event = {}) { selectRows('channels', id, event); }
    function visibleIds(kind) {
        if (kind === 'groups') return state.groups.filter(group => group.name.toLocaleLowerCase().includes(state.groupSearch.toLocaleLowerCase())).map(group => group.name);
        if (kind === 'playlist') return state.items.filter(item => !state.collapsed.has(item.id)).flatMap(item => (item.playlists || []).map(playlist => playlistKey(item.id, playlist.id)));
        return state.items.map(item => item.id);
    }
    const playlistKey = (parent, id) => `${parent}:${id}`;
    function selection(kind) { return kind === 'groups' ? state.groupSelected : kind === 'playlist' ? state.playlistSelected : state.selected; }
    function selectRows(kind, id, event = {}) {
        const selected = selection(kind), ids = visibleIds(kind);
        if (!ids.includes(id)) return;
        state.focusKind = kind;
        if (event.shiftKey && ids.includes(state.anchors[kind])) {
            if (!event.ctrlKey && !event.metaKey) selected.clear();
            const a = ids.indexOf(state.anchors[kind]), b = ids.indexOf(id);
            ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(value => selected.add(value));
        } else {
            if (!event.ctrlKey && !event.metaKey) selected.clear();
            if ((event.ctrlKey || event.metaKey) && selected.has(id)) selected.delete(id); else selected.add(id);
            state.anchors[kind] = id;
        }
        paintSelection();
    }
    function paintSelection() {
        if (!state.host) return;
        const paint = (row, selected) => {
            row.classList.toggle('row-selected', selected); row.setAttribute('aria-selected', String(selected));
            const check = row.querySelector(':scope > .list-asset-cell > [data-row-check]');
            if (check) check.checked = selected;
        };
        for (const row of state.host.querySelectorAll('[data-chp-channel]')) paint(row, state.selected.has(row.dataset.chpChannel));
        for (const row of state.host.querySelectorAll('[data-chp-playlist]')) paint(row, state.playlistSelected.has(row.dataset.chpPlaylist));
        renderRail();
        updateHero();
    }
    function toCssImageUrl(value) {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol)) return '';
            if (url.hostname === 'yt3.googleusercontent.com' && !url.href.includes('=w') && !url.href.includes('-fcrop64=')) {
                url.href += '=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj';
            }
            return `url("${url.href.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
        } catch (_) { return ''; }
    }
    function updateHero() {
        const hero = state.host.querySelector('.playlist-hero');
        const banner = toCssImageUrl(state.items[0]?.banner);
        if (banner) hero.style.setProperty('--hero-image', banner); else hero.style.removeProperty('--hero-image');
        const rows = state.groupItems;
        const counts = { Channels: rows.length, Active: rows.filter(item => item.status === 'active').length,
            Errors: rows.filter(item => item.status === 'error').length, Crawling: rows.filter(item => item.status === 'crawling').length,
            Selected: state.selected.size };
        for (const [key, value] of Object.entries(counts)) hero.querySelector(`[data-chp-kpi="${key}"]`).textContent = number(value);
        const selected = state.selected.size + state.playlistSelected.size;
        const footer = { channels: rows.length, playlists: state.items.reduce((sum, item) => sum + (item.playlists || []).length, 0), selected };
        for (const [key, value] of Object.entries(footer)) { const node = state.host.querySelector(`[data-chp-footer="${key}"]`); if (node) node.textContent = number(value); }
        const actions = state.host.querySelector('[data-chp-selection-actions]');
        if (actions) actions.hidden = !selected;
    }
    function notifyGroup() {
        if (!state.visible) return;
        if (state.onGroupChanged) state.onGroupChanged(state.group);
        else for (const id of ['page-title', 'breadcrumb-group']) {
            const node = document.getElementById(id);
            if (node) node.textContent = state.group || 'Channel & Playlist';
        }
    }
    function checked(item) {
        const error = item.error_message || item.error;
        const settings = item.error_code === 'no_api_keys' && isAdmin() ? '<button type="button" data-chp-action="settings">Open Settings to add a key</button>' : '';
        const status = item.status === 'error' || error ? 'error' : ['active', 'crawling', 'pending'].includes(item.status) ? item.status : 'pending';
        const checkedAt = item.last_checked || item.created_at;
        const labels = { active: 'Active', error: `Error (${item.error_code || '?'})`, pending: 'Pending', crawling: 'Crawling...' };
        const colors = { active: 'text-primary', error: 'text-red-500', pending: 'text-yellow-500', crawling: 'text-blue-400' };
        return `<div class="checked-stack"><span class="list-checked-text text-secondary-text" title="${escapeHtml(date(checkedAt))}">${escapeHtml(state.formatChecked ? state.formatChecked(checkedAt) : date(checkedAt))}</span><span class="checked-status ${colors[status]}"><span class="status-dot status-indicator ${status}"></span><span>${escapeHtml(labels[status])}</span></span>${error ? `<span class="list-asset-error chp-error">${escapeHtml(error)}</span>` : ''}${settings}</div>`;
    }
    function playlistRow(item, index, parent) {
        const key = playlistKey(parent, item.id);
        return `<div data-chp-playlist="${escapeHtml(key)}" data-chp-parent="${escapeHtml(parent)}" data-chp-item="${escapeHtml(item.id)}" draggable="true" tabindex="0" aria-selected="${state.playlistSelected.has(key)}" class="custom-grid-row chp-playlist-grid px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group ${state.playlistSelected.has(key) ? 'row-selected' : ''}">
            <div class="meta-cell stt-cell text-secondary-text">${index + 1}</div>
            <div class="list-asset-cell flex items-center gap-4"><input type="checkbox" class="row-check" data-row-check="" tabindex="-1" aria-label="Select row"${state.playlistSelected.has(key) ? ' checked=""' : ''}>${image(item.image)}<div><span class="list-type-badge badge-playlist">playlist</span><h3 class="list-asset-title">${link(item.spotify_url || `https://open.spotify.com/playlist/${encodeURIComponent(item.spotify_id || '')}`, playlistTitle(item))}</h3><div class="list-asset-meta"><p class="list-asset-uri text-secondary-text">spotify:playlist:${escapeHtml(item.spotify_id || '')}</p></div></div></div>
            ${state.renderPlaylistOwnerCell ? state.renderPlaylistOwnerCell(item) : `<div class="meta-cell playlist-owner-cell">${link(item.owner_url, item.owner_name || '-')}</div>`}
            <div class="meta-cell chp-numeric"><div class="metric-stack"><span class="metric-main">${number(item.saves ?? item.followers)}</span>${metricDelta(item.followers_delta, item.delta_days)}</div></div><div class="meta-cell chp-numeric"><div class="metric-stack"><span class="metric-main">${number(item.track_count)}</span>${metricDelta(item.track_count_delta, item.delta_days)}</div></div>${noteCell(item)}<div class="meta-cell text-right">${checked(item)}</div></div>`;
    }
    function metricDelta(value, days) {
        if (value == null) return '';
        const label = `${value > 0 ? '+' : ''}${number(value)}${days == null ? '' : ` in ${number(days)} ${days === 1 ? 'day' : 'days'}`}`;
        return `<span title="${escapeHtml(label)}" class="chp-delta metric-delta ${value > 0 ? 'metric-delta-up' : value < 0 ? 'metric-delta-down' : 'metric-delta-flat'}"><span class="material-icons-round">${value > 0 ? 'north' : value < 0 ? 'south' : 'remove'}</span><span>${value > 0 ? '+' : ''}${number(value)}${days == null ? '' : `/${number(days)}`}</span></span>`;
    }
    const canEdit = channel => String(channel.user_id) === state.userId && sameActor();
    function linkTarget(channelId, itemId) {
        const channel = state.items.find(row => row.id === channelId);
        const item = itemId ? (channel?.playlists || []).find(row => row.id === itemId) : null;
        if (!channel || !canEdit(channel) || (itemId && !item)) return null;
        return { channel, item, row: item || channel, path: `/youtube/channels/${encodeURIComponent(channel.id)}${item ? `/playlists/${encodeURIComponent(item.id)}` : ''}` };
    }
    function noteCell(row) {
        // Escape exactly like innerHTML serializes, so an unchanged note never forces a list re-render.
        const text = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const note = String(row.note || '').replace(/\r\n?/g, '\n');
        const edited = note && row.note_updated_at ? `\n\nLast edited ${date(row.note_updated_at)}${row.note_updated_by_name ? ` · ${row.note_updated_by_name}` : ''}` : '';
        return `<div class="meta-cell chp-note-cell" data-chp-note=""${note ? ` title="${text(note + edited).replace(/"/g, '&quot;')}"` : ''}><span class="chp-note-text">${text(note)}</span><button type="button" class="chp-note-edit-btn" data-chp-note-edit="" aria-label="Edit note" title="Edit note"><span class="material-icons-round" aria-hidden="true">edit</span></button></div>`;
    }
    function applyNote(target, data) {
        // Polling may have replaced the row objects while the editor was open, so update by id.
        const fresh = target.item ? (data?.playlists || []).find(row => row.id === target.item.id) : data;
        if (!fresh) return;
        for (const list of [state.items, state.groupItems]) {
            const channel = list.find(row => row.id === target.channel.id);
            const row = target.item ? (channel?.playlists || []).find(item => item.id === target.item.id) : channel;
            if (row) Object.assign(row, { note: fresh.note, note_updated_at: fresh.note_updated_at, note_updated_by_name: fresh.note_updated_by_name });
        }
    }
    function startNoteEdit(cell) {
        const playlist = cell.closest('[data-chp-playlist]');
        const target = linkTarget(playlist ? playlist.dataset.chpParent : cell.closest('[data-chp-channel]')?.dataset.chpChannel, playlist?.dataset.chpItem);
        if (!target || cell.querySelector('textarea')) return;
        const row = cell.closest('[draggable]'), input = document.createElement('textarea'), scope = state.scope, before = target.row.note || '';
        input.className = 'chp-note-input'; input.maxLength = 1000; input.rows = 2; input.value = before; input.setAttribute('aria-label', 'Note');
        // A draggable row would swallow text selection inside the editor.
        row.draggable = false; cell.removeAttribute('title'); cell.replaceChildren(input); input.focus(); input.select();
        let done = false;
        const finish = async (save, refocus) => {
            if (done) return;
            done = true; input.readOnly = true;
            const note = input.value.trim();
            try {
                if (save && note !== before && scope === state.scope) applyNote(target, await api(target.path, 'PATCH', { note }));
            } catch (error) { if (scope === state.scope) message(errorText(error), true); }
            if (scope !== state.scope) return;
            if (!cell.isConnected) { redrawOrder(); return; }
            cell.outerHTML = noteCell(linkTarget(target.channel.id, target.item?.id)?.row || target.row);
            row.draggable = true;
            if (refocus) row.focus({ preventScroll: true });
        };
        input.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); finish(false, true); }
            else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); finish(true, true); }
        });
        input.addEventListener('blur', () => finish(true, false));
    }
    function channelRow(item, index) {
        const collapsed = state.collapsed.has(item.id);
        const url = item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${encodeURIComponent(item.youtube_id)}` : item.query);
        return `<section data-chp-block="${escapeHtml(item.id)}"><div class="list-grid"><div class="custom-grid-row chp-grid chp-channel px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group ${state.selected.has(item.id) ? 'row-selected' : ''}" data-chp-channel="${escapeHtml(item.id)}" draggable="true" tabindex="0" aria-selected="${state.selected.has(item.id)}">
            <div class="meta-cell stt-cell text-secondary-text">${index + 1}</div><div class="list-asset-cell flex items-center gap-4"><input type="checkbox" class="row-check" data-row-check="" tabindex="-1" aria-label="Select row"${state.selected.has(item.id) ? ' checked=""' : ''}>${image(item.image)}<div><div class="chp-channel-labels"><span class="list-type-badge badge-channel">channel</span><span class="chp-playlist-count text-secondary-text">${(item.playlists || []).length} playlists</span></div><h3 class="list-asset-title">${link(url, item.name || item.query || 'YouTube channel')}</h3><div class="list-asset-meta"><p class="list-asset-uri text-secondary-text">${escapeHtml(item.youtube_id || item.query || '')}</p></div></div></div>
            <div class="meta-cell chp-owner-empty">${collapsed ? number((item.playlists || []).length) : ''}</div><div class="meta-cell"><div class="metric-stack"><span class="metric-main">${number(item.view_count)}</span></div></div><div class="meta-cell">${metricDelta(item.view_count_delta, item.delta_days) || '<span class="metric-empty">-</span>'}</div>${noteCell(item)}<div class="meta-cell text-right">${checked(item)}</div></div></div>
            <div class="chp-children"${collapsed ? ' hidden' : ''} aria-label="Playlists of ${escapeHtml(item.name || item.query)}"><div class="list-grid">${(item.playlists || []).map((playlist, position) => playlistRow(playlist, position, item.id)).join('') || '<p class="chp-empty">No linked playlists. Right-click the channel and choose Edit playlists.</p>'}</div></div></section>`;
    }
    function listHead(labels, grid, filter = false) {
        const keys = ['', 'name', '', 'view_count', 'view_count_delta', '', 'last_checked'];
        return `<div class="list-head pt-0 pb-0"><div class="list-columns-head custom-grid-row ${grid} px-4 py-3 text-[13px] font-medium">${labels.map((label, index) => `<div class="meta-cell head-cell" data-col-key="${index === 0 ? 'stt' : index === 1 ? 'asset' : label === 'Checked' ? 'checked' : ''}"><span class="head-cell-label">${label}</span>${keys[index] ? `<button type="button" class="metric-sort-mode-toggle ${state.sort?.key === keys[index] ? 'is-active' : ''}" data-chp-sort="${keys[index]}" aria-label="Sort by ${label}" title="Ascending / descending / manual order"><span class="metric-sort-triangle">${state.sort?.key === keys[index] && state.sort.direction === 1 ? '▲' : '▼'}</span></button>` : ''}${filter && label === 'Checked' ? `<div class="metric-sort-controls checked-sort-controls"><button type="button" class="metric-sort-mode-toggle ${state.filter !== 'all' ? 'is-active' : ''}" data-chp-action="filter" aria-label="Filter channel status" aria-haspopup="menu"><span class="metric-sort-triangle">▼</span></button></div>` : ''}<span class="column-resize-handle" data-chp-resize="${index}" role="separator" aria-orientation="vertical" aria-label="Resize ${label} column" title="Drag to resize; double-click to reset"></span></div>`).join('')}</div></div>`;
    }
    function flushRender() {
        if (!state.visible || state.modal || state.menu || state.drag || state.resize) { state.pendingRender = true; return; }
        updateHero();
        notifyGroup();
        const list = state.host?.querySelector('.chp-list');
        if (!list || list.contains(document.activeElement)) { state.pendingRender = true; return; }
        const html = listHead(['STT', 'Channel', 'Owner', 'View', 'Delta / Days', 'Note', 'Checked'], 'chp-grid', true) + (state.group && state.items.length ? state.items.map(channelRow).join('') : `<p class="chp-empty">${state.groups.length ? 'No matching channels. Add a channel or change the filter.' : 'Choose New Group in the group list to get started.'}</p>`);
        if (list.innerHTML !== html) list.innerHTML = html;
        updatePlaylistCountHeader();
        const select = state.tools.querySelector('.chp-groups');
        if (document.activeElement !== select) {
            const groups = new Map(state.groups.map(group => [group.name, group.count]));
            const options = groups.size ? [...groups].map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${number(count)})</option>`).join('') : '<option value="" disabled selected>No groups yet</option>';
            if (select.innerHTML !== options) select.innerHTML = options;
            select.disabled = !groups.size;
            select.value = state.group;
        }
        state.tools.querySelector('[data-chp-action="add"]').disabled = !state.group;
        renderRail();
        const warning = state.host.querySelector('.chp-key-warning');
        warning.hidden = state.hasKeys;
        const warningHtml = NO_SYSTEM_KEY + (isAdmin() ? ' <button type="button" data-chp-action="settings">Open Settings</button>' : '');
        if (!state.hasKeys && warning.innerHTML !== warningHtml) warning.innerHTML = warningHtml;
        state.pendingRender = false;
    }
    function renderRail() {
        const rail = document.getElementById('channel-group-rail');
        if (!rail || !window.GroupRailUI) return;
        if (state.rail !== rail) {
            state.rail = rail;
            window.GroupRailUI.mount(rail, {
                keyAttr: 'data-chp-group',
                emptyText: 'No groups yet. Press + to create one.',
                deleteNote: 'Channels move to Ungrouped; Spotify items are kept.',
                onSelect: (name, event) => {
                    selectRows('groups', name, event);
                    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                    state.group = name; changeScope();
                },
                onContextOpen: name => { if (!state.groupSelected.has(name)) selectRows('groups', name); },
                onCreate: name => createGroup(name),
                onRename: (name, next) => renameGroup(name, next),
                deleteTargets: name => state.groupSelected.has(name) ? visibleIds('groups').filter(value => state.groupSelected.has(value)) : [name],
                onDelete: names => deleteGroups(names),
                onError: error => message(errorText(error), true),
            });
            bindDrag(rail);
        }
        rail.__groupRail.render(state.groups
            .filter(group => group.name.toLocaleLowerCase().includes(state.groupSearch.toLocaleLowerCase()))
            .map(group => ({
                key: group.name,
                label: group.name,
                count: number(group.count),
                selected: state.group === group.name,
                multi: state.groupSelected.has(group.name) && state.group !== group.name,
                draggable: true,
            })));
    }
    function invalidate() {
        state.generation++;
        state.controller?.abort();
        state.loading = false;
    }
    function changeScope(resetGroup = false) {
        state.scope++; stopDrag();
        clearTimeout(state.debounce);
        invalidate();
        if (resetGroup) { state.group = ''; state.groups = []; state.collapsed.clear(); state.preferencesLoaded = false; state.preferences = { group_order: [], channel_orders: {}, playlist_orders: {} }; state.groupSelected.clear(); state.cut = null; }
        state.offset = 0;
        state.items = []; state.groupItems = []; state.selected.clear(); state.total = 0;
        state.playlistSelected.clear(); state.anchors = { groups: state.anchors.groups };
        flushRender();
        return reload();
    }
    async function reload(quiet = false) {
        if (!state.visible || !state.host || state.drag || state.resize || (quiet && (state.loading || state.bulkBusy || state.modal || state.menu || state.writePending))) return;
        invalidate();
        const generation = state.generation;
        const controller = new AbortController();
        state.controller = controller;
        state.loading = true;
        if (!quiet) message('Loading channels…');
        try {
            const data = await api(query(), 'GET', undefined, controller.signal);
            if (generation !== state.generation || !state.visible) return;
            if (!Array.isArray(data?.items)) throw new Error('Invalid channel list response.');
            if (!state.writePending || !state.preferencesLoaded) {
                const prefs = await api(scoped('/youtube/preferences'), 'GET', undefined, controller.signal);
                if (generation !== state.generation || !state.visible) return;
                state.preferences = { group_order: prefs.group_order || [], channel_orders: prefs.channel_orders || {}, playlist_orders: prefs.playlist_orders || {} }; state.preferencesLoaded = true;
            }
            state.groups = (data.groups || []).filter(group => typeof group.name === 'string' && group.name.trim() && group.name.toLowerCase() !== 'all');
            state.groups = ordered(state.groups, state.preferences.group_order, group => group.name);
            state.groupSelected = new Set([...state.groupSelected].filter(name => state.groups.some(group => group.name === name)));
            state.hasKeys = data.has_keys !== false;
            if (!state.groups.length) {
                state.group = ''; state.offset = 0; state.items = []; state.groupItems = []; state.selected.clear(); state.total = 0;
                flushRender(); message(''); return;
            }
            if (!state.groups.some(group => group.name === state.group)) {
                // The unscoped bootstrap response supplies groups only; never render its channel rows.
                state.group = state.groups[0].name; state.offset = 0; state.items = []; state.groupItems = []; state.selected.clear(); state.total = 0;
                flushRender(); return reload(quiet);
            }
            const items = await collectPages(data, false, generation, controller.signal);
            if (!items) return;
            let groupItems = items;
            if (state.filter !== 'all' || state.search) {
                const all = await api(query(0, true), 'GET', undefined, controller.signal);
                if (generation !== state.generation || !state.visible) return;
                groupItems = await collectPages(all, true, generation, controller.signal);
                if (!groupItems) return;
            }
            if (generation !== state.generation || !state.visible) return;
            // Commit once: no truncated first page or stale owner data reaches the DOM.
            state.items = ordered(items, state.preferences.channel_orders[state.group]); state.groupItems = ordered(groupItems, state.preferences.channel_orders[state.group]); state.total = items.length;
            for (const item of [...state.items, ...state.groupItems]) item.playlists = ordered((item.playlists || []).filter(playlist => !playlist.user_id || String(playlist.user_id) === state.userId), state.preferences.playlist_orders[item.id]);
            const ids = new Set(items.map(item => item.id));
            state.selected = new Set([...state.selected].filter(id => ids.has(id)));
            state.playlistSelected = new Set([...state.playlistSelected].filter(id => visibleIds('playlist').includes(id)));
            applySort();
            flushRender();
            if (!quiet || state.host.querySelector('.chp-status').classList.contains('chp-error')) message('');
        } catch (error) {
            if (generation === state.generation && error.name !== 'AbortError') message(errorText(error), true);
        } finally { if (generation === state.generation) state.loading = false; }
    }
    async function collectPages(first, unfiltered, generation, signal) {
        const merged = new Map();
        let data = first, offset = 0;
        while (true) {
            if (generation !== state.generation || !state.visible || signal.aborted) return null;
            if (!Array.isArray(data?.items)) throw new Error('Invalid channel list response.');
            for (const item of data.items) if (String(item.user_id) === state.userId) merged.set(item.id, item);
            offset += data.items.length;
            if (offset >= Number(data.total) || (!data.total && data.items.length < PAGE_SIZE)) break;
            if (!data.items.length) throw new Error('The channel list did not fully load. Please try again.');
            data = await api(query(offset, unfiltered), 'GET', undefined, signal);
        }
        return [...merged.values()];
    }
    function notifyItems() {
        try { Promise.resolve(state.onItemChanged?.()).catch(() => {}); } catch (_) { /* Shell callback must not mask a successful mutation. */ }
    }
    async function refreshAll(button) {
        if (state.bulkBusy) return;
        if (!state.group) { message('No channels to refresh. Create and select a group first.'); return; }
        const generation = state.generation;
        state.bulkBusy = true;
        button.disabled = true;
        try {
            // Collect every page in the current scope, not only the displayed 50 rows.
            const ids = new Set();
            const linked = new Set();
            for (let offset = 0; ; offset += PAGE_SIZE) {
                const data = await api(query(offset));
                if (generation !== state.generation || !state.visible) return;
                for (const item of data.items || []) { if (String(item.user_id) !== state.userId) continue; ids.add(item.id); if (item.playlists?.length) linked.add(item.id); }
                if (!data.items?.length || offset + data.items.length >= data.total) break;
            }
            const all = [...ids];
            for (let offset = 0; offset < all.length; offset += 500) {
                if (generation !== state.generation || !state.visible) return;
                await api('/youtube/channels/refresh', 'POST', { channel_ids: all.slice(offset, offset + 500) });
            }
            for (const id of linked) {
                if (generation !== state.generation || !state.visible) return;
                await api(`/youtube/channels/${encodeURIComponent(id)}/playlists/refresh`, 'POST');
            }
            if (linked.size) notifyItems();
            if (generation === state.generation) { await reload(); message(all.length ? `Refresh requested for ${all.length} channels.` : 'No channels to refresh.'); }
        } catch (error) { if (generation === state.generation) message(errorText(error), true); }
        finally { state.bulkBusy = false; if (button.isConnected) button.disabled = false; }
    }
    function setPlaylistCollapsed(id, collapse) {
        if (collapse) state.collapsed.add(id); else state.collapsed.delete(id);
        const block = [...state.host.querySelectorAll('[data-chp-block]')].find(node => node.dataset.chpBlock === id);
        if (block) {
            block.querySelector('.chp-children').hidden = collapse;
            const item = state.items.find(item => item.id === id);
            block.querySelector('.chp-owner-empty').textContent = collapse ? number((item?.playlists || []).length) : '';
        }
        updatePlaylistCountHeader();
    }
    function updatePlaylistCountHeader() {
        const label = state.host?.querySelector('.list-columns-head .head-cell:nth-child(3) .head-cell-label');
        if (label) label.textContent = state.items.length && state.items.every(item => state.collapsed.has(item.id))
            ? 'Playlist' : state.items.some(item => state.collapsed.has(item.id)) ? 'Owner / Playlist' : 'Owner';
    }
    function panelClick(event) {
        const sort = event.target.closest('[data-chp-sort]')?.dataset.chpSort;
        if (sort) {
            state.sort = state.sort?.key === sort ? state.sort.direction === 1 ? { key: sort, direction: -1 } : null : { key: sort, direction: 1 };
            applySort(); redrawOrder(); return;
        }
        const button = event.target.closest('[data-chp-action]');
        if (!button || button.disabled) return;
        const action = button.dataset.chpAction;
        if (action === 'add') openAdd();
        else if (action === 'new-group') startGroupCreate();
        else if (action === 'settings') {
            const nav = document.getElementById('nav-settings');
            if (nav) nav.click(); else message('Open Settings in the app menu to configure YouTube API keys.');
        }
        else if (action === 'refresh-all') refreshAll(button);
        else if (action === 'clear-selection') { state.selected.clear(); state.playlistSelected.clear(); paintSelection(); }
        else if (action === 'delete-selection') {
            if (state.playlistSelected.size && (state.focusKind === 'playlist' || !state.selected.size)) deleteSpotifyLinks(); else deleteChannels();
        }
        else if (action === 'filter') { const rect = button.getBoundingClientRect(); openFilterMenu(rect.left, rect.bottom); }
        else if (['toggle', 'expand', 'collapse'].includes(action)) {
            const ids = action === 'toggle' ? [button.dataset.chpId] : state.items.map(item => item.id);
            for (const id of ids) {
                const collapse = action === 'collapse' || (action === 'toggle' && !state.collapsed.has(id));
                setPlaylistCollapsed(id, collapse);
            }
        }
    }
    function closeMenu() {
        state.menu?.remove(); state.menu = null;
        if (state.pendingRender) flushRender();
    }
    function createMenu(html, x, y) {
        closeMenu();
        const menu = document.createElement('div');
        menu.className = 'row-context-menu chp-menu'; menu.setAttribute('role', 'menu');
        menu.innerHTML = html;
        document.body.appendChild(menu); state.menu = menu;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
        menu.querySelector('button')?.focus();
        menu.addEventListener('keydown', event => {
            const buttons = [...menu.querySelectorAll('button')];
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(buttons.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
            if (event.key === 'Escape') { closeMenu(); state.tools?.querySelector('.chp-search').focus(); }
        });
        return menu;
    }
    function filterItems() {
        return ['all', 'changed', 'errors'].map((filter, index) => `<button type="button" role="menuitemradio" aria-checked="${state.filter === filter}" class="row-context-item ${state.filter === filter ? 'is-active' : ''}" data-filter="${filter}"><span class="material-icons-round">${state.filter === filter ? 'check' : 'filter_list'}</span>${['All', 'Changed', 'Errors'][index]}</button>`).join('');
    }
    function bindFilter(menu) {
        menu.addEventListener('click', event => {
            const filter = event.target.closest('[data-filter]')?.dataset.filter;
            if (!filter) return;
            closeMenu(); state.filter = filter; changeScope();
        });
    }
    function openFilterMenu(x, y) { bindFilter(createMenu(filterItems(), x, y)); }
    function ordered(rows, ids = [], key = row => row.id) {
        const positions = new Map(ids.map((id, index) => [id, index]));
        return [...rows].sort((a, b) => (positions.get(key(a)) ?? ids.length) - (positions.get(key(b)) ?? ids.length));
    }
    function applySort() {
        const manual = state.preferences.channel_orders[state.group];
        state.items = ordered(state.items, manual?.length ? manual : state.groupItems.map(item => item.id));
        if (!state.sort) return;
        const { key, direction } = state.sort;
        state.items.sort((a, b) => direction * (key === 'name' ? String(a.name || a.query || '').localeCompare(String(b.name || b.query || ''), 'vi') : key === 'last_checked' ? (Date.parse(a[key]) || 0) - (Date.parse(b[key]) || 0) : (Number(a[key]) || 0) - (Number(b[key]) || 0)));
    }
    function redrawOrder() {
        const focus = document.activeElement;
        const attribute = ['data-chp-channel', 'data-chp-playlist', 'data-chp-group', 'data-chp-sort'].find(name => focus?.hasAttribute(name));
        const value = attribute && focus.getAttribute(attribute);
        if (attribute || state.host?.querySelector('.chp-list')?.contains(focus)) focus.blur();
        flushRender();
        if (attribute) [...document.querySelectorAll(`[${attribute}]`)].find(node => node.getAttribute(attribute) === value)?.focus({ preventScroll: true });
    }
    function persistPreferences(patch) {
        const scope = state.scope, owner = state.userId;
        invalidate();
        for (const [field, value] of Object.entries(patch)) state.preferences[field] = field === 'group_order' ? value : { ...state.preferences[field], ...value };
        state.writePending++;
        const current = () => scope === state.scope && owner === state.userId && sameActor() && state.visible;
        const job = state.preferenceQueue.then(async () => {
            if (!current()) return;
            await api(scoped('/youtube/preferences'), 'PUT', patch);
        }).catch(async error => {
            if (!current()) return;
            state.preferencesLoaded = false;
            await reload();
            if (current()) redrawOrder();
            if (current()) message(errorText(error), true);
        }).finally(() => { state.writePending--; });
        state.preferenceQueue = job;
        return job;
    }
    function selectedChannels() { return state.items.filter(item => state.selected.has(item.id) && String(item.user_id) === state.userId); }
    function selectedPlaylists() {
        return state.items.flatMap(channel => (channel.playlists || []).filter(item => state.playlistSelected.has(playlistKey(channel.id, item.id))).map(item => ({ channel, item })));
    }
    async function copyText(text) {
        if (!text) return;
        if (state.copyLinks) return state.copyLinks(text);
        if (navigator.clipboard?.writeText) { try { return await navigator.clipboard.writeText(text); } catch (_) { /* Local HTTP can require the selection-based fallback. */ } }
        const input = document.createElement('textarea'), focus = document.activeElement;
        input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select();
        try { if (!document.execCommand('copy')) throw new Error('Could not copy links.'); }
        finally { input.remove(); focus?.focus(); }
    }
    const channelUrl = item => item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${encodeURIComponent(item.youtube_id)}` : item.query);
    function copyChannels(items = selectedChannels()) { return copyText(items.map(channelUrl).filter(value => /^https?:\/\//i.test(value || '')).join('\n')); }
    function runAction(action) {
        const items = [...new Map(selectedPlaylists().map(({ item }) => [item.id, item])).values()];
        if (!items.length) return;
        if (!state.runPlaylistAction) { message('Playlist actions are not connected to the app.', true); return; }
        const scope = state.scope;
        Promise.resolve().then(() => { if (scope === state.scope && sameActor()) return state.runPlaylistAction(action, items); }).then(() => {
            if (scope === state.scope && action === 'fetch-selected') { notifyItems(); return reload(); }
        }).catch(error => { if (scope === state.scope) message(errorText(error), true); });
    }
    function actionMenu(actions, x, y, run) {
        const icons = { new: 'add', rename: 'edit', edit: 'edit', delete: 'delete', clear: 'clear_all',
            unlink: 'link_off', 'delete-link': 'delete_forever', 'copy-selected-links': 'content_copy',
            'fetch-selected': 'refresh', 'clipboard-auto': 'content_paste', 'txt-playlist-type3': 'description',
            'export-listview-excel': 'table_view' };
        const menu = createMenu(actions.map(([action, label]) => `<button type="button" role="menuitem" class="row-context-item ${action === 'delete-link' ? 'row-context-danger' : ''}" data-command="${escapeHtml(action)}"><span class="material-icons-round" aria-hidden="true">${icons[action] || 'folder'}</span><span>${escapeHtml(label)}</span></button>`).join(''), x, y);
        menu.addEventListener('click', event => {
            const action = event.target.closest('[data-command]')?.dataset.command;
            if (!action) return;
            closeMenu(); Promise.resolve().then(() => run(action)).catch(error => message(errorText(error), true));
        });
        return menu;
    }
    async function renameGroup(name, next) {
        if (next.toLowerCase() === 'all' || state.groups.some(group => group.name !== name && group.name.toLocaleLowerCase() === next.toLocaleLowerCase())) {
            message('This group already exists.', true);
            return false;
        }
        const scope = state.scope;
        await api(scoped('/youtube/groups'), 'PATCH', { old_name: name, new_name: next });
        if (scope !== state.scope) return true;
        state.preferencesLoaded = false;
        state.groupSelected.delete(name); state.groupSelected.add(next);
        if (state.group === name) state.group = next;
        await reload();
        return true;
    }
    async function deleteGroups(names) {
        const scope = state.scope;
        for (let offset = 0; offset < names.length; offset += 500) {
            if (scope !== state.scope) return;
            await api(scoped('/youtube/groups/delete'), 'POST', { names: names.slice(offset, offset + 500) });
        }
        if (scope !== state.scope) return;
        state.groupSelected.clear(); state.preferencesLoaded = false;
        if (names.includes(state.group)) state.group = '';
        await reload();
        message(`Deleted ${number(names.length)} ${names.length === 1 ? 'group' : 'groups'}.`);
    }
    function clearGroup() {
        const name = state.group;
        if (!name || !state.groupItems.length) return;
        dialog('Clear Group', `<p>Delete all ${state.groupItems.length} YouTube channels in ${escapeHtml(name)}? The group and Spotify items are kept.</p>`, 'Delete channels', () => api(scoped('/youtube/groups/clear'), 'POST', { name }));
    }
    function deleteChannels(items = selectedChannels()) {
        const ids = items.filter(item => String(item.user_id) === state.userId).map(item => item.id);
        if (!ids.length) return;
        const scope = state.scope;
        dialog('Delete Channels', `<p>Delete ${ids.length} YouTube channels? Linked Spotify items are kept.</p>`, 'Delete channels', async () => {
            for (let offset = 0; offset < ids.length; offset += 500) {
                if (scope !== state.scope) return;
                await api(scoped('/youtube/channels/delete'), 'POST', { channel_ids: ids.slice(offset, offset + 500) });
            }
        });
    }
    async function moveChannels(ids, group, owner = state.userId) {
        if (!ids.length || owner !== state.userId || !sameActor() || !state.groups.some(row => row.name === group)) return;
        const scope = state.scope;
        invalidate();
        state.writePending++;
        try {
            for (let offset = 0; offset < ids.length; offset += 500) {
                if (scope !== state.scope || owner !== state.userId || !sameActor()) return;
                await api(scoped('/youtube/channels/move'), 'POST', { channel_ids: ids.slice(offset, offset + 500), group });
            }
            if (scope !== state.scope || owner !== state.userId) return;
            state.cut = null; state.preferencesLoaded = false;
            await reload();
        } catch (error) { if (scope === state.scope) { await reload(); message(errorText(error), true); } }
        finally { state.writePending--; }
    }
    function openPlaylistMenu(row, x, y) {
        if (!state.playlistSelected.has(row.dataset.chpPlaylist)) selectRows('playlist', row.dataset.chpPlaylist);
        state.focusKind = 'playlist';
        const edit = state.playlistSelected.size === 1 && linkTarget(row.dataset.chpParent, row.dataset.chpItem);
        actionMenu([...(edit ? [['edit', 'Edit']] : []), ['copy-selected-links', 'Copy Link'], ['fetch-selected', 'Refresh selected playlists'], ['delete-link', 'Delete playlists'], ['clipboard-auto', 'Clipboard Playlist'], ['txt-playlist-type3', 'Export TXT'], ['export-listview-excel', 'Export Excel']], x, y, action => action === 'edit' ? openNoteEdit(edit) : action === 'delete-link' ? deleteSpotifyLinks() : runAction(action));
    }
    function deleteSpotifyLinks() {
        const items = [...new Map(selectedPlaylists().map(({ item }) => [item.id, item])).values()];
        if (!items.length || !state.runPlaylistAction) return;
        const owner = state.userId, scope = state.scope;
        dialog('Delete Playlists', `<p>Delete ${items.length} playlists and their tracking history from Channel & Playlist, including links used by other channels? Spotify Checker and the playlists on Spotify are not affected.</p>`, 'Delete links', async () => {
            if (scope !== state.scope || owner !== state.userId || !sameActor()) return;
            await state.runPlaylistAction('delete-selected-links', items);
            notifyItems(); state.playlistSelected.clear();
        });
    }
    function moveMenu(x, y) {
        const ids = selectedChannels().map(item => item.id);
        actionMenu(state.groups.map(group => [group.name, group.name]), x, y, group => moveChannels(ids, group));
    }
    async function refreshSelectedChannels() {
        const ids = selectedChannels().map(item => item.id), scope = state.scope;
        if (!ids.length || state.bulkBusy) return;
        invalidate(); state.bulkBusy = true;
        try {
            for (let offset = 0; offset < ids.length; offset += 500) {
                if (scope !== state.scope) return;
                await api('/youtube/channels/refresh', 'POST', { channel_ids: ids.slice(offset, offset + 500) });
            }
            if (scope === state.scope) { await reload(); message(`Refresh requested for ${ids.length} channels.`); }
        } catch (error) { if (scope === state.scope) message(errorText(error), true); }
        finally { state.bulkBusy = false; }
    }
    async function exportChannelList() {
        const items = selectedChannels().length ? selectedChannels() : state.items;
        if (state.exportChannels) return state.exportChannels(items);
        const cell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
        const content = [['Channel', 'URL', 'View', 'Delta', 'Checked', 'Note'], ...items.map(item => [item.name || item.query, channelUrl(item), item.view_count, item.view_count_delta, item.last_checked, item.note])].map(row => row.map(cell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'youtube-channels.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function openMenu(id, x, y) {
        closeMenu();
        const item = state.items.find(row => row.id === id);
        if (!item) return;
        if (!state.selected.has(id)) selectChannel(id);
        state.focusKind = 'channels';
        const actions = [...(state.selected.size === 1 ? [['edit', 'edit', 'Edit playlists'], ...(canEdit(item) ? [['note', 'sticky_note_2', 'Edit note']] : [])] : []), ['add', 'add', 'Add Channel'], ['refresh', 'refresh', 'Refresh channels'], ['playlists', 'refresh', 'Refresh playlists'], ['move', 'drive_file_move', 'Move To Group'], ['copy', 'content_copy', 'Copy Links'], ['export', 'download', 'Export List CSV'], ['clear', 'delete', 'Clear Group'], ['toggle', 'unfold_more', 'Expand / collapse playlists'], ['expand', 'unfold_more', 'Expand all'], ['collapse', 'unfold_less', 'Collapse all'], ['delete', 'delete', 'Delete channels']];
        const menu = createMenu(actions.map(([action, icon, label]) => `<button type="button" role="menuitem" class="row-context-item ${action === 'delete' ? 'row-context-danger' : ''}" data-menu="${action}"><span class="material-icons-round">${icon}</span>${label}</button>`).join('') + '<div class="row-context-separator"></div>' + filterItems(), x, y);
        bindFilter(menu);
        menu.addEventListener('click', event => {
            const action = event.target.closest('[data-menu]')?.dataset.menu;
            if (!action) return;
            closeMenu();
            if (action === 'add') openAdd();
            if (action === 'move') moveMenu(x, y);
            if (action === 'copy') copyChannels().catch(error => message(errorText(error), true));
            if (action === 'export') Promise.resolve(exportChannelList()).catch(error => message(errorText(error), true));
            if (action === 'clear') clearGroup();
            if (action === 'edit') openEdit(item);
            if (action === 'note') openNoteEdit(linkTarget(item.id));
            if (action === 'refresh') refreshSelectedChannels();
            if (action === 'playlists') { state.playlistSelected = new Set(selectedChannels().flatMap(row => (row.playlists || []).map(playlist => playlistKey(row.id, playlist.id)))); runAction('fetch-selected'); }
            if (action === 'delete') deleteChannels();
            if (action === 'toggle') {
                if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
                flushRender();
            }
            if (action === 'expand' || action === 'collapse') {
                for (const row of state.items) {
                    if (action === 'collapse') state.collapsed.add(row.id); else state.collapsed.delete(row.id);
                }
                flushRender();
            }
        });
    }
    function closeModal() {
        const modal = state.modal;
        if (!modal) return;
        state.modal = null;
        modal.controller.abort(); modal.node.remove();
        if (modal.focus?.isConnected && state.visible) modal.focus.focus();
        if (state.pendingRender) flushRender();
    }
    function reorderedVisible(full, visible, moving, target, after) {
        if (moving.includes(target)) return full;
        const picked = visible.filter(id => moving.includes(id));
        const rest = visible.filter(id => !moving.includes(id));
        const index = rest.indexOf(target);
        if (index < 0 || !picked.length) return full;
        rest.splice(index + (after ? 1 : 0), 0, ...picked);
        const visibleSet = new Set(visible);
        let position = 0;
        // Hidden rows keep their slots; only the visible subsequence changes order.
        return full.map(id => visibleSet.has(id) ? rest[position++] : id);
    }
    // Column widths are the viewer's preference, whichever owner they are looking at.
    function widthKey() { return `spoticheck_channel_column_widths_${state.actorId}`; }
    function loadWidths() {
        state.widths = null;
        try {
            let widths = JSON.parse(localStorage.getItem(widthKey()));
            // Saved before the Note column existed: keep those sizes and slot Note in at its default.
            if (Array.isArray(widths) && widths.length === 6) widths = [...widths.slice(0, 5), 140, widths[5]];
            if (Array.isArray(widths) && widths.length === 7 && widths.every(value => Number.isFinite(value))) state.widths = widths.map(value => Math.min(800, Math.max(48, value)));
        } catch (_) { /* Private browsing can disable storage. */ }
        applyWidths();
    }
    function applyWidths() {
        if (!state.host) return;
        if (state.widths) {
            state.host.style.setProperty('--chp-columns', state.widths.map(value => `${value}px`).join(' '));
            // Below 1100px Delta (4) and Checked (6) are hidden; keep the user's other widths.
            state.host.style.setProperty('--chp-columns-narrow', state.widths.filter((_, index) => index !== 4 && index !== 6).map(value => `${value}px`).join(' '));
        } else {
            state.host.style.removeProperty('--chp-columns');
            state.host.style.removeProperty('--chp-columns-narrow');
        }
    }
    function saveWidths() {
        try { if (state.widths) localStorage.setItem(widthKey(), JSON.stringify(state.widths)); else localStorage.removeItem(widthKey()); } catch (_) { /* Resizing remains usable without storage. */ }
    }
    function cancelResize() {
        if (!state.resize) return;
        state.resize.controller.abort(); state.resize = null;
        document.body.classList.remove('chp-resizing');
    }
    function startResize(event) {
        const handle = event.target.closest('[data-chp-resize]');
        if (!handle || event.button !== 0 || !state.visible || state.modal) return;
        event.preventDefault(); event.stopImmediatePropagation(); invalidate(); cancelResize();
        // Hidden columns (narrow screens) measure 0: keep their stored width instead.
        const widths = [...handle.closest('.custom-grid-row').children].map((node, index) => Math.min(800, Math.max(48,
            node.getBoundingClientRect().width || state.widths?.[index] || 140)));
        const index = Number(handle.dataset.chpResize), scope = state.scope, owner = state.userId, startX = event.clientX;
        const controller = new AbortController();
        state.resize = { controller }; document.body.classList.add('chp-resizing');
        const move = event => {
            if (scope !== state.scope || owner !== state.userId || !sameActor()) { cancelResize(); return; }
            event.preventDefault(); event.stopImmediatePropagation();
            state.widths = [...widths]; state.widths[index] = Math.min(800, Math.max(48, widths[index] + event.clientX - startX)); applyWidths();
        };
        window.addEventListener('pointermove', move, { capture: true, signal: controller.signal });
        window.addEventListener('pointerup', event => { move(event); saveWidths(); cancelResize(); if (state.pendingRender) flushRender(); }, { capture: true, signal: controller.signal });
        window.addEventListener('pointercancel', cancelResize, { capture: true, signal: controller.signal });
    }
    function stopDrag() {
        if (state.scrollFrame != null) cancelAnimationFrame(state.scrollFrame);
        state.scrollFrame = null; state.drag = null;
        document.querySelectorAll('.chp-drop-before, .chp-drop-after').forEach(node => node.classList.remove('chp-drop-before', 'chp-drop-after'));
    }
    function autoScroll(event) {
        if (!state.drag) return;
        state.drag.pointer = { x: event.clientX, y: event.clientY };
        if (state.scrollFrame != null) return;
        const frame = () => {
            if (!state.drag || !state.visible) { stopDrag(); return; }
            const { x, y } = state.drag.pointer;
            const railRect = state.rail?.getBoundingClientRect();
            let node = railRect && x >= railRect.left && x <= railRect.right ? state.rail : state.host;
            while (node && !(node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
            node ||= document.scrollingElement;
            const rect = node === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : node.getBoundingClientRect();
            const edge = 48;
            const speed = y < rect.top + edge ? -Math.min(18, Math.max(0, (rect.top + edge - y) / 3)) : y > rect.bottom - edge ? Math.min(18, Math.max(0, (y - rect.bottom + edge) / 3)) : 0;
            if (speed) node.scrollTop += speed;
            state.scrollFrame = requestAnimationFrame(frame);
        };
        state.scrollFrame = requestAnimationFrame(frame);
    }
    function dragTarget(event) {
        const drag = state.drag;
        if (!drag || drag.scope !== state.scope || drag.owner !== state.userId || !sameActor() || state.sort) return null;
        if (drag.kind === 'channelgroup') return event.target.closest('[data-chp-group]');
        if (drag.kind === 'channels') return event.target.closest('[data-chp-group], [data-chp-channel]');
        const row = event.target.closest('[data-chp-playlist]');
        return row?.dataset.chpParent === drag.parent ? row : null;
    }
    function bindDrag(host) {
        host.addEventListener('dragstart', event => {
            const row = event.target.closest('[data-chp-playlist], [data-chp-channel], [data-chp-group]');
            if (!row || event.target.closest('a, img') || state.sort || state.modal || state.writePending) { event.preventDefault(); return; }
            const kind = row.hasAttribute('data-chp-group') ? 'channelgroup' : row.hasAttribute('data-chp-playlist') ? 'playlist' : 'channels';
            const selectionKind = kind === 'channelgroup' ? 'groups' : kind;
            const id = kind === 'channelgroup' ? row.dataset.chpGroup : kind === 'playlist' ? row.dataset.chpPlaylist : row.dataset.chpChannel;
            if (!selection(selectionKind).has(id)) selectRows(selectionKind, id);
            const parent = row.dataset.chpParent;
            let ids = visibleIds(selectionKind).filter(value => selection(selectionKind).has(value));
            if (kind === 'playlist') ids = ids.filter(value => value.startsWith(`${parent}:`));
            state.drag = { kind, ids, parent, scope: state.scope, owner: state.userId, pointer: { x: event.clientX, y: event.clientY } };
            invalidate();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-spoticheck-channel-workspace', JSON.stringify({ kind, ids, parent }));
        });
        host.addEventListener('dragover', event => {
            if (!state.drag) return;
            autoScroll(event);
            const row = dragTarget(event);
            document.querySelectorAll('.chp-drop-before, .chp-drop-after').forEach(node => node.classList.remove('chp-drop-before', 'chp-drop-after'));
            if (!row) { event.dataTransfer.dropEffect = 'none'; return; }
            event.preventDefault(); event.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            row.classList.add(event.clientY > rect.top + rect.height / 2 ? 'chp-drop-after' : 'chp-drop-before');
        });
        host.addEventListener('drop', event => {
            const row = dragTarget(event), drag = state.drag;
            if (!row || !drag) { stopDrag(); return; }
            event.preventDefault(); event.stopPropagation();
            const rect = row.getBoundingClientRect(), after = event.clientY > rect.top + rect.height / 2;
            stopDrag();
            if (drag.kind === 'channels' && row.hasAttribute('data-chp-group')) { moveChannels(drag.ids, row.dataset.chpGroup); return; }
            if (drag.kind === 'channelgroup') {
                const ids = reorderedVisible(state.groups.map(group => group.name), visibleIds('groups'), drag.ids, row.dataset.chpGroup, after);
                state.groups = ordered(state.groups, ids, group => group.name); persistPreferences({ group_order: ids });
            } else if (drag.kind === 'channels') {
                const ids = reorderedVisible(state.groupItems.map(item => item.id), visibleIds('channels'), drag.ids, row.dataset.chpChannel, after);
                state.groupItems = ordered(state.groupItems, ids); state.items = ordered(state.items, ids);
                persistPreferences({ channel_orders: { [state.group]: ids } });
            } else {
                const channel = state.items.find(item => item.id === drag.parent);
                if (!channel) return;
                const ids = reorderedVisible(channel.playlists.map(item => item.id), channel.playlists.map(item => item.id), drag.ids.map(value => value.slice(drag.parent.length + 1)), row.dataset.chpItem, after);
                channel.playlists = ordered(channel.playlists, ids);
                const cached = state.groupItems.find(item => item.id === drag.parent);
                if (cached) cached.playlists = ordered(cached.playlists, ids);
                persistPreferences({ playlist_orders: { [drag.parent]: ids } });
            }
            redrawOrder();
        });
        host.addEventListener('dragend', () => { stopDrag(); if (state.pendingRender) flushRender(); });
    }
    function keyboard(event) {
        if (!state.visible || state.host?.hidden || state.modal || state.menu || !sameActor() || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]')) return;
        const focus = document.activeElement;
        if (focus?.closest('[data-chp-playlist]')) state.focusKind = 'playlist';
        else if (focus?.closest('[data-chp-channel]')) state.focusKind = 'channels';
        else if (state.rail?.contains(focus)) state.focusKind = 'groups';
        else if (focus !== document.body && !state.host?.contains(focus) && !state.tools?.contains(focus)) return;
        const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase(), kind = state.focusKind;
        let run;
        if (modifier && key === 'a') run = () => { const selected = selection(kind); selected.clear(); visibleIds(kind).forEach(id => selected.add(id)); paintSelection(); };
        if (key === 'escape') run = () => { state.selected.clear(); state.playlistSelected.clear(); state.groupSelected.clear(); state.cut = null; paintSelection(); };
        // Group F2/Delete are handled by the shared GroupRailUI so every workspace behaves the same.
        if (key === 'delete' && kind !== 'groups' && selection(kind).size) run = () => kind === 'playlist' ? deleteSpotifyLinks() : deleteChannels();
        if (modifier && key === 'c' && kind !== 'groups' && selection(kind).size) run = () => kind === 'playlist' ? runAction('copy-selected-links') : copyChannels().catch(error => message(errorText(error), true));
        if (modifier && key === 'x' && kind === 'channels' && state.selected.size) run = () => { state.cut = { owner: state.userId, ids: selectedChannels().map(item => item.id) }; message('Channels cut. Select the target group and press Ctrl/Cmd+V.'); };
        if (modifier && key === 'v' && state.cut && state.group) run = () => moveChannels(state.cut.ids, state.group, state.cut.owner);
        if (!run) return;
        event.preventDefault(); event.stopImmediatePropagation(); run();
    }
    document.addEventListener('keydown', keyboard, true);
    function dialog(title, content, submitLabel, submit, { shared = false } = {}) {
        closeMenu(); closeModal();
        invalidate();
        const node = document.createElement('div');
        if (shared) {
            // Same markup as the Add Spotify Link / Add YouTube Channel modals, so every add box looks alike.
            node.className = 'modal-overlay open chp-shared-modal';
            node.innerHTML = `<form class="modal-content" role="dialog" aria-modal="true" aria-labelledby="chp-dialog-title"><div class="flex items-center justify-between mb-6"><h2 id="chp-dialog-title" class="text-xl font-bold">${escapeHtml(title)}</h2><button type="button" data-close class="text-secondary-text hover:text-white transition-colors cursor-pointer" aria-label="Close"><span class="material-icons-round">close</span></button></div><div class="chp-dialog-body space-y-4">${content}</div><p class="chp-dialog-status text-sm mt-3" role="status" aria-live="polite"></p><div class="flex gap-3 pt-4"><button type="button" data-close class="flex-1 btn-ghost px-4 py-3 rounded-xl border border-white/20 text-sm font-bold cursor-pointer">Cancel</button><button type="submit" class="flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold transition-colors cursor-pointer"><span class="flex items-center justify-center gap-2"><span class="material-icons-round text-lg">playlist_add</span>${escapeHtml(submitLabel)}</span></button></div></form>`;
        } else {
            node.className = 'chp-backdrop';
            node.innerHTML = `<section class="chp-dialog" role="dialog" aria-modal="true" aria-labelledby="chp-dialog-title"><form><header><h2 id="chp-dialog-title">${escapeHtml(title)}</h2><button type="button" data-close aria-label="Close">×</button></header><div class="chp-dialog-body">${content}</div><p class="chp-dialog-status" role="status" aria-live="polite"></p><footer><button type="button" data-close>Cancel</button><button type="submit" class="chp-primary">${escapeHtml(submitLabel)}</button></footer></form></section>`;
        }
        const modal = { node, controller: new AbortController(), focus: document.activeElement, busy: false };
        state.modal = modal; document.body.appendChild(node);
        node.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { if (!modal.busy) closeModal(); }));
        node.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!modal.busy) closeModal(); }
            if (event.key === 'Tab') {
                const nodes = [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')];
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        node.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault(); if (modal.busy) return;
            modal.busy = true;
            const button = node.querySelector('[type="submit"]'); button.disabled = true;
            const status = node.querySelector('.chp-dialog-status'); status.textContent = 'Processing…';
            try {
                const feedback = await submit(node, modal);
                if (state.modal !== modal) return;
                modal.focus = state.tools?.querySelector('.chp-search');
                closeModal(); await reload(); if (feedback) message(feedback);
            } catch (error) { if (state.modal === modal) { status.textContent = errorText(error); status.classList.add('chp-error'); } }
            finally { modal.busy = false; if (button.isConnected) button.disabled = false; }
        });
        (node.querySelector('.chp-dialog-body input, .chp-dialog-body textarea') || node.querySelector('[data-close]')).focus();
        return modal;
    }
    const lines = value => [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
    async function createGroup(name) {
        if (name.toLowerCase() === 'all' || state.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            message('This group already exists.', true);
            return false;
        }
        const ownerId = state.userId;
        await api('/youtube/groups', 'POST', { name, ...(ownerId ? { target_user_id: ownerId } : {}) });
        if (state.userId !== ownerId) return true;
        state.group = name; state.offset = 0; state.items = []; state.total = 0;
        await reload();
        message('Group created.');
        return true;
    }
    function startGroupCreate() {
        renderRail();
        state.rail?.__groupRail.startCreate();
    }
    function openAdd() {
        if (!state.group) { message('Create and select a group before adding channels.'); return; }
        const ownerId = state.userId;
        // Channels always go into the group that is open; there is no group picker.
        const group = state.group;
        dialog(`Add YouTube Channels to ${group}`, `<div><label for="chp-add-urls" class="block text-sm font-medium text-secondary-text mb-2">YouTube channel URLs, one per line</label><textarea id="chp-add-urls" name="urls" class="modal-input resize-none" rows="6" required placeholder="https://www.youtube.com/@handle&#10;https://www.youtube.com/channel/UC..."></textarea><p class="text-xs text-secondary-text mt-2">Supports /channel/UC..., /@handle, /user/..., /c/...</p></div>`, 'Add & Check', async node => {
            const urls = lines(node.querySelector('[name="urls"]').value);
            if (!urls.length) throw new Error('Enter at least one channel URL.');
            if (urls.length > 500) throw new Error('Up to 500 URLs at a time.');
            const data = await api('/youtube/channels', 'POST', { urls, group, ...(ownerId ? { target_user_id: ownerId } : {}) });
            return `Added: ${number(data.accepted ?? data.items?.length ?? 0)}; skipped: ${number(Array.isArray(data.skipped) ? data.skipped.length : data.skipped ?? 0)}.`;
        }, { shared: true });
    }
    async function openEdit(item) {
        if (String(item.user_id) !== state.userId || !sameActor()) return;
        const urls = (item.playlists || []).map(playlist => `https://open.spotify.com/playlist/${playlist.spotify_id}`).join('\n');
        const modal = dialog(`Edit playlists · ${item.name || item.query}`, `<label>Paste playlist URLs, one per line<textarea name="urls" rows="9" placeholder="https://open.spotify.com/playlist/…">${escapeHtml(urls)}</textarea></label>`, 'Save links', async node => {
            const urls = lines(node.querySelector('[name="urls"]').value);
            if (urls.length > 500) throw new Error('Up to 500 URLs at a time.');
            await api(`/youtube/channels/${encodeURIComponent(item.id)}/playlists`, 'PUT', { urls });
            notifyItems();
        });
        styleEditor(modal);
    }
    function styleEditor(modal) {
        const editor = modal.node.querySelector('.chp-dialog');
        editor.classList.add('chp-playlist-editor');
        editor.querySelector('header [data-close]').innerHTML = '<span class="material-icons-round" aria-hidden="true">close</span>';
        editor.querySelector('[type="submit"]').insertAdjacentHTML('afterbegin', '<span class="material-icons-round" aria-hidden="true">save</span>');
    }
    function openNoteEdit(target) {
        if (!target) return;
        const { channel, item, row } = target, url = item ? `https://open.spotify.com/playlist/${item.spotify_id}` : '';
        styleEditor(dialog(item ? `Edit · ${playlistTitle(item)}` : `Edit note · ${channel.name || channel.query}`,
            `${item ? `<label>Spotify link<input name="url" required maxlength="2048" spellcheck="false" autocomplete="off" value="${escapeHtml(url)}" placeholder="https://open.spotify.com/playlist/…"></label>` : ''}<label>Note<textarea name="note" rows="5" maxlength="1000" placeholder="Add a note…">${escapeHtml(row.note || '')}</textarea></label>`, 'Save', async node => {
                const next = node.querySelector('[name="url"]')?.value.trim() || '', note = node.querySelector('[name="note"]').value.trim();
                const body = { ...(next !== url ? { url: next } : {}), ...(note !== (row.note || '') ? { note } : {}) };
                if (!Object.keys(body).length) return;
                await api(target.path, 'PATCH', body);
                // A changed link points at another playlist item: drop the stale selection and shell caches.
                if (body.url) { state.playlistSelected.clear(); notifyItems(); }
            }));
    }
    async function showKeySettings(host) {
        host = typeof host === 'string' ? document.querySelector(host) : host || document.getElementById('youtube-key-settings');
        if (!host) return;
        const generation = ++state.settingsGeneration;
        const userId = state.getUser()?.id;
        const current = () => generation === state.settingsGeneration && state.getUser()?.id === userId;
        host.classList.add('chp-settings', 'app-card');
        // Only admins manage the system key pool; every other role never sees this section.
        host.hidden = !isAdmin();
        if (host.hidden) { host.textContent = ''; return; }
        host.textContent = 'Loading system API keys…';
        try {
            const data = await api('/youtube/keys');
            if (!current()) return;
            host.innerHTML = '<form><h3 class="app-card-title">YouTube API Keys</h3><p class="text-sm text-secondary-text mb-4">System key pool used by every account. Enable YouTube Data API v3 in Google Cloud. If you restrict keys by caller, allow the VPS server IP 194.233.69.135 (not a browser referrer) and limit the key to YouTube Data API v3.</p><label class="app-card-label">API keys<textarea name="api_keys" class="settings-input" rows="8" autocomplete="off" spellcheck="false" aria-describedby="chp-key-note" placeholder="One key per line"></textarea></label><p id="chp-key-note" class="text-xs text-secondary-text mb-4">One key per line. Save replaces the whole list: delete a line and save to remove that key. Keys rotate automatically when quota runs out.</p><div class="chp-settings-actions"><button type="submit" class="btn-accent inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold cursor-pointer"><span class="material-icons-round text-base" aria-hidden="true">save</span>Save keys</button><button type="button" data-check class="btn-ghost inline-flex items-center gap-2 px-6 py-2.5 rounded-full border text-sm font-bold cursor-pointer"><span class="material-icons-round text-base" aria-hidden="true">fact_check</span>Check keys</button></div><p class="chp-key-status" role="status" aria-live="polite"></p><ul class="chp-key-list" aria-label="Key check results"></ul></form>';
            const input = host.querySelector('textarea');
            const list = host.querySelector('.chp-key-list');
            const status = host.querySelector('.chp-key-status');
            const labels = { valid: 'Valid', invalid: 'Invalid', quota_exceeded: 'Quota exceeded', error: 'Check failed' };
            const codes = { invalid_key: 'Invalid key', quota_exceeded: 'Quota exceeded', forbidden: 'API access denied', network_error: 'Connection error', rate_limited: 'Rate limited', api_unavailable: 'API temporarily unavailable' };
            // Provider messages are never rendered: they may contain credentials.
            const resultLabel = entry => typeof entry.valid === 'boolean'
                ? entry.valid ? labels.valid : codes[entry.error_code] || 'Invalid / check failed'
                : entry.status === 'valid' ? labels.valid : codes[entry.error_code] || labels[entry.status] || 'Unknown';
            const isValid = entry => (typeof entry.valid === 'boolean' ? entry.valid : entry.status === 'valid');
            // Internal tool: the full keys are shown and edited as plain text, one per line.
            const keyText = result => (typeof result?.api_keys === 'string' ? result.api_keys
                : (Array.isArray(result?.keys) ? result.keys : []).map(key => key.key || '').filter(Boolean).join('\n'));
            input.value = keyText(data);
            let busy = false;
            async function run(label, work) {
                if (busy || !current()) return;
                busy = true;
                host.querySelectorAll('button').forEach(button => { button.disabled = true; });
                status.textContent = label; status.classList.remove('chp-error');
                try {
                    const text = await work();
                    if (current()) status.textContent = text;
                } catch (_) { if (current()) { status.textContent = 'Could not process API keys. Please try again.'; status.classList.add('chp-error'); } }
                finally { busy = false; host.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
            }
            host.querySelector('form').addEventListener('submit', event => {
                event.preventDefault();
                if (!input.value.trim() && !window.confirm('Save an empty list? This removes every system API key.')) return;
                run('Saving…', async () => {
                    const result = await api('/youtube/keys', 'PUT', { api_keys: input.value });
                    if (!Array.isArray(result?.keys)) throw new Error('Invalid key response');
                    input.value = keyText(result); list.innerHTML = '';
                    state.hasKeys = result.keys.length > 0;
                    return `Saved ${Number(result.count) || 0} key(s).`;
                });
            });
            host.querySelector('[data-check]').addEventListener('click', () => {
                if (!input.value.trim()) { status.textContent = NO_SYSTEM_KEY; list.innerHTML = ''; return; }
                run('Checking…', async () => {
                    const result = await api('/youtube/keys/check', 'POST', { api_keys: input.value });
                    const results = result?.results;
                    if (!Array.isArray(results)) throw new Error('Invalid key check response');
                    list.innerHTML = results.map((entry, index) => {
                        const name = entry.key || entry.masked || `Key ${Number.isInteger(entry.index) ? entry.index + 1 : index + 1}`;
                        return `<li><code>${escapeHtml(name)}</code><span class="chp-key-result${isValid(entry) ? '' : ' chp-error'}">${escapeHtml(resultLabel(entry))}</span></li>`;
                    }).join('');
                    return `Checked ${results.length} key(s): ${results.filter(isValid).length} valid.`;
                });
            });
        } catch (_) { if (current()) host.textContent = 'Could not load system API keys. Reopen Settings to retry.'; }
    }
    /* Follow the signed-in account and the owner picked in the shared owner filter. */
    function syncAccountScope() {
        const actor = String(state.getUser()?.id || '');
        const owner = String(state.getOwner?.() || actor);
        if (state.actorId === actor && state.userId === owner) return;
        const actorChanged = state.actorId !== actor;
        cancelResize(); closeModal(); closeMenu(); state.actorId = actor; state.userId = owner;
        if (actorChanged) loadWidths();
        // changeScope resets the previous owner's rows; it only fetches while the view is visible.
        return changeScope(true);
    }
    function show() {
        mount();
        syncAccountScope();
        applyWidths();
        state.visible = true; state.host.hidden = false;
        state.tools.hidden = false;
        renderRail();
        clearInterval(state.timer);
        state.timer = setInterval(() => { if (state.visible && !document.hidden && !state.host.hidden) reload(true); }, 8000);
        return reload();
    }
    function hide() {
        state.scope++; stopDrag(); cancelResize();
        state.visible = false; invalidate();
        clearInterval(state.timer); clearTimeout(state.debounce);
        closeModal(); closeMenu();
        if (state.host) state.host.hidden = true;
        if (state.tools) state.tools.hidden = true;
    }
    function init(options) {
        if (typeof options?.request !== 'function' || typeof options?.getUser !== 'function') throw new TypeError('init requires request and getUser functions');
        hide(); state.request = options.request; state.getUser = options.getUser; state.onItemChanged = options.onItemChanged; state.onGroupChanged = options.onGroupChanged;
        state.getOwner = typeof options.getOwner === 'function' ? options.getOwner : null;
        state.formatChecked = typeof options.formatChecked === 'function' ? options.formatChecked : null;
        state.formatUpdatedAt = typeof options.formatUpdatedAt === 'function' ? options.formatUpdatedAt : null;
        state.renderUserCell = typeof options.renderUserCell === 'function' ? options.renderUserCell : null;
        state.renderPlaylistOwnerCell = typeof options.renderPlaylistOwnerCell === 'function' ? options.renderPlaylistOwnerCell : null;
        for (const name of ['runPlaylistAction', 'copyLinks', 'previewImage', 'exportChannels']) state[name] = typeof options[name] === 'function' ? options[name] : null;
        state.settingsGeneration++;
        state.userId = ''; state.actorId = ''; state.group = ''; state.search = ''; state.filter = 'all'; state.offset = 0;
        state.items = []; state.groupItems = []; state.groups = []; state.total = 0; state.collapsed.clear(); state.selected.clear(); state.groupSearch = '';
        state.preferencesLoaded = false; state.preferences = { group_order: [], channel_orders: {}, playlist_orders: {} };
        state.groupSelected.clear(); state.playlistSelected.clear(); state.anchors = {}; state.cut = null; state.sort = null; state.focusKind = 'channels';
        if (state.tools) state.tools.querySelector('.chp-search').value = '';
        return window.ChannelPlaylists;
    }
    document.addEventListener('pointerdown', event => {
        if (!state.visible || event.button !== 0 || state.modal || state.drag || state.resize
            || event.ctrlKey || event.metaKey || event.shiftKey
            || event.target.closest('.chp-menu, .row-context-menu, .modal-overlay.open, .chp-backdrop')) return;
        const row = event.target.closest('[data-chp-channel], [data-chp-playlist]');
        if (!row || row.hasAttribute('data-chp-playlist')) {
            state.selected.clear(); delete state.anchors.channels;
        }
        if (!row || row.hasAttribute('data-chp-channel')) {
            state.playlistSelected.clear(); delete state.anchors.playlist;
        }
        paintSelection();
    }, true);
    document.addEventListener('pointerdown', event => { if (state.menu && !state.menu.contains(event.target)) closeMenu(); });
    document.addEventListener('focusin', event => { if (state.menu && !state.menu.contains(event.target)) closeMenu(); });
    function setGroupSearch(text) {
        state.groupSearch = String(text || '');
        renderRail();
    }
    window.ChannelPlaylists = { init, show, hide, reload, showKeySettings, syncAccountScope, setGroupSearch };
}());
