/**
 * SpotiCheck â€” Frontend Application
 * Káº¿t ná»‘i API backend, render dynamic rows, quáº£n lÃ½ state
 */

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONFIG
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CONFIG = {
    API_BASE: window.location.hostname === 'localhost'
        ? 'http://localhost:8010/api'
        : '/api',
    POLL_INTERVAL: 1200,      // Faster polling for near-real-time row updates
    POPUP_WIDTH: 480,
    POPUP_HEIGHT: 720,
    SEARCH_DEBOUNCE: 300,
    DRAG_SCROLL_EDGE: 72,
    DRAG_SCROLL_MAX_SPEED: 22,
    BACKGROUND_SYNC_INTERVAL: 12000,
    LIST_INITIAL_RENDER_COUNT: 80,
    LIST_RENDER_BATCH_SIZE: 80,
    LIST_PAGE_SIZE: 120,
    LIST_SCOPE_CACHE_LIMIT: 18,
    SMALL_GROUP_PREFETCH_MAX_COUNT: 80,
    SMALL_GROUP_PREFETCH_LIMIT: 6,
    SMALL_GROUP_PREFETCH_DELAY: 250,
    BACKGROUND_PAGE_WARM_DELAY: 120,
    BACKGROUND_PAGE_WARM_PAUSE: 35,
    VIRTUAL_PREFETCH_PAGES: 1,
    VIRTUAL_ROW_HEIGHT: 104,
    VIRTUAL_OVERSCAN_ROWS: 8,
};
const GROUP_STORAGE_KEY = 'spoticheck_custom_groups_v1';
const ROW_ORDER_STORAGE_KEY = 'spoticheck_row_order_v1';
const COLUMN_WIDTH_STORAGE_KEY = 'spoticheck_column_widths_v5';
const ALL_GROUP_ID = 'all';
const ALL_GROUP_LABEL = 'All Links';
const RECOVERY_GROUP_LABEL = 'Ungrouped';
const GROUP_SELECT_ALL = '__all__';
const DEFAULT_COLUMN_WIDTHS = Object.freeze({
    stt: 52,
    asset: 420,
    owner: 160,
    playlistOwner: 160,
    playlistSaves: 92,
    playlistCount: 92,
    albumCount: 88,
    artistFollowers: 92,
    artistListeners: 104,
    trackViews: 100,
    checked: 84,
});
const MIN_COLUMN_WIDTHS = Object.freeze({
    stt: 32,
    asset: 320,
    owner: 132,
    playlistOwner: 132,
    playlistSaves: 84,
    playlistCount: 84,
    albumCount: 80,
    artistFollowers: 84,
    artistListeners: 88,
    trackViews: 88,
    checked: 72,
});
const MAX_COLUMN_WIDTHS = Object.freeze({
    stt: 160,
    asset: 900,
    owner: 360,
    playlistOwner: 360,
    playlistSaves: 240,
    playlistCount: 240,
    albumCount: 240,
    artistFollowers: 240,
    artistListeners: 260,
    trackViews: 260,
    checked: 140,
});
const COLUMN_WIDTH_VAR_MAP = Object.freeze({
    stt: '--stt-col',
    asset: '--asset-col',
    owner: '--owner-col',
    playlistOwner: '--playlist-owner-col',
    playlistSaves: '--playlist-save-col',
    playlistCount: '--playlist-count-col',
    albumCount: '--album-count-col',
    artistFollowers: '--artist-followers-col',
    artistListeners: '--artist-listeners-col',
    trackViews: '--track-views-col',
    checked: '--checked-col',
});
const RESIZABLE_COLUMN_KEYS = Object.freeze([
    'stt',
    'asset',
    'owner',
    'playlistOwner',
    'playlistSaves',
    'playlistCount',
    'albumCount',
    'artistFollowers',
    'artistListeners',
    'trackViews',
    'checked',
]);
const METRIC_SORT_CONFIG = Object.freeze({
    playlistSaves: { valueKey: 'playlistSaves', deltaKey: 'playlistSavesDelta', shortLabel: 'SL' },
    playlistCount: { valueKey: 'playlistTrackCount', deltaKey: 'playlistTrackCountDelta', shortLabel: 'SL' },
    albumCount: { valueKey: 'albumTrackCount', deltaKey: 'albumTrackCountDelta', shortLabel: 'SL' },
    artistFollowers: { valueKey: 'artistFollowers', deltaKey: 'artistFollowersDelta', shortLabel: 'SL' },
    artistListeners: { valueKey: 'artistListeners', deltaKey: 'artistListenersDelta', shortLabel: 'SL' },
    trackViews: { valueKey: 'trackViews', deltaKey: 'trackViewsDelta', shortLabel: 'SL' },
});
const CHECKED_SORT_MODES = Object.freeze({
    NONE: 'none',
    ERROR_FIRST: 'error-first',
    CRAWLING_FIRST: 'crawling-first',
    ACTIVE_FIRST: 'active-first',
    RECENT_FIRST: 'recent-first',
    OLDEST_FIRST: 'oldest-first',
});
const UI_PREF_SAVE_DEBOUNCE_MS = 700;
const DEFAULT_PLAYLIST_CLIPBOARD_LINE_LIMIT = 100;
const MIN_PLAYLIST_CLIPBOARD_LINE_LIMIT = 1;
const MAX_PLAYLIST_CLIPBOARD_LINE_LIMIT = 2000;

function getUserGroupStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `spoticheck_custom_groups_v1_${userId}`;
}

function getUserRowOrderStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `${ROW_ORDER_STORAGE_KEY}_${userId}`;
}

function getUserColumnWidthStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `${COLUMN_WIDTH_STORAGE_KEY}_${userId}`;
}

// ===================================================================
// AUTH
// ===================================================================
function getAuthToken() {
    return localStorage.getItem('spoticheck_token');
}
function getAuthUser() {
    try { return JSON.parse(localStorage.getItem('spoticheck_user')); } catch(e) { return null; }
}

function canManageUsers(user = getAuthUser()) {
    return user?.role === 'admin' || user?.role === 'manager';
}

function getRoleLabel(role) {
    return { admin: 'Admin', manager: 'Manager', user: 'User' }[role] || 'User';
}

function getAssignableRoles() {
    return getAuthUser()?.role === 'admin'
        ? [{ value: 'user', label: 'User' }, { value: 'manager', label: 'Manager' }, { value: 'admin', label: 'Admin' }]
        : [{ value: 'user', label: 'User' }];
}

function setupManagerAssignment(prefix, selected = '') {
    const roleWrap = document.getElementById(`${prefix}-role-wrap`);
    if (!roleWrap) return;
    let field = document.getElementById(`${prefix}-manager-field`);
    if (!field) {
        field = document.createElement('div');
        field.id = `${prefix}-manager-field`;
        field.className = 'mt-4';
        const label = document.createElement('label');
        label.className = 'block text-[13px] font-semibold text-secondary-text mb-2';
        label.textContent = 'Manager';
        field.appendChild(label);
        roleWrap.parentElement.insertAdjacentElement('afterend', field);
    }
    const options = [{ value: '', label: 'Unassigned' }, ..._adminUsersCache
        .filter((user) => user.role === 'manager' && user.is_active)
        .map((user) => ({ value: user.id, label: user.display_name || user.username }))];
    const id = `${prefix}-manager`;
    if (document.getElementById(`${id}-dropdown`)) {
        updateCustomDropdownOptions(`${id}-dropdown`, options, selected || '');
    } else {
        field.appendChild(createCustomDropdown({ id, options, selected: selected || '' }));
    }
    updateManagerAssignmentVisibility(prefix);
}

function updateManagerAssignmentVisibility(prefix) {
    const role = document.getElementById(`${prefix}-role-dropdown`)?.getAttribute('data-value');
    const field = document.getElementById(`${prefix}-manager-field`);
    if (field) field.style.display = getAuthUser()?.role === 'admin' && role === 'user' ? '' : 'none';
}

function getManagerAssignment(prefix, role) {
    if (getAuthUser()?.role !== 'admin') return {};
    const selected = document.getElementById(`${prefix}-manager-dropdown`)?.getAttribute('data-value');
    return { manager_id: role === 'user' ? (selected || null) : null };
}
function logout() {
    localStorage.removeItem('spoticheck_token');
    localStorage.removeItem('spoticheck_user');
    window.location.href = '/login.html';
}
function requireAuth() {
    if (!getAuthToken()) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}
function setupAuthUI() {
    const user = getAuthUser();
    if (user) {
        const initials = (user.display_name || user.username || '??').slice(0, 2).toUpperCase();
        const profileWrap = document.querySelector('.sidebar-profile-wrap');
        if (profileWrap) {
            profileWrap.style.cursor = 'pointer';
            profileWrap.onclick = () => switchToView('account');
            profileWrap.title = 'Account Settings';
            const avatarHtml = user.avatar
                ? '<img src="' + user.avatar + '" class="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10">'
                : '<div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-700 text-white text-[11px] font-bold leading-none grid place-items-center overflow-hidden ring-1 ring-white/10">' + initials + '</div>';
            profileWrap.innerHTML = avatarHtml +
                '<div class="sidebar-user-info overflow-hidden">' +
                '<p class="text-sm font-semibold truncate">' + (user.display_name || user.username) + '</p>' +
                '<p class="text-xs text-secondary-text truncate">' + getRoleLabel(user.role) + '</p>' +
                '</div>';
        }
    }
    const sidebarProfile = document.querySelector('.sidebar-profile');
    if (sidebarProfile && !document.getElementById('btn-logout')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'btn-logout';
        logoutBtn.className = 'sidebar-tooltip-target w-full flex items-center gap-3 px-5 py-2 text-secondary-text hover:text-white transition-colors cursor-pointer';
        logoutBtn.dataset.tooltip = 'Sign Out';
        logoutBtn.innerHTML = '<span class="material-icons-round text-sm">logout</span><span class="sidebar-label text-sm">Sign Out</span>';
        logoutBtn.onclick = logout;
        sidebarProfile.appendChild(logoutBtn);
    }
    if (canManageUsers(user)) {
        const groupPanel = document.getElementById('group-panel');
        if (groupPanel && !document.getElementById('admin-badge')) {
            const badge = document.createElement('div');
            badge.id = 'admin-badge';
            badge.className = 'px-5 py-2 border-b border-white/5';
            badge.innerHTML = '<span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-primary"><span class="material-icons-round text-sm">admin_panel_settings</span>' + getRoleLabel(user.role) + ' Mode</span>';
            groupPanel.insertBefore(badge, groupPanel.firstChild);
        }
        // Add Users nav item for admin
        const nav = document.querySelector('#sidebar nav');
        if (nav && !document.getElementById('nav-users')) {
            const usersLink = document.createElement('a');
            usersLink.id = 'nav-users';
            usersLink.className = 'sidebar-tooltip-target flex items-center gap-4 px-3 py-3 rounded-lg text-secondary-text hover:text-white transition-colors group cursor-pointer';
            usersLink.dataset.tooltip = 'Users';
            usersLink.href = '#';
            usersLink.innerHTML = '<span class="material-icons-round">group</span><span class="font-medium sidebar-label">Users</span>';
            // Insert before Settings
            const settingsNav = document.getElementById('nav-settings');
            if (settingsNav) nav.insertBefore(usersLink, settingsNav);
        }
    }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const state = {
    items: [],
    filteredItems: [],
    groups: [],
    customGroups: [],
    groupSearchQuery: '',
    activeGroup: ALL_GROUP_ID,
    isCreatingGroup: false,
    renamingGroupId: null,
    searchQuery: '',
    pendingJobs: new Set(),
    pendingJobToItem: new Map(),
    batchRefresh: null,
    pollTimer: null,
    apiOnline: false,
    adminUserList: [],
    adminUsersCacheTs: 0,
    adminUsersPromise: null,
    itemSummary: null,
    listTotal: 0,
    virtualItems: [],
    loadedPageOffsets: new Set(),
    loadingPageOffsets: new Set(),
    loadingPagePromises: new Map(),
    listScopeCache: new Map(),
    groupPrefetchTimer: null,
    prefetchedGroupScopeKeys: new Set(),
    listWarmTimer: null,
    listWarmToken: 0,
    listScopeKey: '',
    currentListParams: {},
    selectedItemKeys: new Set(),
    selectionAnchorKey: null,
    selectedGroupIds: new Set(),
    groupSelectionAnchorId: null,
    selectionScope: 'items',
    draggingRowKeys: [],
    dragOverRowKey: null,
    dragOverRowPlacement: 'before',
    draggingGroupId: null,
    draggingGroupIds: [],
    dragOverGroupId: null,
    dragOverGroupPlacement: 'before',
    suppressNextGroupClick: false,
    suppressNextRowClick: false,
    dragScrollRaf: null,
    dragScrollContainer: null,
    dragScrollSpeed: 0,
    columnBudget: null,
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    globalPreferences: {
        playlistClipboardLineLimit: DEFAULT_PLAYLIST_CLIPBOARD_LINE_LIMIT,
    },
    uiPrefSaveTimer: null,
    remoteSyncTimer: null,
    remoteSyncInFlight: false,
    contextMenuVisible: false,
    contextMenuAnchorSelectionKey: null,
    itemClipboard: { keys: [], mode: null },
    exportInProgress: false,
    exportLabel: '',
    metricSortColumn: null,
    metricSortMode: 'value',
    metricSortDirection: 'desc',
    metricSortMenuOpenKey: null,
    textSortColumn: null,
    textSortDirection: 'asc',
    textSortMenuOpenKey: null,
    checkedSortMode: CHECKED_SORT_MODES.NONE,
    checkedSortMenuOpen: false,
    dataLoadRequestId: 0,
    listRenderToken: 0,
    lastGroupRenderSignature: '',
    lastListRenderSignature: '',
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// API CLIENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
class SpotiCheckAPI {
    constructor(baseUrl) {
        this.base = baseUrl;
    }

    async _fetchRaw(path, opts = {}) {
        try {
            const token = getAuthToken();
            const headers = { ...opts.headers };
            if (opts.body && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const res = await fetch(`${this.base}${path}`, {
                headers,
                ...opts,
            });
            if (res.status === 401) {
                logout();
                return;
            }
            if (!res.ok) {
                const errPayload = await res.clone().json().catch(() => null);
                const errDetail = errPayload?.detail
                    || errPayload?.message
                    || (await res.text().catch(() => ''))
                    || `HTTP ${res.status}`;
                throw new Error(errDetail);
            }
            return res;
        } catch (e) {
            if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
                state.apiOnline = false;
                updateApiStatus();
            }
            throw e;
        }
    }

    async _fetch(path, opts = {}) {
        const res = await this._fetchRaw(path, opts);
        if (!res) return;
        return res.json();
    }

    health()              { return this._fetch('/health'); }
    getItems(params = {}) {
        const qs = new URLSearchParams();
        if (params.type) qs.set('type', params.type);
        if (params.group) qs.set('group', params.group);
        if (params.status) qs.set('status', params.status);
        if (params.search) qs.set('search', params.search);
        if (params.sort) qs.set('sort', params.sort);
        if (params.sort_direction) qs.set('sort_direction', params.sort_direction);
        if (params.checked_sort) qs.set('checked_sort', params.checked_sort);
        if (params.user_id) qs.set('user_id', params.user_id);
        if (params.limit != null) qs.set('limit', String(params.limit));
        if (params.offset != null) qs.set('offset', String(params.offset));
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items${suffix}`);
    }
    getItemsSummary(params = {}) {
        const qs = new URLSearchParams();
        if (params.type) qs.set('type', params.type);
        if (params.group) qs.set('group', params.group);
        if (params.search) qs.set('search', params.search);
        if (params.user_id) qs.set('user_id', params.user_id);
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items/summary${suffix}`);
    }
    getItem(type, id, userId = null) {
        const qs = new URLSearchParams();
        if (userId) qs.set('user_id', String(userId));
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items/${type}/${id}${suffix}`);
    }
    getJobsBatch(jobIds = []) {
        return this._fetch('/jobs/batch', {
            method: 'POST',
            body: JSON.stringify({
                job_ids: Array.isArray(jobIds) ? jobIds : [],
            }),
        });
    }
    getJob(jobId)         { return this._fetch(`/jobs/${jobId}`); }
    deleteItemById(itemId) {
        return this._fetch(`/items-by-id/${itemId}`, { method: 'DELETE' });
    }
    deleteItem(type, id, userId = null) {
        const qs = new URLSearchParams();
        if (userId) qs.set('user_id', String(userId));
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items/${type}/${id}${suffix}`, { method: 'DELETE' });
    }
    clearItems(group = null, userId = null) {
        const qs = new URLSearchParams();
        if (group) qs.set('group', String(group));
        if (userId) qs.set('user_id', String(userId));
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items${suffix}`, { method: 'DELETE' });
    }
    getMyPreferences()    { return this._fetch('/auth/me/preferences'); }
    saveMyPreferences(preferences = {}) {
        return this._fetch('/auth/me/preferences', {
            method: 'PUT',
            body: JSON.stringify({ preferences }),
        });
    }
    saveAdminPreferences(preferences = {}) {
        return this._fetch('/auth/admin/preferences', {
            method: 'PUT',
            body: JSON.stringify(preferences),
        });
    }
    renameGroup(oldGroup, newGroup, userId = null) {
        const qs = new URLSearchParams();
        qs.set('old_group', String(oldGroup || ''));
        qs.set('new_group', String(newGroup || ''));
        if (userId) qs.set('user_id', String(userId));
        return this._fetch(`/items/group?${qs.toString()}`, { method: 'PATCH' });
    }
    moveItems(itemIds = [], group = null, userId = null) {
        return this._fetch('/items/move', {
            method: 'POST',
            body: JSON.stringify({
                item_ids: Array.isArray(itemIds) ? itemIds : [],
                group: group || null,
                user_id: userId || null,
            }),
        });
    }

    crawl(url, group = null, targetUserId = null, itemId = null) {
        return this._fetch('/crawl', {
            method: 'POST',
            body: JSON.stringify({ url, group, target_user_id: targetUserId || null, item_id: itemId || null }),
        });
    }

    crawlBatch(urls, group = null, targetUserId = null, itemIds = null) {
        return this._fetch('/crawl/batch', {
            method: 'POST',
            body: JSON.stringify({
                urls,
                group,
                target_user_id: targetUserId || null,
                item_ids: Array.isArray(itemIds) ? itemIds : null,
            }),
        });
    }

    exportRows(action, itemIds = [], deepFetch = false) {
        return this._fetch('/items/export', {
            method: 'POST',
            body: JSON.stringify({
                action,
                format: 'json',
                item_ids: Array.isArray(itemIds) ? itemIds : [],
                deep_fetch: Boolean(deepFetch),
            }),
        });
    }

    exportFile(action, format, itemIds = [], deepFetch = false) {
        return this._fetchRaw('/items/export', {
            method: 'POST',
            body: JSON.stringify({
                action,
                format,
                item_ids: Array.isArray(itemIds) ? itemIds : [],
                deep_fetch: Boolean(deepFetch),
            }),
        });
    }
}

const api = new SpotiCheckAPI(CONFIG.API_BASE);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITY HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/** Format large numbers with suffix (1.2k, 3.4M) */
function formatNumber(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toLocaleString();
}

/** Format full number with separators: 1000000 -> 1.000.000 */
function formatDetailedNumber(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('vi-VN');
}

function formatDetailedMetric(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('vi-VN');
}

function formatDurationFromMs(ms) {
    if (ms == null || isNaN(ms)) return null;
    const totalSeconds = Math.floor(Number(ms) / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function parseServerDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    let normalized = raw.replace(' ', 'T');
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
    if (!hasTimezone && /^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
        // Backend can return naive UTC timestamps; treat them as UTC.
        normalized += 'Z';
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Relative time from ISO timestamp */
function timeAgo(isoDate) {
    const d = parseServerDate(isoDate);
    if (!d) return '-';
    const diff = Date.now() - d.getTime();
    if (diff <= 0) return 'Just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatUpdatedAt(isoDate) {
    const d = parseServerDate(isoDate);
    if (!d) return '-';
    const parts = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('hour')}:${get('minute')} ${get('day')}/${get('month')}/${get('year')}`;
}

function formatCellValue(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '-';
    return formatDetailedMetric(value);
}

function formatDeltaDays(days) {
    if (days == null || Number.isNaN(Number(days))) return '--';
    return String(Math.max(0, Number(days))).padStart(2, '0');
}

function renderDeltaBadge(delta, days) {
    if (delta == null || Number.isNaN(Number(delta))) return '';

    const numeric = Number(delta);
    let icon = 'remove';
    let cls = 'metric-delta-flat';
    let text = '0';

    if (numeric > 0) {
        icon = 'north';
        cls = 'metric-delta-up';
        text = `+${formatDetailedMetric(numeric)}`;
    } else if (numeric < 0) {
        icon = 'south';
        cls = 'metric-delta-down';
        text = `-${formatDetailedMetric(Math.abs(numeric))}`;
    }

    return `
        <div class="metric-delta ${cls}">
            <span class="material-icons-round">${icon}</span>
            <span>${text}/${formatDeltaDays(days)}</span>
        </div>
    `;
}

function renderMetricCell(value, delta, days) {
    const hasValue = !(value == null || value === '' || Number.isNaN(Number(value)));
    return `
        <div class="metric-stack">
            <span class="metric-main ${hasValue ? '' : 'metric-empty'}">${hasValue ? formatCellValue(value) : '-'}</span>
            ${renderDeltaBadge(delta, days)}
        </div>
    `;
}

function getExcelColumnValues(item) {
    const type = item.type;
    return {
        playlistSaves: type === 'playlist' ? (item.saves ?? item.followers) : null,
        playlistSavesDelta: type === 'playlist' ? item.followers_delta : null,
        playlistTrackCount: type === 'playlist' ? item.track_count : null,
        playlistTrackCountDelta: type === 'playlist' ? item.track_count_delta : null,
        albumTrackCount: type === 'album' ? item.track_count : null,
        albumTrackCountDelta: type === 'album' ? item.track_count_delta : null,
        artistFollowers: type === 'artist' || type === 'track' || type === 'album' ? item.followers : null,
        artistFollowersDelta: type === 'artist' || type === 'track' || type === 'album' ? item.followers_delta : null,
        artistListeners: type === 'artist' || type === 'track' || type === 'album' ? item.monthly_listeners : null,
        artistListenersDelta: type === 'artist' || type === 'track' || type === 'album' ? item.monthly_listeners_delta : null,
        trackViews: type === 'track' ? item.playcount : null,
        trackViewsDelta: type === 'track' ? item.playcount_delta : null,
        deltaDays: item.delta_days,
    };
}

function getMetricSortValue(item, columnKey, mode = 'value') {
    const config = METRIC_SORT_CONFIG[columnKey];
    if (!config) return null;
    const excel = getExcelColumnValues(item);
    const valueKey = mode === 'delta' ? config.deltaKey : config.valueKey;
    const raw = excel[valueKey];
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
}

function getItemSubtitle(item) {
    if (item.type === 'album' && Array.isArray(item.export_tracks) && item.export_tracks.length > 0) {
        return `${item.export_tracks.length} tracks ready for export`;
    }
    if (item.type === 'track' && Array.isArray(item.artist_names) && item.artist_names.length > 1) {
        return `Primary artist metrics from ${item.artist_names[0]}`;
    }
    return null;
}

/** Parse Spotify URL to get type and id */
function parseSpotifyUrl(input) {
    input = input.trim();
    // Handle Spotify URI format: spotify:playlist:37i9dQZF1DX...
    const uriMatch = input.match(/^spotify:(playlist|track|album|artist):([a-zA-Z0-9]+)/);
    if (uriMatch) return { type: uriMatch[1], id: uriMatch[2] };
    // Handle URL format: https://open.spotify.com/playlist/37i9dQZF1DX...
    const urlMatch = input.match(/open\.spotify\.com\/(playlist|track|album|artist)\/([a-zA-Z0-9]+)/);
    if (urlMatch) return { type: urlMatch[1], id: urlMatch[2] };
    return null;
}

const SPOTIFY_TYPE_LABELS = Object.freeze({
    playlist: 'Playlist',
    track: 'Track',
    album: 'Album',
    artist: 'Artist',
});

function getSpotifyTypeLabel(type) {
    return SPOTIFY_TYPE_LABELS[String(type || '').trim().toLowerCase()] || 'Unknown';
}

function updateModalLinkPreview(rawInput = '') {
    const preview = document.getElementById('modal-link-preview');
    const count = document.getElementById('modal-link-preview-count');
    const list = document.getElementById('modal-link-preview-list');
    if (!preview || !count || !list) return;

    const lines = String(rawInput || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) {
        preview.classList.add('hidden');
        list.innerHTML = '';
        count.textContent = '';
        return;
    }

    const detected = lines.map((url, index) => ({
        index,
        url,
        parsed: parseSpotifyUrl(url),
    }));
    const recognizedCount = detected.filter((entry) => entry.parsed).length;
    count.textContent = `${recognizedCount}/${lines.length} recognized`;
    list.innerHTML = detected.slice(0, 8).map((entry) => {
        const { parsed } = entry;
        const typeLabel = parsed ? getSpotifyTypeLabel(parsed.type) : 'Unrecognized';
        const statusClass = parsed ? 'text-primary' : 'text-red-300';
        const identifier = parsed ? parsed.id : entry.url;
        return `
            <div class="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                <div class="min-w-0 flex items-center gap-2">
                    <span class="text-[11px] text-secondary-text w-10 shrink-0">Line ${entry.index + 1}</span>
                    <span class="text-sm font-semibold ${statusClass}">${typeLabel}</span>
                    <code class="text-xs text-secondary-text truncate" title="${escapeHtml(identifier)}">${escapeHtml(identifier)}</code>
                </div>
                <span class="text-[11px] ${statusClass} shrink-0">${parsed ? 'Ready' : 'Check link'}</span>
            </div>
        `;
    }).join('') + (detected.length > 8
        ? `<p class="pt-2 text-[11px] text-secondary-text">+${detected.length - 8} more lines</p>`
        : '');
    preview.classList.remove('hidden');
}

/** Get the open.spotify.com URL from type + id */
function getSpotifyUrl(type, id) {
    return `https://open.spotify.com/${type}/${id}`;
}

function getSpotifyUri(type, id) {
    const normalizedType = String(type || '').trim();
    const normalizedId = String(id || '').trim();
    if (!normalizedType || !normalizedId) return '';
    return `spotify:${normalizedType}:${normalizedId}`;
}

function getItemSpotifyUrl(item) {
    if (!item) return '';
    const directUrl = String(item.spotify_url || '').trim();
    if (directUrl) return directUrl;
    return getSpotifyUrl(item.type, item.spotify_id);
}

function getItemSearchHaystacks(item) {
    if (!item) return [];
    const spotifyUrl = getItemSpotifyUrl(item);
    const spotifyUri = getSpotifyUri(item.type, item.spotify_id);
    const haystacks = [
        item.name,
        getDisplayTitle(item),
        getItemSubtitle(item),
        item.owner_name,
        item.playlist_owner,
        item.playlist_owner_name,
        item.spotify_id,
        item.type,
        spotifyUrl,
        spotifyUri,
    ];
    return haystacks
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
}

function doesItemMatchSearchQuery(item, rawQuery) {
    const query = String(rawQuery || '').trim().toLowerCase();
    if (!query) return true;

    const parsedQuery = parseSpotifyUrl(rawQuery);
    if (parsedQuery) {
        const itemType = String(item?.type || '').trim().toLowerCase();
        const itemSpotifyId = String(item?.spotify_id || '').trim().toLowerCase();
        if (
            itemType === String(parsedQuery.type || '').toLowerCase() &&
            itemSpotifyId === String(parsedQuery.id || '').toLowerCase()
        ) {
            return true;
        }
    }

    return getItemSearchHaystacks(item).some((value) => value.includes(query));
}

/** Debounce function */
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function itemKey(item) {
    if (item?.id) return String(item.id);
    return `${item?.type || ''}:${item?.spotify_id || ''}:${item?.user_id ? String(item.user_id) : ''}`;
}

function itemIdentity(item) {
    const id = item?.id;
    if (id !== undefined && id !== null && String(id) !== '') {
        return `id:${id}`;
    }
    const ownerId = item?.user_id ? String(item.user_id) : '';
    const group = item?.group ? String(item.group) : '';
    const createdAt = item?.created_at ? String(item.created_at) : '';
    return `key:${itemKey(item)}:${ownerId}:${group}:${createdAt}`;
}

function selectionKey(item) {
    return itemIdentity(item);
}

function getCurrentUserIdentity() {
    const user = getAuthUser();
    return {
        id: user?.id ? String(user.id) : null,
        name: user ? (user.display_name || user.username || 'User') : 'User',
        avatar: user?.avatar || null,
    };
}

function getUserIdentityById(userId) {
    const currentIdentity = getCurrentUserIdentity();
    const targetId = userId ? String(userId) : '';
    if (!targetId || String(currentIdentity.id || '') === targetId) {
        return currentIdentity;
    }

    const match = (state.adminUserList || []).find((user) => (
        String(user.id || user._id || '') === targetId
    ));

    if (!match) {
        return {
            ...currentIdentity,
            id: targetId,
        };
    }

    return {
        id: targetId,
        name: match.display_name || match.username || targetId,
        avatar: match.avatar || null,
    };
}

function loadPersistedRowOrder() {
    try {
        const raw = localStorage.getItem(getUserRowOrderStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function savePersistedRowOrder(keys, opts = {}) {
    try {
        localStorage.setItem(getUserRowOrderStorageKey(), JSON.stringify(Array.isArray(keys) ? keys : []));
        if (!opts?.skipServerSync) {
            queueUiPreferencesSave();
        }
    } catch {
        // Ignore storage failures.
    }
}

function clampColumnWidth(key, value) {
    const fallback = DEFAULT_COLUMN_WIDTHS[key] ?? 120;
    const min = MIN_COLUMN_WIDTHS[key] ?? 72;
    const max = MAX_COLUMN_WIDTHS[key] ?? 900;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
}

function loadPersistedColumnWidths() {
    try {
        const raw = localStorage.getItem(getUserColumnWidthStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        const widths = { ...DEFAULT_COLUMN_WIDTHS };
        Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
            widths[key] = clampColumnWidth(key, parsed?.[key]);
        });
        return rebalanceColumnWidths(widths);
    } catch {
        return rebalanceColumnWidths({ ...DEFAULT_COLUMN_WIDTHS });
    }
}

function savePersistedColumnWidths(widths, opts = {}) {
    try {
        localStorage.setItem(getUserColumnWidthStorageKey(), JSON.stringify(widths));
        if (!opts?.skipServerSync) {
            queueUiPreferencesSave();
        }
    } catch {
        // Ignore storage failures.
    }
}

function normalizeUiPreferences(raw) {
    const prefs = raw && typeof raw === 'object' ? raw : {};
    const rowOrder = Array.isArray(prefs.row_order)
        ? prefs.row_order.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
    const columnWidths = {};
    const rawWidths = prefs.column_widths && typeof prefs.column_widths === 'object'
        ? prefs.column_widths
        : {};
    Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(rawWidths, key)) {
            columnWidths[key] = clampColumnWidth(key, rawWidths[key]);
        }
    });
    return { row_order: rowOrder, column_widths: columnWidths };
}

function normalizeGlobalPreferences(raw) {
    const prefs = raw && typeof raw === 'object' ? raw : {};
    const numeric = Number(prefs.playlist_clipboard_line_limit);
    const lineLimit = Number.isInteger(numeric)
        ? Math.min(MAX_PLAYLIST_CLIPBOARD_LINE_LIMIT, Math.max(MIN_PLAYLIST_CLIPBOARD_LINE_LIMIT, numeric))
        : DEFAULT_PLAYLIST_CLIPBOARD_LINE_LIMIT;
    return { playlistClipboardLineLimit: lineLimit };
}

async function hydrateUiPreferencesFromServer() {
    try {
        if (!getAuthToken()) return;
        const data = await api.getMyPreferences();
        const normalized = normalizeUiPreferences(data?.preferences || {});
        state.globalPreferences = normalizeGlobalPreferences(data?.global_preferences || {});
        if (Array.isArray(normalized.row_order)) {
            savePersistedRowOrder(normalized.row_order, { skipServerSync: true });
        }
        if (normalized.column_widths && Object.keys(normalized.column_widths).length) {
            const next = { ...DEFAULT_COLUMN_WIDTHS };
            Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(normalized.column_widths, key)) {
                    next[key] = clampColumnWidth(key, normalized.column_widths[key]);
                }
            });
            savePersistedColumnWidths(next, { skipServerSync: true });
        }
    } catch (err) {
        console.warn('[UI Prefs] Load failed:', err.message);
    }
}

function queueUiPreferencesSave() {
    if (state.uiPrefSaveTimer) {
        clearTimeout(state.uiPrefSaveTimer);
    }
    state.uiPrefSaveTimer = setTimeout(() => {
        state.uiPrefSaveTimer = null;
        saveUiPreferencesToServer();
    }, UI_PREF_SAVE_DEBOUNCE_MS);
}

async function saveUiPreferencesToServer() {
    try {
        if (!getAuthToken()) return;
        const rowOrder = loadPersistedRowOrder();
        const columnWidths = {};
        Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
            columnWidths[key] = clampColumnWidth(key, state.columnWidths[key]);
        });
        await api.saveMyPreferences({
            row_order: rowOrder,
            column_widths: columnWidths,
        });
    } catch (err) {
        console.warn('[UI Prefs] Save failed:', err.message);
    }
}

function applyColumnWidths(widths = state.columnWidths) {
    const root = document.documentElement;
    if (!root) return;
    Object.entries(COLUMN_WIDTH_VAR_MAP).forEach(([key, cssVar]) => {
        const width = clampColumnWidth(key, widths?.[key]);
        root.style.setProperty(cssVar, `${width}px`);
    });
}

function getDefaultResizableColumnBudget() {
    return RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + DEFAULT_COLUMN_WIDTHS[key], 0);
}

function getMinResizableColumnBudget() {
    return RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + (MIN_COLUMN_WIDTHS[key] ?? 72), 0);
}

function getMaxResizableColumnBudget() {
    return RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + (MAX_COLUMN_WIDTHS[key] ?? 900), 0);
}

function measureAvailableColumnBudget() {
    const row = document.querySelector('.list-columns-head.custom-grid-row');
    if (!row) return null;
    const styles = window.getComputedStyle(row);
    const paddingLeft = parseFloat(styles.paddingLeft || '0');
    const paddingRight = parseFloat(styles.paddingRight || '0');
    const rootStyles = window.getComputedStyle(document.documentElement);
    const outerGap = parseFloat(styles.columnGap || styles.gap || '16') || 16;
    const metaGap = parseFloat(rootStyles.getPropertyValue('--meta-gap') || '12') || 12;
    const metaColumnCount = Math.max(0, RESIZABLE_COLUMN_KEYS.length - 2);
    const internalMetaGaps = Math.max(0, metaColumnCount - 1) * metaGap;
    const available = row.getBoundingClientRect().width
        - paddingLeft
        - paddingRight
        - (outerGap * 2)
        - internalMetaGaps;
    if (!Number.isFinite(available) || available <= 0) return null;
    return Math.round(available);
}

function distributeColumnDelta(widths, keys, delta) {
    let remaining = Math.round(delta);
    let safety = 0;
    while (Math.abs(remaining) > 0 && safety < 24) {
        const direction = Math.sign(remaining);
        const candidates = keys.filter((key) => {
            const current = widths[key];
            return direction > 0
                ? current < (MAX_COLUMN_WIDTHS[key] ?? current)
                : current > (MIN_COLUMN_WIDTHS[key] ?? current);
        });
        if (!candidates.length) break;

        const totalWeight = candidates.reduce((sum, key) => sum + Math.max(widths[key], 1), 0) || candidates.length;
        let applied = 0;

        candidates.forEach((key, index) => {
            const min = MIN_COLUMN_WIDTHS[key] ?? 72;
            const max = MAX_COLUMN_WIDTHS[key] ?? 900;
            const current = widths[key];
            const share = index === candidates.length - 1
                ? remaining - applied
                : Math.round((remaining * Math.max(current, 1)) / totalWeight);
            const next = Math.min(max, Math.max(min, current + share));
            const actual = next - current;
            widths[key] = next;
            applied += actual;
        });

        if (applied === 0) break;
        remaining -= applied;
        safety += 1;
    }

    return remaining;
}

