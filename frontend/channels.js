(function () {
    'use strict';

    const PAGE_SIZE = 50;
    const state = {
        request: null, getUser: () => null, onItemChanged: null, host: null,
        visible: false, userId: '', group: '', search: '', filter: 'all', offset: 0,
        items: [], groups: [], total: 0, collapsed: new Set(), generation: 0,
        controller: null, timer: null, debounce: null, modal: null, menu: null,
        loading: false, pendingRender: false, settingsGeneration: 0, rail: null, hasKeys: true, bulkBusy: false
    };
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
    const number = value => value == null ? '-' : new Intl.NumberFormat('vi-VN').format(value);
    const date = value => {
        if (!value) return '-';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('vi-VN');
    };
    function safeUrl(value) {
        try {
            const url = new URL(value);
            return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : '';
        } catch (_) { return ''; }
    }
    function link(value, title) {
        const url = safeUrl(value);
        return url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title);
    }
    function image(value) {
        const url = safeUrl(value);
        return url ? `<img class="chp-cover" src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="chp-cover chp-cover-empty" aria-hidden="true"></span>';
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
    function query(offset = state.offset) {
        const params = new URLSearchParams({ filter: state.filter, limit: String(PAGE_SIZE), offset: String(offset) });
        if (state.userId) params.set('user_id', state.userId);
        if (state.group) params.set('group', state.group);
        if (state.search) params.set('search', state.search);
        return `/youtube/channels?${params}`;
    }
    function message(text, isError = false) {
        const node = state.host?.querySelector('.chp-status');
        if (node) { node.textContent = text; node.classList.toggle('chp-error', isError); }
    }
    function mount() {
        const host = document.getElementById('channels-panel');
        if (!host) throw new Error('Thiếu #channels-panel.');
        if (state.host === host && host.querySelector('.chp-toolbar')) return;
        state.host = host;
        host.classList.add('chp-root');
        host.innerHTML = `<div class="chp-toolbar">
            <input class="chp-search" type="search" placeholder="Tìm kênh YouTube" aria-label="Tìm kênh YouTube">
            <label class="chp-inline">Nhóm <select class="chp-groups" aria-label="Nhóm kênh"><option value="" disabled selected>Chưa có nhóm</option></select></label>
            <button type="button" class="chp-new-group-toolbar" data-chp-action="new-group">New Group</button>
            <button type="button" class="chp-primary" data-chp-action="add">Add Channel</button>
            <button type="button" data-chp-action="refresh-all">Refresh All</button>
            <select class="chp-filter" aria-label="Trạng thái kênh"><option value="all">Tất cả</option><option value="changed">Có thay đổi</option><option value="errors">Có lỗi</option></select>
            <button type="button" data-chp-action="expand">Mở tất cả</button><button type="button" data-chp-action="collapse">Thu tất cả</button>
        </div><div class="chp-key-warning" hidden></div><div class="chp-status" role="status" aria-live="polite"></div>
        <div class="chp-list" aria-label="Danh sách kênh"></div>
        <div class="chp-pagination"><button type="button" data-chp-action="prev">Trước</button><span class="chp-page"></span><button type="button" data-chp-action="next">Sau</button></div>`;
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
        host.querySelector('.chp-search').addEventListener('input', event => {
            state.search = event.target.value.trim();
            invalidate();
            clearTimeout(state.debounce);
            state.debounce = setTimeout(() => changeScope(false), 300);
        });
        host.querySelector('.chp-groups').addEventListener('change', event => { state.group = event.target.value; changeScope(); });
        host.querySelector('.chp-filter').addEventListener('change', event => { state.filter = event.target.value; changeScope(); });
        host.addEventListener('focusout', () => setTimeout(flushRender, 0));
    }
    function checked(item) {
        const error = item.error_message || item.error;
        const ownChannel = item.user_id === state.getUser()?.id;
        const settings = item.error_code === 'no_api_keys' ? ownChannel ? '<button type="button" data-chp-action="settings">Mở Settings để thêm key</button>' : '<small class="chp-error">Chủ kênh cần thêm key trong Settings của họ.</small>' : '';
        return `<span class="${item.status === 'error' || error ? 'chp-error' : 'chp-muted'}" title="${escapeHtml(error || item.status || '')}">${escapeHtml(date(item.last_checked))}</span>${error ? `<small class="chp-error">${escapeHtml(error)}</small>` : `<small class="chp-muted">${escapeHtml(item.status || '')}</small>`}${settings}`;
    }
    function playlistRow(item, index) {
        return `<tr><td>${index + 1}</td><td><div class="chp-asset">${image(item.image)}<div>${link(item.spotify_url || `https://open.spotify.com/playlist/${encodeURIComponent(item.spotify_id || '')}`, playlistTitle(item))}<small class="chp-muted">${escapeHtml(item.spotify_id || '')}</small></div></div></td>
            <td>${escapeHtml(item.user_name || '-')}<small class="chp-muted">${escapeHtml(item.added_date || date(item.last_checked))}</small></td>
            <td>${link(item.owner_url, item.owner_name || '-')}</td><td class="chp-numeric">${number(item.saves ?? item.followers)}${metricDelta(item.followers_delta, item.delta_days)}</td><td class="chp-numeric">${number(item.track_count)}${metricDelta(item.track_count_delta, item.delta_days)}</td><td>${checked(item)}</td></tr>`;
    }
    function metricDelta(value, days) {
        if (value == null) return '';
        const label = `${value > 0 ? '+' : ''}${number(value)}${days == null ? '' : ` trong ${number(days)} ngày`}`;
        return `<small title="${escapeHtml(label)}" class="chp-delta ${value > 0 ? 'chp-positive' : value < 0 ? 'chp-negative' : 'chp-muted'}">${value > 0 ? '+' : ''}${number(value)}${days == null ? '' : `/${number(days)}`}</small>`;
    }
    function channelRow(item, index) {
        const collapsed = state.collapsed.has(item.id);
        const url = item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${encodeURIComponent(item.youtube_id)}` : item.query);
        const delta = item.view_count_delta == null ? '-' : `${item.view_count_delta > 0 ? '+' : ''}${number(item.view_count_delta)}`;
        return `<tbody data-chp-block="${escapeHtml(item.id)}"><tr class="chp-channel" data-chp-channel="${escapeHtml(item.id)}" tabindex="0">
            <td>${state.offset + index + 1}</td><td><div class="chp-asset"><button type="button" class="chp-toggle" data-chp-action="toggle" data-chp-id="${escapeHtml(item.id)}" aria-expanded="${!collapsed}" aria-label="Mở hoặc thu playlist">${collapsed ? '+' : '−'}</button>${image(item.image)}<div>${link(url, item.name || item.query || 'Kênh YouTube')}<small class="chp-muted">${escapeHtml(item.group)} · ${(item.playlists || []).length} playlists</small></div><button type="button" class="chp-edit" data-chp-action="edit" data-chp-id="${escapeHtml(item.id)}">Edit playlists</button><button type="button" class="chp-more" data-chp-action="menu" data-chp-id="${escapeHtml(item.id)}" aria-label="Thao tác kênh">⋯</button></div></td>
            <td>${number(item.view_count)}</td><td>${escapeHtml(delta)}<small class="chp-muted">${item.delta_days == null ? '-' : `${number(item.delta_days)} ngày`}</small></td><td>${checked(item)}</td></tr>
            <tr class="chp-children"${collapsed ? ' hidden' : ''}><td colspan="5"><table class="chp-playlists"><caption class="chp-sr">Playlists của ${escapeHtml(item.name || item.query)}</caption><thead><tr><th>STT</th><th>Asset Details</th><th>User Updated</th><th>Playlist Owner</th><th>Saves</th><th>Tracks</th><th>Checked</th></tr></thead><tbody>${(item.playlists || []).map(playlistRow).join('') || '<tr><td colspan="7" class="chp-empty">Chưa liên kết playlist. Chọn Edit playlists trong menu kênh.</td></tr>'}</tbody></table></td></tr></tbody>`;
    }
    function flushRender() {
        if (!state.visible || state.modal || state.menu) return;
        const list = state.host?.querySelector('.chp-list');
        if (!list || list.contains(document.activeElement)) { state.pendingRender = true; return; }
        const html = state.group && state.items.length ? `<table class="chp-channels"><caption class="chp-sr">Kênh YouTube</caption><thead><tr><th>STT</th><th>Channel</th><th>View</th><th>Delta / days</th><th>Checked</th></tr></thead>${state.items.map(channelRow).join('')}</table>` : state.groups.length ? '<p class="chp-empty">Chưa có kênh phù hợp. Thêm kênh hoặc đổi bộ lọc.</p>' : '<p class="chp-empty">Chưa có nhóm Channel & Playlist. <button type="button" data-chp-action="new-group">New Group</button></p>';
        if (list.innerHTML !== html) list.innerHTML = html;
        const select = state.host.querySelector('.chp-groups');
        if (document.activeElement !== select) {
            const groups = new Map(state.groups.map(group => [group.name, group.count]));
            const options = groups.size ? [...groups].map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${number(count)})</option>`).join('') : '<option value="" disabled selected>Chưa có nhóm</option>';
            if (select.innerHTML !== options) select.innerHTML = options;
            select.disabled = !groups.size;
            select.value = state.group;
        }
        state.host.querySelector('.chp-page').textContent = state.total ? `${state.offset + 1}–${Math.min(state.offset + PAGE_SIZE, state.total)} / ${number(state.total)}` : '0 kênh';
        state.host.querySelector('[data-chp-action="prev"]').disabled = state.offset === 0;
        state.host.querySelector('[data-chp-action="next"]').disabled = state.offset + PAGE_SIZE >= state.total;
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
        rail.hidden = !state.visible;
        state.host.classList.add('chp-has-rail');
        for (const button of rail.querySelectorAll('[data-chp-group]')) button.setAttribute('aria-pressed', String(button.dataset.chpGroup === state.group));
        if (rail.contains(document.activeElement)) return;
        const groups = new Map(state.groups.map(group => [group.name, group.count]));
        const html = [...groups].map(([name, count]) => `<button type="button" data-chp-group="${escapeHtml(name)}" aria-pressed="${state.group === name}"><span>${escapeHtml(name)}</span><span class="chp-muted">${number(count)}</span></button>`).join('');
        const content = `<div class="chp-group-list">${html}</div><button type="button" class="chp-new-group" data-chp-action="new-group">New Group</button>`;
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
        state.items = []; state.total = 0;
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
                state.group = ''; state.offset = 0; state.items = []; state.total = 0;
                flushRender(); message(''); return;
            }
            if (!state.groups.some(group => group.name === state.group)) {
                // The unscoped bootstrap response supplies groups only; never render its channel rows.
                state.group = state.groups[0].name; state.offset = 0; state.items = []; state.total = 0;
                flushRender(); return reload(quiet);
            }
            state.items = data.items;
            state.total = Number(data.total) || 0;
            if (state.offset >= state.total && state.offset > 0) {
                state.offset = Math.max(0, Math.floor((state.total - 1) / PAGE_SIZE) * PAGE_SIZE);
                return reload(quiet);
            }
            flushRender();
            if (!quiet || state.host.querySelector('.chp-status').classList.contains('chp-error')) message('');
        } catch (error) {
            if (generation === state.generation && error.name !== 'AbortError') message(errorText(error), true);
        } finally { if (generation === state.generation) state.loading = false; }
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
        else if (action === 'edit') { const item = state.items.find(row => row.id === button.dataset.chpId); if (item) openEdit(item); }
        else if (action === 'refresh-all') refreshAll(button);
        else if (action === 'prev' || action === 'next') { state.offset += action === 'prev' ? -PAGE_SIZE : PAGE_SIZE; reload(); }
        else if (action === 'menu') { const rect = button.getBoundingClientRect(); openMenu(button.dataset.chpId, rect.left, rect.bottom); }
        else if (['toggle', 'expand', 'collapse'].includes(action)) {
            const ids = action === 'toggle' ? [button.dataset.chpId] : state.items.map(item => item.id);
            for (const id of ids) {
                const collapse = action === 'collapse' || (action === 'toggle' && !state.collapsed.has(id));
                if (collapse) state.collapsed.add(id); else state.collapsed.delete(id);
                const block = [...state.host.querySelectorAll('[data-chp-block]')].find(node => node.dataset.chpBlock === id);
                if (block) { block.querySelector('.chp-children').hidden = collapse; const toggle = block.querySelector('.chp-toggle'); toggle.textContent = collapse ? '+' : '−'; toggle.setAttribute('aria-expanded', String(!collapse)); }
            }
        }
    }
    function closeMenu() {
        state.menu?.remove(); state.menu = null;
        if (state.pendingRender) flushRender();
    }
    function openMenu(id, x, y) {
        closeMenu();
        const item = state.items.find(row => row.id === id);
        if (!item) return;
        const menu = document.createElement('div');
        menu.className = 'chp-menu'; menu.setAttribute('role', 'menu');
        menu.innerHTML = '<button type="button" role="menuitem" data-menu="edit">Edit playlists</button><button type="button" role="menuitem" data-menu="refresh">Refresh kênh</button><button type="button" role="menuitem" data-menu="playlists">Refresh playlists</button><button type="button" role="menuitem" data-menu="delete" class="chp-error">Xóa kênh</button>';
        document.body.appendChild(menu); state.menu = menu;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
        menu.querySelector('button').focus();
        menu.addEventListener('click', event => {
            const action = event.target.closest('[data-menu]')?.dataset.menu;
            if (!action) return;
            closeMenu();
            if (action === 'edit') openEdit(item);
            if (action === 'refresh') mutate(null, '/youtube/channels/refresh', 'POST', { channel_ids: [id] });
            if (action === 'playlists') mutate(null, `/youtube/channels/${encodeURIComponent(id)}/playlists/refresh`, 'POST', undefined, true);
            if (action === 'delete') openDelete(item);
        });
        menu.addEventListener('keydown', event => {
            const buttons = [...menu.querySelectorAll('button')];
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(buttons.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
            if (event.key === 'Escape') { closeMenu(); state.host?.querySelector('.chp-search').focus(); }
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
            modal.focus = state.host?.querySelector('.chp-search');
            return 'Đã tạo nhóm.';
        });
    }
    function openAdd() {
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
    }
    function init(options) {
        if (typeof options?.request !== 'function' || typeof options?.getUser !== 'function') throw new TypeError('init requires request and getUser functions');
        hide(); state.request = options.request; state.getUser = options.getUser; state.onItemChanged = options.onItemChanged;
        state.settingsGeneration++;
        state.userId = ''; state.group = ''; state.search = ''; state.filter = 'all'; state.offset = 0;
        state.items = []; state.groups = []; state.total = 0; state.collapsed.clear();
        if (state.host) { state.host.querySelector('.chp-search').value = ''; state.host.querySelector('.chp-filter').value = 'all'; }
        return window.ChannelPlaylists;
    }
    document.addEventListener('pointerdown', event => { if (state.menu && !state.menu.contains(event.target)) closeMenu(); });
    document.addEventListener('focusin', event => { if (state.menu && !state.menu.contains(event.target)) closeMenu(); });
    window.ChannelPlaylists = { init, show, hide, reload, showKeySettings, setUserFilter };
}());
