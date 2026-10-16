/* YouTube Checker workspace.
 * Rendered inside the main dashboard (#ytm-panel) and driven by app.js through window.YouTubeChecker.
 * Rows, hero, footer and group rail reuse the Spotify Checker components; only the channel grid is YTM-specific.
 */
(() => {
  'use strict';

  const CONFIG = {
    POLL_INTERVAL: 1200,
    LIST_PAGE_SIZE: 160,
    BULK_PAGE_SIZE: 1000,
    VIRTUAL_ROW_HEIGHT: 86,
    VIRTUAL_OVERSCAN_ROWS: 10,
    PRELOAD_GROUP_LIMIT: 12,
    BACKGROUND_WARM_DELAY_MS: 180,
    BACKGROUND_WARM_MAX_PAGES: 40,
  };

  const ALL_GROUP_ID = 'all';
  const ALL_GROUP_LABEL = 'All Channels';
  const LIST_CACHE_VERSION = 1;
  const LIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const COLUMNS = [
    ['stt', 'STT'],
    ['name', 'Channel'],
    ['updated', 'Owner / Updated'],
    ['video', 'Video'],
    ['subscriber', 'Subscriber'],
    ['view', 'View'],
    ['delta', 'Delta / Days'],
    ['note', 'Note'],
    ['checked', 'Checked'],
  ];

  const state = {
    options: null,
    rail: null,
    visible: false,
    loaded: false,
    items: [],
    filteredItems: [],
    groups: [],
    selected: new Set(),
    activeGroup: ALL_GROUP_ID,
    groupSearch: '',
    search: '',
    itemSummary: null,
    listTotal: 0,
    listPending: false,
    pendingPlaceholderRows: 0,
    pendingTotalLabel: null,
    virtualItems: [],
    currentListParams: {},
    listScopeKey: '',
    loadedPageOffsets: new Set(),
    loadingPagePromises: new Map(),
    scopeIdCache: new Map(),
    dataLoadRequestId: 0,
    searchTimer: null,
    sortKey: 'stt',
    sortDir: 'asc',
    lastSelectedRowKey: null,
    preferences: {},
    rowOrder: [],
    draggingRowKeys: [],
    dragOverRowKey: null,
    dragOverRowPlacement: 'before',
    draggingGroupId: null,
    dragOverGroupId: null,
    dragOverGroupPlacement: 'before',
    contextItemIds: [],
    contextGroup: null,
    pendingJobs: new Set(),
    pendingJobToItem: new Map(),
    crawlProgressTotal: 0,
    apiOnline: null,
    pollTimer: null,
    preloadTimer: null,
    warmTimer: null,
    warmScopeKey: '',
    preloadedScopeKeys: new Set(),
    virtualRenderFrame: null,
    noteEdit: null,
  };

  function qs(id) { return document.getElementById(`ytm-${id}`); }
  function currentUser() { return state.options?.getUser?.() || null; }
  /* The account whose channels are shown (owner filter); every list and write is scoped to it. */
  function ownerId() { return String(state.options?.getOwner?.() || currentUser()?.id || ''); }
  function currentUserCacheId() {
    const user = currentUser();
    return `${String(user?.id || user?.username || 'anonymous')}:${ownerId()}`;
  }
  function listCacheKey(params = getBackendListParams()) {
    return `ytmanager_list_cache_v${LIST_CACHE_VERSION}:${currentUserCacheId()}:${getBackendListScopeKey(params)}`;
  }
  function readJsonStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function writeJsonStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { console.warn('cache write failed', err); }
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function toast(message, type = 'info') {
    state.options?.toast?.(message, type);
  }
  function confirmAction(title, message, confirmLabel) {
    return window.GroupRailUI.confirm({ title, message, confirmLabel });
  }

  async function apiFetch(path, opts = {}) {
    const res = await state.options.request(`/ytm${path}`, opts);
    return res ? res.json() : undefined;
  }

  async function apiDownload(path, opts = {}) {
    const res = await state.options.request(`/ytm${path}`, opts);
    return res ? res.blob() : null;
  }

  function ownerGroupsPath() {
    const owner = ownerId();
    return owner && owner !== String(currentUser()?.id || '') ? `/auth/users/${encodeURIComponent(owner)}/groups` : '/auth/me/groups';
  }

  function buildQuery(params = {}) {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      sp.set(key, value);
    });
    const query = sp.toString();
    return query ? `?${query}` : '';
  }

  const CRAWL_BATCH_LIMIT = 500;
  // The API caps one batch at 500 URLs; split larger requests and merge the responses.
  async function crawlBatchChunked(urls, group, itemIds = null) {
    const merged = { job_ids: [], count: 0, accepted_indices: [], item_ids: [], skipped_duplicates: 0, skipped_in_progress: 0 };
    for (let start = 0; start < urls.length; start += CRAWL_BATCH_LIMIT) {
      const response = await api.crawlBatch(urls.slice(start, start + CRAWL_BATCH_LIMIT), group,
        itemIds ? itemIds.slice(start, start + CRAWL_BATCH_LIMIT) : null);
      merged.job_ids.push(...(response.job_ids || []));
      merged.count += Number(response.count) || 0;
      merged.accepted_indices.push(...(response.accepted_indices || []).map((index) => index + start));
      merged.item_ids.push(...(response.item_ids || []));
      merged.skipped_duplicates += Number(response.skipped_duplicates) || 0;
      merged.skipped_in_progress += Number(response.skipped_in_progress) || 0;
    }
    return merged;
  }
  const api = {
    health: () => apiFetch('/health'),
    items: (params = {}) => apiFetch('/items' + buildQuery(params)),
    itemIds: (params = {}) => apiFetch('/items/ids' + buildQuery(params)),
    itemsSummary: (params = {}) => apiFetch('/items/summary' + buildQuery(params)),
    crawlBatch: (urls, group, itemIds = null) => apiFetch('/crawl/batch', {
      method: 'POST',
      body: JSON.stringify({ urls, group: group || null, target_user_id: ownerId() || null, item_ids: itemIds }),
    }),
    crawlScope: (params = {}) => apiFetch('/crawl/scope', {
      method: 'POST',
      body: JSON.stringify({ group: params.group || null, search: params.search || null, target_user_id: ownerId() || null }),
    }),
    moveItems: (itemIds, group) => apiFetch('/items/move', {
      method: 'POST',
      body: JSON.stringify({ item_ids: itemIds, group: group || null, user_id: ownerId() || null }),
    }),
    renameGroup: (oldGroup, newGroup) => {
      const sp = new URLSearchParams({ old_group: oldGroup, new_group: newGroup || '', user_id: ownerId() });
      return apiFetch('/items/group?' + sp.toString(), { method: 'PATCH' });
    },
    deleteItem: (id) => apiFetch(`/items-by-id/${id}`, { method: 'DELETE' }),
    saveNote: (id, note) => apiFetch(`/items-by-id/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) }),
    clearItems: (group = null) => apiFetch('/items' + buildQuery({ group, user_id: ownerId() }), { method: 'DELETE' }),
    jobBatch: (jobIds) => apiFetch('/jobs/batch', { method: 'POST', body: JSON.stringify({ job_ids: jobIds }) }),
    getGroups: () => apiFetch(ownerGroupsPath()),
    saveGroups: (groups) => apiFetch(ownerGroupsPath(), { method: 'PUT', body: JSON.stringify({ groups }) }),
    exportExcel: (itemIds) => apiDownload('/items/export', {
      method: 'POST',
      body: JSON.stringify({ format: 'xlsx', item_ids: itemIds }),
    }),
    prefs: () => apiFetch('/auth/me/preferences'),
    savePrefs: (preferences) => apiFetch('/auth/me/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }
  function parseDate(value) {
    if (!value) return null;
    const normalized = String(value).replace(' ', 'T');
    const d = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function formatDate(value) {
    const d = parseDate(value);
    if (!d) return '-';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
    }).format(d);
  }
  function itemUrl(item) {
    return item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${item.youtube_id}` : item.query || '');
  }
  function itemKey(item) { return String(item.id); }
  function selectedItems() { return state.items.filter((item) => state.selected.has(itemKey(item))); }
  function visibleRowKeys() { return state.filteredItems.map(itemKey); }
  function itemsByKeys(keys) {
    const wanted = new Set(keys.map(String));
    return state.items.filter((item) => wanted.has(itemKey(item)));
  }
  function clearSelection() {
    if (!state.selected.size) return false;
    state.selected.clear();
    state.lastSelectedRowKey = null;
    updateSelectionCount();
    return true;
  }
  function selectAllRows() {
    const keys = visibleRowKeys();
    state.selected = new Set(keys);
    state.lastSelectedRowKey = keys[keys.length - 1] || null;
    updateSelectionCount();
  }
  function updateSelectionCount() {
    const count = state.selected.size;
    ['footer-selected', 'kpi-selected'].forEach((id) => { const el = qs(id); if (el) el.textContent = count; });
    const actions = qs('footer-selection-actions');
    if (actions) actions.hidden = !count;
  }
  function updateApiStatus() {
    const el = qs('api-status');
    if (!el) return;
    if (state.pendingJobs.size && state.crawlProgressTotal > 0) {
      const done = Math.max(0, state.crawlProgressTotal - state.pendingJobs.size);
      el.textContent = `${done}/${state.crawlProgressTotal} completed`;
      return;
    }
    el.textContent = state.apiOnline === false ? 'Offline' : 'Online';
  }
  function isTypingTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
  }
  function contextGroupForItems(items = []) {
    if (state.activeGroup !== ALL_GROUP_ID) return state.activeGroup;
    if (!items.length) return ALL_GROUP_ID;
    const groups = new Set(items.map((item) => item.group || ''));
    return groups.size === 1 ? [...groups][0] : ALL_GROUP_ID;
  }
  function groupLabel(groupId) {
    if (groupId === ALL_GROUP_ID) return 'all channels';
    if (!groupId) return 'No group';
    return `group ${groupId}`;
  }
  function isDeadItem(item) {
    return ['error', 'dead'].includes(String(item.status || '').toLowerCase()) || !!item.error_message;
  }
  function exportFileName(scopeLabel, ext) {
    const stamp = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date()).replace(/[/:]/g, '-').replace(/\s+/g, ' ');
    const safeScope = String(scopeLabel || 'channels').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'channels';
    return `${safeScope} ${stamp}.${ext}`;
  }
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function exportTxt(items, scopeLabel = 'channels') {
    if (!items.length) return toast('No channels to export', 'error');
    const lines = items.map((item) => [
      item.name || item.query || '',
      itemUrl(item),
      formatDate(item.last_checked || item.created_at),
      item.video_count ?? '',
      item.subscriber_count ?? '',
      item.view_count ?? '',
    ].join('\t'));
    downloadBlob(exportFileName(scopeLabel, 'txt'), new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/plain;charset=utf-8' }));
    toast(`Exported ${items.length} channels to TXT`, 'success');
  }
  async function exportExcel(items, scopeLabel = 'channels') {
    if (!items.length) return toast('No channels to export', 'error');
    const blob = await api.exportExcel(items.map((item) => item.id).filter(Boolean));
    if (!blob) return;
    downloadBlob(exportFileName(scopeLabel, 'xlsx'), blob);
    toast(`Exported ${items.length} channels to Excel`, 'success');
  }
  async function copyLinks(items) {
    await navigator.clipboard.writeText(items.map(itemUrl).join('\n'));
    toast(`Copied ${items.length} links`, 'success');
  }

  // ── Sorting & row order ────────────────────────────────────────
  function applyRowOrder(items) {
    const index = new Map((state.rowOrder || []).map((id, idx) => [String(id), idx]));
    return [...items].sort((a, b) => {
      const ai = index.has(itemKey(a)) ? index.get(itemKey(a)) : Number.MAX_SAFE_INTEGER;
      const bi = index.has(itemKey(b)) ? index.get(itemKey(b)) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return parseDate(b.created_at)?.getTime() - parseDate(a.created_at)?.getTime() || 0;
    });
  }
  function rowOrderIndex(item) {
    const index = (state.rowOrder || []).indexOf(itemKey(item));
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }
  function sortValue(item, key) {
    if (key === 'stt') return rowOrderIndex(item);
    if (key === 'name') return String(item.name || item.query || '').toLowerCase();
    if (key === 'updated') return parseDate(item.last_checked || item.created_at)?.getTime() || 0;
    if (key === 'video') return Number(item.video_count) || 0;
    if (key === 'subscriber') return Number(item.subscriber_count) || 0;
    if (key === 'view') return Number(item.view_count) || 0;
    if (key === 'delta') return Number(item.view_count_delta) || 0;
    if (key === 'checked') return parseDate(item.last_checked)?.getTime() || 0;
    return '';
  }
  function sortItems(items) {
    const key = state.sortKey || 'stt';
    const dir = state.sortDir === 'desc' ? -1 : 1;
    const sorted = key === 'stt' ? applyRowOrder(items) : [...items].sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv), 'vi', { sensitivity: 'base', numeric: true }) * dir || rowOrderIndex(a) - rowOrderIndex(b);
      }
      return ((av > bv) - (av < bv)) * dir || rowOrderIndex(a) - rowOrderIndex(b);
    });
    return key === 'stt' && dir < 0 ? sorted.reverse() : sorted;
  }
  function setSort(key) {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = ['video', 'subscriber', 'view', 'delta', 'updated', 'checked'].includes(key) ? 'desc' : 'asc';
    }
    renderSortHeaders();
    showInstantListOrPending(getBackendListParams(), {
      total: state.listTotal || 0,
      totalLabel: state.listTotal ? state.listTotal : '...',
      preserveScroll: true,
      keepCurrentOnMiss: true,
    });
    loadItemsInBackground({ preserveScroll: true });
  }
  function renderColumnsHead() {
    const head = qs('columns-head');
    if (!head) return;
    head.innerHTML = COLUMNS.map(([key, label]) => `<div class="meta-cell head-cell${key === 'stt' ? ' stt-head' : ''}">
      <span class="head-cell-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      ${key === 'stt' || key === 'note' ? '' : `<button type="button" class="metric-sort-mode-toggle" data-ytm-sort="${key}" aria-label="Sort by ${escapeHtml(label)}" title="Sort ascending / descending"><span class="metric-sort-triangle">▼</span></button>`}
    </div>`).join('');
    renderSortHeaders();
  }
  function renderSortHeaders() {
    qs('columns-head')?.querySelectorAll('[data-ytm-sort]').forEach((button) => {
      const active = button.dataset.ytmSort === state.sortKey && !(state.sortKey === 'stt' && state.sortDir === 'asc');
      button.classList.toggle('is-active', active);
      button.querySelector('.metric-sort-triangle').textContent = active && state.sortDir === 'asc' ? '▲' : '▼';
    });
  }
  function normalizeRowOrder() {
    const kept = (state.rowOrder || []).map(String).filter(Boolean);
    const seen = new Set(kept);
    const missing = getLoadedVirtualItems().map(itemKey).filter((id) => !seen.has(id));
    state.rowOrder = [...kept, ...missing];
  }
  async function loadPreferences() {
    try {
      const data = await api.prefs();
      state.preferences = data?.preferences && typeof data.preferences === 'object' ? data.preferences : {};
      state.rowOrder = Array.isArray(data?.preferences?.row_order) ? data.preferences.row_order.map(String) : [];
    } catch (err) {
      console.warn(err);
      state.rowOrder = [];
    }
  }
  async function saveRowOrder() {
    try {
      state.preferences = { ...(state.preferences || {}), row_order: state.rowOrder };
      await api.savePrefs(state.preferences);
    } catch (err) {
      toast(err.message || 'Could not save row order', 'error');
    }
  }

  // ── Groups ─────────────────────────────────────────────────────
  async function loadGroups() {
    const data = await api.getGroups();
    state.groups = Array.isArray(data?.groups) ? data.groups : [];
    renderGroups();
    saveListCache();
  }
  async function saveGroups() {
    await api.saveGroups(state.groups);
  }
  function allGroupsFromItems() {
    const ordered = (state.groups || []).filter(Boolean);
    const known = new Set(ordered.map((g) => g.toLowerCase()));
    const summaryGroups = Array.isArray(state.itemSummary?.groups) ? state.itemSummary.groups : [];
    const extras = summaryGroups.map((group) => group.name).filter((name) => name && !known.has(String(name).toLowerCase()));
    getLoadedVirtualItems().forEach((item) => {
      if (item.group && !known.has(item.group.toLowerCase())) extras.push(item.group);
    });
    return [...ordered, ...Array.from(new Set(extras)).sort((a, b) => a.localeCompare(b))];
  }
  function groupCount(groupName) {
    if (groupName === ALL_GROUP_ID) {
      if (state.listPending && state.pendingTotalLabel != null) return state.pendingTotalLabel;
      return state.itemSummary?.all_total ?? state.listTotal ?? getLoadedVirtualItems().length;
    }
    return (state.itemSummary?.groups || []).find((group) => group.name === groupName)?.count || 0;
  }
  function renderGroups() {
    if (!state.rail) return;
    const query = state.groupSearch.toLowerCase();
    const dropClass = (key) => {
      if (state.dragOverGroupId !== key) return '';
      if (state.draggingRowKeys.length) return 'group-item-drop-target';
      if (state.draggingGroupId && state.draggingGroupId !== key) return `group-drop-${state.dragOverGroupPlacement}`;
      return '';
    };
    const items = [
      { key: ALL_GROUP_ID, label: ALL_GROUP_LABEL, count: groupCount(ALL_GROUP_ID), selected: state.activeGroup === ALL_GROUP_ID, protected: true, className: dropClass(ALL_GROUP_ID) },
      ...allGroupsFromItems().filter((name) => name.toLowerCase().includes(query)).map((name) => ({
        key: name,
        label: name,
        count: groupCount(name),
        selected: state.activeGroup === name,
        draggable: true,
        className: [state.draggingGroupId === name ? 'group-item-dragging' : '', dropClass(name)].filter(Boolean).join(' '),
      })),
    ];
    state.rail.render(items);
  }
  function renderModalGroups() {
    const wrap = qs('modal-group-wrap');
    if (!wrap) return;
    // Every new channel must land in a group, so there is no "No group" choice here.
    const groups = allGroupsFromItems();
    const options = groups.length
      ? groups.map((g) => ({ value: g, label: g }))
      : [{ value: '', label: 'Create a group first' }];
    const selected = groups.includes(state.activeGroup) ? state.activeGroup : (groups[0] || '');
    if (document.getElementById('ytm-modal-group-dropdown')) {
      state.options.updateDropdown('ytm-modal-group-dropdown', options, selected);
    } else {
      wrap.replaceChildren(state.options.createDropdown({ id: 'ytm-modal-group', options, selected, cssClass: 'dropdown-modal' }));
    }
  }
  function selectedModalGroup() {
    return document.getElementById('ytm-modal-group-dropdown')?.getAttribute('data-value') || null;
  }
  function setActiveGroup(group) {
    state.activeGroup = group || ALL_GROUP_ID;
    updateHeader();
  }
  function updateHeader() {
    if (state.visible) state.options?.onTitle?.(state.activeGroup === ALL_GROUP_ID ? ALL_GROUP_LABEL : state.activeGroup);
  }
  function selectGroup(name) {
    if (clearSelection()) renderRows({ preserveScroll: true });
    setActiveGroup(name);
    renderGroups();
    showInstantListOrPending(getBackendListParams());
    loadItemsInBackground();
  }
  function groupExists(name, except = '') {
    return allGroupsFromItems().some((group) => group.toLowerCase() === name.toLowerCase() && group !== except);
  }
  function createGroupNamed(name) {
    if (name.toLowerCase() === ALL_GROUP_ID || groupExists(name)) {
      toast('This group already exists', 'error');
      return false;
    }
    state.groups.push(name);
    setActiveGroup(name);
    state.itemSummary = { ...ensureItemSummary(), total: 0, active: 0, errors: 0, crawling: 0 };
    renderGroups();
    clearListPending();
    resetVirtualList(0, getBackendListParams(), { preserveLoaded: false });
    renderRows({ preserveScroll: true, skipQueue: true });
    invalidateItemCaches();
    saveGroups()
      .then(() => loadItems({ preserveScroll: true }))
      .catch((err) => {
        toast(err.message || 'Could not save group', 'error');
        loadGroups().catch((loadErr) => toast(loadErr.message, 'error'));
      });
    return true;
  }
  function renameGroupTo(originalName, next) {
    if (next.toLowerCase() === ALL_GROUP_ID || groupExists(next, originalName)) {
      toast('This group already exists', 'error');
      return false;
    }
    state.groups = state.groups.filter((g) => g !== originalName);
    state.groups.push(next);
    if (state.activeGroup === originalName) setActiveGroup(next);
    state.virtualItems = state.virtualItems.map((item) => (item?.group === originalName ? { ...item, group: next } : item));
    const summaryGroup = state.itemSummary?.groups?.find((group) => group.name === originalName);
    if (summaryGroup) summaryGroup.name = next;
    state.items = getLoadedVirtualItems();
    renderGroups();
    renderRows({ preserveScroll: true, skipQueue: true });
    invalidateItemCaches();
    api.renameGroup(originalName, next)
      .then(saveGroups)
      .then(() => loadItemsInBackground({ preserveScroll: true }))
      .catch((err) => {
        toast(err.message || 'Could not rename group', 'error');
        Promise.all([loadGroups(), loadItems({ preserveScroll: true })]).catch((loadErr) => toast(loadErr.message, 'error'));
      });
    return true;
  }
  function deleteGroups(names = []) {
    const targets = Array.from(new Set(names.map(String).filter(Boolean))).filter((name) => name !== ALL_GROUP_ID);
    if (!targets.length) return;
    state.groups = state.groups.filter((g) => !targets.includes(g));
    if (targets.includes(state.activeGroup)) setActiveGroup(ALL_GROUP_ID);
    renderGroups();
    invalidateItemCaches();
    showInstantListOrPending(getBackendListParams(), { keepCurrentOnMiss: true });
    (async () => {
      for (const name of targets) await api.renameGroup(name, '');
      await saveGroups();
      loadItemsInBackground({ preserveScroll: true });
    })().catch((err) => {
      toast(err.message || 'Could not delete group', 'error');
      Promise.all([loadGroups(), loadItems({ preserveScroll: true })]).catch((loadErr) => toast(loadErr.message, 'error'));
    });
  }

  // ── List data, caching & virtual rendering ─────────────────────
  function matchesActiveGroup(item) {
    return state.activeGroup === ALL_GROUP_ID || item.group === state.activeGroup;
  }
  function matchesSearchQuery(item, q) {
    if (!q) return true;
    return [item.name, item.youtube_id, item.query, item.youtube_url, item.user_name, item.group, item.note]
      .some((v) => String(v || '').toLowerCase().includes(q));
  }
  function matchesSearch(item) {
    return matchesSearchQuery(item, state.search.trim().toLowerCase());
  }
  function toCssImageUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    const url = (raw.includes('yt3.googleusercontent.com') && !raw.includes('=w') && !raw.includes('-fcrop64='))
      ? `${raw}=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj`
      : raw;
    return `url("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
  }
  function updateHeroCover() {
    const hero = qs('hero');
    if (!hero) return;
    const image = toCssImageUrl(state.filteredItems[0]?.banner_image);
    if (image) hero.style.setProperty('--hero-image', image);
    else hero.style.removeProperty('--hero-image');
  }
  function getBackendListParams(extra = {}) {
    const params = { ...extra };
    if (ownerId()) params.user_id = ownerId();
    if (state.activeGroup !== ALL_GROUP_ID) params.group = state.activeGroup || '';
    if (state.search.trim()) params.search = state.search.trim();
    if (state.sortKey && state.sortKey !== 'stt') {
      params.sort = state.sortKey;
      params.sort_direction = state.sortDir === 'desc' ? 'desc' : 'asc';
    } else if (state.sortKey === 'stt' && state.sortDir === 'desc') {
      params.sort = 'stt';
      params.sort_direction = 'desc';
    }
    return params;
  }
  function getBackendListScopeKey(params = getBackendListParams()) {
    return JSON.stringify(Object.keys(params).sort().map((key) => [key, params[key]]));
  }
  function getLoadedVirtualItems() {
    return (state.virtualItems || []).filter(Boolean);
  }
  function resetVirtualList(total, params, options = {}) {
    const scopeKey = getBackendListScopeKey(params);
    const canReuse = options.preserveLoaded && state.listScopeKey === scopeKey;
    state.listTotal = Number(total) || 0;
    state.currentListParams = { ...params };
    state.listScopeKey = scopeKey;
    if (!canReuse) {
      state.virtualItems = Array.from({ length: state.listTotal });
      state.loadedPageOffsets = new Set();
      state.loadingPagePromises = new Map();
    } else {
      state.virtualItems.length = state.listTotal;
    }
    state.items = getLoadedVirtualItems();
  }
  function commitPageItems(items, offset, total) {
    const nextTotal = Number(total);
    if (!Number.isNaN(nextTotal) && nextTotal >= 0 && nextTotal !== state.listTotal) {
      state.listTotal = nextTotal;
      state.virtualItems.length = state.listTotal;
    }
    (items || []).forEach((item, index) => { state.virtualItems[offset + index] = item; });
    state.loadedPageOffsets.add(offset);
    state.items = getLoadedVirtualItems();
    normalizeRowOrder();
  }
  function ensureItemSummary() {
    const current = state.itemSummary || {};
    state.itemSummary = {
      total: Number(current.total) || 0,
      all_total: Number(current.all_total ?? current.total) || 0,
      active: Number(current.active) || 0,
      errors: Number(current.errors) || 0,
      crawling: Number(current.crawling) || 0,
      groups: Array.isArray(current.groups) ? current.groups.map((group) => ({ ...group })) : [],
    };
    return state.itemSummary;
  }
  function clampCount(value) {
    return Math.max(0, Number(value) || 0);
  }
  function itemStatusBucket(item) {
    const status = String(item?.status || '').toLowerCase();
    if (status === 'active' || status === 'completed') return 'active';
    if (status === 'error' || status === 'dead') return 'errors';
    if (status === 'crawling' || status === 'pending') return 'crawling';
    return '';
  }
  function sortSummaryGroups(summary) {
    summary.groups = summary.groups
      .filter((group) => group.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base', numeric: true }));
  }
  function adjustGroupSummaryCount(groupName, delta) {
    if (!groupName || !delta) return;
    const summary = ensureItemSummary();
    let entry = summary.groups.find((group) => group.name === groupName);
    if (!entry && delta > 0) {
      entry = { name: groupName, count: 0 };
      summary.groups.push(entry);
    }
    if (entry) entry.count = clampCount(entry.count + delta);
    sortSummaryGroups(summary);
  }
  function adjustSummaryForItems(items = [], delta = 0) {
    if (!items.length || !delta) return;
    const summary = ensureItemSummary();
    summary.total = clampCount(summary.total + items.filter((item) => matchesActiveGroup(item) && matchesSearch(item)).length * delta);
    summary.all_total = clampCount(summary.all_total + (items.length * delta));
    items.forEach((item) => {
      const bucket = itemStatusBucket(item);
      if (bucket) summary[bucket] = clampCount(summary[bucket] + delta);
      adjustGroupSummaryCount(item.group, delta);
    });
  }
  function channelLabelFromUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return 'Checking channel';
    try {
      const parts = new URL(raw).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || new URL(raw).hostname || raw;
    } catch {
      return raw.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || raw;
    }
  }
  function buildOptimisticChannelItem({ id, url, group }) {
    const user = currentUser() || {};
    return {
      id: String(id), youtube_id: null, type: 'channel', query: url, query_type: null,
      name: channelLabelFromUrl(url), youtube_url: url, image: null, banner_image: null,
      video_count: null, subscriber_count: null, view_count: null, view_count_delta: null, delta_days: null,
      status: 'crawling', error_message: null, group: group || null,
      user_id: user.id || null, user_name: user.username || '', user_avatar: user.avatar || null,
      created_at: new Date().toISOString(), last_checked: null,
    };
  }
  function applyOptimisticAddItems(items = []) {
    const visible = items.filter((item) => matchesActiveGroup(item) && matchesSearch(item));
    adjustSummaryForItems(items, 1);
    if (!visible.length) {
      renderGroups();
      updateStats();
      return;
    }
    clearListPending();
    state.virtualItems = [...visible, ...state.virtualItems.filter(Boolean)];
    state.listTotal += visible.length;
    state.items = getLoadedVirtualItems();
    state.loadedPageOffsets = new Set([0]);
    normalizeRowOrder();
    renderGroups();
    renderRows({ preserveScroll: true, skipQueue: true });
    saveListCache();
  }
  function applyOptimisticRemoveItemsByIds(ids = []) {
    const removeIds = new Set(ids.map(String));
    if (!removeIds.size) return [];
    const removed = getLoadedVirtualItems().filter((item) => removeIds.has(itemKey(item)));
    state.virtualItems = state.virtualItems.filter((item) => item && !removeIds.has(itemKey(item)));
    state.listTotal = clampCount(state.listTotal - removed.length);
    state.items = getLoadedVirtualItems();
    state.loadedPageOffsets = new Set([0]);
    state.selected = new Set([...state.selected].filter((id) => !removeIds.has(String(id))));
    state.lastSelectedRowKey = null;
    adjustSummaryForItems(removed, -1);
    renderGroups();
    renderRows({ preserveScroll: true, skipQueue: true });
    saveListCache();
    return removed;
  }
  function applyOptimisticMoveItems(items = [], nextGroup = null) {
    const keys = new Set(items.map(itemKey));
    if (!keys.size) return;
    const changes = items.map((item) => ({
      item,
      before: matchesActiveGroup(item) && matchesSearch(item),
      after: matchesActiveGroup({ ...item, group: nextGroup }) && matchesSearch({ ...item, group: nextGroup }),
    }));
    const beforeVisible = changes.filter((entry) => entry.before).length;
    const afterVisible = changes.filter((entry) => entry.after).length;
    items.forEach((item) => {
      adjustGroupSummaryCount(item.group, -1);
      adjustGroupSummaryCount(nextGroup, 1);
    });
    const summary = ensureItemSummary();
    changes.forEach(({ item, before, after }) => {
      const bucket = itemStatusBucket(item);
      if (bucket) summary[bucket] = clampCount(summary[bucket] + (after ? 1 : 0) - (before ? 1 : 0));
    });
    state.virtualItems = state.virtualItems
      .map((item) => (item && keys.has(itemKey(item)) ? { ...item, group: nextGroup } : item))
      .filter((item) => item && matchesActiveGroup(item) && matchesSearch(item));
    summary.total = clampCount(summary.total + afterVisible - beforeVisible);
    state.listTotal = clampCount(state.listTotal + afterVisible - beforeVisible);
    state.items = getLoadedVirtualItems();
    state.selected = new Set([...state.selected].filter((id) => state.virtualItems.some((item) => itemKey(item) === id)));
    state.lastSelectedRowKey = null;
    renderGroups();
    renderRows({ preserveScroll: true, skipQueue: true });
    saveListCache();
  }
  function saveListCache(params = getBackendListParams()) {
    const snapshot = {
      cached_at: Date.now(),
      params,
      groups: Array.isArray(state.groups) ? state.groups : [],
      itemSummary: state.itemSummary || null,
      total: state.listTotal || 0,
      items: state.virtualItems.slice(0, CONFIG.LIST_PAGE_SIZE).filter(Boolean),
    };
    if (!snapshot.total && !snapshot.items.length && !snapshot.groups.length) return;
    writeJsonStorage(listCacheKey(params), snapshot);
  }
  function saveListSnapshotCache(params, snapshot = {}) {
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const total = Number(snapshot.total ?? snapshot.itemSummary?.total ?? items.length) || items.length;
    if (!total && !items.length && !state.groups.length) return;
    writeJsonStorage(listCacheKey(params), {
      cached_at: Date.now(),
      params,
      groups: Array.isArray(snapshot.groups) ? snapshot.groups : state.groups,
      itemSummary: snapshot.itemSummary || null,
      total,
      items: items.slice(0, CONFIG.LIST_PAGE_SIZE),
    });
  }
  function groupSummaryForItems(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (item.group) groups.set(item.group, (groups.get(item.group) || 0) + 1);
    });
    return [...groups.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base', numeric: true }));
  }
  function summaryOf(items, total, allTotal, groups) {
    return {
      total,
      all_total: allTotal,
      active: items.filter((item) => item.status === 'active').length,
      errors: items.filter((item) => item.status === 'error').length,
      crawling: items.filter((item) => item.status === 'crawling').length,
      groups,
    };
  }
  function saveDerivedGroupCachesFromLoadedItems(params = getBackendListParams()) {
    if (params.search || params.sort || params.sort_direction || params.group) return;
    const loaded = getLoadedVirtualItems();
    if (!loaded.length || state.listTotal !== loaded.length || loaded.length > CONFIG.LIST_PAGE_SIZE) return;
    const groups = groupSummaryForItems(loaded);
    saveListSnapshotCache(params, { itemSummary: summaryOf(loaded, loaded.length, loaded.length, groups), total: loaded.length, items: loaded });
    groups.forEach(({ name, count }) => {
      const groupItems = loaded.filter((item) => item.group === name);
      saveListSnapshotCache({ group: name }, { itemSummary: summaryOf(groupItems, count, loaded.length, groups), total: count, items: groupItems });
    });
  }
  function seedScopedCacheFromCurrentItems(params = getBackendListParams()) {
    if (state.currentListParams.search && state.currentListParams.search !== params.search) return;
    const loaded = getLoadedVirtualItems();
    if (!loaded.length || state.listTotal !== loaded.length || loaded.length > CONFIG.LIST_PAGE_SIZE) return;
    const sourceGroup = state.currentListParams.group || '';
    const targetGroup = params.group || '';
    if (sourceGroup && sourceGroup !== targetGroup) return;
    let items = loaded;
    if (targetGroup) items = items.filter((item) => item.group === targetGroup);
    if (params.search) items = items.filter((item) => matchesSearchQuery(item, String(params.search).toLowerCase()));
    items = sortItems(items);
    saveListSnapshotCache(params, {
      itemSummary: summaryOf(items, items.length, sourceGroup ? items.length : loaded.length, groupSummaryForItems(loaded)),
      total: items.length,
      items,
    });
  }
  function seedGroupCacheFromAllCache(params = getBackendListParams()) {
    if (!params.group || params.search || params.sort || params.sort_direction) return;
    const allParams = { ...params };
    delete allParams.group;
    const cached = readJsonStorage(listCacheKey(allParams));
    if (!cached || Date.now() - Number(cached.cached_at || 0) > LIST_CACHE_TTL_MS) return;
    const allItems = Array.isArray(cached.items) ? cached.items : [];
    const total = Number(cached.total) || allItems.length;
    if (!allItems.length || total !== allItems.length || total > CONFIG.LIST_PAGE_SIZE) return;
    const groupItems = allItems.filter((item) => item.group === params.group);
    const groups = Array.isArray(cached.itemSummary?.groups) ? cached.itemSummary.groups : groupSummaryForItems(allItems);
    const count = groups.find((group) => group.name === params.group)?.count ?? groupItems.length;
    saveListSnapshotCache(params, {
      itemSummary: summaryOf(groupItems, count, cached.itemSummary?.all_total ?? total, groups),
      total: count,
      items: groupItems,
    });
  }
  function hydrateListCache(params = getBackendListParams()) {
    const cached = readJsonStorage(listCacheKey(params));
    if (!cached || Date.now() - Number(cached.cached_at || 0) > LIST_CACHE_TTL_MS) return false;
    const items = Array.isArray(cached.items) ? cached.items : [];
    const total = Math.max(Number(cached.total) || items.length || 0, items.length);
    state.groups = Array.isArray(cached.groups) ? cached.groups : [];
    state.itemSummary = cached.itemSummary && typeof cached.itemSummary === 'object' ? cached.itemSummary : null;
    clearListPending();
    resetVirtualList(total, params, { preserveLoaded: false });
    commitPageItems(items, 0, total);
    renderGroups();
    renderRows({ skipQueue: true });
    return true;
  }
  function showInstantListOrPending(params = getBackendListParams(), options = {}) {
    seedGroupCacheFromAllCache(params);
    seedScopedCacheFromCurrentItems(params);
    if (hydrateListCache(params)) return true;
    if (options.keepCurrentOnMiss) return false;
    showListPending(params, options);
    return false;
  }
  function pageOffsetForIndex(index) {
    return Math.max(0, Math.floor(index / CONFIG.LIST_PAGE_SIZE) * CONFIG.LIST_PAGE_SIZE);
  }
  async function loadVirtualPage(offset, options = {}) {
    const pageOffset = pageOffsetForIndex(offset);
    if (state.loadedPageOffsets.has(pageOffset)) return;
    if (state.loadingPagePromises.has(pageOffset)) return state.loadingPagePromises.get(pageOffset);
    const scopeKey = state.listScopeKey;
    const promise = api.items({ ...state.currentListParams, limit: CONFIG.LIST_PAGE_SIZE, offset: pageOffset })
      .then((data) => {
        if (!data || scopeKey !== state.listScopeKey) return;
        commitPageItems(Array.isArray(data.items) ? data.items : [], pageOffset, data.total ?? state.listTotal);
        saveListCache(state.currentListParams);
        if (options.render !== false) {
          renderGroups();
          renderRows({ preserveScroll: true });
        }
        saveDerivedGroupCachesFromLoadedItems(state.currentListParams);
      })
      .catch((err) => {
        if (!options.silent) toast(err.message || 'Could not load data', 'error');
      })
      .finally(() => state.loadingPagePromises.delete(pageOffset));
    state.loadingPagePromises.set(pageOffset, promise);
    return promise;
  }
  function queueVirtualPagesForRange(start, end) {
    if (!state.listTotal) return;
    const from = pageOffsetForIndex(start);
    const to = pageOffsetForIndex(Math.min(end, state.listTotal - 1));
    for (let offset = from; offset <= to; offset += CONFIG.LIST_PAGE_SIZE) {
      const pageEnd = Math.min(offset + CONFIG.LIST_PAGE_SIZE, state.listTotal);
      if (state.virtualItems.slice(offset, pageEnd).some((item) => !item)) loadVirtualPage(offset);
    }
  }
  function stopBackgroundWarmup() {
    if (state.warmTimer) clearTimeout(state.warmTimer);
    state.warmTimer = null;
    state.warmScopeKey = '';
  }
  function scheduleCurrentScopeWarmup() {
    stopBackgroundWarmup();
    if (!state.listTotal || state.listTotal <= CONFIG.LIST_PAGE_SIZE) return;
    const scopeKey = state.listScopeKey;
    state.warmScopeKey = scopeKey;
    const offsets = [];
    for (let offset = CONFIG.LIST_PAGE_SIZE; offset < state.listTotal && offsets.length < CONFIG.BACKGROUND_WARM_MAX_PAGES; offset += CONFIG.LIST_PAGE_SIZE) {
      if (!state.loadedPageOffsets.has(offset)) offsets.push(offset);
    }
    let index = 0;
    const warmNext = async () => {
      if (scopeKey !== state.listScopeKey || state.warmScopeKey !== scopeKey) return;
      const offset = offsets[index];
      index += 1;
      if (offset == null) return;
      await loadVirtualPage(offset, { silent: true, render: false });
      if (scopeKey === state.listScopeKey && state.warmScopeKey === scopeKey && index < offsets.length) {
        state.warmTimer = setTimeout(warmNext, CONFIG.BACKGROUND_WARM_DELAY_MS);
      }
    };
    if (offsets.length) state.warmTimer = setTimeout(warmNext, CONFIG.BACKGROUND_WARM_DELAY_MS);
  }
  async function preloadFirstPageForParams(params) {
    const scopeKey = getBackendListScopeKey(params);
    if (state.preloadedScopeKeys.has(scopeKey)) return;
    state.preloadedScopeKeys.add(scopeKey);
    if (readJsonStorage(listCacheKey(params))) return;
    const [summary, data] = await Promise.all([
      api.itemsSummary(params),
      api.items({ ...params, limit: CONFIG.LIST_PAGE_SIZE, offset: 0 }),
    ]);
    saveListSnapshotCache(params, {
      itemSummary: summary || null,
      total: Number(summary?.total ?? data?.total ?? (data?.items || []).length) || 0,
      items: Array.isArray(data?.items) ? data.items : [],
    });
  }
  function scheduleListPreloads() {
    scheduleCurrentScopeWarmup();
    if (state.preloadTimer) clearTimeout(state.preloadTimer);
    if (state.search.trim() || state.sortKey !== 'stt' || state.sortDir !== 'asc') return;
    const groups = [ALL_GROUP_ID, ...allGroupsFromItems()].filter((group) => group !== state.activeGroup).slice(0, CONFIG.PRELOAD_GROUP_LIMIT);
    if (!groups.length) return;
    state.preloadTimer = setTimeout(async () => {
      for (const group of groups) {
        const params = paramsForGroup(group);
        if (getBackendListScopeKey(params) === state.listScopeKey) continue;
        try {
          await preloadFirstPageForParams(params);
          await delay(CONFIG.BACKGROUND_WARM_DELAY_MS);
        } catch (err) {
          console.warn('group preload failed', group, err);
        }
      }
    }, CONFIG.BACKGROUND_WARM_DELAY_MS * 2);
  }
  function getVirtualRange() {
    const scroller = qs('links-view');
    const list = qs('link-list');
    const rowHeight = CONFIG.VIRTUAL_ROW_HEIGHT;
    const viewportTop = Math.max(0, (scroller?.scrollTop || 0) - (list ? list.offsetTop : 0));
    const viewportHeight = scroller?.clientHeight || window.innerHeight;
    const start = Math.max(0, Math.floor(viewportTop / rowHeight) - CONFIG.VIRTUAL_OVERSCAN_ROWS);
    const end = Math.min(state.listTotal - 1, Math.ceil((viewportTop + viewportHeight) / rowHeight) + CONFIG.VIRTUAL_OVERSCAN_ROWS);
    return { start, end: Math.max(start, end) };
  }

  // ── Rows (Spotify Checker row component with the channel grid) ────
  function renderPlaceholderRow(index) {
    return `<div class="custom-grid-row ytm-grid ytm-row skeleton-row px-4 py-3 rounded-lg border border-transparent" data-virtual-row="${index}" aria-hidden="true">
      <div class="meta-cell stt-cell text-secondary-text">${index + 1}</div>
      <div class="list-asset-cell flex items-center gap-4"><span class="skeleton list-cover-image"></span><div class="flex flex-col gap-2 flex-1"><span class="skeleton" style="width:60px;height:14px"></span><span class="skeleton" style="width:220px;height:16px"></span></div></div>
      ${'<div class="meta-cell"><span class="skeleton" style="width:70px;height:14px"></span></div>'.repeat(7)}
    </div>`;
  }
  function noteCell(item) {
    const note = String(item.note || '');
    const edited = note && item.note_updated_at ? `\n\nLast edited ${formatDate(item.note_updated_at)}` : '';
    return `<div class="meta-cell ytm-note-cell" data-ytm-note${note ? ` title="${escapeHtml(note + edited)}"` : ''}><span class="ytm-note-text">${escapeHtml(note)}</span><button type="button" class="ytm-note-edit-btn" data-ytm-note-edit aria-label="Edit note" title="Edit note"><span class="material-icons-round">edit</span></button></div>`;
  }
  function startNoteEdit(cell) {
    const row = cell?.closest('[data-row-id]');
    const item = row && itemsByKeys([row.dataset.rowId])[0];
    if (!item || state.noteEdit) return;
    const input = document.createElement('textarea');
    const before = item.note || '';
    input.className = 'ytm-note-input';
    input.maxLength = 1000;
    input.rows = 2;
    input.value = before;
    input.setAttribute('aria-label', 'Note');
    // A draggable row would swallow text selection inside the editor.
    row.draggable = false;
    cell.removeAttribute('title');
    cell.replaceChildren(input);
    // The virtual list re-renders on scroll, polling and selection; renderRows waits while this is open.
    state.noteEdit = { input };
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      input.readOnly = true;
      const note = input.value.trim();
      try {
        if (save && note !== before) {
          const saved = await api.saveNote(item.id, note);
          // Polling may have replaced the row object while the editor was open, so update by id.
          const current = state.virtualItems.find((entry) => entry?.id === item.id) || item;
          Object.assign(current, { note: saved?.note ?? null, note_updated_at: saved?.note_updated_at ?? null });
          saveListCache();
        }
      } catch (err) {
        toast(err.message || 'Could not save note', 'error');
      }
      state.noteEdit = null;
      renderRows({ preserveScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
    });
    input.addEventListener('blur', () => finish(true));
  }
  function startNoteEditById(id) {
    const row = [...(qs('link-list')?.querySelectorAll('[data-row-id]') || [])].find((node) => node.dataset.rowId === String(id));
    startNoteEdit(row?.querySelector('[data-ytm-note]'));
  }
  function checkedCell(item) {
    const cells = state.options.cells;
    const status = cells.status(item.status === 'completed' ? { ...item, status: 'active' } : item);
    return `<div class="meta-cell text-right row-action-cell"><div class="checked-stack">
      <span class="list-checked-text text-secondary-text row-checked">${escapeHtml(cells.timeAgo(item.last_checked || item.created_at))}</span>
      <span class="checked-status ${status.color}"><span class="status-dot ${status.dot}"></span><span class="truncate">${escapeHtml(status.label)}</span></span>
    </div></div>`;
  }
  function renderRow(item, idx) {
    const cells = state.options.cells;
    const key = itemKey(item);
    const dragging = state.draggingRowKeys.includes(key);
    const dropTarget = state.dragOverRowKey === key && !dragging;
    const isError = item.status === 'error';
    const url = itemUrl(item);
    const cover = item.image
      ? `<button type="button" class="list-cover-trigger" data-ytm-preview="${escapeHtml(item.image)}" aria-label="Preview channel image"><img alt="" class="list-cover-image" src="${escapeHtml(item.image)}" loading="lazy" referrerpolicy="no-referrer"></button>`
      : '<span class="list-cover-image ytm-cover-empty" aria-hidden="true"></span>';
    const classes = [
      'custom-grid-row ytm-grid ytm-row px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group',
      state.selected.has(key) ? 'row-selected' : '',
      dragging ? 'row-dragging' : '',
      dropTarget ? `row-drop-target row-drop-${state.dragOverRowPlacement}` : '',
    ].filter(Boolean).join(' ');
    return `<div class="${classes}" draggable="true" data-row-id="${escapeHtml(key)}" aria-selected="${state.selected.has(key)}">
      <div class="meta-cell stt-cell text-secondary-text">${idx + 1}</div>
      <div class="list-asset-cell flex items-center gap-4">
        <input type="checkbox" class="row-check" data-row-check tabindex="-1" aria-label="Select row" ${state.selected.has(key) ? 'checked' : ''}>
        ${cover}
        <div class="min-w-0">
          <span class="list-type-badge ${isError ? 'badge-error' : 'badge-channel'}">channel</span>
          <h3 class="list-asset-title ${isError ? 'list-asset-title-muted' : ''}"><a class="list-title-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name || item.query || 'Unknown channel')}</a></h3>
          <div class="list-asset-meta">
            <p class="list-asset-uri text-secondary-text">${escapeHtml(item.youtube_id || item.query || '')}</p>
            <button type="button" class="list-copy-btn" data-ytm-copy="${escapeHtml(url)}" aria-label="Copy YouTube link"><span class="material-icons-round">content_copy</span><span>Copy</span></button>
          </div>
          ${isError && item.error_message ? `<p class="list-asset-error text-red-400 font-medium flex items-center gap-1"><span class="material-icons-round list-error-icon">warning</span>${escapeHtml(item.error_message)}</p>` : ''}
        </div>
      </div>
      ${cells.owner(item)}
      <div class="meta-cell">${cells.metric(item.video_count)}</div>
      <div class="meta-cell">${cells.metric(item.subscriber_count)}</div>
      <div class="meta-cell">${cells.metric(item.view_count)}</div>
      <div class="meta-cell">${cells.delta(item.view_count_delta, item.delta_days) || '<span class="metric-main metric-empty">-</span>'}</div>
      ${noteCell(item)}
      ${checkedCell(item)}
    </div>`;
  }
  function renderRows(options = {}) {
    const scroller = qs('links-view');
    const list = qs('link-list');
    const empty = qs('empty-state');
    if (!list || !empty) return;
    if (state.noteEdit?.input.isConnected) return;
    state.noteEdit = null;
    const savedScrollTop = options.preserveScroll ? scroller?.scrollTop : null;
    state.filteredItems = getLoadedVirtualItems();
    updateHeroCover();
    renderSortHeaders();
    if (state.listPending && !state.listTotal) {
      empty.hidden = true;
      const rows = Math.max(6, Number(state.pendingPlaceholderRows) || CONFIG.VIRTUAL_OVERSCAN_ROWS);
      list.innerHTML = Array.from({ length: rows }, (_, idx) => renderPlaceholderRow(idx)).join('');
    } else if (!state.listTotal) {
      list.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      const { start, end } = getVirtualRange();
      const top = start * CONFIG.VIRTUAL_ROW_HEIGHT;
      const bottom = Math.max(0, (state.listTotal - end - 1) * CONFIG.VIRTUAL_ROW_HEIGHT);
      const rows = [];
      for (let idx = start; idx <= end; idx += 1) {
        const item = state.virtualItems[idx];
        rows.push(item ? renderRow(item, idx) : renderPlaceholderRow(idx));
      }
      list.innerHTML = `<div class="ytm-virtual-spacer" style="height:${top}px"></div>${rows.join('')}<div class="ytm-virtual-spacer" style="height:${bottom}px"></div>`;
      if (!options.skipQueue) queueVirtualPagesForRange(start, end);
    }
    if (savedScrollTop != null && scroller) scroller.scrollTop = savedScrollTop;
    updateStats();
  }
  function estimatedListTotal(params = getBackendListParams()) {
    if (params.search) return state.listTotal ? Math.min(state.listTotal, CONFIG.LIST_PAGE_SIZE) : 0;
    if (params.group) return Number(groupCount(params.group)) || 0;
    return state.itemSummary?.all_total ?? state.itemSummary?.total ?? state.listTotal ?? 0;
  }
  function showListPending(params = getBackendListParams(), options = {}) {
    stopBackgroundWarmup();
    const hasExplicitTotal = Object.prototype.hasOwnProperty.call(options, 'total');
    const total = Math.max(0, Number(options.total ?? estimatedListTotal(params)) || 0);
    state.listPending = true;
    state.pendingPlaceholderRows = Number(options.placeholderRows) || Math.min(Math.max(total || 10, 6), 14);
    state.pendingTotalLabel = options.totalLabel ?? (hasExplicitTotal && !total ? '...' : total);
    resetVirtualList(total, params, { preserveLoaded: false });
    renderGroups();
    renderRows({ preserveScroll: !!options.preserveScroll, skipQueue: true });
  }
  function clearListPending() {
    state.listPending = false;
    state.pendingPlaceholderRows = 0;
    state.pendingTotalLabel = null;
  }
  function loadItemsInBackground(options = {}) {
    loadItems(options).catch((err) => {
      clearListPending();
      renderRows({ preserveScroll: !!options.preserveScroll, skipQueue: true });
      toast(err.message, 'error');
    });
  }
  function updateStats() {
    const pending = state.listPending;
    const summary = state.itemSummary || {};
    const loaded = getLoadedVirtualItems();
    const total = pending ? (state.pendingTotalLabel ?? '...') : (summary.total ?? state.listTotal ?? loaded.length);
    const values = pending ? { total, active: '...', errors: '...', crawling: '...' } : {
      total,
      active: summary.active ?? loaded.filter((item) => item.status === 'active').length,
      errors: summary.errors ?? loaded.filter((item) => item.status === 'error').length,
      crawling: summary.crawling ?? loaded.filter((item) => item.status === 'crawling').length,
    };
    Object.entries(values).forEach(([key, value]) => {
      ['kpi', 'footer'].forEach((prefix) => { const el = qs(`${prefix}-${key}`); if (el) el.textContent = value; });
    });
    qs('btn-clear-list')?.classList.toggle('hidden', pending || !total);
    updateSelectionCount();
  }
  async function loadItems(options = {}) {
    const params = getBackendListParams();
    const requestId = ++state.dataLoadRequestId;
    const scopeKey = getBackendListScopeKey(params);
    const preserveLoaded = state.listScopeKey === scopeKey;
    const [summary, data] = await Promise.all([
      api.itemsSummary(params),
      api.items({ ...params, limit: CONFIG.LIST_PAGE_SIZE, offset: 0 }),
    ]);
    if (requestId !== state.dataLoadRequestId) return;
    clearListPending();
    state.itemSummary = summary || null;
    const total = Number(summary?.total ?? data?.total ?? (data?.items || []).length) || 0;
    if (!preserveLoaded) {
      state.selected.clear();
      state.lastSelectedRowKey = null;
    }
    resetVirtualList(total, params, { preserveLoaded });
    commitPageItems(Array.isArray(data?.items) ? data.items : [], 0, total);
    renderGroups();
    renderRows({ preserveScroll: options.preserveScroll });
    saveListCache(params);
    saveDerivedGroupCachesFromLoadedItems(params);
    scheduleListPreloads();
  }

  // ── Refresh jobs ───────────────────────────────────────────────
  async function refreshItems(items) {
    if (!items.length) return;
    const itemIds = items.map((item) => item.id);
    markItemsCrawling(itemIds);
    toast(`Requesting refresh for ${itemIds.length} channels`, 'info');
    // Keep URLs and item ids aligned: rows without a URL cannot be refreshed.
    const refreshable = items.map((item) => [itemUrl(item), item.id]).filter(([url]) => Boolean(url));
    const response = await crawlBatchChunked(refreshable.map(([url]) => url), null, refreshable.map(([, id]) => id));
    trackRefreshJobs({ ...response, item_ids: response.item_ids?.length ? response.item_ids : itemIds });
    toast(`Started refreshing ${response.count} channels`, 'success');
  }
  async function pollJobs() {
    const ids = [...state.pendingJobs];
    if (!ids.length) {
      stopPolling();
      return;
    }
    try {
      const data = await api.jobBatch(ids);
      let changed = false;
      (data?.jobs || []).forEach((job) => {
        if (!['completed', 'error'].includes(job.status)) return;
        state.pendingJobs.delete(job.id);
        const itemId = job.item_id || state.pendingJobToItem.get(job.id);
        if (job.result && itemId) {
          const virtualIdx = state.virtualItems.findIndex((item) => item?.id === itemId);
          if (virtualIdx >= 0) {
            state.virtualItems[virtualIdx] = { ...state.virtualItems[virtualIdx], ...job.result };
            changed = true;
          }
        }
        if (job.status === 'error') toast(job.error || 'Refresh failed', 'error');
      });
      state.items = getLoadedVirtualItems();
      updateApiStatus();
      if (changed) {
        renderGroups();
        renderRows({ preserveScroll: true });
      }
      if (!state.pendingJobs.size) {
        stopPolling();
        state.crawlProgressTotal = 0;
        updateApiStatus();
        await loadItems({ preserveScroll: true });
      }
    } catch (err) {
      console.warn(err);
    }
  }
  function startPolling() {
    if (!state.pollTimer) state.pollTimer = setInterval(pollJobs, CONFIG.POLL_INTERVAL);
  }
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
    if (!state.pendingJobs.size) updateApiStatus();
  }
  function markItemsCrawling(itemIds = []) {
    const ids = new Set(itemIds.map(String));
    if (!ids.size) return;
    state.virtualItems = state.virtualItems.map((item) => (item && ids.has(item.id) ? { ...item, status: 'crawling', error_message: null } : item));
    state.items = getLoadedVirtualItems();
    renderGroups();
    renderRows({ preserveScroll: true });
  }
  function trackRefreshJobs(response) {
    const itemIds = Array.isArray(response?.item_ids) ? response.item_ids : [];
    const jobIds = response?.job_ids || [];
    if (!jobIds.length) return;
    let added = 0;
    jobIds.forEach((jobId, index) => {
      if (!state.pendingJobs.has(jobId)) added += 1;
      state.pendingJobs.add(jobId);
      if (itemIds[index]) state.pendingJobToItem.set(jobId, itemIds[index]);
    });
    if (added) state.crawlProgressTotal = state.pendingJobs.size;
    markItemsCrawling(itemIds);
    updateApiStatus();
    startPolling();
  }
  async function refreshScope(params = getBackendListParams(), label = 'channels') {
    toast(`Requesting refresh for ${label}`, 'info');
    const response = await api.crawlScope(params);
    trackRefreshJobs(response);
    toast(`Started refreshing ${response.count} ${label}`, 'success');
  }
  function paramsForGroup(groupId) {
    const params = getBackendListParams();
    if (groupId === ALL_GROUP_ID) delete params.group;
    else params.group = groupId || '';
    return params;
  }

  // ── Add / delete / move ────────────────────────────────────────
  function openAddModal() {
    renderModalGroups();
    qs('modal-input').value = '';
    qs('add-modal').classList.add('open');
    qs('modal-input').focus();
  }
  function closeAddModal() { qs('add-modal')?.classList.remove('open'); }
  async function submitAddChannels() {
    const urls = qs('modal-input').value.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!urls.length) {
      toast('Please enter at least one channel URL', 'error');
      return;
    }
    const group = selectedModalGroup();
    if (!group) {
      toast('Please choose a group first', 'error');
      return;
    }
    closeAddModal();
    const response = await crawlBatchChunked(urls, group);
    const accepted = Array.isArray(response.accepted_indices) ? response.accepted_indices : urls.map((_, index) => index);
    applyOptimisticAddItems(accepted
      .map((sourceIndex, resultIndex) => {
        const id = response.item_ids?.[resultIndex];
        const url = urls[sourceIndex];
        return id && url ? buildOptimisticChannelItem({ id, url, group }) : null;
      })
      .filter(Boolean));
    trackRefreshJobs(response);
    toast(`Added ${response.count} channels to the check queue`, 'success');
    invalidateItemCaches();
    loadItemsInBackground({ preserveScroll: true });
  }
  async function removeItems(items, successLabel, errorLabel) {
    const removed = applyOptimisticRemoveItemsByIds(items.map(itemKey));
    try {
      for (const item of items) await api.deleteItem(item.id);
      invalidateItemCaches();
      toast(successLabel, 'success');
      loadItemsInBackground({ preserveScroll: true });
    } catch (err) {
      toast(err.message || errorLabel, 'error');
      if (removed.length) loadItemsInBackground({ preserveScroll: true });
    }
  }
  async function deleteSelected() {
    const items = selectedItems();
    if (!items.length) return toast('No rows selected', 'error');
    if (!await confirmAction('Delete Channels', `Delete ${items.length} selected channels?`, 'Delete channels')) return;
    await removeItems(items, `Deleted ${items.length} channels`, 'Could not delete channels');
  }
  async function deleteDeadItems(items, label = 'list') {
    const dead = items.filter(isDeadItem);
    if (!dead.length) return toast('No dead channels to delete', 'info');
    if (!await confirmAction('Delete Dead Channels', `Delete ${dead.length} dead channels in ${label}?`, 'Delete channels')) return;
    await removeItems(dead, `Deleted ${dead.length} dead channels`, 'Could not delete dead channels');
  }
  async function clearGroupItems(groupId = state.activeGroup) {
    const group = groupId === ALL_GROUP_ID ? null : groupId;
    const label = group ? `group "${group}"` : 'the entire list';
    if (!await confirmAction('Clear list', `Delete all channels in ${label}? Groups are kept.`, 'Delete channels')) return;
    if (groupId === state.activeGroup) {
      applyOptimisticRemoveItemsByIds(getLoadedVirtualItems().map(itemKey));
    } else if (group) {
      const summaryGroup = state.itemSummary?.groups?.find((entry) => entry.name === group);
      if (summaryGroup) summaryGroup.count = 0;
      renderGroups();
    }
    state.selected.clear();
    invalidateItemCaches();
    try {
      await api.clearItems(group);
      toast(`Cleared ${label}`, 'success');
    } catch (err) {
      toast(err.message || 'Could not clear list', 'error');
    }
    loadItemsInBackground({ preserveScroll: true });
  }
  async function loadAllItemsForScope(params = getBackendListParams()) {
    const first = await api.items({ ...params, limit: CONFIG.BULK_PAGE_SIZE, offset: 0 });
    const items = Array.isArray(first?.items) ? [...first.items] : [];
    const total = Number(first?.total ?? items.length) || 0;
    for (let offset = CONFIG.BULK_PAGE_SIZE; offset < total; offset += CONFIG.BULK_PAGE_SIZE) {
      const page = await api.items({ ...params, limit: CONFIG.BULK_PAGE_SIZE, offset });
      if (Array.isArray(page?.items)) items.push(...page.items);
    }
    return items;
  }
  async function loadAllItemIdsForScope(params = getBackendListParams()) {
    const scopeKey = getBackendListScopeKey(params);
    if (state.scopeIdCache.has(scopeKey)) return state.scopeIdCache.get(scopeKey);
    const data = await api.itemIds(params);
    const ids = Array.isArray(data?.ids) ? data.ids.map(String) : [];
    state.scopeIdCache.set(scopeKey, ids);
    return ids;
  }
  function invalidateItemCaches() {
    state.scopeIdCache.clear();
  }
  function moveKeys(keys, dragKeys, targetKey, placement) {
    const draggedSet = new Set(dragKeys.map(String));
    if (!targetKey || draggedSet.has(String(targetKey))) return keys;
    const dragged = keys.filter((key) => draggedSet.has(String(key)));
    if (!dragged.length) return keys;
    const remaining = keys.filter((key) => !draggedSet.has(String(key)));
    let insertAt = remaining.indexOf(String(targetKey));
    if (insertAt < 0) return keys;
    if (placement === 'after') insertAt += 1;
    return [...remaining.slice(0, insertAt), ...dragged, ...remaining.slice(insertAt)];
  }
  function applyOptimisticRowReorder(dragKeys, targetKey, placement) {
    const loaded = state.virtualItems.map((item, index) => ({ item, index })).filter((entry) => entry.item);
    const loadedKeys = loaded.map((entry) => itemKey(entry.item));
    const nextKeys = moveKeys(loadedKeys, dragKeys, targetKey, placement);
    if (nextKeys === loadedKeys) return;
    const byKey = new Map(loaded.map((entry) => [itemKey(entry.item), entry.item]));
    loaded.forEach((entry, index) => { state.virtualItems[entry.index] = byKey.get(nextKeys[index]) || entry.item; });
    state.items = getLoadedVirtualItems();
  }
  async function reorderRows(dragKeys, targetKey, placement) {
    if (!targetKey || dragKeys.includes(targetKey)) return;
    applyOptimisticRowReorder(dragKeys, targetKey, placement);
    renderRows({ preserveScroll: true });
    const currentScopeIds = await loadAllItemIdsForScope();
    const allOwnerIds = state.activeGroup === ALL_GROUP_ID && !state.search.trim()
      ? currentScopeIds
      : await loadAllItemIdsForScope(paramsForGroup(ALL_GROUP_ID));
    const nextVisible = moveKeys(currentScopeIds, dragKeys, targetKey, placement);
    const visibleSet = new Set(nextVisible);
    state.rowOrder = [...nextVisible, ...allOwnerIds.filter((key) => !visibleSet.has(key))];
    state.sortKey = 'stt';
    state.sortDir = 'asc';
    await saveRowOrder();
    loadItems({ preserveScroll: true }).catch((err) => toast(err.message, 'error'));
  }
  function reorderGroups(dragged, target, placement) {
    if (!dragged || !target || dragged === target || target === ALL_GROUP_ID) return;
    const groups = allGroupsFromItems().filter((group) => group !== dragged);
    let insertAt = groups.indexOf(target);
    if (insertAt < 0) return;
    if (placement === 'after') insertAt += 1;
    groups.splice(insertAt, 0, dragged);
    state.groups = groups;
    renderGroups();
    saveGroups().catch((err) => {
      toast(err.message || 'Could not save group order', 'error');
      loadGroups().catch((loadErr) => toast(loadErr.message, 'error'));
    });
  }
  function moveRowsToGroupByKeys(keys, group) {
    const items = itemsByKeys(keys);
    if (!items.length) return;
    const nextGroup = group || null;
    applyOptimisticMoveItems(items, nextGroup);
    if (nextGroup && !state.groups.includes(nextGroup)) {
      state.groups.push(nextGroup);
      renderGroups();
    }
    invalidateItemCaches();
    toast(`Moved ${items.length} channels`, 'success');
    api.moveItems(items.map((item) => item.id), nextGroup)
      .then(() => (nextGroup ? saveGroups() : null))
      .then(() => loadItemsInBackground({ preserveScroll: true }))
      .catch((err) => {
        toast(err.message || 'Could not move channels', 'error');
        loadItemsInBackground({ preserveScroll: true });
      });
  }

  // ── Context menu (same component as Spotify Checker rows) ─────────
  function closeContextMenu() {
    const menu = qs('context-menu');
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = '';
  }
  function contextButton(action, icon, label, danger = false) {
    return `<button type="button" class="row-context-item${danger ? ' row-context-danger' : ''}" data-context-action="${escapeHtml(action)}">
      <span class="material-icons-round">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span>
    </button>`;
  }
  function openContextMenu(html, x, y) {
    const menu = qs('context-menu');
    if (!menu) return;
    menu.innerHTML = html;
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(10, Math.min(x, window.innerWidth - rect.width - 10))}px`;
    menu.style.top = `${Math.max(10, Math.min(y, window.innerHeight - rect.height - 10))}px`;
  }
  function showRowContextMenu(event, rowId) {
    if (!state.selected.has(rowId)) state.selected = new Set([rowId]);
    state.contextItemIds = [...state.selected];
    state.contextGroup = contextGroupForItems(itemsByKeys(state.contextItemIds));
    renderRows({ preserveScroll: true });
    const selectedLabel = state.contextItemIds.length > 1 ? `${state.contextItemIds.length} selected channels` : 'selected channel';
    const hasGroupScope = state.contextGroup !== ALL_GROUP_ID;
    const scopeLabel = groupLabel(state.contextGroup);
    const moveOptions = [['', 'folder_off', 'No group'], ...allGroupsFromItems().map((group) => [group, 'folder', group])]
      .map(([value, icon, label]) => `<button type="button" class="row-context-item row-context-submenu-item" data-context-move-group="${escapeHtml(value)}">
        <span class="material-icons-round">${icon}</span><span>${escapeHtml(label)}</span>
      </button>`).join('');
    openContextMenu(`
      ${contextButton('add-channel', 'add', 'Add Channel')}
      ${state.contextItemIds.length === 1 ? contextButton('edit-note', 'edit', 'Edit note') : ''}
      ${contextButton('refresh', 'refresh', `Refresh ${selectedLabel}`)}
      ${contextButton('open', 'open_in_new', 'Open on YouTube')}
      ${contextButton('copy', 'content_copy', `Copy ${selectedLabel} links`)}
      <div class="row-context-parent" data-context-group>
        <button type="button" class="row-context-item row-context-submenu-trigger">
          <span class="material-icons-round">drive_file_move</span><span>Move to group</span>
          <span class="material-icons-round row-context-chevron">chevron_right</span>
        </button>
        <div class="row-context-submenu">${moveOptions}</div>
      </div>
      ${contextButton('export-context-txt', 'description', 'Export selected TXT')}
      ${contextButton('export-context-excel', 'table_view', 'Export selected Excel')}
      <div class="row-context-separator"></div>
      ${hasGroupScope ? contextButton('refresh-group', 'sync', `Refresh channels in ${scopeLabel}`) : ''}
      ${contextButton('refresh-all', 'sync_alt', 'Refresh all channels')}
      ${hasGroupScope ? contextButton('delete-dead-group', 'playlist_remove', `Delete dead channels in ${scopeLabel}`, true) : ''}
      ${contextButton('delete-dead-all', 'delete_sweep', 'Delete all dead channels', true)}
      <div class="row-context-separator"></div>
      ${contextButton('delete', 'delete', 'Delete selected channels', true)}
    `, event.clientX, event.clientY);
  }
  function showWorkspaceContextMenu(event) {
    state.contextGroup = state.activeGroup;
    state.contextItemIds = [];
    const isAll = state.activeGroup === ALL_GROUP_ID;
    const label = groupLabel(state.activeGroup);
    openContextMenu(`
      ${contextButton('add-channel', 'add', 'Add Channel')}
      ${isAll ? '' : contextButton('refresh-group', 'refresh', `Refresh channels in ${label}`)}
      ${contextButton('refresh-all', isAll ? 'refresh' : 'sync_alt', 'Refresh all channels')}
      ${contextButton('copy-current', 'content_copy', `Copy ${label} links`)}
      ${contextButton('export-current-txt', 'description', `Export ${label} TXT`)}
      ${contextButton('export-current-excel', 'table_view', `Export ${label} Excel`)}
      <div class="row-context-separator"></div>
      ${isAll ? '' : contextButton('delete-dead-group', 'playlist_remove', `Delete dead channels in ${label}`, true)}
      ${contextButton('delete-dead-all', 'delete_sweep', 'Delete all dead channels', true)}
      <div class="row-context-separator"></div>
      ${contextButton('clear-current', 'playlist_remove', `Clear ${label}`, true)}
    `, event.clientX, event.clientY);
  }
  async function handleContextAction(action, groupValue = null) {
    const contextItems = itemsByKeys(state.contextItemIds);
    const contextGroup = state.contextGroup || state.activeGroup || ALL_GROUP_ID;
    switch (action) {
      case 'add-channel': return openAddModal();
      case 'edit-note': return startNoteEditById(state.contextItemIds[0]);
      case 'refresh': return contextItems.length ? refreshItems(contextItems) : refreshScope(getBackendListParams(), groupLabel(state.activeGroup));
      case 'refresh-group': return refreshScope(paramsForGroup(contextGroup), groupLabel(contextGroup));
      case 'refresh-all': return refreshScope(paramsForGroup(ALL_GROUP_ID), 'channels');
      case 'open': return contextItems[0] && window.open(itemUrl(contextItems[0]), '_blank', 'noopener');
      case 'copy': return copyLinks(contextItems.length ? contextItems : await loadAllItemsForScope());
      case 'copy-current': return copyLinks(await loadAllItemsForScope());
      case 'move': return moveRowsToGroupByKeys(state.contextItemIds, groupValue || '');
      case 'export-context-txt': return exportTxt(contextItems, 'selected channels');
      case 'export-context-excel': return exportExcel(contextItems, 'selected channels');
      case 'export-current-txt': return exportTxt(await loadAllItemsForScope(), groupLabel(state.activeGroup));
      case 'export-current-excel': return exportExcel(await loadAllItemsForScope(), groupLabel(state.activeGroup));
      case 'delete-dead-group': return deleteDeadItems(await loadAllItemsForScope(paramsForGroup(contextGroup)), groupLabel(contextGroup));
      case 'delete-dead-all': return deleteDeadItems(await loadAllItemsForScope(paramsForGroup(ALL_GROUP_ID)), 'all channels');
      case 'clear-current': return clearGroupItems(state.activeGroup);
      case 'delete':
        state.selected = new Set(state.contextItemIds);
        return deleteSelected();
      default: return undefined;
    }
  }

  // ── Drag & drop ────────────────────────────────────────────────
  function dragPlacement(event, element) {
    const rect = element.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  }
  function autoScroll(scroller, event, edge, step) {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (event.clientY < rect.top + edge) scroller.scrollTop -= step;
    if (event.clientY > rect.bottom - edge) scroller.scrollTop += step;
  }
  function updateBlankRowDrop(event) {
    if (!state.draggingRowKeys.length || !state.filteredItems.length || event.target.closest('[data-row-id]')) return false;
    autoScroll(qs('links-view'), event, 86, 30);
    const listRect = qs('link-list')?.getBoundingClientRect();
    const placement = !listRect || event.clientY < listRect.top + listRect.height / 2 ? 'before' : 'after';
    const target = itemKey(placement === 'before' ? state.filteredItems[0] : state.filteredItems[state.filteredItems.length - 1]);
    if (state.dragOverRowKey !== target || state.dragOverRowPlacement !== placement) {
      state.dragOverRowKey = target;
      state.dragOverRowPlacement = placement;
      renderRows({ preserveScroll: true });
    }
    return true;
  }
  function clearDragState() {
    state.draggingRowKeys = [];
    state.dragOverRowKey = null;
    state.dragOverRowPlacement = 'before';
    state.draggingGroupId = null;
    state.dragOverGroupId = null;
    state.dragOverGroupPlacement = 'before';
  }
  function finishDrag() {
    clearDragState();
    renderGroups();
    renderRows({ preserveScroll: true });
  }
  function bindGroupDrag(list) {
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('[data-rail-key][draggable="true"]');
      if (!row) return;
      state.draggingGroupId = row.dataset.railKey;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', state.draggingGroupId);
      requestAnimationFrame(renderGroups);
    });
    list.addEventListener('dragover', (e) => {
      const target = e.target.closest('[data-rail-key]');
      if (!target) return;
      const key = target.dataset.railKey;
      if (state.draggingRowKeys.length) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (state.dragOverGroupId !== key) {
          state.dragOverGroupId = key;
          renderGroups();
        }
        return;
      }
      if (!state.draggingGroupId || key === ALL_GROUP_ID || key === state.draggingGroupId) return;
      autoScroll(list, e, 58, 22);
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const placement = dragPlacement(e, target);
      if (state.dragOverGroupId !== key || state.dragOverGroupPlacement !== placement) {
        state.dragOverGroupId = key;
        state.dragOverGroupPlacement = placement;
        renderGroups();
      }
    });
    list.addEventListener('drop', (e) => {
      const target = e.target.closest('[data-rail-key]');
      e.preventDefault();
      if (target && state.draggingRowKeys.length) {
        moveRowsToGroupByKeys(state.draggingRowKeys, target.dataset.railKey === ALL_GROUP_ID ? '' : target.dataset.railKey);
      } else if (target && state.draggingGroupId) {
        reorderGroups(state.draggingGroupId, target.dataset.railKey, state.dragOverGroupPlacement);
      }
      finishDrag();
    });
    list.addEventListener('dragend', finishDrag);
  }

  // ── Events ─────────────────────────────────────────────────────
  function handleRowClick(e) {
    const preview = e.target.closest('[data-ytm-preview]');
    if (preview) { state.options.previewImage?.(preview.dataset.ytmPreview); return; }
    const copy = e.target.closest('[data-ytm-copy]');
    if (copy) { state.options.copyText?.(copy.dataset.ytmCopy); return; }
    const noteEdit = e.target.closest('[data-ytm-note-edit]');
    if (noteEdit) { startNoteEdit(noteEdit.closest('[data-ytm-note]')); return; }
    if (e.target.closest('a, textarea')) return;
    const row = e.target.closest('[data-row-id]');
    if (!row) return;
    const id = row.dataset.rowId;
    const keys = visibleRowKeys();
    // The row checkbox toggles like Ctrl/Cmd-click.
    const toggle = e.ctrlKey || e.metaKey || Boolean(e.target.closest('[data-row-check]'));
    if (e.shiftKey && state.lastSelectedRowKey && keys.includes(state.lastSelectedRowKey)) {
      const [a, b] = [keys.indexOf(state.lastSelectedRowKey), keys.indexOf(id)].sort((x, y) => x - y);
      state.selected = new Set(keys.slice(a, b + 1));
    } else if (toggle) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      state.lastSelectedRowKey = id;
    } else {
      state.selected = new Set([id]);
      state.lastSelectedRowKey = id;
    }
    renderRows({ preserveScroll: true });
  }

  function bindEvents() {
    renderColumnsHead();
    qs('btn-add').addEventListener('click', openAddModal);
    qs('btn-refresh').addEventListener('click', () => (async () => {
      const selected = selectedItems();
      if (selected.length) await refreshItems(selected);
      else await refreshScope(getBackendListParams(), groupLabel(state.activeGroup));
    })().catch((err) => toast(err.message, 'error')));
    qs('modal-submit').addEventListener('click', () => submitAddChannels().catch((err) => toast(err.message, 'error')));
    qs('btn-clear-list').addEventListener('click', () => clearGroupItems().catch((err) => toast(err.message, 'error')));
    qs('btn-clear-selection')?.addEventListener('click', () => { if (clearSelection()) renderRows({ preserveScroll: true }); });
    qs('btn-delete-selection')?.addEventListener('click', () => deleteSelected().catch((err) => toast(err.message, 'error')));
    qs('add-modal').addEventListener('click', (e) => {
      if (e.target === qs('add-modal') || e.target.closest('[data-ytm-close-modal]')) closeAddModal();
    });
    qs('columns-head').addEventListener('click', (e) => {
      const button = e.target.closest('[data-ytm-sort]');
      if (button) setSort(button.dataset.ytmSort);
    });
    qs('search-input').addEventListener('input', (e) => {
      state.search = e.target.value;
      clearTimeout(state.searchTimer);
      showInstantListOrPending(getBackendListParams(), { keepCurrentOnMiss: true });
      state.searchTimer = setTimeout(loadItemsInBackground, 220);
    });

    const list = qs('link-list');
    list.addEventListener('click', handleRowClick);
    list.addEventListener('dblclick', (e) => {
      const row = e.target.closest('[data-row-id]');
      if (!row || e.target.closest('a, button, textarea')) return;
      if (e.target.closest('[data-ytm-note]')) return;
      const item = itemsByKeys([row.dataset.rowId])[0];
      if (item) window.open(itemUrl(item), '_blank', 'noopener');
    });
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('[data-row-id]');
      if (!row) return;
      if (!state.selected.has(row.dataset.rowId)) state.selected = new Set([row.dataset.rowId]);
      state.draggingRowKeys = [...state.selected];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', state.draggingRowKeys.join(','));
      requestAnimationFrame(() => { renderRows({ preserveScroll: true }); renderGroups(); });
    });
    list.addEventListener('dragover', (e) => {
      const row = e.target.closest('[data-row-id]');
      if (!row || !state.draggingRowKeys.length || state.draggingRowKeys.includes(row.dataset.rowId)) return;
      autoScroll(qs('links-view'), e, 86, 30);
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const placement = dragPlacement(e, row);
      if (state.dragOverRowKey !== row.dataset.rowId || state.dragOverRowPlacement !== placement) {
        state.dragOverRowKey = row.dataset.rowId;
        state.dragOverRowPlacement = placement;
        renderRows({ preserveScroll: true });
      }
    });
    list.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('[data-row-id]');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      showRowContextMenu(e, row.dataset.rowId);
    });

    const view = qs('links-view');
    view.addEventListener('contextmenu', (e) => {
      if (e.target.closest('[data-row-id], button, input, textarea, select, a')) return;
      e.preventDefault();
      showWorkspaceContextMenu(e);
    });
    view.addEventListener('scroll', () => {
      // Scrolling recycles virtual rows: save the open note first.
      state.noteEdit?.input.blur();
      if (!state.listTotal || state.virtualRenderFrame) return;
      state.virtualRenderFrame = requestAnimationFrame(() => {
        state.virtualRenderFrame = null;
        renderRows({ preserveScroll: true });
      });
    }, { passive: true });
    view.addEventListener('dragover', (e) => {
      if (!updateBlankRowDrop(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    view.addEventListener('drop', async (e) => {
      if (!state.draggingRowKeys.length) return;
      e.preventDefault();
      const dragKeys = [...state.draggingRowKeys];
      const row = e.target.closest('[data-row-id]');
      if (!row) updateBlankRowDrop(e);
      const targetKey = row ? row.dataset.rowId : state.dragOverRowKey;
      const placement = state.dragOverRowPlacement;
      clearDragState();
      try {
        await reorderRows(dragKeys, targetKey, placement);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        finishDrag();
      }
    });
    list.addEventListener('dragend', finishDrag);

    qs('context-menu').addEventListener('click', async (e) => {
      const move = e.target.closest('[data-context-move-group]');
      const actionButton = e.target.closest('[data-context-action]');
      if (!move && !actionButton) return;
      closeContextMenu();
      try {
        await handleContextAction(move ? 'move' : actionButton.dataset.contextAction, move ? move.dataset.contextMoveGroup : null);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    document.addEventListener('pointerdown', (e) => {
      if (!state.visible) return;
      if (!e.target.closest('#ytm-context-menu')) closeContextMenu();
      if (e.button !== 0 || !state.selected.size) return;
      if (e.target.closest('[data-row-id], #ytm-context-menu, .modal-overlay, .group-rail-confirm, .row-context-menu')) return;
      if (clearSelection()) renderRows({ preserveScroll: true });
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!state.visible) return;
      if (e.key === 'Escape') {
        closeContextMenu();
        closeAddModal();
        if (!isTypingTarget(e.target) && clearSelection()) renderRows({ preserveScroll: true });
        return;
      }
      if (isTypingTarget(e.target) || document.querySelector('.modal-overlay.open') || e.target.closest?.('.group-rail')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllRows();
        renderRows({ preserveScroll: true });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.size) {
        e.preventDefault();
        deleteSelected().catch((err) => toast(err.message, 'error'));
      }
    });
    window.addEventListener('resize', () => state.visible && closeContextMenu());
  }

  function mountRail() {
    const list = qs('group-list');
    state.rail = window.GroupRailUI.mount(list, {
      keyAttr: 'data-group',
      deleteNote: 'Channels in the group move to No group.',
      onSelect: (key) => selectGroup(key),
      onContextOpen: (key) => { if (key !== state.activeGroup) selectGroup(key); },
      onCreate: (name) => createGroupNamed(name),
      onRename: (key, name) => renameGroupTo(key, name),
      onDelete: (keys) => deleteGroups(keys),
      onError: (err) => toast(err.message || String(err), 'error'),
    });
    bindGroupDrag(list);
  }

  async function loadInitialData() {
    if (!hydrateListCache(getBackendListParams())) {
      showListPending(getBackendListParams(), { total: 0, totalLabel: '...', placeholderRows: 10 });
    }
    api.health()
      .then(() => { state.apiOnline = true; updateApiStatus(); })
      .catch(() => { state.apiOnline = false; updateApiStatus(); });
    await Promise.all([loadPreferences(), loadGroups(), loadItems()]);
  }

  window.YouTubeChecker = {
    init(options) {
      if (state.options) return window.YouTubeChecker;
      state.options = options;
      bindEvents();
      mountRail();
      return window.YouTubeChecker;
    },
    show() {
      state.visible = true;
      updateHeader();
      if (state.ownerShown === undefined) state.ownerShown = ownerId();
      else if (state.ownerShown !== ownerId()) window.YouTubeChecker.syncOwner();
      if (!state.loaded) {
        state.loaded = true;
        loadInitialData().catch((err) => toast(err.message || 'Startup error', 'error'));
      } else {
        renderGroups();
        renderRows({ preserveScroll: true });
        loadItemsInBackground({ preserveScroll: true });
      }
    },
    /* Called when the owner filter changes: forget the previous owner's rows, then reload if shown. */
    syncOwner() {
      const owner = ownerId();
      if (state.ownerShown === owner) return;
      state.ownerShown = owner;
      state.dataLoadRequestId += 1;
      state.selected.clear();
      state.lastSelectedRowKey = null;
      state.activeGroup = ALL_GROUP_ID;
      state.groups = [];
      state.itemSummary = null;
      state.noteEdit = null;
      state.scopeIdCache.clear();
      state.preloadedScopeKeys.clear();
      resetVirtualList(0, getBackendListParams());
      updateSelectionCount();
      if (!state.loaded) return;
      if (state.visible) loadInitialData().catch((err) => toast(err.message || 'Could not load channels', 'error'));
      else state.loaded = false;
    },
    hide() {
      state.visible = false;
      closeContextMenu();
      closeAddModal();
    },
    startCreateGroup() { state.rail?.startCreate(); },
    setGroupSearch(text) {
      state.groupSearch = String(text || '');
      renderGroups();
    },
    refreshAll: () => refreshScope(paramsForGroup(ALL_GROUP_ID), 'channels'),
  };
})();