function rebalanceColumnWidths(sourceWidths, preferredKey = null, targetBudget = null) {
    const widths = { ...sourceWidths };
    RESIZABLE_COLUMN_KEYS.forEach((key) => {
        widths[key] = clampColumnWidth(key, widths[key]);
    });

    const measuredBudget = targetBudget ?? state.columnBudget ?? measureAvailableColumnBudget() ?? getDefaultResizableColumnBudget();
    const budget = Math.min(
        getMaxResizableColumnBudget(),
        Math.max(getMinResizableColumnBudget(), measuredBudget),
    );
    const current = RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + widths[key], 0);
    let remaining = budget - current;

    const firstPassKeys = preferredKey
        ? RESIZABLE_COLUMN_KEYS.filter((key) => key !== preferredKey)
        : [...RESIZABLE_COLUMN_KEYS];
    remaining = distributeColumnDelta(widths, firstPassKeys, remaining);

    if (Math.abs(remaining) > 0 && preferredKey && RESIZABLE_COLUMN_KEYS.includes(preferredKey)) {
        remaining = distributeColumnDelta(widths, [preferredKey], remaining);
    }

    if (Math.abs(remaining) > 0) {
        distributeColumnDelta(widths, [...RESIZABLE_COLUMN_KEYS], remaining);
    }

    return widths;
}

function getDirectionalCompensationKeys(key, resizeEdge = 'end') {
    const index = RESIZABLE_COLUMN_KEYS.indexOf(key);
    if (index === -1) return [];
    if (resizeEdge === 'start') {
        return RESIZABLE_COLUMN_KEYS.slice(0, index).reverse();
    }
    return RESIZABLE_COLUMN_KEYS.slice(index + 1);
}

function setColumnWidth(key, width, persist = false, resizeEdge = 'end') {
    if (!(key in DEFAULT_COLUMN_WIDTHS)) return;
    const currentWidth = clampColumnWidth(key, state.columnWidths[key]);
    const nextWidth = clampColumnWidth(key, width);
    if (currentWidth === nextWidth) return;

    const delta = nextWidth - currentWidth;
    const nextWidths = {
        ...state.columnWidths,
        [key]: nextWidth,
    };
    const compensationKeys = getDirectionalCompensationKeys(key, resizeEdge);
    const remaining = distributeColumnDelta(nextWidths, compensationKeys, -delta);
    if (remaining !== 0) {
        nextWidths[key] = clampColumnWidth(key, nextWidths[key] + remaining);
    }

    state.columnWidths = nextWidths;
    applyColumnWidths(state.columnWidths);
    if (persist) {
        savePersistedColumnWidths(state.columnWidths);
    }
}

function syncColumnWidthsToViewport(persist = false) {
    const measuredBudget = measureAvailableColumnBudget();
    if (!measuredBudget) return;
    state.columnBudget = Math.min(
        getMaxResizableColumnBudget(),
        Math.max(getMinResizableColumnBudget(), measuredBudget),
    );
    state.columnWidths = rebalanceColumnWidths(state.columnWidths, null, state.columnBudget);
    applyColumnWidths(state.columnWidths);
    if (persist) {
        savePersistedColumnWidths(state.columnWidths);
    }
}

function getTitleToneClass(type) {
    const map = {
        track: 'title-tone-track',
        album: 'title-tone-album',
        artist: 'title-tone-artist',
    };
    return map[type] || '';
}

function getItemUserName(item) {
    if (item.user_name) return item.user_name;
    const currentUser = getAuthUser();
    if (currentUser && String(currentUser.id || '') === String(item.user_id || '')) {
        return currentUser.display_name || currentUser.username || 'ADMIN';
    }
    const match = (state.adminUserList || []).find((user) => String(user.id || user._id || '') === String(item.user_id || ''));
    if (match) return match.display_name || match.username || 'User';
    return 'User';
}

function getItemUserAvatar(item) {
    if (item.user_avatar) return item.user_avatar;
    const currentUser = getAuthUser();
    if (currentUser && String(currentUser.id || '') === String(item.user_id || '')) {
        return currentUser.avatar || null;
    }
    const match = (state.adminUserList || []).find((user) => String(user.id || user._id || '') === String(item.user_id || ''));
    return match?.avatar || null;
}

function getItemArtistNames(item) {
    const artists = Array.isArray(item?.artist_names)
        ? item.artist_names.map((name) => normalizeStoredGroupName(name)).filter(Boolean)
        : [];
    return Array.from(new Set(artists));
}

function buildPrefixedTitle(prefix, baseTitle) {
    const base = normalizeStoredGroupName(baseTitle) || 'Unknown';
    const prefixLabel = normalizeStoredGroupName(prefix);
    if (!prefixLabel) return base;
    if (base.toLowerCase().startsWith(`${prefixLabel.toLowerCase()} -`)) return base;
    return `${prefixLabel} - ${base}`;
}

function getNormalizedArtistNames(artistNames) {
    if (!Array.isArray(artistNames)) return [];
    const normalized = [];
    const seen = new Set();
    artistNames.forEach((name) => {
        const cleaned = normalizeStoredGroupName(name);
        if (!cleaned) return;
        const lowered = cleaned.toLowerCase();
        if (seen.has(lowered)) return;
        seen.add(lowered);
        normalized.push(cleaned);
    });
    return normalized;
}

function splitArtistLabel(artistLabel) {
    if (!artistLabel) return [];
    return getNormalizedArtistNames(String(artistLabel).split(',').map((part) => part.trim()));
}

function getArtistPrefixCandidates(artistNames) {
    const normalized = getNormalizedArtistNames(artistNames);
    const candidates = [];
    const seen = new Set();
    const appendCandidate = (candidate) => {
        const cleaned = normalizeStoredGroupName(candidate);
        if (!cleaned) return;
        const lowered = cleaned.toLowerCase();
        if (seen.has(lowered)) return;
        seen.add(lowered);
        candidates.push(cleaned);
    };
    [', ', ' - '].forEach((separator) => {
        for (let size = normalized.length; size >= 1; size -= 1) {
            appendCandidate(normalized.slice(0, size).join(separator));
        }
    });
    normalized.forEach((name) => appendCandidate(name));
    return candidates;
}

function stripLeadingArtistPrefix(title, artistNames) {
    let baseTitle = normalizeStoredGroupName(title) || 'Unknown';
    const candidates = getArtistPrefixCandidates(artistNames);
    if (!candidates.length) return baseTitle;

    let matched = true;
    while (matched) {
        matched = false;
        const lowered = baseTitle.toLowerCase();
        for (const prefix of candidates) {
            const marker = `${prefix} - `;
            if (lowered.startsWith(marker.toLowerCase())) {
                baseTitle = normalizeStoredGroupName(baseTitle.slice(marker.length)) || 'Unknown';
                matched = true;
                break;
            }
        }
    }
    return baseTitle;
}

function buildDisplayTitleWithArtists(artistNames, title, fallbackArtist = '') {
    let normalizedArtists = getNormalizedArtistNames(artistNames);
    let artistLabel = normalizedArtists.join(', ');
    if (!artistLabel) {
        artistLabel = normalizeStoredGroupName(fallbackArtist);
        normalizedArtists = splitArtistLabel(artistLabel);
    }

    const normalizedTitle = stripLeadingArtistPrefix(title, normalizedArtists);
    if (!artistLabel) return normalizedTitle;
    return `${artistLabel} - ${normalizedTitle}`;
}

function getDisplayTitle(item) {
    const baseTitle = item.name || 'Unknown';
    if (item.type === 'playlist') {
        const artistOrOwner = normalizeStoredGroupName(
            item.owner_name || getItemArtistNames(item)[0] || ''
        );
        return buildPrefixedTitle(artistOrOwner, baseTitle);
    }
    if (item.type === 'track' || item.type === 'album') {
        return buildDisplayTitleWithArtists(
            getItemArtistNames(item),
            baseTitle,
            item.owner_name || ''
        );
    }
    return baseTitle;
}

function renderOwnerUpdatedCell(item, ownerUrl, updatedAt) {
    const safeUpdatedAt = escapeHtml(updatedAt || '-');
    const userName = escapeHtml(getItemUserName(item));
    const userAvatarUrl = getItemUserAvatar(item);
    const avatarLabel = escapeHtml((getItemUserName(item) || 'US').slice(0, 2).toUpperCase());
    const ownerAvatar = userAvatarUrl
        ? `<img alt="User" class="list-owner-avatar" src="${userAvatarUrl}">`
        : `<div class="list-owner-avatar list-owner-fallback">${avatarLabel}</div>`;

    return `
        <div class="flex items-center gap-3 meta-cell">
            ${ownerAvatar}
            <div class="list-owner-meta">
                <div class="list-owner-name">${userName}</div>
                <div class="list-owner-time text-secondary-text">${safeUpdatedAt}</div>
            </div>
        </div>
    `;
}

function getPlaylistOwnerLabel(item) {
    if (!item || item.type !== 'playlist') return '-';
    const owner = normalizeStoredGroupName(item.owner_name || item.playlist_owner || item.playlist_owner_name || '');
    return owner || '-';
}

function getPlaylistOwnerAvatar(item) {
    if (!item || item.type !== 'playlist') return null;
    return item.owner_image || item.playlist_owner_image || null;
}

function isTextSortColumn(colKey) {
    return colKey === 'playlistOwner';
}

function getTextSortValue(item, colKey) {
    if (colKey === 'playlistOwner') {
        const owner = getPlaylistOwnerLabel(item);
        if (!owner || owner === '-') return null;
        return owner.toLocaleLowerCase();
    }
    return null;
}

function getCheckedSortModeLabel(mode) {
    switch (mode) {
    case CHECKED_SORT_MODES.ERROR_FIRST:
        return 'Error First';
    case CHECKED_SORT_MODES.CRAWLING_FIRST:
        return 'Crawling First';
    case CHECKED_SORT_MODES.ACTIVE_FIRST:
        return 'Active First';
    case CHECKED_SORT_MODES.RECENT_FIRST:
        return 'Newest Check';
    case CHECKED_SORT_MODES.OLDEST_FIRST:
        return 'Oldest Check';
    default:
        return 'None';
    }
}

function getCheckedStatusPriority(item, mode) {
    const status = String(item?.status || 'pending');
    const priorityMap = {
        [CHECKED_SORT_MODES.ERROR_FIRST]: { error: 0, crawling: 1, pending: 2, active: 3 },
        [CHECKED_SORT_MODES.CRAWLING_FIRST]: { crawling: 0, pending: 1, error: 2, active: 3 },
        [CHECKED_SORT_MODES.ACTIVE_FIRST]: { active: 0, crawling: 1, pending: 2, error: 3 },
    };
    return priorityMap[mode]?.[status] ?? 9;
}

function getCheckedTimestamp(item) {
    const raw = item?.last_checked || item?.created_at || '';
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : null;
}

function sortItemsByChecked(items, mode) {
    const sortedItems = [...items];
    sortedItems.sort((a, b) => {
        if (
            mode === CHECKED_SORT_MODES.ERROR_FIRST
            || mode === CHECKED_SORT_MODES.CRAWLING_FIRST
            || mode === CHECKED_SORT_MODES.ACTIVE_FIRST
        ) {
            const leftPriority = getCheckedStatusPriority(a, mode);
            const rightPriority = getCheckedStatusPriority(b, mode);
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
            }
            const leftTime = getCheckedTimestamp(a);
            const rightTime = getCheckedTimestamp(b);
            if (leftTime == null && rightTime == null) return 0;
            if (leftTime == null) return 1;
            if (rightTime == null) return -1;
            return rightTime - leftTime;
        }

        const leftTime = getCheckedTimestamp(a);
        const rightTime = getCheckedTimestamp(b);
        if (leftTime == null && rightTime == null) return 0;
        if (leftTime == null) return 1;
        if (rightTime == null) return -1;
        if (mode === CHECKED_SORT_MODES.OLDEST_FIRST) {
            return leftTime - rightTime;
        }
        return rightTime - leftTime;
    });
    return sortedItems;
}

function renderPlaylistOwnerCell(item) {
    const owner = getPlaylistOwnerLabel(item);
    if (!item || item.type !== 'playlist' || owner === '-') {
        return `
            <div class="meta-cell playlist-owner-cell playlist-owner-cell-empty" title="-">
                <span class="playlist-owner-empty">-</span>
            </div>
        `;
    }

    const ownerAvatarUrl = getPlaylistOwnerAvatar(item);
    const ownerAvatarLabel = escapeHtml((owner || 'PO').slice(0, 2).toUpperCase());
    const ownerUrl = item.owner_url
        || item.playlist_owner_url
        || item.owner_link
        || `https://open.spotify.com/search/${encodeURIComponent(owner)}`;
    const ownerContent = ownerUrl
        ? `<a class="list-title-link playlist-owner-link" href="${escapeHtml(ownerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(owner)}</a>`
        : escapeHtml(owner);
    const ownerAvatar = ownerAvatarUrl
        ? `<img alt="Playlist owner" class="list-owner-avatar playlist-owner-avatar" src="${ownerAvatarUrl}">`
        : `<div class="list-owner-avatar list-owner-fallback playlist-owner-avatar">${ownerAvatarLabel}</div>`;

    return `
        <div class="meta-cell playlist-owner-cell" title="${escapeHtml(owner)}">
            ${ownerAvatar}
            <div class="list-owner-meta">
                <div class="list-owner-name">${ownerContent}</div>
            </div>
        </div>
    `;
}

function applyPersistedItemOrder(items) {
    const list = Array.isArray(items) ? items.slice() : [];
    const order = loadPersistedRowOrder();
    if (!order.length) return list;

    const indexByKey = new Map(order.map((key, idx) => [key, idx]));
    return list.sort((a, b) => {
        const aSelectionKey = selectionKey(a);
        const bSelectionKey = selectionKey(b);
        const aLegacyKey = itemKey(a);
        const bLegacyKey = itemKey(b);
        const aIdx = indexByKey.has(aSelectionKey)
            ? indexByKey.get(aSelectionKey)
            : (indexByKey.has(aLegacyKey) ? indexByKey.get(aLegacyKey) : Number.MAX_SAFE_INTEGER);
        const bIdx = indexByKey.has(bSelectionKey)
            ? indexByKey.get(bSelectionKey)
            : (indexByKey.has(bLegacyKey) ? indexByKey.get(bLegacyKey) : Number.MAX_SAFE_INTEGER);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return 0;
    });
}

function persistCurrentItemOrder() {
    const loadedVirtualItems = getLoadedVirtualItems();
    if (state.listTotal > 0 && loadedVirtualItems.length >= state.listTotal) {
        savePersistedRowOrder(getStableRowOrderKeys(loadedVirtualItems));
        return;
    }
    const currentKeys = getStableRowOrderKeys(state.items);
    const existingOrder = cleanPersistedRowOrder(loadPersistedRowOrder());
    savePersistedRowOrder(mergeRowOrderKeys(existingOrder, currentKeys));
}

function getStableRowOrderKeys(items) {
    return (items || [])
        .filter((item) => item?.id && !String(item.id).startsWith('temp-'))
        .map((item) => selectionKey(item))
        .filter(Boolean);
}

function cleanPersistedRowOrder(keys) {
    return Array.from(new Set((keys || []).filter((key) => {
        const value = String(key || '');
        return value && !value.includes('temp-');
    })));
}

function mergeRowOrderKeys(existingOrder, currentKeys) {
    const merged = cleanPersistedRowOrder(existingOrder);
    const seen = new Set(merged);
    (currentKeys || []).forEach((key) => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(key);
    });
    return merged;
}

function persistMovedItemOrder(draggedKeys, targetKey, placement = 'before') {
    const movedKeys = Array.from(new Set((draggedKeys || []).filter(Boolean)));
    const movedSet = new Set(movedKeys);
    const loadedItems = getLoadedVirtualItems();
    const currentKeys = getStableRowOrderKeys(loadedItems.length ? loadedItems : state.items);
    const storedOrder = cleanPersistedRowOrder(loadPersistedRowOrder());
    const hasCompleteCurrentList = state.listTotal > 0 && loadedItems.length >= state.listTotal;
    const storedOrderCoversCurrentList = currentKeys.every((key) => storedOrder.includes(key));
    const existingOrder = hasCompleteCurrentList && !storedOrderCoversCurrentList
        ? currentKeys
        : mergeRowOrderKeys(storedOrder, currentKeys);
    if (
        existingOrder.length
        && targetKey
        && existingOrder.includes(targetKey)
        && movedKeys.every((key) => existingOrder.includes(key))
    ) {
        const remaining = existingOrder.filter((key) => !movedSet.has(key));
        const targetIndex = remaining.indexOf(targetKey);
        if (targetIndex !== -1) {
            remaining.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, ...movedKeys);
            savePersistedRowOrder(remaining);
            return;
        }
    }
    savePersistedRowOrder(existingOrder);
}

function syncSelectedItemsWithState() {
    const existing = new Set(state.items.map((item) => selectionKey(item)));
    state.selectedItemKeys = new Set(
        Array.from(state.selectedItemKeys).filter((key) => existing.has(key))
    );
    state.itemClipboard = {
        keys: Array.from(state.itemClipboard?.keys || []).filter((key) => existing.has(key)),
        mode: state.itemClipboard?.mode || null,
    };
    if (!state.itemClipboard.keys.length) {
        state.itemClipboard.mode = null;
    }
    state.draggingRowKeys = state.draggingRowKeys.filter((key) => existing.has(key));
    if (state.dragOverRowKey && !existing.has(state.dragOverRowKey)) {
        state.dragOverRowKey = null;
    }
    if (state.selectionAnchorKey && !existing.has(state.selectionAnchorKey)) {
        state.selectionAnchorKey = null;
    }
    if (state.contextMenuAnchorSelectionKey && !existing.has(state.contextMenuAnchorSelectionKey)) {
        state.contextMenuAnchorSelectionKey = null;
    }
}

function mergeItemsKeepOrder(existingItems, incomingItems) {
    const existing = Array.isArray(existingItems) ? existingItems : [];
    const incoming = Array.isArray(incomingItems) ? incomingItems : [];

    const incomingBySelectionKey = new Map();
    incoming.forEach((it) => {
        const key = selectionKey(it);
        if (!incomingBySelectionKey.has(key)) {
            incomingBySelectionKey.set(key, []);
        }
        incomingBySelectionKey.get(key).push(it);
    });

    const merged = [];
    for (const oldItem of existing) {
        const key = selectionKey(oldItem);
        const queue = incomingBySelectionKey.get(key);
        if (!queue || !queue.length) continue;
        const next = queue.shift();
        merged.push({ ...oldItem, ...next });
        if (!queue.length) {
            incomingBySelectionKey.delete(key);
        }
    }

    incomingBySelectionKey.forEach((queue) => {
        queue.forEach((it) => merged.push(it));
    });

    return merged;
}

function normalizeGroupName(name) {
    return String(name || '').trim();
}

function splitLegacyGroupName(name) {
    const raw = normalizeGroupName(name);
    if (!raw) return { name: '', ownerUserId: null };
    const compositeIndex = raw.indexOf('::');
    if (compositeIndex <= 0) {
        return { name: raw, ownerUserId: null };
    }
    const ownerUserId = normalizeGroupName(raw.slice(0, compositeIndex));
    const groupName = normalizeGroupName(raw.slice(compositeIndex + 2));
    if (!ownerUserId || !groupName || !isUuidLike(ownerUserId)) {
        return { name: raw, ownerUserId: null };
    }
    return { name: groupName, ownerUserId };
}

function normalizeStoredGroupName(name) {
    return splitLegacyGroupName(name).name;
}

function clampAccentValue(value, min, max) {
    return Math.min(Math.max(Number(value), min), max);
}

function getGroupAccentHash(groupName) {
    const normalized = normalizeStoredGroupName(groupName);
    if (!normalized) return null;
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0;
    }
    return hash >>> 0;
}

function hslToRgbString(hue, saturation, lightness) {
    const normalizedHue = ((Number(hue) % 360) + 360) % 360;
    const s = clampAccentValue(saturation / 100, 0, 1);
    const l = clampAccentValue(lightness / 100, 0, 1);
    const chroma = (1 - Math.abs((2 * l) - 1)) * s;
    const segment = normalizedHue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    let red = 0;
    let green = 0;
    let blue = 0;

    if (segment >= 0 && segment < 1) {
        red = chroma;
        green = x;
    } else if (segment >= 1 && segment < 2) {
        red = x;
        green = chroma;
    } else if (segment >= 2 && segment < 3) {
        green = chroma;
        blue = x;
    } else if (segment >= 3 && segment < 4) {
        green = x;
        blue = chroma;
    } else if (segment >= 4 && segment < 5) {
        red = x;
        blue = chroma;
    } else {
        red = chroma;
        blue = x;
    }

    const match = l - (chroma / 2);
    const toRgbChannel = (value) => Math.round((value + match) * 255);
    return `${toRgbChannel(red)},${toRgbChannel(green)},${toRgbChannel(blue)}`;
}

function getGroupAccentRgb(groupName) {
    const hash = getGroupAccentHash(groupName);
    if (hash == null) return '148,163,184';
    const hue = hash % 360;
    const saturation = 74 + ((hash >>> 9) % 8);
    const lightness = 52 + ((hash >>> 17) % 7);
    return hslToRgbString(hue, saturation, lightness);
}

function buildGroupAccentStyle(groupName) {
    return `--group-accent-rgb:${getGroupAccentRgb(groupName)};`;
}

function isSearchGroupAccentMode() {
    return state.activeGroup === ALL_GROUP_ID && Boolean((state.searchQuery || '').trim());
}

function getSearchMatchGroupCounts() {
    if (!isSearchGroupAccentMode()) return new Map();
    const counts = new Map();
    getVisibleItems().forEach((item) => {
        const groupName = normalizeStoredGroupName(item?.group);
        if (!groupName) return;
        counts.set(groupName, (counts.get(groupName) || 0) + 1);
    });
    return counts;
}

function escapeAttrSelectorValue(value) {
    const input = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(input);
    }
    return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function loadCustomGroups() {
    // Load from localStorage as fallback (will be overwritten by server sync)
    try {
        const raw = localStorage.getItem(getUserGroupStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(normalizeStoredGroupName)
            .filter(Boolean);
    } catch {
        return [];
    }
}

function getGroupsFromUserRecord(userRecord) {
    if (!userRecord) return [];
    const raw = userRecord.custom_groups;
    if (Array.isArray(raw)) {
        return raw.map(normalizeStoredGroupName).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map(normalizeStoredGroupName).filter(Boolean);
            }
        } catch {
            return [];
        }
    }
    return [];
}

function getOwnerCustomGroups(ownerUserId) {
    const ownId = String(getAuthUser()?.id || '');
    if (ownerUserId && String(ownerUserId) !== ownId) return [];
    return (state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean);
}

function setOwnerCustomGroups(ownerUserId, groups) {
    const ownId = String(getAuthUser()?.id || '');
    if (!ownId || (ownerUserId && String(ownerUserId) !== ownId)) return [];
    const cleaned = Array.from(new Set((groups || []).map(normalizeStoredGroupName).filter(Boolean)));
    state.customGroups = cleaned;
    localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
    return cleaned;
}

