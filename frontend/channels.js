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
        formatChecked: null, formatUpdatedAt: null, renderUserCell: null, renderPlaylistOwnerCell: null
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
            const row = event.target.closest('[data-chp-channel]');
            if (!row) return;
            event.preventDefault();
            openMenu(row.dataset.chpChannel, event.clientX, event.clientY);
        });
        host.addEventListener('keydown', event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
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
            if (event.target.closest('a, button, input, select')) return;
            const row = event.target.closest('[data-chp-channel]');
            if (row) selectChannel(row.dataset.chpChannel);
        });
        host.addEventListener('keydown', event => {
            if (event.target.matches('[data-chp-channel]') && [' ', 'Enter'].includes(event.key)) {
                event.preventDefault(); selectChannel(event.target.dataset.chpChannel);
            }
        });
        host.addEventListener('focusout', () => setTimeout(flushRender, 0));
    }
    function selectChannel(id) {
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        for (const row of state.host.querySelectorAll('[data-chp-channel]')) {
            const selected = state.selected.has(row.dataset.chpChannel);
            row.classList.toggle('row-selected', selected); row.setAttribute('aria-selected', String(selected));
        }
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
    function playlistRow(item, index) {
        return `<div class="custom-grid-row chp-playlist-grid px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group">
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
        return `<section data-chp-block="${escapeHtml(item.id)}"><div class="list-grid"><div class="custom-grid-row chp-grid chp-channel px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group ${state.selected.has(item.id) ? 'row-selected' : ''}" data-chp-channel="${escapeHtml(item.id)}" tabindex="0" aria-selected="${state.selected.has(item.id)}">
            <div class="meta-cell stt-cell text-secondary-text">${index + 1}</div><div class="list-asset-cell flex items-center gap-4">${image(item.image)}<div><div class="chp-channel-labels"><span class="list-type-badge">channel</span><span class="chp-playlist-count text-secondary-text">${(item.playlists || []).length} playlists</span></div><h3 class="list-asset-title">${link(url, item.name || item.query || 'Kênh YouTube')}</h3><div class="list-asset-meta"><p class="list-asset-uri text-secondary-text">${escapeHtml(item.youtube_id || item.query || '')}</p></div></div></div>
            <div class="meta-cell"><span class="metric-main">${number(item.view_count)}</span></div><div class="meta-cell">${metricDelta(item.view_count_delta, item.delta_days) || '<span class="metric-empty">-</span>'}</div><div class="meta-cell text-right">${checked(item)}</div></div></div>
            <div class="chp-children"${collapsed ? ' hidden' : ''} aria-label="Playlists của ${escapeHtml(item.name || item.query)}"><div class="list-grid">${(item.playlists || []).map(playlistRow).join('') || '<p class="chp-empty">Chưa liên kết playlist. Nhấp chuột phải vào kênh để chọn Edit playlists.</p>'}</div></div></section>`;
    }
    function listHead(labels, grid, filter = false) {
        return `<div class="list-head pt-0 pb-0"><div class="list-columns-head custom-grid-row ${grid} px-4 py-3 text-[13px] font-medium">${labels.map((label, index) => `<div class="meta-cell head-cell" data-col-key="${index === 0 ? 'stt' : index === 1 ? 'asset' : label === 'Checked' ? 'checked' : ''}"><span class="head-cell-label">${label}</span>${filter && label === 'Checked' ? `<div class="metric-sort-controls checked-sort-controls"><button type="button" class="metric-sort-mode-toggle ${state.filter !== 'all' ? 'is-active' : ''}" data-chp-action="filter" aria-label="Lọc trạng thái kênh" aria-haspopup="menu"><span class="metric-sort-triangle">▼</span></button></div>` : ''}</div>`).join('')}</div></div>`;
    }
    function flushRender() {
        if (!state.visible || state.modal || state.menu) return;
        updateHero();
        notifyGroup();
        const list = state.host?.querySelector('.chp-list');
        if (!list || list.contains(document.activeElement)) { state.pendingRender = true; return; }
        const html = listHead(['STT', 'Channel', 'View', 'Delta / Days', 'Checked'], 'chp-grid', true) + (state.group && state.items.length ? state.items.map(channelRow).join('') : `<p class="chp-empty">${state.groups.length ? 'Chưa có kênh phù hợp. Thêm kênh hoặc đổi bộ lọc.' : 'Chọn New Group trong danh sách nhóm để bắt đầu.'}</p>`);
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
                state.group = button.dataset.chpGroup; changeScope();
            });
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
    }
    function invalidate() {
        state.generation++;
        state.controller?.abort();
        state.loading = false;
    }
    function changeScope(resetGroup = false) {
        clearTimeout(state.debounce);
        invalidate();
        if (resetGroup) { state.group = ''; state.groups = []; state.collapsed.clear(); }
        state.offset = 0;
        state.items = []; state.groupItems = []; state.selected.clear(); state.total = 0;
        flushRender();
        return reload();
    }
    async function reload(quiet = false) {
        if (!state.visible || !state.host || (quiet && (state.loading || state.bulkBusy || state.modal || state.menu))) return;
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
            state.groups = (data.groups || []).filter(group => typeof group.name === 'string' && group.name.trim() && group.name.toLowerCase() !== 'all');
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
            state.items = items; state.groupItems = groupItems; state.total = items.length;
            const ids = new Set(items.map(item => item.id));
            state.selected = new Set([...state.selected].filter(id => ids.has(id)));
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
            for (const item of data.items) merged.set(item.id, item);
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
                for (const item of data.items || []) { ids.add(item.id); if (item.playlists?.length) linked.add(item.id); }
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
    function panelClick(event) {
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
                if (collapse) state.collapsed.add(id); else state.collapsed.delete(id);
                const block = [...state.host.querySelectorAll('[data-chp-block]')].find(node => node.dataset.chpBlock === id);
                if (block) block.querySelector('.chp-children').hidden = collapse;
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
    function openMenu(id, x, y) {
        closeMenu();
        const item = state.items.find(row => row.id === id);
        if (!item) return;
        const menu = createMenu([['edit', 'edit', 'Edit playlists'], ['refresh', 'refresh', 'Refresh kênh'], ['playlists', 'refresh', 'Refresh playlists'], ['toggle', 'unfold_more', 'Mở / thu playlists'], ['expand', 'unfold_more', 'Mở tất cả'], ['collapse', 'unfold_less', 'Thu tất cả'], ['delete', 'delete', 'Xóa kênh']].map(([action, icon, label]) => `<button type="button" role="menuitem" class="row-context-item ${action === 'delete' ? 'row-context-danger' : ''}" data-menu="${action}"><span class="material-icons-round">${icon}</span>${label}</button>`).join('') + '<div class="row-context-separator"></div>' + filterItems(), x, y);
        bindFilter(menu);
        menu.addEventListener('click', event => {
            const action = event.target.closest('[data-menu]')?.dataset.menu;
            if (!action) return;
            closeMenu();
            if (action === 'edit') openEdit(item);
            if (action === 'refresh') mutate(null, '/youtube/channels/refresh', 'POST', { channel_ids: [id] });
            if (action === 'playlists') mutate(null, `/youtube/channels/${encodeURIComponent(id)}/playlists/refresh`, 'POST', undefined, true);
            if (action === 'delete') openDelete(item);
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
    function dialog(title, content, submitLabel, submit) {
        closeMenu(); closeModal();
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
        const selected = new Map((item.playlists || []).map(playlist => [playlist.id, playlist]));
        const modal = dialog(`Edit playlists · ${item.name || item.query}`, '<p class="chp-muted">Bỏ chọn chỉ gỡ liên kết, không xóa Spotify Item.</p><div class="chp-picker" aria-busy="true">Đang tải playlist của chủ kênh…</div><label>Dán URL playlist, mỗi dòng một URL<textarea name="urls" rows="5" placeholder="https://open.spotify.com/playlist/…"></textarea></label>', 'Lưu liên kết', async node => {
            if (!loaded) throw new Error('Danh sách playlist chưa tải xong.');
            const item_ids = [...node.querySelectorAll('[name="playlist"]:checked')].map(input => input.value);
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
                for (const playlist of data.items) selected.set(playlist.id, playlist);
                if (!data.items.length || offset + data.items.length >= data.total) break;
            }
            const originalIds = new Set((item.playlists || []).map(playlist => playlist.id));
            picker.innerHTML = [...selected.values()].map(playlist => `<label class="chp-pick"><input type="checkbox" name="playlist" value="${escapeHtml(playlist.id)}"${originalIds.has(playlist.id) ? ' checked' : ''}><span>${escapeHtml(playlistTitle(playlist))}<small class="chp-muted">${escapeHtml(playlist.spotify_id)}</small></span></label>`).join('') || '<p class="chp-muted">Chủ kênh chưa có playlist. Có thể dán URL bên dưới.</p>';
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
    function setUserFilter(userId) {
        const next = userId ? String(userId) : '';
        if (state.userId === next) return;
        closeModal(); closeMenu(); state.userId = next;
        return changeScope(true);
    }
    function show(options = {}) {
        mount();
        if (Object.prototype.hasOwnProperty.call(options, 'userId')) setUserFilter(options.userId);
        state.visible = true; state.host.hidden = false;
        state.tools.hidden = false;
        renderRail();
        clearInterval(state.timer);
        state.timer = setInterval(() => { if (state.visible && !document.hidden && !state.host.hidden) reload(true); }, 8000);
        return reload();
    }
    function hide() {
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
        state.settingsGeneration++;
        state.userId = ''; state.group = ''; state.search = ''; state.filter = 'all'; state.offset = 0;
        state.items = []; state.groupItems = []; state.groups = []; state.total = 0; state.collapsed.clear(); state.selected.clear(); state.groupSearch = '';
        if (state.tools) state.tools.querySelector('.chp-search').value = '';
        if (state.groupTools) state.groupTools.querySelector('input').value = '';
        return window.ChannelPlaylists;
    }
    document.addEventListener('pointerdown', event => { if (state.menu && !state.menu.contains(event.target)) closeMenu(); });
    document.addEventListener('focusin', event => { if (state.menu && !state.menu.contains(event.target)) closeMenu(); });
    window.ChannelPlaylists = { init, show, hide, reload, showKeySettings, setUserFilter };
}());
