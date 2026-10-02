import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = "D:/Spotify_AnylaticsWeb_App/frontend";
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");

test("manager account uses assigned-user scope and cannot assign privileged roles", () => {
  let account = { id: 'manager-id', role: 'manager' };
  const context = vm.createContext({
    localStorage: { getItem: () => JSON.stringify(account) },
    state: { adminFilterUserId: 'assigned-user', activeGroup: 'Jazz' },
    getGroupEntryById: () => ({ id: 'Jazz', name: 'Jazz' }),
    normalizeStoredGroupName: (value) => value,
    ALL_GROUP_ID: 'all',
    CHECKED_SORT_MODES: { NONE: 'none' },
    METRIC_SORT_CONFIG: {},
  });
  vm.runInContext(appJs.slice(appJs.indexOf('function getAuthUser()'), appJs.indexOf('function logout()')), context);
  vm.runInContext(appJs.slice(appJs.indexOf('function getAdminTargetUserId()'), appJs.indexOf('function getScopedGroupOwnerUserId()')), context);
  vm.runInContext(appJs.slice(appJs.indexOf('function getBackendListParams()'), appJs.indexOf('function getBackendListScopeKey(')), context);
  assert.equal(vm.runInContext('canManageUsers()', context), true);
  assert.equal(vm.runInContext('getAssignableRoles().map(role => role.value).join(",")', context), 'user');
  assert.equal(vm.runInContext('getBackendListParams().user_id', context), 'assigned-user');
  account = { id: 'user-id', role: 'user' };
  assert.equal(vm.runInContext('canManageUsers()', context), false);
  assert.equal(vm.runInContext('getBackendListParams().user_id', context), undefined);
  account = { id: 'admin-id', role: 'admin' };
  assert.equal(vm.runInContext('getAssignableRoles().map(role => role.value).join(",")', context), 'user,manager,admin');
});

test("display title helper supports multi-artist track and album labels", () => {
  assert.match(appJs, /function buildDisplayTitleWithArtists/);
  assert.match(appJs, /item\.type === 'track' \|\| item\.type === 'album'/);
  assert.match(appJs, /function buildExportTrackTitle/);
  assert.match(appJs, /splitArtistLabel\(artistLabel\)/);
  assert.match(appJs, /cleanExportText\(getDisplayTitle\(item\)\)/);
});

test("add-link flow handles per-user duplicate skips from backend", () => {
  assert.match(appJs, /result\?\.\s*skipped_duplicate/);
  assert.match(appJs, /accepted_indices/);
  assert.match(appJs, /skipped_duplicates/);
  assert.match(appJs, /already exists for this user/);
});

test("admin default scope uses own links instead of all users", () => {
  assert.match(appJs, /function getAdminTargetUserId/);
  assert.doesNotMatch(appJs, /label: 'My Links'/);
  assert.doesNotMatch(appJs, /label: 'All Users'/);
  assert.match(appJs, /state\.adminFilterUserId = currentUserId \|\| null/);
  assert.match(appJs, /const selectedUserId = val \|\| \(currentUser\?\.id \? String\(currentUser\.id\) : null\)/);
  assert.match(appJs, /state\.items = \[\]/);
  assert.match(appJs, /state\.customGroups = selectedUserId \? getOwnerCustomGroups\(selectedUserId\) : \[\]/);
  assert.match(appJs, /const requestId = \+\+state\.dataLoadRequestId/);
  assert.match(appJs, /const targetUserId = getAdminTargetUserId\(\)/);
  assert.match(appJs, /if \(targetUserId\) params\.user_id = targetUserId/);
  assert.match(appJs, /loadData\(\{ preserveScroll: false, force: true \}\)/);
  assert.match(appJs, /function resetVirtualList/);
  assert.match(appJs, /function loadVirtualPage/);
  assert.match(appJs, /getItemsSummary\(params = \{\}\)/);
  assert.doesNotMatch(appJs, /fastFirstPage/);
  assert.doesNotMatch(appJs, /loadRemainingItems/);
});

