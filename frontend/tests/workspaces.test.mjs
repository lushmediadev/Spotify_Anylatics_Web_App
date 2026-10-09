import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authSource = source.slice(source.indexOf('function getAuthUser()'), source.indexOf('function logout()'));
const json = value => JSON.parse(JSON.stringify(value));

function fixture(account) {
  const inputs = ['youtube', 'spotify', 'youtube-spotify'].map(value => ({ value, checked: false, focus() { this.focused = true; } }));
  const field = { hidden: true, querySelectorAll: selector => selector.endsWith(':checked') ? inputs.filter(input => input.checked) : inputs,
    querySelector: () => inputs[0] };
  const elements = {};
  for (const prefix of ['admin-create', 'admin-edit']) {
    elements[`${prefix}-workspace-field`] = field;
    elements[`${prefix}-role-dropdown`] = { getAttribute: () => 'manager' };
    elements[`${prefix}-status`] = { style: {}, textContent: '' };
    elements[`${prefix}-username`] = { value: 'example' };
    elements[`${prefix}-displayname`] = { value: '' };
  }
  elements['admin-create-password'] = { value: 'example-password' };
  elements['admin-edit-user-id'] = { value: 'target' };
  const local = { spoticheck_user: JSON.stringify(account) };
  const context = vm.createContext({
    state: { currentView: 'settings' },
    localStorage: { getItem: key => local[key], setItem: (key, value) => { local[key] = value; } },
    document: { getElementById: id => elements[id] || null }, console, setTimeout: () => {},
  });
  vm.runInContext(authSource, context);
  return { context, inputs, field, elements, setAccount: account => { local.spoticheck_user = JSON.stringify(account); } };
}

test('effective workspaces preserve legacy defaults, inheritance, empty access, and the independent combined workspace', () => {
  const { context } = fixture({ role: 'admin' });
  const cases = [
    [{ role: 'admin' }, ['youtube', 'spotify', 'youtube-spotify'], 'channels'],
    [{ role: 'manager' }, ['youtube'], 'ytm'],
    [{ role: 'user' }, ['youtube', 'spotify', 'youtube-spotify'], 'channels'],
    [{ role: 'manager', workspaces: ['spotify'] }, ['spotify'], 'linkchecker'],
    [{ role: 'user', manager_id: 'manager', workspaces: ['youtube-spotify'] }, ['youtube-spotify'], 'channels'],
    [{ role: 'user', manager_id: 'inactive-manager', workspaces: [] }, [], 'settings'],
  ];
  for (const [account, expected, landing] of cases) {
    assert.deepEqual(json(context.getEffectiveWorkspaces(account)), expected);
    assert.equal(context.getDefaultWorkspaceView(account), landing);
    assert.equal(context.canAccessView('account', account), true);
    assert.equal(context.canAccessView('settings', account), true);
    assert.equal(context.canAccessView('users', account), ['admin', 'manager'].includes(account.role));
  }
  const combinedOnly = { role: 'manager', workspaces: ['youtube-spotify'] };
  assert.equal(context.canAccessView('ytm', combinedOnly), false);
  assert.equal(context.canAccessView('linkchecker', combinedOnly), false);
});

