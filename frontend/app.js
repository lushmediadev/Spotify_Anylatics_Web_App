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
};
const GROUP_STORAGE_KEY = 'spoticheck_custom_groups_v1';
const ROW_ORDER_STORAGE_KEY = 'spoticheck_row_order_v1';
const COLUMN_WIDTH_STORAGE_KEY = 'spoticheck_column_widths_v4';
const ALL_GROUP_ID = 'all';
const ALL_GROUP_LABEL = 'All Links';
const GROUP_SELECT_ALL = '__all__';
const DEFAULT_COLUMN_WIDTHS = Object.freeze({
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
const UI_PREF_SAVE_DEBOUNCE_MS = 700;

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
            profileWrap.onclick = () => document.getElementById('nav-settings')?.click();
            const avatarHtml = user.avatar
                ? '<img src="' + user.avatar + '" class="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10">'
                : '<div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-700 text-white text-[11px] font-bold leading-none grid place-items-center overflow-hidden ring-1 ring-white/10">' + initials + '</div>';
            profileWrap.innerHTML = avatarHtml +
                '<div class="sidebar-user-info overflow-hidden">' +
                '<p class="text-sm font-semibold truncate">' + (user.display_name || user.username) + '</p>' +
                '<p class="text-xs text-secondary-text truncate">' + (user.role === 'admin' ? 'Admin' : 'User') + '</p>' +
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
    if (user && user.role === 'admin') {
        const groupPanel = document.getElementById('group-panel');
        if (groupPanel && !document.getElementById('admin-badge')) {
            const badge = document.createElement('div');
            badge.id = 'admin-badge';
            badge.className = 'px-5 py-2 border-b border-white/5';
            badge.innerHTML = '<span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-primary"><span class="material-icons-round text-sm">admin_panel_settings</span>Admin Mode</span>';
            groupPanel.insertBefore(badge, groupPanel.firstChild);
        }
        setupAdminUserFilter();
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
        prefetchAdminUsers();
    }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const state = {
    items: [],
    filteredItems: [],
    groups: [{ id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, count: 0 }],
    customGroups: [],
    groupSearchQuery: '',
    activeGroup: ALL_GROUP_ID,
    selectedGroupIds: new Set(),
    groupSelectionAnchorId: null,
    isCreatingGroup: false,
    renamingGroupId: null,
    searchQuery: '',
    pendingJobs: new Set(),
    pendingJobToItem: new Map(),
    batchRefresh: null,
    pollTimer: null,
    apiOnline: false,
    adminFilterUserId: null,
    adminUserList: [],
    adminUsersCacheTs: 0,
    adminUsersPromise: null,
    selectedItemKeys: new Set(),
    selectionAnchorKey: null,
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
    uiPrefSaveTimer: null,
    remoteSyncTimer: null,
    remoteSyncInFlight: false,
    contextMenuVisible: false,
    contextMenuAnchorSelectionKey: null,
    contextMenuGroupId: null,
    exportInProgress: false,
    exportLabel: '',
    ownerSortDirection: '',
    metricSortColumn: null,
    metricSortMode: 'value',
    metricSortDirection: 'desc',
    metricSortMenuOpenKey: null,
    playlistOwnerSortDirection: null,
    groupContextMenuVisible: false,
    groupContextMenuTargetId: null,
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
        if (params.user_id) qs.set('user_id', params.user_id);
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items${suffix}`);
    }
    getItem(type, id, userId = null) {
        const qs = new URLSearchParams();
        if (userId) qs.set('user_id', String(userId));
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items/${type}/${id}${suffix}`);
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
    renameGroup(oldGroup, newGroup, userId = null) {
        const qs = new URLSearchParams();
        qs.set('old_group', String(oldGroup || ''));
        qs.set('new_group', String(newGroup || ''));
        if (userId) qs.set('user_id', String(userId));
        return this._fetch(`/items/group?${qs.toString()}`, { method: 'PATCH' });
    }

    crawl(url, group = null, targetUserId = null, itemId = null, removeDuplicates = false) {
        return this._fetch('/crawl', {
            method: 'POST',
            body: JSON.stringify({
                url,
                group,
                target_user_id: targetUserId || null,
                item_id: itemId || null,
                remove_duplicates: Boolean(removeDuplicates),
            }),
        });
    }

    crawlBatch(urls, group = null, targetUserId = null, itemIds = null, removeDuplicates = false) {
        return this._fetch('/crawl/batch', {
            method: 'POST',
            body: JSON.stringify({
                urls,
                group,
                target_user_id: targetUserId || null,
                item_ids: Array.isArray(itemIds) ? itemIds : null,
                remove_duplicates: Boolean(removeDuplicates),
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

/** Get the open.spotify.com URL from type + id */
function getSpotifyUrl(type, id) {
    return `https://open.spotify.com/${type}/${id}`;
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

async function hydrateUiPreferencesFromServer() {
    try {
        if (!getAuthToken()) return;
        const data = await api.getMyPreferences();
        const normalized = normalizeUiPreferences(data?.preferences || {});
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
    const metaColumnCount = RESIZABLE_COLUMN_KEYS.length - 1;
    const internalMetaGaps = Math.max(0, metaColumnCount - 1) * metaGap;
    const available = row.getBoundingClientRect().width
        - paddingLeft
        - paddingRight
        - outerGap
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

function getDisplayTitle(item) {
    const baseTitle = item.name || 'Unknown';
    if (item.type !== 'playlist') return baseTitle;

    const artistOrOwner = (item.owner_name || (Array.isArray(item.artist_names) ? item.artist_names[0] : '') || '').trim();
    if (!artistOrOwner) return baseTitle;
    if (baseTitle.toLowerCase().startsWith(`${artistOrOwner.toLowerCase()} -`)) return baseTitle;
    return `${artistOrOwner} - ${baseTitle}`;
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
    savePersistedRowOrder(state.items.map((item) => selectionKey(item)));
}

function syncSelectedItemsWithState() {
    const existing = new Set(state.items.map((item) => selectionKey(item)));
    state.selectedItemKeys = new Set(
        Array.from(state.selectedItemKeys).filter((key) => existing.has(key))
    );
    if (state.selectionAnchorKey && !existing.has(state.selectionAnchorKey)) {
        state.selectionAnchorKey = null;
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
    const ownerId = ownerUserId ? String(ownerUserId) : '';
    if (isAdminAllUsersMode() && ownerId) {
        const user = (state.adminUserList || []).find((u) => String(u.id || u._id || '') === ownerId);
        return getGroupsFromUserRecord(user);
    }
    return (state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean);
}

function setOwnerCustomGroups(ownerUserId, groups) {
    const ownerId = ownerUserId ? String(ownerUserId) : '';
    const cleaned = Array.from(new Set((groups || []).map(normalizeStoredGroupName).filter(Boolean)));
    if (ownerId) {
        (state.adminUserList || []).forEach((u) => {
            if (String(u.id || u._id || '') === ownerId) {
                u.custom_groups = cleaned.slice();
            }
        });
        _adminUsersCache = (_adminUsersCache || []).map((u) => {
            if (String(u.id || u._id || '') !== ownerId) return u;
            return { ...u, custom_groups: cleaned.slice() };
        });
        const currentUser = getAuthUser();
        if (currentUser && String(currentUser.id || '') === ownerId) {
            state.customGroups = cleaned.slice();
            localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
        }
    }
    if (isAdminAllUsersMode() && ownerId) {
        return cleaned;
    }
    state.customGroups = cleaned.slice();
    return cleaned;
}

async function syncGroupsFromServer(targetUserId) {
    try {
        var token = getAuthToken();
        if (!token) return;
        var url = CONFIG.API_BASE;
        if (targetUserId) {
            url += '/auth/users/' + targetUserId + '/groups';
        } else {
            url += '/auth/me/groups';
        }
        var res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) {
            console.warn('[Groups Sync] Server returned', res.status);
            return;
        }
        var data = await res.json();
        var serverGroups = (data.groups || []).map(normalizeStoredGroupName).filter(Boolean);

        if (targetUserId) {
            // Admin viewing another user's groups
            setOwnerCustomGroups(String(targetUserId), serverGroups);
            state.customGroups = serverGroups.slice();
        } else {
            // Own groups â€” server is source of truth
            // But if server is empty and local has groups, push local to server (first sync)
            var localGroups = (state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean);
            if (serverGroups.length === 0 && localGroups.length > 0) {
                // First time sync: upload local groups to server
                state.customGroups = localGroups;
                await saveGroupsToServer(localGroups);
            } else {
                // Server has data â€” use server as source of truth
                state.customGroups = serverGroups;
            }
            var currentUser = getAuthUser();
            if (currentUser?.id) {
                setOwnerCustomGroups(String(currentUser.id), state.customGroups || []);
            }
            localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(state.customGroups));
        }
        syncGroupUI(true);
        console.log('[Groups Sync] Synced', state.customGroups.length, 'groups for', targetUserId || 'self');
    } catch (err) {
        console.warn('[Groups Sync] Error:', err.message);
    }
}

async function saveGroupsToServer(groups, targetUserId) {
    try {
        var token = getAuthToken();
        if (!token) return;
        var url = CONFIG.API_BASE;
        // If admin is filtering a specific user, save to that user
        var uid = targetUserId || state.adminFilterUserId;
        var currentUser = getAuthUser();
        if (uid && currentUser && currentUser.role === 'admin' && uid !== currentUser.id) {
            url += '/auth/users/' + uid + '/groups';
        } else {
            url += '/auth/me/groups';
        }
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ groups: groups || state.customGroups }),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const payload = await res.json().catch(() => null);
        if (payload && Array.isArray(payload.groups)) {
            const synced = payload.groups.map(normalizeStoredGroupName).filter(Boolean);
            if (uid) {
                setOwnerCustomGroups(String(uid), synced);
            } else {
                const meId = currentUser?.id ? String(currentUser.id) : null;
                if (meId) {
                    setOwnerCustomGroups(meId, synced);
                } else {
                    state.customGroups = synced;
                }
            }
        }
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
    var currentUser = getAuthUser();
    if (currentUser?.role === 'admin' && isAdminAllUsersMode() && currentUser.id) {
        setOwnerCustomGroups(currentUser.id, cleaned);
    }
    // If admin is filtering another user, don't save to own localStorage
    var filteringOther = state.adminFilterUserId && currentUser && currentUser.role === 'admin' && state.adminFilterUserId !== currentUser.id;
    if (!filteringOther) {
        localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
    }
    // Sync to server in background (will auto-target filtered user if admin)
    saveGroupsToServer(cleaned);
}

function getActiveGroupName() {
    if (state.activeGroup === ALL_GROUP_ID) return ALL_GROUP_LABEL;
    const match = state.groups.find((g) => g.id === state.activeGroup);
    return match?.displayName || match?.name || state.activeGroup;
}

function isAdminAllUsersMode() {
    const currentUser = getAuthUser();
    return Boolean(currentUser?.role === 'admin' && !state.adminFilterUserId);
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

function toggleGroupSelection(groupId) {
    const normalized = normalizeGroupName(groupId);
    if (!normalized) return;
    const next = new Set(state.selectedGroupIds || []);
    if (next.has(normalized)) {
        next.delete(normalized);
    } else {
        next.add(normalized);
    }
    state.selectedGroupIds = next;
}

function getSelectedGroupEntries() {
    const selectedIds = Array.from(state.selectedGroupIds || []);
    return selectedIds
        .map((id) => getGroupEntryById(id))
        .filter((entry) => Boolean(entry));
}

function getCurrentGroupClearScope() {
    if (state.contextMenuGroupId) {
        return getGroupEntryById(state.contextMenuGroupId) || parseGroupEntryId(state.contextMenuGroupId);
    }
    if (state.activeGroup && state.activeGroup !== ALL_GROUP_ID) {
        return getGroupEntryById(state.activeGroup) || parseGroupEntryId(state.activeGroup);
    }
    return null;
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
    const name = getActiveGroupName();
    const breadcrumb = document.getElementById('breadcrumb-group');
    const pageTitle = document.getElementById('page-title');
    if (breadcrumb) breadcrumb.textContent = name;
    if (pageTitle) pageTitle.textContent = name;
}

function getManageableGroupIds() {
    return state.groups
        .filter((g) => g.id !== ALL_GROUP_ID && canManageGroupEntry(g))
        .map((g) => String(g.id));
}

function clearGroupSelection() {
    state.selectedGroupIds = new Set();
    state.groupSelectionAnchorId = null;
}

function normalizeGroupSelection() {
    const allowed = new Set(getManageableGroupIds().map((id) => id.toLowerCase()));
    state.selectedGroupIds = new Set(
        Array.from(state.selectedGroupIds).filter((id) => allowed.has(String(id).toLowerCase()))
    );
    if (state.groupSelectionAnchorId && !allowed.has(String(state.groupSelectionAnchorId).toLowerCase())) {
        state.groupSelectionAnchorId = null;
    }
}

function setSingleGroupSelection(groupId) {
    const normalized = normalizeGroupName(groupId);
    if (!normalized || normalized.toLowerCase() === ALL_GROUP_ID) {
        clearGroupSelection();
        return;
    }
    state.selectedGroupIds = new Set([normalized]);
    state.groupSelectionAnchorId = normalized;
}

function selectAllGroups() {
    const ids = getManageableGroupIds();
    if (!ids.length) {
        clearGroupSelection();
        renderGroups();
        return;
    }
    state.selectedGroupIds = new Set(ids);
    state.groupSelectionAnchorId = ids[0];
    renderGroups();
    showToast(`Selected ${ids.length} groups`, 'info');
}

function clearRowSelection() {
    state.selectedItemKeys = new Set();
    state.selectionAnchorKey = null;
}

function getSelectedVisibleItems() {
    return state.filteredItems.filter((item) => state.selectedItemKeys.has(selectionKey(item)));
}

function getSelectedItems() {
    return state.items.filter((item) => state.selectedItemKeys.has(selectionKey(item)));
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
        const q = state.searchQuery.toLowerCase();
        items = items.filter((i) =>
            (i.name || '').toLowerCase().includes(q) ||
            (i.owner_name || '').toLowerCase().includes(q) ||
            (i.spotify_id || '').toLowerCase().includes(q) ||
            (i.type || '').toLowerCase().includes(q)
        );
    }

    if (state.playlistOwnerSortDirection === 'asc' || state.playlistOwnerSortDirection === 'desc') {
        const sortFactor = state.playlistOwnerSortDirection === 'asc' ? 1 : -1;
        const sortedItems = [...items];
        sortedItems.sort((a, b) => {
            const left = getPlaylistOwnerLabel(a).toLowerCase();
            const right = getPlaylistOwnerLabel(b).toLowerCase();
            const leftEmpty = !left || left === '-';
            const rightEmpty = !right || right === '-';
            if (leftEmpty && rightEmpty) return 0;
            if (leftEmpty) return 1;
            if (rightEmpty) return -1;
            if (left === right) return 0;
            return left > right ? sortFactor : -sortFactor;
        });
        items = sortedItems;
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

    return items;
}

function isInteractiveRowTarget(target) {
    return Boolean(target?.closest('a, button, input, textarea, select, label, [role="button"], .row-action-cell, .row-action-buttons'));
}

function handleRowSelection(item, event) {
    if (!item) return;
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

    const draggedItems = state.items.filter((item) => draggedSet.has(selectionKey(item)));
    if (!draggedItems.length) return false;

    const remaining = state.items.filter((item) => !draggedSet.has(selectionKey(item)));
    const targetIndex = remaining.findIndex((item) => selectionKey(item) === targetKey);
    if (targetIndex === -1) return false;

    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    remaining.splice(insertIndex, 0, ...draggedItems);
    state.items = remaining;
    persistCurrentItemOrder();
    return true;
}

function moveCustomGroupBefore(draggedGroupIds, targetGroupId, placement = 'before') {
    const target = normalizeGroupName(targetGroupId);
    const draggedList = Array.isArray(draggedGroupIds) ? draggedGroupIds : [draggedGroupIds];
    const normalizedDraggedIds = Array.from(new Set(
        draggedList
            .map((value) => normalizeGroupName(value))
            .filter(Boolean)
            .filter((value) => value.toLowerCase() !== ALL_GROUP_ID)
    ));
    if (!normalizedDraggedIds.length || !target || target.toLowerCase() === ALL_GROUP_ID) return false;
    if (normalizedDraggedIds.some((value) => value.toLowerCase() === target.toLowerCase())) return false;

    const targetEntry = getGroupEntryById(target) || parseGroupEntryId(target);
    const targetGroupName = normalizeStoredGroupName(targetEntry?.name || target);
    if (!targetGroupName) return false;

    const draggedNames = normalizedDraggedIds
        .map((id) => getGroupEntryById(id) || parseGroupEntryId(id))
        .map((entry) => normalizeStoredGroupName(entry?.name || ''))
        .filter(Boolean);
    if (!draggedNames.length) return false;

    const current = Array.from(new Set((state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean)));
    const next = current.slice();

    draggedNames.forEach((name) => {
        if (!next.some((item) => item.toLowerCase() === name.toLowerCase())) {
            next.push(name);
        }
    });
    if (!next.some((name) => name.toLowerCase() === targetGroupName.toLowerCase())) {
        next.push(targetGroupName);
    }

    const draggedNameSet = new Set(draggedNames.map((name) => name.toLowerCase()));
    const movingBlock = next.filter((name) => draggedNameSet.has(name.toLowerCase()));
    if (!movingBlock.length) return false;
    const remaining = next.filter((name) => !draggedNameSet.has(name.toLowerCase()));
    const targetIndex = remaining.findIndex((name) => name.toLowerCase() === targetGroupName.toLowerCase());
    if (targetIndex === -1) return false;
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    remaining.splice(insertIndex, 0, ...movingBlock);

    state.customGroups = remaining;
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
        const draggedIds = state.draggingGroupIds.length ? state.draggingGroupIds : (state.draggingGroupId ? [state.draggingGroupId] : []);
        const isDragging = Boolean(groupId && draggedIds.includes(groupId));
        const isDropTarget = Boolean(groupId && state.dragOverGroupId === groupId && !isDragging);
        groupBtn.classList.toggle('group-item-dragging', isDragging);
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

function getScopedGroupOwnerUserId() {
    const currentUser = getAuthUser();
    if (!currentUser?.id) return null;
    if (currentUser.role === 'admin' && state.adminFilterUserId) {
        return String(state.adminFilterUserId);
    }
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
    if (currentUser?.role !== 'admin' || !groupName || groupName === ALL_GROUP_LABEL) {
        return groupName;
    }

    let ownerLabel = '';
    if (state.adminFilterUserId) {
        ownerLabel = getAdminUserLabelById(state.adminFilterUserId) || getCurrentUserLabel();
    } else if (ownerUserId) {
        ownerLabel = getAdminUserLabelById(ownerUserId) || getCurrentUserLabel();
    } else if ((state.customGroups || []).some((name) => normalizeStoredGroupName(name) === normalizeStoredGroupName(groupName))) {
        ownerLabel = getCurrentUserLabel();
    } else {
        ownerLabel = getCurrentUserLabel();
    }

    const baseName = getAdminGroupBaseName(groupName, ownerLabel);
    return `${ownerLabel} - ${baseName}`;
}

function canManageGroupEntry(groupEntry) {
    if (!groupEntry || groupEntry.id === ALL_GROUP_ID) return false;
    const currentUser = getAuthUser();
    if (currentUser?.role === 'admin') return true;
    return true;
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

    const groups = [{ id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, count: state.items.length }];
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
        const scopedOwnerUserId = getScopedGroupOwnerUserId();
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
    normalizeGroupSelection();
    if (state.activeGroup === ALL_GROUP_ID) {
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
            if (state.adminFilterUserId) return true;
            if (previousOwner && g.ownerUserId) {
                return String(g.ownerUserId) === previousOwner;
            }
            return !previousOwner || !g.ownerUserId;
        }) || null;
    }

    state.activeGroup = remapped ? remapped.id : ALL_GROUP_ID;
}

function renderGroups() {
    const container = document.getElementById('group-list');
    if (!container) return;

    const q = state.groupSearchQuery.trim().toLowerCase();
    const groups = state.groups.filter((g) => {
        if (g.id === ALL_GROUP_ID) return true;
        if (!q) return true;
        return (g.displayName || g.name).toLowerCase().includes(q);
    });

    const groupButtons = groups.map((g) => {
        const isActive = g.id === state.activeGroup;
        const isSelected = state.selectedGroupIds.has(g.id);
        const canDelete = canManageGroupEntry(g);
        const isDragging = state.draggingGroupId === g.id;
        const isDropTarget = state.dragOverGroupId === g.id && !isDragging;
        const isRenaming = Boolean(
            state.renamingGroupId
            && state.renamingGroupId.toLowerCase() === g.id.toLowerCase()
        );
        return `
            <button
                class="group-item ${canDelete ? 'group-item-has-delete' : ''} ${isSelected ? 'group-selected' : ''} ${isDragging ? 'group-item-dragging' : ''} ${isDropTarget ? 'group-item-drop-target' : ''} w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${isActive ? 'bg-primary/10 text-white' : 'text-secondary-text hover:text-white hover:bg-white/5'}"
                data-group="${escapeHtml(g.id)}"
                data-group-manageable="${canDelete ? 'true' : 'false'}"
                data-group-selected="${isSelected ? 'true' : 'false'}"
                draggable="${canDelete ? 'true' : 'false'}"
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
                            <span ${g.id === ALL_GROUP_ID ? 'id="group-count-all"' : ''} class="group-count text-xs font-bold ${isActive ? 'bg-primary/20 text-primary' : 'bg-white/10 text-secondary-text'} px-2 py-0.5 rounded-full">${g.count}</span>
                            ${canDelete ? `
                            <span
                                class="group-delete-btn material-icons-round"
                                title="Delete group"
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

    var options = [{value: GROUP_SELECT_ALL, label: ALL_GROUP_LABEL + ' (Default)'}];
    for (var i = 0; i < state.groups.length; i++) {
        var g = state.groups[i];
        if (g.id === ALL_GROUP_ID) continue;
        options.push({value: g.id, label: g.displayName || g.name});
    }

    var selectedValue = GROUP_SELECT_ALL;
    if (state.activeGroup && state.activeGroup !== ALL_GROUP_ID) {
        var hasActive = options.some(function(opt) {
            return String(opt.value) === String(state.activeGroup);
        });
        if (hasActive) selectedValue = state.activeGroup;
    }

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
    var adminTargetUserId = null;
    if (currentUser?.role === 'admin' && state.adminFilterUserId) {
        adminTargetUserId = String(state.adminFilterUserId);
    }
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
        if (currentUser?.role === 'admin' && entry.ownerUserId) {
            resolvedTargetUserId = String(entry.ownerUserId);
        }
    }

    if (!resolvedGroup) {
        var parsed = parseGroupEntryId(picked);
        var parsedName = normalizeStoredGroupName(parsed ? parsed.name : '');
        if (parsedName && parsedName.toLowerCase() !== ALL_GROUP_ID) {
            resolvedGroup = parsedName;
            if (currentUser?.role === 'admin' && parsed?.ownerUserId) {
                resolvedTargetUserId = String(parsed.ownerUserId);
            }
        }
    }

    // Fallback for non-composite ids
    if (!resolvedGroup && picked.toLowerCase() !== ALL_GROUP_ID) {
        resolvedGroup = picked;
    }

    return {
        group: resolvedGroup || null,
        targetUserId: currentUser?.role === 'admin' ? (resolvedTargetUserId || null) : null,
    };
}

function resolveSelectedGroup() {
    return resolveSelectedGroupContext().group;
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
}

async function deleteSingleGroup(target) {
    if (!target || !target.id || target.id === ALL_GROUP_ID) return false;
    const groupId = normalizeGroupName(target.id);
    const groupName = target?.name || groupId;
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
        return { ...item, group: null };
    });
    await syncGroupItemsToServer(target?.name || groupName, '', ownerUserId || null, groupNameVariants);
    return true;
}

async function handleDeleteGroup(rawGroupId) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId) return;

    if (groupId.toLowerCase() === ALL_GROUP_ID) {
        await clearList({ groupEntry: { id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, displayName: ALL_GROUP_LABEL } });
        return;
    }

    const target = state.groups.find((g) => g.id.toLowerCase() === groupId.toLowerCase());
    if (!canManageGroupEntry(target)) {
        showToast('Select that user in Filter by User to manage this group', 'info');
        return;
    }
    const selectedGroupIds = Array.from(state.selectedGroupIds).filter((id) => {
        const entry = getGroupEntryById(id);
        return entry && canManageGroupEntry(entry) && id.toLowerCase() !== ALL_GROUP_ID;
    });
    const targetIds = selectedGroupIds.length > 1 && selectedGroupIds.some((id) => id.toLowerCase() === groupId.toLowerCase())
        ? selectedGroupIds
        : [groupId];

    const confirmed = targetIds.length > 1
        ? window.confirm(`Delete ${targetIds.length} selected groups?\nAll links in these groups will move to All Links.`)
        : window.confirm(`Delete group "${target?.name || groupId}"?\nAll links in this group will move to All Links.`);
    if (!confirmed) return;

    let deletedCount = 0;
    for (const id of targetIds) {
        const entry = getGroupEntryById(id);
        if (!entry || !canManageGroupEntry(entry)) continue;
        const ok = await deleteSingleGroup(entry);
        if (ok) deletedCount += 1;
    }

    if ((state.activeGroup || '').toLowerCase() === groupId.toLowerCase() || targetIds.some((id) => id.toLowerCase() === (state.activeGroup || '').toLowerCase())) {
        state.activeGroup = ALL_GROUP_ID;
    }
    clearGroupSelection();
    state.isCreatingGroup = false;
    if ((state.renamingGroupId || '').toLowerCase() === groupId.toLowerCase() || targetIds.some((id) => id.toLowerCase() === (state.renamingGroupId || '').toLowerCase())) {
        state.renamingGroupId = null;
    }
    syncGroupUI(true);
    renderList();
    if (deletedCount > 1) {
        showToast(`Deleted ${deletedCount} groups`, 'success');
    } else if (deletedCount === 1) {
        showToast(`Deleted group: ${target?.name || groupId}`, 'success');
    }
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
        showToast('Select that user in Filter by User to rename this group', 'info');
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
    const targetUserId = ownerUserId ? String(ownerUserId) : null;
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
        showToast('Select that user in Filter by User to rename this group', 'info');
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
    renderGroups();
    updateGroupHeader();
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

function renderRow(item) {
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

    const row = document.createElement('div');
    row.className = `custom-grid-row px-4 py-3 bg-white/5 rounded-lg border border-transparent hover:bg-row-hover hover:border-white/10 transition-all group ${isSelected ? 'row-selected' : ''} ${isDragging ? 'row-dragging' : ''} ${isDropTarget ? 'row-drop-target' : ''} ${isDropBefore ? 'row-drop-before' : ''} ${isDropAfter ? 'row-drop-after' : ''}`;
    row.dataset.itemId = item.id;
    row.dataset.type = item.type;
    row.dataset.spotifyId = item.spotify_id;
    row.dataset.userId = item.user_id ? String(item.user_id) : '';
    row.dataset.itemKey = key;
    row.dataset.selectionKey = rowSelectionKey;
    row.draggable = true;

    row.innerHTML = `
        <!-- Left: Asset Details -->
        <div class="flex items-center gap-4">
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

function updatePlaylistOwnerSortControlUI() {
    const selectEl = document.getElementById('owner-sort-select');
    if (selectEl) {
        const direction = state.playlistOwnerSortDirection === 'asc' || state.playlistOwnerSortDirection === 'desc'
            ? state.playlistOwnerSortDirection
            : '';
        if (selectEl.value !== direction) {
            selectEl.value = direction;
        }
    }

    const toggle = document.querySelector('[data-owner-sort-toggle]');
    if (toggle) {
        const direction = state.playlistOwnerSortDirection;
        const icon = toggle.querySelector('.playlist-owner-sort-icon');
        if (icon) {
            icon.textContent = direction === 'asc'
                ? 'arrow_upward'
                : direction === 'desc'
                    ? 'arrow_downward'
                    : 'swap_vert';
        }
        toggle.classList.toggle('is-active', Boolean(direction));
        toggle.setAttribute(
            'title',
            direction === 'asc'
                ? 'Playlist Owner A → Z'
                : direction === 'desc'
                    ? 'Playlist Owner Z → A'
                    : 'Sort Playlist Owner A → Z'
        );
    }
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
function closeMetricSortMenu() {
    if (!state.metricSortMenuOpenKey) return;
    state.metricSortMenuOpenKey = null;
    updateMetricSortControlsUI();
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
            const ownerSortToggle = event.target.closest('[data-owner-sort-toggle]');
            if (ownerSortToggle) {
                event.preventDefault();
                event.stopPropagation();
                if (state.playlistOwnerSortDirection === 'asc') {
                    state.playlistOwnerSortDirection = 'desc';
                } else if (state.playlistOwnerSortDirection === 'desc') {
                    state.playlistOwnerSortDirection = null;
                } else {
                    state.playlistOwnerSortDirection = 'asc';
                }
                state.metricSortColumn = null;
                state.metricSortMenuOpenKey = null;
                renderList({ preserveScroll: true });
                updateMetricSortControlsUI();
                updatePlaylistOwnerSortControlUI();
                return;
            }

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
                    renderList({ preserveScroll: true });
                    updateMetricSortControlsUI();
                    updatePlaylistOwnerSortControlUI();
                    return;
                }

                const mode = selectedMode === 'delta' ? 'delta' : 'value';
                state.metricSortColumn = colKey;
                state.playlistOwnerSortDirection = null;
                state.metricSortMode = mode;
                if (!['asc', 'desc'].includes(state.metricSortDirection)) {
                    state.metricSortDirection = 'desc';
                }
                state.metricSortMenuOpenKey = null;
                renderList({ preserveScroll: true });
                updateMetricSortControlsUI();
                updatePlaylistOwnerSortControlUI();
                return;
            }

            if (directionToggle) {
                event.preventDefault();
                event.stopPropagation();
                if (state.metricSortColumn !== colKey) {
                    state.metricSortColumn = colKey;
                    state.metricSortDirection = 'desc';
                    state.metricSortMode = state.metricSortMode === 'delta' ? 'delta' : 'value';
                } else {
                    state.metricSortDirection = state.metricSortDirection === 'asc' ? 'desc' : 'asc';
                }
                state.playlistOwnerSortDirection = null;
                state.metricSortMenuOpenKey = null;
                renderList({ preserveScroll: true });
                updateMetricSortControlsUI();
                updatePlaylistOwnerSortControlUI();
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
    updatePlaylistOwnerSortControlUI();
}
/** Escape HTML to prevent XSS */
function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RENDER ENGINE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function renderList(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
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

    const items = getVisibleItems();
    state.filteredItems = items;

    // Clear previous rows (keep skeleton and empty state)
    container.querySelectorAll('.custom-grid-row').forEach(el => el.remove());

    if (skeleton) skeleton.style.display = 'none';

    if (items.length === 0) {
        if (!state.searchQuery && emptyState) {
            if (emptyTitleEl) {
                emptyTitleEl.textContent = state.items.length === 0
                    ? defaultEmptyTitle
                    : `No links in "${getActiveGroupName()}"`;
            }
            if (emptyDescEl) {
                emptyDescEl.textContent = state.items.length === 0
                    ? defaultEmptyDescription
                    : 'Add a Spotify link to this group to start monitoring.';
            }
            emptyState.style.display = '';
            updateMetricSortControlsUI();
            restoreScroll();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const noResult = document.createElement('div');
        noResult.className = 'custom-grid-row text-center py-12 text-secondary-text';
        noResult.innerHTML = `<div class="col-span-2">No results for "${escapeHtml(state.searchQuery)}"</div>`;
        container.appendChild(noResult);
        updateMetricSortControlsUI();
        restoreScroll();
        return;
    }

    if (emptyTitleEl) emptyTitleEl.textContent = defaultEmptyTitle;
    if (emptyDescEl) emptyDescEl.textContent = defaultEmptyDescription;
    if (emptyState) emptyState.style.display = 'none';

    // Render all rows
    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(renderRow(item)));
    container.appendChild(frag);

    // Update KPIs
    updateKPIs();
    refreshCheckedLabels();
    updateMetricSortControlsUI();
    restoreScroll();
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
    const scopedTotal = scoped.length;
    const active = scoped.filter(i => i.status === 'active').length;
    const errors = scoped.filter(i => i.status === 'error').length;
    const crawling = scoped.filter(i => i.status === 'crawling' || i.status === 'pending').length;

    setText('kpi-total', scopedTotal);
    setText('kpi-active', active);
    setText('kpi-errors', errors);
    setText('kpi-crawling', crawling);
    setText('footer-total', scopedTotal);
    setText('footer-active', active);
    setText('footer-errors', errors);
    setText('footer-crawling', crawling);
    setText('group-count-all', state.items.length);
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

function formatPlainMetric(value) {
    if (value == null || value === '') return '';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return cleanExportText(value);
    if (Number.isInteger(numeric)) return String(numeric);
    return String(numeric);
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
    const artists = Array.isArray(item?.artist_names)
        ? item.artist_names.map((name) => cleanExportText(name)).filter(Boolean)
        : [];
    if (artists.length) return artists.join(', ');
    const owner = cleanExportText(item?.owner_name || item?.playlist_owner || item?.playlist_owner_name || '');
    return owner || '';
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

function buildListViewExportRows(items) {
    return (items || []).map((item) => {
        const excel = getExcelColumnValues(item);
        return [
            cleanExportText(item.type || ''),
            cleanExportText(item.name || ''),
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
    return (items || [])
        .filter((item) => item?.type === 'playlist')
        .map((item) => {
            const artists = getItemArtistsLabel(item) || '-';
            const trackName = cleanExportText(item.name || '-');
            const spotifyLink = getItemSpotifyUrlForExport(item);
            const trackPlayCount = item.playcount ?? item.followers ?? item.saves ?? '';
            return [
                `${artists} - ${trackName}`,
                spotifyLink,
                formatPlainMetric(trackPlayCount),
            ];
        });
}

function buildAlbumType0ExportRows(items) {
    const rows = [];
    (items || [])
        .filter((item) => item?.type === 'album')
        .forEach((item) => {
            const albumName = cleanExportText(item.name || '-');
            const tracks = Array.isArray(item.export_tracks) ? item.export_tracks : [];
            if (tracks.length) {
                tracks.forEach((track, index) => {
                    rows.push([
                        albumName,
                        String(index + 1),
                        cleanExportText(track.track_name || '-'),
                        cleanExportText(track.spotify_url || ''),
                        '',
                    ]);
                });
                return;
            }
            rows.push([
                albumName,
                '1',
                cleanExportText(item.name || '-'),
                getItemSpotifyUrlForExport(item),
                formatPlainMetric(item.playcount),
            ]);
        });
    return rows;
}

function buildTrackOfflineExportRows(items) {
    return (items || [])
        .filter((item) => item?.type === 'track')
        .map((item) => {
            const artists = getItemArtistsLabel(item) || '-';
            const trackName = cleanExportText(item.name || '-');
            const spotifyLink = getItemSpotifyUrlForExport(item);
            const playCount = formatPlainMetric(item.playcount);
            const firstArtistListenPerMonthCount = formatPlainMetric(item.monthly_listeners);
            return [
                `${artists} - ${trackName}`,
                spotifyLink,
                playCount,
                firstArtistListenPerMonthCount,
            ];
        });
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
    return { rows: [], filePrefix: 'spoticheck-export', title: 'export' };
}

async function runStructuredExport(action, items, destination) {
    const payload = getStructuredExportRows(action, items);
    if (!payload.rows.length) {
        showToast('KhÃ´ng cÃ³ dá»¯ liá»‡u phÃ¹ há»£p cho kiá»ƒu xuáº¥t nÃ y', 'info');
        return;
    }
    const text = rowsToDelimitedText(payload.rows, '\t');
    if (destination === 'clipboard') {
        await copyToClipboard(text, `Copied ${payload.rows.length} ${payload.title} lines`);
        return;
    }
    const fileName = buildExportFileName(payload.filePrefix, 'txt');
    downloadTextFile(text, fileName, 'text/plain;charset=utf-8');
    showToast(`Exported ${payload.rows.length} ${payload.title} lines`, 'success');
}

function mapContextActionToExportRequest(action) {
    if (action === 'export-listview-excel') {
        return { exportAction: 'listview-excel', format: 'xlsx', deepFetch: false };
    }
    if (action === 'clipboard-selected') {
        return { exportAction: 'listview-excel', format: 'json', deepFetch: false };
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
            const headers = Array.isArray(payload?.headers) ? payload.headers : [];
            const includeHeaders = contextAction === 'clipboard-selected' && headers.length > 0;
            const text = rowsToDelimitedText(includeHeaders ? [headers, ...rows] : rows, '\t');
            await copyToClipboard(text, `Copied ${rows.length} line(s)`);
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
    state.groupContextMenuVisible = false;
    state.groupContextMenuTargetId = null;
}

function getGroupContextMenuElement() {
    return document.getElementById('group-context-menu');
}

function hideGroupContextMenu() {
    const menu = getGroupContextMenuElement();
    if (!menu) return;
    menu.classList.remove('open');
    menu.style.display = 'none';
    state.groupContextMenuVisible = false;
    state.groupContextMenuTargetId = null;
}

function updateGroupContextMenuLabels() {
    const menu = getGroupContextMenuElement();
    if (!menu) return;
    const targetId = normalizeGroupName(state.groupContextMenuTargetId) || ALL_GROUP_ID;
    const clearLabel = menu.querySelector('[data-group-context-label="clear"]');
    const deleteLabel = menu.querySelector('[data-group-context-label="delete"]');
    const deleteBtn = menu.querySelector('[data-group-context-action="delete-group"]');
    const selected = Array.from(state.selectedGroupIds).filter((id) => {
        const entry = getGroupEntryById(id);
        return entry && canManageGroupEntry(entry);
    });
    const selectedCount = selected.length;

    if (clearLabel) {
        clearLabel.textContent = targetId === ALL_GROUP_ID
            ? 'Clear all links'
            : `Clear group: ${(getGroupEntryById(targetId)?.displayName || getGroupEntryById(targetId)?.name || targetId)}`;
    }
    if (deleteLabel) {
        if (targetId === ALL_GROUP_ID) {
            deleteLabel.textContent = 'Delete all links';
        } else if (selectedCount > 1 && selected.includes(targetId)) {
            deleteLabel.textContent = `Delete ${selectedCount} selected groups`;
        } else {
            deleteLabel.textContent = 'Delete group';
        }
    }
    if (deleteBtn) {
        const disableDelete = targetId !== ALL_GROUP_ID && !canManageGroupEntry(getGroupEntryById(targetId));
        deleteBtn.disabled = disableDelete;
        deleteBtn.classList.toggle('is-disabled', disableDelete);
    }
}

function showGroupContextMenu(clientX, clientY, rawGroupId) {
    const menu = getGroupContextMenuElement();
    if (!menu) return;
    const groupId = normalizeGroupName(rawGroupId) || ALL_GROUP_ID;
    const entry = getGroupEntryById(groupId) || parseGroupEntryId(groupId);
    if (groupId !== ALL_GROUP_ID && entry && canManageGroupEntry(entry) && !state.selectedGroupIds.has(groupId)) {
        setSingleGroupSelection(groupId);
        renderGroups();
    }

    state.groupContextMenuTargetId = groupId;
    updateGroupContextMenuLabels();
    menu.style.display = 'block';
    menu.classList.add('open');
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    const left = Math.max(8, Math.min(clientX, maxX));
    const top = Math.max(8, Math.min(clientY, maxY));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    state.groupContextMenuVisible = true;
}

async function executeGroupContextMenuAction(action, rawTargetId = null) {
    if (!action) return;
    const targetId = normalizeGroupName(rawTargetId || state.groupContextMenuTargetId) || ALL_GROUP_ID;
    const entry = targetId === ALL_GROUP_ID
        ? { id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, displayName: ALL_GROUP_LABEL }
        : (getGroupEntryById(targetId) || parseGroupEntryId(targetId));

    if (action === 'clear-list') {
        await clearList({ groupEntry: entry });
        return;
    }
    if (action === 'delete-group') {
        await handleDeleteGroup(targetId);
    }
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

function updateRowContextMenuLabels() {
    const menu = getRowContextMenuElement();
    if (!menu) return;
    const selectedCount = getSelectedItems().length;
    const fetchLabels = menu.querySelectorAll('[data-context-label="fetch"]');
    const deleteLabels = menu.querySelectorAll('[data-context-label="delete"]');
    const exportLabels = menu.querySelectorAll('[data-context-label="export-list"]');
    const hasSelection = selectedCount > 0;
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

    const disableForExport = state.exportInProgress;
    [
        'delete-selected',
        'fetch-selected',
        'export-listview-excel',
        'clipboard-selected',
        'txt-playlist-type3',
        'txt-album-type0',
        'txt-track-offline',
    ].forEach((action) => setContextActionDisabled(menu, action, !hasSelection || disableForExport));

    menu.querySelectorAll('[data-context-group]').forEach((groupEl) => {
        groupEl.classList.toggle('is-disabled', !hasSelection || disableForExport);
    });
}

function showRowContextMenu(clientX, clientY, row) {
    const menu = getRowContextMenuElement();
    if (!menu) return;

    if (row) {
        state.groupContextMenuVisible = false;
        state.groupContextMenuTargetId = null;
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

function getGroupContextMenuEntry() {
    const targetId = normalizeGroupName(state.groupContextMenuTargetId);
    if (!targetId) return null;
    return getGroupEntryById(targetId) || parseGroupEntryId(targetId);
}

async function executeRowContextMenuAction(action) {
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
    if (action === 'delete-selected') {
        if (!selectedItems.length) {
            showToast('No rows selected', 'info');
            return;
        }
        await handleDeleteItems(selectedItems);
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
            } else if (action === 'clipboard-selected') {
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
                const text = rowsToDelimitedText([headers, ...rows], '\t');
                await copyToClipboard(text, `Copied ${rows.length} selected row(s)`);
            } else if (action.startsWith('clipboard-')) {
                await runStructuredExport(action, selectedItems, 'clipboard');
            } else if (action.startsWith('txt-')) {
                await runStructuredExport(action, selectedItems, 'txt');
            }
        }
        return;
    }

    if (action === 'clear-list') {
        const groupEntry = state.groupContextMenuVisible ? getGroupContextMenuEntry() : null;
        await clearList(groupEntry ? { groupEntry } : {});
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
        const targetUserId = currentUser?.role === 'admin' ? (item.user_id || null) : null;
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

async function clearList(opts = {}) {
    const activeEntry = state.activeGroup !== ALL_GROUP_ID ? getGroupEntryById(state.activeGroup) : null;
    const groupEntry = Object.prototype.hasOwnProperty.call(opts, 'groupEntry')
        ? (opts?.groupEntry || null)
        : activeEntry;
    const clearAll = !groupEntry || groupEntry.id === ALL_GROUP_ID;
    const scopedItems = clearAll
        ? state.items
        : state.items.filter((item) => doesItemMatchGroupEntry(item, groupEntry));

    if (!scopedItems.length) {
        showToast('List is already empty', 'info');
        return;
    }

    const scopeLabel = clearAll ? 'all links in the current scope' : `all links in group "${groupEntry.displayName || groupEntry.name}"`;
    const confirmed = window.confirm(`Clear ${scopeLabel}?\nThis action cannot be undone.`);
    if (!confirmed) return;

    if (clearAll) {
        state.items = [];
        state.filteredItems = [];
    } else {
        const scopedKeys = new Set(scopedItems.map((item) => itemIdentity(item)));
        state.items = state.items.filter((item) => !scopedKeys.has(itemIdentity(item)));
        state.filteredItems = state.filteredItems.filter((item) => !scopedKeys.has(itemIdentity(item)));
    }

    clearRowSelection();
    savePersistedRowOrder(state.items.map((item) => selectionKey(item)));
    syncGroupUI(true);

    const scopedItemIds = new Set(scopedItems.map((item) => String(item.id)).filter(Boolean));
    if (scopedItemIds.size) {
        scopedItemIds.forEach((id) => state.pendingJobs.delete(id));
        for (const [jobId, itemId] of state.pendingJobToItem.entries()) {
            if (scopedItemIds.has(String(itemId)) || scopedItemIds.has(String(jobId))) {
                state.pendingJobToItem.delete(jobId);
                state.pendingJobs.delete(jobId);
            }
        }
    }
    if (!state.pendingJobs.size) {
        stopPolling();
    }
    renderList({ preserveScroll: true });

    try {
        if (state.apiOnline) {
            const targetGroupName = clearAll ? null : normalizeStoredGroupName(groupEntry?.name || '');
            const targetUserId = clearAll
                ? (state.adminFilterUserId ? String(state.adminFilterUserId) : null)
                : (groupEntry?.ownerUserId ? String(groupEntry.ownerUserId) : (state.adminFilterUserId ? String(state.adminFilterUserId) : null));
            await api.clearItems(targetGroupName || null, targetUserId);
        }
        showToast(clearAll ? 'List cleared' : `Cleared group: ${groupEntry.displayName || groupEntry.name}`, 'success');
    } catch (e) {
        showToast(`Clear list local only: ${e.message}`, 'info');
    }
}

async function refreshAllItems() {
    const selectedVisibleItems = getSelectedVisibleItems();
    const useSelectionScope = selectedVisibleItems.length >= 2;
    const targetItems = useSelectionScope
        ? selectedVisibleItems
        : (state.activeGroup === ALL_GROUP_ID
            ? state.items
            : state.items.filter((i) => doesItemMatchGroupEntry(i, getGroupEntryById(state.activeGroup))));

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
    const targetKeys = new Set(refreshableItems.map((item) => itemKey(item)));
    state.items = state.items.map((item) => (
        targetKeys.has(itemKey(item)) ? markItemAsRefreshing(item, now) : item
    ));
    renderList({ preserveScroll: true });

    try {
        const currentUser = getAuthUser();
        const isAdmin = currentUser?.role === 'admin';
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
    document.getElementById('add-link-modal').classList.add('open');
    document.getElementById('modal-batch-input').value = '';
    const dedupeCheckbox = document.getElementById('modal-remove-duplicates');
    if (dedupeCheckbox) dedupeCheckbox.checked = false;
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
    const urls = textarea.value.split('\n').map((u) => u.trim()).filter(Boolean);
    const dedupeEnabled = Boolean(document.getElementById('modal-remove-duplicates')?.checked);
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

    const selectedGroup = resolveSelectedGroupContext();
    const group = selectedGroup.group;
    const currentIdentity = getUserIdentityById(selectedGroup.targetUserId);
    let submitUrls = urls.slice();
    if (dedupeEnabled) {
        const seenInput = new Set();
        const groupedExisting = new Set(
            state.items
                .filter((item) => {
                    const itemGroup = normalizeStoredGroupName(item.group || '');
                    const targetGroup = normalizeStoredGroupName(group || '');
                    if (itemGroup !== targetGroup) return false;
                    if (selectedGroup.targetUserId) {
                        return String(item.user_id || '') === String(selectedGroup.targetUserId);
                    }
                    return String(item.user_id || '') === String(currentIdentity.id || '');
                })
                .map((item) => `${String(item.type || '').toLowerCase()}:${String(item.spotify_id || '').toLowerCase()}`)
        );
        const deduped = [];
        let skipped = 0;
        submitUrls.forEach((url) => {
            const parsed = parseSpotifyUrl(url);
            if (!parsed) return;
            const key = `${parsed.type.toLowerCase()}:${parsed.id.toLowerCase()}`;
            if (seenInput.has(key) || groupedExisting.has(key)) {
                skipped += 1;
                return;
            }
            seenInput.add(key);
            deduped.push(url);
        });
        submitUrls = deduped;
        if (!submitUrls.length) {
            hint.textContent = 'No new links to add after duplicate filtering';
            hint.className = 'text-xs text-amber-300 mt-2';
            return;
        }
        if (skipped > 0) {
            showToast(`Skipped ${skipped} duplicate link(s)`, 'info');
        }
    }

    try {
        let jobIds = [];
        if (submitUrls.length === 1) {
            const result = await api.crawl(submitUrls[0], group, selectedGroup.targetUserId, null, dedupeEnabled);
            const singleJobId = result?.job_id;
            if (!singleJobId) {
                throw new Error('Backend did not return job_id');
            }
            jobIds = [singleJobId];
        } else {
            const result = await api.crawlBatch(submitUrls, group, selectedGroup.targetUserId, null, dedupeEnabled);
            jobIds = Array.isArray(result?.job_ids) ? result.job_ids : [];
            if (!jobIds.length) {
                throw new Error('Backend did not return job_ids');
            }
        }
        showToast(`Added ${submitUrls.length} link${submitUrls.length > 1 ? 's' : ''} - crawling started`, 'success');

        const now = new Date().toISOString();
        let mappedJobs = 0;
        submitUrls.forEach((url, i) => {
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
            state.items.unshift(newItem);
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
    const jobResults = await Promise.all(
        pendingJobIds.map(async (jobId) => {
            try {
                return { jobId, job: await api.getJob(jobId) };
            } catch {
                return { jobId, job: null };
            }
        })
    );

    for (const { jobId, job } of jobResults) {
        if (!job) continue;

        const mappedItemId = state.pendingJobToItem.get(jobId) || jobId;
        const inBatch = Boolean(
            state.batchRefresh?.active
            && state.batchRefresh?.jobIds?.has(jobId)
        );
        if (job.status === 'completed') {
            hasTerminalUpdate = true;
            // Force a canonical reload so delta badges (snapshot-based) appear immediately.
            shouldReload = true;
            state.pendingJobs.delete(jobId);
            state.pendingJobToItem.delete(jobId);
            const completedAt = job.completed_at || new Date().toISOString();
            const stableItemId = job.item_id ? String(job.item_id) : null;
            // Update item in state with real data
            const idx = state.items.findIndex(i => i.id === mappedItemId || i.id === jobId);
            if (idx >= 0 && job.result) {
                const previousId = state.items[idx]?.id ? String(state.items[idx].id) : null;
                state.items[idx] = {
                    ...state.items[idx],
                    ...normalizeJobResult(job.result, state.items[idx]),
                    id: stableItemId || state.items[idx].id,
                    status: 'active',
                    last_checked: completedAt,
                };
                if (stableItemId && previousId && previousId !== stableItemId) {
                    persistCurrentItemOrder();
                }
            } else if (job.result) {
                // Avoid owner mix-up when multiple users track the same Spotify ID.
                shouldReload = true;
            } else {
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
                state.items[idx].status = 'error';
                state.items[idx].error_message = job.error;
                state.items[idx].last_checked = job.completed_at || new Date().toISOString();
            } else {
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
        }
    }

    if (shouldReload) {
        await loadData({ preserveScroll: true });
    } else if (hasTerminalUpdate) {
        renderList({ preserveScroll: true });
    } else {
        renderList({ preserveScroll: true });
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SEARCH
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const handleSearch = debounce((query) => {
    state.searchQuery = query;
    renderList();
}, CONFIG.SEARCH_DEBOUNCE);

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

async function setupAdminUserFilter() {
    const user = getAuthUser();
    if (!user || user.role !== 'admin') return;

    try {
        const users = await _fetchAdminUsers({ preferCache: true });
        state.adminUserList = Array.isArray(users) ? users.slice() : [];
        rebuildAdminUserFilterOptions();
        if (state.items.length) {
            rebuildGroups();
            updateGroupHeader();
            renderGroups();
        }
    } catch {
        return;
    }

    const groupPanel = document.getElementById('group-panel');
    if (!groupPanel || document.getElementById('admin-user-filter')) return;

    const filterDiv = document.createElement('div');
    filterDiv.className = 'px-5 py-2 border-b border-white/5';
    filterDiv.id = 'admin-user-filter-wrap';
    var filterLabel = document.createElement('label');
    filterLabel.className = 'block text-[11px] font-bold uppercase tracking-[0.12em] text-secondary-text mb-2';
    filterLabel.textContent = 'Filter by User';
    filterDiv.appendChild(filterLabel);

    var filterOptions = [{value: '', label: 'All Users'}];
    for (var fi = 0; fi < state.adminUserList.length; fi++) {
        var fu = state.adminUserList[fi];
        filterOptions.push({value: fu.id || fu._id || '', label: fu.display_name || fu.username || String(fu.id)});
    }
    var filterDropdown = createCustomDropdown({
        id: 'admin-user-filter',
        options: filterOptions,
        selected: '',
        onChange: handleAdminFilterChange
    });
    filterDiv.appendChild(filterDropdown);

    // Insert after admin badge (if present), before the group search area
    const adminBadge = document.getElementById('admin-badge');
    if (adminBadge && adminBadge.nextSibling) {
        groupPanel.insertBefore(filterDiv, adminBadge.nextSibling);
    } else {
        groupPanel.insertBefore(filterDiv, groupPanel.firstChild);
    }

}

function rebuildAdminUserFilterOptions() {
    const filterWrap = document.getElementById('admin-user-filter-dropdown');
    if (!filterWrap) return;
    const options = [{ value: '', label: 'All Users' }];
    (state.adminUserList || []).forEach((user) => {
        options.push({
            value: user.id || user._id || '',
            label: user.display_name || user.username || String(user.id || user._id || ''),
        });
    });
    updateCustomDropdownOptions('admin-user-filter-dropdown', options, state.adminFilterUserId || '');
}

function handleAdminFilterChange(val) {
    state.adminFilterUserId = val || null;
    state.activeGroup = ALL_GROUP_ID;
    state.groupSearchQuery = '';
    clearRowSelection();

    var pageTitle = document.getElementById('page-title');
    var breadcrumb = document.getElementById('breadcrumb-group');
    if (val) {
        var selectedUser = state.adminUserList.find(function(u) { return String(u.id || u._id) === val; });
        var username = (selectedUser && (selectedUser.display_name || selectedUser.username)) || val;
        if (pageTitle) pageTitle.textContent = ALL_GROUP_LABEL + ' (' + username + ')';
        if (breadcrumb) breadcrumb.textContent = ALL_GROUP_LABEL + ' (' + username + ')';
    } else {
        updateGroupHeader();
    }

    loadData({ preserveScroll: false });
    if (val) {
        syncGroupsFromServer(val);
    } else {
        state.customGroups = loadCustomGroups();
        syncGroupsFromServer();
    }
}

async function loadData(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
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
        const params = {};
        const currentUser = getAuthUser();
        if (currentUser?.role === 'admin') {
            await _fetchAdminUsers({ preferCache: Boolean(state.adminFilterUserId) });
        }
        if (currentUser?.role === 'admin' && state.adminFilterUserId) {
            params.user_id = state.adminFilterUserId;
        }
        const data = await api.getItems(params);
        if (!data) return;
        const incoming = data.items || data || [];
        state.items = applyPersistedItemOrder(mergeItemsKeepOrder(state.items, incoming));
        persistCurrentItemOrder();
        syncSelectedItemsWithState();
        syncGroupUI(true);
        if (skeleton) skeleton.style.display = 'none';
        renderList({ preserveScroll });
    } catch (err) {
        console.error('loadData error:', err);
        if (skeleton) skeleton.style.display = 'none';
        if (getAuthToken()) {
            state.items = [];
        } else {
            state.items = applyPersistedItemOrder(getDemoData());
        }
        persistCurrentItemOrder();
        syncSelectedItemsWithState();
        syncGroupUI(true);
        renderList({ preserveScroll });
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

    state.remoteSyncInFlight = true;
    try {
        await syncGroupsFromServer(state.adminFilterUserId || null);
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


// ===================================================================
// VIEW MANAGEMENT â€” single source of truth for panel switching
// ===================================================================

state.currentView = 'linkchecker'; // 'linkchecker' | 'settings' | 'users'

function setElementDisplay(el, mode) {
    if (!el) return;
    if (!mode) {
        el.style.removeProperty('display');
        return;
    }
    el.style.display = mode;
}

function switchToView(view) {
    var listWrap = document.querySelector('.list-wrap');
    var settingsPanel = document.getElementById('settings-panel');
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
    setElementDisplay(adminPanel, 'none');

    // 2) Update sidebar nav active state
    var navMap = { linkchecker: 'nav-links', settings: 'nav-settings', users: 'nav-users' };
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

    if (view === 'linkchecker') {
        setElementDisplay(listWrap, null);
        if (breadcrumbParent) breadcrumbParent.textContent = 'Link Checker';
        updateGroupHeader();
        if (state.items.length > 0) {
            renderList({ preserveScroll: true });
        }
        loadData({ preserveScroll: true });
    } else if (view === 'settings') {
        setElementDisplay(settingsPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'Account';
        if (breadcrumb) breadcrumb.textContent = 'Settings';
        if (pageTitle) pageTitle.textContent = 'Account Settings';
        loadSettingsData();
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

    document.getElementById('settings-username').value = user.username || '';
    document.getElementById('settings-displayname').value = user.display_name || '';
    document.getElementById('settings-role').textContent = user.role === 'admin' ? 'Admin' : 'User';
    document.getElementById('settings-created').textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '-';

    updateSettingsAvatar(user);

    document.getElementById('settings-current-pw').value = '';
    document.getElementById('settings-new-pw').value = '';
    document.getElementById('settings-confirm-pw').value = '';
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

function prefetchAdminUsers() {
    var user = getAuthUser();
    if (!user || user.role !== 'admin') return;
    _fetchAdminUsers({ preferCache: true })
        .then(function(users) {
            state.adminUserList = Array.isArray(users) ? users.slice() : [];
            rebuildAdminUserFilterOptions();
        })
        .catch(function() {});
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
        rebuildAdminUserFilterOptions();
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

        var roleBadge = u.role === 'admin'
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full"><span class="material-icons-round" style="font-size:12px">admin_panel_settings</span>Admin</span>'
            : '<span class="text-[11px] font-bold uppercase tracking-wider text-secondary-text bg-white/5 px-2 py-0.5 rounded-full">User</span>';

        var statusBadge = u.is_active
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Active</span>'
            : '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-red-400"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Inactive</span>';

        var lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString() + ' ' + new Date(u.last_login).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'Never';
        var created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '-';

        var isSelf = currentUser && currentUser.id === u.id;

        var extraBtns = '';
        if (!isSelf) {
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
                        roleBadge +
                        statusBadge +
                        (isSelf ? '<span class="text-[11px] text-secondary-text">(you)</span>' : '') +
                    '</div>' +
                    '<div class="text-sm text-secondary-text truncate">@' + u.username + '</div>' +
                    '<div class="text-xs text-secondary-text mt-1">Joined ' + created + ' &middot; Last login: ' + lastLogin + '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 flex-shrink-0">' +
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
            updateCustomDropdownOptions('admin-edit-role-dropdown', [{value:'user',label:'User'},{value:'admin',label:'Admin'}], user.role);
        } else {
            var roleDD = createCustomDropdown({
                id: 'admin-edit-role',
                options: [{value:'user',label:'User'},{value:'admin',label:'Admin'}],
                selected: user.role
            });
            roleWrap.innerHTML = '';
            roleWrap.appendChild(roleDD);
        }
    }
    document.getElementById('admin-edit-status').style.display = 'none';

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
            updateCustomDropdownOptions('admin-create-role-dropdown', [{value:'user',label:'User'},{value:'admin',label:'Admin'}], 'user');
        } else {
            var roleDD = createCustomDropdown({
                id: 'admin-create-role',
                cssClass: 'dropdown-modal',
                options: [{value:'user',label:'User'},{value:'admin',label:'Admin'}],
                selected: 'user'
            });
            roleWrap.innerHTML = '';
            roleWrap.appendChild(roleDD);
        }
    }

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
            }),
        });
        var data = await res.json().catch(function() { return {}; });
        if (!res.ok) throw new Error(data.detail || 'Failed to create user');

        showToast('User ' + username + ' created', 'success');
        closeAdminCreateModal();
        await loadAdminUsers({ force: true });
        var filterWrap = document.getElementById('admin-user-filter-wrap');
        if (filterWrap) filterWrap.remove();
        await setupAdminUserFilter();
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
    }
}

async function saveAdminEditUser() {
    var userId = document.getElementById('admin-edit-user-id').value;
    var displayName = document.getElementById('admin-edit-displayname').value.trim();
    var roleDD = document.getElementById('admin-edit-role-dropdown');
    var role = roleDD ? roleDD.getAttribute('data-value') : 'user';
    var statusEl = document.getElementById('admin-edit-status');

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ display_name: displayName || null, role: role }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to update user');

        showToast('User updated!', 'success');
        closeAdminEditModal();
        await loadAdminUsers({ force: true });
        var filterWrap = document.getElementById('admin-user-filter-wrap');
        if (filterWrap) filterWrap.remove();
        await setupAdminUserFilter();
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
        var filterWrap = document.getElementById('admin-user-filter-wrap');
        if (filterWrap) filterWrap.remove();
        await setupAdminUserFilter();
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
    setupAuthUI();
    await hydrateUiPreferencesFromServer();
    state.columnWidths = loadPersistedColumnWidths();
    applyColumnWidths(state.columnWidths);
    setupColumnResizers();
    ensureMetricSortControls();
    syncColumnWidthsToViewport();
    window.addEventListener('resize', () => syncColumnWidthsToViewport());

    state.customGroups = loadCustomGroups();
    syncGroupUI(true);

    // Modal
    document.getElementById('btn-add-link').addEventListener('click', openModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-submit').addEventListener('click', submitSingle);
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
    const ownerSortSelect = document.getElementById('owner-sort-select');
    if (ownerSortSelect) {
        ownerSortSelect.addEventListener('change', (e) => {
            const direction = String(e.target.value || '').trim().toLowerCase();
            state.playlistOwnerSortDirection = direction === 'asc' || direction === 'desc' ? direction : null;
            state.metricSortColumn = null;
            state.metricSortMenuOpenKey = null;
            renderList({ preserveScroll: true });
            updateMetricSortControlsUI();
            updatePlaylistOwnerSortControlUI();
        });
    }
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
            if (state.renamingGroupId) return;
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group')) || ALL_GROUP_ID;
            const manageable = groupBtn.getAttribute('data-group-manageable') === 'true';
            const visibleManageableIds = Array.from(groupList.querySelectorAll('[data-group][data-group-manageable="true"]'))
                .map((el) => normalizeGroupName(el.getAttribute('data-group')))
                .filter(Boolean);

            if (e.shiftKey && manageable && state.groupSelectionAnchorId && visibleManageableIds.includes(state.groupSelectionAnchorId)) {
                const start = visibleManageableIds.indexOf(state.groupSelectionAnchorId);
                const end = visibleManageableIds.indexOf(groupId);
                if (start !== -1 && end !== -1) {
                    const [from, to] = start < end ? [start, end] : [end, start];
                    state.selectedGroupIds = new Set(visibleManageableIds.slice(from, to + 1));
                }
            } else if ((e.ctrlKey || e.metaKey) && manageable) {
                const next = new Set(state.selectedGroupIds);
                if (next.has(groupId)) next.delete(groupId);
                else next.add(groupId);
                state.selectedGroupIds = next;
                state.groupSelectionAnchorId = groupId;
            } else if (manageable) {
                setSingleGroupSelection(groupId);
            } else {
                clearGroupSelection();
            }

            const currentGroupId = normalizeGroupName(state.activeGroup) || ALL_GROUP_ID;
            if (groupId.toLowerCase() === currentGroupId.toLowerCase()) {
                state.isCreatingGroup = false;
                renderGroups();
                return;
            }
            state.activeGroup = groupId;
            state.isCreatingGroup = false;
            clearRowSelection();
            // If currently on Settings or Users tab, navigate back to Link Checker
            if (state.currentView !== 'linkchecker') {
                switchToView('linkchecker');
            } else {
                updateGroupHeader();
                renderGroups();
                renderList();
            }
        });
        groupList.addEventListener('contextmenu', (e) => {
            const groupBtn = e.target.closest('[data-group]');
            if (!groupBtn) return;
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            if (!groupId) return;
            e.preventDefault();
            e.stopPropagation();
            showGroupContextMenu(e.clientX, e.clientY, groupId);
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
            const sourceEntry = getGroupEntryById(groupId) || parseGroupEntryId(groupId);
            const sourceOwnerId = sourceEntry?.ownerUserId ? String(sourceEntry.ownerUserId) : '';
            const selected = Array.from(state.selectedGroupIds).filter((id) => {
                if (!id || id.toLowerCase() === ALL_GROUP_ID) return false;
                const entry = getGroupEntryById(id) || parseGroupEntryId(id);
                if (!entry || !canManageGroupEntry(entry)) return false;
                const ownerId = entry.ownerUserId ? String(entry.ownerUserId) : '';
                return ownerId === sourceOwnerId;
            });
            const draggingIds = selected.includes(groupId) ? selected : [groupId];
            if (!draggingIds.length) {
                e.preventDefault();
                return;
            }
            state.draggingGroupIds = draggingIds;
            state.draggingGroupId = draggingIds[0];
            state.dragOverGroupId = groupId;
            state.dragOverGroupPlacement = 'before';
            state.suppressNextGroupClick = true;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggingIds.join(','));
            }
            syncGroupDragUi(groupList);
        });
        groupList.addEventListener('dragover', (e) => {
            const groupBtn = e.target.closest('[data-group]');
            if (!state.draggingGroupId && !state.draggingGroupIds.length) return;
            updateDragAutoScroll(groupList, e.clientY);
            if (!groupBtn) return;
            const targetGroupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            if (!targetGroupId) return;
            if (targetGroupId.toLowerCase() === ALL_GROUP_ID) return;
            e.preventDefault();
            const rect = groupBtn.getBoundingClientRect();
            const placement = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            if (targetGroupId === state.dragOverGroupId && placement === state.dragOverGroupPlacement) return;
            state.dragOverGroupId = targetGroupId;
            state.dragOverGroupPlacement = placement;
            syncGroupDragUi(groupList);
        });
        groupList.addEventListener('drop', (e) => {
            const groupBtn = e.target.closest('[data-group]');
            if (!groupBtn || (!state.draggingGroupId && !state.draggingGroupIds.length)) return;
            e.preventDefault();
            stopDragAutoScroll();
            const targetGroupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            const moved = moveCustomGroupBefore(
                state.draggingGroupIds.length ? state.draggingGroupIds : state.draggingGroupId,
                targetGroupId,
                state.dragOverGroupPlacement
            );
            state.draggingGroupId = null;
            state.draggingGroupIds = [];
            state.dragOverGroupId = null;
            state.dragOverGroupPlacement = 'before';
            rebuildGroups();
            renderGroups();
            if (moved) {
                showToast('Group order updated', 'success');
            }
            window.setTimeout(() => {
                state.suppressNextGroupClick = false;
            }, 0);
        });
        groupList.addEventListener('dragend', () => {
            if (!state.draggingGroupId && !state.draggingGroupIds.length && !state.dragOverGroupId) return;
            stopDragAutoScroll();
            state.draggingGroupId = null;
            state.draggingGroupIds = [];
            state.dragOverGroupId = null;
            state.dragOverGroupPlacement = 'before';
            syncGroupDragUi(groupList);
            window.setTimeout(() => {
                state.suppressNextGroupClick = false;
            }, 0);
        });
        groupList.addEventListener('dragleave', (e) => {
            if (!state.draggingGroupId && !state.draggingGroupIds.length) return;
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
            if (!row) return;
            // Keep native browser link context-menu on title/anchor right-click.
            if (e.target.closest('a[href]')) return;
            e.preventDefault();
            e.stopPropagation();
            showRowContextMenu(e.clientX, e.clientY, row);
        });
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
            renderList({ preserveScroll: true });
            if (moved) {
                showToast('Row order updated', 'success');
            }
            window.setTimeout(() => {
                state.suppressNextRowClick = false;
            }, 0);
        });
        listElForDelete.addEventListener('dragend', () => {
            if (!state.draggingRowKeys.length && !state.dragOverRowKey) return;
            stopDragAutoScroll();
            state.draggingRowKeys = [];
            state.dragOverRowKey = null;
            state.dragOverRowPlacement = 'before';
            syncRowDragUi(listElForDelete);
            window.setTimeout(() => {
                state.suppressNextRowClick = false;
            }, 0);
        });
        if (listScrollWrap) {
            listScrollWrap.addEventListener('contextmenu', (e) => {
                const row = e.target.closest('.custom-grid-row');
                if (row) return;
                e.preventDefault();
                e.stopPropagation();
                showRowContextMenu(e.clientX, e.clientY, null);
            });
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
            await executeRowContextMenuAction(action);
        });
        rowContextMenu.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    const groupContextMenu = getGroupContextMenuElement();
    if (groupContextMenu) {
        groupContextMenu.addEventListener('click', async (e) => {
            const actionBtn = e.target.closest('[data-group-context-action]');
            if (!actionBtn) return;
            e.preventDefault();
            e.stopPropagation();
            const action = actionBtn.getAttribute('data-group-context-action');
            const targetGroupId = state.groupContextMenuTargetId;
            hideGroupContextMenu();
            await executeGroupContextMenuAction(action, targetGroupId);
        });
        groupContextMenu.addEventListener('contextmenu', (e) => {
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
            hideGroupContextMenu();
            closeMetricSortMenu();
            closeModal();
            closeImagePreview();
        }
        const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace';
        if (isDeleteKey && state.currentView === 'linkchecker' && state.selectedItemKeys.size > 0) {
            const target = e.target;
            const typingTarget = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
            if (!typingTarget) {
                e.preventDefault();
                handleDeleteItems(getSelectedItems());
                return;
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('search-input').focus();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            const target = e.target;
            const typingTarget = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
            if (!typingTarget && state.currentView === 'linkchecker') {
                e.preventDefault();
                selectAllGroups();
            }
        }
    });
    const handleOutsideSelectionClear = (e) => {
        const menu = getRowContextMenuElement();
        const groupMenu = getGroupContextMenuElement();
        if (menu && menu.contains(e.target)) return;
        if (groupMenu && groupMenu.contains(e.target)) return;
        if (state.contextMenuVisible && menu && !menu.contains(e.target)) {
            hideRowContextMenu();
        }
        if (state.groupContextMenuVisible && groupMenu && !groupMenu.contains(e.target)) {
            hideGroupContextMenu();
        }
        if (e.button !== 0) return;
        if (state.currentView !== 'linkchecker') return;
        if (!state.selectedItemKeys.size) return;
        if (state.draggingRowKeys.length) return;
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
        if (clickedInsideRow) return;
        clearRowSelection();
        renderList({ preserveScroll: true });
    };
    // Capture phase avoids clearing selection after row mousedown triggers re-render.
    document.addEventListener('mousedown', handleOutsideSelectionClear, true);
    window.addEventListener('resize', () => {
        hideRowContextMenu();
        hideGroupContextMenu();
    });
    document.addEventListener('scroll', () => {
        hideRowContextMenu();
        hideGroupContextMenu();
    }, true);

    // Sticky header
    initStickyHeader();

    // Initial data load
    loadData().then(() => {
        // Update hero image after data is rendered
        setTimeout(updateHeroImage, 100);
        // Sync groups from server
        syncGroupsFromServer(state.adminFilterUserId || null);
        // Keep remote updates (from other users/tabs) in sync without manual refresh.
        startBackgroundSync();
    });

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