test("add-link modal no longer renders the duplicate checkbox", () => {
  assert.doesNotMatch(indexHtml, /modal-dedupe-links/);
  assert.doesNotMatch(indexHtml, /Skip duplicate links/);
});

test("rendered rows expose STT column target", () => {
  assert.match(appJs, /data-col-key="stt"/);
  assert.match(indexHtml, /Resize STT column/);
  assert.match(appJs, /function renderRowsInBatches/);
  assert.match(appJs, /frag\.appendChild\(renderRow\(items\[index\], index\)\)/);
  assert.match(appJs, /requestAnimationFrame\(\(\) => appendBatch\(CONFIG\.LIST_RENDER_BATCH_SIZE\)\)/);
});

test("loadData does not pin the dashboard to a frontend item cap", () => {
  assert.doesNotMatch(appJs, /params\.limit = 500/);
});

test("large lists use backend summary and virtual page loading", () => {
  assert.match(appJs, /LIST_PAGE_SIZE: 120/);
  assert.match(appJs, /LIST_SCOPE_CACHE_LIMIT: 18/);
  assert.match(appJs, /VIRTUAL_ROW_HEIGHT: 104/);
  assert.match(appJs, /function renderVirtualPlaceholder/);
  assert.match(appJs, /queueVirtualPagesForRange\(range\.start, range\.end\)/);
  assert.match(appJs, /api\.getItemsSummary\(params\)/);
  assert.match(appJs, /limit: CONFIG\.LIST_PAGE_SIZE/);
  assert.match(appJs, /state\.virtualItems = canPreserveLoaded \? previousItems : new Array\(state\.listTotal\)/);
  assert.match(appJs, /const range = getVirtualRange\(container\)[\s\S]*?clearRenderedRows\(container\)/);
  assert.match(appJs, /container\.style\.minHeight = `\$\{Math\.max\(0, total \* CONFIG\.VIRTUAL_ROW_HEIGHT\)\}px`/);
  assert.match(appJs, /preserveScroll: Boolean\(opts\.preserveScroll\)/);
  assert.match(appJs, /renderList\(\{ preserveScroll: false, force: true \}\)/);
  assert.match(appJs, /VIRTUAL_PREFETCH_PAGES: 1/);
  assert.match(appJs, /state\.loadingPagePromises = new Map\(\)/);
  assert.match(appJs, /function loadAllVirtualItemsForCurrentScope/);
  assert.match(appJs, /preserveLoaded: previousScopeKey === getBackendListScopeKey\(params\) && previousTotal === total/);
});

test("link list interactions reuse cached scopes instead of forcing skeleton reloads", () => {
  assert.match(appJs, /listScopeCache: new Map\(\)/);
  assert.match(appJs, /function hydrateListScopeCache\(params = getBackendListParams\(\), opts = \{\}\)/);
  assert.match(appJs, /function showInstantListOrLoading\(params = getBackendListParams\(\), opts = \{\}\)/);
  assert.match(appJs, /showInstantListOrLoading\(getBackendListParams\(\), \{\s*keepCurrentOnMiss: true,\s*preserveScroll: false,\s*\}\);\s*loadData\(\{ preserveScroll: false, force: true \}\)/);
  assert.match(appJs, /scheduleWarmCurrentListScope\(\)/);
  assert.match(appJs, /silent: true/);
  assert.match(appJs, /function prefetchSmallGroupScopes\(\)/);
});

test("virtual row drag updates cached rows and persists full order only when available", () => {
  assert.match(appJs, /function persistMovedItemOrder\(draggedKeys, targetKey, placement = 'before'\)/);
  assert.match(appJs, /const usingVirtualList = state\.listTotal > 0 && Array\.isArray\(state\.virtualItems\) && state\.virtualItems\.length/);
  assert.match(appJs, /const sourceItems = usingVirtualList \? getLoadedVirtualItems\(\) : state\.items/);
  assert.match(appJs, /const nextVirtualItems = state\.virtualItems\.slice\(\)/);
  assert.match(appJs, /nextVirtualItems\[idx\] = remaining\[orderIdx\]/);
  assert.match(appJs, /persistMovedItemOrder\(Array\.from\(draggedSet\), targetKey, placement\)/);
});