async function syncGroupsFromServer(targetUserId) {
    try {
        const token = getAuthToken();
        const ownId = String(getAuthUser()?.id || '');
        if (!token || !ownId || (targetUserId && String(targetUserId) !== ownId)) return;
        const res = await fetch(CONFIG.API_BASE + '/auth/me/groups', {
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (String(getAuthUser()?.id || '') !== ownId) return;
        const serverGroups = (data.groups || []).map(normalizeStoredGroupName).filter(Boolean);
        const localGroups = (state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean);
        if (!serverGroups.length && localGroups.length) {
            state.customGroups = localGroups;
            await saveGroupsToServer(localGroups);
        } else {
            setOwnerCustomGroups(ownId, serverGroups);
        }
        syncGroupUI(true);
    } catch (err) {
        console.warn('[Groups Sync] Error:', err.message);
    }
}

async function saveGroupsToServer(groups, targetUserId) {
    try {
        const token = getAuthToken();
        const ownId = String(getAuthUser()?.id || '');
        if (!token || !ownId || (targetUserId && String(targetUserId) !== ownId)) return;
        const res = await fetch(CONFIG.API_BASE + '/auth/me/groups', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ groups: groups || state.customGroups }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const payload = await res.json().catch(() => null);
        if (String(getAuthUser()?.id || '') !== ownId) return;
        if (payload && Array.isArray(payload.groups)) setOwnerCustomGroups(ownId, payload.groups);
    } catch (err) {
        console.warn('[Groups Sync] Failed to save groups:', err.message);
    }
}

function saveCustomGroups() {
    const cleaned = Array.from(new Set(
        (state.customGroups || [])
            .map(normalizeStoredGroupName)
            .filter(Boolean)
    ));
    state.customGroups = cleaned;
    localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
    saveGroupsToServer(cleaned);
}

function getActiveGroupName() {
    if (state.activeGroup === ALL_GROUP_ID) return 'Choose a group';
    const match = state.groups.find((g) => g.id === state.activeGroup);
    return match?.displayName || match?.name || state.activeGroup;
}

function isAdminAllUsersMode() {
    return false;
}

function buildGroupEntryId(groupName, ownerUserId = null) {
    const normalizedName = normalizeStoredGroupName(groupName);
    const normalizedOwner = ownerUserId ? String(ownerUserId) : '';
    if (!isAdminAllUsersMode() || !normalizedOwner) {
        return normalizedName;
    }
    return `${normalizedOwner}::${normalizedName}`;
}

function getGroupEntryById(groupId) {
    return state.groups.find((g) => String(g.id) === String(groupId)) || null;
}

function parseGroupEntryId(groupId) {
    const raw = normalizeGroupName(groupId);
    if (!raw || raw.toLowerCase() === ALL_GROUP_ID) {
        return { id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, ownerUserId: null };
    }
    const compositeIndex = raw.indexOf('::');
    if (compositeIndex === -1) {
        return { id: raw, name: normalizeStoredGroupName(raw), ownerUserId: null };
    }
    const ownerUserId = normalizeGroupName(raw.slice(0, compositeIndex));
    const parsedName = normalizeStoredGroupName(raw.slice(compositeIndex + 2));
    if (!ownerUserId || !parsedName || !isUuidLike(ownerUserId)) {
        return { id: raw, name: normalizeStoredGroupName(raw), ownerUserId: null };
    }
    return {
        id: raw,
        ownerUserId: ownerUserId,
        name: parsedName,
    };
}

function doesItemMatchGroupEntry(item, groupEntry) {
    if (!groupEntry || groupEntry.id === ALL_GROUP_ID) return true;
    const itemParsed = splitLegacyGroupName(item.group);
    if (normalizeStoredGroupName(itemParsed.name) !== normalizeStoredGroupName(groupEntry.name)) return false;
    if (!groupEntry.ownerUserId) return true;
    return isItemOwnedByUser(item, groupEntry.ownerUserId);
}

function isItemOwnedByUser(item, ownerUserId) {
    const ownerId = ownerUserId ? String(ownerUserId) : '';
    if (!ownerId) return true;
    const itemParsed = splitLegacyGroupName(item?.group);
    const itemOwnerId = String(item?.user_id || itemParsed.ownerUserId || '');
    if (itemOwnerId) {
        return itemOwnerId === ownerId;
    }
    const currentUser = getAuthUser();
    // Legacy rows may have null user_id; in admin mode treat them as admin-owned.
    return Boolean(currentUser?.role === 'admin' && String(currentUser.id || '') === ownerId);
}

function updateGroupHeader() {
    if (state.currentView && state.currentView !== 'linkchecker') return;
    const name = getActiveGroupName();
    const breadcrumb = document.getElementById('breadcrumb-group');
    const pageTitle = document.getElementById('page-title');
    if (breadcrumb) breadcrumb.textContent = name;
    if (pageTitle) pageTitle.textContent = name;
}

function clearRowSelection() {
    state.selectedItemKeys = new Set();
    state.selectionAnchorKey = null;
}

function clearGroupSelection() {
    state.selectedGroupIds = new Set();
    state.groupSelectionAnchorId = null;
}

function getPreferredSelectionScope(target) {
    const eventTarget = target instanceof Element ? target : null;
    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
    if (eventTarget?.closest?.('#group-panel') || activeElement?.closest?.('#group-panel')) {
        return 'groups';
    }
    if (eventTarget?.closest?.('.list-wrap, #link-list') || activeElement?.closest?.('.list-wrap, #link-list')) {
        return 'items';
    }
    return state.selectionScope === 'groups' ? 'groups' : 'items';
}

function getSelectedVisibleItems() {
    return state.filteredItems.filter((item) => state.selectedItemKeys.has(selectionKey(item)));
}

function getSelectedItems() {
    return state.items.filter((item) => state.selectedItemKeys.has(selectionKey(item)));
}

function getClipboardItems() {
    const clipboardKeys = new Set((state.itemClipboard?.keys || []).filter(Boolean));
    if (!clipboardKeys.size) return [];
    return state.items.filter((item) => clipboardKeys.has(selectionKey(item)));
}

function clearItemClipboard() {
    state.itemClipboard = { keys: [], mode: null };
    if (state.contextMenuVisible) {
        updateRowContextMenuLabels();
    }
}

function stageSelectedItemsForClipboard(mode = 'copy') {
    const selectedItems = getSelectedItems();
    if (!selectedItems.length) {
        showToast('No rows selected', 'info');
        return false;
    }
    state.itemClipboard = {
        keys: selectedItems.map((item) => selectionKey(item)),
        mode: mode === 'cut' ? 'cut' : 'copy',
    };
    if (state.contextMenuVisible) {
        updateRowContextMenuLabels();
    }
    const label = selectedItems.length > 1 ? `${selectedItems.length} links` : '1 link';
    showToast(`${mode === 'cut' ? 'Cut' : 'Copied'} ${label} for move`, 'success');
    return true;
}

async function copySelectedLinksToClipboard(items = getSelectedItems()) {
    const selectedItems = (items || []).filter(Boolean);
    if (!selectedItems.length) {
        showToast('No rows selected', 'info');
        return false;
    }
    const urls = selectedItems
        .map((item) => getItemSpotifyUrlForExport(item))
        .filter(Boolean);
    if (!urls.length) {
        showToast('No links available to copy', 'info');
        return false;
    }
    await copyToClipboard(
        urls.join('\r\n'),
        urls.length > 1 ? `Copied ${urls.length} links` : 'Copied 1 link'
    );
    return true;
}

function getCopyLinkLabel(selectedCount) {
    if (selectedCount > 1) return `Copy ${selectedCount} links`;
    return 'Copy Link';
}

function getMoveTargetGroups() {
    const ungroupedEntry = {
        id: '__ungrouped__',
        name: '',
        displayName: 'No Group',
        ownerUserId: null,
    };
    return [
        ungroupedEntry,
        ...state.groups.filter((group) => String(group.id).toLowerCase() !== ALL_GROUP_ID),
    ];
}

async function moveItemsToGroup(items, targetGroupEntry, opts = {}) {
    const uniqueMap = new Map();
    (items || []).forEach((item) => {
        if (!item) return;
        uniqueMap.set(itemIdentity(item), item);
    });
    const targets = Array.from(uniqueMap.values());
    if (!targets.length) {
        showToast('No rows selected', 'info');
        return false;
    }

    const nextGroupName = targetGroupEntry?.id === '__ungrouped__'
        ? null
        : normalizeStoredGroupName(targetGroupEntry?.name || '');
    const unchanged = targets.every((item) => normalizeStoredGroupName(item.group) === normalizeStoredGroupName(nextGroupName));
    if (unchanged) {
        showToast('Links are already in that group', 'info');
        return false;
    }

    const previousGroups = new Map(targets.map((item) => [itemIdentity(item), item.group ?? null]));
    targets.forEach((item) => {
        item.group = nextGroupName;
    });
    persistCurrentItemOrder();
    renderGroups();
    renderList({ preserveScroll: true });

    const stableItemIds = targets
        .filter((item) => item.id && !String(item.id).startsWith('temp-'))
        .map((item) => String(item.id));

    if (!state.apiOnline || !stableItemIds.length) {
        if (!state.apiOnline && stableItemIds.length) {
            showToast('Moved locally only (API offline)', 'info');
        } else {
            showToast(
                nextGroupName
                    ? `Moved ${targets.length} link${targets.length > 1 ? 's' : ''} to ${targetGroupEntry?.displayName || targetGroupEntry?.name || nextGroupName}`
                    : `Cleared group for ${targets.length} link${targets.length > 1 ? 's' : ''}`,
                'success'
            );
        }
        return true;
    }

    try {
        await api.moveItems(stableItemIds, nextGroupName);
        showToast(
            nextGroupName
                ? `Moved ${targets.length} link${targets.length > 1 ? 's' : ''} to ${targetGroupEntry?.displayName || targetGroupEntry?.name || nextGroupName}`
                : `Cleared group for ${targets.length} link${targets.length > 1 ? 's' : ''}`,
            'success'
        );
        return true;
    } catch (err) {
        targets.forEach((item) => {
            item.group = previousGroups.get(itemIdentity(item)) ?? null;
        });
        persistCurrentItemOrder();
        renderGroups();
        renderList({ preserveScroll: true });
        showToast(err.message || 'Failed to move links', 'error');
        return false;
    } finally {
        if (opts.clearClipboard !== false) {
            clearItemClipboard();
        }
    }
}

async function pasteClipboardItems() {
    const clipboardItems = getClipboardItems();
    if (!clipboardItems.length) {
        showToast('Move clipboard is empty', 'info');
        return false;
    }

    if (state.selectionScope === 'groups') {
        const groupTarget = getSelectedGroupEntries()
            .find((group) => String(group.id).toLowerCase() !== ALL_GROUP_ID);
        if (groupTarget) {
            return moveItemsToGroup(clipboardItems, groupTarget);
        }
    }

    const targetRowKey = state.selectionAnchorKey
        || Array.from(state.selectedItemKeys)[0]
        || state.contextMenuAnchorSelectionKey;
    const clipboardKeySet = new Set((state.itemClipboard?.keys || []).filter(Boolean));
    if (targetRowKey && !clipboardKeySet.has(targetRowKey)) {
        const moved = moveItemsByKeys(Array.from(clipboardKeySet), targetRowKey, 'before');
        if (moved) {
            renderList({ preserveScroll: true });
            clearItemClipboard();
            showToast(
                clipboardKeySet.size > 1
                    ? `Moved ${clipboardKeySet.size} selected links`
                    : 'Moved selected link',
                'success'
            );
            return true;
        }
    }

    const activeEntry = getGroupEntryById(state.activeGroup);
    if (activeEntry && activeEntry.id !== ALL_GROUP_ID) {
        return moveItemsToGroup(clipboardItems, activeEntry);
    }

    showToast('Select a group or a destination row before pasting', 'info');
    return false;
}

function getVisibleSidebarGroups() {
    const q = state.groupSearchQuery.trim().toLowerCase();
    return state.groups.filter((g) => {
        if (g.id === ALL_GROUP_ID) return true;
        if (!q) return true;
        return (g.displayName || g.name).toLowerCase().includes(q);
    });
}

function getSelectedGroupEntries() {
    return state.groups.filter((group) => state.selectedGroupIds.has(group.id));
}

function syncSelectedGroupsWithState() {
    const valid = new Set(state.groups.map((group) => String(group.id)));
    state.selectedGroupIds = new Set(
        Array.from(state.selectedGroupIds).filter((groupId) => valid.has(String(groupId)))
    );
    if (state.groupSelectionAnchorId && !valid.has(String(state.groupSelectionAnchorId))) {
        state.groupSelectionAnchorId = null;
    }
}

function findItemFromRow(row) {
    if (!row) return null;
    const rowSelectionKey = row.dataset.selectionKey;
    if (rowSelectionKey) {
        const bySelectionKey = state.items.find((item) => selectionKey(item) === rowSelectionKey);
        if (bySelectionKey) return bySelectionKey;
    }

    const rowItemId = row.dataset.itemId;
    if (rowItemId && rowItemId !== 'undefined' && rowItemId !== 'null') {
        const byId = state.items.find((item) => String(item.id) === String(rowItemId));
        if (byId) return byId;
    }

    const rowType = row.dataset.type;
    const rowSpotifyId = row.dataset.spotifyId;
    const rowUserId = String(row.dataset.userId || '');
    return state.items.find((item) => (
        item.type === rowType
        && item.spotify_id === rowSpotifyId
        && String(item.user_id || '') === rowUserId
    )) || null;
}

function getVisibleItems() {
    let items = state.items;

    if (state.activeGroup !== ALL_GROUP_ID) {
        const activeEntry = getGroupEntryById(state.activeGroup);
        items = items.filter((i) => doesItemMatchGroupEntry(i, activeEntry));
    }

    if (state.searchQuery) {
        items = items.filter((i) => doesItemMatchSearchQuery(i, state.searchQuery));
    }

    if (state.metricSortColumn && METRIC_SORT_CONFIG[state.metricSortColumn]) {
        const columnKey = state.metricSortColumn;
        const mode = state.metricSortMode === 'delta' ? 'delta' : 'value';
        const direction = state.metricSortDirection === 'asc' ? 'asc' : 'desc';
        const sortFactor = direction === 'asc' ? 1 : -1;
        const sortedItems = [...items];
        sortedItems.sort((a, b) => {
            const left = getMetricSortValue(a, columnKey, mode);
            const right = getMetricSortValue(b, columnKey, mode);

            if (left == null && right == null) return 0;
            if (left == null) return 1;
            if (right == null) return -1;
            if (left === right) return 0;
            return left > right ? sortFactor : -sortFactor;
        });
        return sortedItems;
    }

    if (state.textSortColumn && isTextSortColumn(state.textSortColumn)) {
        const colKey = state.textSortColumn;
        const direction = state.textSortDirection === 'desc' ? 'desc' : 'asc';
        const sortFactor = direction === 'asc' ? 1 : -1;
        const sortedItems = [...items];
        sortedItems.sort((a, b) => {
            const left = getTextSortValue(a, colKey);
            const right = getTextSortValue(b, colKey);
            if (!left && !right) return 0;
            if (!left) return 1;
            if (!right) return -1;
            if (left === right) return 0;
            return left > right ? sortFactor : -sortFactor;
        });
        return sortedItems;
    }

    if (state.checkedSortMode && state.checkedSortMode !== CHECKED_SORT_MODES.NONE) {
        return sortItemsByChecked(items, state.checkedSortMode);
    }

    return items;
}

function isInteractiveRowTarget(target) {
    return Boolean(target?.closest('a, button, input, textarea, select, label, [role="button"], .row-action-cell, .row-action-buttons'));
}

function handleRowSelection(item, event) {
    if (!item) return;
    state.selectionScope = 'items';
    const key = selectionKey(item);
    const visibleKeys = state.filteredItems.map((it) => selectionKey(it));

    if (event.shiftKey && state.selectionAnchorKey && visibleKeys.includes(state.selectionAnchorKey)) {
        const start = visibleKeys.indexOf(state.selectionAnchorKey);
        const end = visibleKeys.indexOf(key);
        if (start !== -1 && end !== -1) {
            const [from, to] = start < end ? [start, end] : [end, start];
            state.selectedItemKeys = new Set(visibleKeys.slice(from, to + 1));
            renderList({ preserveScroll: true });
            return;
        }
    }

    if (event.ctrlKey || event.metaKey) {
        const next = new Set(state.selectedItemKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        state.selectedItemKeys = next;
        state.selectionAnchorKey = key;
        renderList({ preserveScroll: true });
        return;
    }

    state.selectedItemKeys = new Set([key]);
    state.selectionAnchorKey = key;
    renderList({ preserveScroll: true });
}

function moveItemsByKeys(draggedKeys, targetKey, placement = 'before') {
    const draggedSet = new Set((draggedKeys || []).filter(Boolean));
    if (!draggedSet.size || !targetKey || draggedSet.has(targetKey)) return false;

    const usingVirtualList = state.listTotal > 0 && Array.isArray(state.virtualItems) && state.virtualItems.length;
    const sourceItems = usingVirtualList ? getLoadedVirtualItems() : state.items;
    const draggedItems = sourceItems.filter((item) => draggedSet.has(selectionKey(item)));
    if (!draggedItems.length) return false;

    const remaining = sourceItems.filter((item) => !draggedSet.has(selectionKey(item)));
    const targetIndex = remaining.findIndex((item) => selectionKey(item) === targetKey);
    if (targetIndex === -1) return false;

    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    remaining.splice(insertIndex, 0, ...draggedItems);
    if (usingVirtualList) {
        const loadedIndexes = [];
        state.virtualItems.forEach((item, idx) => {
            if (item) loadedIndexes.push(idx);
        });
        const nextVirtualItems = state.virtualItems.slice();
        loadedIndexes.forEach((idx, orderIdx) => {
            nextVirtualItems[idx] = remaining[orderIdx];
        });
        state.virtualItems = nextVirtualItems;
        state.items = getLoadedVirtualItems();
    } else {
        state.items = remaining;
    }
    persistMovedItemOrder(Array.from(draggedSet), targetKey, placement);
    return true;
}

function moveCustomGroupBefore(draggedGroupId, targetGroupId, placement = 'before') {
    const dragged = normalizeGroupName(draggedGroupId);
    const target = normalizeGroupName(targetGroupId);
    if (!dragged || !target || dragged === target) return false;
    if (dragged.toLowerCase() === ALL_GROUP_ID || target.toLowerCase() === ALL_GROUP_ID) return false;

    const draggedEntry = getGroupEntryById(dragged) || parseGroupEntryId(dragged);
    const targetEntry = getGroupEntryById(target) || parseGroupEntryId(target);
    const draggedGroupName = normalizeStoredGroupName(draggedEntry?.name || dragged);
    const targetGroupName = normalizeStoredGroupName(targetEntry?.name || target);
    if (!draggedGroupName || !targetGroupName || draggedGroupName.toLowerCase() === targetGroupName.toLowerCase()) return false;

    const current = Array.from(new Set((state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean)));
    const next = current.slice();

    if (!next.some((name) => name.toLowerCase() === draggedGroupName.toLowerCase())) {
        next.push(draggedGroupName);
    }
    if (!next.some((name) => name.toLowerCase() === targetGroupName.toLowerCase())) {
        next.push(targetGroupName);
    }

    const draggedIndex = next.findIndex((name) => name.toLowerCase() === draggedGroupName.toLowerCase());
    const [movedName] = next.splice(draggedIndex, 1);
    const targetIndex = next.findIndex((name) => name.toLowerCase() === targetGroupName.toLowerCase());
    if (targetIndex === -1) return false;
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    next.splice(insertIndex, 0, movedName);

    state.customGroups = next;
    saveCustomGroups();
    return true;
}

function syncRowDragUi(container) {
    const host = container || document.getElementById('link-list');
    if (!host) return;
    host.querySelectorAll('.custom-grid-row').forEach((row) => {
        const key = row.dataset.selectionKey;
        const isDragging = state.draggingRowKeys.includes(key);
        row.classList.toggle('row-dragging', isDragging);
        const isDropTarget = Boolean(state.dragOverRowKey && state.dragOverRowKey === key && !state.draggingRowKeys.includes(key));
        row.classList.toggle('row-drop-target', isDropTarget);
        row.classList.toggle('row-drop-before', isDropTarget && state.dragOverRowPlacement !== 'after');
        row.classList.toggle('row-drop-after', isDropTarget && state.dragOverRowPlacement === 'after');
    });
}

function syncGroupDragUi(container) {
    const host = container || document.getElementById('group-list');
    if (!host) return;
    host.querySelectorAll('.group-item[data-group]').forEach((groupBtn) => {
        const groupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
        const isDropTarget = Boolean(groupId && state.dragOverGroupId === groupId && state.draggingGroupId !== groupId);
        groupBtn.classList.toggle('group-item-dragging', Boolean(groupId && state.draggingGroupIds.includes(groupId)));
        groupBtn.classList.toggle('group-item-drop-target', isDropTarget);
        groupBtn.classList.toggle('group-drop-before', isDropTarget && state.dragOverGroupPlacement !== 'after');
        groupBtn.classList.toggle('group-drop-after', isDropTarget && state.dragOverGroupPlacement === 'after');
    });
}

function stopDragAutoScroll() {
    if (state.dragScrollRaf) {
        cancelAnimationFrame(state.dragScrollRaf);
        state.dragScrollRaf = null;
    }
    state.dragScrollContainer = null;
    state.dragScrollSpeed = 0;
}

function ensureDragAutoScroll() {
    if (state.dragScrollRaf) return;
    const tick = () => {
        const container = state.dragScrollContainer;
        const speed = state.dragScrollSpeed;
        if (!container || !speed) {
            state.dragScrollRaf = null;
            return;
        }
        container.scrollTop += speed;
        state.dragScrollRaf = requestAnimationFrame(tick);
    };
    state.dragScrollRaf = requestAnimationFrame(tick);
}

function updateDragAutoScroll(container, clientY) {
    if (!container) {
        stopDragAutoScroll();
        return;
    }

    const rect = container.getBoundingClientRect();
    const edge = CONFIG.DRAG_SCROLL_EDGE;
    let speed = 0;

    if (clientY < rect.top + edge) {
        const ratio = Math.max(0, (rect.top + edge - clientY) / edge);
        speed = -Math.ceil(CONFIG.DRAG_SCROLL_MAX_SPEED * ratio);
    } else if (clientY > rect.bottom - edge) {
        const ratio = Math.max(0, (clientY - (rect.bottom - edge)) / edge);
        speed = Math.ceil(CONFIG.DRAG_SCROLL_MAX_SPEED * ratio);
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    if (speed < 0 && container.scrollTop <= 0) speed = 0;
    if (speed > 0 && container.scrollTop >= maxScrollTop) speed = 0;

    if (!speed) {
        if (state.dragScrollContainer === container) {
            stopDragAutoScroll();
        }
        return;
    }

    state.dragScrollContainer = container;
    state.dragScrollSpeed = speed;
    ensureDragAutoScroll();
}

function getAdminUserLabelById(userId) {
    if (!userId) return '';
    const currentUser = getAuthUser();
    if (currentUser && String(currentUser.id || '') === String(userId)) {
        return currentUser.display_name || currentUser.username || 'Admin';
    }
    const match = (state.adminUserList || []).find((user) => String(user.id || user._id || '') === String(userId));
    return (match && (match.display_name || match.username)) || '';
}

function getOwnerGroupLabelCandidates(ownerUserId) {
    const ownerId = ownerUserId ? String(ownerUserId) : '';
    const labels = new Set();
    const push = (value) => {
        const v = normalizeGroupName(value);
        if (v) labels.add(v);
    };

    if (ownerId) {
        const owner = (state.adminUserList || []).find((u) => String(u.id || u._id || '') === ownerId);
        if (owner) {
            push(owner.display_name);
            push(owner.username);
        }
    }

    push(getAdminUserLabelById(ownerId));
    const me = getAuthUser();
    if (me && (!ownerId || String(me.id || '') === ownerId)) {
        push(me.display_name);
        push(me.username);
    }

    return Array.from(labels);
}

function buildGroupNameVariants(groupName, ownerUserId = null) {
    const variants = new Set();
    const base = normalizeStoredGroupName(groupName);
    const raw = normalizeGroupName(groupName);
    const push = (value) => {
        const v = normalizeGroupName(value);
        if (!v) return;
        variants.add(v);
    };

    push(raw);
    push(base);

    if (raw.includes(' - ')) {
        const suffix = normalizeGroupName(raw.split(' - ').slice(1).join(' - '));
        push(suffix);
    }

    getOwnerGroupLabelCandidates(ownerUserId).forEach((label) => {
        push(`${label} - ${base}`);
        push(`${label.toUpperCase()} - ${base}`);
        push(`${label.toLowerCase()} - ${base}`);
    });

    return Array.from(variants);
}

function groupNameMatchesVariants(value, variants) {
    const all = Array.isArray(variants) ? variants : [];
    if (!all.length) return false;
    const normalizedValue = normalizeGroupName(value).toLowerCase();
    const storedValue = normalizeStoredGroupName(value).toLowerCase();
    return all.some((v) => {
        const n = normalizeGroupName(v).toLowerCase();
        const s = normalizeStoredGroupName(v).toLowerCase();
        return Boolean(n) && (n === normalizedValue || n === storedValue || s === normalizedValue || s === storedValue);
    });
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function getCurrentUserLabel() {
    const currentUser = getAuthUser();
    return currentUser?.display_name || currentUser?.username || 'Admin';
}

function getAdminTargetUserId() {
    const currentUser = getAuthUser();
    if (!canManageUsers(currentUser)) return null;
    return currentUser?.id ? String(currentUser.id) : null;
}

function getScopedGroupOwnerUserId() {
    const currentUser = getAuthUser();
    if (!currentUser?.id) return null;
    return String(currentUser.id);
}

function getAdminGroupBaseName(groupName, ownerLabel = '') {
    const raw = normalizeStoredGroupName(groupName);
    if (!raw) return 'Group';
    if (isUuidLike(raw)) return 'Group';
    const prefixed = ownerLabel ? `${ownerLabel} - ` : '';
    if (prefixed && raw.toLowerCase().startsWith(prefixed.toLowerCase())) {
        return raw.slice(prefixed.length).trim() || 'Group';
    }
    return raw;
}

function getAdminGroupDisplayName(groupName, ownerUserId = null) {
    const currentUser = getAuthUser();
    if (!canManageUsers(currentUser) || !groupName || groupName === ALL_GROUP_LABEL) {
        return groupName;
    }

    let ownerLabel = '';
    if (ownerUserId) {
        ownerLabel = getAdminUserLabelById(ownerUserId) || getCurrentUserLabel();
    } else if ((state.customGroups || []).some((name) => normalizeStoredGroupName(name) === normalizeStoredGroupName(groupName))) {
        ownerLabel = getCurrentUserLabel();
    } else {
        ownerLabel = getCurrentUserLabel();
    }

    const baseName = getAdminGroupBaseName(groupName, ownerLabel);
    return baseName;
}

function canManageGroupEntry(groupEntry) {
    if (!groupEntry || groupEntry.id === ALL_GROUP_ID) return false;
    const currentUser = getAuthUser();
    return Boolean(currentUser?.id && (!groupEntry.ownerUserId || String(groupEntry.ownerUserId) === String(currentUser.id)));
}

function rebuildGroups() {
    const currentUser = getAuthUser();
    const legacyFallbackOwnerId = currentUser?.role === 'admin' ? String(currentUser.id || '') : null;
    const previousGroups = Array.isArray(state.groups) ? state.groups.slice() : [];
    const previousActiveId = state.activeGroup;
    const previousActiveEntry =
        previousGroups.find((g) => String(g.id) === String(previousActiveId))
        || parseGroupEntryId(previousActiveId);
    const counts = new Map();
    const encountered = [];
    const summaryGroups = Array.isArray(state.itemSummary?.groups) ? state.itemSummary.groups : [];
    const scopedOwnerUserId = getScopedGroupOwnerUserId();
    if (summaryGroups.length) {
        summaryGroups.forEach((groupSummary) => {
            const group = normalizeStoredGroupName(groupSummary?.name);
            if (!group || group.toLowerCase() === ALL_GROUP_ID) return;
            const entryId = buildGroupEntryId(group, scopedOwnerUserId);
            if (!counts.has(entryId)) {
                encountered.push({
                    id: entryId,
                    name: group,
                    ownerUserId: scopedOwnerUserId,
                });
            }
            counts.set(entryId, Number(groupSummary?.count || 0));
        });
    } else {
        for (const item of state.items) {
            const parsedItemGroup = splitLegacyGroupName(item.group);
            const group = normalizeStoredGroupName(parsedItemGroup.name);
            if (!group) continue;
            if (group.toLowerCase() === ALL_GROUP_ID) continue;
            const ownerUserId = item.user_id
                ? String(item.user_id)
                : (parsedItemGroup.ownerUserId || legacyFallbackOwnerId || null);
            const entryId = buildGroupEntryId(group, ownerUserId);
            if (!counts.has(entryId)) {
                encountered.push({
                    id: entryId,
                    name: group,
                    ownerUserId: ownerUserId,
                });
            }
            counts.set(entryId, (counts.get(entryId) || 0) + 1);
        }
    }

    const groups = [];
    const namedGroups = [];
    const seen = new Set();
    const pushUnique = (rawEntry) => {
        const isEntryObject = rawEntry && typeof rawEntry === 'object';
        const parsed = splitLegacyGroupName(isEntryObject ? rawEntry.name : rawEntry);
        const name = normalizeStoredGroupName(parsed.name);
        if (!name || name.toLowerCase() === ALL_GROUP_ID) return;
        const ownerUserId = isEntryObject && rawEntry.ownerUserId
            ? String(rawEntry.ownerUserId)
            : (parsed.ownerUserId || null);
        const id = isEntryObject
            ? normalizeGroupName(rawEntry.id || buildGroupEntryId(name, ownerUserId))
            : normalizeGroupName(name);
        const key = id.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        namedGroups.push({ id, name, ownerUserId });
    };

    // Follow user-defined order first.
    if (isAdminAllUsersMode()) {
        (state.adminUserList || []).forEach((user) => {
            const ownerUserId = String(user.id || user._id || '');
            if (!ownerUserId) return;
            getGroupsFromUserRecord(user).forEach((rawName) => {
                const normalized = normalizeStoredGroupName(rawName);
                pushUnique({
                    id: buildGroupEntryId(normalized, ownerUserId),
                    name: normalized,
                    ownerUserId: ownerUserId,
                });
            });
        });
    } else {
        (state.customGroups || []).forEach((rawName) => {
            const normalized = normalizeStoredGroupName(rawName);
            pushUnique({
                id: buildGroupEntryId(normalized, scopedOwnerUserId),
                name: normalized,
                ownerUserId: scopedOwnerUserId,
            });
        });
    }

    // Then append any groups discovered from data but not explicitly ordered yet.
    encountered.forEach(pushUnique);

    for (const entry of namedGroups) {
        groups.push({
            id: entry.id,
            name: entry.name,
            ownerUserId: entry.ownerUserId,
            displayName: getAdminGroupDisplayName(entry.name, entry.ownerUserId),
            count: counts.get(entry.id) || 0,
        });
    }

    state.groups = groups;
    if (state.activeGroup === ALL_GROUP_ID) {
        state.activeGroup = groups[0]?.id || ALL_GROUP_ID;
        return;
    }

    if (state.groups.some((g) => String(g.id) === String(state.activeGroup))) {
        return;
    }

    const previousName = normalizeGroupName(previousActiveEntry?.name);
    const previousOwner = previousActiveEntry?.ownerUserId ? String(previousActiveEntry.ownerUserId) : null;
    let remapped = null;

    if (previousName) {
        remapped = state.groups.find((g) => {
            if (g.id === ALL_GROUP_ID) return false;
            if (normalizeGroupName(g.name).toLowerCase() !== previousName.toLowerCase()) return false;
            if (previousOwner && g.ownerUserId) {
                return String(g.ownerUserId) === previousOwner;
            }
            return !previousOwner || !g.ownerUserId;
        }) || null;
    }

    state.activeGroup = remapped ? remapped.id : (groups[0]?.id || ALL_GROUP_ID);
}

function getGroupRenderSignature(groups, searchMatchCounts = new Map()) {
    return JSON.stringify({
        activeGroup: normalizeGroupName(state.activeGroup) || ALL_GROUP_ID,
        selectedGroupIds: Array.from(state.selectedGroupIds).sort(),
        renamingGroupId: state.renamingGroupId || '',
        isCreatingGroup: Boolean(state.isCreatingGroup),
        draggingGroupIds: state.draggingGroupIds.slice(),
        dragOverGroupId: state.dragOverGroupId || '',
        dragOverGroupPlacement: state.dragOverGroupPlacement || '',
        groupSearchQuery: state.groupSearchQuery || '',
        searchQuery: state.searchQuery || '',
        groups: groups.map((group) => [
            String(group.id || ''),
            String(group.name || ''),
            String(group.displayName || group.name || ''),
            String(group.ownerUserId || ''),
            Number(group.count || 0),
            Number(searchMatchCounts.get(normalizeStoredGroupName(group.name || group.displayName || '')) || 0),
        ].join('|')),
    });
}

function renderGroups(opts = {}) {
    const container = document.getElementById('group-list');
    if (!container) return;

    const groups = getVisibleSidebarGroups();
    const searchMatchCounts = getSearchMatchGroupCounts();
    const nextSignature = getGroupRenderSignature(groups, searchMatchCounts);
    const hasRenderedContent = container.childElementCount > 0;
    if (!opts.force && hasRenderedContent && nextSignature === state.lastGroupRenderSignature) {
        return;
    }
    state.lastGroupRenderSignature = nextSignature;

    const groupButtons = groups.map((g) => {
        const isActive = g.id === state.activeGroup;
        const isSelected = state.selectedGroupIds.has(g.id);
        const canDelete = canManageGroupEntry(g);
        const isDragging = state.draggingGroupIds.includes(g.id);
        const isDropTarget = state.dragOverGroupId === g.id && !isDragging;
        const isRenaming = Boolean(
            state.renamingGroupId
            && state.renamingGroupId.toLowerCase() === g.id.toLowerCase()
        );
        const normalizedGroupName = normalizeStoredGroupName(g.name || g.displayName || '');
        const hasSearchMatch = g.id !== ALL_GROUP_ID && (searchMatchCounts.get(normalizedGroupName) || 0) > 0;
        const accentStyle = g.id !== ALL_GROUP_ID ? buildGroupAccentStyle(normalizedGroupName) : '';
        return `
            <button
                class="group-item ${canDelete ? 'group-item-has-delete' : ''} ${isSelected ? 'group-item-selected' : ''} ${isDragging ? 'group-item-dragging' : ''} ${isDropTarget ? 'group-item-drop-target' : ''} ${hasSearchMatch ? 'group-item-search-match' : ''} w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${isActive ? 'bg-primary/10 text-white' : 'text-secondary-text hover:text-white hover:bg-white/5'}"
                data-group="${escapeHtml(g.id)}"
                draggable="${canDelete ? 'true' : 'false'}"
                style="${accentStyle}"
            >
                <div class="flex items-center gap-3 min-w-0">
                    <span class="material-icons-round ${isActive ? 'text-primary' : 'text-secondary-text'} text-sm">folder</span>
                    ${isRenaming
                        ? `<input
                            data-role="rename-group-input"
                            data-group-id="${escapeHtml(g.id)}"
                            value="${escapeHtml(g.name)}"
                            class="w-full bg-white/5 border border-primary/50 rounded-lg px-2 py-1 text-[14px] font-semibold text-white focus:outline-none focus:border-primary"
                        >`
                        : `<span class="text-[14px] font-semibold truncate" data-role="group-name" data-group-id="${escapeHtml(g.id)}">${escapeHtml(g.displayName || g.name)}</span>`
                    }
                </div>
                <div class="group-item-actions flex items-center gap-2">
                    ${isRenaming
                        ? `
                            <span
                                class="material-icons-round text-secondary-text hover:text-white text-[18px] cursor-pointer"
                                title="Save group name"
                                data-action="save-rename-group"
                                data-group-id="${escapeHtml(g.id)}"
                                tabindex="0"
                            >check</span>
                            <span
                                class="material-icons-round text-secondary-text hover:text-white text-[18px] cursor-pointer"
                                title="Cancel rename"
                                data-action="cancel-rename-group"
                                data-group-id="${escapeHtml(g.id)}"
                                tabindex="0"
                            >close</span>
                        `
                        : `
                            <span ${g.id === ALL_GROUP_ID ? 'id="group-count-all"' : ''} class="group-count text-xs font-bold ${isActive ? 'bg-primary/20 text-primary' : 'bg-white/10 text-secondary-text'} ${hasSearchMatch ? 'group-count-search-match' : ''} px-2 py-0.5 rounded-full">${g.count}</span>
                            ${canDelete ? `
                            <span
                                class="group-delete-btn material-icons-round"
                                title="${isSelected && state.selectedGroupIds.size > 1 && !state.selectedGroupIds.has(ALL_GROUP_ID) ? 'Delete selected groups' : 'Delete group'}"
                                data-action="delete-group"
                                data-group-id="${escapeHtml(g.id)}"
                            >delete</span>` : ''}
                        `
                    }
                </div>
            </button>
        `;
    }).join('');

    const createBox = state.isCreatingGroup
        ? `
        <div class="mt-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <input data-role="new-group-input" type="text" placeholder="Group name..." class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-secondary-text focus:outline-none focus:border-primary/60">
            <div class="mt-2 flex gap-2">
                <button data-action="create-group" class="flex-1 px-3 py-2 rounded-lg bg-white hover:bg-white/90 text-black text-sm font-semibold">Create</button>
                <button data-action="cancel-create-group" class="flex-1 px-3 py-2 rounded-lg border border-white/20 text-secondary-text hover:text-white text-sm">Cancel</button>
            </div>
        </div>
        `
        : '';

    container.innerHTML = `
        ${groupButtons}
        <button class="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-secondary-text hover:text-primary transition-colors mt-4 cursor-pointer" data-action="new-group">
            <span class="material-icons-round text-sm">add</span>
            <span class="font-medium">New Group</span>
        </button>
        ${createBox}
    `;
}

function populateGroupSelect() {
    var wrap = document.getElementById('modal-group-select-wrap');
    if (!wrap) return;

    var options = [];
    for (var i = 0; i < state.groups.length; i++) {
        var g = state.groups[i];
        if (g.id === ALL_GROUP_ID) continue;
        options.push({value: g.id, label: g.displayName || g.name});
    }

    var selectedValue = null;
    if (state.activeGroup && state.activeGroup !== ALL_GROUP_ID) {
        var hasActive = options.some(function(opt) {
            return String(opt.value) === String(state.activeGroup);
        });
        if (hasActive) selectedValue = state.activeGroup;
    }
    if (!selectedValue && options.length) selectedValue = options[0].value;

    // Check if dropdown already exists
    var existing = document.getElementById('modal-group-select-dropdown');
    if (existing) {
        updateCustomDropdownOptions('modal-group-select-dropdown', options, selectedValue);
    } else {
        var dd = createCustomDropdown({
            id: 'modal-group-select',
            options: options,
            selected: selectedValue,
            cssClass: 'dropdown-modal'
        });
        wrap.innerHTML = '';
        wrap.appendChild(dd);
    }
}

function resolveSelectedGroupContext() {
    var dd = document.getElementById('modal-group-select-dropdown');
    var picked = normalizeGroupName(dd ? dd.getAttribute('data-value') : null);
    var currentUser = getAuthUser();
    var adminTargetUserId = canManageUsers(currentUser) ? getAdminTargetUserId() : null;
    if (!picked || picked.toLowerCase() === GROUP_SELECT_ALL.toLowerCase()) {
        return {
            group: null,
            targetUserId: adminTargetUserId,
        };
    }

    // In admin all-users mode, dropdown values may be composite ids (userId::groupName).
    // Always resolve to the raw group name before sending to backend.
    var resolvedGroup = null;
    var resolvedTargetUserId = adminTargetUserId;
    var entry = getGroupEntryById(picked);
    if (entry && entry.id !== ALL_GROUP_ID) {
        var nameFromEntry = normalizeStoredGroupName(entry.name);
        if (nameFromEntry) resolvedGroup = nameFromEntry;
    }

    if (!resolvedGroup) {
        var parsed = parseGroupEntryId(picked);
        var parsedName = normalizeStoredGroupName(parsed ? parsed.name : '');
        if (parsedName && parsedName.toLowerCase() !== ALL_GROUP_ID) {
            resolvedGroup = parsedName;
        }
    }

    // Fallback for non-composite ids
    if (!resolvedGroup && picked.toLowerCase() !== ALL_GROUP_ID) {
        resolvedGroup = picked;
    }

    return {
        group: resolvedGroup || null,
        targetUserId: canManageUsers(currentUser) ? (resolvedTargetUserId || null) : null,
    };
}

function resolveSelectedGroup() {
    return resolveSelectedGroupContext().group;
}

function getCurrentListScope() {
    const activeEntry = getGroupEntryById(state.activeGroup);
    const currentUser = getAuthUser();
    const activeGroupName = activeEntry && activeEntry.id !== ALL_GROUP_ID
        ? normalizeStoredGroupName(activeEntry.name)
        : null;
    let targetUserId = null;
    if (canManageUsers(currentUser)) {
        targetUserId = getAdminTargetUserId()
            || (activeEntry?.ownerUserId ? String(activeEntry.ownerUserId) : null);
    }
    return {
        activeEntry,
        group: activeGroupName,
        targetUserId,
        items: activeEntry && activeEntry.id !== ALL_GROUP_ID
            ? state.items.filter((item) => doesItemMatchGroupEntry(item, activeEntry))
            : state.items.slice(),
        label: activeEntry && activeEntry.id !== ALL_GROUP_ID
            ? (activeEntry.displayName || activeEntry.name)
            : ALL_GROUP_LABEL,
    };
}

function getBackendListParams() {
    const params = {};
    const currentUser = getAuthUser();
    if (canManageUsers(currentUser)) {
        const targetUserId = getAdminTargetUserId();
        if (targetUserId) params.user_id = targetUserId;
    }
    const activeEntry = getGroupEntryById(state.activeGroup);
    if (activeEntry && activeEntry.id !== ALL_GROUP_ID) {
        const groupName = normalizeStoredGroupName(activeEntry.name);
        if (groupName) params.group = groupName;
    }
    const search = String(state.searchQuery || '').trim();
    if (search) params.search = search;
    if (state.checkedSortMode && state.checkedSortMode !== CHECKED_SORT_MODES.NONE) {
        params.checked_sort = state.checkedSortMode;
    } else if (state.metricSortColumn && METRIC_SORT_CONFIG[state.metricSortColumn]) {
        params.sort = state.metricSortColumn;
        params.sort_direction = state.metricSortDirection === 'asc' ? 'asc' : 'desc';
    } else if (state.textSortColumn && isTextSortColumn(state.textSortColumn)) {
        params.sort = state.textSortColumn;
        params.sort_direction = state.textSortDirection === 'desc' ? 'desc' : 'asc';
    }
    return params;
}

function getBackendListScopeKey(params = getBackendListParams()) {
    return JSON.stringify({
        user_id: params.user_id || '',
        group: params.group || '',
        search: params.search || '',
        type: params.type || '',
        status: params.status || '',
        sort: params.sort || '',
        sort_direction: params.sort_direction || '',
        checked_sort: params.checked_sort || '',
    });
}

function clonePlainObject(value) {
    if (!value || typeof value !== 'object') return value || null;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return { ...value };
    }
}

function trimListScopeCache() {
    while (state.listScopeCache.size > CONFIG.LIST_SCOPE_CACHE_LIMIT) {
        const oldestKey = state.listScopeCache.keys().next().value;
        state.listScopeCache.delete(oldestKey);
    }
}

function saveListScopeCacheEntry(scopeKey, params, entry) {
    if (!scopeKey || !entry) return;
    const virtualItems = Array.isArray(entry.virtualItems)
        ? entry.virtualItems.slice()
        : (Array.isArray(entry.items) ? entry.items.slice() : []);
    const total = Number(entry.total ?? virtualItems.length ?? 0);
    state.listScopeCache.set(scopeKey, {
        params: { ...(params || {}) },
        total,
        virtualItems,
        itemSummary: clonePlainObject(entry.itemSummary),
        loadedPageOffsets: new Set(entry.loadedPageOffsets || []),
        savedAt: Date.now(),
    });
    trimListScopeCache();
}

function saveCurrentListScopeCache() {
    if (!state.listScopeKey || !state.currentListParams) return;
    const hasVirtualList = Array.isArray(state.virtualItems) && state.virtualItems.length > 0;
    const virtualItems = hasVirtualList ? state.virtualItems.slice() : (state.items || []).slice();
    saveListScopeCacheEntry(state.listScopeKey, state.currentListParams, {
        total: Number(state.listTotal || virtualItems.length || 0),
        virtualItems,
        itemSummary: state.itemSummary,
        loadedPageOffsets: state.loadedPageOffsets,
    });
}

function getCachedLoadedItemsForParams(params = {}) {
    const targetUserId = params.user_id ? String(params.user_id) : '';
    const targetGroup = normalizeStoredGroupName(params.group || '');
    const rows = [];
    for (const cached of state.listScopeCache.values()) {
        const cachedParams = cached?.params || {};
        const cachedUserId = cachedParams.user_id ? String(cachedParams.user_id) : '';
        const cachedGroup = normalizeStoredGroupName(cachedParams.group || '');
        if (targetUserId && cachedUserId && targetUserId !== cachedUserId) continue;
        if (!targetUserId && cachedUserId) continue;
        if (cachedGroup && cachedGroup !== targetGroup) continue;
        (cached.virtualItems || []).forEach((item) => {
            if (!item) return;
            if (targetUserId && String(item.user_id || '') !== targetUserId) return;
            if (targetGroup) {
                const groupEntry = getGroupEntryById(state.activeGroup) || { id: targetGroup, name: targetGroup };
                if (!doesItemMatchGroupEntry(item, groupEntry)) return;
            }
            rows.push(item);
        });
    }
    return rows;
}

function seedListScopeCacheFromLoadedItems(params = getBackendListParams()) {
    const scopeKey = getBackendListScopeKey(params);
    if (state.listScopeCache.has(scopeKey)) return true;
    if (params.search || params.sort || params.checked_sort) return false;

    const loadedRows = getCachedLoadedItemsForParams(params);
    if (!loadedRows.length) return false;
    const seen = new Set();
    const uniqueRows = loadedRows.filter((item) => {
        const key = selectionKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const activeEntry = getGroupEntryById(state.activeGroup);
    const expectedGroupCount = params.group && activeEntry ? Number(activeEntry.count || 0) : 0;
    if (expectedGroupCount > 0 && uniqueRows.length < expectedGroupCount) {
        return false;
    }
    const summary = {
        total: uniqueRows.length,
        all_total: state.itemSummary?.all_total ?? uniqueRows.length,
        active: uniqueRows.filter((item) => item.status === 'active').length,
        errors: uniqueRows.filter((item) => item.status === 'error').length,
        crawling: uniqueRows.filter((item) => item.status === 'crawling' || item.status === 'pending').length,
    };
    saveListScopeCacheEntry(scopeKey, params, {
        total: uniqueRows.length,
        virtualItems: uniqueRows,
        itemSummary: summary,
        loadedPageOffsets: uniqueRows.length ? new Set([0]) : new Set(),
    });
    return true;
}

function hydrateListScopeCache(params = getBackendListParams(), opts = {}) {
    const scopeKey = getBackendListScopeKey(params);
    seedListScopeCacheFromLoadedItems(params);
    const cached = state.listScopeCache.get(scopeKey);
    if (!cached) return false;

    state.listTotal = Number(cached.total || 0);
    state.virtualItems = Array.isArray(cached.virtualItems) ? cached.virtualItems.slice() : [];
    state.items = getLoadedVirtualItems();
    state.filteredItems = [];
    state.loadedPageOffsets = new Set(cached.loadedPageOffsets || []);
    state.loadingPageOffsets = new Set();
    state.loadingPagePromises = new Map();
    state.currentListParams = { ...params };
    state.listScopeKey = scopeKey;
    state.itemSummary = clonePlainObject(cached.itemSummary);
    state.lastListRenderSignature = '';
    syncSelectedItemsWithState();
    rebuildGroups();
    updateGroupHeader();
    syncGroupUI(true);
    renderList({
        preserveScroll: Boolean(opts.preserveScroll),
        force: true,
    });
    scheduleWarmCurrentListScope();
    return true;
}

function showInstantListOrLoading(params = getBackendListParams(), opts = {}) {
    if (hydrateListScopeCache(params, opts)) return true;
    if (opts.keepCurrentOnMiss) {
        return false;
    }
    showListLoadingState();
    return false;
}

function getListParamsForGroupEntry(groupEntry) {
    const params = {};
    const currentUser = getAuthUser();
    if (canManageUsers(currentUser)) {
        const targetUserId = getAdminTargetUserId() || (groupEntry?.ownerUserId ? String(groupEntry.ownerUserId) : null);
        if (targetUserId) params.user_id = targetUserId;
    }
    if (groupEntry && groupEntry.id !== ALL_GROUP_ID) {
        const groupName = normalizeStoredGroupName(groupEntry.name);
        if (groupName) params.group = groupName;
    }
    const search = String(state.searchQuery || '').trim();
    if (search) params.search = search;
    if (state.checkedSortMode && state.checkedSortMode !== CHECKED_SORT_MODES.NONE) {
        params.checked_sort = state.checkedSortMode;
    } else if (state.metricSortColumn && METRIC_SORT_CONFIG[state.metricSortColumn]) {
        params.sort = state.metricSortColumn;
        params.sort_direction = state.metricSortDirection === 'asc' ? 'asc' : 'desc';
    } else if (state.textSortColumn && isTextSortColumn(state.textSortColumn)) {
        params.sort = state.textSortColumn;
        params.sort_direction = state.textSortDirection === 'desc' ? 'desc' : 'asc';
    }
    return params;
}

function scheduleSmallGroupPrefetch() {
    if (!getAuthToken()) return;
    if (state.currentView && state.currentView !== 'linkchecker') return;
    if (state.groupPrefetchTimer) window.clearTimeout(state.groupPrefetchTimer);
    state.groupPrefetchTimer = window.setTimeout(() => {
        state.groupPrefetchTimer = null;
        prefetchSmallGroupScopes().catch((err) => {
            console.warn('prefetchSmallGroupScopes error:', err);
        });
    }, CONFIG.SMALL_GROUP_PREFETCH_DELAY);
}

async function prefetchSmallGroupScopes() {
    const candidates = (state.groups || [])
        .filter((group) => group && group.id !== ALL_GROUP_ID)
        .filter((group) => {
            const count = Number(group.count || 0);
            return count > 0 && count <= CONFIG.SMALL_GROUP_PREFETCH_MAX_COUNT;
        })
        .slice(0, CONFIG.SMALL_GROUP_PREFETCH_LIMIT);

    for (const group of candidates) {
        const params = getListParamsForGroupEntry(group);
        const scopeKey = getBackendListScopeKey(params);
        if (state.listScopeCache.has(scopeKey) || state.prefetchedGroupScopeKeys.has(scopeKey)) continue;
        state.prefetchedGroupScopeKeys.add(scopeKey);
        try {
            const pageParams = {
                ...params,
                limit: CONFIG.LIST_PAGE_SIZE,
                offset: 0,
            };
            const [summary, data] = await Promise.all([
                api.getItemsSummary(params),
                api.getItems(pageParams),
            ]);
            const incoming = data?.items || data || [];
            const total = Number(summary?.total ?? data?.total ?? incoming.length);
            const virtualItems = new Array(total);
            incoming.forEach((item, idx) => {
                if (idx < virtualItems.length) virtualItems[idx] = item;
            });
            saveListScopeCacheEntry(scopeKey, params, {
                total,
                virtualItems,
                itemSummary: summary || null,
                loadedPageOffsets: incoming.length ? new Set([0]) : new Set(),
            });
        } catch (err) {
            console.warn('prefetch small group error:', err);
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scheduleWarmCurrentListScope() {
    if (!getAuthToken()) return;
    if (state.currentView && state.currentView !== 'linkchecker') return;
    if (!state.listScopeKey || Number(state.listTotal || 0) <= CONFIG.LIST_PAGE_SIZE) return;
    if (state.listWarmTimer) window.clearTimeout(state.listWarmTimer);
    const token = ++state.listWarmToken;
    state.listWarmTimer = window.setTimeout(() => {
        state.listWarmTimer = null;
        warmCurrentListScopePages(token).catch((err) => {
            console.warn('warmCurrentListScopePages error:', err);
        });
    }, CONFIG.BACKGROUND_PAGE_WARM_DELAY);
}

async function warmCurrentListScopePages(token) {
    const requestId = state.dataLoadRequestId;
    const scopeKey = state.listScopeKey;
    const total = Number(state.listTotal || 0);
    if (!scopeKey || total <= CONFIG.LIST_PAGE_SIZE) return;
    for (let offset = 0; offset < total; offset += CONFIG.LIST_PAGE_SIZE) {
        if (token !== state.listWarmToken || requestId !== state.dataLoadRequestId || scopeKey !== state.listScopeKey) return;
        if (!state.loadedPageOffsets.has(offset)) {
            await loadVirtualPage(offset, {
                requestId,
                preserveScroll: true,
                force: false,
                silent: true,
            });
            await sleep(CONFIG.BACKGROUND_PAGE_WARM_PAUSE);
        }
    }
    if (token === state.listWarmToken && requestId === state.dataLoadRequestId && scopeKey === state.listScopeKey) {
        renderList({ preserveScroll: true });
    }
}

function handleGroupSelection(groupId, event) {
    const normalizedGroupId = normalizeGroupName(groupId) || ALL_GROUP_ID;
    state.selectionScope = 'groups';
    const visibleGroups = getVisibleSidebarGroups();
    const visibleIds = visibleGroups.map((group) => group.id);
    const anchorId = state.groupSelectionAnchorId && visibleIds.includes(state.groupSelectionAnchorId)
        ? state.groupSelectionAnchorId
        : normalizedGroupId;

    if (normalizedGroupId.toLowerCase() === ALL_GROUP_ID) {
        return;
    }

    if (event?.shiftKey && visibleIds.includes(anchorId) && visibleIds.includes(normalizedGroupId)) {
        const start = visibleIds.indexOf(anchorId);
        const end = visibleIds.indexOf(normalizedGroupId);
        const from = Math.min(start, end);
        const to = Math.max(start, end);
        state.selectedGroupIds = new Set(visibleIds.slice(from, to + 1));
    } else if (event?.ctrlKey || event?.metaKey) {
        const next = new Set(state.selectedGroupIds);
        next.delete(ALL_GROUP_ID);
        if (next.has(normalizedGroupId)) next.delete(normalizedGroupId);
        else next.add(normalizedGroupId);
        state.selectedGroupIds = next;
    } else {
        state.selectedGroupIds = new Set([normalizedGroupId]);
    }

    state.groupSelectionAnchorId = normalizedGroupId;
    if (!state.selectedGroupIds.size) {
        state.selectedGroupIds = new Set([normalizedGroupId]);
    }
    state.activeGroup = normalizedGroupId;
}

async function handleDeleteGroups(groupIds, opts = {}) {
    const normalizedIds = Array.from(new Set((groupIds || [])
        .map((groupId) => normalizeGroupName(groupId))
        .filter(Boolean)))
        .filter((groupId) => groupId.toLowerCase() !== ALL_GROUP_ID);
    if (!normalizedIds.length) return;

    const targets = normalizedIds
        .map((groupId) => state.groups.find((group) => String(group.id).toLowerCase() === String(groupId).toLowerCase()))
        .filter(Boolean)
        .filter((group) => canManageGroupEntry(group));
    if (!targets.length) return;
    if (targets.some((target) => target.name === RECOVERY_GROUP_LABEL && Number(target.count) > 0)) {
        showToast('Move or delete links in Ungrouped before deleting this group', 'info');
        return;
    }

    const confirmed = opts.confirm === false
        ? true
        : window.confirm(
            targets.length > 1
                ? `Delete ${targets.length} selected groups?\nTheir links will move to Ungrouped.`
                : `Delete group "${targets[0].name}"?\nIts links will move to Ungrouped.`
        );
    if (!confirmed) return;

    for (const target of targets) {
        const groupId = normalizeGroupName(target.id);
        const groupName = target.name || groupId;
        const parsedEntry = parseGroupEntryId(groupId);
        const ownerUserId = target?.ownerUserId
            ? String(target.ownerUserId)
            : (parsedEntry?.ownerUserId ? String(parsedEntry.ownerUserId) : getScopedGroupOwnerUserId());
        const groupNameVariants = buildGroupNameVariants(target?.name || groupId, ownerUserId);
        const groupKey = normalizeStoredGroupName(target?.name || groupId).toLowerCase();
        const nextGroups = getOwnerCustomGroups(ownerUserId).filter((name) => {
            const normalized = normalizeStoredGroupName(name).toLowerCase();
            if (!normalized) return false;
            if (normalized === groupKey) return false;
            return !groupNameMatchesVariants(name, groupNameVariants);
        });

        if (isAdminAllUsersMode() && ownerUserId) {
            setOwnerCustomGroups(ownerUserId, nextGroups);
            await saveGroupsToServer(nextGroups, ownerUserId);
        } else {
            state.customGroups = nextGroups;
            saveCustomGroups();
        }

        state.items = state.items.map((item) => {
            const itemGroup = normalizeStoredGroupName(item.group);
            if (!itemGroup) return item;
            if (itemGroup.toLowerCase() !== groupKey && !groupNameMatchesVariants(item.group, groupNameVariants)) return item;
            if (target?.ownerUserId && !isItemOwnedByUser(item, target.ownerUserId)) return item;
            return { ...item, group: RECOVERY_GROUP_LABEL };
        });

        await syncGroupItemsToServer(target?.name || groupName, RECOVERY_GROUP_LABEL, ownerUserId || null, groupNameVariants);
    }

    const deletedIdSet = new Set(targets.map((target) => String(target.id)));
    state.selectedGroupIds = new Set(
        Array.from(state.selectedGroupIds).filter((groupId) => !deletedIdSet.has(String(groupId)))
    );
    if (deletedIdSet.has(String(state.activeGroup))) {
        state.activeGroup = ALL_GROUP_ID;
    }
    if (state.renamingGroupId && deletedIdSet.has(String(state.renamingGroupId))) {
        state.renamingGroupId = null;
    }
    state.isCreatingGroup = false;
    state.itemSummary = null;
    syncGroupUI(true);
    await loadData({ preserveScroll: true, force: true });
    showToast(
        targets.length > 1
            ? `Deleted ${targets.length} groups`
            : `Deleted group: ${targets[0].name}`,
        'success'
    );
}

async function moveCustomGroupsBefore(draggedGroupIds, targetGroupId, placement = 'before') {
    const draggedIds = Array.from(new Set((Array.isArray(draggedGroupIds) ? draggedGroupIds : [draggedGroupIds])
        .map((groupId) => normalizeGroupName(groupId))
        .filter(Boolean)))
        .filter((groupId) => groupId.toLowerCase() !== ALL_GROUP_ID);
    const target = normalizeGroupName(targetGroupId);
    if (!draggedIds.length || !target || target.toLowerCase() === ALL_GROUP_ID) return false;
    if (draggedIds.includes(target)) return false;

    const draggedEntries = draggedIds
        .map((groupId) => getGroupEntryById(groupId) || parseGroupEntryId(groupId))
        .filter(Boolean);
    const targetEntry = getGroupEntryById(target) || parseGroupEntryId(target);
    if (!draggedEntries.length || !targetEntry) return false;

    const ownerIds = Array.from(new Set(draggedEntries.map((entry) => String(entry.ownerUserId || ''))));
    const targetOwnerId = String(targetEntry.ownerUserId || '');
    if (ownerIds.length !== 1 || ownerIds[0] !== targetOwnerId) {
        showToast('Only groups from the same owner can be moved together', 'info');
        return false;
    }

    const ownerUserId = ownerIds[0] || null;
    const current = Array.from(new Set(getOwnerCustomGroups(ownerUserId).map(normalizeStoredGroupName).filter(Boolean)));
    const targetGroupName = normalizeStoredGroupName(targetEntry.name || target);
    const draggedNames = draggedEntries
        .map((entry) => normalizeStoredGroupName(entry.name || entry.id))
        .filter(Boolean);
    if (!targetGroupName || !draggedNames.length) return false;

    const draggedNameSet = new Set(draggedNames.map((name) => name.toLowerCase()));
    const remaining = current.filter((name) => !draggedNameSet.has(name.toLowerCase()));
    const targetIndex = remaining.findIndex((name) => name.toLowerCase() === targetGroupName.toLowerCase());
    if (targetIndex === -1) return false;
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    remaining.splice(insertIndex, 0, ...draggedNames);

    if (isAdminAllUsersMode() && ownerUserId) {
        setOwnerCustomGroups(ownerUserId, remaining);
        await saveGroupsToServer(remaining, ownerUserId);
    } else {
        state.customGroups = remaining;
        saveCustomGroups();
    }

    state.selectedGroupIds = new Set(draggedIds);
    syncGroupUI(true);
    return true;
}

function handleCreateGroup(rawName) {
    const name = normalizeGroupName(rawName);
    if (!name) return;
    if (name.toLowerCase() === ALL_GROUP_ID) {
        showToast('"All Links" is reserved', 'error');
        return;
    }

    const scopedOwnerUserId = getScopedGroupOwnerUserId();
    const existing = state.groups.find((g) => (
        normalizeGroupName(g.name).toLowerCase() === name.toLowerCase()
        && String(g.ownerUserId || scopedOwnerUserId || '') === String(scopedOwnerUserId || '')
    ));
    if (existing) {
        state.activeGroup = existing.id;
        state.isCreatingGroup = false;
        state.renamingGroupId = null;
        updateGroupHeader();
        renderGroups();
        renderList();
        populateGroupSelect();
        showToast(`Switched to group: ${existing.name}`, 'info');
        resetVirtualList(0, getBackendListParams());
        renderList({ force: true });
        loadData({ force: true });
        return;
    }

    state.customGroups.push(name);
    saveCustomGroups();
    state.activeGroup = buildGroupEntryId(name, scopedOwnerUserId);
    state.isCreatingGroup = false;
    state.renamingGroupId = null;
    rebuildGroups();
    updateGroupHeader();
    renderGroups();
    renderList();
    populateGroupSelect();
    showToast(`Created group: ${name}`, 'success');
    resetVirtualList(0, getBackendListParams());
    renderList({ force: true });
    loadData({ force: true });
}

async function handleDeleteGroup(rawGroupId) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;
    const selected = state.selectedGroupIds.has(groupId)
        ? Array.from(state.selectedGroupIds).filter((id) => String(id).toLowerCase() !== ALL_GROUP_ID)
        : [groupId];
    await handleDeleteGroups(selected);
}

function startCreateGroupFlow() {
    state.isCreatingGroup = true;
    state.renamingGroupId = null;
    renderGroups();
    setTimeout(() => {
        const input = document.querySelector('#group-list [data-role="new-group-input"]');
        if (input) input.focus();
    }, 0);
}

function cancelCreateGroupFlow() {
    state.isCreatingGroup = false;
    renderGroups();
}

function startRenameGroupFlow(rawGroupId) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;

    const target = state.groups.find((g) => normalizeGroupName(g.id).toLowerCase() === groupId.toLowerCase());
    if (!target) return;
    if (!canManageGroupEntry(target)) {
        showToast('You can only rename your own groups', 'info');
        return;
    }

    state.isCreatingGroup = false;
    state.renamingGroupId = target.id;
    renderGroups();
    setTimeout(() => {
        const input = document.querySelector('#group-list [data-role="rename-group-input"]');
        if (!input) return;
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
    }, 0);
}

function cancelRenameGroupFlow() {
    if (!state.renamingGroupId) return;
    state.renamingGroupId = null;
    renderGroups();
}

async function syncGroupItemsToServer(oldName, newName, ownerUserId = null, oldNameVariants = null) {
    const oldGroup = normalizeGroupName(oldName);
    if (!oldGroup) return Promise.resolve();
    const nextGroup = normalizeGroupName(newName);
    const targetUserId = getScopedGroupOwnerUserId();
    if (ownerUserId && String(ownerUserId) !== targetUserId) return;
    const candidates = Array.from(new Set([
        oldGroup,
        ...((Array.isArray(oldNameVariants) ? oldNameVariants : []).map((v) => normalizeGroupName(v)).filter(Boolean)),
    ]));
    let lastErr = null;
    for (const candidate of candidates) {
        try {
            await api.renameGroup(candidate, nextGroup, targetUserId);
        } catch (err) {
            lastErr = err;
            console.warn('[Group Sync] Failed for candidate:', candidate, err.message);
        }
    }
    if (lastErr) {
        showToast(`Saved locally, server sync failed: ${lastErr.message}`, 'info');
    }
}

function handleRenameGroup(rawGroupId, rawName, opts = {}) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;

    const target = state.groups.find((g) => normalizeGroupName(g.id).toLowerCase() === groupId.toLowerCase());
    if (!target) {
        state.renamingGroupId = null;
        renderGroups();
        return;
    }
    if (!canManageGroupEntry(target)) {
        showToast('You can only rename your own groups', 'info');
        state.renamingGroupId = null;
        renderGroups();
        return;
    }

    const nextName = normalizeGroupName(rawName);
    if (!nextName) {
        if (opts.onBlur) {
            cancelRenameGroupFlow();
        } else {
            showToast('Group name cannot be empty', 'error');
        }
        return;
    }
    if (nextName.toLowerCase() === ALL_GROUP_ID) {
        showToast('"All Links" is reserved', 'error');
        return;
    }

    const oldKey = normalizeStoredGroupName(target.name).toLowerCase();
    const sameByCaseInsensitive = nextName.toLowerCase() === oldKey;
    const duplicate = state.groups.find((g) => (
        normalizeGroupName(g.name).toLowerCase() === nextName.toLowerCase()
        && String(g.ownerUserId || '') === String(target.ownerUserId || '')
        && normalizeGroupName(g.name).toLowerCase() !== oldKey
    ));
    if (duplicate) {
        showToast(`Group "${duplicate.name}" already exists`, 'error');
        return;
    }

    if (!sameByCaseInsensitive || nextName !== target.name) {
        const oldName = target.name;
        const ownerUserId = target?.ownerUserId ? String(target.ownerUserId) : getScopedGroupOwnerUserId();
        const renamedGroups = getOwnerCustomGroups(ownerUserId).map((raw) => {
            const n = normalizeStoredGroupName(raw);
            if (n.toLowerCase() !== oldKey) return n;
            return nextName;
        });
        if (isAdminAllUsersMode() && ownerUserId) {
            setOwnerCustomGroups(ownerUserId, renamedGroups);
            saveGroupsToServer(renamedGroups, ownerUserId);
        } else {
            state.customGroups = renamedGroups;
            saveCustomGroups();
        }

        state.items = state.items.map((item) => {
            const itemGroup = normalizeStoredGroupName(item.group);
            if (itemGroup.toLowerCase() !== oldKey) return item;
            if (target?.ownerUserId && !isItemOwnedByUser(item, target.ownerUserId)) return item;
            return { ...item, group: nextName };
        });

        if (normalizeGroupName(state.activeGroup).toLowerCase() === normalizeGroupName(target.id).toLowerCase()) {
            state.activeGroup = buildGroupEntryId(nextName, target.ownerUserId || null);
        }
        syncGroupItemsToServer(oldName, nextName, ownerUserId || null);
    }

    state.renamingGroupId = null;
    syncGroupUI(true);
    renderList({ preserveScroll: true });
    if (!sameByCaseInsensitive || nextName !== target.name) {
        showToast(`Renamed group: ${target.name} â†’ ${nextName}`, 'success');
    }
}

function syncGroupUI(syncSelect = false) {
    rebuildGroups();
    syncSelectedGroupsWithState();
    renderGroups();
    updateGroupHeader();
    updateAddLinkAvailability();
    if (syncSelect) populateGroupSelect();
}

/** Get badge class based on item type */
function getBadgeClass(type) {
    const map = { playlist: 'badge-playlist', track: 'badge-track', album: 'badge-album', artist: 'badge-artist' };
    return map[type] || 'badge-error';
}

/** Get dynamic metric labels based on item type */
function getMetricLabels(type) {
    switch (type) {
        case 'artist':   return { metric1: 'Monthly Listeners', metric2: 'Followers' };
        case 'track':    return { metric1: 'Monthly Plays',     metric2: 'Total Plays' };
        case 'album':    return { metric1: '-',                 metric2: 'Total Plays' };
        case 'playlist': return { metric1: 'Followers',         metric2: 'Total Plays' };
        default:         return { metric1: 'Metric 1',          metric2: 'Metric 2' };
    }
}

function getReleaseYear(item) {
    const candidates = [
        item?.release_year,
        item?.release_date,
        item?.album_release_date,
        item?.year,
    ];
    for (const value of candidates) {
        if (value == null) continue;
        const s = String(value).trim();
        if (!s) continue;
        const m = s.match(/\b(19|20)\d{2}\b/);
        if (m) return m[0];
    }
    return '-';
}

/** Get stat icons based on type */
function getStatIcons(item) {
    switch (item.type) {
        case 'playlist':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">favorite_border</span>
                    <span class="list-stat-value">${formatNumber(item.followers || item.saves)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">music_note</span>
                    <span class="list-stat-value">${formatNumber(item.track_count)}</span>
                </div>`;
        case 'track':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">schedule</span>
                    <span class="list-stat-value">${item.duration || '-'}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">calendar_today</span>
                    <span class="list-stat-value">${getReleaseYear(item)}</span>
                </div>`;
        case 'album':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">music_note</span>
                    <span class="list-stat-value">${formatNumber(item.track_count)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">calendar_today</span>
                    <span class="list-stat-value">${getReleaseYear(item)}</span>
                </div>`;
        case 'artist':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">people</span>
                    <span class="list-stat-value">${formatNumber(item.followers)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">library_music</span>
                    <span class="list-stat-value">${formatNumber(item.album_count)} albums</span>
                </div>`;
        default:
            return '';
    }
}

/** Get metric 1 value (context-aware) */
function getMetric1(item) {
    switch (item.type) {
        case 'artist':   return formatDetailedMetric(item.monthly_listeners);
        case 'track':    return formatDetailedMetric(item.monthly_plays);
        case 'playlist': return formatDetailedMetric(item.followers || item.saves);
        case 'album':    return '-';
        default:         return '-';
    }
}

/** Get metric 2 value (context-aware) */
function getMetric2(item) {
    switch (item.type) {
        case 'artist':   return formatDetailedMetric(item.total_plays);
        case 'track':    return formatDetailedMetric(item.playcount);
        case 'playlist': return formatDetailedMetric(item.total_plays);
        case 'album':    return formatDetailedMetric(item.total_plays);
        default:         return '-';
    }
}

/** Get status info */
function getStatusInfo(item) {
    const statusMap = {
        active:   { dot: 'active',   label: 'Active',   color: 'text-primary' },
        error:    { dot: 'error',    label: `Error (${item.error_code || '?'})`, color: 'text-red-500' },
        pending:  { dot: 'pending',  label: 'Pending',  color: 'text-yellow-500' },
        crawling: { dot: 'crawling', label: 'Crawling...', color: 'text-blue-400' },
    };
    return statusMap[item.status] || statusMap.pending;
}

function normalizeJobResult(result, fallback = {}) {
    const resultObj = result || {};
    const merged = { ...fallback, ...resultObj };
    const has = (key) => Object.prototype.hasOwnProperty.call(resultObj, key);
    const keepFallbackWhenEmpty = (incoming, current) => {
        if (incoming === null || incoming === undefined) return current;
        if (typeof incoming === 'string' && !incoming.trim()) return current;
        return incoming;
    };

    let monthly = fallback.monthly_plays ?? fallback.monthly_listeners ?? null;
    if (has('monthly_plays')) monthly = keepFallbackWhenEmpty(resultObj.monthly_plays, monthly);
    else if (has('monthly_listeners')) monthly = keepFallbackWhenEmpty(resultObj.monthly_listeners, monthly);

    let total = fallback.total_plays ?? fallback.playcount ?? null;
    if (has('total_plays')) total = keepFallbackWhenEmpty(resultObj.total_plays, total);
    else if (has('playcount')) total = keepFallbackWhenEmpty(resultObj.playcount, total);

    let playcount = fallback.playcount ?? fallback.total_plays ?? null;
    if (has('playcount')) playcount = keepFallbackWhenEmpty(resultObj.playcount, playcount);
    else if (has('total_plays')) playcount = keepFallbackWhenEmpty(resultObj.total_plays, playcount);

    let duration = fallback.duration ?? null;
    if (has('duration')) {
        duration = keepFallbackWhenEmpty(resultObj.duration, duration);
    } else if (has('duration_ms')) {
        duration = keepFallbackWhenEmpty(formatDurationFromMs(resultObj.duration_ms), duration);
    } else if (merged.duration_ms != null) {
        duration = keepFallbackWhenEmpty(formatDurationFromMs(merged.duration_ms), duration);
    }

    return {
        ...fallback,
        ...resultObj,
        spotify_id: merged.spotify_id || fallback.spotify_id,
        type: merged.type || fallback.type,
        monthly_plays: monthly,
        monthly_listeners: merged.monthly_listeners ?? monthly,
        total_plays: total,
        playcount: playcount,
        duration: duration,
        saves: merged.saves ?? merged.followers ?? fallback.saves ?? fallback.followers ?? null,
        last_checked: new Date().toISOString(),
    };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ROW RENDERER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function renderRow(item, rowIndex = 0) {
    const status = getStatusInfo(item);
    const isError = item.status === 'error';
    const spotifyUrl = item.spotify_url || getSpotifyUrl(item.type, item.spotify_id);
    const ownerUrl = item.owner_url || spotifyUrl;
    const coverUrl = item.image || `https://picsum.photos/seed/${item.spotify_id}/128/128`;
    const checkedAt = item.last_checked || item.created_at || '';
    const updatedAt = formatUpdatedAt(checkedAt);
    const key = itemKey(item);
    const rowSelectionKey = selectionKey(item);
    const isSelected = state.selectedItemKeys.has(rowSelectionKey);
    const isDragging = state.draggingRowKeys.includes(rowSelectionKey);
    const isDropTarget = state.dragOverRowKey === rowSelectionKey && !isDragging;

    const isDropBefore = isDropTarget && state.dragOverRowPlacement !== 'after';
    const isDropAfter = isDropTarget && state.dragOverRowPlacement === 'after';
    const excel = getExcelColumnValues(item);
    const subtitle = getItemSubtitle(item);
    const titleToneClass = isError ? 'list-asset-title-muted' : getTitleToneClass(item.type);
    const ownerUpdatedCell = renderOwnerUpdatedCell(item, ownerUrl, updatedAt);
    const displayTitle = getDisplayTitle(item);
    const sttValue = Number.isFinite(rowIndex) ? rowIndex + 1 : '';
    const sttLabel = sttValue ? String(sttValue) : '';
    const groupName = normalizeStoredGroupName(item.group);
    const hasSearchGroupAccent = isSearchGroupAccentMode() && Boolean(groupName);

    const row = document.createElement('div');
    row.className = `custom-grid-row px-4 py-3 bg-white/5 rounded-lg border border-transparent transition-colors group ${isSelected ? 'row-selected' : ''} ${isDragging ? 'row-dragging' : ''} ${isDropTarget ? 'row-drop-target' : ''} ${isDropBefore ? 'row-drop-before' : ''} ${isDropAfter ? 'row-drop-after' : ''} ${hasSearchGroupAccent ? 'row-group-search-match' : ''}`;
    if (hasSearchGroupAccent) {
        row.style.cssText = buildGroupAccentStyle(groupName);
    }
    row.dataset.itemId = item.id;
    row.dataset.type = item.type;
    row.dataset.spotifyId = item.spotify_id;
    row.dataset.userId = item.user_id ? String(item.user_id) : '';
    row.dataset.itemKey = key;
    row.dataset.selectionKey = rowSelectionKey;
    row.draggable = true;

    row.innerHTML = `
        <div class="meta-cell stt-cell text-secondary-text" data-col-key="stt">${escapeHtml(sttLabel)}</div>
        <!-- Left: Asset Details -->
        <div class="list-asset-cell flex items-center gap-4">
            <button type="button" class="list-cover-trigger" data-action="preview-image" data-image-url="${escapeHtml(coverUrl)}" aria-label="Preview cover image">
                <img alt="Cover" class="list-cover-image" src="${coverUrl}">
            </button>
            <div>
                <span class="list-type-badge ${isError ? 'badge-error' : getBadgeClass(item.type)}">${item.type}</span>
                <h3 class="list-asset-title ${titleToneClass}">
                    <a class="list-title-link" href="${spotifyUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayTitle)}</a>
                </h3>
                <div class="list-asset-meta">
                    <p class="list-asset-uri text-secondary-text">spotify:${item.type}:${item.spotify_id}</p>
                    <button type="button" class="list-copy-btn" data-action="copy-link" data-copy-value="${spotifyUrl}" aria-label="Copy Spotify link">
                        <span class="material-icons-round">content_copy</span>
                        <span>Copy</span>
                    </button>
                </div>
                ${isError
                    ? `<p class="list-asset-error text-red-400 font-medium flex items-center gap-1"><span class="material-icons-round list-error-icon">warning</span> Error ${item.error_code}: ${item.error_message || 'Unknown error'}</p>`
                    : ``
                }
                ${subtitle ? `<p class="list-asset-subtitle text-secondary-text">${escapeHtml(subtitle)}</p>` : ``}
            </div>
        </div>
        <!-- Right: Metadata -->
        <div class="meta-grid w-full">
            ${ownerUpdatedCell}
            ${renderPlaylistOwnerCell(item)}
            <div class="meta-cell">${renderMetricCell(excel.playlistSaves, excel.playlistSavesDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.playlistTrackCount, excel.playlistTrackCountDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.albumTrackCount, excel.albumTrackCountDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.artistFollowers, excel.artistFollowersDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.artistListeners, excel.artistListenersDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.trackViews, excel.trackViewsDelta, excel.deltaDays)}</div>
            <div class="meta-cell text-right row-action-cell">
                <div class="checked-stack">
                    <span class="list-checked-text text-secondary-text row-checked" data-checked-at="${escapeHtml(checkedAt)}">${timeAgo(checkedAt)}</span>
                    <span class="checked-status ${status.color}">
                        <span class="status-dot ${status.dot}"></span>
                        <span class="truncate">${status.label}</span>
                    </span>
                </div>
            </div>
        </div>
    `;

    return row;
}

function setupColumnResizers() {
    const handles = document.querySelectorAll('.column-resize-handle[data-col-key]');
    if (!handles.length) return;

    handles.forEach((handle) => {
        if (handle.dataset.bound === 'true') return;
        handle.dataset.bound = 'true';

        handle.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = handle.dataset.colKey;
            if (!key || !(key in DEFAULT_COLUMN_WIDTHS)) return;
            setColumnWidth(key, DEFAULT_COLUMN_WIDTHS[key], true);
        });

        handle.addEventListener('pointerdown', (event) => {
            const key = handle.dataset.colKey;
            if (!key || !(key in DEFAULT_COLUMN_WIDTHS)) return;
            const resizeEdge = handle.dataset.resizeEdge === 'start' ? 'start' : 'end';

            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startWidth = clampColumnWidth(key, state.columnWidths[key]);
            document.body.classList.add('column-resizing');

            const onMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const nextWidth = resizeEdge === 'start'
                    ? startWidth - delta
                    : startWidth + delta;
                setColumnWidth(key, nextWidth, false, resizeEdge);
            };

            const onUp = () => {
                document.body.classList.remove('column-resizing');
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                savePersistedColumnWidths(state.columnWidths);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    });
}

function isMetricSortColumn(colKey) {
    return Boolean(colKey && METRIC_SORT_CONFIG[colKey]);
}

function getMetricSortModeLabel(colKey) {
    if (state.metricSortColumn === colKey) {
        return state.metricSortMode === 'delta' ? 'Biến động' : 'Số lượng';
    }
    return 'None';
}

function updateMetricSortControlsUI() {
    const controls = document.querySelectorAll('.metric-sort-controls[data-sort-col]');
    controls.forEach((control) => {
        const colKey = control.dataset.sortCol;
        if (!isMetricSortColumn(colKey)) return;
        const modeToggle = control.querySelector('[data-sort-menu-toggle]');
        const dirToggle = control.querySelector('[data-sort-direction-toggle]');
        const menu = control.querySelector('[data-sort-menu]');
        const active = state.metricSortColumn === colKey;
        const mode = active ? state.metricSortMode : 'value';
        const direction = active ? state.metricSortDirection : null;

        if (modeToggle) {
            modeToggle.classList.toggle('is-active', active);
            modeToggle.setAttribute('title', active ? `Đang lọc: ${getMetricSortModeLabel(colKey)}` : 'Chọn kiểu lọc');
        }

        if (dirToggle) {
            const icon = dirToggle.querySelector('.metric-sort-direction-icon');
            if (icon) {
                icon.textContent = active
                    ? (direction === 'asc' ? 'arrow_upward' : 'arrow_downward')
                    : 'swap_vert';
            }
            dirToggle.classList.toggle('is-active', active);
            dirToggle.setAttribute('title', active
                ? (direction === 'asc' ? 'Đang tăng dần' : 'Đang giảm dần')
                : 'Đổi chiều sắp xếp');
        }

        if (menu) {
            const open = state.metricSortMenuOpenKey === colKey;
            menu.classList.toggle('open', open);
            menu.querySelectorAll('[data-sort-mode-option]').forEach((btn) => {
                const optionMode = btn.getAttribute('data-sort-mode-option');
                const isNoneMode = optionMode === 'none';
                const isNoneActive = isNoneMode && !state.metricSortColumn;
                btn.classList.toggle('is-active', isNoneActive || (active && optionMode === mode));
            });
        }
    });
}

function updateTextSortControlsUI() {
    const controls = document.querySelectorAll('.text-sort-controls[data-text-sort-col]');
    controls.forEach((control) => {
        const colKey = control.dataset.textSortCol;
        const toggle = control.querySelector('[data-text-sort-menu-toggle]');
        const dirToggle = control.querySelector('[data-text-sort-direction-toggle]');
        const menu = control.querySelector('[data-text-sort-menu]');
        const active = state.textSortColumn === colKey;
        if (!toggle) return;
        toggle.classList.toggle('is-active', active);
        toggle.setAttribute(
            'title',
            active
                ? (state.textSortDirection === 'asc' ? 'Playlist Owner A-Z' : 'Playlist Owner Z-A')
                : 'Sort Playlist Owner A-Z'
        );
        if (dirToggle) {
            const icon = dirToggle.querySelector('.metric-sort-direction-icon');
            if (icon) {
                icon.textContent = active
                    ? (state.textSortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward')
                    : 'swap_vert';
            }
            dirToggle.classList.toggle('is-active', active);
            dirToggle.setAttribute(
                'title',
                active
                    ? (state.textSortDirection === 'asc' ? 'Đang A-Z' : 'Đang Z-A')
                    : 'Đổi chiều sắp xếp Playlist Owner'
            );
        }
        if (menu) {
            menu.classList.toggle('open', state.textSortMenuOpenKey === colKey);
            menu.querySelectorAll('[data-text-sort-option]').forEach((btn) => {
                const option = btn.getAttribute('data-text-sort-option');
                const isActive = option === 'none'
                    ? !active
                    : (active && option === state.textSortDirection);
                btn.classList.toggle('is-active', isActive);
            });
        }
    });
}

function closeMetricSortMenu() {
    if (!state.metricSortMenuOpenKey) return;
    state.metricSortMenuOpenKey = null;
    updateMetricSortControlsUI();
}

function closeTextSortMenu() {
    if (!state.textSortMenuOpenKey) return;
    state.textSortMenuOpenKey = null;
    updateTextSortControlsUI();
}

function closeCheckedSortMenu() {
    if (!state.checkedSortMenuOpen) return;
    state.checkedSortMenuOpen = false;
    updateCheckedSortControlsUI();
}

function positionCheckedSortMenu(control) {
    if (!control) return;
    const menu = control.querySelector('[data-checked-sort-menu]');
    if (!menu) return;

    control.classList.remove('menu-align-right');
    if (!state.checkedSortMenuOpen) return;

    const viewportPadding = 12;
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > (window.innerWidth - viewportPadding)) {
        control.classList.add('menu-align-right');
    }

    const alignedRect = menu.getBoundingClientRect();
    if (alignedRect.left < viewportPadding && control.classList.contains('menu-align-right')) {
        control.classList.remove('menu-align-right');
    }
}

function updateCheckedSortControlsUI() {
    const control = document.querySelector('.checked-sort-controls[data-checked-sort-col="checked"]');
    if (!control) return;
    const toggle = control.querySelector('[data-checked-sort-menu-toggle]');
    const menu = control.querySelector('[data-checked-sort-menu]');
    const active = state.checkedSortMode !== CHECKED_SORT_MODES.NONE;
    if (toggle) {
        toggle.classList.toggle('is-active', active);
        toggle.setAttribute(
            'title',
            active
                ? `Đang lọc: ${getCheckedSortModeLabel(state.checkedSortMode)}`
                : 'Chọn kiểu lọc Checked'
        );
    }
    if (menu) {
        menu.classList.toggle('open', state.checkedSortMenuOpen);
        menu.querySelectorAll('[data-checked-sort-option]').forEach((btn) => {
            const option = btn.getAttribute('data-checked-sort-option') || CHECKED_SORT_MODES.NONE;
            const isActive = option === state.checkedSortMode;
            btn.classList.toggle('is-active', isActive);
        });
    }
    positionCheckedSortMenu(control);
}

function ensureCheckedSortControls() {
    const cell = document.querySelector('.list-head .head-cell[data-col-key="checked"]');
    if (cell && !cell.querySelector('.checked-sort-controls')) {
        const controls = document.createElement('div');
        controls.className = 'metric-sort-controls checked-sort-controls';
        controls.dataset.checkedSortCol = 'checked';
        controls.innerHTML = `
            <button type="button" class="metric-sort-mode-toggle" data-checked-sort-menu-toggle aria-label="Chọn kiểu lọc Checked">
                <span class="metric-sort-triangle">▼</span>
            </button>
            <div class="metric-sort-menu" data-checked-sort-menu>
                <button type="button" class="metric-sort-menu-item" data-checked-sort-option="${CHECKED_SORT_MODES.NONE}">
                    <span class="metric-sort-menu-title">None (Mặc định)</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-checked-sort-option="${CHECKED_SORT_MODES.ERROR_FIRST}">
                    <span class="metric-sort-menu-title">Error First</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-checked-sort-option="${CHECKED_SORT_MODES.CRAWLING_FIRST}">
                    <span class="metric-sort-menu-title">Crawling First</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-checked-sort-option="${CHECKED_SORT_MODES.ACTIVE_FIRST}">
                    <span class="metric-sort-menu-title">Active First</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-checked-sort-option="${CHECKED_SORT_MODES.RECENT_FIRST}">
                    <span class="metric-sort-menu-title">Newest Check</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-checked-sort-option="${CHECKED_SORT_MODES.OLDEST_FIRST}">
                    <span class="metric-sort-menu-title">Oldest Check</span>
                </button>
            </div>
        `;
        cell.appendChild(controls);
    }

    const head = document.querySelector('.list-head');
    if (head && head.dataset.checkedSortBound !== 'true') {
        head.dataset.checkedSortBound = 'true';
        head.addEventListener('click', (event) => {
            const control = event.target.closest('.checked-sort-controls[data-checked-sort-col="checked"]');
            if (!control) return;
            const menuToggle = event.target.closest('[data-checked-sort-menu-toggle]');
            const option = event.target.closest('[data-checked-sort-option]');

            if (menuToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeMetricSortMenu();
                closeTextSortMenu();
                state.checkedSortMenuOpen = !state.checkedSortMenuOpen;
                updateCheckedSortControlsUI();
                return;
            }

            if (option) {
                event.preventDefault();
                event.stopPropagation();
                const mode = option.getAttribute('data-checked-sort-option') || CHECKED_SORT_MODES.NONE;
                state.checkedSortMode = mode;
                state.checkedSortMenuOpen = false;
                state.metricSortColumn = null;
                state.metricSortMenuOpenKey = null;
                state.textSortColumn = null;
                state.textSortMenuOpenKey = null;
                reloadListAfterQueryStateChange();
                updateMetricSortControlsUI();
                updateTextSortControlsUI();
                updateCheckedSortControlsUI();
            }
        });
    }

    if (!document.body.dataset.checkedSortBodyBound) {
        document.body.dataset.checkedSortBodyBound = 'true';
        document.addEventListener('mousedown', (event) => {
            const target = event.target;
            if (target?.closest?.('.checked-sort-controls')) return;
            closeCheckedSortMenu();
        }, true);
        window.addEventListener('resize', () => {
            const control = document.querySelector('.checked-sort-controls[data-checked-sort-col="checked"]');
            positionCheckedSortMenu(control);
        });
    }

    updateCheckedSortControlsUI();
}

function ensureMetricSortControls() {
    Object.keys(METRIC_SORT_CONFIG).forEach((colKey) => {
        const cell = document.querySelector(`.list-head .head-cell[data-col-key="${colKey}"]`);
        if (!cell || cell.querySelector('.metric-sort-controls')) return;

        const controls = document.createElement('div');
        controls.className = 'metric-sort-controls';
        controls.dataset.sortCol = colKey;
        controls.innerHTML = `
            <button type="button" class="metric-sort-mode-toggle" data-sort-menu-toggle aria-label="Chọn kiểu lọc">
                <span class="metric-sort-triangle">▼</span>
            </button>
            <button type="button" class="metric-sort-direction-toggle" data-sort-direction-toggle aria-label="Đổi chiều sắp xếp">
                <span class="material-icons-round metric-sort-direction-icon">swap_vert</span>
            </button>
            <div class="metric-sort-menu" data-sort-menu>
                <button type="button" class="metric-sort-menu-item" data-sort-mode-option="none">
                    <span class="metric-sort-menu-title">None (Mặc định)</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-sort-mode-option="value">
                    <span class="metric-sort-menu-title">S&#7889; l&#432;&#7907;ng</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-sort-mode-option="delta">
                    <span class="metric-sort-menu-title">Bi&#7871;n &#273;&#7897;ng</span>
                </button>
            </div>
        `;
        cell.appendChild(controls);
    });

    const head = document.querySelector('.list-head');
    if (head && head.dataset.metricSortBound !== 'true') {
        head.dataset.metricSortBound = 'true';
        head.addEventListener('click', (event) => {
            const control = event.target.closest('.metric-sort-controls[data-sort-col]');
            if (!control) return;
            const colKey = control.dataset.sortCol;
            if (!isMetricSortColumn(colKey)) return;

            const menuToggle = event.target.closest('[data-sort-menu-toggle]');
            const modeOption = event.target.closest('[data-sort-mode-option]');
            const directionToggle = event.target.closest('[data-sort-direction-toggle]');

            if (menuToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeTextSortMenu();
                closeCheckedSortMenu();
                state.metricSortMenuOpenKey = state.metricSortMenuOpenKey === colKey ? null : colKey;
                updateMetricSortControlsUI();
                return;
            }

            if (modeOption) {
                event.preventDefault();
                event.stopPropagation();
                const selectedMode = modeOption.getAttribute('data-sort-mode-option');
                if (selectedMode === 'none') {
                    state.metricSortColumn = null;
                    state.metricSortMenuOpenKey = null;
                    closeTextSortMenu();
                    state.checkedSortMode = CHECKED_SORT_MODES.NONE;
                    closeCheckedSortMenu();
                    reloadListAfterQueryStateChange();
                    updateMetricSortControlsUI();
                    updateCheckedSortControlsUI();
                    return;
                }

                const mode = selectedMode === 'delta' ? 'delta' : 'value';
                state.metricSortColumn = colKey;
                state.metricSortMode = mode;
                state.textSortColumn = null;
                state.textSortMenuOpenKey = null;
                state.checkedSortMode = CHECKED_SORT_MODES.NONE;
                state.checkedSortMenuOpen = false;
                if (!['asc', 'desc'].includes(state.metricSortDirection)) {
                    state.metricSortDirection = 'desc';
                }
                state.metricSortMenuOpenKey = null;
                reloadListAfterQueryStateChange();
                updateMetricSortControlsUI();
                updateCheckedSortControlsUI();
                return;
            }

            if (directionToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeCheckedSortMenu();
                if (state.metricSortColumn !== colKey) {
                    state.metricSortColumn = colKey;
                    state.metricSortDirection = 'desc';
                    state.metricSortMode = state.metricSortMode === 'delta' ? 'delta' : 'value';
                    state.textSortColumn = null;
                    state.textSortMenuOpenKey = null;
                    state.checkedSortMode = CHECKED_SORT_MODES.NONE;
                    state.checkedSortMenuOpen = false;
                } else {
                    state.metricSortDirection = state.metricSortDirection === 'asc' ? 'desc' : 'asc';
                }
                state.metricSortMenuOpenKey = null;
                reloadListAfterQueryStateChange();
                updateMetricSortControlsUI();
                updateCheckedSortControlsUI();
            }
        });
    }

    if (!document.body.dataset.metricSortBodyBound) {
        document.body.dataset.metricSortBodyBound = 'true';
        document.addEventListener('mousedown', (event) => {
            const target = event.target;
            if (target?.closest?.('.metric-sort-controls')) return;
            closeMetricSortMenu();
        }, true);
    }

    updateMetricSortControlsUI();
}
/** Escape HTML to prevent XSS */
function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function clearRenderedRows(container = document.getElementById('link-list')) {
    if (!container) return;
    container.querySelectorAll('.custom-grid-row, .virtual-row-placeholder, .virtual-spacer').forEach(el => el.remove());
}

function showListLoadingState() {
    const container = document.getElementById('link-list');
    const skeleton = document.getElementById('skeleton-container');
    const emptyState = document.getElementById('empty-state');
    state.listRenderToken += 1;
    state.lastListRenderSignature = '';
    clearRenderedRows(container);
    if (emptyState) emptyState.style.display = 'none';
    if (skeleton) skeleton.style.display = '';
    updateKPIs();
}

function getListRenderSignature(items) {
    return JSON.stringify({
        activeGroup: normalizeGroupName(state.activeGroup) || ALL_GROUP_ID,
        searchQuery: state.searchQuery || '',
        selectedItemKeys: Array.from(state.selectedItemKeys).sort(),
        draggingRowKeys: state.draggingRowKeys.slice(),
        dragOverRowKey: state.dragOverRowKey || '',
        dragOverRowPlacement: state.dragOverRowPlacement || '',
        metricSortColumn: state.metricSortColumn || '',
        metricSortMode: state.metricSortMode || '',
        metricSortDirection: state.metricSortDirection || '',
        metricSortMenuOpenKey: state.metricSortMenuOpenKey || '',
        textSortColumn: state.textSortColumn || '',
        textSortDirection: state.textSortDirection || '',
        textSortMenuOpenKey: state.textSortMenuOpenKey || '',
        checkedSortMode: state.checkedSortMode || '',
        checkedSortMenuOpen: Boolean(state.checkedSortMenuOpen),
        totalItemCount: state.items.length,
        visibleItems: items.map((item) => [
            selectionKey(item),
            String(item.id || ''),
            String(item.type || ''),
            String(item.spotify_id || ''),
            String(item.user_id || ''),
            String(item.status || ''),
            String(item.error_code || ''),
            String(item.last_checked || ''),
            String(item.created_at || ''),
            String(item.group || ''),
            String(item.followers ?? ''),
            String(item.monthly_listeners ?? ''),
            String(item.playcount ?? ''),
            String(item.total_plays ?? ''),
            String(item.track_count ?? ''),
            String(item.saves ?? ''),
        ].join('|')),
    });
}

function renderRowsInBatches(container, items, renderToken, afterFirstBatch) {
    let index = 0;
    let firstBatchDone = false;
    const appendBatch = (batchSize) => {
        if (renderToken !== state.listRenderToken) return;
        const frag = document.createDocumentFragment();
        const end = Math.min(index + batchSize, items.length);
        for (; index < end; index += 1) {
            frag.appendChild(renderRow(items[index], index));
        }
        container.appendChild(frag);
        syncRowDragUi(container);
        refreshCheckedLabels();
        if (!firstBatchDone) {
            firstBatchDone = true;
            if (typeof afterFirstBatch === 'function') afterFirstBatch();
        }
        if (index < items.length) {
            requestAnimationFrame(() => appendBatch(CONFIG.LIST_RENDER_BATCH_SIZE));
        }
    };

    appendBatch(CONFIG.LIST_INITIAL_RENDER_COUNT);
}

function getLoadedVirtualItems() {
    return (state.virtualItems || []).filter(Boolean);
}

function resetVirtualList(total = 0, params = {}, opts = {}) {
    const nextTotal = Number(total || 0);
    const nextScopeKey = getBackendListScopeKey(params);
    const canPreserveLoaded = Boolean(
        opts.preserveLoaded
        && state.listScopeKey === nextScopeKey
        && state.listTotal === nextTotal
        && Array.isArray(state.virtualItems)
        && state.virtualItems.length === nextTotal
    );
    const previousItems = canPreserveLoaded ? state.virtualItems.slice() : [];
    const previousLoadedOffsets = canPreserveLoaded ? new Set(state.loadedPageOffsets) : new Set();

    state.listTotal = nextTotal;
    state.virtualItems = canPreserveLoaded ? previousItems : new Array(state.listTotal);
    state.items = getLoadedVirtualItems();
    state.filteredItems = [];
    state.loadedPageOffsets = previousLoadedOffsets;
    state.loadingPageOffsets = new Set();
    state.loadingPagePromises = new Map();
    state.currentListParams = { ...params };
    state.listScopeKey = nextScopeKey;
    state.lastListRenderSignature = '';
    state.listRenderToken += 1;
}

function commitPageItems(incoming = [], offset = 0, total = null) {
    const nextTotal = Number(total ?? state.listTotal ?? incoming.length);
    if (nextTotal !== state.listTotal || !Array.isArray(state.virtualItems) || state.virtualItems.length !== nextTotal) {
        const nextItems = new Array(nextTotal);
        (state.virtualItems || []).forEach((item, idx) => {
            if (idx < nextItems.length && item) nextItems[idx] = item;
        });
        state.virtualItems = nextItems;
        state.listTotal = nextTotal;
    }

    incoming.forEach((item, idx) => {
        const absoluteIndex = offset + idx;
        if (absoluteIndex >= 0 && absoluteIndex < state.virtualItems.length) {
            state.virtualItems[absoluteIndex] = item;
        }
    });
    state.loadedPageOffsets.add(offset);
    state.items = getLoadedVirtualItems();
    syncSelectedItemsWithState();
    syncGroupUI(true);
    saveCurrentListScopeCache();
}

function createVirtualSpacer(height) {
    const spacer = document.createElement('div');
    spacer.className = 'virtual-spacer';
    spacer.style.height = `${Math.max(0, Math.round(height))}px`;
    return spacer;
}

function renderVirtualPlaceholder(rowIndex) {
    const row = document.createElement('div');
    row.className = 'virtual-row-placeholder px-4 py-3 rounded-lg border border-white/5 bg-white/[0.025]';
    row.style.minHeight = `${CONFIG.VIRTUAL_ROW_HEIGHT}px`;
    row.innerHTML = `
        <div class="flex items-center gap-4 h-full opacity-70">
            <div class="meta-cell stt-cell text-secondary-text">${rowIndex + 1}</div>
            <div class="skeleton" style="width:70px;height:70px;border-radius:8px"></div>
            <div class="flex flex-col gap-2 flex-1">
                <div class="skeleton" style="width:60px;height:13px"></div>
                <div class="skeleton" style="width:260px;height:16px"></div>
                <div class="skeleton" style="width:170px;height:12px"></div>
            </div>
        </div>
    `;
    return row;
}

function getVirtualRange(container) {
    const total = Number(state.listTotal || 0);
    if (!total) return { start: 0, end: 0, total: 0 };
    const listWrap = document.querySelector('.list-wrap');
    const viewportHeight = listWrap?.clientHeight || window.innerHeight || 800;
    const scrollTop = listWrap?.scrollTop || 0;
    const listTop = container?.offsetTop || 0;
    const relativeTop = Math.max(0, scrollTop - listTop);
    const firstVisible = Math.floor(relativeTop / CONFIG.VIRTUAL_ROW_HEIGHT);
    const visibleCount = Math.ceil(viewportHeight / CONFIG.VIRTUAL_ROW_HEIGHT);
    const start = Math.max(0, firstVisible - CONFIG.VIRTUAL_OVERSCAN_ROWS);
    const end = Math.min(total, firstVisible + visibleCount + CONFIG.VIRTUAL_OVERSCAN_ROWS);
    return { start, end, total };
}

function queueVirtualPagesForRange(start, end) {
    if (!state.listScopeKey || !state.currentListParams) return;
    const maxPage = Math.max(0, Math.ceil(Number(state.listTotal || 0) / CONFIG.LIST_PAGE_SIZE) - 1);
    const firstPage = Math.max(0, Math.floor(Math.max(0, start) / CONFIG.LIST_PAGE_SIZE) - CONFIG.VIRTUAL_PREFETCH_PAGES);
    const lastPage = Math.min(
        maxPage,
        Math.floor(Math.max(0, end - 1) / CONFIG.LIST_PAGE_SIZE) + CONFIG.VIRTUAL_PREFETCH_PAGES
    );
    for (let page = firstPage; page <= lastPage; page += 1) {
        const offset = page * CONFIG.LIST_PAGE_SIZE;
        loadVirtualPage(offset);
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RENDER ENGINE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function renderList(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
    const force = Boolean(opts?.force);
    const container = document.getElementById('link-list');
    const skeleton = document.getElementById('skeleton-container');
    const emptyState = document.getElementById('empty-state');
    const emptyTitleEl = emptyState ? (emptyState.querySelector('[data-empty-title]') || emptyState.querySelector('h3')) : null;
    const emptyDescEl = emptyState ? (emptyState.querySelector('[data-empty-description]') || emptyState.querySelector('p')) : null;
    const defaultEmptyTitle = 'No links yet';
    const defaultEmptyDescription = 'Add your first Spotify link to start monitoring play counts, followers, and more.';
    const listWrap = document.querySelector('.list-wrap');
    const prevScrollTop = preserveScroll && listWrap ? listWrap.scrollTop : null;
    const restoreScroll = () => {
        if (prevScrollTop == null || !listWrap) return;
        requestAnimationFrame(() => {
            listWrap.scrollTop = prevScrollTop;
        });
    };
    syncGroupUI();
    syncSelectedItemsWithState();

    if (state.listTotal > 0 || (Array.isArray(state.virtualItems) && state.virtualItems.length > 0)) {
        const total = Number(state.listTotal || 0);
        const loadedItems = getLoadedVirtualItems();
        state.filteredItems = loadedItems;
        state.listRenderToken += 1;
        const renderToken = state.listRenderToken;
        if (total === 0) {
            container.style.minHeight = '';
            clearRenderedRows(container);
            if (skeleton) skeleton.style.display = 'none';
            if (emptyState) emptyState.style.display = '';
            updateKPIs();
            return;
        }

        const range = getVirtualRange(container);
        queueVirtualPagesForRange(range.start, range.end);
        container.style.minHeight = `${Math.max(0, total * CONFIG.VIRTUAL_ROW_HEIGHT)}px`;
        clearRenderedRows(container);
        if (skeleton) skeleton.style.display = 'none';
        if (emptyState) emptyState.style.display = total > 0 ? 'none' : '';
        const frag = document.createDocumentFragment();
        if (range.start > 0) {
            frag.appendChild(createVirtualSpacer(range.start * CONFIG.VIRTUAL_ROW_HEIGHT));
        }
        for (let idx = range.start; idx < range.end; idx += 1) {
            if (renderToken !== state.listRenderToken) return;
            const item = state.virtualItems[idx];
            frag.appendChild(item ? renderRow(item, idx) : renderVirtualPlaceholder(idx));
        }
        if (range.end < total) {
            frag.appendChild(createVirtualSpacer((total - range.end) * CONFIG.VIRTUAL_ROW_HEIGHT));
        }
        container.appendChild(frag);
        updateKPIs();
        refreshCheckedLabels();
        updateMetricSortControlsUI();
        updateTextSortControlsUI();
        restoreScroll();
        return;
    }

    container.style.minHeight = '';
    const items = getVisibleItems();
    state.filteredItems = items;
    const listRenderSignature = getListRenderSignature(items);
    const hasRenderedRows = container.querySelector('.custom-grid-row') || (emptyState && emptyState.style.display !== 'none');
    if (!force && hasRenderedRows && listRenderSignature === state.lastListRenderSignature) {
        if (skeleton) skeleton.style.display = 'none';
        updateKPIs();
        refreshCheckedLabels();
        updateMetricSortControlsUI();
        updateTextSortControlsUI();
        restoreScroll();
        return;
    }
    state.lastListRenderSignature = listRenderSignature;

    // Clear previous rows (keep skeleton and empty state)
    state.listRenderToken += 1;
    const renderToken = state.listRenderToken;
    clearRenderedRows(container);

    if (skeleton) skeleton.style.display = 'none';

    if (items.length === 0) {
        if (!state.searchQuery && emptyState) {
            if (emptyTitleEl) {
                emptyTitleEl.textContent = state.activeGroup === ALL_GROUP_ID ? 'Create your first group' : state.items.length === 0
                    ? defaultEmptyTitle
                    : `No links in "${getActiveGroupName()}"`;
            }
            if (emptyDescEl) {
                emptyDescEl.textContent = state.activeGroup === ALL_GROUP_ID ? 'Create a group before adding Spotify links.' : state.items.length === 0
                    ? defaultEmptyDescription
                    : 'Add a Spotify link to this group to start monitoring.';
            }
            emptyState.style.display = '';
            updateMetricSortControlsUI();
            updateTextSortControlsUI();
            restoreScroll();
            updateKPIs();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const noResult = document.createElement('div');
        noResult.className = 'custom-grid-row text-center py-12 text-secondary-text';
        noResult.innerHTML = `<div class="col-span-3">No results for "${escapeHtml(state.searchQuery)}"</div>`;
        container.appendChild(noResult);
        updateMetricSortControlsUI();
        updateTextSortControlsUI();
        restoreScroll();
        updateKPIs();
        return;
    }

    if (emptyTitleEl) emptyTitleEl.textContent = defaultEmptyTitle;
    if (emptyDescEl) emptyDescEl.textContent = defaultEmptyDescription;
    if (emptyState) emptyState.style.display = 'none';

    renderRowsInBatches(container, items, renderToken, restoreScroll);

    // Update KPIs
    updateKPIs();
    updateMetricSortControlsUI();
    updateTextSortControlsUI();
}
function refreshCheckedLabels() {
    const labels = document.querySelectorAll('#link-list .row-checked');
    labels.forEach((label) => {
        const checkedAt = label.getAttribute('data-checked-at');
        label.textContent = timeAgo(checkedAt);
    });
}

function updateKPIs() {
    const activeEntry = getGroupEntryById(state.activeGroup);
    const scoped = state.activeGroup === ALL_GROUP_ID
        ? state.items
        : state.items.filter((i) => doesItemMatchGroupEntry(i, activeEntry));
    const scopedTotal = Number(state.itemSummary?.total ?? state.listTotal ?? scoped.length);
    const active = Number(state.itemSummary?.active ?? scoped.filter(i => i.status === 'active').length);
    const errors = Number(state.itemSummary?.errors ?? scoped.filter(i => i.status === 'error').length);
    const crawling = Number(state.itemSummary?.crawling ?? scoped.filter(i => i.status === 'crawling' || i.status === 'pending').length);
    const selected = getSelectedVisibleItems().length;
    const allTotal = Number(state.itemSummary?.all_total ?? state.items.length);

    setText('kpi-total', scopedTotal);
    setText('kpi-active', active);
    setText('kpi-errors', errors);
    setText('kpi-crawling', crawling);
    setText('kpi-selected', selected);
    setText('footer-total', scopedTotal);
    setText('footer-active', active);
    setText('footer-errors', errors);
    setText('footer-crawling', crawling);
    setText('footer-selected', selected);
    setText('group-count-all', allTotal);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function updateApiStatus() {
    const el = document.getElementById('api-status');
    if (!el) return;
    if (state.apiOnline) {
        el.textContent = 'Optimal';
        el.className = 'text-primary font-bold uppercase';
    } else {
        el.textContent = 'Offline';
        el.className = 'text-red-500 font-bold uppercase';
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LINK / PREVIEW HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function copyToClipboard(value, successMessage) {
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        showToast(successMessage || 'Copied', 'success');
    } catch (err) {
        showToast('Copy failed', 'error');
    }
}

function openImagePreview(url) {
    if (!url) return;
    const modal = document.getElementById('image-preview-modal');
    const image = document.getElementById('image-preview-img');
    if (!modal || !image) return;
    image.src = url;
    modal.classList.add('open');
}

function closeImagePreview() {
    const modal = document.getElementById('image-preview-modal');
    const image = document.getElementById('image-preview-img');
    if (modal) modal.classList.remove('open');
    if (image) image.src = '';
}

function cleanExportText(value) {
    if (value == null) return '';
    return String(value).replace(/\r?\n/g, ' ').trim();
}

function formatExportMetricPlain(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? '1' : '0';
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (Number.isInteger(numeric)) return String(numeric);
        return String(numeric);
    }
    return cleanExportText(value);
}

function buildExportTrackTitle(artistLabel, trackName) {
    return buildDisplayTitleWithArtists(splitArtistLabel(artistLabel), trackName, artistLabel || '-');
}

function mergeExportBlocks(blocks = []) {
    const normalizedBlocks = blocks.filter((block) => Array.isArray(block) && block.length);
    if (!normalizedBlocks.length) return [];

    const widths = normalizedBlocks.map((block) =>
        block.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    );
    const height = normalizedBlocks.reduce((max, block) => Math.max(max, block.length), 0);
    const mergedRows = [];

    for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
        const mergedRow = [];
        normalizedBlocks.forEach((block, blockIndex) => {
            const width = widths[blockIndex];
            const row = Array.isArray(block[rowIndex]) ? block[rowIndex] : [];
            for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
                mergedRow.push(cleanExportText(row[columnIndex] ?? ''));
            }
        });
        mergedRows.push(mergedRow);
    }

    return mergedRows;
}

function csvEscapeCell(value) {
    const text = cleanExportText(value);
    if (/["\r\n,]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function buildExportFileName(prefix, extension) {
    const now = new Date();
    const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '-',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    return `${prefix}-${stamp}.${extension}`;
}

function getExportProgressElement() {
    return document.getElementById('export-progress-indicator');
}

function setExportInProgress(active, label = '') {
    state.exportInProgress = Boolean(active);
    state.exportLabel = label || '';

    const indicator = getExportProgressElement();
    if (!indicator) return;
    const textEl = indicator.querySelector('[data-export-progress-text]');
    if (textEl) {
        textEl.textContent = state.exportLabel || 'Exporting data...';
    }
    indicator.classList.toggle('open', state.exportInProgress);
    indicator.setAttribute('aria-hidden', state.exportInProgress ? 'false' : 'true');
    if (state.contextMenuVisible) {
        updateRowContextMenuLabels();
    }
}

function parseResponseFilename(response, fallbackName) {
    const contentDisposition = response?.headers?.get?.('Content-Disposition') || '';
    const safeFallback = (fallbackName || '').trim();
    if (!contentDisposition) return safeFallback;
    const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    let candidate = '';
    if (utfMatch?.[1]) {
        try {
            candidate = decodeURIComponent(utfMatch[1].trim());
        } catch {
            candidate = utfMatch[1].trim();
        }
    } else {
        const plainMatch = contentDisposition.match(/filename="?([^\";]+)"?/i);
        if (plainMatch?.[1]) {
            candidate = plainMatch[1].trim();
        }
    }

    // Strip unsafe filename chars and path separators to avoid browser fallback to blob UUID.
    candidate = String(candidate || '')
        .replace(/[\\/:"*?<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[. ]+|[. ]+$/g, '');

    return candidate || safeFallback;
}

function ensureDownloadExtension(fileName, contentType = '', fallbackExt = '') {
    const normalizedName = String(fileName || '').trim();
    const normalizedType = String(contentType || '').toLowerCase();
    const fromType = normalizedType.includes('spreadsheetml')
        ? 'xlsx'
        : normalizedType.includes('text/plain')
            ? 'txt'
            : normalizedType.includes('text/csv')
                ? 'csv'
                : '';
    const ext = (fallbackExt || fromType || '').replace(/^\./, '').trim().toLowerCase();
    if (!ext) return normalizedName;
    if (/\.[a-z0-9]{1,8}$/i.test(normalizedName)) return normalizedName;
    return `${normalizedName || `spoticheck-export-${Date.now()}`}.${ext}`;
}

async function downloadResponseAsFile(response, fallbackName, expectedFormat = '') {
    const contentType = response?.headers?.get?.('Content-Type') || '';
    const lowerType = contentType.toLowerCase();
    // Guard against accidentally downloading JSON/HTML error payload as random blob file.
    if (lowerType.includes('application/json') || lowerType.includes('text/html')) {
        const bodyText = await response.clone().text().catch(() => '');
        throw new Error(bodyText || `Unexpected export response type: ${contentType || 'unknown'}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    const resolvedName = parseResponseFilename(response, fallbackName);
    const finalName = ensureDownloadExtension(resolvedName, contentType, expectedFormat);
    a.download = finalName || fallbackName || `spoticheck-export-${Date.now()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function downloadTextFile(content, fileName, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function getItemArtistsLabel(item) {
    const artists = getItemArtistNames(item).map((name) => cleanExportText(name)).filter(Boolean);
    if (artists.length) return artists.join(', ');
    const owner = cleanExportText(item?.owner_name || item?.playlist_owner || item?.playlist_owner_name || '');
    return owner || '';
}

function ensureTextSortControls() {
    const cell = document.querySelector('.list-head .head-cell[data-col-key="playlistOwner"]');
    if (cell && !cell.querySelector('.text-sort-controls')) {
        const controls = document.createElement('div');
        controls.className = 'metric-sort-controls text-sort-controls';
        controls.dataset.textSortCol = 'playlistOwner';
        controls.innerHTML = `
            <button type="button" class="metric-sort-mode-toggle" data-text-sort-menu-toggle aria-label="Chọn kiểu lọc Playlist Owner">
                <span class="metric-sort-triangle">▼</span>
            </button>
            <button type="button" class="metric-sort-direction-toggle" data-text-sort-direction-toggle aria-label="Đổi chiều sắp xếp Playlist Owner">
                <span class="material-icons-round metric-sort-direction-icon">swap_vert</span>
            </button>
            <div class="metric-sort-menu" data-text-sort-menu>
                <button type="button" class="metric-sort-menu-item" data-text-sort-option="none">
                    <span class="metric-sort-menu-title">None (Mặc định)</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-text-sort-option="asc">
                    <span class="metric-sort-menu-title">A-Z</span>
                </button>
                <button type="button" class="metric-sort-menu-item" data-text-sort-option="desc">
                    <span class="metric-sort-menu-title">Z-A</span>
                </button>
            </div>
        `;
        cell.appendChild(controls);
    }

    const head = document.querySelector('.list-head');
    if (head && head.dataset.textSortBound !== 'true') {
        head.dataset.textSortBound = 'true';
        head.addEventListener('click', (event) => {
            const control = event.target.closest('.text-sort-controls[data-text-sort-col]');
            if (!control) return;
            const colKey = control.dataset.textSortCol;
            const menuToggle = event.target.closest('[data-text-sort-menu-toggle]');
            const directionToggle = event.target.closest('[data-text-sort-direction-toggle]');
            const option = event.target.closest('[data-text-sort-option]');

            if (menuToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeMetricSortMenu();
                closeCheckedSortMenu();
                state.textSortMenuOpenKey = state.textSortMenuOpenKey === colKey ? null : colKey;
                updateTextSortControlsUI();
                return;
            }

            if (directionToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeMetricSortMenu();
                if (state.textSortColumn !== colKey) {
                    state.textSortColumn = colKey;
                    state.textSortDirection = 'asc';
                } else {
                    state.textSortDirection = state.textSortDirection === 'asc' ? 'desc' : 'asc';
                }
                state.metricSortColumn = null;
                state.metricSortMenuOpenKey = null;
                state.textSortMenuOpenKey = null;
                state.checkedSortMode = CHECKED_SORT_MODES.NONE;
                state.checkedSortMenuOpen = false;
                reloadListAfterQueryStateChange();
                updateMetricSortControlsUI();
                updateTextSortControlsUI();
                updateCheckedSortControlsUI();
                return;
            }

            if (option) {
                event.preventDefault();
                event.stopPropagation();
                const next = option.getAttribute('data-text-sort-option');
                if (next === 'none') {
                    state.textSortColumn = null;
                } else {
                    state.textSortColumn = colKey;
                    state.textSortDirection = next === 'desc' ? 'desc' : 'asc';
                }
                state.metricSortColumn = null;
                state.metricSortMenuOpenKey = null;
                state.textSortMenuOpenKey = null;
                state.checkedSortMode = CHECKED_SORT_MODES.NONE;
                state.checkedSortMenuOpen = false;
                reloadListAfterQueryStateChange();
                updateMetricSortControlsUI();
                updateTextSortControlsUI();
                updateCheckedSortControlsUI();
            }
        });
    }

    if (!document.body.dataset.textSortBodyBound) {
        document.body.dataset.textSortBodyBound = 'true';
        document.addEventListener('mousedown', (event) => {
            const target = event.target;
            if (target?.closest?.('.text-sort-controls')) return;
            closeTextSortMenu();
        }, true);
    }

    updateTextSortControlsUI();
}

function getItemSpotifyUrlForExport(item) {
    if (!item) return '';
    return cleanExportText(item.spotify_url || getSpotifyUrl(item.type, item.spotify_id));
}

function getContextActionItems(opts = {}) {
    const selected = getSelectedItems();
    if (selected.length) return selected;
    const fallbackToVisible = opts.fallbackToVisible === true;
    if (fallbackToVisible) {
        return getVisibleItems();
    }
    return [];
}

function inferStructuredClipboardAction(items) {
    const types = Array.from(new Set((items || []).map((item) => item?.type).filter(Boolean)));
    if (types.length !== 1) return null;
    const type = types[0];
    if (type === 'playlist') return 'clipboard-playlist-type3';
    if (type === 'album') return 'clipboard-album-type0';
    if (type === 'track') return 'clipboard-track-offline';
    if (type === 'artist') return 'clipboard-artist-basic';
    return null;
}

function getClipboardContextLabel(items) {
    const action = inferStructuredClipboardAction(items);
    if (action === 'clipboard-playlist-type3') return 'Clipboard (Playlist)';
    if (action === 'clipboard-album-type0') return 'Clipboard (Album)';
    if (action === 'clipboard-track-offline') return 'Clipboard (Track)';
    if (action === 'clipboard-artist-basic') return 'Clipboard (Artist)';
    if ((items || []).length > 0) return 'Clipboard (Chọn cùng 1 loại)';
    return 'Clipboard';
}

function dedupeSubmittedUrls(urls) {
    const seen = new Set();
    const deduped = [];
    let removed = 0;
    (urls || []).forEach((rawUrl) => {
        const parsed = parseSpotifyUrl(rawUrl);
        const key = parsed ? `${parsed.type}:${parsed.id}` : rawUrl.toLowerCase();
        if (seen.has(key)) {
            removed += 1;
            return;
        }
        seen.add(key);
        deduped.push(rawUrl);
    });
    return { urls: deduped, removed };
}

function buildListViewExportRows(items) {
    return (items || []).map((item) => {
        const excel = getExcelColumnValues(item);
        return [
            cleanExportText(item.type || ''),
            cleanExportText(getDisplayTitle(item)),
            getItemSpotifyUrlForExport(item),
            cleanExportText(item.group || ''),
            cleanExportText(getItemUserName(item)),
            cleanExportText(getPlaylistOwnerLabel(item) === '-' ? '' : getPlaylistOwnerLabel(item)),
            excel.playlistSaves ?? '',
            excel.playlistTrackCount ?? '',
            excel.albumTrackCount ?? '',
            excel.artistFollowers ?? '',
            excel.artistListeners ?? '',
            excel.trackViews ?? '',
            cleanExportText(formatUpdatedAt(item.last_checked || item.created_at || '')),
        ];
    });
}

function buildPlaylistType3ExportRows(items) {
    const blocks = (items || [])
        .filter((item) => item?.type === 'playlist')
        .map((item) => {
            const blockRows = [];
            const tracks = Array.isArray(item.export_tracks) ? item.export_tracks : [];
            if (tracks.length) {
                tracks.forEach((track) => {
                    const artists = cleanExportText(track.artist_names || '-') || '-';
                    const trackName = cleanExportText(track.track_name || '-');
                    blockRows.push([
                        buildExportTrackTitle(artists, trackName),
                        cleanExportText(track.spotify_url || ''),
                        formatExportMetricPlain(track.playcount_estimate ?? ''),
                    ]);
                });
            } else {
                const artists = getItemArtistsLabel(item) || item.owner_name || '-';
                const trackName = cleanExportText(item.name || '-');
                const spotifyLink = getItemSpotifyUrlForExport(item);
                const trackPlayCount = item.playcount ?? item.followers ?? item.saves ?? '';
                blockRows.push([
                    buildExportTrackTitle(artists, trackName),
                    spotifyLink,
                    formatExportMetricPlain(trackPlayCount),
                ]);
            }
            return blockRows;
        });
    return mergeExportBlocks(blocks);
}

function buildAlbumType0ExportRows(items) {
    const blocks = (items || [])
        .filter((item) => item?.type === 'album')
        .map((item) => {
            const albumName = cleanExportText(getDisplayTitle(item) || '-');
            const blockRows = [];
            const tracks = Array.isArray(item.export_tracks) ? item.export_tracks : [];
            if (tracks.length) {
                tracks.forEach((track, index) => {
                    blockRows.push([
                        albumName,
                        String(index + 1),
                        buildExportTrackTitle(track.artist_names || '-', track.track_name || '-'),
                        cleanExportText(track.spotify_url || ''),
                        formatExportMetricPlain(track.playcount_estimate ?? ''),
                    ]);
                });
                return blockRows;
            }
            blockRows.push([
                albumName,
                '1',
                albumName,
                getItemSpotifyUrlForExport(item),
                formatExportMetricPlain(item.playcount),
            ]);
            return blockRows;
        });
    return mergeExportBlocks(blocks);
}

function buildTrackOfflineExportRows(items) {
    return (items || [])
        .filter((item) => item?.type === 'track')
        .map((item) => {
            const trackTitle = cleanExportText(getDisplayTitle(item) || '-');
            const spotifyLink = getItemSpotifyUrlForExport(item);
            const playCount = formatExportMetricPlain(item.playcount);
            const firstArtistListenPerMonthCount = item.monthly_listeners == null
                ? ''
                : formatExportMetricPlain(item.monthly_listeners);
            return [
                trackTitle,
                spotifyLink,
                playCount,
                firstArtistListenPerMonthCount,
            ];
        });
}

function buildArtistBasicExportRows(items) {
    return (items || [])
        .filter((item) => item?.type === 'artist')
        .map((item) => [
            cleanExportText(item.name || '-'),
            getItemSpotifyUrlForExport(item),
            formatExportMetricPlain(item.followers),
            formatExportMetricPlain(item.monthly_listeners),
        ]);
}

function rowsToDelimitedText(rows, delimiter = '\t') {
    return rows
        .map((row) => row.map((cell) => cleanExportText(cell)).join(delimiter))
        .join('\r\n');
}

function buildCsvContent(headers, rows) {
    const lines = [];
    if (Array.isArray(headers) && headers.length) {
        lines.push(headers.map((h) => csvEscapeCell(h)).join(','));
    }
    (rows || []).forEach((row) => {
        lines.push((row || []).map((cell) => csvEscapeCell(cell)).join(','));
    });
    return `\uFEFF${lines.join('\r\n')}`;
}

function getStructuredExportRows(action, items) {
    if (action.endsWith('playlist-type3')) {
        return {
            rows: buildPlaylistType3ExportRows(items),
            filePrefix: 'spoticheck-playlist-type3',
            title: 'playlist',
        };
    }
    if (action.endsWith('album-type0')) {
        return {
            rows: buildAlbumType0ExportRows(items),
            filePrefix: 'spoticheck-album-type0',
            title: 'album',
        };
    }
    if (action.endsWith('track-offline')) {
        return {
            rows: buildTrackOfflineExportRows(items),
            filePrefix: 'spoticheck-track-offline',
            title: 'track offline',
        };
    }
    if (action.endsWith('artist-basic')) {
        return {
            rows: buildArtistBasicExportRows(items),
            filePrefix: 'spoticheck-artist-basic',
            title: 'artist',
        };
    }
    return { rows: [], filePrefix: 'spoticheck-export', title: 'export' };
}

function getPlaylistClipboardLineLimit() {
    const value = Number(state.globalPreferences?.playlistClipboardLineLimit);
    return Number.isInteger(value)
        ? Math.min(MAX_PLAYLIST_CLIPBOARD_LINE_LIMIT, Math.max(MIN_PLAYLIST_CLIPBOARD_LINE_LIMIT, value))
        : DEFAULT_PLAYLIST_CLIPBOARD_LINE_LIMIT;
}

function getClipboardRowsForAction(action, rows) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    if (action !== 'clipboard-playlist-type3') return sourceRows;
    return sourceRows.slice(0, getPlaylistClipboardLineLimit());
}

function getClipboardCountMessage(copiedCount, availableCount, suffix = 'line(s)') {
    const copied = Number(copiedCount) || 0;
    const available = Number(availableCount) || copied;
    return copied < available
        ? `Copied ${copied} of ${available} ${suffix}`
        : `Copied ${copied} ${suffix}`;
}

async function runStructuredExport(action, items, destination) {
    const payload = getStructuredExportRows(action, items);
    const rows = destination === 'clipboard'
        ? getClipboardRowsForAction(action, payload.rows)
        : payload.rows;
    if (!rows.length) {
        showToast('KhÃ´ng cÃ³ dá»¯ liá»‡u phÃ¹ há»£p cho kiá»ƒu xuáº¥t nÃ y', 'info');
        return;
    }
    const text = rowsToDelimitedText(rows, '\t');
    if (destination === 'clipboard') {
        await copyToClipboard(text, getClipboardCountMessage(rows.length, payload.rows.length, `${payload.title} line(s)`));
        return;
    }
    const fileName = buildExportFileName(payload.filePrefix, 'txt');
    downloadTextFile(text, fileName, 'text/plain;charset=utf-8');
    showToast(`Exported ${rows.length} ${payload.title} lines`, 'success');
}

function mapContextActionToExportRequest(action) {
    if (action === 'export-listview-excel') {
        return { exportAction: 'listview-excel', format: 'xlsx', deepFetch: false };
    }
    if (action === 'clipboard-playlist-type3') {
        return { exportAction: 'playlist-type3', format: 'json', deepFetch: true };
    }
    if (action === 'clipboard-album-type0') {
        return { exportAction: 'album-type0', format: 'json', deepFetch: true };
    }
    if (action === 'clipboard-track-offline') {
        return { exportAction: 'track-offline', format: 'json', deepFetch: false };
    }
    if (action === 'clipboard-artist-basic') {
        return { exportAction: 'artist-basic', format: 'json', deepFetch: false };
    }
    if (action === 'txt-playlist-type3') {
        return { exportAction: 'playlist-type3', format: 'txt', deepFetch: true };
    }
    if (action === 'txt-album-type0') {
        return { exportAction: 'album-type0', format: 'txt', deepFetch: true };
    }
    if (action === 'txt-track-offline') {
        return { exportAction: 'track-offline', format: 'txt', deepFetch: false };
    }
    if (action === 'txt-artist-basic') {
        return { exportAction: 'artist-basic', format: 'txt', deepFetch: false };
    }
    return null;
}

function getStableItemIdsForExport(items) {
    return (items || [])
        .filter((item) => item && item.id && !String(item.id).startsWith('temp-'))
        .map((item) => String(item.id));
}

async function runServerExport(contextAction, selectedItems) {
    const request = mapContextActionToExportRequest(contextAction);
    if (!request) return false;

    const stableItemIds = getStableItemIdsForExport(selectedItems);
    if (!stableItemIds.length) {
        showToast('No completed rows selected for export', 'info');
        return true;
    }

    const selectedCount = selectedItems.length;
    if (stableItemIds.length < selectedCount) {
        showToast(`Skipping ${selectedCount - stableItemIds.length} row(s) still crawling`, 'info');
    }

    const confirmText = `Export ${stableItemIds.length} selected row(s)?`;
    if (!window.confirm(confirmText)) {
        return true;
    }

    setExportInProgress(true, 'Exporting data...');
    try {
        if (request.format === 'json') {
            const payload = await api.exportRows(request.exportAction, stableItemIds, request.deepFetch);
            const rows = Array.isArray(payload?.rows) ? payload.rows : [];
            if (!rows.length) {
                showToast('No data available for this export mode', 'info');
                return true;
            }
            const copiedRows = getClipboardRowsForAction(contextAction, rows);
            const text = rowsToDelimitedText(copiedRows, '\t');
            await copyToClipboard(text, getClipboardCountMessage(copiedRows.length, rows.length));
            return true;
        }

        const response = await api.exportFile(
            request.exportAction,
            request.format,
            stableItemIds,
            request.deepFetch
        );
        if (!response) {
            throw new Error('Export request did not return a response');
        }
        const fallbackName = buildExportFileName(
            request.exportAction === 'listview-excel' ? 'spoticheck-listview' : `spoticheck-${request.exportAction}`,
            request.format
        );
        await downloadResponseAsFile(response, fallbackName, request.format);
        showToast('Export completed', 'success');
        return true;
    } catch (err) {
        console.warn('[Export] Server export failed, fallback to local formatter:', err);
        return false;
    } finally {
        setExportInProgress(false);
    }
}

function getRowContextMenuElement() {
    return document.getElementById('row-context-menu');
}

function hideRowContextMenu() {
    const menu = getRowContextMenuElement();
    if (!menu) return;
    menu.classList.remove('open');
    menu.style.display = 'none';
    state.contextMenuVisible = false;
    state.contextMenuAnchorSelectionKey = null;
}

function setContextActionDisabled(menu, action, disabled) {
    menu.querySelectorAll(`[data-context-action="${action}"]`).forEach((btn) => {
        btn.disabled = disabled;
        btn.classList.toggle('is-disabled', disabled);
    });
}

function syncRowContextSubmenuDirection(menu) {
    if (!menu) return;
    const viewportPadding = 8;
    const menuRect = menu.getBoundingClientRect();
    menu.querySelectorAll('.row-context-parent').forEach((parent) => {
        parent.classList.remove('submenu-flip', 'submenu-up');
        const submenu = parent.querySelector('.row-context-submenu');
        if (!submenu) return;
        const parentRect = parent.getBoundingClientRect();
        const projectedRight = menuRect.right + submenu.offsetWidth + 12;
        if (projectedRight > (window.innerWidth - viewportPadding)) {
            parent.classList.add('submenu-flip');
        }
        const projectedBottom = parentRect.top - 6 + submenu.offsetHeight;
        if (projectedBottom > (window.innerHeight - viewportPadding)) {
            parent.classList.add('submenu-up');
        }
    });
}

function renderMoveGroupSubmenu(menu) {
    const submenu = menu?.querySelector('[data-context-group="move"] .row-context-submenu');
    if (!submenu) return;
    submenu.innerHTML = '';

    getMoveTargetGroups().forEach((group) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'row-context-item row-context-submenu-item';
        btn.setAttribute('data-context-action', 'move-selected-to-group');
        btn.setAttribute('data-context-group-id', String(group.id || '__ungrouped__'));
        const label = document.createElement('span');
        label.textContent = group.displayName || group.name || 'No Group';
        btn.appendChild(label);
        submenu.appendChild(btn);
    });
}

function updateRowContextMenuLabels() {
    const menu = getRowContextMenuElement();
    if (!menu) return;
    const selectedItems = getSelectedItems();
    const selectedCount = selectedItems.length;
    const scope = getCurrentListScope();
    const fetchLabels = menu.querySelectorAll('[data-context-label="fetch"]');
    const deleteLabels = menu.querySelectorAll('[data-context-label="delete"]');
    const exportLabels = menu.querySelectorAll('[data-context-label="export-list"]');
    const clearLabels = menu.querySelectorAll('[data-context-label="clear-list"]');
    const clipboardLabels = menu.querySelectorAll('[data-context-label="clipboard"]');
    const moveLabels = menu.querySelectorAll('[data-context-label="move"]');
    const copyLinkLabels = menu.querySelectorAll('[data-context-label="copy-links"]');
    const hasSelection = selectedCount > 0;
    const clipboardAction = inferStructuredClipboardAction(selectedItems);
    renderMoveGroupSubmenu(menu);
    fetchLabels.forEach((label) => {
        label.textContent = selectedCount > 1
            ? `Refresh ${selectedCount} selected`
            : 'Refresh row';
    });
    deleteLabels.forEach((label) => {
        label.textContent = selectedCount > 1
            ? `Delete ${selectedCount} selected`
            : 'Delete row';
    });
    exportLabels.forEach((label) => {
        label.textContent = selectedCount > 1
            ? `Export ListView to Excel (${selectedCount})`
            : 'Export ListView to Excel';
    });
    clearLabels.forEach((label) => {
        label.textContent = scope.group
            ? `Clear "${scope.label}"`
            : 'Clear All Links';
    });
    clipboardLabels.forEach((label) => {
        label.textContent = getClipboardContextLabel(selectedItems);
    });
    moveLabels.forEach((label) => {
        label.textContent = selectedCount > 1
            ? `Move ${selectedCount} selected`
            : 'Move to group';
    });
    copyLinkLabels.forEach((label) => {
        label.textContent = getCopyLinkLabel(selectedCount);
    });

    const disableForExport = state.exportInProgress;
    [
        'delete-selected',
        'fetch-selected',
        'export-listview-excel',
        'copy-selected-links',
        'clipboard-auto',
        'txt-playlist-type3',
        'txt-album-type0',
        'txt-track-offline',
        'txt-artist-basic',
    ].forEach((action) => setContextActionDisabled(menu, action, !hasSelection || disableForExport));
    setContextActionDisabled(menu, 'clipboard-auto', !hasSelection || disableForExport || !clipboardAction);
    menu.querySelectorAll('[data-context-group]').forEach((groupEl) => {
        const isTxtGroup = groupEl.getAttribute('data-context-group') === 'txt';
        const isMoveGroup = groupEl.getAttribute('data-context-group') === 'move';
        groupEl.classList.toggle(
            'is-disabled',
            (isTxtGroup || isMoveGroup) && (!hasSelection || disableForExport)
        );
    });
}

function showRowContextMenu(clientX, clientY, row = null) {
    const menu = getRowContextMenuElement();
    if (!menu) return;
    if (row) {
        const item = findItemFromRow(row);
        if (!item) return;

        const targetSelectionKey = selectionKey(item);
        if (!state.selectedItemKeys.has(targetSelectionKey)) {
            state.selectedItemKeys = new Set([targetSelectionKey]);
            state.selectionAnchorKey = targetSelectionKey;
            renderList({ preserveScroll: true });
        }
        state.contextMenuAnchorSelectionKey = targetSelectionKey;
    } else {
        state.contextMenuAnchorSelectionKey = null;
    }
    updateRowContextMenuLabels();

    menu.style.display = 'block';
    menu.classList.add('open');
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    const left = Math.max(8, Math.min(clientX, maxX));
    const top = Math.max(8, Math.min(clientY, maxY));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    syncRowContextSubmenuDirection(menu);
    state.contextMenuVisible = true;
}

async function executeRowContextMenuAction(action, opts = {}) {
    if (!action) return;
    if (state.exportInProgress) {
        showToast('Export is running. Please wait.', 'info');
        return;
    }

    const selectedItems = getContextActionItems();
    if (action === 'add-link') {
        openModal();
        return;
    }
    if (action === 'fetch-selected') {
        if (!selectedItems.length) {
            showToast('No rows selected', 'info');
            return;
        }
        if (selectedItems.length === 1) {
            await handleRefreshItem(selectedItems[0]);
            return;
        }
        if (selectedItems.length >= 2) {
            await refreshAllItems();
            return;
        }
        return;
    }
    if (action === 'clipboard-auto') {
        if (!selectedItems.length) {
            showToast('No rows selected', 'info');
            return;
        }
        const inferred = inferStructuredClipboardAction(selectedItems);
        if (!inferred) {
            showToast('Clipboard export requires selecting only playlist, only album, or only track rows', 'info');
            return;
        }
        const ok = await runServerExport(inferred, selectedItems);
        if (!ok) {
            await runStructuredExport(inferred, selectedItems, 'clipboard');
        }
        return;
    }
    if (action === 'delete-selected') {
        if (!selectedItems.length) {
            showToast('No rows selected', 'info');
            return;
        }
        await handleDeleteItems(selectedItems);
        return;
    }
    if (action === 'move-selected-to-group') {
        if (!selectedItems.length) {
            showToast('No rows selected', 'info');
            return;
        }
        const targetGroupId = String(opts.targetGroupId || '__ungrouped__');
        const targetGroup = targetGroupId === '__ungrouped__'
            ? { id: '__ungrouped__', name: '', displayName: 'No Group' }
            : getGroupEntryById(targetGroupId);
        if (!targetGroup) {
            showToast('Target group not found', 'error');
            return;
        }
        await moveItemsToGroup(selectedItems, targetGroup, { clearClipboard: false });
        return;
    }
    if (action === 'copy-selected-links') {
        await copySelectedLinksToClipboard(selectedItems);
        return;
    }

    if (
        action === 'export-listview-excel'
        || action.startsWith('clipboard-')
        || action.startsWith('txt-')
    ) {
        if (!selectedItems.length) {
            showToast('No rows selected', 'info');
            return;
        }

        const ok = await runServerExport(action, selectedItems);
        if (!ok) {
            if (action === 'export-listview-excel') {
                const headers = [
                    'Type',
                    'Name',
                    'Spotify URL',
                    'Group',
                    'User',
                    'Playlist Owner',
                    'Playlist (Save)',
                    'Playlist (Count)',
                    'Album (Track Count)',
                    'Artist (Followers)',
                    'Artist (Listeners)',
                    'Tracks (Views)',
                    'Updated',
                ];
                const rows = buildListViewExportRows(selectedItems);
                const csv = buildCsvContent(headers, rows);
                const fileName = buildExportFileName('spoticheck-listview', 'csv');
                downloadTextFile(csv, fileName, 'text/csv;charset=utf-8');
                showToast(`Exported ${rows.length} rows to Excel (CSV fallback)`, 'success');
            } else if (action.startsWith('clipboard-')) {
                await runStructuredExport(action, selectedItems, 'clipboard');
            } else if (action.startsWith('txt-')) {
                await runStructuredExport(action, selectedItems, 'txt');
            }
        }
        return;
    }

    if (action === 'clear-list') {
        await clearList();
    }
}
async function handleDeleteItems(items, opts = {}) {
    const uniqueMap = new Map();
    (items || []).forEach((item) => {
        if (!item) return;
        uniqueMap.set(itemIdentity(item), item);
    });
    const targets = Array.from(uniqueMap.values());
    if (!targets.length) return;

    const deletingMany = targets.length > 1;
    const firstLabel = targets[0].name || `${targets[0].type}:${targets[0].spotify_id}`;
    const requireConfirm = opts.confirm !== false;
    if (requireConfirm) {
        const confirmMessage = deletingMany
            ? `Delete ${targets.length} selected links?\nThis action cannot be undone.`
            : `Delete "${firstLabel}"?\nThis action cannot be undone.`;
        if (!window.confirm(confirmMessage)) return;
    }
    const targetSelectionKeys = new Set(targets.map((item) => selectionKey(item)));
    const targetIdentitySet = new Set(targets.map((item) => itemIdentity(item)));
    const targetItemIds = new Set(targets.map((item) => String(item.id)).filter(Boolean));

    state.selectedItemKeys = new Set(
        Array.from(state.selectedItemKeys).filter((key) => !targetSelectionKeys.has(key))
    );
    if (state.selectionAnchorKey && targetSelectionKeys.has(state.selectionAnchorKey)) {
        state.selectionAnchorKey = null;
    }
    state.items = state.items.filter((item) => !targetIdentitySet.has(itemIdentity(item)));
    persistCurrentItemOrder();

    for (const id of targetItemIds) {
        state.pendingJobs.delete(id);
        const numericId = Number(id);
        if (Number.isFinite(numericId)) {
            state.pendingJobs.delete(numericId);
        }
    }
    for (const [jobId, itemId] of state.pendingJobToItem.entries()) {
        if (targetItemIds.has(String(itemId)) || targetItemIds.has(String(jobId))) {
            state.pendingJobToItem.delete(jobId);
        }
    }

    renderList({ preserveScroll: true });

    if (!state.apiOnline) {
        if (deletingMany) {
            showToast(`Deleted ${targets.length} links locally (API offline)`, 'info');
        } else {
            showToast(`Deleted local only: ${firstLabel} (API offline)`, 'info');
        }
        return;
    }

    let failed = 0;
    await Promise.all(targets.map(async (item) => {
        try {
            if (item.id && !String(item.id).startsWith('temp-')) {
                await api.deleteItemById(item.id);
            } else {
                await api.deleteItem(item.type, item.spotify_id, item.user_id || null);
            }
        } catch {
            failed += 1;
        }
    }));

    syncGroupUI(true);
    renderList({ preserveScroll: true });

    if (failed === 0) {
        if (deletingMany) {
            showToast(`Deleted ${targets.length} links`, 'success');
        } else {
            showToast(`Deleted: ${firstLabel}`, 'success');
        }
        return;
    }

    if (failed >= targets.length) {
        if (deletingMany) {
            showToast(`Deleted ${targets.length} links locally (sync failed)`, 'info');
        } else {
            showToast(`Deleted local only: ${firstLabel} (sync failed)`, 'info');
        }
        return;
    }

    showToast(`Deleted ${targets.length - failed}/${targets.length} links (some failed to sync)`, 'info');
}

async function handleDeleteItem(item) {
    if (!item) return;
    await handleDeleteItems([item]);
}

function markItemAsRefreshing(item, nowIso) {
    return {
        ...item,
        status: 'crawling',
        error_code: null,
        error_message: null,
        last_checked: nowIso,
    };
}

function updateLoadedItemsById(itemIds, updater) {
    const idSet = new Set((itemIds || []).map((id) => String(id)).filter(Boolean));
    if (!idSet.size || typeof updater !== 'function') return;
    const updateItem = (item) => {
        if (!item || !idSet.has(String(item.id))) return item;
        return updater(item);
    };
    state.items = state.items.map(updateItem);
    if (Array.isArray(state.virtualItems)) {
        state.virtualItems = state.virtualItems.map((item) => item ? updateItem(item) : item);
    }
}

async function handleRefreshItem(item) {
    if (!item) return;
    if (item.id && String(item.id).startsWith('temp-')) {
        showToast('Link nÃ y Ä‘ang crawl, Ä‘á»£i hoÃ n táº¥t rá»“i refresh láº¡i', 'info');
        return;
    }
    if (!state.apiOnline) {
        showToast('API offline, cannot refresh this row', 'info');
        return;
    }

    const url = getSpotifyUrl(item.type, item.spotify_id);
    const now = new Date().toISOString();
    const idx = state.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
        state.items[idx] = markItemAsRefreshing(state.items[idx], now);
    }
    renderList({ preserveScroll: true });

    try {
        const currentUser = getAuthUser();
        const targetUserId = canManageUsers(currentUser) ? (item.user_id || null) : null;
        const result = await api.crawl(url, item.group || null, targetUserId, item.id);
        const jobId = result?.job_id;
        if (!jobId) {
            throw new Error('Backend did not return job_id');
        }
        state.pendingJobs.add(jobId);
        state.pendingJobToItem.set(jobId, item.id);
        startPolling();
        showToast(`Refreshing: ${item.name || `${item.type}:${item.spotify_id}`}`, 'success');
    } catch (e) {
        if (idx >= 0) {
            state.items[idx] = {
                ...state.items[idx],
                status: 'error',
                error_message: e.message,
                last_checked: new Date().toISOString(),
            };
        }
        renderList({ preserveScroll: true });
        showToast(`Refresh failed: ${e.message}`, 'error');
    }
}

async function clearList() {
    const scope = getCurrentListScope();
    if (scope.items.length === 0) {
        showToast('List is already empty', 'info');
        return;
    }
    const confirmed = window.confirm(
        scope.group
            ? `Clear all links in "${scope.label}"?\nThis action cannot be undone.`
            : 'Clear all links in the current scope?\nThis action cannot be undone.'
    );
    if (!confirmed) return;

    const scopedIdentitySet = new Set(scope.items.map((item) => itemIdentity(item)));
    const scopedSelectionKeys = new Set(scope.items.map((item) => selectionKey(item)));
    const scopedItemIds = new Set(scope.items.map((item) => String(item.id)).filter(Boolean));

    state.items = state.items.filter((item) => !scopedIdentitySet.has(itemIdentity(item)));
    state.filteredItems = state.filteredItems.filter((item) => !scopedIdentitySet.has(itemIdentity(item)));
    state.selectedItemKeys = new Set(
        Array.from(state.selectedItemKeys).filter((key) => !scopedSelectionKeys.has(key))
    );
    if (state.selectionAnchorKey && scopedSelectionKeys.has(state.selectionAnchorKey)) {
        state.selectionAnchorKey = null;
    }
    persistCurrentItemOrder();
    for (const itemId of scopedItemIds) {
        state.pendingJobs.delete(itemId);
    }
    for (const [jobId, itemId] of state.pendingJobToItem.entries()) {
        if (itemId && scopedItemIds.has(String(itemId))) {
            state.pendingJobToItem.delete(jobId);
            state.pendingJobs.delete(jobId);
        }
    }
    if (state.pendingJobs.size === 0) {
        stopPolling();
    }
    renderList({ preserveScroll: true });

    try {
        if (state.apiOnline) {
            await api.clearItems(scope.group, scope.targetUserId);
        }
        showToast(scope.group ? `Cleared "${scope.label}"` : 'List cleared', 'success');
    } catch (e) {
        showToast(`Clear list local only: ${e.message}`, 'info');
    }
}

async function refreshAllItems() {
    const selectedVisibleItems = getSelectedVisibleItems();
    const useSelectionScope = selectedVisibleItems.length >= 2;
    let targetItems = useSelectionScope ? selectedVisibleItems : getLoadedVirtualItems();

    if (!useSelectionScope && state.listTotal > targetItems.length && state.apiOnline) {
        showToast(`Loading ${state.listTotal} links before refresh...`, 'info');
        targetItems = await loadAllVirtualItemsForCurrentScope();
    }

    if (targetItems.length === 0) {
        showToast('No links to refresh', 'info');
        return;
    }

    if (!state.apiOnline) {
        showToast('API offline, loading local data', 'info');
        await loadData({ preserveScroll: true });
        return;
    }

    const refreshableItems = targetItems.filter((item) => !(item.id && String(item.id).startsWith('temp-')));
    if (refreshableItems.length === 0) {
        showToast('No stable links to refresh right now', 'info');
        return;
    }

    const now = new Date().toISOString();
    updateLoadedItemsById(refreshableItems.map((item) => item.id), (item) => markItemAsRefreshing(item, now));
    renderList({ preserveScroll: true });

    try {
        const currentUser = getAuthUser();
        const isAdmin = canManageUsers(currentUser);
        const groupedByOwner = new Map();
        refreshableItems.forEach((item) => {
            const ownerId = isAdmin && item.user_id ? String(item.user_id) : '';
            if (!groupedByOwner.has(ownerId)) {
                groupedByOwner.set(ownerId, { ownerId: ownerId || null, urls: [], itemIds: [] });
            }
            const bucket = groupedByOwner.get(ownerId);
            bucket.urls.push(getSpotifyUrl(item.type, item.spotify_id));
            bucket.itemIds.push(item.id);
        });

        const batchResponses = await Promise.all(
            Array.from(groupedByOwner.values()).map(async (bucket) => {
                const response = await api.crawlBatch(
                    bucket.urls,
                    null,
                    isAdmin ? bucket.ownerId : null,
                    bucket.itemIds
                );
                return { bucket, response };
            })
        );

        const jobIds = [];
        batchResponses.forEach(({ bucket, response }) => {
            const ids = response?.job_ids || [];
            jobIds.push(...ids);
            ids.forEach((jobId, idx) => {
                state.pendingJobs.add(jobId);
                if (bucket.itemIds[idx]) {
                    state.pendingJobToItem.set(jobId, bucket.itemIds[idx]);
                }
            });
        });
        state.batchRefresh = {
            active: true,
            groupName: getActiveGroupName(),
            expected: jobIds.length,
            done: 0,
            errors: 0,
            jobIds: new Set(jobIds),
        };
        startPolling();
        renderList({ preserveScroll: true });
        const scopeLabel = useSelectionScope ? 'selected links' : 'links';
        showToast(`Refresh started for ${jobIds.length || refreshableItems.length} ${scopeLabel}`, 'success');
    } catch (e) {
        state.batchRefresh = null;
        await loadData({ preserveScroll: true });
        showToast(`Refresh fallback loaded data: ${e.message}`, 'info');
    }
}

function openSpotifyPopup(url) {
    const w = CONFIG.POPUP_WIDTH;
    const h = CONFIG.POPUP_HEIGHT;
    const left = window.screenX + window.outerWidth - w - 30;
    const top = window.screenY + 60;

    window.open(
        url,
        'spotify_preview',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes,status=no`
    );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MODAL HANDLERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function openModal() {
    if (state.activeGroup === ALL_GROUP_ID) {
        showToast('Select a group before adding links', 'info');
        return;
    }
    document.getElementById('add-link-modal').classList.add('open');
    document.getElementById('modal-batch-input').value = '';
    updateModalLinkPreview('');
    document.getElementById('modal-batch-input').focus();
    document.getElementById('modal-url-hint').textContent = 'Supports: playlist, track, album, and artist links';
    document.getElementById('modal-url-hint').className = 'text-xs text-secondary-text mt-2';
    populateGroupSelect();
}

function closeModal() {
    document.getElementById('add-link-modal').classList.remove('open');
}

async function submitSingle() {
    const textarea = document.getElementById('modal-batch-input');
    let urls = textarea.value.split('\n').map((u) => u.trim()).filter(Boolean);
    const hint = document.getElementById('modal-url-hint');

    if (urls.length === 0) {
        hint.textContent = 'Please enter at least one Spotify URL or URI';
        hint.className = 'text-xs text-red-400 mt-2';
        return;
    }

    const invalid = urls.filter((u) => !parseSpotifyUrl(u));
    if (invalid.length > 0) {
        hint.textContent = `${invalid.length} invalid Spotify URL(s) found`;
        hint.className = 'text-xs text-red-400 mt-2';
        return;
    }

    if (state.activeGroup === ALL_GROUP_ID) {
        hint.textContent = 'Select a group before adding links';
        hint.className = 'text-xs text-red-400 mt-2';
        return;
    }

    const selectedGroup = resolveSelectedGroupContext();
    const group = selectedGroup.group;
    const currentIdentity = getUserIdentityById(selectedGroup.targetUserId);

    try {
        let jobIds = [];
        let acceptedIndices = [];
        if (urls.length === 1) {
            const result = await api.crawl(urls[0], group, selectedGroup.targetUserId);
            if (result?.skipped_duplicate) {
                showToast('Link already exists for this user, skipped duplicate', 'info');
                closeModal();
                return;
            }
            const singleJobId = result?.job_id;
            if (!singleJobId) {
                throw new Error('Backend did not return job_id');
            }
            jobIds = [singleJobId];
            acceptedIndices = [0];
        } else {
            const result = await api.crawlBatch(urls, group, selectedGroup.targetUserId);
            jobIds = Array.isArray(result?.job_ids) ? result.job_ids : [];
            acceptedIndices = Array.isArray(result?.accepted_indices) ? result.accepted_indices : [];
            const skippedDuplicates = Number(result?.skipped_duplicates || 0);
            if (!jobIds.length && skippedDuplicates > 0) {
                showToast('All submitted links already exist for this user', 'info');
                closeModal();
                return;
            }
            if (!jobIds.length) {
                throw new Error('Backend did not return job_ids');
            }
            if (acceptedIndices.length !== jobIds.length) {
                acceptedIndices = jobIds.map((_, index) => index);
            }
            const addedCount = jobIds.length;
            if (skippedDuplicates > 0) {
                showToast(`Added ${addedCount} link${addedCount > 1 ? 's' : ''}, skipped ${skippedDuplicates} duplicate${skippedDuplicates > 1 ? 's' : ''}`, 'success');
            } else {
                showToast(`Added ${addedCount} links - crawling started`, 'success');
            }
        }
        if (urls.length === 1) {
            showToast('Added 1 link - crawling started', 'success');
        }

        const now = new Date().toISOString();
        let mappedJobs = 0;
        acceptedIndices.forEach((urlIndex, i) => {
            const url = urls[urlIndex];
            const parsed = parseSpotifyUrl(url);
            const jobId = jobIds[i];
            if (!parsed || !jobId) return;

            const newItem = {
                id: `temp-${jobId}`,
                spotify_id: parsed.id,
                type: parsed.type,
                name: `Loading ${parsed.type}...`,
                status: 'crawling',
                group: group,
                last_checked: now,
                user_id: currentIdentity.id,
                user_name: currentIdentity.name,
                user_avatar: currentIdentity.avatar,
            };
            state.items.push(newItem);
            state.pendingJobToItem.set(jobId, newItem.id);
            state.pendingJobs.add(jobId);
            mappedJobs += 1;
        });

        if (!mappedJobs) {
            throw new Error('No jobs were mapped to submitted links');
        }

        persistCurrentItemOrder();
        startPolling();
        syncGroupUI(true);
        renderList();
        closeModal();
    } catch (e) {
        hint.textContent = `Error: ${e.message}`;
        hint.className = 'text-xs text-red-400 mt-2';
    }
}

async function submitBatch() {
    return submitSingle();
}
// TOAST NOTIFICATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = { success: 'check_circle', error: 'error', info: 'info' }[type] || 'info';
    toast.innerHTML = `<span class="material-icons-round text-lg">${icon}</span>${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(16px)';
        toast.style.transition = 'all 300ms ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// POLLING â€” Check pending job status
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function startPolling() {
    if (state.pollTimer) return;
    pollJobs();
    state.pollTimer = setInterval(pollJobs, CONFIG.POLL_INTERVAL);
}

function stopPolling() {
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }
}

async function fetchPendingJobs(jobIds) {
    const jobsById = new Map();
    const normalizedJobIds = Array.isArray(jobIds) ? jobIds.filter(Boolean) : [];
    if (!normalizedJobIds.length) {
        return jobsById;
    }

    if (normalizedJobIds.length === 1) {
        const onlyJobId = normalizedJobIds[0];
        try {
            const job = await api.getJob(onlyJobId);
            if (job?.id) {
                jobsById.set(String(job.id), job);
            }
        } catch {
            // Ignore transient poll failures; next cycle will retry.
        }
        return jobsById;
    }

    try {
        const batch = await api.getJobsBatch(normalizedJobIds);
        (batch?.jobs || []).forEach((job) => {
            if (job?.id) {
                jobsById.set(String(job.id), job);
            }
        });
        return jobsById;
    } catch {
        const fallbackResults = await Promise.all(
            normalizedJobIds.map(async (jobId) => {
                try {
                    return { jobId, job: await api.getJob(jobId) };
                } catch {
                    return { jobId, job: null };
                }
            })
        );
        fallbackResults.forEach(({ jobId, job }) => {
            if (job?.id) {
                jobsById.set(String(job.id || jobId), job);
            }
        });
        return jobsById;
    }
}

async function pollJobs() {
    if (state.pendingJobs.size === 0) {
        stopPolling();
        return;
    }

    const pendingJobIds = Array.from(state.pendingJobs);
    if (pendingJobIds.length === 0) {
        stopPolling();
        return;
    }

    let shouldReload = false;
    let hasTerminalUpdate = false;
    let shouldNotifyBatchDone = false;
    const jobsById = await fetchPendingJobs(pendingJobIds);

    for (const jobId of pendingJobIds) {
        const job = jobsById.get(String(jobId)) || null;
        if (!job) continue;

        const mappedItemId = state.pendingJobToItem.get(jobId) || jobId;
        const inBatch = Boolean(
            state.batchRefresh?.active
            && state.batchRefresh?.jobIds?.has(jobId)
        );
        if (job.status === 'completed') {
            hasTerminalUpdate = true;
            // Non-batch refreshes reload canonically so snapshot-based deltas appear immediately.
            if (!inBatch) {
                shouldReload = true;
            }
            state.pendingJobs.delete(jobId);
            state.pendingJobToItem.delete(jobId);
            const completedAt = job.completed_at || new Date().toISOString();
            const stableItemId = job.item_id ? String(job.item_id) : null;
            // Update item in state with real data
            const idx = state.items.findIndex(i => i.id === mappedItemId || i.id === jobId);
            if (idx >= 0 && job.result) {
                const previousId = state.items[idx]?.id ? String(state.items[idx].id) : null;
                const nextItem = {
                    ...state.items[idx],
                    ...normalizeJobResult(job.result, state.items[idx]),
                    id: stableItemId || state.items[idx].id,
                    status: 'active',
                    last_checked: completedAt,
                };
                state.items[idx] = nextItem;
                updateLoadedItemsById([previousId || mappedItemId, stableItemId].filter(Boolean), () => nextItem);
                if (stableItemId && previousId && previousId !== stableItemId) {
                    persistCurrentItemOrder();
                }
            } else if (job.result && !inBatch) {
                // Avoid owner mix-up when multiple users track the same Spotify ID.
                shouldReload = true;
            } else if (!inBatch) {
                shouldReload = true;
            }
            if (inBatch && state.batchRefresh) {
                state.batchRefresh.done += 1;
                shouldNotifyBatchDone = true;
            }
        } else if (job.status === 'error') {
            hasTerminalUpdate = true;
            state.pendingJobs.delete(jobId);
            state.pendingJobToItem.delete(jobId);
            const idx = state.items.findIndex(i => i.id === mappedItemId || i.id === jobId);
            if (idx >= 0) {
                const nextItem = {
                    ...state.items[idx],
                    status: 'error',
                    error_message: job.error,
                    last_checked: job.completed_at || new Date().toISOString(),
                };
                state.items[idx] = nextItem;
                updateLoadedItemsById([mappedItemId], () => nextItem);
            } else if (!inBatch) {
                shouldReload = true;
            }
            if (inBatch && state.batchRefresh) {
                state.batchRefresh.done += 1;
                state.batchRefresh.errors += 1;
                shouldNotifyBatchDone = true;
            }
        }
    }

    if (state.batchRefresh?.active && shouldNotifyBatchDone) {
        const batch = state.batchRefresh;
        if (batch.done >= batch.expected) {
            const ok = Math.max(0, batch.expected - batch.errors);
            if (batch.errors > 0) {
                showToast(`Refresh completed: ${ok}/${batch.expected} links, ${batch.errors} errors`, 'info');
            } else {
                showToast(`Refresh completed: ${ok}/${batch.expected} links`, 'success');
            }
            state.batchRefresh = null;
            shouldReload = true;
        }
    }

    if (shouldReload) {
        await loadData({ preserveScroll: true });
    } else if (hasTerminalUpdate) {
        renderList({ preserveScroll: true });
    } else {
        refreshCheckedLabels();
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SEARCH
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const handleSearch = debounce((query) => {
    state.searchQuery = query;
    reloadListAfterQueryStateChange();
}, CONFIG.SEARCH_DEBOUNCE);

function reloadListAfterQueryStateChange() {
    showInstantListOrLoading(getBackendListParams(), {
        keepCurrentOnMiss: true,
        preserveScroll: false,
    });
    loadData({ preserveScroll: false, force: true });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA LOADING (with demo fallback)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/** Demo data â€” shown when backend is not available */
function getDemoData() {
    return [
        {
            id: 'demo-1', spotify_id: '37i9dQZF1DX8U', type: 'playlist',
            name: 'Whiskey Blues Best Of Slow Blues & Smoky Bar Vibes',
            image: 'https://picsum.photos/seed/jazz1/128/128',
            owner_name: 'Sarah Melodic', owner_image: 'https://randomuser.me/api/portraits/women/44.jpg',
            added_date: '10/02 11:22', followers: 12500, saves: 12500, track_count: 150,
            monthly_plays: 1158201, total_plays: 15482900,
            status: 'active', last_checked: new Date(Date.now() - 2 * 60000).toISOString(),
        },
        {
            id: 'demo-2', spotify_id: '5Rrf7iqB3Pjx', type: 'playlist',
            name: 'Winter Jazz CafÃ© â€” Cozy Fireplace Ambience',
            image: 'https://picsum.photos/seed/jazz2/128/128',
            owner_name: 'David Jazz', owner_image: 'https://randomuser.me/api/portraits/women/68.jpg',
            added_date: '10/02 11:20', followers: 4200, saves: 4200, track_count: 95,
            monthly_plays: 552532, total_plays: 5891204,
            status: 'error', error_code: 404, error_message: 'Not Found',
            last_checked: new Date(Date.now() - 14 * 60000).toISOString(),
        },
        {
            id: 'demo-3', spotify_id: '2N3D9rE', type: 'album',
            name: 'Midnight Sax â€” Smooth Saxophone Sessions',
            image: 'https://picsum.photos/seed/jazz3/128/128',
            owner_name: 'Marc C.', owner_image: null,
            added_date: '09/02 14:44', followers: 1800, saves: 1800, track_count: 12,
            monthly_plays: 128647, total_plays: 1450230,
            status: 'pending', last_checked: new Date().toISOString(),
        },
        {
            id: 'demo-4', spotify_id: '1A4K', type: 'playlist',
            name: 'Bebop Essentials â€” Classic Bebop Jazz Standards',
            image: 'https://picsum.photos/seed/jazz4/128/128',
            owner_name: 'Erik Vance', owner_image: 'https://randomuser.me/api/portraits/men/75.jpg',
            added_date: '06/02 14:29', followers: 28400, saves: 28400, track_count: 210,
            monthly_plays: 892104, total_plays: 12501890,
            status: 'active', last_checked: new Date(Date.now() - 45 * 60000).toISOString(),
        },
        {
            id: 'demo-5', spotify_id: '9Vb2', type: 'playlist',
            name: 'Nu Jazz Waves â€” Future Jazz & Electronic Grooves',
            image: 'https://picsum.photos/seed/jazz5/128/128',
            owner_name: 'Liam Stone', owner_image: 'https://randomuser.me/api/portraits/men/22.jpg',
            added_date: '06/02 14:29', followers: 5900, saves: 5900, track_count: 88,
            monthly_plays: 238528, total_plays: 3120500,
            status: 'active', last_checked: new Date(Date.now() - 60 * 60000).toISOString(),
        },
        {
            id: 'demo-6', spotify_id: '6rqhFg', type: 'track',
            name: "I Won't Never Go â€” Smooth Jazz Ballad",
            image: 'https://picsum.photos/seed/track1/128/128',
            owner_name: 'Tony Blues', owner_image: 'https://randomuser.me/api/portraits/men/55.jpg',
            added_date: '10/02 11:20', saves: 18200, duration: '4:32',
            monthly_plays: 238528, playcount: 1795709,
            status: 'active', last_checked: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
            id: 'demo-7', spotify_id: '8mXk2j', type: 'track',
            name: 'All Night Long â€” Saxophone Lounge Mix',
            image: 'https://picsum.photos/seed/track2/128/128',
            owner_name: 'Nina Sax', owner_image: 'https://randomuser.me/api/portraits/women/31.jpg',
            added_date: '10/02 11:20', saves: 7400, duration: '3:48',
            monthly_plays: 238528, playcount: 570994,
            status: 'active', last_checked: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
            id: 'demo-8', spotify_id: '3kLmNp', type: 'track',
            name: 'Slow Tunes â€” Late Night Jazz Session',
            image: 'https://picsum.photos/seed/track3/128/128',
            owner_name: 'Jazz Keys', owner_image: 'https://randomuser.me/api/portraits/men/42.jpg',
            added_date: '10/02 11:20', saves: 12100, duration: '5:12',
            monthly_plays: 238528, playcount: 976684,
            status: 'active', last_checked: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
            id: 'demo-9', spotify_id: 'Xp4qR8', type: 'playlist',
            name: 'Late Night Bar â€” Smooth Saxophone & Whiskey Blues',
            image: 'https://picsum.photos/seed/jazz7/128/128',
            owner_name: 'Chris Miller', owner_image: 'https://randomuser.me/api/portraits/men/85.jpg',
            added_date: '10/02 11:20', followers: 1200, saves: 1200, track_count: 122,
            status: 'error', error_code: 403, error_message: 'Forbidden',
            last_checked: new Date(Date.now() - 3 * 3600000).toISOString(),
        },
        {
            id: 'demo-10', spotify_id: '0Pq2', type: 'playlist',
            name: 'Jazz Morning â˜• Positive Energy Bossa Nova & CafÃ© Music',
            image: 'https://picsum.photos/seed/lofi8/128/128',
            owner_name: 'JazzBot', owner_image: null,
            added_date: '10/02 11:24', followers: 92500, saves: 92500, track_count: 450,
            monthly_plays: 2341072, total_plays: 42620900,
            status: 'active', last_checked: new Date(Date.now() - 5 * 3600000).toISOString(),
        },
        {
            id: 'demo-11', spotify_id: '4kFd9X', type: 'artist',
            name: 'Bill Evans',
            image: 'https://picsum.photos/seed/artist1/128/128',
            owner_name: 'Bill Evans', owner_image: 'https://picsum.photos/seed/artist1/128/128',
            added_date: '11/02 09:30', followers: 1245000, monthly_listeners: 3892400,
            album_count: 42,
            status: 'active', last_checked: new Date(Date.now() - 2 * 3600000).toISOString(),
        },
    ];
}


async function loadVirtualPage(offset, opts = {}) {
    const normalizedOffset = Math.max(0, Math.floor(Number(offset || 0) / CONFIG.LIST_PAGE_SIZE) * CONFIG.LIST_PAGE_SIZE);
    if (!state.listScopeKey) return;
    if (state.loadedPageOffsets.has(normalizedOffset)) return;
    if (state.loadingPagePromises.has(normalizedOffset)) {
        return state.loadingPagePromises.get(normalizedOffset);
    }
    const requestId = opts.requestId || state.dataLoadRequestId;
    const scopeKey = state.listScopeKey;
    const pagePromise = (async () => {
        state.loadingPageOffsets.add(normalizedOffset);
        try {
            const data = await api.getItems({
                ...state.currentListParams,
                limit: CONFIG.LIST_PAGE_SIZE,
                offset: normalizedOffset,
            });
            if (requestId !== state.dataLoadRequestId || scopeKey !== state.listScopeKey) return;
            if (!data) return;
            const incoming = data.items || data || [];
            commitPageItems(incoming, normalizedOffset, data.total);
            if (!opts.silent) {
                renderList({
                    preserveScroll: Boolean(opts.preserveScroll),
                    force: Boolean(opts.force),
                });
            }
        } catch (err) {
            if (requestId !== state.dataLoadRequestId) return;
            console.warn('loadVirtualPage error:', err);
        } finally {
            state.loadingPageOffsets.delete(normalizedOffset);
            state.loadingPagePromises.delete(normalizedOffset);
        }
    })();
    state.loadingPagePromises.set(normalizedOffset, pagePromise);
    return pagePromise;
}

async function loadAllVirtualItemsForCurrentScope() {
    const total = Number(state.listTotal || 0);
    if (!total) return [];
    if (getLoadedVirtualItems().length >= total) return getLoadedVirtualItems();
    const requestId = state.dataLoadRequestId;
    const scopeKey = state.listScopeKey;
    const offsets = [];
    for (let offset = 0; offset < total; offset += CONFIG.LIST_PAGE_SIZE) {
        offsets.push(offset);
    }
    await Promise.all(offsets.map((offset) => loadVirtualPage(offset, {
        requestId,
        preserveScroll: false,
        force: false,
    })));
    if (requestId !== state.dataLoadRequestId || scopeKey !== state.listScopeKey) {
        throw new Error('List scope changed while loading all links');
    }
    return getLoadedVirtualItems();
}

async function loadData(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
    const force = Boolean(opts?.force);
    const requestId = ++state.dataLoadRequestId;
    const skeleton = document.getElementById('skeleton-container');

    // Keep health async so list rendering is not blocked by a separate round-trip.
    api.health()
        .then(() => {
            state.apiOnline = true;
            updateApiStatus();
        })
        .catch(() => {
            state.apiOnline = false;
            updateApiStatus();
        });

    // Fetch items
    try {
        const currentUser = getAuthUser();
        let params = {};
        params = getBackendListParams();
        // Discover named groups without displaying an aggregate item page.
        if (state.activeGroup === ALL_GROUP_ID) {
            const ownerParams = params.user_id ? { user_id: params.user_id } : {};
            const discovery = await api.getItemsSummary(ownerParams);
            if (requestId !== state.dataLoadRequestId) return;
            state.itemSummary = discovery || null;
            syncGroupUI(true);
            params = getBackendListParams();
            if (state.activeGroup === ALL_GROUP_ID) {
                state.items = [];
                resetVirtualList(0, params);
                state.itemSummary = { ...(discovery || {}), total: 0, active: 0, errors: 0, crawling: 0 };
                if (skeleton) skeleton.style.display = 'none';
                renderList({ preserveScroll, force });
                return;
            }
        }
        const previousScopeKey = state.listScopeKey;
        const previousTotal = state.listTotal;
        state.currentListParams = { ...params };
        state.listScopeKey = getBackendListScopeKey(params);
        const pageParams = {
            ...params,
            limit: CONFIG.LIST_PAGE_SIZE,
            offset: 0,
        };
        const [summary, data] = await Promise.all([
            api.getItemsSummary(params),
            api.getItems(pageParams),
        ]);
        if (requestId !== state.dataLoadRequestId) return;
        if (!data) return;
        const incoming = data.items || data || [];
        state.itemSummary = summary || null;
        const total = Number(summary?.total ?? data.total ?? incoming.length);
        resetVirtualList(total, params, {
            preserveLoaded: previousScopeKey === getBackendListScopeKey(params) && previousTotal === total,
        });
        state.itemSummary = summary || null;
        commitPageItems(incoming, 0, total);
        saveCurrentListScopeCache();
        if (skeleton) skeleton.style.display = 'none';
        renderList({ preserveScroll, force });
        scheduleWarmCurrentListScope();
        scheduleSmallGroupPrefetch();
    } catch (err) {
        if (requestId !== state.dataLoadRequestId) return;
        console.error('loadData error:', err);
        if (skeleton) skeleton.style.display = 'none';
        if (getAuthToken()) {
            state.items = [];
            resetVirtualList(0, getBackendListParams());
            state.itemSummary = null;
        } else {
            state.items = applyPersistedItemOrder(getDemoData());
        }
        syncSelectedItemsWithState();
        syncGroupUI(true);
        renderList({ preserveScroll, force });
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HERO IMAGE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function runBackgroundSync(opts = {}) {
    const force = Boolean(opts?.force);
    if (state.remoteSyncInFlight) return;
    if (!getAuthToken()) return;
    if (!force && document.hidden) return;
    if (!force && state.pendingJobs.size > 0) return;
    if (!force && state.currentView && state.currentView !== 'linkchecker') return;
    if (!force && state.currentView === 'linkchecker' && state.listTotal > CONFIG.LIST_PAGE_SIZE) return;

    state.remoteSyncInFlight = true;
    try {
        await syncGroupsFromServer();
        await loadData({ preserveScroll: true });
    } catch (err) {
        console.warn('[Background Sync] Failed:', err.message);
    } finally {
        state.remoteSyncInFlight = false;
    }
}

function startBackgroundSync() {
    if (state.remoteSyncTimer) return;
    state.remoteSyncTimer = setInterval(() => {
        runBackgroundSync();
    }, CONFIG.BACKGROUND_SYNC_INTERVAL);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            runBackgroundSync({ force: true });
        }
    });
    window.addEventListener('focus', () => {
        runBackgroundSync({ force: true });
    });
}

function updateHeroImage() {
    const hero = document.querySelector('.playlist-hero');
    if (!hero) return;
    const firstCover = document.querySelector('.list-grid .custom-grid-row img');
    const src = firstCover && firstCover.getAttribute('src');

    const upscaleCover = (url) => {
        if (!url) return '';
        if (url.includes('picsum.photos/seed/')) {
            return url.replace(/\/\d+\/\d+(\?.*)?$/, '/1800/900');
        }
        return url;
    };

    const heroImage = upscaleCover(src) || 'https://picsum.photos/seed/spotify-warm-cover/1800/900';
    hero.style.setProperty('--hero-image', `url('${heroImage}')`);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STICKY HEADER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function initStickyHeader() {
    const listWrap = document.querySelector('.list-wrap');
    const listHead = document.querySelector('.list-head');
    if (!listWrap || !listHead) return;

    const updateStickyState = () => {
        const stuck = listWrap.scrollTop >= listHead.offsetTop;
        listHead.classList.toggle('is-stuck', stuck);
    };
    updateStickyState();
    listWrap.addEventListener('scroll', updateStickyState, { passive: true });
    window.addEventListener('resize', updateStickyState);
}

function initVirtualListScroll() {
    const listWrap = document.querySelector('.list-wrap');
    if (!listWrap || listWrap.dataset.virtualScrollBound === 'true') return;
    listWrap.dataset.virtualScrollBound = 'true';
    let raf = null;
    const scheduleRender = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = null;
            if (state.currentView === 'linkchecker' && state.listTotal > 0) {
                renderList({ preserveScroll: false, force: true });
            }
        });
    };
    listWrap.addEventListener('scroll', scheduleRender, { passive: true });
    window.addEventListener('resize', scheduleRender);
}


// ===================================================================
// VIEW MANAGEMENT â€” single source of truth for panel switching
// ===================================================================

state.currentView = 'channels'; // linkchecker | channels | settings | account | users

function setElementDisplay(el, mode) {
    if (!el) return;
    if (!mode) {
        el.style.removeProperty('display');
        return;
    }
    el.style.display = mode;
}

function updateAddLinkAvailability() {
    const canAdd = state.currentView === 'linkchecker' && state.activeGroup !== ALL_GROUP_ID;
    const buttons = [
        document.getElementById('btn-add-link'),
        document.getElementById('btn-empty-add-link'),
    ].filter(Boolean);
    buttons.forEach((button) => {
        button.disabled = !canAdd;
        button.setAttribute('aria-disabled', String(!canAdd));
        button.title = canAdd ? 'Add a link to the selected group' : 'Select a group before adding links';
        button.classList.toggle('opacity-50', !canAdd);
        button.classList.toggle('cursor-not-allowed', !canAdd);
        button.classList.toggle('cursor-pointer', canAdd);
    });
}

function switchToView(view) {
    var listWrap = document.querySelector('.list-wrap');
    var settingsPanel = document.getElementById('settings-panel');
    var accountPanel = document.getElementById('account-panel');
    var channelsPanel = document.getElementById('channels-panel');
    var adminPanel = document.getElementById('admin-users-panel');
    var btnRefresh = document.getElementById('btn-refresh');
    var btnAddLink = document.getElementById('btn-add-link');
    var searchWrap = document.getElementById('search-input') ? document.getElementById('search-input').parentElement : null;
    var breadcrumb = document.getElementById('breadcrumb-group');
    var pageTitle = document.getElementById('page-title');
    // Find the breadcrumb parent label (e.g. "Link Checker" > "All Links")
    var breadcrumbParent = breadcrumb && breadcrumb.previousElementSibling
        ? breadcrumb.previousElementSibling.previousElementSibling
        : null;

    // 1) Hide ALL panels
    setElementDisplay(listWrap, 'none');
    setElementDisplay(settingsPanel, 'none');
    setElementDisplay(accountPanel, 'none');
    setElementDisplay(channelsPanel, 'none');
    window.ChannelPlaylists?.hide();
    setElementDisplay(document.getElementById('spotify-header-tools'), view === 'linkchecker' ? null : 'none');
    setElementDisplay(document.getElementById('channel-header-tools'), view === 'channels' ? 'flex' : 'none');
    setElementDisplay(adminPanel, 'none');

    // 2) Update sidebar nav active state
    var navMap = { linkchecker: 'nav-links', channels: 'nav-channels', settings: 'nav-settings', account: 'nav-settings', users: 'nav-users' };
    document.querySelectorAll('#sidebar nav a').forEach(function(a) {
        a.classList.remove('text-white', 'bg-white/10');
        a.classList.add('text-secondary-text');
        var icon = a.querySelector('.material-icons-round');
        if (icon) icon.classList.remove('text-primary');
    });
    var activeNav = document.getElementById(navMap[view]);
    if (activeNav) {
        activeNav.classList.add('text-white', 'bg-white/10');
        activeNav.classList.remove('text-secondary-text');
        var icon = activeNav.querySelector('.material-icons-round');
        if (icon) icon.classList.add('text-primary');
    }

    // 3) Show/hide toolbar (only for linkchecker)
    var showToolbar = (view === 'linkchecker');
    setElementDisplay(btnRefresh, showToolbar ? null : 'none');
    setElementDisplay(btnAddLink, showToolbar ? null : 'none');
    setElementDisplay(searchWrap, showToolbar ? null : 'none');

    // 4) Show the correct panel and load its data
    state.currentView = view;
    document.body.classList.toggle('channels-view', view === 'channels');
    updateAddLinkAvailability();
    const groupPanel = document.getElementById('group-panel');
    if (groupPanel) {
        setElementDisplay(groupPanel, ['linkchecker', 'channels'].includes(view) ? null : 'none');
        Array.from(groupPanel.children).forEach((child) => {
            if (child.id !== 'admin-badge') {
                setElementDisplay(child, ['channel-group-rail', 'channel-group-tools'].includes(child.id)
                    ? (view === 'channels' ? null : 'none')
                    : (view === 'linkchecker' ? null : 'none'));
            }
        });
    }
    setElementDisplay(document.querySelector('main > footer'), view === 'linkchecker' ? null : 'none');

    if (view === 'linkchecker') {
        setElementDisplay(listWrap, null);
        rebuildGroups();
        renderList({ preserveScroll: true, force: true });
        if (breadcrumbParent) breadcrumbParent.textContent = 'Link Checker';
        updateGroupHeader();
        showInstantListOrLoading(getBackendListParams(), {
            keepCurrentOnMiss: true,
            preserveScroll: true,
        });
        loadData({ preserveScroll: true });
    } else if (view === 'settings') {
        setElementDisplay(settingsPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'YouTube';
        if (breadcrumb) breadcrumb.textContent = 'Settings';
        if (pageTitle) pageTitle.textContent = 'API & Export Settings';
        loadSettingsData();
        window.ChannelPlaylists?.showKeySettings(document.getElementById('youtube-key-settings'));
    } else if (view === 'account') {
        setElementDisplay(accountPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'Account';
        if (breadcrumb) breadcrumb.textContent = 'Profile';
        if (pageTitle) pageTitle.textContent = 'Account Settings';
        loadSettingsData();
    } else if (view === 'channels') {
        setElementDisplay(channelsPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'YouTube';
        if (breadcrumb) breadcrumb.textContent = 'Channel & Playlist';
        if (pageTitle) pageTitle.textContent = 'Channel & Playlist';
        window.ChannelPlaylists?.show();
    } else if (view === 'users') {
        setElementDisplay(adminPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'Admin';
        if (breadcrumb) breadcrumb.textContent = 'Users';
        if (pageTitle) pageTitle.textContent = 'User Management';
        loadAdminUsers({ force: true });
    }
}

// Legacy wrappers for backward compatibility
function showSettings() { switchToView('settings'); }
function hideSettings() {
    if (state.currentView === 'settings') switchToView('linkchecker');
}
function showAdminUsers() { switchToView('users'); }
function hideAdminUsers() {
    if (state.currentView === 'users') switchToView('linkchecker');
}

function loadSettingsData() {
    const user = getAuthUser();
    if (!user) return;

    const globalExportPanel = document.getElementById('settings-global-export');
    const globalExportInput = document.getElementById('settings-playlist-clipboard-limit');
    if (globalExportPanel) {
        globalExportPanel.style.display = user.role === 'admin' ? '' : 'none';
    }
    if (globalExportInput) {
        globalExportInput.value = String(getPlaylistClipboardLineLimit());
    }

    document.getElementById('settings-username').value = user.username || '';
    document.getElementById('settings-displayname').value = user.display_name || '';
    document.getElementById('settings-role').textContent = getRoleLabel(user.role);
    document.getElementById('settings-created').textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '-';

    updateSettingsAvatar(user);

    document.getElementById('settings-current-pw').value = '';
    document.getElementById('settings-new-pw').value = '';
    document.getElementById('settings-confirm-pw').value = '';
}

async function handleSaveGlobalSettings() {
    const input = document.getElementById('settings-playlist-clipboard-limit');
    const statusEl = document.getElementById('settings-global-status');
    if (!input || !statusEl) return;

    const rawValue = String(input.value || '').trim();
    const value = Number(rawValue);
    if (!/^\d+$/.test(rawValue) || !Number.isInteger(value)
        || value < MIN_PLAYLIST_CLIPBOARD_LINE_LIMIT
        || value > MAX_PLAYLIST_CLIPBOARD_LINE_LIMIT) {
        statusEl.textContent = 'Enter an integer from 1 to 2000';
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        return;
    }

    try {
        const response = await api.saveAdminPreferences({
            playlist_clipboard_line_limit: value,
        });
        state.globalPreferences = normalizeGlobalPreferences(response?.global_preferences || {
            playlist_clipboard_line_limit: value,
        });
        input.value = String(getPlaylistClipboardLineLimit());
        statusEl.textContent = 'Saved for all accounts';
        statusEl.style.display = '';
        statusEl.style.color = '#1db954';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }
}

function updateSettingsAvatar(user) {
    const preview = document.getElementById('settings-avatar-preview');
    if (!preview) return;
    if (user.avatar) {
        preview.innerHTML = '<img src="' + user.avatar + '" class="w-full h-full object-cover">';
    } else {
        const initials = (user.display_name || user.username || '??').slice(0, 2).toUpperCase();
        preview.innerHTML = initials;
    }
}

async function handleSaveProfile() {
    const displayName = document.getElementById('settings-displayname').value.trim();
    const statusEl = document.getElementById('settings-profile-status');

    try {
        const token = getAuthToken();
        const res = await fetch(CONFIG.API_BASE + '/auth/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ display_name: displayName || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to update profile');

        localStorage.setItem('spoticheck_user', JSON.stringify(data));
        setupAuthUI();

        statusEl.textContent = 'Saved!';
        statusEl.style.display = '';
        statusEl.style.color = '#1db954';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }
}

async function handleChangePassword() {
    const currentPw = document.getElementById('settings-current-pw').value;
    const newPw = document.getElementById('settings-new-pw').value;
    const confirmPw = document.getElementById('settings-confirm-pw').value;
    const statusEl = document.getElementById('settings-pw-status');

    if (!currentPw || !newPw) { statusEl.textContent = 'Please fill in all fields'; statusEl.style.display = ''; statusEl.style.color = '#ef4444'; return; }
    if (newPw !== confirmPw) { statusEl.textContent = 'New passwords do not match'; statusEl.style.display = ''; statusEl.style.color = '#ef4444'; return; }
    if (newPw.length < 4) { statusEl.textContent = 'Password must be at least 4 characters'; statusEl.style.display = ''; statusEl.style.color = '#ef4444'; return; }

    try {
        const token = getAuthToken();
        const res = await fetch(CONFIG.API_BASE + '/auth/me/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to change password');

        document.getElementById('settings-current-pw').value = '';
        document.getElementById('settings-new-pw').value = '';
        document.getElementById('settings-confirm-pw').value = '';

        statusEl.textContent = 'Password changed!';
        statusEl.style.display = '';
        statusEl.style.color = '#1db954';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }
}

async function handleAvatarUpload(file) {
    if (!file) return;
    if (file.size > 500000) { showToast('Image too large (max 500KB)', 'error'); return; }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const dataUrl = e.target.result;
        try {
            const token = getAuthToken();
            const res = await fetch(CONFIG.API_BASE + '/auth/me/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ avatar: dataUrl }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to upload avatar');

            const user = getAuthUser();
            user.avatar = dataUrl;
            localStorage.setItem('spoticheck_user', JSON.stringify(user));
            updateSettingsAvatar(user);
            setupAuthUI();
            showToast('Avatar updated!', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
    reader.readAsDataURL(file);
}

async function handleAvatarRemove() {
    try {
        const token = getAuthToken();
        const res = await fetch(CONFIG.API_BASE + '/auth/me/avatar', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }

        const user = getAuthUser();
        user.avatar = null;
        localStorage.setItem('spoticheck_user', JSON.stringify(user));
        updateSettingsAvatar(user);
        setupAuthUI();
        showToast('Avatar removed', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}



// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CUSTOM DROPDOWN COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Creates a custom dropdown replacing a native <select>
 * @param {object} opts - { id, options: [{value, label}], selected, onChange, cssClass }
 * @returns {HTMLElement} the custom dropdown element
 */
function createCustomDropdown(opts) {
    var wrap = document.createElement('div');
    wrap.className = 'custom-dropdown' + (opts.cssClass ? ' ' + opts.cssClass : '');
    wrap.id = (opts.id || '') + '-dropdown';
    wrap.setAttribute('data-value', opts.selected || '');

    var arrowSvg = '<svg class="custom-dropdown-arrow" viewBox="0 0 12 8" fill="none"><path d="M1 1.5l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var selectedLabel = '';
    for (var i = 0; i < opts.options.length; i++) {
        if (opts.options[i].value === (opts.selected || '')) {
            selectedLabel = opts.options[i].label;
            break;
        }
    }
    if (!selectedLabel && opts.options.length > 0) selectedLabel = opts.options[0].label;

    var toggle = document.createElement('div');
    toggle.className = 'custom-dropdown-toggle';
    toggle.setAttribute('tabindex', '0');
    toggle.innerHTML = '<span class="custom-dropdown-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + selectedLabel + '</span>' + arrowSvg;
    wrap.appendChild(toggle);

    var menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';

    for (var i = 0; i < opts.options.length; i++) {
        var opt = document.createElement('div');
        opt.className = 'custom-dropdown-option' + (opts.options[i].value === (opts.selected || '') ? ' selected' : '');
        opt.setAttribute('data-value', opts.options[i].value);
        opt.textContent = opts.options[i].label;
        menu.appendChild(opt);
    }
    wrap.appendChild(menu);

    // Toggle open/close
    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        // Close all other open dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(function(d) {
            if (d !== wrap) d.classList.remove('open');
        });
        wrap.classList.toggle('open');
    });

    toggle.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle.click();
        } else if (e.key === 'Escape') {
            wrap.classList.remove('open');
        }
    });

    // Select option
    menu.addEventListener('click', function(e) {
        var optEl = e.target.closest('.custom-dropdown-option');
        if (!optEl) return;
        var val = optEl.getAttribute('data-value');
        wrap.setAttribute('data-value', val);
        toggle.querySelector('.custom-dropdown-label').textContent = optEl.textContent;
        menu.querySelectorAll('.custom-dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
        optEl.classList.add('selected');
        wrap.classList.remove('open');
        if (opts.onChange) opts.onChange(val);
    });

    return wrap;
}

// Update options of an existing custom dropdown
function updateCustomDropdownOptions(dropdownId, options, selected) {
    var wrap = document.getElementById(dropdownId);
    if (!wrap) return;
    var menu = wrap.querySelector('.custom-dropdown-menu');
    var label = wrap.querySelector('.custom-dropdown-label');
    if (!menu || !label) return;

    menu.innerHTML = '';
    var selectedLabel = '';
    for (var i = 0; i < options.length; i++) {
        var opt = document.createElement('div');
        opt.className = 'custom-dropdown-option' + (options[i].value === (selected || '') ? ' selected' : '');
        opt.setAttribute('data-value', options[i].value);
        opt.textContent = options[i].label;
        menu.appendChild(opt);
        if (options[i].value === (selected || '')) selectedLabel = options[i].label;
    }
    if (!selectedLabel && options.length > 0) selectedLabel = options[0].label;
    label.textContent = selectedLabel;
    wrap.setAttribute('data-value', selected || '');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function() {
    document.querySelectorAll('.custom-dropdown.open').forEach(function(d) {
        d.classList.remove('open');
    });
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ADMIN USER MANAGEMENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let _adminUsersCache = [];

function renderAdminUsersLoading() {
    var container = document.getElementById('admin-users-list');
    var countEl = document.getElementById('admin-users-count');
    if (!container) return;
    if (countEl) countEl.textContent = 'Loading...';
    container.innerHTML = '<div class="p-5 rounded-xl border border-white/10 text-sm text-secondary-text" style="background:#1a1d21">Loading users...</div>';
}


async function _fetchAdminUsers(opts) {
    opts = opts || {};
    var now = Date.now();
    var hasCache = Array.isArray(_adminUsersCache) && _adminUsersCache.length > 0;
    var cacheFresh = hasCache && (now - state.adminUsersCacheTs) < 60_000;
    if (opts.preferCache && cacheFresh) {
        return _adminUsersCache;
    }
    if (state.adminUsersPromise) {
        return state.adminUsersPromise;
    }

    const token = getAuthToken();
    state.adminUsersPromise = fetch(CONFIG.API_BASE + '/auth/users', {
        headers: { 'Authorization': 'Bearer ' + token },
    })
    .then(async function(res) {
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();
        _adminUsersCache = Array.isArray(data) ? data : (data.users || []);
        state.adminUserList = _adminUsersCache.slice();
        state.adminUsersCacheTs = Date.now();
        return _adminUsersCache;
    })
    .finally(function() {
        state.adminUsersPromise = null;
    });

    return state.adminUsersPromise;
}

async function loadAdminUsers(opts) {
    opts = opts || {};
    try {
        var force = Boolean(opts.force);
        var hasCache = Array.isArray(_adminUsersCache) && _adminUsersCache.length > 0;
        if (hasCache && !force) {
            renderAdminUsers(_adminUsersCache);
        } else {
            renderAdminUsersLoading();
        }
        const users = await _fetchAdminUsers({ preferCache: !force });
        renderAdminUsers(users);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderAdminUsers(users) {
    var container = document.getElementById('admin-users-list');
    var countEl = document.getElementById('admin-users-count');
    if (!container) return;
    if (countEl) countEl.textContent = users.length + ' user' + (users.length !== 1 ? 's' : '');

    var currentUser = getAuthUser();
    var html = '';

    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        var initials = (u.display_name || u.username || '??').slice(0, 2).toUpperCase();
        var avatarHtml = u.avatar
            ? '<img src="' + u.avatar + '" class="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10">'
            : '<div class="w-12 h-12 rounded-full flex-shrink-0 bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-700 text-white text-sm font-bold grid place-items-center ring-1 ring-white/10">' + initials + '</div>';

        var roleBadge = u.role === 'admin' || u.role === 'manager'
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full"><span class="material-icons-round" style="font-size:12px">admin_panel_settings</span>Admin</span>'
            : '<span class="text-[11px] font-bold uppercase tracking-wider text-secondary-text bg-white/5 px-2 py-0.5 rounded-full">User</span>';

        var statusBadge = u.is_active
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Active</span>'
            : '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-red-400"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Inactive</span>';

        var lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString() + ' ' + new Date(u.last_login).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'Never';
        var created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '-';

        var isSelf = currentUser && currentUser.id === u.id;

        var extraBtns = '';
        var canEdit = currentUser?.role === 'admin' || (u.role === 'user' && u.manager_id === currentUser?.id);
        if (!isSelf && canEdit) {
            var toggleColor = u.is_active ? 'red' : 'emerald';
            var toggleTitle = u.is_active ? 'Deactivate' : 'Activate';
            var toggleIcon = u.is_active ? 'person_off' : 'person';
            extraBtns = '<button data-action="toggle-active" data-uid="' + u.id + '" data-uname="' + u.username + '" data-active="' + u.is_active + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-' + toggleColor + '-400 transition-colors cursor-pointer" title="' + toggleTitle + '"><span class="material-icons-round text-lg">' + toggleIcon + '</span></button>' +
                '<button data-action="delete-user" data-uid="' + u.id + '" data-uname="' + u.username + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-red-500 transition-colors cursor-pointer" title="Delete user permanently"><span class="material-icons-round text-lg">delete_forever</span></button>';
        }

        html += '<div class="p-5 rounded-xl border border-white/10 hover:border-white/20 transition-colors" style="background:#1a1d21">' +
            '<div class="flex items-center gap-4">' +
                avatarHtml +
                '<div class="flex-1 min-w-0">' +
                    '<div class="flex items-center gap-2 mb-0.5 flex-wrap">' +
                        '<span class="font-semibold text-white truncate">' + (u.display_name || u.username) + '</span>' +
                        roleBadge.replace('>Admin</span>', '>' + getRoleLabel(u.role) + '</span>') +
                        statusBadge +
                        (isSelf ? '<span class="text-[11px] text-secondary-text">(you)</span>' : '') +
                    '</div>' +
                    '<div class="text-sm text-secondary-text truncate">@' + escapeHtml(u.username) + '</div>' +
                    (u.manager_id ? '<div class="text-xs text-secondary-text">Manager: ' + escapeHtml(_adminUsersCache.find((manager) => manager.id === u.manager_id)?.display_name || _adminUsersCache.find((manager) => manager.id === u.manager_id)?.username || 'Assigned') + '</div>' : '') +
                    '<div class="text-xs text-secondary-text mt-1">Joined ' + created + ' &middot; Last login: ' + lastLogin + '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 flex-shrink-0"' + (canEdit ? '' : ' style="display:none"') + '>' +
                    '<button data-action="edit-user" data-uid="' + u.id + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-white transition-colors cursor-pointer" title="Edit user"><span class="material-icons-round text-lg">edit</span></button>' +
                    '<button data-action="reset-pw" data-uid="' + u.id + '" data-uname="' + u.username + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-white transition-colors cursor-pointer" title="Reset password"><span class="material-icons-round text-lg">lock_reset</span></button>' +
                    extraBtns +
                '</div>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

function openAdminEditModal(userId) {
    var user = _adminUsersCache.find(function(u) { return u.id === userId; });
    if (!user) { loadAdminUsers(); return; }

    document.getElementById('admin-edit-user-id').value = user.id;
    document.getElementById('admin-edit-username').value = user.username;
    document.getElementById('admin-edit-displayname').value = user.display_name || '';
    // Create or update role dropdown
    var roleWrap = document.getElementById('admin-edit-role-wrap');
    if (roleWrap) {
        var existingRoleDD = document.getElementById('admin-edit-role-dropdown');
        if (existingRoleDD) {
            updateCustomDropdownOptions('admin-edit-role-dropdown', getAssignableRoles(), user.role);
        } else {
            var roleDD = createCustomDropdown({
                id: 'admin-edit-role',
                options: getAssignableRoles(),
                selected: user.role,
                onChange: () => updateManagerAssignmentVisibility('admin-edit'),
            });
            roleWrap.innerHTML = '';
            roleWrap.appendChild(roleDD);
        }
    }
    setupManagerAssignment('admin-edit', user.manager_id);
    document.getElementById('admin-edit-status').style.display = 'none';
    document.getElementById('admin-edit-status').textContent = '';

    var modal = document.getElementById('admin-edit-modal');
    if (modal) modal.classList.add('open');
}

function openAdminCreateModal() {
    document.getElementById('admin-create-username').value = '';
    document.getElementById('admin-create-displayname').value = '';
    document.getElementById('admin-create-password').value = '';

    var roleWrap = document.getElementById('admin-create-role-wrap');
    if (roleWrap) {
        var existingRoleDD = document.getElementById('admin-create-role-dropdown');
        if (existingRoleDD) {
            updateCustomDropdownOptions('admin-create-role-dropdown', getAssignableRoles(), 'user');
        } else {
            var roleDD = createCustomDropdown({
                id: 'admin-create-role',
                cssClass: 'dropdown-modal',
                options: getAssignableRoles(),
                selected: 'user',
                onChange: () => updateManagerAssignmentVisibility('admin-create'),
            });
            roleWrap.innerHTML = '';
            roleWrap.appendChild(roleDD);
        }
    }

    setupManagerAssignment('admin-create');
    var statusEl = document.getElementById('admin-create-status');
    statusEl.style.display = 'none';
    statusEl.textContent = '';

    var modal = document.getElementById('admin-create-modal');
    if (modal) modal.classList.add('open');
}

function closeAdminCreateModal() {
    var modal = document.getElementById('admin-create-modal');
    if (modal) modal.classList.remove('open');
}

function closeAdminEditModal() {
    var modal = document.getElementById('admin-edit-modal');
    if (modal) modal.classList.remove('open');
}

async function submitAdminCreateUser() {
    var username = document.getElementById('admin-create-username').value.trim();
    var displayName = document.getElementById('admin-create-displayname').value.trim();
    var password = document.getElementById('admin-create-password').value;
    var roleDD = document.getElementById('admin-create-role-dropdown');
    var role = roleDD ? roleDD.getAttribute('data-value') : 'user';
    var statusEl = document.getElementById('admin-create-status');

    statusEl.style.display = 'none';
    statusEl.textContent = '';

    if (!username || !password) {
        statusEl.textContent = 'Username and password are required';
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        return;
    }

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({
                username: username,
                password: password,
                display_name: displayName || null,
                role: role || 'user',
                ...getManagerAssignment('admin-create', role),
            }),
        });
        var data = await res.json().catch(function() { return {}; });
        if (!res.ok) throw new Error(data.detail || 'Failed to create user');

        showToast('User ' + username + ' created', 'success');
        closeAdminCreateModal();
        await loadAdminUsers({ force: true });
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
    }
}

async function saveAdminEditUser() {
    var userId = document.getElementById('admin-edit-user-id').value;
    var displayName = document.getElementById('admin-edit-displayname').value.trim();
    var username = document.getElementById('admin-edit-username').value.trim();
    var roleDD = document.getElementById('admin-edit-role-dropdown');
    var role = roleDD ? roleDD.getAttribute('data-value') : 'user';
    var statusEl = document.getElementById('admin-edit-status');

    statusEl.style.display = 'none';
    statusEl.textContent = '';

    if (!username) {
        statusEl.textContent = 'Username is required';
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        return;
    }

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ username: username, display_name: displayName || null, role: role, ...getManagerAssignment('admin-edit', role) }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to update user');

        showToast('User updated!', 'success');
        var currentUser = getAuthUser();
        if (currentUser && String(currentUser.id || '') === String(userId)) {
            localStorage.setItem('spoticheck_user', JSON.stringify(data));
            setupAuthUI();
            loadSettingsData();
        }
        closeAdminEditModal();
        await loadAdminUsers({ force: true });
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(function() { statusEl.style.display = 'none'; }, 5000);
    }
}

function openAdminPwModal(userId, username) {
    document.getElementById('admin-pw-user-id').value = userId;
    document.getElementById('admin-pw-username').textContent = username;
    document.getElementById('admin-pw-new').value = '';
    document.getElementById('admin-pw-status').style.display = 'none';

    var modal = document.getElementById('admin-pw-modal');
    if (modal) modal.classList.add('open');
}

function closeAdminPwModal() {
    var modal = document.getElementById('admin-pw-modal');
    if (modal) modal.classList.remove('open');
}

async function submitAdminResetPassword() {
    var userId = document.getElementById('admin-pw-user-id').value;
    var newPw = document.getElementById('admin-pw-new').value;
    var statusEl = document.getElementById('admin-pw-status');

    if (!newPw || newPw.length < 4) {
        statusEl.textContent = 'Password must be at least 4 characters';
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        return;
    }

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId + '/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ new_password: newPw }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to reset password');

        showToast('Password reset successfully!', 'success');
        closeAdminPwModal();
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(function() { statusEl.style.display = 'none'; }, 5000);
    }
}

function handleEnterShortcutSubmit(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('textarea, [contenteditable="true"], .custom-dropdown')) return false;

    const editModalOpen = document.getElementById('admin-edit-modal')?.classList.contains('open');
    if (editModalOpen && target.closest('#admin-edit-modal')) {
        saveAdminEditUser();
        return true;
    }

    const createModalOpen = document.getElementById('admin-create-modal')?.classList.contains('open');
    if (createModalOpen && target.closest('#admin-create-modal')) {
        submitAdminCreateUser();
        return true;
    }

    const pwModalOpen = document.getElementById('admin-pw-modal')?.classList.contains('open');
    if (pwModalOpen && target.closest('#admin-pw-modal')) {
        submitAdminResetPassword();
        return true;
    }

    const settingsPanel = document.getElementById('settings-panel');
    const settingsVisible = settingsPanel && settingsPanel.style.display !== 'none';
    if (!settingsVisible || !target.closest('#settings-panel')) return false;

    if (target.closest('#settings-current-pw, #settings-new-pw, #settings-confirm-pw')) {
        handleChangePassword();
        return true;
    }
    if (target.closest('#settings-displayname')) {
        handleSaveProfile();
        return true;
    }
    return false;
}

async function adminToggleActive(userId, username, isCurrentlyActive) {
    var action = isCurrentlyActive ? 'deactivate' : 'activate';
    if (!confirm('Are you sure you want to ' + action + ' user "' + username + '"?')) return;

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ is_active: !isCurrentlyActive }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed');
        showToast('User ' + action + 'd!', 'success');
        await loadAdminUsers({ force: true });
    } catch (err) {
        showToast(err.message, 'error');
    }
}


async function adminDeleteUser(userId, username) {
    if (!confirm('WARNING: This will permanently delete user "' + username + '" and ALL their data (links, groups, crawl jobs).\n\nThis action CANNOT be undone. Continue?')) return;
    if (!confirm('Are you REALLY sure? Type OK to confirm you want to delete "' + username + '" permanently.')) return;

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token },
        });
        var raw = await res.text();
        var data = {};
        if (raw) {
            try {
                data = JSON.parse(raw);
            } catch {
                data = { detail: raw };
            }
        }
        if (!res.ok) throw new Error(data.detail || 'Failed to delete user');
        showToast('User ' + username + ' deleted permanently', 'success');
        await loadAdminUsers({ force: true });
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Expose to window for inline onclick handlers
window.openAdminEditModal = openAdminEditModal;
window.openAdminCreateModal = openAdminCreateModal;
window.closeAdminCreateModal = closeAdminCreateModal;
window.closeAdminEditModal = closeAdminEditModal;
window.submitAdminCreateUser = submitAdminCreateUser;
window.saveAdminEditUser = saveAdminEditUser;
window.openAdminPwModal = openAdminPwModal;
window.closeAdminPwModal = closeAdminPwModal;
window.submitAdminResetPassword = submitAdminResetPassword;
window.adminToggleActive = adminToggleActive;
window.adminDeleteUser = adminDeleteUser;
window.showAdminUsers = showAdminUsers;
window.hideAdminUsers = hideAdminUsers;


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    try {
        const user = await api._fetch('/auth/me');
        if (user) localStorage.setItem('spoticheck_user', JSON.stringify(user));
    } catch (err) {
        console.warn('[Auth] Could not refresh account:', err.message);
    }
    setupAuthUI();
    await hydrateUiPreferencesFromServer();
    state.columnWidths = loadPersistedColumnWidths();
    applyColumnWidths(state.columnWidths);
    setupColumnResizers();
    ensureMetricSortControls();
    ensureTextSortControls();
    ensureCheckedSortControls();
    syncColumnWidthsToViewport();
    window.addEventListener('resize', () => syncColumnWidthsToViewport());

    state.customGroups = loadCustomGroups();
    syncGroupUI(true);

    // Modal
    document.getElementById('btn-add-link').addEventListener('click', openModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-submit').addEventListener('click', submitSingle);
    document.getElementById('modal-batch-input').addEventListener('input', (e) => {
        updateModalLinkPreview(e.target.value);
    });
    document.getElementById('add-link-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeModal();
    });
    ['admin-edit-modal', 'admin-pw-modal', 'admin-create-modal'].forEach((modalId) => {
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;
        modalEl.addEventListener('click', (e) => {
            if (!e.target.classList.contains('modal-overlay')) return;
            if (modalId === 'admin-edit-modal') closeAdminEditModal();
            if (modalId === 'admin-pw-modal') closeAdminPwModal();
            if (modalId === 'admin-create-modal') closeAdminCreateModal();
        });
    });

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        handleSearch(e.target.value);
    });
    const adminCreateBtn = document.getElementById('admin-users-create-btn');
    if (adminCreateBtn) {
        adminCreateBtn.addEventListener('click', openAdminCreateModal);
    }
    const groupSearchInput = document.getElementById('group-search');
    if (groupSearchInput) {
        groupSearchInput.addEventListener('input', (e) => {
            state.groupSearchQuery = e.target.value || '';
            renderGroups();
        });
    }
    const groupList = document.getElementById('group-list');
    if (groupList) {
        groupList.addEventListener('mousedown', () => {
            state.selectionScope = 'groups';
        });
        groupList.addEventListener('click', (e) => {
            const deleteGroupBtn = e.target.closest('[data-action="delete-group"]');
            const saveRenameBtn = e.target.closest('[data-action="save-rename-group"]');
            const cancelRenameBtn = e.target.closest('[data-action="cancel-rename-group"]');
            const groupBtn = e.target.closest('[data-group]');
            const newGroupBtn = e.target.closest('[data-action="new-group"]');
            const createGroupBtn = e.target.closest('[data-action="create-group"]');
            const cancelCreateBtn = e.target.closest('[data-action="cancel-create-group"]');
            if (deleteGroupBtn) {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteGroup(deleteGroupBtn.getAttribute('data-group-id'));
                return;
            }
            if (saveRenameBtn) {
                e.preventDefault();
                e.stopPropagation();
                const groupId = saveRenameBtn.getAttribute('data-group-id');
                const selectorGroupId = escapeAttrSelectorValue(groupId || '');
                const input = groupList.querySelector(`[data-role="rename-group-input"][data-group-id="${selectorGroupId}"]`);
                handleRenameGroup(groupId, input?.value || '');
                return;
            }
            if (cancelRenameBtn) {
                e.preventDefault();
                e.stopPropagation();
                cancelRenameGroupFlow();
                return;
            }
            if (createGroupBtn) {
                const input = groupList.querySelector('[data-role="new-group-input"]');
                handleCreateGroup(input?.value);
                return;
            }
            if (cancelCreateBtn) {
                cancelCreateGroupFlow();
                return;
            }
            if (newGroupBtn) {
                startCreateGroupFlow();
                return;
            }
            if (e.target.closest('[data-role="rename-group-input"]')) return;
            if (!groupBtn) return;
            if (state.suppressNextGroupClick) {
                state.suppressNextGroupClick = false;
                return;
            }
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group')) || ALL_GROUP_ID;
            const groupName = e.target.closest('[data-role="group-name"]');
            const currentGroupId = normalizeGroupName(state.activeGroup) || ALL_GROUP_ID;
            const isPurePrimaryClick = !e.shiftKey && !e.ctrlKey && !e.metaKey;
            if (
                groupName
                && e.detail >= 2
                && isPurePrimaryClick
                && groupId.toLowerCase() !== ALL_GROUP_ID
                && groupId.toLowerCase() === currentGroupId.toLowerCase()
            ) {
                e.preventDefault();
                e.stopPropagation();
                startRenameGroupFlow(groupId);
                return;
            }
            if (state.renamingGroupId) return;
            handleGroupSelection(groupId, e);
            state.isCreatingGroup = false;
            clearRowSelection();
            updateAddLinkAvailability();
            // If currently on Settings or Users tab, navigate back to Link Checker
            if (state.currentView !== 'linkchecker') {
                switchToView('linkchecker');
            } else {
                updateGroupHeader();
                renderGroups();
                showInstantListOrLoading(getBackendListParams(), {
                    keepCurrentOnMiss: true,
                    preserveScroll: false,
                });
                loadData({ preserveScroll: false, force: true });
            }
        });
        groupList.addEventListener('dblclick', (e) => {
            const groupName = e.target.closest('[data-role="group-name"]');
            if (!groupName) return;
            const groupId = normalizeGroupName(groupName.getAttribute('data-group-id'));
            if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;
            const currentGroupId = normalizeGroupName(state.activeGroup) || ALL_GROUP_ID;
            if (groupId.toLowerCase() !== currentGroupId.toLowerCase()) return;
            e.preventDefault();
            e.stopPropagation();
            startRenameGroupFlow(groupId);
        });
        groupList.addEventListener('keydown', (e) => {
            const renameInput = e.target.closest('[data-role="rename-group-input"]');
            if (renameInput) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRenameGroup(renameInput.getAttribute('data-group-id'), renameInput.value);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRenameGroupFlow();
                    return;
                }
            }

            if (e.key !== 'Enter') return;
            const input = e.target.closest('[data-role="new-group-input"]');
            if (!input) return;
            e.preventDefault();
            handleCreateGroup(input.value);
        });
        groupList.addEventListener('focusout', (e) => {
            const renameInput = e.target.closest('[data-role="rename-group-input"]');
            if (!renameInput || !state.renamingGroupId) return;
            const related = e.relatedTarget;
            if (related && related.closest('[data-action="save-rename-group"], [data-action="cancel-rename-group"]')) {
                return;
            }
            handleRenameGroup(renameInput.getAttribute('data-group-id'), renameInput.value, { onBlur: true });
        });
        groupList.addEventListener('dragstart', (e) => {
            const groupBtn = e.target.closest('[data-group][draggable="true"]');
            if (!groupBtn || e.target.closest('[data-action="delete-group"], [data-role="rename-group-input"]')) {
                e.preventDefault();
                return;
            }
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) {
                e.preventDefault();
                return;
            }
            const selectedGroupIds = state.selectedGroupIds.has(groupId)
                ? Array.from(state.selectedGroupIds).filter((id) => String(id).toLowerCase() !== ALL_GROUP_ID)
                : [groupId];
            state.draggingGroupIds = selectedGroupIds;
            state.draggingGroupId = groupId;
            state.dragOverGroupId = groupId;
            state.dragOverGroupPlacement = 'before';
            state.suppressNextGroupClick = true;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', selectedGroupIds.join(','));
            }
            syncGroupDragUi(groupList);
        });
        groupList.addEventListener('dragover', (e) => {
            const groupBtn = e.target.closest('[data-group]');
            const draggingRows = state.draggingRowKeys.length > 0;
            if (!state.draggingGroupId && !draggingRows) return;
            updateDragAutoScroll(groupList, e.clientY);
            if (!groupBtn) return;
            const targetGroupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            if (!targetGroupId) return;
            e.preventDefault();
            if (draggingRows) {
                if (targetGroupId.toLowerCase() === ALL_GROUP_ID) return;
                if (targetGroupId === state.dragOverGroupId) return;
                state.dragOverGroupId = targetGroupId;
                state.dragOverGroupPlacement = 'before';
                syncGroupDragUi(groupList);
                return;
            }
            if (targetGroupId.toLowerCase() === ALL_GROUP_ID) return;
            const rect = groupBtn.getBoundingClientRect();
            const placement = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            if (targetGroupId === state.dragOverGroupId && placement === state.dragOverGroupPlacement) return;
            state.dragOverGroupId = targetGroupId;
            state.dragOverGroupPlacement = placement;
            syncGroupDragUi(groupList);
        });
        groupList.addEventListener('drop', async (e) => {
            const groupBtn = e.target.closest('[data-group]');
            if (!groupBtn) return;
            const targetGroupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            const draggingRows = state.draggingRowKeys.length > 0;
            if (draggingRows) {
                if (!targetGroupId || targetGroupId.toLowerCase() === ALL_GROUP_ID) return;
                e.preventDefault();
                stopDragAutoScroll();
                const targetGroup = getGroupEntryById(targetGroupId);
                const draggedItems = state.items.filter((item) => state.draggingRowKeys.includes(selectionKey(item)));
                const moved = await moveItemsToGroup(draggedItems, targetGroup);
                state.draggingRowKeys = [];
                state.dragOverRowKey = null;
                state.dragOverRowPlacement = 'before';
                state.dragOverGroupId = null;
                state.dragOverGroupPlacement = 'before';
                syncGroupDragUi(groupList);
                renderList({ preserveScroll: true });
                window.setTimeout(() => {
                    state.suppressNextRowClick = false;
                }, 0);
                return;
            }
            if (!state.draggingGroupId) return;
            e.preventDefault();
            stopDragAutoScroll();
            const moved = await moveCustomGroupsBefore(state.draggingGroupIds, targetGroupId, state.dragOverGroupPlacement);
            state.draggingGroupIds = [];
            state.draggingGroupId = null;
            state.dragOverGroupId = null;
            state.dragOverGroupPlacement = 'before';
            if (moved) {
                showToast(state.selectedGroupIds.size > 1 ? 'Group cluster moved' : 'Group order updated', 'success');
            }
            window.setTimeout(() => {
                state.suppressNextGroupClick = false;
            }, 0);
        });
        groupList.addEventListener('dragend', () => {
            if (!state.draggingGroupId && !state.dragOverGroupId && !state.draggingGroupIds.length) return;
            stopDragAutoScroll();
            state.draggingGroupIds = [];
            state.draggingGroupId = null;
            state.dragOverGroupId = null;
            state.dragOverGroupPlacement = 'before';
            syncGroupDragUi(groupList);
            window.setTimeout(() => {
                state.suppressNextGroupClick = false;
            }, 0);
        });
        groupList.addEventListener('dragleave', (e) => {
            if (!state.draggingGroupId && !state.draggingRowKeys.length) return;
            if (e.currentTarget.contains(e.relatedTarget)) return;
            stopDragAutoScroll();
        });
    }

    // Refresh/Clear fallback binding (skip when inline onclick exists)
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn && !refreshBtn.getAttribute('onclick')) {
        refreshBtn.addEventListener('click', refreshAllItems);
    }

    const clearBtn = document.getElementById('btn-clear-list');
    if (clearBtn && !clearBtn.getAttribute('onclick')) {
        clearBtn.addEventListener('click', clearList);
    }

    const listElForDelete = document.getElementById('link-list');
    if (listElForDelete) {
        const listScrollWrap = document.querySelector('.list-wrap');
        if (listScrollWrap) {
            listScrollWrap.addEventListener('mousedown', () => {
                state.selectionScope = 'items';
            });
        }
        listElForDelete.addEventListener('mousedown', () => {
            state.selectionScope = 'items';
        });
        listElForDelete.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (isInteractiveRowTarget(e.target)) return;
            const row = e.target.closest('.custom-grid-row');
            if (!row) return;
            const rowSelectionKey = row.dataset.selectionKey;
            const keepMultiSelection =
                !e.shiftKey
                && !e.ctrlKey
                && !e.metaKey
                && state.selectedItemKeys.size > 1
                && state.selectedItemKeys.has(rowSelectionKey);
            if (keepMultiSelection) return;
            const item = findItemFromRow(row);
            if (!item) return;
            handleRowSelection(item, e);
        });
        listElForDelete.addEventListener('click', (e) => {
            const copyBtn = e.target.closest('[data-action="copy-link"]');
            const previewBtn = e.target.closest('[data-action="preview-image"]');
            if (copyBtn) {
                e.preventDefault();
                e.stopPropagation();
                copyToClipboard(copyBtn.getAttribute('data-copy-value'), 'Link copied');
                return;
            }
            if (previewBtn) {
                e.preventDefault();
                e.stopPropagation();
                openImagePreview(previewBtn.getAttribute('data-image-url'));
                return;
            }
        });
        listElForDelete.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.custom-grid-row');
            // Keep native browser link context-menu on title/anchor right-click.
            if (e.target.closest('a[href]')) return;
            e.preventDefault();
            e.stopPropagation();
            showRowContextMenu(e.clientX, e.clientY, row || null);
        });
        if (listScrollWrap) {
            listScrollWrap.addEventListener('contextmenu', (e) => {
                if (e.target.closest('a[href]')) return;
                const row = e.target.closest('.custom-grid-row');
                if (row && row.closest('#link-list')) return;
                e.preventDefault();
                e.stopPropagation();
                showRowContextMenu(e.clientX, e.clientY, null);
            });
        }
        listElForDelete.addEventListener('dragstart', (e) => {
            const row = e.target.closest('.custom-grid-row');
            if (!row || isInteractiveRowTarget(e.target)) {
                e.preventDefault();
                return;
            }
            hideRowContextMenu();
            const draggedSelectionKey = row.dataset.selectionKey;
            const selectedKeys = state.selectedItemKeys.has(draggedSelectionKey)
                ? state.filteredItems
                    .filter((item) => state.selectedItemKeys.has(selectionKey(item)))
                    .map((item) => selectionKey(item))
                : [draggedSelectionKey];
            state.draggingRowKeys = selectedKeys;
            state.dragOverRowKey = draggedSelectionKey;
            state.dragOverRowPlacement = 'before';
            state.dragOverGroupId = null;
            state.suppressNextRowClick = true;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedSelectionKey);
            }
            syncRowDragUi(listElForDelete);
        });
        listElForDelete.addEventListener('dragover', (e) => {
            const row = e.target.closest('.custom-grid-row');
            if (!state.draggingRowKeys.length) return;
            updateDragAutoScroll(listScrollWrap, e.clientY);
            if (!row) return;
            const targetKey = row.dataset.selectionKey;
            if (!targetKey) return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const placement = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            if (targetKey === state.dragOverRowKey && placement === state.dragOverRowPlacement) return;
            state.dragOverRowKey = targetKey;
            state.dragOverRowPlacement = placement;
            syncRowDragUi(listElForDelete);
        });
        listElForDelete.addEventListener('drop', (e) => {
            const row = e.target.closest('.custom-grid-row');
            if (!row || !state.draggingRowKeys.length) return;
            e.preventDefault();
            stopDragAutoScroll();
            const moved = moveItemsByKeys(state.draggingRowKeys, row.dataset.selectionKey, state.dragOverRowPlacement);
            state.draggingRowKeys = [];
            state.dragOverRowKey = null;
            state.dragOverRowPlacement = 'before';
            state.dragOverGroupId = null;
            renderList({ preserveScroll: true });
            if (moved) {
                showToast('Row order updated', 'success');
            }
            window.setTimeout(() => {
                state.suppressNextRowClick = false;
            }, 0);
        });
        listElForDelete.addEventListener('dragend', () => {
            if (!state.draggingRowKeys.length && !state.dragOverRowKey && !state.dragOverGroupId) return;
            stopDragAutoScroll();
            state.draggingRowKeys = [];
            state.dragOverRowKey = null;
            state.dragOverRowPlacement = 'before';
            state.dragOverGroupId = null;
            syncRowDragUi(listElForDelete);
            syncGroupDragUi(document.getElementById('group-list'));
            window.setTimeout(() => {
                state.suppressNextRowClick = false;
            }, 0);
        });
        if (listScrollWrap) {
            listScrollWrap.addEventListener('dragover', (e) => {
                if (!state.draggingRowKeys.length) return;
                e.preventDefault();
                updateDragAutoScroll(listScrollWrap, e.clientY);
            });
            listScrollWrap.addEventListener('dragleave', (e) => {
                if (!state.draggingRowKeys.length) return;
                if (e.currentTarget.contains(e.relatedTarget)) return;
                stopDragAutoScroll();
            });
            listScrollWrap.addEventListener('drop', () => {
                stopDragAutoScroll();
            });
        }
    }

    const rowContextMenu = getRowContextMenuElement();
    if (rowContextMenu) {
        rowContextMenu.addEventListener('click', async (e) => {
            const actionBtn = e.target.closest('[data-context-action]');
            if (!actionBtn) return;
            e.preventDefault();
            e.stopPropagation();
            const action = actionBtn.getAttribute('data-context-action');
            hideRowContextMenu();
            await executeRowContextMenuAction(action, {
                targetGroupId: actionBtn.getAttribute('data-context-group-id'),
            });
        });
        rowContextMenu.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    const imagePreviewModal = document.getElementById('image-preview-modal');
    if (imagePreviewModal) {
        imagePreviewModal.addEventListener('click', (e) => {
            if (!e.target.closest('#image-preview-img') || e.target.closest('#image-preview-close')) {
                closeImagePreview();
            }
        });
    }


    // Settings nav
    const exportHost = document.getElementById('global-export-host');
    const exportPanel = document.getElementById('settings-global-export');
    if (exportHost && exportPanel) exportHost.appendChild(exportPanel);
    window.ChannelPlaylists?.init({
        request: (path, options) => api._fetch(path, options),
        getUser: getAuthUser,
        formatChecked: timeAgo,
        formatUpdatedAt,
        renderUserCell: renderOwnerUpdatedCell,
        renderPlaylistOwnerCell,
        onGroupChanged: (name) => {
            if (state.currentView !== 'channels') return;
            const title = name || 'Channel & Playlist';
            const breadcrumb = document.getElementById('breadcrumb-group');
            const pageTitle = document.getElementById('page-title');
            if (breadcrumb) breadcrumb.textContent = title;
            if (pageTitle) pageTitle.textContent = title;
        },
        onItemChanged: () => {
            state.listScopeCache?.clear();
            state.itemSummary = null;
        },
    });
    document.getElementById('nav-channels')?.addEventListener('click', (e) => {
        e.preventDefault();
        switchToView('channels');
    });
    document.getElementById('nav-settings').addEventListener('click', (e) => {
        e.preventDefault();
        switchToView('settings');
    });

    document.getElementById('nav-links').addEventListener('click', (e) => {
        e.preventDefault();
        switchToView('linkchecker');
    });

    // Users nav (admin)
    const navUsersEl = document.getElementById('nav-users');
    if (navUsersEl) {
        navUsersEl.addEventListener('click', function(e) {
            e.preventDefault();
            switchToView('users');
        });
    }

    // Settings event listeners
    document.getElementById('settings-save-profile')?.addEventListener('click', handleSaveProfile);
    document.getElementById('settings-save-global')?.addEventListener('click', handleSaveGlobalSettings);
    document.getElementById('settings-change-pw')?.addEventListener('click', handleChangePassword);
    document.getElementById('settings-avatar-input')?.addEventListener('change', (e) => {
        if (e.target.files[0]) handleAvatarUpload(e.target.files[0]);
    });
    document.getElementById('settings-avatar-remove')?.addEventListener('click', handleAvatarRemove);

    // Admin modal click-outside-to-close
    ['admin-edit-modal', 'admin-pw-modal'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', function(e) {
            if (e.target.classList.contains('modal-overlay')) {
                el.classList.remove('open');
            }
        });
    });

    // Admin users list event delegation
    var adminList = document.getElementById('admin-users-list');
    if (adminList) {
        adminList.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            var action = btn.getAttribute('data-action');
            var uid = btn.getAttribute('data-uid');
            var uname = btn.getAttribute('data-uname');
            if (action === 'edit-user') {
                openAdminEditModal(uid);
            } else if (action === 'reset-pw') {
                openAdminPwModal(uid, uname);
            } else if (action === 'toggle-active') {
                var isActive = btn.getAttribute('data-active') === 'true';
                adminToggleActive(uid, uname, isActive);
            } else if (action === 'delete-user') {
                adminDeleteUser(uid, uname);
            }
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideRowContextMenu();
            closeMetricSortMenu();
            closeModal();
            closeImagePreview();
        }
        const target = e.target;
        if (e.key === 'Enter' && !e.shiftKey && handleEnterShortcutSubmit(target)) {
            e.preventDefault();
            return;
        }
        const typingTarget = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
        const hotkey = e.key.toLowerCase();
        const isCtrlA = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a';
        if (isCtrlA && state.currentView === 'linkchecker' && !typingTarget) {
            e.preventDefault();
            const preferredScope = getPreferredSelectionScope(target);
            if (preferredScope === 'groups') {
                const selectableGroupIds = getVisibleSidebarGroups()
                    .map((group) => group.id)
                    .filter((groupId) => String(groupId).toLowerCase() !== ALL_GROUP_ID);
                state.selectionScope = 'groups';
                clearRowSelection();
                state.selectedGroupIds = new Set(selectableGroupIds);
                state.groupSelectionAnchorId = selectableGroupIds[selectableGroupIds.length - 1] || null;
                renderGroups();
                return;
            }
            const visibleKeys = state.filteredItems.map((item) => selectionKey(item));
            state.selectionScope = 'items';
            clearGroupSelection();
            state.selectedItemKeys = new Set(visibleKeys);
            state.selectionAnchorKey = visibleKeys[0] || null;
            renderList({ preserveScroll: true });
            return;
        }
        const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace';
        if (isDeleteKey && state.currentView === 'linkchecker' && state.selectedItemKeys.size > 0) {
            if (!typingTarget) {
                e.preventDefault();
                handleDeleteItems(getSelectedItems());
                return;
            }
        }
        if (isDeleteKey && state.currentView === 'linkchecker' && state.selectedGroupIds.size > 0) {
            const deletableGroupIds = Array.from(state.selectedGroupIds).filter((groupId) => String(groupId).toLowerCase() !== ALL_GROUP_ID);
            if (!typingTarget && deletableGroupIds.length > 0) {
                e.preventDefault();
                handleDeleteGroups(deletableGroupIds);
                return;
            }
        }
        if ((e.ctrlKey || e.metaKey) && state.currentView === 'linkchecker' && !typingTarget) {
            if (hotkey === 'c') {
                e.preventDefault();
                copySelectedLinksToClipboard();
                return;
            }
            if (hotkey === 'x') {
                e.preventDefault();
                stageSelectedItemsForClipboard('cut');
                return;
            }
            if (hotkey === 'v') {
                e.preventDefault();
                pasteClipboardItems();
                return;
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
    });
    const handleOutsideSelectionClear = (e) => {
        const menu = getRowContextMenuElement();
        if (menu && menu.contains(e.target)) return;
        if (state.contextMenuVisible && menu && !menu.contains(e.target)) {
            hideRowContextMenu();
        }
        if (e.button !== 0) return;
        if (state.currentView !== 'linkchecker') return;
        const target = e.target;
        if (!target?.closest) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const clickedInsideRow = path.some((node) => (
            node
            && node.classList
            && node.classList.contains('custom-grid-row')
            && node.closest
            && node.closest('#link-list')
        ));
        const clickedInsideGroup = path.some((node) => (
            node
            && node.classList
            && node.classList.contains('group-item')
            && node.closest
            && node.closest('#group-list')
        ));
        let shouldRender = false;
        if (state.selectedItemKeys.size && !state.draggingRowKeys.length && !clickedInsideRow && !clickedInsideGroup) {
            clearRowSelection();
            shouldRender = true;
        }
        if (state.selectedGroupIds.size && !state.draggingGroupIds.length && !clickedInsideGroup) {
            clearGroupSelection();
            shouldRender = true;
        }
        if (shouldRender) {
            renderGroups();
            renderList({ preserveScroll: true });
        }
    };
    // Capture phase avoids clearing selection after row mousedown triggers re-render.
    document.addEventListener('mousedown', handleOutsideSelectionClear, true);
    document.addEventListener('contextmenu', (e) => {
        if (state.currentView !== 'linkchecker') return;
        const target = e.target;
        if (!target?.closest) return;
        if (target.closest('#row-context-menu')) return;
        const listArea = target.closest('.list-wrap');
        if (!listArea) return;
        if (target.closest('a[href]')) return;
        const row = target.closest('.custom-grid-row');
        e.preventDefault();
        e.stopPropagation();
        showRowContextMenu(
            e.clientX,
            e.clientY,
            row && row.closest('#link-list') ? row : null
        );
    }, true);
    window.addEventListener('resize', hideRowContextMenu);
    document.addEventListener('scroll', hideRowContextMenu, true);

    // Sticky header
    initStickyHeader();
    initVirtualListScroll();

    // Channels is the landing page; Spotify data loads when its tab is opened.
    switchToView('channels');
    syncGroupsFromServer();
    startBackgroundSync();

    // Keep "Checked" relative times live without page reload.
    setInterval(refreshCheckedLabels, 30_000);

    // MutationObserver to update hero when list changes
    const listEl = document.getElementById('link-list');
    if (listEl) {
        const obs = new MutationObserver(() => setTimeout(updateHeroImage, 50));
        obs.observe(listEl, { childList: true });
    }
});

// Fallback hooks for inline onclick handlers
window.clearList = clearList;
window.refreshAllItems = refreshAllItems;











