(function () {
    'use strict';

    const PAGE_SIZE = 100;
    const state = {
        request: null, getUser: () => null, onItemChanged: null, host: null,
        visible: false, userId: '', group: '', search: '', filter: 'all', offset: 0,
        items: [], groups: [], total: 0, collapsed: new Set(), generation: 0,
        controller: null, timer: null, debounce: null, modal: null, menu: null,
        loading: false, pendingRender: false, settingsGeneration: 0, rail: null, hasKeys: true, bulkBusy: false,
        tools: null, groupTools: null, groupSearch: '', groupItems: [], selected: new Set(), onGroupChanged: null,
        formatChecked: null, formatUpdatedAt: null, renderUserCell: null, renderPlaylistOwnerCell: null,
        preferences: { group_order: [], channel_orders: {}, playlist_orders: {} }, preferencesLoaded: false,
        preferenceQueue: Promise.resolve(), writePending: 0, scope: 0, drag: null, scrollFrame: null,
        groupSelected: new Set(), playlistSelected: new Set(), focusKind: 'channels', anchors: {}, cut: null,
        runPlaylistAction: null, copyLinks: null, previewImage: null, exportChannels: null, sort: null,
        widths: null, resize: null
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
        return typeof error?.message === 'string' ? error.message : 'Không thể thực hiện yêu cầu. Vui lòng thử lại.';
    }
    function api(path, method = 'GET', body, signal) {
        if (!state.request) return Promise.reject(new Error('ChannelPlaylists.init() chưa được gọi.'));
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
        if (!host) throw new Error('Thiếu #channels-panel.');
        if (state.host === host && host.querySelector('.playlist-hero')) return;
        state.host = host;
        host.classList.add('chp-root');
        state.tools = document.getElementById('channel-header-tools');
        if (!state.tools) throw new Error('Thiếu #channel-header-tools trong .topbar.');
        state.tools.classList.add('chp-header-tools', 'flex', 'items-center', 'gap-4');
        state.tools.innerHTML = `<div class="relative group"><span class="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-secondary-text text-xl">search</span><input class="chp-search search-pill bg-row-hover border-none rounded-full pl-10 pr-4 py-2 text-sm w-64 focus:ring-1 focus:ring-primary placeholder:text-secondary-text transition-all" type="search" placeholder="Tìm kênh YouTube" aria-label="Tìm kênh YouTube"></div>
            <button type="button" class="btn-ghost flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 hover:border-white transition-colors text-sm font-bold cursor-pointer" data-chp-action="refresh-all"><span class="material-icons-round text-lg">refresh</span>Refresh All</button>
            <button type="button" class="btn-accent flex items-center gap-2 px-6 py-2 rounded-full bg-primary hover:bg-primary/90 text-white transition-all text-sm font-bold cursor-pointer" data-chp-action="add"><span class="material-icons-round text-lg">add</span>Add Channel</button>
            <label class="chp-mobile-groups">Nhóm <select class="chp-groups" aria-label="Nhóm kênh"></select></label><button type="button" class="chp-new-group-toolbar btn-ghost text-sm font-bold" data-chp-action="new-group">New Group</button>`;
        state.tools.addEventListener('click', panelClick);
        host.innerHTML = `<section class="playlist-hero px-5 py-8 mb-0"><div class="flex items-end justify-between gap-6"><div><p class="text-[11px] uppercase tracking-[0.16em] text-secondary-text font-bold">Live Monitoring</p><h2 class="text-[30px] leading-none font-bold mt-2">Channel &amp; Playlist Monitoring</h2><p class="text-sm text-secondary-text mt-2">Theo dõi kênh YouTube và playlist Spotify liên kết.</p></div><div class="chp-kpis flex items-center gap-4 text-xs">${['Channels', 'Active', 'Errors', 'Crawling', 'Selected'].map(key => `<span class="hero-kpi"><b data-chp-kpi="${key}">0</b><em>${key}</em></span>`).join('')}</div></div></section>
            <div class="chp-key-warning" hidden></div><div class="chp-status" role="status" aria-live="polite"></div><div class="chp-list" aria-label="Danh sách kênh"></div>`;
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
            if (event.target.closest('a, button, input, select')) return;
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
        for (const row of state.host.querySelectorAll('[data-chp-channel]')) {
            const selected = state.selected.has(row.dataset.chpChannel);
            row.classList.toggle('row-selected', selected); row.setAttribute('aria-selected', String(selected));
        }
        for (const row of state.host.querySelectorAll('[data-chp-playlist]')) {
            const selected = state.playlistSelected.has(row.dataset.chpPlaylist);
            row.classList.toggle('row-selected', selected); row.setAttribute('aria-selected', String(selected));
        }
        for (const row of state.rail?.querySelectorAll('[data-chp-group]') || []) row.classList.toggle('chp-group-multi', state.groupSelected.has(row.dataset.chpGroup));
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
        const ownChannel = item.user_id === state.getUser()?.id;
        const settings = item.error_code === 'no_api_keys' ? ownChannel ? '<button type="button" data-chp-action="settings">Mở Settings để thêm key</button>' : '<small class="chp-error">Chủ kênh cần thêm key trong Settings của họ.</small>' : '';
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
            <div class="list-asset-cell flex items-center gap-4">${image(item.image)}<div><span class="list-type-badge badge-playlist">playlist</span><h3 class="list-asset-title">${link(item.spotify_url || `https://open.spotify.com/playlist/${encodeURIComponent(item.spotify_id || '')}`, playlistTitle(item))}</h3><div class="list-asset-meta"><p class="list-asset-uri text-secondary-text">spotify:playlist:${escapeHtml(item.spotify_id || '')}</p></div></div></div>
            ${state.renderPlaylistOwnerCell ? state.renderPlaylistOwnerCell(item) : `<div class="meta-cell playlist-owner-cell">${link(item.owner_url, item.owner_name || '-')}</div>`}
            <div class="meta-cell chp-numeric"><div class="metric-stack"><span class="metric-main">${number(item.saves ?? item.followers)}</span>${metricDelta(item.followers_delta, item.delta_days)}</div></div><div class="meta-cell chp-numeric"><div class="metric-stack"><span class="metric-main">${number(item.track_count)}</span>${metricDelta(item.track_count_delta, item.delta_days)}</div></div><div class="meta-cell text-right">${checked(item)}</div></div>`;
    }
    function metricDelta(value, days) {
        if (value == null) return '';
        const label = `${value > 0 ? '+' : ''}${number(value)}${days == null ? '' : ` trong ${number(days)} ngày`}`;
        return `<span title="${escapeHtml(label)}" class="chp-delta metric-delta ${value > 0 ? 'metric-delta-up' : value < 0 ? 'metric-delta-down' : 'metric-delta-flat'}"><span class="material-icons-round">${value > 0 ? 'north' : value < 0 ? 'south' : 'remove'}</span><span>${value > 0 ? '+' : ''}${number(value)}${days == null ? '' : `/${number(days)}`}</span></span>`;
    }
    function channelRow(item, index) {
        const collapsed = state.collapsed.has(item.id);
        const url = item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${encodeURIComponent(item.youtube_id)}` : item.query);
        return `<section data-chp-block="${escapeHtml(item.id)}"><div class="list-grid"><div class="custom-grid-row chp-grid chp-channel px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group ${state.selected.has(item.id) ? 'row-selected' : ''}" data-chp-channel="${escapeHtml(item.id)}" draggable="true" tabindex="0" aria-selected="${state.selected.has(item.id)}">
            <div class="meta-cell stt-cell text-secondary-text">${index + 1}</div><div class="list-asset-cell flex items-center gap-4">${image(item.image)}<div><div class="chp-channel-labels"><span class="list-type-badge">channel</span><span class="chp-playlist-count text-secondary-text">${(item.playlists || []).length} playlists</span></div><h3 class="list-asset-title">${link(url, item.name || item.query || 'Kênh YouTube')}</h3><div class="list-asset-meta"><p class="list-asset-uri text-secondary-text">${escapeHtml(item.youtube_id || item.query || '')}</p></div></div></div>
            <div class="meta-cell chp-owner-empty" aria-hidden="true"></div><div class="meta-cell"><span class="metric-main">${number(item.view_count)}</span></div><div class="meta-cell">${metricDelta(item.view_count_delta, item.delta_days) || '<span class="metric-empty">-</span>'}</div><div class="meta-cell text-right">${checked(item)}</div></div></div>
            <div class="chp-children"${collapsed ? ' hidden' : ''} aria-label="Playlists của ${escapeHtml(item.name || item.query)}"><div class="list-grid">${(item.playlists || []).map((playlist, position) => playlistRow(playlist, position, item.id)).join('') || '<p class="chp-empty">Chưa liên kết playlist. Nhấp chuột phải vào kênh để chọn Edit playlists.</p>'}</div></div></section>`;
    }
    function listHead(labels, grid, filter = false) {
        const keys = ['', 'name', '', 'view_count', 'view_count_delta', 'last_checked'];
        return `<div class="list-head pt-0 pb-0"><div class="list-columns-head custom-grid-row ${grid} px-4 py-3 text-[13px] font-medium">${labels.map((label, index) => `<div class="meta-cell head-cell" data-col-key="${index === 0 ? 'stt' : index === 1 ? 'asset' : label === 'Checked' ? 'checked' : ''}"><span class="head-cell-label">${label}</span>${keys[index] ? `<button type="button" class="metric-sort-mode-toggle ${state.sort?.key === keys[index] ? 'is-active' : ''}" data-chp-sort="${keys[index]}" aria-label="Sắp xếp ${label}" title="Tăng dần / giảm dần / thứ tự thủ công"><span class="metric-sort-triangle">${state.sort?.key === keys[index] && state.sort.direction === 1 ? '▲' : '▼'}</span></button>` : ''}${filter && label === 'Checked' ? `<div class="metric-sort-controls checked-sort-controls"><button type="button" class="metric-sort-mode-toggle ${state.filter !== 'all' ? 'is-active' : ''}" data-chp-action="filter" aria-label="Lọc trạng thái kênh" aria-haspopup="menu"><span class="metric-sort-triangle">▼</span></button></div>` : ''}<span class="column-resize-handle" data-chp-resize="${index}" role="separator" aria-orientation="vertical" aria-label="Đổi độ rộng ${label}" title="Kéo để đổi độ rộng; nhấp đúp để đặt lại"></span></div>`).join('')}</div></div>`;
    }
    function flushRender() {
        if (!state.visible || state.modal || state.menu || state.drag || state.resize) { state.pendingRender = true; return; }
        updateHero();
        notifyGroup();
        const list = state.host?.querySelector('.chp-list');
        if (!list || list.contains(document.activeElement)) { state.pendingRender = true; return; }
        const html = listHead(['STT', 'Channel', 'Owner', 'View', 'Delta / Days', 'Checked'], 'chp-grid', true) + (state.group && state.items.length ? state.items.map(channelRow).join('') : `<p class="chp-empty">${state.groups.length ? 'Chưa có kênh phù hợp. Thêm kênh hoặc đổi bộ lọc.' : 'Chọn New Group trong danh sách nhóm để bắt đầu.'}</p>`);
        if (list.innerHTML !== html) list.innerHTML = html;
        const select = state.tools.querySelector('.chp-groups');
        if (document.activeElement !== select) {
            const groups = new Map(state.groups.map(group => [group.name, group.count]));
            const options = groups.size ? [...groups].map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${number(count)})</option>`).join('') : '<option value="" disabled selected>Chưa có nhóm</option>';
            if (select.innerHTML !== options) select.innerHTML = options;
            select.disabled = !groups.size;
            select.value = state.group;
        }
        state.tools.querySelector('[data-chp-action="add"]').disabled = !state.group;
        renderRail();
        const warning = state.host.querySelector('.chp-key-warning');
        warning.hidden = state.hasKeys;
        const warningHtml = 'Tài khoản của bạn chưa có YouTube API key. <button type="button" data-chp-action="settings">Mở Settings</button>';
        if (!state.hasKeys && warning.innerHTML !== warningHtml) warning.innerHTML = warningHtml;
        state.pendingRender = false;
    }
    function renderRail() {
        const rail = document.getElementById('channel-group-rail');
        if (!rail) return;
        if (state.rail !== rail) {
            state.rail = rail;
            rail.classList.add('chp-group-rail');
            rail.addEventListener('click', event => {
                if (event.target.closest('[data-chp-action="new-group"]')) { openNewGroup(); return; }
                const button = event.target.closest('[data-chp-group]');
                if (!button) return;
                const name = button.dataset.chpGroup;
                selectRows('groups', name, event);
                if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                state.group = name; changeScope();
            });
            rail.addEventListener('dblclick', event => { const name = event.target.closest('[data-chp-group]')?.dataset.chpGroup; if (name) renameGroup(name); });
            rail.addEventListener('contextmenu', event => {
                event.preventDefault(); const name = event.target.closest('[data-chp-group]')?.dataset.chpGroup;
                if (name && !state.groupSelected.has(name)) selectRows('groups', name);
                openGroupMenu(name, event.clientX, event.clientY);
            });
            bindDrag(rail);
            rail.addEventListener('focusout', () => setTimeout(flushRender, 0));
        }
        const tools = document.getElementById('channel-group-tools');
        if (tools && state.groupTools !== tools) {
            state.groupTools = tools;
            tools.innerHTML = `<h2 class="text-[11px] font-bold uppercase tracking-[0.15em] text-white">Groups</h2><div class="relative"><span class="material-icons-round absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary-text text-[18px]">search</span><input type="search" class="chp-group-search w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-secondary-text focus:outline-none focus:border-primary/50 focus:bg-white/[0.08] transition-all" placeholder="Search groups..." aria-label="Tìm nhóm kênh"></div>`;
            tools.querySelector('input').addEventListener('input', event => { state.groupSearch = event.target.value.trim(); renderRail(); });
        }
        if (tools) tools.hidden = !state.visible;
        rail.hidden = !state.visible;
        for (const button of rail.querySelectorAll('[data-chp-group]')) {
            const active = button.dataset.chpGroup === state.group;
            button.setAttribute('aria-pressed', String(active)); button.classList.toggle('group-item-selected', active);
            const count = button.querySelector('.group-count');
            if (count) {
                count.classList.toggle('bg-primary/20', active); count.classList.toggle('text-primary', active);
                count.classList.toggle('bg-white/10', !active); count.classList.toggle('text-secondary-text', !active);
            }
        }
        if (rail.contains(document.activeElement)) return;
        const groups = new Map(state.groups.map(group => [group.name, group.count]));
        const html = [...groups].filter(([name]) => name.toLocaleLowerCase().includes(state.groupSearch.toLocaleLowerCase())).map(([name, count]) => `<button type="button" class="group-item ${state.group === name ? 'group-item-selected' : ''} w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors text-secondary-text hover:text-white hover:bg-white/5" data-chp-group="${escapeHtml(name)}" aria-pressed="${state.group === name}"><div class="flex items-center gap-3 min-w-0"><span class="material-icons-round text-secondary-text text-sm">folder</span><span class="font-medium truncate">${escapeHtml(name)}</span></div><div class="group-item-actions flex items-center gap-2"><span class="group-count text-xs font-bold ${state.group === name ? 'bg-primary/20 text-primary' : 'bg-white/10 text-secondary-text'} px-2 py-0.5 rounded-full">${number(count)}</span></div></button>`).join('');
        const content = `<div class="chp-group-list space-y-1">${html}</div><button type="button" class="chp-new-group w-full flex items-center gap-3 px-3 py-3 rounded-lg text-secondary-text hover:text-primary transition-colors mt-4 cursor-pointer" data-chp-action="new-group"><span class="material-icons-round text-sm">add</span><span class="font-medium">New Group</span></button>`;
        if (rail.innerHTML !== content) rail.innerHTML = content;
        for (const row of rail.querySelectorAll('[data-chp-group]')) { row.draggable = true; row.classList.toggle('chp-group-multi', state.groupSelected.has(row.dataset.chpGroup)); }
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
        if (!quiet) message('Đang tải kênh…');
        try {
            const data = await api(query(), 'GET', undefined, controller.signal);
            if (generation !== state.generation || !state.visible) return;
            if (!Array.isArray(data?.items)) throw new Error('Phản hồi danh sách kênh không hợp lệ.');
            if (!state.writePending || !state.preferencesLoaded) {
                const prefs = await api('/youtube/preferences', 'GET', undefined, controller.signal);
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
            if (!Array.isArray(data?.items)) throw new Error('Phản hồi danh sách kênh không hợp lệ.');
            for (const item of data.items) if (String(item.user_id) === state.userId) merged.set(item.id, item);
            offset += data.items.length;
            if (offset >= Number(data.total) || (!data.total && data.items.length < PAGE_SIZE)) break;
            if (!data.items.length) throw new Error('Danh sách kênh chưa tải đủ. Vui lòng thử lại.');
            data = await api(query(offset, unfiltered), 'GET', undefined, signal);
        }
        return [...merged.values()];
    }
    function notifyItems() {
        try { Promise.resolve(state.onItemChanged?.()).catch(() => {}); } catch (_) { /* Shell callback must not mask a successful mutation. */ }
    }
    async function mutate(button, path, method, body, affectsItems = false) {
        const generation = state.generation;
        if (button) button.disabled = true;
        try {
            await api(path, method, body);
            if (affectsItems) notifyItems();
            if (generation === state.generation && state.visible) { await reload(); message('Đã gửi yêu cầu.'); }
        } catch (error) { if (generation === state.generation) message(errorText(error), true); }
        finally { if (button?.isConnected) button.disabled = false; }
    }
    async function refreshAll(button) {
        if (state.bulkBusy) return;
        if (!state.group) { message('Không có kênh để refresh. Tạo và chọn nhóm trước.'); return; }
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
            if (generation === state.generation) { await reload(); message(all.length ? `Đã yêu cầu refresh ${all.length} kênh.` : 'Không có kênh để refresh.'); }
        } catch (error) { if (generation === state.generation) message(errorText(error), true); }
        finally { state.bulkBusy = false; if (button.isConnected) button.disabled = false; }
    }
    function setPlaylistCollapsed(id, collapse) {
        if (collapse) state.collapsed.add(id); else state.collapsed.delete(id);
        const block = [...state.host.querySelectorAll('[data-chp-block]')].find(node => node.dataset.chpBlock === id);
        if (block) block.querySelector('.chp-children').hidden = collapse;
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
        else if (action === 'new-group') openNewGroup();
        else if (action === 'settings') {
            const nav = document.getElementById('nav-settings');
            if (nav) nav.click(); else message('Mở Settings trong menu ứng dụng để cấu hình YouTube API keys.');
        }
        else if (action === 'refresh-all') refreshAll(button);
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
        return ['all', 'changed', 'errors'].map((filter, index) => `<button type="button" role="menuitemradio" aria-checked="${state.filter === filter}" class="row-context-item ${state.filter === filter ? 'is-active' : ''}" data-filter="${filter}"><span class="material-icons-round">${state.filter === filter ? 'check' : 'filter_list'}</span>${['Tất cả', 'Có thay đổi', 'Có lỗi'][index]}</button>`).join('');
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
        const current = () => scope === state.scope && owner === state.userId && owner === String(state.getUser()?.id || '') && state.visible;
        const job = state.preferenceQueue.then(async () => {
            if (!current()) return;
            await api('/youtube/preferences', 'PUT', patch);
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
        try { if (!document.execCommand('copy')) throw new Error('Không thể sao chép liên kết.'); }
        finally { input.remove(); focus?.focus(); }
    }
    const channelUrl = item => item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${encodeURIComponent(item.youtube_id)}` : item.query);
    function copyChannels(items = selectedChannels()) { return copyText(items.map(channelUrl).filter(value => /^https?:\/\//i.test(value || '')).join('\n')); }
    function runAction(action) {
        const items = [...new Map(selectedPlaylists().map(({ item }) => [item.id, item])).values()];
        if (!items.length) return;
        if (!state.runPlaylistAction) { message('Chức năng playlist chưa được kết nối với ứng dụng.', true); return; }
        const scope = state.scope;
        Promise.resolve().then(() => { if (scope === state.scope && state.userId === String(state.getUser()?.id || '')) return state.runPlaylistAction(action, items); }).then(() => {
            if (scope === state.scope && action === 'fetch-selected') { notifyItems(); return reload(); }
        }).catch(error => { if (scope === state.scope) message(errorText(error), true); });
    }
    function actionMenu(actions, x, y, run) {
        const icons = { new: 'add', rename: 'edit', delete: 'delete', clear: 'clear_all',
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
    function renameGroup(name) {
        const scope = state.scope;
        dialog('Đổi tên nhóm', `<label>Tên nhóm<input name="name" required maxlength="128" value="${escapeHtml(name)}"></label>`, 'Lưu', async node => {
            const new_name = node.querySelector('[name="name"]').value.trim();
            if (!new_name || new_name.toLowerCase() === 'all') throw new Error('Nhập tên nhóm thực tế.');
            await api('/youtube/groups', 'PATCH', { old_name: name, new_name });
            if (scope !== state.scope) return;
            state.preferencesLoaded = false;
            state.groupSelected.delete(name); state.groupSelected.add(new_name);
            if (state.group === name) state.group = new_name;
        });
    }
    function deleteGroups() {
        const names = visibleIds('groups').filter(name => state.groupSelected.has(name));
        if (!names.length) return;
        const scope = state.scope;
        dialog('Xóa nhóm', `<p>Xóa ${names.length} nhóm đã chọn? Kênh được chuyển vào Ungrouped, Spotify Item vẫn được giữ nguyên.</p>`, 'Xóa nhóm', async () => {
            for (let offset = 0; offset < names.length; offset += 500) {
                if (scope !== state.scope) return;
                await api('/youtube/groups/delete', 'POST', { names: names.slice(offset, offset + 500) });
            }
            if (scope === state.scope) { state.groupSelected.clear(); state.preferencesLoaded = false; }
        });
    }
    function openGroupMenu(name, x, y) {
        const actions = [['new', 'New Group']];
        if (name) actions.push(['rename', 'Đổi tên nhóm'], ['delete', 'Xóa nhóm đã chọn']);
        if (name === state.group) actions.push(['clear', 'Clear Group']);
        actionMenu(actions, x, y, action => {
            if (action === 'new') openNewGroup();
            if (action === 'rename') renameGroup(name);
            if (action === 'delete') deleteGroups();
            if (action === 'clear') clearGroup();
        });
    }
    function clearGroup() {
        const name = state.group;
        if (!name || !state.groupItems.length) return;
        dialog('Clear Group', `<p>Xóa toàn bộ ${state.groupItems.length} kênh YouTube trong ${escapeHtml(name)}? Nhóm và Spotify Item vẫn được giữ nguyên.</p>`, 'Xóa kênh', () => api('/youtube/groups/clear', 'POST', { name }));
    }
    function deleteChannels(items = selectedChannels()) {
        const ids = items.filter(item => String(item.user_id) === state.userId).map(item => item.id);
        if (!ids.length) return;
        const scope = state.scope;
        dialog('Xóa kênh', `<p>Xóa ${ids.length} kênh YouTube? Các Spotify Item đã liên kết vẫn được giữ nguyên.</p>`, 'Xóa kênh', async () => {
            for (let offset = 0; offset < ids.length; offset += 500) {
                if (scope !== state.scope) return;
                await api('/youtube/channels/delete', 'POST', { channel_ids: ids.slice(offset, offset + 500) });
            }
        });
    }
    async function moveChannels(ids, group, owner = state.userId) {
        if (!ids.length || owner !== state.userId || owner !== String(state.getUser()?.id || '') || !state.groups.some(row => row.name === group)) return;
        const scope = state.scope;
        invalidate();
        state.writePending++;
        try {
            for (let offset = 0; offset < ids.length; offset += 500) {
                if (scope !== state.scope || owner !== String(state.getUser()?.id || '')) return;
                await api('/youtube/channels/move', 'POST', { channel_ids: ids.slice(offset, offset + 500), group });
            }
            if (scope !== state.scope || owner !== state.userId) return;
            state.cut = null; state.preferencesLoaded = false;
            await reload();
        } catch (error) { if (scope === state.scope) { await reload(); message(errorText(error), true); } }
        finally { state.writePending--; }
    }
    function unlinkPlaylists() {
        const pairs = selectedPlaylists();
        if (!pairs.length) return;
        const channels = new Map();
        for (const { channel, item } of pairs) {
            if (!channels.has(channel.id)) channels.set(channel.id, { channel, ids: new Set() });
            channels.get(channel.id).ids.add(item.id);
        }
        const scope = state.scope;
        dialog('Gỡ liên kết playlist', `<p>Gỡ ${pairs.length} liên kết đã chọn? Spotify Item không bị xóa.</p>`, 'Gỡ liên kết', async () => {
            for (const [id, { channel, ids }] of channels) {
                if (scope !== state.scope) return;
                const item_ids = (channel.playlists || []).filter(item => !ids.has(item.id)).map(item => item.id);
                if (item_ids.length > 500) throw new Error('Tối đa 500 playlist trong mỗi lần lưu liên kết.');
                await api(`/youtube/channels/${encodeURIComponent(id)}/playlists`, 'PUT', { item_ids, urls: [] });
            }
            notifyItems(); state.playlistSelected.clear();
        });
    }
    function openPlaylistMenu(row, x, y) {
        if (!state.playlistSelected.has(row.dataset.chpPlaylist)) selectRows('playlist', row.dataset.chpPlaylist);
        state.focusKind = 'playlist';
        actionMenu([['copy-selected-links', 'Copy Link'], ['fetch-selected', 'Refresh playlists đã chọn'], ['unlink', 'Gỡ liên kết khỏi kênh'], ['delete-link', 'Xoá link Spotify khỏi app'], ['clipboard-auto', 'Clipboard Playlist'], ['txt-playlist-type3', 'Export TXT'], ['export-listview-excel', 'Export Excel']], x, y, action => action === 'unlink' ? unlinkPlaylists() : action === 'delete-link' ? deleteSpotifyLinks() : runAction(action));
    }
    function deleteSpotifyLinks() {
        const items = [...new Map(selectedPlaylists().map(({ item }) => [item.id, item])).values()];
        if (!items.length || !state.runPlaylistAction) return;
        const owner = state.userId, scope = state.scope;
        dialog('Xoá link Spotify khỏi app', `<p>Xoá hẳn ${items.length} playlist khỏi Link Checker và mọi kênh đang gắn? Dữ liệu theo dõi của các link này sẽ bị xoá. Hành động này không xoá playlist trên Spotify.</p><p class="chp-muted">Nếu chỉ muốn bỏ khỏi kênh này, hãy huỷ và chọn Gỡ liên kết khỏi kênh.</p>`, 'Xoá link', async () => {
            if (scope !== state.scope || owner !== String(state.getUser()?.id || '')) return;
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
            if (scope === state.scope) { await reload(); message(`Đã yêu cầu refresh ${ids.length} kênh.`); }
        } catch (error) { if (scope === state.scope) message(errorText(error), true); }
        finally { state.bulkBusy = false; }
    }
    async function exportChannelList() {
        const items = selectedChannels().length ? selectedChannels() : state.items;
        if (state.exportChannels) return state.exportChannels(items);
        const cell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
        const content = [['Channel', 'URL', 'View', 'Delta', 'Checked'], ...items.map(item => [item.name || item.query, channelUrl(item), item.view_count, item.view_count_delta, item.last_checked])].map(row => row.map(cell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'youtube-channels.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function openMenu(id, x, y) {
        closeMenu();
        const item = state.items.find(row => row.id === id);
        if (!item) return;
        if (!state.selected.has(id)) selectChannel(id);
        state.focusKind = 'channels';
        const actions = [['add', 'add', 'Add Channel'], ...(state.selected.size === 1 ? [['edit', 'edit', 'Edit playlists']] : []), ['refresh', 'refresh', 'Refresh kênh'], ['playlists', 'refresh', 'Refresh playlists'], ['move', 'drive_file_move', 'Move To Group'], ['copy', 'content_copy', 'Copy Links'], ['export', 'download', 'Export List CSV'], ['clear', 'delete', 'Clear Group'], ['toggle', 'unfold_more', 'Mở / thu playlists'], ['expand', 'unfold_more', 'Mở tất cả'], ['collapse', 'unfold_less', 'Thu tất cả'], ['delete', 'delete', 'Xóa kênh']];
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
    function widthKey() { return `spoticheck_channel_column_widths_${state.userId}`; }
    function loadWidths() {
        state.widths = null;
        try {
            const widths = JSON.parse(localStorage.getItem(widthKey()));
            if (Array.isArray(widths) && widths.length === 6 && widths.every(value => Number.isFinite(value))) state.widths = widths.map(value => Math.min(800, Math.max(48, value)));
        } catch (_) { /* Private browsing can disable storage. */ }
        applyWidths();
    }
    function applyWidths() {
        if (!state.host) return;
        if (state.widths) state.host.style.setProperty('--chp-columns', state.widths.map(value => `${value}px`).join(' '));
        else state.host.style.removeProperty('--chp-columns');
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
        const widths = [...handle.closest('.custom-grid-row').children].map(node => Math.min(800, Math.max(48, node.getBoundingClientRect().width)));
        const index = Number(handle.dataset.chpResize), scope = state.scope, owner = state.userId, startX = event.clientX;
        const controller = new AbortController();
        state.resize = { controller }; document.body.classList.add('chp-resizing');
        const move = event => {
            if (scope !== state.scope || owner !== String(state.getUser()?.id || '')) { cancelResize(); return; }
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
        if (!drag || drag.scope !== state.scope || drag.owner !== String(state.getUser()?.id || '') || state.sort) return null;
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
                state.groups = ordered(state.groups, ids); persistPreferences({ group_order: ids });
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
        if (!state.visible || state.host?.hidden || state.modal || state.menu || state.userId !== String(state.getUser()?.id || '') || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return;
        const focus = document.activeElement;
        if (focus?.closest('[data-chp-playlist]')) state.focusKind = 'playlist';
        else if (focus?.closest('[data-chp-channel]')) state.focusKind = 'channels';
        else if (state.rail?.contains(focus)) state.focusKind = 'groups';
        else if (focus !== document.body && !state.host?.contains(focus) && !state.tools?.contains(focus)) return;
        const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase(), kind = state.focusKind;
        let run;
        if (modifier && key === 'a') run = () => { const selected = selection(kind); selected.clear(); visibleIds(kind).forEach(id => selected.add(id)); paintSelection(); };
        if (key === 'escape') run = () => { state.selected.clear(); state.playlistSelected.clear(); state.groupSelected.clear(); state.cut = null; paintSelection(); };
        if (key === 'delete' && selection(kind).size) run = () => kind === 'playlist' ? unlinkPlaylists() : kind === 'groups' ? deleteGroups() : deleteChannels();
        if (key === 'f2' && kind === 'groups' && state.groupSelected.size === 1) run = () => renameGroup([...state.groupSelected][0]);
        if (modifier && key === 'c' && kind !== 'groups' && selection(kind).size) run = () => kind === 'playlist' ? runAction('copy-selected-links') : copyChannels().catch(error => message(errorText(error), true));
        if (modifier && key === 'x' && kind === 'channels' && state.selected.size) run = () => { state.cut = { owner: state.userId, ids: selectedChannels().map(item => item.id) }; message('Đã cắt kênh. Chọn nhóm đích và nhấn Ctrl/Cmd+V.'); };
        if (modifier && key === 'v' && state.cut && state.group) run = () => moveChannels(state.cut.ids, state.group, state.cut.owner);
        if (!run) return;
        event.preventDefault(); event.stopImmediatePropagation(); run();
    }
    document.addEventListener('keydown', keyboard, true);
    function dialog(title, content, submitLabel, submit) {
        closeMenu(); closeModal();
        invalidate();
        const node = document.createElement('div'); node.className = 'chp-backdrop';
        node.innerHTML = `<section class="chp-dialog" role="dialog" aria-modal="true" aria-labelledby="chp-dialog-title"><form><header><h2 id="chp-dialog-title">${escapeHtml(title)}</h2><button type="button" data-close aria-label="Đóng">×</button></header><div class="chp-dialog-body">${content}</div><p class="chp-dialog-status" role="status" aria-live="polite"></p><footer><button type="button" data-close>Hủy</button><button type="submit" class="chp-primary">${escapeHtml(submitLabel)}</button></footer></form></section>`;
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
            const status = node.querySelector('.chp-dialog-status'); status.textContent = 'Đang xử lý…';
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
    function openNewGroup() {
        const ownerId = state.userId;
        dialog('Tạo nhóm Channel & Playlist', '<label>Tên nhóm (bắt buộc)<input name="name" required maxlength="128" placeholder="Nhập tên nhóm"></label>', 'Tạo nhóm', async (node, modal) => {
            const name = node.querySelector('[name="name"]').value.trim();
            if (!name || name.toLowerCase() === 'all') throw new Error('Nhập tên nhóm thực tế, không dùng All.');
            await api('/youtube/groups', 'POST', { name, ...(ownerId ? { target_user_id: ownerId } : {}) });
            if (state.modal !== modal || state.userId !== ownerId) return;
            invalidate();
            state.group = name; state.offset = 0; state.items = []; state.total = 0;
            modal.focus = state.tools?.querySelector('.chp-search');
            return 'Đã tạo nhóm.';
        });
    }
    function openAdd() {
        if (!state.group) { message('Tạo và chọn nhóm trước khi thêm kênh.'); return; }
        const ownerId = state.userId;
        dialog('Thêm kênh YouTube', `<label>Nhóm (bắt buộc)<input name="group" list="chp-group-options" required maxlength="128" value="${escapeHtml(state.group)}" placeholder="Chọn nhóm hoặc nhập nhóm mới"></label><datalist id="chp-group-options">${state.groups.map(group => `<option value="${escapeHtml(group.name)}"></option>`).join('')}</datalist><label>URL kênh, mỗi dòng một URL<textarea name="urls" rows="7" required placeholder="https://www.youtube.com/@channel"></textarea></label>`, 'Thêm kênh', async node => {
            const group = node.querySelector('[name="group"]').value.trim();
            const urls = lines(node.querySelector('[name="urls"]').value);
            if (!group || group.toLowerCase() === 'all' || !urls.length) throw new Error('Chọn nhóm thực tế (không phải All) và nhập ít nhất một URL kênh.');
            if (urls.length > 500) throw new Error('Tối đa 500 URL mỗi lần.');
            const data = await api('/youtube/channels', 'POST', { urls, group, ...(ownerId ? { target_user_id: ownerId } : {}) });
            return `Đã thêm: ${number(data.accepted ?? data.items?.length ?? 0)}; bỏ qua: ${number(Array.isArray(data.skipped) ? data.skipped.length : data.skipped ?? 0)}.`;
        });
    }
    function openDelete(item) {
        dialog('Xóa kênh', `<p>Xóa ${escapeHtml(item.name || item.query)}? Các Spotify Item đã liên kết vẫn được giữ nguyên.</p>`, 'Xóa kênh', () => api(`/youtube/channels/${encodeURIComponent(item.id)}`, 'DELETE'));
    }
    async function openEdit(item) {
        if (String(item.user_id) !== state.userId || state.userId !== String(state.getUser()?.id || '')) return;
        const selected = new Map((item.playlists || []).map(playlist => [playlist.id, playlist]));
        const chosen = new Set(selected.keys());
        const modal = dialog(`Edit playlists · ${item.name || item.query}`, '<p class="chp-muted">Bỏ chọn chỉ gỡ liên kết, không xóa Spotify Item.</p><div class="chp-picker-filters"><label>Nhóm Spotify<select name="picker_group" aria-label="Nhóm playlist" disabled><option value="">Tất cả nhóm</option></select></label><label>Tìm playlist<div class="chp-picker-search-wrap"><span class="material-icons-round" aria-hidden="true">search</span><input name="picker_search" type="search" aria-label="Tìm playlist" placeholder="Tên, owner, ID hoặc link playlist" disabled></div></label></div><p class="chp-picker-count chp-muted" role="status"></p><div class="chp-picker" aria-busy="true">Đang tải playlist của chủ kênh…</div><label>Dán URL playlist, mỗi dòng một URL<textarea name="urls" rows="5" placeholder="https://open.spotify.com/playlist/…"></textarea></label>', 'Lưu liên kết', async node => {
            if (!loaded) throw new Error('Danh sách playlist chưa tải xong.');
            const item_ids = [...chosen];
            const urls = lines(node.querySelector('[name="urls"]').value);
            if (item_ids.length > 500 || urls.length > 500) throw new Error('Tối đa 500 playlist hoặc URL mỗi lần.');
            await api(`/youtube/channels/${encodeURIComponent(item.id)}/playlists`, 'PUT', { item_ids, urls });
            notifyItems();
        });
        let loaded = false;
        const picker = modal.node.querySelector('.chp-picker');
        const button = modal.node.querySelector('[type="submit"]'); button.disabled = true;
        try {
            if (!item.user_id) throw new Error('Kênh không có user_id; không thể tải playlist đúng chủ sở hữu.');
            for (let offset = 0; ; offset += 500) {
                const params = new URLSearchParams({ type: 'playlist', user_id: item.user_id, limit: '500', offset: String(offset) });
                const data = await api(`/items?${params}`, 'GET', undefined, modal.controller.signal);
                if (state.modal !== modal) return;
                if (!Array.isArray(data?.items)) throw new Error('Phản hồi playlist không hợp lệ.');
                for (const playlist of data.items) if (String(playlist.user_id) === state.userId) selected.set(playlist.id, playlist);
                if (!data.items.length || offset + data.items.length >= data.total) break;
            }
            const groupSelect = modal.node.querySelector('[name="picker_group"]');
            const searchInput = modal.node.querySelector('[name="picker_search"]');
            const all = [...selected.values()];
            const groups = [...new Set(all.map(playlist => playlist.group || ''))].sort((a, b) => a.localeCompare(b, 'vi'));
            groupSelect.innerHTML = '<option value="">Tất cả nhóm</option>' + groups.map(name => `<option value="${escapeHtml('group:' + name)}">${escapeHtml(name || 'Chưa phân nhóm')}</option>`).join('');
            const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
            function renderPicker() {
                const query = normalize(searchInput.value.trim());
                const rows = all.filter(playlist => (!groupSelect.value || groupSelect.value === 'group:' + (playlist.group || ''))
                    && normalize([playlistTitle(playlist), playlist.owner_name, playlist.spotify_id, playlist.spotify_url].join(' ')).includes(query));
                picker.innerHTML = rows.map(playlist => {
                    const cover = safeUrl(playlist.image);
                    return `<label class="chp-pick"><input type="checkbox" name="playlist" value="${escapeHtml(playlist.id)}"${chosen.has(playlist.id) ? ' checked' : ''}>${cover ? `<img class="chp-pick-cover" src="${cover}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="chp-pick-cover chp-cover-empty" aria-hidden="true"></span>'}<span>${escapeHtml(playlistTitle(playlist))}<small class="chp-muted">${escapeHtml(playlist.group || 'Chưa phân nhóm')} · ${escapeHtml(playlist.spotify_id)}</small></span></label>`;
                }).join('') || '<p class="chp-muted">Không có playlist phù hợp. Đổi nhóm/từ khoá hoặc dán URL bên dưới.</p>';
                modal.node.querySelector('.chp-picker-count').textContent = `${rows.length}/${all.length} playlist · Đã chọn ${chosen.size}`;
            }
            picker.addEventListener('change', event => {
                const checkbox = event.target.closest('[name="playlist"]');
                if (!checkbox) return;
                if (checkbox.checked) chosen.add(checkbox.value); else chosen.delete(checkbox.value);
                modal.node.querySelector('.chp-picker-count').textContent = `${picker.querySelectorAll('[name="playlist"]').length}/${all.length} playlist · Đã chọn ${chosen.size}`;
            });
            searchInput.addEventListener('input', renderPicker);
            searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
            groupSelect.addEventListener('change', renderPicker);
            groupSelect.disabled = false; searchInput.disabled = false;
            renderPicker();
            loaded = true; button.disabled = false;
        } catch (error) {
            if (state.modal === modal && error.name !== 'AbortError') { picker.textContent = errorText(error); picker.classList.add('chp-error'); }
        } finally { picker.setAttribute('aria-busy', 'false'); }
    }
    async function showKeySettings(host) {
        host = typeof host === 'string' ? document.querySelector(host) : host || document.getElementById('youtube-key-settings');
        if (!host) return;
        const generation = ++state.settingsGeneration;
        const userId = state.getUser()?.id;
        const current = () => generation === state.settingsGeneration && state.getUser()?.id === userId;
        host.classList.add('chp-settings');
        host.textContent = 'Đang tải API keys của bạn…';
        try {
            // Never append the channel owner filter: keys always belong to the authenticated user.
            const data = await api('/youtube/keys');
            if (!current()) return;
            host.innerHTML = '<form><h3 class="chp-settings-title">YouTube API keys</h3><p class="chp-muted">Bật YouTube Data API v3 trong Google Cloud. Nếu giới hạn key theo nguồn gọi, dùng IP server VPS 82.197.71.6, không dùng browser-referrer. Giới hạn API về YouTube Data API v3.</p><label>API keys của bạn<textarea name="api_keys" rows="5" autocomplete="off" spellcheck="false" aria-describedby="chp-key-note"></textarea></label><p id="chp-key-note" class="chp-muted">Mỗi dòng một key. Hệ thống tự chuyển key khi hết quota. Chỉ quản lý keys của tài khoản đang đăng nhập; bộ lọc chủ kênh không thay đổi tài khoản này.</p><div class="chp-settings-actions"><button type="submit" class="chp-primary">Lưu keys</button><button type="button" data-check>Kiểm tra keys</button></div><p class="chp-key-status" role="status" aria-live="polite"></p></form>';
            const input = host.querySelector('textarea'); input.value = data.api_keys || '';
            const status = host.querySelector('.chp-key-status');
            let busy = false;
            async function run(check) {
                if (busy || !current()) return;
                busy = true;
                const buttons = [...host.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
                status.textContent = check ? 'Đang kiểm tra…' : 'Đang lưu…'; status.classList.remove('chp-error');
                try {
                    const result = await api(check ? '/youtube/keys/check' : '/youtube/keys', check ? 'POST' : 'PUT', { api_keys: input.value });
                    if (!current()) return;
                    // Display counts only; do not echo provider errors or summaries containing secrets.
                    if (check) {
                        const results = result?.results;
                        if (!Array.isArray(results)) throw new Error('Invalid key check response');
                        const labels = { valid: 'Hợp lệ', invalid: 'Không hợp lệ', quota_exceeded: 'Hết quota', error: 'Lỗi kiểm tra' };
                        const codes = { invalid_key: 'Key không hợp lệ', quota_exceeded: 'Hết quota', forbidden: 'Không có quyền truy cập API', network_error: 'Lỗi kết nối', rate_limited: 'Giới hạn tốc độ', api_unavailable: 'API tạm thời không khả dụng' };
                        status.textContent = results.length ? results.map((entry, index) => {
                            const label = typeof entry.valid === 'boolean' ? entry.valid ? 'Hợp lệ' : codes[entry.error_code] || 'Không hợp lệ / lỗi kiểm tra' : labels[entry.status] || codes[entry.error_code] || 'Không xác định';
                            return `Key ${Number.isInteger(entry.index) ? entry.index + 1 : index + 1}: ${label}`;
                        }).join(' · ') : 'Chưa nhập API key.';
                    } else status.textContent = 'Đã lưu keys.';
                } catch (_) { if (current()) { status.textContent = 'Không thể xử lý keys. Vui lòng thử lại.'; status.classList.add('chp-error'); } }
                finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
            }
            host.querySelector('form').addEventListener('submit', event => { event.preventDefault(); run(false); });
            host.querySelector('[data-check]').addEventListener('click', () => run(true));
        } catch (_) { if (current()) host.textContent = 'Không thể tải keys của bạn. Mở lại settings để thử lại.'; }
    }
    function syncAccountScope() {
        const next = String(state.getUser()?.id || '');
        if (state.userId === next) return;
        cancelResize(); closeModal(); closeMenu(); state.userId = next; loadWidths();
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
        if (state.rail) state.rail.hidden = true;
        if (state.tools) state.tools.hidden = true;
        if (state.groupTools) state.groupTools.hidden = true;
    }
    function init(options) {
        if (typeof options?.request !== 'function' || typeof options?.getUser !== 'function') throw new TypeError('init requires request and getUser functions');
        hide(); state.request = options.request; state.getUser = options.getUser; state.onItemChanged = options.onItemChanged; state.onGroupChanged = options.onGroupChanged;
        state.formatChecked = typeof options.formatChecked === 'function' ? options.formatChecked : null;
        state.formatUpdatedAt = typeof options.formatUpdatedAt === 'function' ? options.formatUpdatedAt : null;
        state.renderUserCell = typeof options.renderUserCell === 'function' ? options.renderUserCell : null;
        state.renderPlaylistOwnerCell = typeof options.renderPlaylistOwnerCell === 'function' ? options.renderPlaylistOwnerCell : null;
        for (const name of ['runPlaylistAction', 'copyLinks', 'previewImage', 'exportChannels']) state[name] = typeof options[name] === 'function' ? options[name] : null;
        state.settingsGeneration++;
        state.userId = ''; state.group = ''; state.search = ''; state.filter = 'all'; state.offset = 0;
        state.items = []; state.groupItems = []; state.groups = []; state.total = 0; state.collapsed.clear(); state.selected.clear(); state.groupSearch = '';
        state.preferencesLoaded = false; state.preferences = { group_order: [], channel_orders: {}, playlist_orders: {} };
        state.groupSelected.clear(); state.playlistSelected.clear(); state.anchors = {}; state.cut = null; state.sort = null; state.focusKind = 'channels';
        if (state.tools) state.tools.querySelector('.chp-search').value = '';
        if (state.groupTools) state.groupTools.querySelector('input').value = '';
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
    window.ChannelPlaylists = { init, show, hide, reload, showKeySettings, syncAccountScope };
}());