test("paged list sorting is sent to the backend", () => {
  assert.match(appJs, /if \(params\.sort\) qs\.set\('sort', params\.sort\)/);
  assert.match(appJs, /if \(params\.sort_direction\) qs\.set\('sort_direction', params\.sort_direction\)/);
  assert.match(appJs, /if \(params\.checked_sort\) qs\.set\('checked_sort', params\.checked_sort\)/);
  assert.match(appJs, /params\.checked_sort = state\.checkedSortMode/);
  assert.match(appJs, /params\.sort = state\.metricSortColumn/);
  assert.match(appJs, /params\.sort = state\.textSortColumn/);
  assert.match(appJs, /sort: params\.sort \|\| ''/);
  assert.match(appJs, /function reloadListAfterQueryStateChange/);
});

test("admin edit payload includes username", () => {
  assert.match(appJs, /username: username/);
  assert.doesNotMatch(indexHtml, /id="admin-edit-username"[^>]*disabled/);
});

test("admin group labels only show the base group name", () => {
  assert.match(appJs, /return baseName;/);
  assert.doesNotMatch(appJs, /return `\$\{ownerLabel\} - \$\{baseName\}`;/);
});

test("move submenu and selected KPI are rendered", () => {
  assert.match(indexHtml, /data-context-group="move"/);
  assert.match(indexHtml, /data-context-action="copy-selected-links"/);
  assert.match(indexHtml, /id="kpi-selected"/);
  assert.match(indexHtml, /id="footer-selected"/);
});

test("keyboard shortcuts support move clipboard interactions", () => {
  assert.match(appJs, /function stageSelectedItemsForClipboard/);
  assert.match(appJs, /function pasteClipboardItems/);
  assert.match(appJs, /function copySelectedLinksToClipboard/);
  assert.match(appJs, /hotkey === 'c'/);
  assert.match(appJs, /hotkey === 'x'/);
  assert.match(appJs, /hotkey === 'v'/);
  assert.match(appJs, /handleEnterShortcutSubmit/);
});

