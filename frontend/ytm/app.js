const CONFIG = {
  API_BASE: '/api/ytm',
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
let groupClickTimer = null;

const state = {
  user: null,
  users: [],
  items: [],
  filteredItems: [],
  selected: new Set(),
  activeGroup: ALL_GROUP_ID,
  groupSearch: '',
  search: '',
  view: 'links',
  adminFilterUserId: null,
  userManagerFilterIds: [],
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
  inlineGroupEdit: null,
  pendingJobs: new Set(),
  pendingJobToItem: new Map(),
  crawlProgressTotal: 0,
  apiOnline: null,
  pollTimer: null,
  preloadTimer: null,
  warmTimer: null,
  warmScopeKey: '',
  preloadedScopeKeys: new Set(),
};

function qs(id) { return document.getElementById(id); }
function token() { return localStorage.getItem('spoticheck_token'); }
function setToken(value) { localStorage.setItem('ytmanager_token', value); }
function setStoredUser(user) { localStorage.setItem('ytmanager_user', JSON.stringify(user)); }
function storedUser() {
  return null; // Always bootstrap against the shared login, never another account's cached YTM profile.
}
function currentUserCacheId() {
  return String(state.user?.id || state.user?.username || 'anonymous');
}
function listCacheKey(params = getBackendListParams()) {
  const scope = getBackendListScopeKey(params);
  return `ytmanager_list_cache_v${LIST_CACHE_VERSION}:${currentUserCacheId()}:${scope}`;
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
function clearListCache() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith(`ytmanager_list_cache_v${LIST_CACHE_VERSION}:`))
    .forEach((key) => localStorage.removeItem(key));
}
function roleLabel(role) {
  return role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'User';
}
function canManageUsers() {
  return state.user && ['admin', 'manager'].includes(state.user.role);
}
function canManageApiKeys() {
  return state.user && state.user.role === 'admin';
}
function isScopedAdmin() {
  return state.user && ['admin', 'manager'].includes(state.user.role);
}
function setSidebarActive(view) {
  ['links', 'settings', 'users'].forEach((name) => {
    qs(`nav-${name}`)?.classList.toggle('sidebar-nav-active', view === name);
  });
}
function logout() {
  if (window.parent !== window) {
    window.parent.document.getElementById('btn-logout')?.click();
    return;
  }
  localStorage.removeItem('spoticheck_token');
  localStorage.removeItem('ytmanager_token');
  localStorage.removeItem('ytmanager_user');
  clearListCache();
  window.location.href = '/login.html';
}
function requireAuth() {
  if (!token()) {
    window.location.href = '/login.html';
    return false;
  }
  state.user = storedUser();
  return true;
}