test('admin manager selector prefills, validates at least one option, and sends only manager permissions', () => {
  const { context, inputs, field, setAccount } = fixture({ role: 'admin' });
  context.setupWorkspaceSelection('admin-edit', { role: 'manager', workspaces: ['spotify', 'youtube-spotify'] });
  assert.equal(field.hidden, false);
  assert.deepEqual(inputs.map(input => input.checked), [false, true, true]);
  assert.deepEqual(json(context.getWorkspaceAssignment('admin-edit', 'manager')), { workspaces: ['spotify', 'youtube-spotify'] });
  inputs.forEach(input => { input.checked = false; });
  assert.throws(() => context.getWorkspaceAssignment('admin-edit', 'manager'), /ít nhất/);
  assert.equal(inputs[0].focused, true);
  assert.deepEqual(json(context.getWorkspaceAssignment('admin-edit', 'user')), {});
  setAccount({ role: 'manager', workspaces: ['spotify'] });
  context.updateManagerAssignmentVisibility('admin-edit');
  assert.equal(field.hidden, true);
  assert.deepEqual(json(context.getWorkspaceAssignment('admin-edit', 'manager')), {});
  assert.equal(context.getAssignableRoles().length, 1);
  assert.equal(context.getAssignableRoles()[0].value, 'user');
  for (const prefix of ['admin-edit', 'admin-create']) {
    const fieldHtml = html.match(new RegExp(`<fieldset id="${prefix}-workspace-field"[\\s\\S]*?</fieldset>`))?.[0];
    assert.ok(fieldHtml?.includes(' hidden>'));
    assert.equal((fieldHtml.match(/type="checkbox"/g) || []).length, 3);
    assert.match(fieldHtml, /<legend>Workspace<\/legend>/);
    assert.equal((fieldHtml.match(/<label><input/g) || []).length, 3);
  }
});

test('create/edit submit blocks empty manager workspace and manager-created users omit permissions', async () => {
  const { context, inputs, elements, setAccount } = fixture({ role: 'admin' });
  const calls = [];
  Object.assign(context, {
    getAuthToken: () => 'token', CONFIG: { API_BASE: '/api' },
    fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ id: 'target' }) }; },
    showToast: () => {}, closeAdminCreateModal: () => {}, closeAdminEditModal: () => {},
    loadAdminUsers: async () => {},
  });
  vm.runInContext(source.slice(source.indexOf('async function submitAdminCreateUser()'), source.indexOf('function openAdminPwModal(')), context);
  await context.submitAdminCreateUser();
  await context.saveAdminEditUser();
  assert.equal(calls.length, 0);
  assert.match(elements['admin-edit-status'].textContent, /ít nhất/);
  inputs[2].checked = true;
  await context.submitAdminCreateUser();
  await context.saveAdminEditUser();
  assert.deepEqual(calls.map(call => call.body.workspaces), [['youtube-spotify'], ['youtube-spotify']]);
  setAccount({ role: 'manager', workspaces: ['youtube-spotify'] });
  for (const prefix of ['admin-create', 'admin-edit']) elements[`${prefix}-role-dropdown`].getAttribute = () => 'user';
  await context.submitAdminCreateUser();
  await context.saveAdminEditUser();
  assert.equal(calls[2].body.role, 'user');
  assert.equal(Object.hasOwn(calls[2].body, 'workspaces'), false);
  assert.equal(Object.hasOwn(calls[3].body, 'workspaces'), false);
  assert.equal(Object.hasOwn(calls[2].body, 'manager_id'), false);
});