test("frontend uses backend move endpoint for group moves", () => {
  assert.match(appJs, /moveItems\(itemIds = \[\], group = null, userId = null\)/);
  assert.match(appJs, /this\._fetch\('\/items\/move'/);
  assert.match(appJs, /await api\.moveItems\(stableItemIds, nextGroupName\)/);
});

test("all-links search highlights rows and group cards by group accent", () => {
  assert.match(appJs, /function isSearchGroupAccentMode/);
  assert.match(appJs, /function getSearchMatchGroupCounts/);
  assert.match(appJs, /function getGroupAccentHash/);
  assert.match(appJs, /function hslToRgbString/);
  assert.match(appJs, /const hue = hash % 360/);
  assert.doesNotMatch(appJs, /GROUP_ACCENT_PALETTE/);
  assert.match(appJs, /group-item-search-match/);
  assert.match(appJs, /row-group-search-match/);
  assert.match(styleCss, /\.group-item-search-match/);
  assert.match(styleCss, /\.row-group-search-match/);
  assert.match(appJs, /loadData\(\{ preserveScroll: false, force: true \}\)/);
});

test("search matches spotify links and URIs", () => {
  assert.match(appJs, /function getItemSpotifyUrl\(item\)/);
  assert.match(appJs, /function getSpotifyUri\(type, id\)/);
  assert.match(appJs, /function getItemSearchHaystacks\(item\)/);
  assert.match(appJs, /function doesItemMatchSearchQuery\(item, rawQuery\)/);
  assert.match(appJs, /const parsedQuery = parseSpotifyUrl\(rawQuery\)/);
  assert.match(appJs, /itemSpotifyId === String\(parsedQuery\.id \|\| ''\)\.toLowerCase\(\)/);
  assert.match(appJs, /items = items\.filter\(\(i\) => doesItemMatchSearchQuery\(i, state\.searchQuery\)\)/);
});

test("add-link modal shows detected Spotify type and ID before submit", () => {
  assert.match(indexHtml, /id="modal-link-preview"/);
  assert.match(indexHtml, /id="modal-link-preview-count"/);
  assert.match(appJs, /const SPOTIFY_TYPE_LABELS = Object\.freeze/);
  assert.match(appJs, /function updateModalLinkPreview\(rawInput = ''\)/);
  assert.match(appJs, /getSpotifyTypeLabel\(parsed\.type\)/);
  assert.match(appJs, /recognizedCount/);
  assert.match(appJs, /modal-batch-input.*addEventListener\('input'/s);
});

test("playlist clipboard uses the global admin line limit", () => {
  assert.match(appJs, /globalPreferences:/);
  assert.match(appJs, /saveAdminPreferences\(preferences = \{\}\)/);
  assert.match(appJs, /function getPlaylistClipboardLineLimit\(\)/);
  assert.match(appJs, /function getClipboardRowsForAction\(action, rows\)/);
  assert.match(appJs, /action !== 'clipboard-playlist-type3'/);
  assert.match(appJs, /sourceRows\.slice\(0, getPlaylistClipboardLineLimit\(\)\)/);
  assert.match(indexHtml, /id="settings-global-export"/);
  assert.match(indexHtml, /id="settings-playlist-clipboard-limit"/);
  assert.match(appJs, /settings-save-global/);
});

test("All Links blocks adding new links", () => {
  assert.match(appJs, /function updateAddLinkAvailability\(\)/);
  assert.match(appJs, /state\.activeGroup !== ALL_GROUP_ID/);
  assert.match(appJs, /Select a group before adding links/);
  assert.match(indexHtml, /id="btn-empty-add-link"/);
  assert.doesNotMatch(appJs, /value: GROUP_SELECT_ALL, label: ALL_GROUP_LABEL/);
});

test("new links append to the end of the current list", () => {
  assert.match(appJs, /state\.items\.push\(newItem\)/);
  assert.doesNotMatch(appJs, /state\.items\.unshift\(newItem\)/);
  assert.match(appJs, /function populateGroupSelect\(\)/);
  assert.match(appJs, /var options = \[\]/);
});

test("row drag persists a complete order when stored preferences miss rows", () => {
  assert.match(appJs, /function getStableRowOrderKeys\(items\)/);
  assert.match(appJs, /function mergeRowOrderKeys\(existingOrder, currentKeys\)/);
  assert.match(appJs, /const hasCompleteCurrentList = state\.listTotal > 0/);
  assert.match(appJs, /storedOrderCoversCurrentList/);
  assert.match(appJs, /const existingOrder = hasCompleteCurrentList && !storedOrderCoversCurrentList/);
  assert.match(appJs, /savePersistedRowOrder\(existingOrder\)/);
});

test("checked column exposes filter controls for error cleanup", () => {
  assert.match(appJs, /const CHECKED_SORT_MODES = Object\.freeze/);
  assert.match(appJs, /function ensureCheckedSortControls/);
  assert.match(appJs, /data-checked-sort-option="\$\{CHECKED_SORT_MODES\.ERROR_FIRST\}"/);
  assert.match(appJs, /state\.checkedSortMode = mode/);
});

test("pending job polling uses batch status endpoint", () => {
  assert.match(appJs, /getJobsBatch\(jobIds = \[\]\)/);
  assert.match(appJs, /this\._fetch\('\/jobs\/batch'/);
  assert.match(appJs, /const jobsById = await fetchPendingJobs\(pendingJobIds\)/);
  assert.match(appJs, /if \(!inBatch\) \{\s*shouldReload = true;\s*\}/);
  assert.match(appJs, /state\.batchRefresh = null;\s*shouldReload = true;/);
});

test("refresh all loads the full virtual scope before batching", () => {
  assert.match(appJs, /showToast\(`Loading \$\{state\.listTotal\} links before refresh\.\.\.`/);
  assert.match(appJs, /targetItems = await loadAllVirtualItemsForCurrentScope\(\)/);
  assert.match(appJs, /updateLoadedItemsById\(refreshableItems\.map\(\(item\) => item\.id\)/);
});