async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token()) headers.Authorization = 'Bearer ' + token();
  const res = await fetch(CONFIG.API_BASE + path, { ...opts, headers });
  if (res.status === 401) {
    logout();
    return;
  }
  if (!res.ok) {
    const payload = await res.clone().json().catch(() => null);
    throw new Error(payload?.detail || payload?.message || await res.text() || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiDownload(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token()) headers.Authorization = 'Bearer ' + token();
  const res = await fetch(CONFIG.API_BASE + path, { ...opts, headers });
  if (res.status === 401) {
    logout();
    return null;
  }
  if (!res.ok) {
    const payload = await res.clone().json().catch(() => null);
    throw new Error(payload?.detail || payload?.message || await res.text() || `HTTP ${res.status}`);
  }
  return res.blob();
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

const api = {
  health: () => apiFetch('/health'),
  me: () => apiFetch('/auth/me'),
  users: () => apiFetch('/auth/users'),
  createUser: (body) => apiFetch('/auth/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id, body) => apiFetch(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteUser: (id) => apiFetch(`/auth/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id, password) => apiFetch(`/auth/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password: password }) }),
  items: (params = {}) => {
    const normalized = typeof params === 'string' ? { user_id: params } : params;
    return apiFetch('/items' + buildQuery(normalized));
  },
  itemIds: (params = {}) => apiFetch('/items/ids' + buildQuery(params)),
  itemsSummary: (params = {}) => apiFetch('/items/summary' + buildQuery(params)),
  crawlBatch: (urls, group, targetUserId, itemIds = null) => apiFetch('/crawl/batch', {
    method: 'POST',
    body: JSON.stringify({ urls, group: group || null, target_user_id: targetUserId || null, item_ids: itemIds }),
  }),
  crawlScope: (params = {}) => apiFetch('/crawl/scope', {
    method: 'POST',
    body: JSON.stringify({
      group: params.group || null,
      search: params.search || null,
      target_user_id: params.user_id || null,
    }),
  }),
  moveItems: (itemIds, group, userId = null) => apiFetch('/items/move', {
    method: 'POST',
    body: JSON.stringify({ item_ids: itemIds, group: group || null, user_id: userId || null }),
  }),
  renameGroup: (oldGroup, newGroup, userId = null) => {
    const sp = new URLSearchParams({ old_group: oldGroup, new_group: newGroup || '' });
    if (userId) sp.set('user_id', userId);
    return apiFetch('/items/group?' + sp.toString(), { method: 'PATCH' });
  },
  deleteItem: (id) => apiFetch(`/items-by-id/${id}`, { method: 'DELETE' }),
  clearItems: (group = null, userId = null) => {
    const sp = new URLSearchParams();
    if (group) sp.set('group', group);
    if (userId) sp.set('user_id', userId);
    return apiFetch('/items' + (sp.toString() ? '?' + sp.toString() : ''), { method: 'DELETE' });
  },
  jobBatch: (jobIds) => apiFetch('/jobs/batch', { method: 'POST', body: JSON.stringify({ job_ids: jobIds }) }),
  getGroups: (userId = '') => apiFetch(userId ? `/auth/users/${userId}/groups` : '/auth/me/groups'),
  saveGroups: (groups, userId = '') => apiFetch(userId ? `/auth/users/${userId}/groups` : '/auth/me/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  }),
  exportExcel: (itemIds) => apiDownload('/items/export', {
    method: 'POST',
    body: JSON.stringify({ format: 'xlsx', item_ids: itemIds }),
  }),
  prefs: () => apiFetch('/auth/me/preferences'),
  savePrefs: (preferences) => apiFetch('/auth/me/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
  apiKeys: () => apiFetch('/settings/api-keys'),
  saveApiKeys: (api_keys) => apiFetch('/settings/api-keys', { method: 'PUT', body: JSON.stringify({ api_keys }) }),
  checkApiKeys: () => apiFetch('/settings/api-keys/check', { method: 'POST' }),
  changePassword: (current_password, new_password) => apiFetch('/auth/me/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}
function formatNumber(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('vi-VN');
}
function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
function timeAgo(value) {
  const d = parseDate(value);
  if (!d) return '-';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
function formatDate(value) {
  const d = parseDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}
function itemUrl(item) {
  return item.youtube_url || (item.youtube_id ? `https://www.youtube.com/channel/${item.youtube_id}` : item.query || '');
}
function itemKey(item) { return String(item.id); }
function selectedItems() { return state.items.filter((item) => state.selected.has(itemKey(item))); }
function visibleRowKeys() { return state.filteredItems.map(itemKey); }
function itemKeys(items) { return items.map((item) => itemKey(item)); }
function itemsByKeys(keys) {
  const wanted = new Set(keys.map(String));
  return state.items.filter((item) => wanted.has(itemKey(item)));
}
function clearSelection() {
  if (!state.selected.size) return false;
  state.selected.clear();
  state.lastSelectedRowKey = null;
  updateSelectionActions();
  return true;
}
function clearAllSelections() {
  return clearSelection();
}
function shouldClearSelectionFromClick(event) {
  if (state.view !== 'links' || !state.selected.size) return false;
  const target = event.target;
  if (target.closest('[data-row-id]')) return false;
  if (target.closest('#group-panel')) {
    return !target.closest('[data-group], [data-group-row], button, input, textarea, select, [data-owner-filter], [data-inline-group-input]');
  }
  if (target.closest('[data-selection-action]')) return false;
  if (target.closest('#context-menu')) return false;
  return true;
}
function selectRowRange(targetKey) {
  const keys = visibleRowKeys();
  const targetIndex = keys.indexOf(String(targetKey));
  const anchorIndex = keys.indexOf(String(state.lastSelectedRowKey));
  if (targetIndex < 0 || anchorIndex < 0) return false;
  const [start, end] = targetIndex < anchorIndex ? [targetIndex, anchorIndex] : [anchorIndex, targetIndex];
  keys.slice(start, end + 1).forEach((key) => state.selected.add(key));
  state.lastSelectedRowKey = String(targetKey);
  updateSelectionActions();
  return true;
}
function selectAllRows() {
  const keys = visibleRowKeys();
  state.selected = new Set(keys);
  state.lastSelectedRowKey = keys[keys.length - 1] || null;
  updateSelectionActions();
  return keys.length;
}
function updateSelectionActions() {
  const rowCount = state.selected.size;
  qs('footer-selected') && (qs('footer-selected').textContent = rowCount);
  qs('kpi-selected') && (qs('kpi-selected').textContent = rowCount);
  qs('row-selection-toolbar')?.classList.toggle('hidden', rowCount === 0);
  qs('btn-clear-selection')?.classList.toggle('hidden', rowCount === 0);
  qs('btn-delete-selection')?.classList.toggle('hidden', rowCount === 0);
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
async function handleSelectionAction(action) {
  if (action === 'select-all-rows') {
    selectAllRows();
    renderRows({ preserveScroll: true });
    return;
  }
  if (action === 'clear-rows') {
    clearSelection();
    renderRows({ preserveScroll: true });
    return;
  }
  if (action === 'delete-rows') return deleteSelected();
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
function groupScopeLabel(groupId) {
  if (groupId === ALL_GROUP_ID) return 'current group';
  if (!groupId) return 'No group';
  return `group ${groupId}`;
}
function itemsForGroup(groupId) {
  return loadedItemsForGroup(groupId);
}
function isDeadItem(item) {
  return ['error', 'dead'].includes(String(item.status || '').toLowerCase()) || !!item.error_message;
}
function exportFileName(scopeLabel, ext) {
  const stamp = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date()).replace(/[/:]/g, '-').replace(/\s+/g, ' ');
  const safeScope = String(scopeLabel || 'channels').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'channels';
  return `${safeScope} ${stamp}.${ext}`;
}
function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function downloadBlobFile(filename, blob) {
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
  if (!items.length) return toast('Không có kênh để xuất', 'error');
  const lines = items.map((item) => [
    item.name || item.query || '',
    itemUrl(item),
    formatDate(item.last_checked || item.created_at),
    item.video_count ?? '',
    item.subscriber_count ?? '',
    item.view_count ?? '',
  ].join('\t'));
  downloadTextFile(exportFileName(scopeLabel, 'txt'), `\ufeff${lines.join('\r\n')}`, 'text/plain;charset=utf-8');
  toast(`Đã xuất TXT ${items.length} kênh`, 'success');
}
async function exportExcel(items, scopeLabel = 'channels') {
  if (!items.length) return toast('Không có kênh để xuất', 'error');
  const blob = await api.exportExcel(items.map((item) => item.id).filter(Boolean));
  if (!blob) return;
  downloadBlobFile(exportFileName(scopeLabel, 'xlsx'), blob);
  toast(`Đã xuất Excel ${items.length} kênh`, 'success');
}
function applyRowOrder(items) {
  const index = new Map((state.rowOrder || []).map((id, idx) => [String(id), idx]));
  return [...items].sort((a, b) => {
    const ak = itemKey(a);
    const bk = itemKey(b);
    const ai = index.has(ak) ? index.get(ak) : Number.MAX_SAFE_INTEGER;
    const bi = index.has(bk) ? index.get(bk) : Number.MAX_SAFE_INTEGER;
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
      const result = String(av).localeCompare(String(bv), 'vi', { sensitivity: 'base', numeric: true });
      return result * dir || rowOrderIndex(a) - rowOrderIndex(b);
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
function renderSortHeaders() {
  document.querySelectorAll('[data-sort-key]').forEach((button) => {
    const active = button.dataset.sortKey === state.sortKey;
    button.classList.toggle('is-active', active);
    button.dataset.sortDir = active ? state.sortDir : '';
    const icon = button.querySelector('[data-sort-icon]');
    if (icon) icon.textContent = active ? (state.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
  });
}
function ensureSortHeaders() {
  const head = document.querySelector('.list-columns-head');
  if (!head) return;
  const columns = [
    ['stt', 'STT', ''],
    ['name', 'K&ecirc;nh', ''],
    ['updated', 'Owner / Updated', ''],
    ['video', 'Video', 'sort-header-right'],
    ['subscriber', 'Subscriber', 'sort-header-right'],
    ['view', 'View', 'sort-header-right'],
    ['delta', 'Bi&#7871;n &#273;&#7897;ng / Ng&agrave;y', 'sort-header-right'],
    ['checked', 'Checked', 'sort-header-right'],
  ];
  [...head.children].forEach((cell, index) => {
    const config = columns[index];
    if (!config) return;
    const [key, label, alignClass] = config;
    cell.innerHTML = `<button type="button" class="sort-header ${alignClass}" data-sort-key="${key}">${label} <span class="material-symbols-outlined" data-sort-icon>unfold_more</span></button>`;
  });
  renderSortHeaders();
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
    state.rowOrder = Array.isArray(data?.preferences?.row_order)
      ? data.preferences.row_order.map(String)
      : [];
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
    toast(err.message || 'Không lưu được thứ tự row', 'error');
  }
}
function toast(message, type = 'info') {
  const wrap = qs('toast-container');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function setupUserShell() {
  const user = state.user || {};
  const name = user.username || 'User';
  qs('profile-name').textContent = name;
  qs('profile-role').textContent = roleLabel(user.role);
  qs('profile-avatar').textContent = name.slice(0, 2).toUpperCase();
  qs('nav-users').classList.toggle('hidden', !canManageUsers());
  qs('nav-users').classList.toggle('flex', canManageUsers());
  qs('modal-target-user-wrap').classList.toggle('hidden', !isScopedAdmin());
}

async function refreshCurrentUser() {
  const user = await api.me();
  state.user = user;
  setStoredUser(user);
  setupUserShell();
}

async function loadUsers() {
  if (!canManageUsers()) {
    state.users = state.user ? [state.user] : [];
    return state.users;
  }
  state.users = await api.users();
  renderOwnerSelectors();
  return state.users;
}

function visibleOwners() {
  if (!isScopedAdmin()) return [state.user].filter(Boolean);
  return state.users.length ? state.users : [state.user].filter(Boolean);
}

function ensureDefaultOwnerFilter() {
  if (!isScopedAdmin() || state.adminFilterUserId !== null) return;
  state.adminFilterUserId = state.user?.id || '';
}

function targetUserId() {
  if (!isScopedAdmin()) return '';
  return state.adminFilterUserId ?? state.user?.id ?? '';
}

function currentOwnerForCreate() {
  if (!isScopedAdmin()) return null;
  return qs('modal-target-user')?.value || targetUserId() || state.user.id;
}

function selectSearchPlaceholder(selectId) {
  if (selectId === 'modal-group-select') return 'Search group...';
  if (selectId === 'modal-target-user') return 'Search owner...';
  if (selectId === 'user-modal-role') return 'Search role...';
  if (selectId === 'user-modal-manager') return 'Search manager...';
  return 'Search...';
}

function renderSearchSelect(selectId) {
  const select = qs(selectId);
  if (!select) return;
  select.classList.add('native-select-hidden');
  const selectedOption = select.options[select.selectedIndex] || select.options[0];
  const existing = document.querySelector(`[data-search-select="${selectId}"]`);
  const dropdown = existing || document.createElement('div');
  dropdown.className = `select-search-dropdown ${select.disabled ? 'is-disabled' : ''}`;
  dropdown.dataset.searchSelect = selectId;
  const options = [...select.options].map((option) => {
    const selected = option.value === select.value;
    return `<button type="button" class="select-search-option ${selected ? 'is-selected' : ''}" data-search-select-option="${escapeHtml(option.value)}">
      <span>${escapeHtml(option.textContent || '')}</span>
    </button>`;
  }).join('');
  dropdown.innerHTML = `<button type="button" class="select-search-trigger" data-search-select-trigger aria-expanded="false" ${select.disabled ? 'disabled' : ''}>
      <span class="select-search-label">${escapeHtml(selectedOption?.textContent || '')}</span>
      <span class="material-symbols-outlined">expand_more</span>
    </button>
    <div class="select-search-menu" data-search-select-menu hidden>
      <div class="select-search-input-wrap">
        <span class="material-symbols-outlined select-search-icon">search</span>
        <input class="select-search-input" data-search-select-input placeholder="${selectSearchPlaceholder(selectId)}" autocomplete="off">
      </div>
      <div class="select-search-options">${options}</div>
    </div>`;
  if (!existing) select.insertAdjacentElement('afterend', dropdown);
}

function renderSearchSelects(ids = ['modal-group-select', 'modal-target-user', 'user-modal-role', 'user-modal-manager']) {
  ids.forEach(renderSearchSelect);
}

function ownerFilterLabel(userId = '') {
  if (!userId) return 'All owners';
  const owner = visibleOwners().find((u) => u.id === userId);
  return owner ? `${owner.username} (${roleLabel(owner.role)})` : 'All owners';
}

function renderOwnerSelectors() {
  const owners = visibleOwners();
  const selected = targetUserId() || '';
  const ownerOptions = [
    ...(state.user?.role === 'admin' ? [{ id: '', label: 'All owners', role: '' }] : []),
    ...owners.map((u) => ({ id: u.id, label: u.username, role: roleLabel(u.role) })),
  ];
  const filter = qs('manager-filter-wrap');
  if (filter) {
    filter.classList.toggle('hidden', !isScopedAdmin());
    filter.innerHTML = isScopedAdmin() ? `<div class="owner-filter-dropdown" data-owner-filter>
      <button type="button" class="owner-filter-trigger" data-owner-filter-trigger aria-expanded="false">
        <span class="owner-filter-label">${escapeHtml(ownerFilterLabel(selected))}</span>
        <span class="material-symbols-outlined">expand_more</span>
      </button>
      <div class="owner-filter-menu" data-owner-filter-menu hidden>
        <div class="owner-filter-search-wrap">
          <span class="material-symbols-outlined owner-filter-search-icon">search</span>
          <input class="owner-filter-search" data-owner-filter-search placeholder="Search owner..." autocomplete="off">
        </div>
        ${ownerOptions.map((option) => `<button type="button" class="owner-filter-option ${option.id === selected ? 'is-selected' : ''}" data-owner-filter-option="${escapeHtml(option.id)}">
          <span>${escapeHtml(option.label)}${option.role ? ` (${escapeHtml(option.role)})` : ''}</span>
        </button>`).join('')}
      </div>
    </div>` : '';
  }
  const modalTarget = qs('modal-target-user');
  if (modalTarget) {
    modalTarget.innerHTML = owners.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.username)}</option>`).join('');
    modalTarget.value = selected || state.user?.id || '';
    renderSearchSelect('modal-target-user');
  }
}

async function loadGroups() {
  const data = await api.getGroups(targetUserId());
  state.groups = Array.isArray(data.groups) ? data.groups : [];
  renderGroups();
  renderModalGroups();
  saveListCache();
}

async function saveGroups() {
  await api.saveGroups(state.groups, targetUserId());
}

function itemGroup(item) { return item.group || 'Ungrouped'; }
function allGroupsFromItems() {
  const ordered = (state.groups || []).filter(Boolean);
  const known = new Set(ordered.map((g) => g.toLowerCase()));
  const summaryGroups = Array.isArray(state.itemSummary?.groups) ? state.itemSummary.groups : [];
  const extras = summaryGroups.map((group) => group.name).filter((name) => name && !known.has(String(name).toLowerCase()));
  getLoadedVirtualItems().forEach((item) => {
    if (item.group && !known.has(item.group.toLowerCase())) extras.push(item.group);
  });
  const uniqueExtras = Array.from(new Set(extras)).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...uniqueExtras];
}

function groupCount(groupName) {
  if (groupName === ALL_GROUP_ID) {
    if (state.listPending && state.pendingTotalLabel != null) return state.pendingTotalLabel;
    return state.itemSummary?.all_total ?? state.listTotal ?? getLoadedVirtualItems().length;
  }
  return (state.itemSummary?.groups || []).find((group) => group.name === groupName)?.count || 0;
}

function renderInlineGroupEditRow() {
  const edit = state.inlineGroupEdit;
  if (!edit) return '';
  const label = edit.mode === 'create' ? 'New group name' : 'Rename group';
  return `<div class="group-row group-item group-inline-edit-row w-full">
    <div class="group-row-main group-inline-edit-main w-full flex items-center gap-2 px-3 py-2.5 rounded-lg">
      <span class="material-symbols-outlined text-[#cc0000] text-sm">folder</span>
      <input class="group-inline-input" data-inline-group-input value="${escapeHtml(edit.value || '')}" placeholder="${label}" autocomplete="off">
      <button type="button" class="group-inline-action is-save" data-inline-group-save aria-label="Save group"><span class="material-symbols-outlined">check</span></button>
      <button type="button" class="group-inline-action" data-inline-group-cancel aria-label="Cancel"><span class="material-symbols-outlined">close</span></button>
    </div>
  </div>`;
}

function focusInlineGroupInput() {
  requestAnimationFrame(() => {
    const input = qs('group-list')?.querySelector('[data-inline-group-input]');
    if (!input) return;
    input.focus();
    input.select();
  });
}

function renderGroups() {
  const list = qs('group-list');
  const groups = allGroupsFromItems().filter((g) => g.toLowerCase().includes(state.groupSearch.toLowerCase()));
  const activeClass = (id) => id === state.activeGroup ? 'bg-[#f2f2f2] text-[#0f0f0f] font-medium' : 'text-secondary-text hover:text-[#0f0f0f] hover:bg-[#f2f2f2]';
  const rows = [
    `<button class="group-item w-full flex items-center justify-between px-3 py-2.5 rounded-lg ${activeClass(ALL_GROUP_ID)} ${state.draggingRowKeys.length && state.dragOverGroupId === ALL_GROUP_ID ? 'group-item-drop-target' : ''}" data-group="${ALL_GROUP_ID}">
      <span class="flex items-center gap-3"><span class="material-symbols-outlined text-[#cc0000] text-sm">folder</span><span class="text-[14px] font-semibold">${ALL_GROUP_LABEL}</span></span>
      <span class="text-xs font-medium bg-[#e5e5e5] text-[#0f0f0f] px-2 py-0.5 rounded">${groupCount(ALL_GROUP_ID)}</span>
    </button>`,
    state.inlineGroupEdit?.mode === 'create' ? renderInlineGroupEditRow() : '',
    ...groups.map((name) => {
      if (state.inlineGroupEdit?.mode === 'rename' && state.inlineGroupEdit.originalName === name) {
        return renderInlineGroupEditRow();
      }
      const count = groupCount(name);
      const isAct = name === state.activeGroup;
      const badgeClass = isAct ? 'bg-[#e5e5e5] text-[#0f0f0f]' : 'bg-black/5 text-secondary-text';
      const isDragging = state.draggingGroupId === name;
      const isOver = state.dragOverGroupId === name && !isDragging;
      const dropClass = isOver ? `group-item-drop-target group-drop-${state.dragOverGroupPlacement}` : '';
      return `<div class="group-row group-item w-full ${isDragging ? 'group-item-dragging' : ''} ${dropClass}" draggable="true" data-group-row="${escapeHtml(name)}">
        <button class="group-row-main w-full flex items-center justify-between px-3 py-2.5 rounded-lg ${activeClass(name)}" data-group="${escapeHtml(name)}" aria-selected="${isAct ? 'true' : 'false'}">
          <span class="flex items-center gap-3 min-w-0">
            <span class="material-symbols-outlined text-[#cc0000] text-sm">folder</span>
            <span class="truncate text-[14px] font-semibold">${escapeHtml(name)}</span>
          </span>
          <span class="group-row-count text-xs font-bold ${badgeClass} px-2 py-0.5 rounded">${count}</span>
        </button>
        <div class="group-row-actions">
          <button type="button" class="group-row-action is-danger" data-delete-group="${escapeHtml(name)}" aria-label="Delete group"><span class="material-symbols-outlined">delete</span></button>
        </div>
      </div>`;
    })
  ];
  list.innerHTML = rows.join('');
  if (state.inlineGroupEdit) focusInlineGroupInput();
  updateSelectionActions();
}

function renderModalGroups() {
  const select = qs('modal-group-select');
  if (!select) return;
  const groups = allGroupsFromItems();
  select.innerHTML = '<option value="">No group</option>' + groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  if (state.activeGroup !== ALL_GROUP_ID) select.value = state.activeGroup;
  renderSearchSelect('modal-group-select');
}

function matchesActiveGroup(item) {
  return state.activeGroup === ALL_GROUP_ID || item.group === state.activeGroup;
}

function matchesSearch(item) {
  const q = state.search.trim().toLowerCase();
  return matchesSearchQuery(item, q);
}

function matchesSearchQuery(item, q) {
  if (!q) return true;
  return [item.name, item.youtube_id, item.query, item.youtube_url, item.user_name, item.group]
    .some((v) => String(v || '').toLowerCase().includes(q));
}

function applyFilters() {
  state.filteredItems = sortItems(state.items.filter((item) => matchesActiveGroup(item) && matchesSearch(item)));
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
  const hero = qs('playlist-hero');
  if (!hero) return;
  const image = toCssImageUrl(state.filteredItems[0]?.banner_image);
  if (image) {
    hero.style.setProperty('--hero-image', image);
  } else {
    hero.style.removeProperty('--hero-image');
  }
}

function renderDelta(item) {
  const delta = item.view_count_delta;
  if (delta == null) return '<span class="text-secondary-text">-</span>';
  const cls = delta > 0 ? 'metric-delta-up' : delta < 0 ? 'metric-delta-down' : 'metric-delta-flat';
  const sign = delta > 0 ? '+' : '';
  const icon = delta > 0 ? 'arrow_upward' : delta < 0 ? 'arrow_downward' : 'remove';
  const days = item.delta_days == null ? '--' : String(Math.max(1, Number(item.delta_days) || 1)).padStart(2, '0');
  return `<div class="metric-delta ${cls} justify-end"><span class="material-symbols-outlined metric-delta-icon">${icon}</span><span>${sign}${formatNumber(delta)} / ${days}</span></div>`;
}

function ownerDisplayName(item) {
  const owner = item.user_name || 'Owner';
  if (state.user?.role === 'admin' && item.manager_name) {
    return `${owner} (${item.manager_name})`;
  }
  return owner;
}

function getBackendListParams(extra = {}) {
  const params = { ...extra };
  const userId = targetUserId();
  if (userId) params.user_id = userId;
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
  (items || []).forEach((item, index) => {
    state.virtualItems[offset + index] = item;
  });
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

function adjustSummaryForItems(items = [], delta = 0) {
  if (!items.length || !delta) return;
  const summary = ensureItemSummary();
  const visibleDelta = items.filter((item) => matchesActiveGroup(item) && matchesSearch(item)).length * delta;
  summary.total = clampCount(summary.total + visibleDelta);
  summary.all_total = clampCount(summary.all_total + (items.length * delta));
  items.forEach((item) => {
    const bucket = itemStatusBucket(item);
    if (bucket) summary[bucket] = clampCount(summary[bucket] + delta);
    if (!item.group) return;
    let entry = summary.groups.find((group) => group.name === item.group);
    if (!entry && delta > 0) {
      entry = { name: item.group, count: 0 };
      summary.groups.push(entry);
    }
    if (entry) entry.count = clampCount(entry.count + delta);
  });
  summary.groups = summary.groups
    .filter((group) => group.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base', numeric: true }));
}

function channelLabelFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return 'Checking channel';
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || parsed.hostname || raw;
  } catch {
    return raw.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || raw;
  }
}

function ownerForOptimisticItem(ownerId) {
  if (!ownerId) return state.user || {};
  return state.users.find((user) => user.id === ownerId) || state.user || {};
}

function buildOptimisticChannelItem({ id, url, group, ownerId }) {
  const owner = ownerForOptimisticItem(ownerId);
  const label = channelLabelFromUrl(url);
  return {
    id: String(id),
    youtube_id: null,
    type: 'channel',
    query: url,
    query_type: null,
    name: label,
    youtube_url: url,
    image: null,
    banner_image: null,
    video_count: null,
    subscriber_count: null,
    view_count: null,
    view_count_delta: null,
    delta_days: null,
    status: 'crawling',
    error_message: null,
    group: group || null,
    user_id: ownerId || owner.id || null,
    user_name: owner.username || state.user?.username || '',
    manager_name: owner.manager_name || null,
    user_avatar: owner.avatar_url || null,
    created_at: new Date().toISOString(),
    last_checked: null,
  };
}

function applyOptimisticAddItems(items = []) {
  const visible = items.filter((item) => matchesActiveGroup(item) && matchesSearch(item));
  if (!visible.length) {
    adjustSummaryForItems(items, 1);
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
  adjustSummaryForItems(items, 1);
  renderGroups();
  renderModalGroups();
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

function adjustGroupSummaryCount(groupName, delta) {
  if (!groupName || !delta) return;
  const summary = ensureItemSummary();
  let entry = summary.groups.find((group) => group.name === groupName);
  if (!entry && delta > 0) {
    entry = { name: groupName, count: 0 };
    summary.groups.push(entry);
  }
  if (entry) entry.count = clampCount(entry.count + delta);
  summary.groups = summary.groups
    .filter((group) => group.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base', numeric: true }));
}

function applyOptimisticMoveItems(items = [], nextGroup = null) {
  const keys = new Set(items.map(itemKey));
  if (!keys.size) return [];
  const visibilityChanges = items.map((item) => {
    const nextItem = { ...item, group: nextGroup };
    return {
      item,
      before: matchesActiveGroup(item) && matchesSearch(item),
      after: matchesActiveGroup(nextItem) && matchesSearch(nextItem),
    };
  });
  const beforeVisible = visibilityChanges.filter((entry) => entry.before).length;
  const afterVisible = visibilityChanges.filter((entry) => entry.after).length;
  items.forEach((item) => {
    adjustGroupSummaryCount(item.group, -1);
    adjustGroupSummaryCount(nextGroup, 1);
  });
  const summary = ensureItemSummary();
  visibilityChanges.forEach(({ item, before, after }) => {
    const bucket = itemStatusBucket(item);
    if (!bucket) return;
    summary[bucket] = clampCount(summary[bucket] + (after ? 1 : 0) - (before ? 1 : 0));
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
  renderModalGroups();
  renderRows({ preserveScroll: true, skipQueue: true });
  saveListCache();
  return items;
}

function buildListCacheSnapshot(params = getBackendListParams()) {
  return {
    cached_at: Date.now(),
    params,
    groups: Array.isArray(state.groups) ? state.groups : [],
    itemSummary: state.itemSummary || null,
    total: state.listTotal || 0,
    items: state.virtualItems.slice(0, CONFIG.LIST_PAGE_SIZE).filter(Boolean),
  };
}

function saveListCache(params = getBackendListParams()) {
  const snapshot = buildListCacheSnapshot(params);
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
    if (!item.group) return;
    groups.set(item.group, (groups.get(item.group) || 0) + 1);
  });
  return [...groups.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base', numeric: true }));
}

function saveDerivedGroupCachesFromLoadedItems(params = getBackendListParams()) {
  if (params.search || params.sort || params.sort_direction) return;
  const loadedItems = getLoadedVirtualItems();
  if (!loadedItems.length) return;
  const currentUserId = params.user_id || '';
  const allParams = { ...params };
  delete allParams.group;
  if (!params.group && state.listTotal === loadedItems.length && loadedItems.length <= CONFIG.LIST_PAGE_SIZE) {
    const summaryGroups = groupSummaryForItems(loadedItems);
    saveListSnapshotCache(allParams, {
      itemSummary: {
        total: loadedItems.length,
        all_total: loadedItems.length,
        active: loadedItems.filter((item) => item.status === 'active').length,
        errors: loadedItems.filter((item) => item.status === 'error').length,
        crawling: loadedItems.filter((item) => item.status === 'crawling').length,
        groups: summaryGroups,
      },
      total: loadedItems.length,
      items: loadedItems,
    });
    summaryGroups.forEach(({ name, count }) => {
      const groupItems = loadedItems.filter((item) => item.group === name);
      saveListSnapshotCache({ ...(currentUserId ? { user_id: currentUserId } : {}), group: name }, {
        itemSummary: {
          total: count,
          all_total: loadedItems.length,
          active: groupItems.filter((item) => item.status === 'active').length,
          errors: groupItems.filter((item) => item.status === 'error').length,
          crawling: groupItems.filter((item) => item.status === 'crawling').length,
          groups: summaryGroups,
        },
        total: count,
        items: groupItems,
      });
    });
  }
}

function seedScopedCacheFromCurrentItems(params = getBackendListParams()) {
  if ((state.currentListParams.user_id || '') !== (params.user_id || '')) return false;
  if (state.currentListParams.search && state.currentListParams.search !== params.search) return false;
  const loadedItems = getLoadedVirtualItems();
  if (!loadedItems.length || state.listTotal !== loadedItems.length || loadedItems.length > CONFIG.LIST_PAGE_SIZE) return false;

  const sourceGroup = state.currentListParams.group || '';
  const targetGroup = params.group || '';
  if (sourceGroup && sourceGroup !== targetGroup) return false;

  let items = loadedItems;
  if (targetGroup) items = items.filter((item) => item.group === targetGroup);
  if (params.search) items = items.filter((item) => matchesSearchQuery(item, String(params.search).toLowerCase()));
  items = sortItems(items);

  const allItems = sourceGroup ? loadedItems : getLoadedVirtualItems();
  const summaryGroups = groupSummaryForItems(allItems);
  saveListSnapshotCache(params, {
    itemSummary: {
      total: items.length,
      all_total: sourceGroup ? items.length : allItems.length,
      active: items.filter((item) => item.status === 'active').length,
      errors: items.filter((item) => item.status === 'error').length,
      crawling: items.filter((item) => item.status === 'crawling').length,
      groups: summaryGroups,
    },
    total: items.length,
    items,
  });
  return true;
}

function seedGroupCacheFromAllCache(params = getBackendListParams()) {
  if (!params.group || params.search || params.sort || params.sort_direction) return false;
  const allParams = { ...params };
  delete allParams.group;
  const cached = readJsonStorage(listCacheKey(allParams));
  if (!cached || Date.now() - Number(cached.cached_at || 0) > LIST_CACHE_TTL_MS) return false;
  const allItems = Array.isArray(cached.items) ? cached.items : [];
  const total = Number(cached.total) || allItems.length;
  if (!allItems.length || total !== allItems.length || total > CONFIG.LIST_PAGE_SIZE) return false;
  const groupItems = allItems.filter((item) => item.group === params.group);
  const summaryGroups = Array.isArray(cached.itemSummary?.groups) ? cached.itemSummary.groups : groupSummaryForItems(allItems);
  const groupSummary = summaryGroups.find((group) => group.name === params.group);
  saveListSnapshotCache(params, {
    itemSummary: {
      total: groupSummary?.count ?? groupItems.length,
      all_total: cached.itemSummary?.all_total ?? total,
      active: groupItems.filter((item) => item.status === 'active').length,
      errors: groupItems.filter((item) => item.status === 'error').length,
      crawling: groupItems.filter((item) => item.status === 'crawling').length,
      groups: summaryGroups,
    },
    total: groupSummary?.count ?? groupItems.length,
    items: groupItems,
  });
  return true;
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
  renderOwnerSelectors();
  renderGroups();
  renderModalGroups();
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
      if (scopeKey !== state.listScopeKey) return;
      commitPageItems(Array.isArray(data.items) ? data.items : [], pageOffset, data.total ?? state.listTotal);
      saveListCache(state.currentListParams);
      if (options.render !== false) {
        renderGroups();
        renderRows({ preserveScroll: true });
      }
      saveDerivedGroupCachesFromLoadedItems(state.currentListParams);
    })
    .catch((err) => {
      if (!options.silent) toast(err.message || 'Không tải được dữ liệu', 'error');
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
    const missing = state.virtualItems.slice(offset, pageEnd).some((item) => !item);
    if (missing) loadVirtualPage(offset);
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
  const maxPages = Math.max(1, CONFIG.BACKGROUND_WARM_MAX_PAGES);
  for (let offset = CONFIG.LIST_PAGE_SIZE; offset < state.listTotal && offsets.length < maxPages; offset += CONFIG.LIST_PAGE_SIZE) {
    if (!state.loadedPageOffsets.has(offset)) offsets.push(offset);
  }
  if (!offsets.length) return;
  let index = 0;
  const warmNext = async () => {
    if (scopeKey !== state.listScopeKey || state.warmScopeKey !== scopeKey) return;
    const offset = offsets[index];
    index += 1;
    if (offset == null) return;
    await loadVirtualPage(offset, { silent: true, render: false });
    if (scopeKey !== state.listScopeKey || state.warmScopeKey !== scopeKey) return;
    if (index < offsets.length) {
      state.warmTimer = setTimeout(warmNext, CONFIG.BACKGROUND_WARM_DELAY_MS);
    }
  };
  state.warmTimer = setTimeout(warmNext, CONFIG.BACKGROUND_WARM_DELAY_MS);
}

async function preloadFirstPageForParams(params) {
  const scopeKey = getBackendListScopeKey(params);
  if (state.preloadedScopeKeys.has(scopeKey)) return;
  if (readJsonStorage(listCacheKey(params))) {
    state.preloadedScopeKeys.add(scopeKey);
    return;
  }
  state.preloadedScopeKeys.add(scopeKey);
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

function scheduleSiblingGroupPreload() {
  if (state.preloadTimer) clearTimeout(state.preloadTimer);
  if (state.search.trim() || state.sortKey !== 'stt' || state.sortDir !== 'asc') return;
  const groups = [ALL_GROUP_ID, ...allGroupsFromItems()]
    .filter((group) => group !== state.activeGroup)
    .slice(0, CONFIG.PRELOAD_GROUP_LIMIT);
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

function scheduleListPreloads() {
  scheduleCurrentScopeWarmup();
  scheduleSiblingGroupPreload();
}

function getVirtualRange() {
  const scroller = qs('links-view');
  const list = qs('link-list');
  const rowHeight = CONFIG.VIRTUAL_ROW_HEIGHT;
  const listTop = list ? list.offsetTop : 0;
  const viewportTop = Math.max(0, (scroller?.scrollTop || 0) - listTop);
  const viewportHeight = scroller?.clientHeight || window.innerHeight;
  const start = Math.max(0, Math.floor(viewportTop / rowHeight) - CONFIG.VIRTUAL_OVERSCAN_ROWS);
  const end = Math.min(state.listTotal - 1, Math.ceil((viewportTop + viewportHeight) / rowHeight) + CONFIG.VIRTUAL_OVERSCAN_ROWS);
  return { start, end: Math.max(start, end) };
}

function renderVirtualPlaceholder(index) {
  return `<div class="youtube-row youtube-grid-row virtual-row-placeholder px-4 py-3 rounded-lg" data-virtual-row="${index}">
    <div class="text-secondary-text">${index + 1}</div>
    <div class="min-w-0 flex items-center gap-3">
      <span class="virtual-check"></span>
      <span class="virtual-thumb"></span>
      <span class="min-w-0 flex-1"><span class="virtual-line w-52"></span><span class="virtual-line w-36"></span></span>
    </div>
    <div><span class="virtual-line w-28"></span><span class="virtual-line w-20"></span></div>
    <div class="text-right"><span class="virtual-line w-14"></span></div>
    <div class="text-right"><span class="virtual-line w-20"></span></div>
    <div class="text-right"><span class="virtual-line w-24"></span></div>
    <div class="text-right"><span class="virtual-line w-16"></span></div>
    <div class="text-right"><span class="virtual-line w-16"></span></div>
  </div>`;
}

function renderRow(item, idx) {
  const key = itemKey(item);
  const selected = state.selected.has(key);
  const dragging = state.draggingRowKeys.includes(key);
  const dropTarget = state.dragOverRowKey === key && !dragging;
  const title = item.name || item.query || 'Unknown channel';
  const image = item.image || '';
  const imageHtml = image
    ? `<img src="${escapeHtml(image)}" class="w-11 h-11 rounded-md object-cover bg-black/5" alt="">`
    : `<div class="w-11 h-11 rounded-md bg-black/5 grid place-items-center"><span class="material-symbols-outlined text-youtube-red">smart_display</span></div>`;

  let statusClass = 'bg-[#f2f2f2] text-[#606060]';
  if (item.status === 'active' || item.status === 'completed') {
    statusClass = 'bg-[#f2f2f2] text-[#0f0f0f]';
  } else if (item.status === 'error') {
    statusClass = 'bg-[#ffe8e8] text-[#cc0000]';
  } else if (item.status === 'crawling') {
    statusClass = 'bg-[#fff4d6] text-[#8a5a00]';
  }

  return `<div class="youtube-row youtube-grid-row px-4 py-3 rounded-lg ${selected ? 'selected' : ''} ${dragging ? 'row-dragging' : ''} ${dropTarget ? `row-drop-target row-drop-${state.dragOverRowPlacement}` : ''}" draggable="true" data-row-id="${escapeHtml(key)}">
    <div class="text-secondary-text">${idx + 1}</div>
    <div class="min-w-0 flex items-center gap-3">
      <input type="checkbox" data-select-id="${escapeHtml(key)}" ${selected ? 'checked' : ''} class="rounded border-[#d8d8d8] bg-transparent text-[#cc0000] focus:ring-[#cc0000]">
      ${imageHtml}
      <div class="min-w-0">
        <a href="${escapeHtml(itemUrl(item))}" target="_blank" class="font-semibold text-[#0f0f0f] hover:text-[#cc0000] truncate block">${escapeHtml(title)}</a>
        <p class="text-xs text-secondary-text truncate">${escapeHtml(item.youtube_id || item.query || '')}</p>
      </div>
    </div>
    <div class="min-w-0">
      <p class="text-sm text-main truncate">${escapeHtml(ownerDisplayName(item))}</p>
      <p class="text-xs text-secondary-text">${formatDate(item.last_checked || item.created_at)}</p>
    </div>
    <div class="text-right metric-main text-main">${formatNumber(item.video_count)}</div>
    <div class="text-right metric-main text-main">${formatNumber(item.subscriber_count)}</div>
    <div class="text-right metric-main text-main">${formatNumber(item.view_count)}</div>
    <div class="text-right">${renderDelta(item)}</div>
    <div class="text-right flex flex-col items-end gap-1">
      <span class="text-[11px] font-bold px-2 py-0.5 rounded tracking-wide uppercase ${statusClass}">${escapeHtml(item.status || 'pending')}</span>
      <p class="text-[11px] text-secondary-text">${timeAgo(item.last_checked)}</p>
    </div>
  </div>`;
}

function renderRows(options = {}) {
  const scroller = qs('links-view');
  const savedScrollTop = options.preserveScroll ? scroller?.scrollTop : null;
  state.filteredItems = getLoadedVirtualItems();
  updateHeroCover();
  renderSortHeaders();
  const list = qs('link-list');
  const empty = qs('empty-state');
  if (state.listPending && !state.listTotal) {
    empty.classList.add('hidden');
    const placeholderRows = Math.max(6, Number(state.pendingPlaceholderRows) || CONFIG.VIRTUAL_OVERSCAN_ROWS);
    list.innerHTML = Array.from({ length: placeholderRows }, (_, idx) => renderVirtualPlaceholder(idx)).join('');
    if (savedScrollTop != null && scroller) scroller.scrollTop = savedScrollTop;
    updateStats();
    return;
  }
  if (!state.listTotal) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    updateStats();
    return;
  }
  empty.classList.add('hidden');
  const { start, end } = getVirtualRange();
  const top = start * CONFIG.VIRTUAL_ROW_HEIGHT;
  const bottom = Math.max(0, (state.listTotal - end - 1) * CONFIG.VIRTUAL_ROW_HEIGHT);
  const rows = [];
  for (let idx = start; idx <= end; idx += 1) {
    const item = state.virtualItems[idx];
    rows.push(item ? renderRow(item, idx) : renderVirtualPlaceholder(idx));
  }
  list.innerHTML = `<div class="virtual-spacer" style="height:${top}px"></div>${rows.join('')}<div class="virtual-spacer" style="height:${bottom}px"></div>`;
  if (savedScrollTop != null && scroller) scroller.scrollTop = savedScrollTop;
  if (!options.skipQueue) queueVirtualPagesForRange(start, end);
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
  renderModalGroups();
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
  if (state.listPending) {
    const total = state.pendingTotalLabel ?? '...';
    [
      ['kpi-total', total], ['kpi-active', '...'], ['kpi-errors', '...'], ['kpi-crawling', '...'], ['kpi-selected', state.selected.size],
      ['footer-total', total], ['footer-active', '...'], ['footer-errors', '...'], ['footer-crawling', '...'], ['footer-selected', state.selected.size],
    ].forEach(([id, value]) => { const el = qs(id); if (el) el.textContent = value; });
    qs('btn-clear-list').classList.toggle('hidden', true);
    updateSelectionActions();
    return;
  }
  const summary = state.itemSummary || {};
  const loaded = getLoadedVirtualItems();
  const total = summary.total ?? state.listTotal ?? loaded.length;
  const active = summary.active ?? loaded.filter((item) => item.status === 'active').length;
  const errors = summary.errors ?? loaded.filter((item) => item.status === 'error').length;
  const crawling = summary.crawling ?? loaded.filter((item) => item.status === 'crawling').length;
  [
    ['kpi-total', total], ['kpi-active', active], ['kpi-errors', errors], ['kpi-crawling', crawling], ['kpi-selected', state.selected.size],
    ['footer-total', total], ['footer-active', active], ['footer-errors', errors], ['footer-crawling', crawling], ['footer-selected', state.selected.size],
  ].forEach(([id, value]) => { const el = qs(id); if (el) el.textContent = value; });
  qs('btn-clear-list').classList.toggle('hidden', total === 0);
  updateSelectionActions();
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
  renderModalGroups();
  renderRows({ preserveScroll: options.preserveScroll });
  saveListCache(params);
  saveDerivedGroupCachesFromLoadedItems(params);
  scheduleListPreloads();
}

async function refreshItems(items) {
  if (!items.length) return;
  const urls = items.map(itemUrl).filter(Boolean);
  const itemIds = items.map((item) => item.id);
  markItemsCrawling(itemIds);
  toast(`Đang gửi refresh ${itemIds.length} kênh`, 'info');
  const response = await api.crawlBatch(urls, null, targetUserId() || null, itemIds);
  trackRefreshJobs({ ...response, item_ids: response.item_ids?.length ? response.item_ids : itemIds });
  toast(`Đã bắt đầu refresh ${response.count} kênh`, 'success');
}

async function pollJobs() {
  const ids = [...state.pendingJobs];
  if (!ids.length) {
    stopPolling();
    return;
  }
  try {
    const data = await api.jobBatch(ids);
    const jobs = data.jobs || [];
    let changed = false;
    jobs.forEach((job) => {
      if (!['completed', 'error'].includes(job.status)) return;
      state.pendingJobs.delete(job.id);
      const itemId = job.item_id || state.pendingJobToItem.get(job.id);
      if (job.result && itemId) {
        const idx = state.items.findIndex((item) => item.id === itemId);
        if (idx >= 0) {
          state.items[idx] = { ...state.items[idx], ...job.result };
          changed = true;
        }
        const virtualIdx = state.virtualItems.findIndex((item) => item?.id === itemId);
        if (virtualIdx >= 0) {
          state.virtualItems[virtualIdx] = { ...state.virtualItems[virtualIdx], ...job.result };
          changed = true;
        }
      }
      if (job.status === 'error') toast(job.error || 'Refresh lỗi', 'error');
    });
    updateApiStatus();
    if (changed) {
      renderGroups();
      renderRows();
    }
    if (!state.pendingJobs.size) {
      stopPolling();
      state.crawlProgressTotal = 0;
      updateApiStatus();
      await loadItems();
    }
  } catch (err) {
    console.warn(err);
  }
}
function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(pollJobs, CONFIG.POLL_INTERVAL);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  if (!state.pendingJobs.size) updateApiStatus();
}

function openAddModal() {
  renderModalGroups();
  renderOwnerSelectors();
  qs('modal-batch-input').value = '';
  qs('add-link-modal').classList.add('open');
  qs('modal-batch-input').focus();
}
function closeAddModal() { qs('add-link-modal').classList.remove('open'); }

async function submitAddChannels() {
  const urls = qs('modal-batch-input').value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!urls.length) {
    toast('Vui lòng nhập URL kênh', 'error');
    return;
  }
  const group = qs('modal-group-select').value || null;
  const owner = currentOwnerForCreate();
  closeAddModal();
  const response = await api.crawlBatch(urls, group, owner);
  const accepted = Array.isArray(response.accepted_indices) ? response.accepted_indices : urls.map((_, index) => index);
  const optimisticItems = accepted
    .map((sourceIndex, resultIndex) => {
      const id = response.item_ids?.[resultIndex];
      const url = urls[sourceIndex];
      return id && url ? buildOptimisticChannelItem({ id, url, group, ownerId: owner }) : null;
    })
    .filter(Boolean);
  applyOptimisticAddItems(optimisticItems);
  trackRefreshJobs(response);
  toast(`Đã thêm ${response.count} kênh vào hàng check`, 'success');
  invalidateItemCaches();
  loadItemsInBackground({ preserveScroll: true });
}

function setActiveGroup(group) {
  state.activeGroup = group || ALL_GROUP_ID;
  qs('breadcrumb-group').textContent = state.activeGroup === ALL_GROUP_ID ? ALL_GROUP_LABEL : state.activeGroup;
  qs('page-title').textContent = qs('breadcrumb-group').textContent;
}

function createGroup() {
  closeContextMenu();
  state.inlineGroupEdit = { mode: 'create', originalName: '', value: '' };
  renderGroups();
}

function renameGroup(name) {
  closeContextMenu();
  state.inlineGroupEdit = { mode: 'rename', originalName: name, value: name };
  renderGroups();
}

function cancelInlineGroupEdit() {
  state.inlineGroupEdit = null;
  renderGroups();
}

async function commitInlineGroupEdit() {
  const edit = state.inlineGroupEdit;
  if (!edit) return;
  const input = qs('group-list')?.querySelector('[data-inline-group-input]');
  const next = (input?.value || edit.value || '').trim();
  if (!next) {
    toast('Tên group không được để trống', 'error');
    focusInlineGroupInput();
    return;
  }
  const duplicate = allGroupsFromItems().some((group) => (
    group.toLowerCase() === next.toLowerCase() && group !== edit.originalName
  ));
  if (duplicate) {
    toast('Group này đã tồn tại', 'error');
    focusInlineGroupInput();
    return;
  }
  if (edit.mode === 'create') {
    state.groups.push(next);
    state.inlineGroupEdit = null;
    setActiveGroup(next);
    state.itemSummary = {
      ...ensureItemSummary(),
      total: 0,
      active: 0,
      errors: 0,
      crawling: 0,
    };
    renderGroups();
    renderModalGroups();
    clearListPending();
    resetVirtualList(0, getBackendListParams(), { preserveLoaded: false });
    renderRows({ preserveScroll: true, skipQueue: true });
    invalidateItemCaches();
    Promise.resolve()
      .then(async () => {
        await saveGroups();
        await loadItems({ preserveScroll: true });
      })
      .catch((err) => {
        toast(err.message || 'Lưu group lỗi', 'error');
        loadGroups().catch((loadErr) => toast(loadErr.message, 'error'));
      });
    return;
  }
  if (edit.originalName === next) {
    state.inlineGroupEdit = null;
    renderGroups();
    return;
  }
  const originalName = edit.originalName;
  state.groups = state.groups.filter((g) => g !== edit.originalName);
  state.groups.push(next);
  if (state.activeGroup === edit.originalName) setActiveGroup(next);
  state.virtualItems = state.virtualItems.map((item) => (
    item?.group === originalName ? { ...item, group: next } : item
  ));
  const summaryGroup = state.itemSummary?.groups?.find((group) => group.name === originalName);
  if (summaryGroup) summaryGroup.name = next;
  state.items = getLoadedVirtualItems();
  state.inlineGroupEdit = null;
  renderGroups();
  renderModalGroups();
  renderRows({ preserveScroll: true, skipQueue: true });
  invalidateItemCaches();
  Promise.resolve()
    .then(async () => {
      await api.renameGroup(originalName, next, targetUserId() || null);
      await saveGroups();
      loadItemsInBackground({ preserveScroll: true });
    })
    .catch((err) => {
      toast(err.message || 'Đổi tên group lỗi', 'error');
      Promise.all([loadGroups(), loadItems({ preserveScroll: true })]).catch((loadErr) => toast(loadErr.message, 'error'));
    });
}
async function deleteGroup(name) {
  await deleteGroups([name]);
}
async function deleteGroups(names = []) {
  const targets = Array.from(new Set(names.map(String).filter(Boolean))).filter((name) => name !== ALL_GROUP_ID);
  if (!targets.length) return toast('Chưa chọn group', 'info');
  const label = targets.length === 1 ? `group "${targets[0]}"` : `${targets.length} groups`;
  if (!confirm(`Xóa ${label}? Channel sẽ được đưa về No group.`)) return;
  state.groups = state.groups.filter((g) => !targets.includes(g));
  if (targets.includes(state.activeGroup)) setActiveGroup(ALL_GROUP_ID);
  renderGroups();
  renderModalGroups();
  invalidateItemCaches();
  showInstantListOrPending(getBackendListParams(), { keepCurrentOnMiss: true });
  Promise.resolve()
    .then(async () => {
      for (const name of targets) {
        await api.renameGroup(name, '', targetUserId() || null);
      }
      await saveGroups();
      loadItemsInBackground({ preserveScroll: true });
    })
    .catch((err) => {
      toast(err.message || 'Xoá group lỗi', 'error');
      Promise.all([loadGroups(), loadItems({ preserveScroll: true })]).catch((loadErr) => toast(loadErr.message, 'error'));
    });
}
async function moveSelectedToGroup() {
  const items = selectedItems();
  if (!items.length) return toast('Chưa chọn row', 'error');
  const group = prompt('Chuyển tới group (để trống để bỏ group)', state.activeGroup !== ALL_GROUP_ID ? state.activeGroup : '');
  if (group == null) return;
  const nextGroup = group.trim() || null;
  applyOptimisticMoveItems(items, nextGroup);
  if (nextGroup && !state.groups.includes(nextGroup)) {
    state.groups.push(nextGroup);
    renderGroups();
    renderModalGroups();
  }
  invalidateItemCaches();
  toast(`Đã chuyển ${items.length} kênh`, 'success');
  Promise.resolve()
    .then(async () => {
      await api.moveItems(items.map((i) => i.id), nextGroup, targetUserId() || null);
      if (nextGroup) await saveGroups();
      loadItemsInBackground({ preserveScroll: true });
    })
    .catch((err) => {
      toast(err.message || 'Chuyển group lỗi', 'error');
      loadItemsInBackground({ preserveScroll: true });
    });
}
async function deleteSelected() {
  const ids = [...state.selected];
  if (!ids.length) return toast('Chưa chọn row', 'error');
  if (!confirm(`Xóa ${ids.length} kênh đã chọn?`)) return;
  const removed = applyOptimisticRemoveItemsByIds(ids);
  try {
    for (const id of ids) await api.deleteItem(id);
    invalidateItemCaches();
    toast(`Đã xoá ${ids.length} kênh`, 'success');
    loadItemsInBackground({ preserveScroll: true });
  } catch (err) {
    toast(err.message || 'Xoá kênh lỗi', 'error');
    if (removed.length) loadItemsInBackground({ preserveScroll: true });
  }
}
async function deleteDeadItems(items, label = 'list') {
  const dead = items.filter(isDeadItem);
  if (!dead.length) return toast('Không có kênh chết để xoá', 'info');
  if (!confirm(`Xóa ${dead.length} kênh chết trong ${label}?`)) return;
  const ids = dead.map(itemKey);
  const removed = applyOptimisticRemoveItemsByIds(ids);
  try {
    for (const item of dead) await api.deleteItem(item.id);
    invalidateItemCaches();
    toast(`Đã xoá ${dead.length} kênh chết`, 'success');
    loadItemsInBackground({ preserveScroll: true });
  } catch (err) {
    toast(err.message || 'Xoá kênh chết lỗi', 'error');
    if (removed.length) loadItemsInBackground({ preserveScroll: true });
  }
}
async function clearCurrentList() {
  const group = state.activeGroup === ALL_GROUP_ID ? null : state.activeGroup;
  const label = group ? `group "${group}"` : 'toàn bộ list đang thấy';
  if (!confirm(`Xóa ${label}?`)) return;
  const ids = getLoadedVirtualItems().map(itemKey);
  const removed = applyOptimisticRemoveItemsByIds(ids);
  try {
    await api.clearItems(group, targetUserId() || null);
    state.selected.clear();
    invalidateItemCaches();
    toast(`Đã xoá ${label}`, 'success');
    loadItemsInBackground({ preserveScroll: true });
  } catch (err) {
    toast(err.message || 'Xoá list lỗi', 'error');
    if (removed.length) loadItemsInBackground({ preserveScroll: true });
  }
}
async function copySelectedLinks() {
  const items = selectedItems();
  const target = items.length ? items : await loadAllItemsForScope();
  await navigator.clipboard.writeText(target.map(itemUrl).join('\n'));
  toast(`Đã copy ${target.length} link`, 'success');
}

async function loadAllItemsForScope(params = getBackendListParams()) {
  const first = await api.items({ ...params, limit: CONFIG.BULK_PAGE_SIZE, offset: 0 });
  const items = Array.isArray(first.items) ? [...first.items] : [];
  const total = Number(first.total ?? items.length) || 0;
  for (let offset = CONFIG.BULK_PAGE_SIZE; offset < total; offset += CONFIG.BULK_PAGE_SIZE) {
    const page = await api.items({ ...params, limit: CONFIG.BULK_PAGE_SIZE, offset });
    if (Array.isArray(page.items)) items.push(...page.items);
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
  const loaded = state.virtualItems
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item);
  const loadedKeys = loaded.map((entry) => itemKey(entry.item));
  const nextKeys = moveKeys(loadedKeys, dragKeys, targetKey, placement);
  if (nextKeys === loadedKeys) return;
  const byKey = new Map(loaded.map((entry) => [itemKey(entry.item), entry.item]));
  loaded.forEach((entry, index) => {
    state.virtualItems[entry.index] = byKey.get(nextKeys[index]) || entry.item;
  });
  state.items = getLoadedVirtualItems();
}

function markItemsCrawling(itemIds = []) {
  const ids = new Set(itemIds.map(String));
  if (!ids.size) return;
  state.virtualItems = state.virtualItems.map((item) => {
    if (!item || !ids.has(item.id)) return item;
    return { ...item, status: 'crawling', error_message: null };
  });
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
    const isNew = !state.pendingJobs.has(jobId);
    state.pendingJobs.add(jobId);
    if (isNew) added += 1;
    if (itemIds[index]) state.pendingJobToItem.set(jobId, itemIds[index]);
  });
  if (added) state.crawlProgressTotal = state.pendingJobs.size;
  markItemsCrawling(itemIds);
  updateApiStatus();
  startPolling();
}

async function refreshScope(params = getBackendListParams(), label = 'channels') {
  toast(`Đang gửi refresh ${label}`, 'info');
  const response = await api.crawlScope(params);
  trackRefreshJobs(response);
  toast(`Đã bắt đầu refresh ${response.count} ${label}`, 'success');
}

function paramsForGroup(groupId) {
  const params = getBackendListParams();
  if (groupId === ALL_GROUP_ID) {
    delete params.group;
  } else {
    params.group = groupId || '';
  }
  return params;
}

function loadedItemsForGroup(groupId) {
  if (groupId === ALL_GROUP_ID) return getLoadedVirtualItems();
  if (!groupId) return getLoadedVirtualItems().filter((item) => !item.group);
  return getLoadedVirtualItems().filter((item) => item.group === groupId);
}

function closeContextMenu() {
  const menu = qs('context-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.innerHTML = '';
}

function contextButton(action, icon, label, extraClass = '') {
  return `<button type="button" class="row-context-item ${extraClass}" data-context-action="${escapeHtml(action)}">
    <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
    <span>${escapeHtml(label)}</span>
  </button>`;
}

function positionContextMenu(menu, x, y) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 10);
  const top = Math.min(y, window.innerHeight - rect.height - 10);
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;
}

function showRowContextMenu(event, rowId) {
  const menu = qs('context-menu');
  if (!menu) return;
  if (!state.selected.has(rowId)) state.selected = new Set([rowId]);
  state.contextItemIds = [...state.selected];
  const contextItems = itemsByKeys(state.contextItemIds);
  state.contextGroup = contextGroupForItems(contextItems);
  renderRows();
  const groups = allGroupsFromItems();
  const selectedLabel = state.contextItemIds.length > 1 ? `${state.contextItemIds.length} selected channels` : 'selected channel';
  const hasConcreteGroupScope = state.contextGroup !== ALL_GROUP_ID;
  const groupActionLabel = groupScopeLabel(state.contextGroup);
  const moveOptions = [
    `<button type="button" class="row-context-item row-context-submenu-item" data-context-move-group="">
      <span class="material-symbols-outlined">folder_off</span>
      <span>No group</span>
    </button>`,
    ...groups.map((group) => `<button type="button" class="row-context-item row-context-submenu-item" data-context-move-group="${escapeHtml(group)}">
      <span class="material-symbols-outlined">folder</span>
      <span>${escapeHtml(group)}</span>
    </button>`),
  ].join('');
  menu.innerHTML = `
    ${contextButton('add-channel', 'add', 'Add Channel')}
    ${contextButton('refresh', 'refresh', `Refresh ${selectedLabel}`)}
    ${contextButton('open', 'open_in_new', 'Open on YouTube')}
    ${contextButton('copy', 'content_copy', `Copy ${selectedLabel} links`)}
    <div class="row-context-parent" data-context-group>
      <button type="button" class="row-context-item row-context-submenu-trigger">
        <span class="material-symbols-outlined">drive_file_move</span>
        <span>Move to group</span>
        <span class="material-symbols-outlined row-context-chevron">chevron_right</span>
      </button>
      <div class="row-context-submenu">${moveOptions}</div>
    </div>
    ${contextButton('export-context-txt', 'description', 'Export selected TXT')}
    ${contextButton('export-context-excel', 'table_view', 'Export selected Excel')}
    <div class="row-context-separator"></div>
    ${hasConcreteGroupScope ? contextButton('refresh-group', 'sync', `Refresh channels in ${groupActionLabel}`) : ''}
    ${contextButton('refresh-all', 'sync_alt', 'Refresh all channels')}
    ${hasConcreteGroupScope ? contextButton('delete-dead-group', 'playlist_remove', `Delete dead channels in ${groupActionLabel}`, 'row-context-danger') : ''}
    ${contextButton('delete-dead-all', 'delete_sweep', 'Delete all dead channels', 'row-context-danger')}
    <div class="row-context-separator"></div>
    ${contextButton('delete', 'delete', 'Delete selected channels', 'row-context-danger')}
  `;
  positionContextMenu(menu, event.clientX, event.clientY);
}

function showGroupContextMenu(event, groupId) {
  const menu = qs('context-menu');
  if (!menu) return;
  state.contextGroup = groupId;
  state.contextItemIds = [];
  const isAll = groupId === ALL_GROUP_ID;
  const label = isAll ? ALL_GROUP_LABEL : groupId;
  menu.innerHTML = `
    ${contextButton('select-group', 'folder_open', `Open ${label}`)}
    ${contextButton('add-group', 'create_new_folder', 'Add Group')}
    ${isAll ? '' : contextButton('rename-group', 'edit', 'Rename group')}
    ${contextButton(isAll ? 'refresh-all' : 'refresh-group', 'refresh', isAll ? 'Refresh all channels' : `Refresh channels in ${label}`)}
    ${contextButton(isAll ? 'delete-dead-all' : 'delete-dead-group', 'playlist_remove', isAll ? 'Delete all dead channels' : `Delete dead channels in ${label}`, 'row-context-danger')}
    <div class="row-context-separator"></div>
    ${contextButton('clear-group', 'playlist_remove', isAll ? 'Clear all channels' : 'Clear channels in group')}
    ${isAll ? '' : contextButton('delete-group', 'delete', 'Delete group', 'row-context-danger')}
  `;
  positionContextMenu(menu, event.clientX, event.clientY);
}

function showWorkspaceContextMenu(event) {
  const menu = qs('context-menu');
  if (!menu) return;
  state.contextGroup = state.activeGroup;
  state.contextItemIds = [];
  const isAllCurrent = state.activeGroup === ALL_GROUP_ID;
  const currentLabel = groupLabel(state.activeGroup);
  menu.innerHTML = `
    ${contextButton('add-channel', 'add', 'Add Channel')}
    ${isAllCurrent ? '' : contextButton('refresh-current', 'refresh', `Refresh channels in ${currentLabel}`)}
    ${contextButton('refresh-all', isAllCurrent ? 'refresh' : 'sync_alt', 'Refresh all channels')}
    ${contextButton('copy-current', 'content_copy', `Copy ${currentLabel} links`)}
    ${contextButton('export-current-txt', 'description', `Export ${currentLabel} TXT`)}
    ${contextButton('export-current-excel', 'table_view', `Export ${currentLabel} Excel`)}
    <div class="row-context-separator"></div>
    ${isAllCurrent ? '' : contextButton('delete-dead-current', 'playlist_remove', `Delete dead channels in ${currentLabel}`, 'row-context-danger')}
    ${contextButton('delete-dead-all', 'delete_sweep', 'Delete all dead channels', 'row-context-danger')}
    <div class="row-context-separator"></div>
    ${contextButton('clear-current', 'playlist_remove', `Clear ${currentLabel}`, 'row-context-danger')}
  `;
  positionContextMenu(menu, event.clientX, event.clientY);
}

function showGroupPanelContextMenu(event) {
  const menu = qs('context-menu');
  if (!menu) return;
  state.contextGroup = ALL_GROUP_ID;
  state.contextItemIds = [];
  menu.innerHTML = `
    ${contextButton('add-group', 'create_new_folder', 'Add Group')}
  `;
  positionContextMenu(menu, event.clientX, event.clientY);
}

async function handleContextAction(action, groupValue = null) {
  const contextItems = itemsByKeys(state.contextItemIds);
  const contextGroup = state.contextGroup || state.activeGroup || ALL_GROUP_ID;
  if (action === 'add-channel') {
    openAddModal();
    return;
  }
  if (action === 'add-group') return createGroup();
  if (action === 'refresh-current') return refreshScope(getBackendListParams(), groupLabel(state.activeGroup));
  if (action === 'refresh-group') return refreshScope(paramsForGroup(contextGroup), groupLabel(contextGroup));
  if (action === 'refresh-all') return refreshScope(paramsForGroup(ALL_GROUP_ID), 'kênh');
  if (action === 'copy-current') {
    const items = await loadAllItemsForScope();
    await navigator.clipboard.writeText(items.map(itemUrl).join('\n'));
    toast(`Đã copy ${items.length} link`, 'success');
    return;
  }
  if (action === 'export-context-txt') return exportTxt(contextItems, 'selected channels');
  if (action === 'export-context-excel') return exportExcel(contextItems, 'selected channels');
  if (action === 'export-current-txt') return exportTxt(await loadAllItemsForScope(), groupLabel(state.activeGroup));
  if (action === 'export-current-excel') return exportExcel(await loadAllItemsForScope(), groupLabel(state.activeGroup));
  if (action === 'export-group-txt') return exportTxt(await loadAllItemsForScope(paramsForGroup(contextGroup)), groupLabel(contextGroup));
  if (action === 'export-group-excel') return exportExcel(await loadAllItemsForScope(paramsForGroup(contextGroup)), groupLabel(contextGroup));
  if (action === 'export-all-txt') return exportTxt(await loadAllItemsForScope(paramsForGroup(ALL_GROUP_ID)), 'all channels');
  if (action === 'export-all-excel') return exportExcel(await loadAllItemsForScope(paramsForGroup(ALL_GROUP_ID)), 'all channels');
  if (action === 'delete-dead-current') return deleteDeadItems(await loadAllItemsForScope(), groupLabel(state.activeGroup));
  if (action === 'delete-dead-group') return deleteDeadItems(await loadAllItemsForScope(paramsForGroup(contextGroup)), groupLabel(contextGroup));
  if (action === 'delete-dead-all') return deleteDeadItems(await loadAllItemsForScope(paramsForGroup(ALL_GROUP_ID)), 'all channels');
  if (action === 'clear-current') return clearCurrentList();
  if (action === 'refresh') return contextItems.length ? refreshItems(contextItems) : refreshScope(getBackendListParams(), groupLabel(state.activeGroup));
  if (action === 'open') {
    const first = contextItems[0];
    if (first) window.open(itemUrl(first), '_blank');
    return;
  }
  if (action === 'copy') {
    const target = contextItems.length ? contextItems : await loadAllItemsForScope();
    await navigator.clipboard.writeText(target.map(itemUrl).join('\n'));
    toast(`Đã copy ${target.length} link`, 'success');
    return;
  }
  if (action === 'move') return moveRowsToGroupByKeys(state.contextItemIds, groupValue || '');
  if (action === 'delete') {
    state.selected = new Set(state.contextItemIds);
    return deleteSelected();
  }
  if (action === 'select-group') {
    setActiveGroup(state.contextGroup || ALL_GROUP_ID);
    showInstantListOrPending(getBackendListParams());
    loadItemsInBackground();
    return;
  }
  if (action === 'rename-group' && state.contextGroup && state.contextGroup !== ALL_GROUP_ID) return renameGroup(state.contextGroup);
  if (action === 'delete-group' && state.contextGroup && state.contextGroup !== ALL_GROUP_ID) return deleteGroup(state.contextGroup);
  if (action === 'clear-group') return clearGroup(state.contextGroup || ALL_GROUP_ID);
}

function dragPlacement(event, element) {
  const rect = element.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
}

function autoScrollLinksWhileDragging(event) {
  const scroller = qs('links-view');
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 86;
  const step = 30;
  if (event.clientY < rect.top + edge) scroller.scrollTop -= step;
  if (event.clientY > rect.bottom - edge) scroller.scrollTop += step;
}

function autoScrollGroupsWhileDragging(event) {
  const scroller = qs('group-list');
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 58;
  const step = 22;
  if (event.clientY < rect.top + edge) scroller.scrollTop -= step;
  if (event.clientY > rect.bottom - edge) scroller.scrollTop += step;
}

function updateBlankRowDrop(event) {
  if (!state.draggingRowKeys.length || !state.filteredItems.length) return false;
  const row = event.target.closest('[data-row-id]');
  if (row) return false;
  autoScrollLinksWhileDragging(event);
  const first = state.filteredItems[0];
  const last = state.filteredItems[state.filteredItems.length - 1];
  const list = qs('link-list');
  const listRect = list?.getBoundingClientRect();
  const placement = !listRect || event.clientY < listRect.top + listRect.height / 2 ? 'before' : 'after';
  const target = placement === 'before' ? itemKey(first) : itemKey(last);
  if (state.dragOverRowKey !== target || state.dragOverRowPlacement !== placement) {
    state.dragOverRowKey = target;
    state.dragOverRowPlacement = placement;
    renderRows();
  }
  return true;
}

function updateBlankGroupDrop(event) {
  if (!state.draggingGroupId) return false;
  const row = event.target.closest('[data-group-row]');
  if (row) return false;
  const rows = [...(qs('group-list')?.querySelectorAll('[data-group-row]') || [])];
  if (!rows.length) return false;
  autoScrollGroupsWhileDragging(event);
  let targetRow = rows[rows.length - 1];
  let placement = 'after';
  for (const candidate of rows) {
    const rect = candidate.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      targetRow = candidate;
      placement = 'before';
      break;
    }
  }
  const target = targetRow.dataset.groupRow;
  if (!target) return false;
  if (target === state.draggingGroupId) {
    if (state.dragOverGroupId) {
      state.dragOverGroupId = null;
      renderGroups();
    }
    return true;
  }
  if (state.dragOverGroupId !== target || state.dragOverGroupPlacement !== placement) {
    state.dragOverGroupId = target;
    state.dragOverGroupPlacement = placement;
    renderGroups();
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

async function reorderRows(dragKeys, targetKey, placement) {
  const draggedSet = new Set(dragKeys);
  if (!targetKey || draggedSet.has(targetKey)) return;
  applyOptimisticRowReorder(dragKeys, targetKey, placement);
  renderRows({ preserveScroll: true });

  const currentScopeIds = await loadAllItemIdsForScope();
  const allOwnerIds = state.activeGroup === ALL_GROUP_ID && !state.search.trim()
    ? currentScopeIds
    : await loadAllItemIdsForScope(paramsForGroup(ALL_GROUP_ID));
  const nextVisible = moveKeys(currentScopeIds, dragKeys, targetKey, placement);
  const visibleSet = new Set(nextVisible);
  const hidden = allOwnerIds.filter((key) => !visibleSet.has(key));
  state.rowOrder = [...nextVisible, ...hidden];
  state.sortKey = 'stt';
  state.sortDir = 'asc';
  await saveRowOrder();
  loadItems({ preserveScroll: true }).catch((err) => toast(err.message, 'error'));
}

async function reorderGroups(dragged, target, placement) {
  if (!dragged || !target || dragged === target) return;
  const groups = allGroupsFromItems().filter((group) => group !== dragged);
  let insertAt = groups.indexOf(target);
  if (insertAt < 0) return;
  if (placement === 'after') insertAt += 1;
  groups.splice(insertAt, 0, dragged);
  state.groups = groups;
  renderGroups();
  renderModalGroups();
  saveGroups().catch((err) => {
    toast(err.message || 'Lưu thứ tự group lỗi', 'error');
    loadGroups().catch((loadErr) => toast(loadErr.message, 'error'));
  });
}

async function moveRowsToGroupByKeys(keys, group) {
  const items = itemsByKeys(keys);
  if (!items.length) return;
  const nextGroup = group || null;
  applyOptimisticMoveItems(items, nextGroup);
  if (nextGroup && !state.groups.includes(nextGroup)) {
    state.groups.push(nextGroup);
    renderGroups();
    renderModalGroups();
  }
  invalidateItemCaches();
  toast(`Đã chuyển ${items.length} kênh`, 'success');
  Promise.resolve()
    .then(async () => {
      await api.moveItems(items.map((item) => item.id), nextGroup, targetUserId() || null);
      if (nextGroup) await saveGroups();
      loadItemsInBackground({ preserveScroll: true });
    })
    .catch((err) => {
      toast(err.message || 'Chuyển group lỗi', 'error');
      loadItemsInBackground({ preserveScroll: true });
    });
}

async function clearGroup(groupId) {
  const group = groupId === ALL_GROUP_ID ? null : groupId;
  const label = group ? `group "${group}"` : 'toàn bộ list';
  if (!confirm(`Xóa ${label}?`)) return;
  const activeScope = groupId === state.activeGroup || (!group && state.activeGroup === ALL_GROUP_ID);
  if (activeScope) {
    applyOptimisticRemoveItemsByIds(getLoadedVirtualItems().map(itemKey));
  } else if (group) {
    const summaryGroup = state.itemSummary?.groups?.find((entry) => entry.name === group);
    if (summaryGroup) summaryGroup.count = 0;
    renderGroups();
  }
  state.selected.clear();
  invalidateItemCaches();
  toast(`Đã xoá ${label}`, 'success');
  Promise.resolve()
    .then(async () => {
      await api.clearItems(group, targetUserId() || null);
      loadItemsInBackground({ preserveScroll: true });
    })
    .catch((err) => {
      toast(err.message || 'Xoá group lỗi', 'error');
      loadItemsInBackground({ preserveScroll: true });
    });
}

function switchView(view) {
  state.view = view;
  setSidebarActive(view);
  ['links', 'users'].forEach((name) => {
    qs(`${name}-view`)?.classList.toggle('hidden', view !== name);
  });
  qs('group-panel').classList.toggle('md:flex', view === 'links');
  qs('group-panel').classList.toggle('hidden', view !== 'links');
  if (view === 'users') renderUsers();
}

async function loadSettings() {
  qs('settings-api-keys').disabled = !canManageApiKeys();
  qs('settings-save-api').disabled = !canManageApiKeys();
  qs('settings-check-api').disabled = !canManageApiKeys();
  if (canManageApiKeys()) {
    const data = await api.apiKeys();
    qs('settings-api-keys').value = data.api_keys || '';
  } else {
    qs('settings-api-keys').value = 'Chỉ admin được quản lý API key hệ thống.';
  }
}
async function openSettingsModal() {
  if (window.parent !== window) {
    window.parent.document.getElementById('nav-settings')?.click();
    return;
  }
  if (state.view !== 'links') switchView('links');
  setSidebarActive('settings');
  setApiStatus();
  qs('api-settings-modal').classList.add('open');
  await loadSettings();
}
function closeSettingsModal() {
  qs('api-settings-modal').classList.remove('open');
  setSidebarActive(state.view);
}
function setApiStatus(message = '', type = '') {
  const el = qs('settings-api-status');
  if (!el) return;
  el.className = 'api-settings-status' + (type ? ` is-${type}` : ' is-empty');
  el.textContent = message;
}
async function saveApiKeys() {
  const data = await api.saveApiKeys(qs('settings-api-keys').value);
  qs('settings-api-keys').value = data.api_keys || '';
  setApiStatus('Đã lưu API keys', 'saved');
}
async function checkApiKeys() {
  setApiStatus('Đang kiểm tra...', 'checking');
  const data = await api.checkApiKeys();
  const ok = (data.results || []).filter((r) => r.ok).length;
  const fail = (data.results || []).length - ok;
  setApiStatus(`${ok} key OK · ${fail} lỗi`, fail ? 'error' : 'success');
  return;
  qs('settings-api-status').textContent = `${ok} ok, ${fail} lỗi`;
}
async function changePassword() {
  const current = qs('settings-current-pw').value;
  const next = qs('settings-new-pw').value;
  const confirmPw = qs('settings-confirm-pw').value;
  if (next !== confirmPw) return qs('settings-pw-status').textContent = 'Confirm password không khớp';
  await api.changePassword(current, next);
  qs('settings-pw-status').textContent = 'Changed';
  qs('settings-current-pw').value = qs('settings-new-pw').value = qs('settings-confirm-pw').value = '';
}

function managerOptions(selectedId = '') {
  const managers = state.users.filter((u) => u.role === 'manager');
  return '<option value="">No manager</option>' + managers.map((u) => `<option value="${escapeHtml(u.id)}" ${u.id === selectedId ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('');
}
function roleOptions(selected = 'user') {
  const roles = state.user?.role === 'manager' ? ['user'] : ['user', 'manager', 'admin'];
  return roles.map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${roleLabel(role)}</option>`).join('');
}
function userInitials(user) {
  const source = String(user?.username || 'U').trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase();
}
function userRoleIcon(role) {
  if (role === 'admin') return 'admin_panel_settings';
  if (role === 'manager') return 'manage_accounts';
  return 'person';
}
function userRoleClass(role) {
  return role === 'admin' ? 'is-admin' : role === 'manager' ? 'is-manager' : 'is-user';
}
function userFilterManagers() {
  if (state.user?.role === 'manager') return [state.user].filter(Boolean);
  return (state.users || []).filter((u) => u.role === 'manager');
}
function activeUserManagerFilterIds() {
  if (state.user?.role === 'manager') return state.user?.id ? [state.user.id] : [];
  return Array.isArray(state.userManagerFilterIds) ? state.userManagerFilterIds : [];
}
function usersForCurrentFilter() {
  const managerIds = activeUserManagerFilterIds();
  if (!managerIds.length) return state.users || [];
  return (state.users || []).filter((u) => managerIds.includes(u.id) || managerIds.includes(u.manager_id));
}
function renderUserManagerFilter() {
  const wrap = qs('user-manager-filter');
  if (!wrap) return;
  const managers = userFilterManagers();
  const locked = state.user?.role === 'manager';
  const activeIds = activeUserManagerFilterIds();
  const activeManagers = managers.filter((u) => activeIds.includes(u.id));
  if (!canManageUsers()) {
    wrap.innerHTML = '';
    return;
  }
  if (locked && activeManagers[0]) {
    wrap.innerHTML = `<div class="user-manager-picker is-locked">
      <button type="button" class="user-manager-trigger" disabled>
        <span class="user-manager-trigger-body">
          <span class="user-manager-chip">${escapeHtml(activeManagers[0].username)}</span>
        </span>
        <span class="material-symbols-outlined">lock</span>
      </button>
    </div>`;
    return;
  }
  const chips = activeManagers.map((manager) => `<span class="user-manager-chip">
    <span class="user-manager-chip-label">${escapeHtml(manager.username)}</span>
    <span class="material-symbols-outlined user-manager-chip-remove" data-user-manager-remove="${escapeHtml(manager.id)}" role="button" tabindex="0">close</span>
  </span>`).join('');
  const options = managers.map((manager) => `<button type="button" class="user-manager-option ${activeIds.includes(manager.id) ? 'is-selected' : ''}" data-user-manager-filter="${escapeHtml(manager.id)}">
      <span class="user-manager-checkbox"><span class="material-symbols-outlined">check</span></span>
      <span class="user-manager-option-avatar ${userRoleClass(manager.role)}">${escapeHtml(userInitials(manager))}</span>
      <span><b>${escapeHtml(manager.username)}</b></span>
    </button>`).join('');
  wrap.innerHTML = `<div class="user-manager-picker" data-user-manager-picker>
    <button type="button" class="user-manager-trigger" data-user-manager-trigger aria-expanded="false">
      <span class="user-manager-trigger-body">
        ${chips || '<span class="user-manager-placeholder">Filter managers</span>'}
      </span>
      <span class="material-symbols-outlined">expand_more</span>
    </button>
    <div class="user-manager-panel" data-user-manager-panel hidden>
      <div class="user-manager-search-wrap">
        <span class="material-symbols-outlined user-manager-search-icon">search</span>
        <input id="user-manager-filter-search" class="user-manager-search" placeholder="Search manager..." autocomplete="off">
      </div>
      <div class="user-manager-options">${options}</div>
    </div>
  </div>`;
}
function openUserManagerFilter(searchText = '') {
  const picker = qs('user-manager-filter')?.querySelector('[data-user-manager-picker]');
  if (!picker) return;
  const panel = picker.querySelector('[data-user-manager-panel]');
  const trigger = picker.querySelector('[data-user-manager-trigger]');
  if (panel) panel.hidden = false;
  picker.classList.add('is-open');
  trigger?.setAttribute('aria-expanded', 'true');
  const search = picker.querySelector('.user-manager-search');
  if (search) {
    search.value = searchText || '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.focus();
  }
}
function renderUsers() {
  const list = qs('admin-users-list');
  renderUserManagerFilter();
  const users = usersForCurrentFilter();
  list.innerHTML = users.map((u) => {
    const role = roleLabel(u.role);
    const managerLine = u.manager_name ? `manager &middot; ${escapeHtml(u.manager_name)}` : (u.role === 'user' ? 'manager &middot; -' : '');
    const selfMark = state.user?.id === u.id ? '<span class="user-self-badge">you</span>' : '';
    return `<div class="user-card">
      <div class="user-card-main">
        <div class="user-avatar ${userRoleClass(u.role)}">${escapeHtml(userInitials(u))}</div>
        <div class="user-card-text">
          <div class="user-title-line">
            <p class="user-name">${escapeHtml(u.username)}</p>
            <span class="user-role-badge ${userRoleClass(u.role)}">
              <span class="material-symbols-outlined">${userRoleIcon(u.role)}</span>${role}
            </span>
            <span class="user-active-badge">Active</span>
            ${selfMark}
          </div>
          ${managerLine ? `<p class="user-manager-line">${managerLine}</p>` : ''}
        </div>
      </div>
      <div class="user-card-actions">
        <button class="user-action-btn" data-edit-user="${escapeHtml(u.id)}">
          <span class="material-symbols-outlined">edit</span>Edit
        </button>
        <button class="user-action-btn" data-reset-user="${escapeHtml(u.id)}">
          <span class="material-symbols-outlined">lock_reset</span>Reset PW
        </button>
        <button class="user-action-btn is-danger" data-delete-user="${escapeHtml(u.id)}">
          <span class="material-symbols-outlined">delete</span>Delete
        </button>
      </div>
    </div>`;
  }).join('') || '<div class="user-empty-state">No users in this manager scope.</div>';
}
function openUserModal(user = null, resetOnly = false) {
  qs('user-modal-id').value = user?.id || '';
  qs('user-modal-title').textContent = user ? (resetOnly ? 'Reset Password' : 'Edit User') : 'Create User';
  qs('user-modal-username').value = user?.username || '';
  qs('user-modal-role').innerHTML = roleOptions(user?.role || 'user');
  qs('user-modal-manager').innerHTML = managerOptions(user?.manager_id || '');
  renderSearchSelects(['user-modal-role', 'user-modal-manager']);
  qs('user-modal-password').value = '';
  qs('user-modal-password').placeholder = user ? 'New password (optional)' : 'At least 4 characters';
  qs('user-modal').classList.add('open');
}
function closeUserModal() { qs('user-modal').classList.remove('open'); }
async function saveUserModal() {
  const id = qs('user-modal-id').value;
  const body = {
    username: qs('user-modal-username').value.trim(),
    role: qs('user-modal-role').value || 'user',
    manager_id: qs('user-modal-manager').value || null,
  };
  const password = qs('user-modal-password').value;
  if (id) {
    await api.updateUser(id, body);
    if (password) await api.resetPassword(id, password);
  } else {
    await api.createUser({ ...body, password });
  }
  closeUserModal();
  await loadUsers();
  renderUsers();
  renderOwnerSelectors();
}

function bindEvents() {
  ensureSortHeaders();
  qs('btn-logout').onclick = logout;
  qs('btn-add-link').onclick = openAddModal;
  qs('btn-refresh').onclick = () => (async () => {
    const selected = selectedItems();
    if (selected.length) {
      await refreshItems(selected);
    } else {
      await refreshScope(getBackendListParams(), groupLabel(state.activeGroup));
    }
  })().catch((err) => toast(err.message, 'error'));
  qs('btn-new-group').onclick = createGroup;
  qs('modal-submit').onclick = () => submitAddChannels().catch((err) => toast(err.message, 'error'));
  qs('btn-clear-list').onclick = () => clearCurrentList().catch((err) => toast(err.message, 'error'));
  document.querySelectorAll('[data-selection-action]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      handleSelectionAction(el.dataset.selectionAction).catch((err) => toast(err.message, 'error'));
    });
  });
  qs('settings-save-api').onclick = () => saveApiKeys().catch((err) => qs('settings-api-status').textContent = err.message);
  qs('settings-check-api').onclick = () => checkApiKeys().catch((err) => qs('settings-api-status').textContent = err.message);
  qs('nav-settings').onclick = (e) => {
    e.preventDefault();
    openSettingsModal().catch((err) => toast(err.message, 'error'));
  };
  qs('admin-users-create-btn').onclick = () => openUserModal();
  qs('user-modal-save').onclick = () => saveUserModal().catch((err) => qs('user-modal-status').textContent = err.message);
  qs('user-manager-filter')?.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-user-manager-trigger]');
    const option = e.target.closest('[data-user-manager-filter]');
    const remove = e.target.closest('[data-user-manager-remove]');
    const picker = e.target.closest('[data-user-manager-picker]');
    if (remove) {
      e.stopPropagation();
      const searchText = qs('user-manager-filter-search')?.value || '';
      const id = remove.dataset.userManagerRemove;
      state.userManagerFilterIds = (state.userManagerFilterIds || []).filter((value) => value !== id);
      renderUsers();
      openUserManagerFilter(searchText);
      return;
    }
    if (trigger && picker) {
      const panel = picker.querySelector('[data-user-manager-panel]');
      const nextOpen = panel?.hidden;
      if (panel) panel.hidden = !nextOpen;
      picker.classList.toggle('is-open', !!nextOpen);
      trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      if (nextOpen) picker.querySelector('.user-manager-search')?.focus();
      return;
    }
    if (option) {
      const searchText = qs('user-manager-filter-search')?.value || '';
      const id = option.dataset.userManagerFilter || '';
      const selected = new Set(state.userManagerFilterIds || []);
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      state.userManagerFilterIds = Array.from(selected).filter(Boolean);
      renderUsers();
      openUserManagerFilter(searchText);
    }
  });
  qs('user-manager-filter')?.addEventListener('input', (e) => {
    if (!e.target.classList.contains('user-manager-search')) return;
    const text = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#user-manager-filter .user-manager-option').forEach((option) => {
      option.classList.toggle('is-hidden', !!text && !option.textContent.toLowerCase().includes(text));
    });
  });

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-search-select-trigger]');
    const option = e.target.closest('[data-search-select-option]');
    const dropdown = e.target.closest('[data-search-select]');
    if (!trigger && !option && !dropdown) {
      document.querySelectorAll('.select-search-dropdown.is-open').forEach((el) => {
        el.classList.remove('is-open');
        el.querySelector('[data-search-select-menu]')?.setAttribute('hidden', '');
        el.querySelector('[data-search-select-trigger]')?.setAttribute('aria-expanded', 'false');
      });
      return;
    }
    if (trigger && dropdown) {
      const menu = dropdown.querySelector('[data-search-select-menu]');
      const nextOpen = menu?.hidden;
      document.querySelectorAll('.select-search-dropdown.is-open').forEach((el) => {
        if (el === dropdown) return;
        el.classList.remove('is-open');
        el.querySelector('[data-search-select-menu]')?.setAttribute('hidden', '');
        el.querySelector('[data-search-select-trigger]')?.setAttribute('aria-expanded', 'false');
      });
      if (menu) menu.hidden = !nextOpen;
      dropdown.classList.toggle('is-open', !!nextOpen);
      trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      if (nextOpen) dropdown.querySelector('[data-search-select-input]')?.focus();
      return;
    }
    if (option && dropdown) {
      const select = qs(dropdown.dataset.searchSelect);
      if (!select) return;
      select.value = option.dataset.searchSelectOption || '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      renderSearchSelect(dropdown.dataset.searchSelect);
    }
  });

  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-search-select-input]')) return;
    const dropdown = e.target.closest('[data-search-select]');
    const text = e.target.value.trim().toLowerCase();
    dropdown?.querySelectorAll('.select-search-option').forEach((option) => {
      option.classList.toggle('is-hidden', !!text && !option.textContent.toLowerCase().includes(text));
    });
  });

  document.querySelectorAll('[data-close-modal]').forEach((el) => el.addEventListener('click', closeAddModal));
  document.querySelectorAll('[data-close-api-settings-modal]').forEach((el) => el.addEventListener('click', closeSettingsModal));
  document.querySelectorAll('[data-close-user-modal]').forEach((el) => el.addEventListener('click', closeUserModal));
  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(el.dataset.view);
  }));
  document.querySelector('.list-columns-head')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-sort-key]');
    if (!button) return;
    setSort(button.dataset.sortKey);
  });
  qs('search-input').oninput = (e) => {
    state.search = e.target.value;
    clearTimeout(state.searchTimer);
    showInstantListOrPending(getBackendListParams(), { keepCurrentOnMiss: true });
    state.searchTimer = setTimeout(() => {
      loadItemsInBackground();
    }, 220);
  };
  qs('group-search').oninput = (e) => { state.groupSearch = e.target.value; renderGroups(); };
  qs('manager-filter-wrap')?.addEventListener('click', async (e) => {
    const trigger = e.target.closest('[data-owner-filter-trigger]');
    const option = e.target.closest('[data-owner-filter-option]');
    const dropdown = e.target.closest('[data-owner-filter]');
    if (trigger && dropdown) {
      const menu = dropdown.querySelector('[data-owner-filter-menu]');
      const nextOpen = menu?.hidden;
      if (menu) menu.hidden = !nextOpen;
      dropdown.classList.toggle('is-open', !!nextOpen);
      trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      if (nextOpen) dropdown.querySelector('[data-owner-filter-search]')?.focus();
      return;
    }
    if (option) {
      state.adminFilterUserId = option.dataset.ownerFilterOption || '';
      setActiveGroup(ALL_GROUP_ID);
      state.groups = [];
      state.itemSummary = null;
      clearAllSelections();
      renderOwnerSelectors();
      showInstantListOrPending(getBackendListParams(), { total: 0, totalLabel: '...', placeholderRows: 10 });
      Promise.all([loadGroups(), loadItems()]).catch((err) => toast(err.message, 'error'));
    }
  });
  qs('manager-filter-wrap')?.addEventListener('input', (e) => {
    if (!e.target.matches('[data-owner-filter-search]')) return;
    const text = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#manager-filter-wrap .owner-filter-option').forEach((option) => {
      option.classList.toggle('is-hidden', !!text && !option.textContent.toLowerCase().includes(text));
    });
  });

  qs('group-list').addEventListener('dblclick', (e) => {
    if (e.target.closest('input, textarea, [data-delete-group], [data-inline-group-save], [data-inline-group-cancel]')) return;
    clearTimeout(groupClickTimer);
    const row = e.target.closest('[data-group-row]');
    if (row && row.dataset.groupRow !== ALL_GROUP_ID) renameGroup(row.dataset.groupRow);
  });
  qs('group-list').addEventListener('click', async (e) => {
    const inlineSave = e.target.closest('[data-inline-group-save]');
    const inlineCancel = e.target.closest('[data-inline-group-cancel]');
    const rename = e.target.closest('[data-rename-group]');
    const del = e.target.closest('[data-delete-group]');
    const group = e.target.closest('[data-group]');
    if (inlineSave) return commitInlineGroupEdit().catch((err) => toast(err.message, 'error'));
    if (inlineCancel) return cancelInlineGroupEdit();
    if (rename) return renameGroup(rename.dataset.renameGroup);
    if (del) return deleteGroup(del.dataset.deleteGroup).catch((err) => toast(err.message, 'error'));
    if (group) {
      if (e.detail > 1) return;
      clearTimeout(groupClickTimer);
      const name = group.dataset.group;
      groupClickTimer = setTimeout(() => {
        if (clearSelection()) renderRows({ preserveScroll: true });
        setActiveGroup(name);
        showInstantListOrPending(getBackendListParams());
        loadItemsInBackground();
      }, 250);
      return;
    }
    if (clearSelection()) {
      renderGroups();
      renderRows({ preserveScroll: true });
    }
  });

  qs('group-list').addEventListener('input', (e) => {
    if (!e.target.matches('[data-inline-group-input]') || !state.inlineGroupEdit) return;
    state.inlineGroupEdit.value = e.target.value;
  });

  qs('group-list').addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-inline-group-input]')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineGroupEdit().catch((err) => toast(err.message, 'error'));
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineGroupEdit();
    }
  });

  qs('group-list').addEventListener('contextmenu', (e) => {
    const group = e.target.closest('[data-group]');
    e.preventDefault();
    e.stopPropagation();
    if (!group) {
      showGroupPanelContextMenu(e);
      return;
    }
    showGroupContextMenu(e, group.dataset.group);
  });

  qs('group-list').addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-group-row]');
    if (!row) return;
    state.draggingGroupId = row.dataset.groupRow;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggingGroupId);
    requestAnimationFrame(renderGroups);
  });

  qs('group-list').addEventListener('dragover', (e) => {
    const rowTarget = e.target.closest('[data-group-row]');
    const groupTarget = e.target.closest('[data-group]');
    if (state.draggingRowKeys.length && groupTarget) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (state.dragOverGroupId !== groupTarget.dataset.group || state.dragOverGroupPlacement !== 'after') {
        state.dragOverGroupId = groupTarget.dataset.group;
        state.dragOverGroupPlacement = 'after';
        renderGroups();
      }
      return;
    }
    if (!state.draggingGroupId) return;
    autoScrollGroupsWhileDragging(e);
    if (!rowTarget) {
      if (updateBlankGroupDrop(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
      return;
    }
    const target = rowTarget.dataset.groupRow;
    if (!target) return;
    if (target === state.draggingGroupId) {
      if (state.dragOverGroupId) {
        state.dragOverGroupId = null;
        renderGroups();
      }
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const placement = dragPlacement(e, rowTarget);
    if (state.dragOverGroupId !== target || state.dragOverGroupPlacement !== placement) {
      state.dragOverGroupId = target;
      state.dragOverGroupPlacement = placement;
      renderGroups();
    }
  });

  qs('group-list').addEventListener('drop', async (e) => {
    const rowTarget = e.target.closest('[data-group-row]');
    const groupTarget = e.target.closest('[data-group]');
    e.preventDefault();
    try {
      if (state.draggingRowKeys.length && groupTarget) {
        await moveRowsToGroupByKeys(state.draggingRowKeys, groupTarget.dataset.group === ALL_GROUP_ID ? '' : groupTarget.dataset.group);
      } else if (state.draggingGroupId && rowTarget) {
        await reorderGroups(state.draggingGroupId, rowTarget.dataset.groupRow, state.dragOverGroupPlacement);
      } else if (state.draggingGroupId && state.dragOverGroupId) {
        await reorderGroups(state.draggingGroupId, state.dragOverGroupId, state.dragOverGroupPlacement);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      clearDragState();
      renderGroups();
      renderRows();
    }
  });

  qs('group-list').addEventListener('dragend', () => {
    clearDragState();
    renderGroups();
    renderRows();
  });

  qs('link-list').addEventListener('click', (e) => {
    const checkbox = e.target.closest('[data-select-id]');
    const row = e.target.closest('[data-row-id]');
    if (!checkbox && !row) return;
    const id = checkbox ? checkbox.dataset.selectId : row.dataset.rowId;
    if (e.shiftKey && state.lastSelectedRowKey && selectRowRange(id)) {
      renderRows();
      return;
    }
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    state.lastSelectedRowKey = id;
    renderRows();
  });

  qs('link-list').addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-row-id]');
    if (!row) return;
    const rowId = row.dataset.rowId;
    if (!state.selected.has(rowId)) state.selected = new Set([rowId]);
    state.draggingRowKeys = [...state.selected];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggingRowKeys.join(','));
    requestAnimationFrame(() => {
      renderRows();
      renderGroups();
    });
  });

  qs('link-list').addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-row-id]');
    if (!row || !state.draggingRowKeys.length) return;
    autoScrollLinksWhileDragging(e);
    const target = row.dataset.rowId;
    if (state.draggingRowKeys.includes(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const placement = dragPlacement(e, row);
    if (state.dragOverRowKey !== target || state.dragOverRowPlacement !== placement) {
      state.dragOverRowKey = target;
      state.dragOverRowPlacement = placement;
      renderRows();
    }
  });

  qs('link-list').addEventListener('drop', async (e) => {
    const row = e.target.closest('[data-row-id]');
    if (!row || !state.draggingRowKeys.length) return;
    e.preventDefault();
    const dragKeys = [...state.draggingRowKeys];
    const targetKey = row.dataset.rowId;
    const placement = state.dragOverRowPlacement;
    clearDragState();
    try {
      await reorderRows(dragKeys, targetKey, placement);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      clearDragState();
      renderRows();
      renderGroups();
    }
  });

  qs('link-list').addEventListener('dragend', () => {
    clearDragState();
    renderRows();
    renderGroups();
  });

  qs('link-list').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-row-id]');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    showRowContextMenu(e, row.dataset.rowId);
  });

  qs('links-view').addEventListener('contextmenu', (e) => {
    if (state.view !== 'links') return;
    if (e.target.closest('[data-row-id], button, input, textarea, select, a, #context-menu, .modal-overlay.open')) return;
    e.preventDefault();
    showWorkspaceContextMenu(e);
  });

  qs('links-view').addEventListener('scroll', () => {
    if (state.view !== 'links' || !state.listTotal || state.virtualRenderFrame) return;
    state.virtualRenderFrame = requestAnimationFrame(() => {
      state.virtualRenderFrame = null;
      renderRows({ preserveScroll: true });
    });
  }, { passive: true });

  qs('links-view').addEventListener('dragover', (e) => {
    if (!updateBlankRowDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  qs('links-view').addEventListener('drop', async (e) => {
    if (!state.draggingRowKeys.length || e.target.closest('[data-row-id]')) return;
    e.preventDefault();
    const dragKeys = [...state.draggingRowKeys];
    try {
      updateBlankRowDrop(e);
      const targetKey = state.dragOverRowKey;
      const placement = state.dragOverRowPlacement;
      clearDragState();
      await reorderRows(dragKeys, targetKey, placement);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      clearDragState();
      renderRows();
      renderGroups();
    }
  });

  qs('context-menu')?.addEventListener('click', async (e) => {
    const move = e.target.closest('[data-context-move-group]');
    const actionButton = e.target.closest('[data-context-action]');
    if (!move && !actionButton) return;
    const action = move ? 'move' : actionButton.dataset.contextAction;
    const group = move ? move.dataset.contextMoveGroup : null;
    closeContextMenu();
    try {
      await handleContextAction(action, group);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  qs('admin-users-list').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit-user]');
    const reset = e.target.closest('[data-reset-user]');
    const del = e.target.closest('[data-delete-user]');
    const id = edit?.dataset.editUser || reset?.dataset.resetUser || del?.dataset.deleteUser;
    if (!id) return;
    const user = state.users.find((u) => u.id === id);
    if (edit) return openUserModal(user);
    if (reset) return openUserModal(user, true);
    if (del && confirm(`Delete user ${user?.username || id}?`)) {
      await api.deleteUser(id);
      await loadUsers();
      renderUsers();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) closeContextMenu();
    if (shouldClearSelectionFromClick(e) && clearAllSelections()) {
      renderGroups();
      renderRows({ preserveScroll: true });
    }
    const ownerDropdown = qs('manager-filter-wrap')?.querySelector('[data-owner-filter]');
    if (ownerDropdown && !ownerDropdown.contains(e.target)) {
      ownerDropdown.querySelector('[data-owner-filter-menu]')?.setAttribute('hidden', '');
      ownerDropdown.classList.remove('is-open');
      ownerDropdown.querySelector('[data-owner-filter-trigger]')?.setAttribute('aria-expanded', 'false');
    }
    const picker = qs('user-manager-filter')?.querySelector('[data-user-manager-picker]');
    if (!picker || picker.contains(e.target)) return;
    const panel = picker.querySelector('[data-user-manager-panel]');
    if (panel) panel.hidden = true;
    picker.classList.remove('is-open');
    picker.querySelector('[data-user-manager-trigger]')?.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      if (!isTypingTarget(e.target) && clearAllSelections()) {
        renderGroups();
        renderRows({ preserveScroll: true });
      }
      return;
    }
    if (isTypingTarget(e.target) || document.querySelector('.modal-overlay.open')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && state.view === 'links') {
      e.preventDefault();
      selectAllRows();
      renderRows({ preserveScroll: true });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.view === 'links') {
      if (state.selected.size) {
        e.preventDefault();
        deleteSelected().catch((err) => toast(err.message, 'error'));
      }
    }
  });
}

async function init() {
  if (!requireAuth()) return;
  bindEvents();
  const hadStoredUser = !!state.user;
  if (hadStoredUser) {
    setupUserShell();
  } else {
    await refreshCurrentUser();
  }
  ensureDefaultOwnerFilter();
  renderOwnerSelectors();
  if (!hydrateListCache(getBackendListParams())) {
    showListPending(getBackendListParams(), { total: 0, totalLabel: '...', placeholderRows: 10 });
  }
  api.health()
    .then(() => { state.apiOnline = true; updateApiStatus(); })
    .catch(() => { state.apiOnline = false; updateApiStatus(); });
  if (hadStoredUser) {
    await refreshCurrentUser();
    ensureDefaultOwnerFilter();
    renderOwnerSelectors();
  }
  await Promise.all([
    loadUsers().then(renderOwnerSelectors),
    loadPreferences(),
    loadGroups(),
    loadItems(),
  ]);
}

init().catch((err) => {
  console.error(err);
  toast(err.message || 'Startup error', 'error');
});

window.refreshAllItems = () => refreshScope(paramsForGroup(ALL_GROUP_ID), 'kênh');