test('sidebar and direct view navigation enforce effective assigned-user access', () => {
  const { context, elements, setAccount } = fixture({ role: 'user', manager_id: 'manager', workspaces: ['spotify'] });
  const style = () => ({ removeProperty(name) { delete this[name]; } });
  for (const id of ['nav-channels', 'nav-links', 'nav-ytm', 'nav-users']) elements[id] = { style: style(), classList: { add() {}, remove() {} }, querySelector: () => null };
  for (const id of ['sidebar-spoticheck-logo', 'sidebar-ytm-logo', 'sidebar-brand-name']) elements[id] = { style: style() };
  context.document.querySelector = () => null;
  context.document.querySelectorAll = () => [];
  context.document.body = { classList: { toggle() {} } };
  Object.assign(context, {
    state: {}, ALL_GROUP_ID: 'all', window: { ChannelPlaylists: { hide() {}, show() { throw new Error('forbidden combined view'); }, showKeySettings() {} } },
    updateAddLinkAvailability() {}, rebuildGroups() {}, renderList() {}, updateGroupHeader() {},
    showInstantListOrLoading() {}, getBackendListParams: () => ({}), loadData() {}, loadSettingsData() {},
  });
  vm.runInContext(source.slice(source.indexOf('function setElementDisplay('), source.indexOf('// Legacy wrappers')), context);
  context.switchToView('channels');
  assert.equal(context.state.currentView, 'linkchecker');
  assert.equal(elements['nav-channels'].style.display, 'none');
  assert.equal(elements['nav-ytm'].style.display, 'none');
  assert.equal(elements['nav-users'].style.display, 'none');
  assert.equal(elements['nav-links'].style.display, undefined);
  setAccount({ role: 'user', manager_id: 'manager', workspaces: [] });
  context.switchToView('linkchecker');
  assert.equal(context.state.currentView, 'settings');
  context.switchToView('account');
  assert.equal(context.state.currentView, 'account');
  setAccount({ role: 'manager', workspaces: ['youtube'] });
  for (const view of ['ytm', 'settings', 'account', 'users']) {
    context.updateWorkspaceNavigation(view);
    assert.equal(elements['sidebar-spoticheck-logo'].style.display, 'none');
    assert.equal(elements['sidebar-ytm-logo'].style.display, undefined);
    assert.equal(elements['sidebar-brand-name'].textContent, 'YouTube Manager');
  }
  setAccount({ role: 'user', manager_id: 'manager', workspaces: ['youtube'] });
  context.updateWorkspaceNavigation('settings');
  assert.equal(elements['sidebar-ytm-logo'].style.display, undefined);
  setAccount({ role: 'manager', workspaces: ['youtube', 'spotify'] });
  context.updateWorkspaceNavigation('settings');
  assert.equal(elements['sidebar-ytm-logo'].style.display, 'none');
  assert.equal(elements['sidebar-spoticheck-logo'].style.display, undefined);
  assert.equal(elements['sidebar-brand-name'].textContent, 'SpotiCheck');
  context.updateWorkspaceNavigation('ytm');
  assert.equal(elements['sidebar-ytm-logo'].style.display, undefined);
});

test('403 refreshes permissions once, stops revoked Spotify work, switches view, and does not retry mutations', async () => {
  const { context, elements } = fixture({ role: 'manager', id: 'manager', workspaces: ['spotify'] });
  let refreshes = 0;
  let mutations = 0;
  let stopped = 0;
  const state = { currentView: 'linkchecker', dataLoadRequestId: 1, listScopeCache: new Map([['cached', {}]]),
    pendingJobs: new Set(['job']), pendingJobToItem: new Map([['job', 'item']]), items: [{}], virtualItems: [{}] };
  Object.assign(context, {
    state, CONFIG: { API_BASE: '/api' }, getAuthToken: () => 'token', setupAuthUI() {},
    stopPolling: () => stopped++, switchToView: view => { state.currentView = view; },
    fetch: async url => {
      if (url === '/api/auth/me') { refreshes++; return { ok: true, json: async () => ({ id: 'manager', role: 'manager', workspaces: ['youtube'] }) }; }
      mutations++;
      return { status: 403, ok: false, clone: () => ({ json: async () => ({ detail: 'Access denied' }) }) };
    },
  });
  vm.runInContext(source.slice(source.indexOf('class SpotiCheckAPI'), source.indexOf('const api =')) + '\nconst api = new SpotiCheckAPI(CONFIG.API_BASE); globalThis.subject = api;', context);
  const results = await Promise.allSettled([context.subject._fetch('/crawl', { method: 'POST' }), context.subject._fetch('/items')]);
  assert.equal(refreshes, 1);
  assert.equal(mutations, 2);
  assert.equal(stopped, 1);
  assert.equal(state.currentView, 'ytm');
  assert.equal(state.listScopeCache.size, 0);
  assert.equal(state.pendingJobs.size, 0);
  assert.deepEqual(json(state.items), []);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.message === 'Access denied'));
  assert.equal(context.canAccessView('linkchecker'), false);
});

test('403 for a foreign resource keeps an otherwise permitted workspace and preserves its error', async () => {
  const { context } = fixture({ role: 'user', workspaces: ['spotify'] });
  const state = { currentView: 'linkchecker' };
  let switched = false;
  Object.assign(context, {
    state, CONFIG: { API_BASE: '/api' }, getAuthToken: () => 'token', setupAuthUI() {},
    switchToView: () => { switched = true; },
    fetch: async url => url === '/api/auth/me'
      ? { ok: true, json: async () => ({ role: 'user', workspaces: ['spotify'] }) }
      : { status: 403, ok: false, clone: () => ({ json: async () => ({ detail: 'Foreign item' }) }) },
  });
  vm.runInContext(source.slice(source.indexOf('class SpotiCheckAPI'), source.indexOf('const api =')) + '\nconst api = new SpotiCheckAPI(CONFIG.API_BASE); globalThis.subject = api;', context);
  await assert.rejects(() => context.subject._fetch('/items/track/foreign'), /Foreign item/);
  assert.equal(switched, false);
  assert.equal(state.currentView, 'linkchecker');
});

test('late auth response after token switch cannot overwrite the new account or navigate', async () => {
  const { context, setAccount } = fixture({ id: 'old', role: 'user', workspaces: ['spotify'] });
  let token = 'old-token';
  let resolveUser;
  let updated = false;
  Object.assign(context, {
    getAuthToken: () => token,
    api: { _fetch: () => new Promise(resolve => { resolveUser = resolve; }) },
    setupAuthUI: () => { updated = true; },
    switchToView: () => { updated = true; },
  });
  const refresh = context.refreshAuthUser();
  token = 'new-token';
  setAccount({ id: 'new', role: 'manager', workspaces: ['youtube'] });
  resolveUser({ id: 'old', role: 'user', workspaces: [] });
  await refresh;
  assert.equal(context.getAuthUser().id, 'new');
  assert.equal(updated, false);
});

test('a periodic role refresh creates a working Users link without duplicate click handlers', () => {
  const { context, elements, setAccount } = fixture({ role: 'user', workspaces: ['spotify'] });
  const style = () => ({ removeProperty(name) { delete this[name]; } });
  elements['nav-settings'] = { style: style() };
  context.document.querySelector = selector => selector === '#sidebar nav'
    ? { insertBefore: element => { elements[element.id] = element; } } : null;
  context.document.createElement = () => ({ dataset: {}, style: style() });
  context.setElementDisplay = (element, mode) => { if (element) element.style.display = mode; };
  const navigation = [];
  context.switchToView = view => navigation.push(view);
  const start = source.indexOf('function setupAuthUI()');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  context.setupAuthUI();
  assert.equal(elements['nav-users'], undefined);
  setAccount({ role: 'manager', workspaces: ['spotify'] });
  context.setupAuthUI();
  assert.equal(typeof elements['nav-users'].onclick, 'function');
  context.setupAuthUI();
  let prevented = false;
  elements['nav-users'].onclick({ preventDefault: () => { prevented = true; } });
  assert.deepEqual(navigation, ['users']);
  assert.equal(prevented, true);
});

test('YTM 403 notifies its same-origin parent with throttling for API and downloads', async () => {
  const ytmSource = fs.readFileSync(new URL('../ytm/app.js', import.meta.url), 'utf8');
  const messages = [];
  const context = vm.createContext({ CONFIG: { API_BASE: '/api/ytm' }, token: () => 'token',
    window: { location: { origin: 'http://localhost' }, parent: { postMessage: (...args) => messages.push(args) } },
    fetch: async () => ({ status: 403, ok: false, clone: () => ({ json: async () => ({ detail: 'Forbidden' }) }) }),
  });
  vm.runInContext(ytmSource.slice(ytmSource.indexOf('let lastForbiddenNotification'), ytmSource.indexOf('function buildQuery(')), context);
  await assert.rejects(() => context.apiFetch('/items'), /Forbidden/);
  await assert.rejects(() => context.apiDownload('/export'), /Forbidden/);
  assert.equal(messages.length, 1);
  assert.deepEqual(json(messages[0]), [{ type: 'spoticheck-workspace-forbidden', workspace: 'youtube' }, 'http://localhost']);
  assert.match(source, /event\.origin !== location\.origin \|\| event\.source !== frame\?\.contentWindow/);
});
