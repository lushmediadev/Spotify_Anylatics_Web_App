import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../channels.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../channels.css', import.meta.url), 'utf8');
const sharedCss = await readFile(new URL('../style.css', import.meta.url), 'utf8');

function loadPlaywright() {
    const candidates = ['playwright', process.env.PLAYWRIGHT_MODULE_PATH];
    if (process.env.USERPROFILE) {
        candidates.push(path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes',
            'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'));
    }
    for (const candidate of candidates.filter(Boolean)) {
        try { return require(candidate); } catch (_) { /* Try the next configured runtime. */ }
    }
    return null;
}

test('ChannelPlaylists isolated browser behavior', async t => {
    const playwright = loadPlaywright();
    if (!playwright) { t.skip('Install playwright or set PLAYWRIGHT_MODULE_PATH to run browser checks.'); return; }
    let browser;
    try {
        browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
    } catch (_) {
        try { browser = await playwright.chromium.launch({ headless: true }); }
        catch (_) { t.skip('Chrome or a Playwright Chromium installation is required.'); return; }
    }
    t.after(() => browser.close());

    async function fixture() {
        const page = await browser.newPage({ viewport: { width: 997, height: 900 } });
        page.setDefaultTimeout(6000);
        const html = '<html data-theme="light"><head><meta charset="UTF-8"></head><body><header class="topbar"><div><h1 id="page-title"></h1><span id="breadcrumb-group"></span></div><div id="channel-header-tools"></div></header><aside id="group-panel"><div id="channel-group-tools" class="p-5 pb-3"></div><div id="channel-group-rail"></div></aside><div id="channels-panel"></div>' +
            '<div id="youtube-key-settings"></div><button id="nav-settings">Settings</button>';
        await page.route('http://channel.test/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
        await page.goto('http://channel.test/');
        await page.addStyleTag({ content: sharedCss + css + '\n.flex{display:flex}.items-center{align-items:center}.gap-4{gap:16px}.px-4{padding-left:16px;padding-right:16px}.py-3{padding-top:12px;padding-bottom:12px}.px-5{padding-left:20px;padding-right:20px}.py-8{padding-top:32px;padding-bottom:32px}.text-right{text-align:right}.relative{position:relative}.absolute{position:absolute}.topbar{height:auto;flex-wrap:wrap}body{display:block;overflow:auto}@media(max-width:767px){#group-panel{display:none}}' });
        await page.evaluate(() => {
            window.polls = new Map();
            let timerId = 0;
            window.setInterval = callback => { window.polls.set(++timerId, callback); return timerId; };
            window.clearInterval = id => window.polls.delete(id);
        });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => {
            window.calls = [];
            window.data = {
                items: [{
                    id: 'c1', user_id: 'owner', group: 'Nhóm Việt', name: '<img src=x onerror=alert(1)>',
                    query: '@channel', view_count: 2328473, status: 'active', playlists: [{
                        id: 'p1', user_id: 'owner', spotify_id: 'abc', name: 'Playlist Việt',
                        owner_name: 'Spotify Owner', user_name: 'User <script>', saves: 2328473,
                        track_count: 10, followers_delta: 200, track_count_delta: -1, delta_days: 2,
                    }],
                }],
                total: 1, groups: [{ name: 'Nhóm Việt', count: 1 }], has_keys: false,
            };
            window.keyResults = [{ index: 0, valid: false, error_code: 'invalid_key', error_message: 'SECRET' }];
            window.handleRequest = async requestPath => {
                if (requestPath.startsWith('/youtube/channels?')) {
                    const params = new URL(requestPath, 'https://local').searchParams;
                    const data = structuredClone(window.data);
                    data.items = data.items.slice(Number(params.get('offset')), Number(params.get('offset')) + Number(params.get('limit')));
                    return data;
                }
                if (requestPath.startsWith('/items?')) return { items: window.data.items[0].playlists, total: 1 };
                if (requestPath === '/auth/me/groups') return { groups: ['Empty Album', 'Empty Playlist', 'all'] };
                if (requestPath === '/items/summary') return { groups: [{ name: 'Track Only', count: 57 }] };
                if (requestPath === '/youtube/keys') return { api_keys: 'SECRET' };
                if (requestPath === '/youtube/keys/check') return { results: window.keyResults };
                return { accepted: 1, skipped: 0 };
            };
            window.actor = { id: 'owner' };
            ChannelPlaylists.init({
                getUser: () => window.actor,
                onGroupChanged: name => { (window.groupChanges ||= []).push(name); },
                onItemChanged: () => { window.itemChangeCount = (window.itemChangeCount || 0) + 1; },
                request: (requestPath, options) => {
                    window.calls.push({ path: requestPath, ...options });
                    return window.handleRequest(requestPath, options);
                },
            });
        });
        return page;
    }

    async function workspaceFixture() {
        const page = await fixture();
        await page.evaluate(async () => {
            const channel = window.data.items[0], playlist = channel.playlists[0];
            window.data = {
                groups: [{ name: 'G', count: 3 }, { name: 'Hidden Group', count: 0 }, { name: 'Target', count: 1 }], has_keys: true,
                items: [
                    { ...channel, id: 'c1', group: 'G', name: 'Alpha', youtube_url: 'https://www.youtube.com/@alpha', playlists: [{ ...playlist, type: 'playlist', id: 'p1' }, { ...playlist, type: 'playlist', id: 'p2', spotify_id: 'def' }] },
                    { ...channel, id: 'c2', group: 'G', name: 'Hidden', youtube_url: 'https://www.youtube.com/@hidden', playlists: [] },
                    { ...channel, id: 'c3', group: 'G', name: 'Gamma', youtube_url: 'https://www.youtube.com/@gamma', playlists: [{ ...playlist, type: 'playlist', id: 'p1' }] },
                    { ...channel, id: 'c4', group: 'Target', name: 'Delta', playlists: [] },
                ],
            };
            window.prefs = { group_order: [], channel_orders: {}, playlist_orders: {} };
            window.actions = []; window.copies = []; window.previews = []; window.exports = [];
            const order = (rows, ids, key = row => row.id) => [...rows].sort((a, b) => (ids.indexOf(key(a)) < 0 ? ids.length : ids.indexOf(key(a))) - (ids.indexOf(key(b)) < 0 ? ids.length : ids.indexOf(key(b))));
            window.handleRequest = async (requestPath, options = {}) => {
                const body = options.body && JSON.parse(options.body);
                if (requestPath === '/youtube/preferences') {
                    if (options.method === 'PUT') {
                        if (window.failWrite) throw new Error('WRITE FAILED');
                        if (window.holdWrite) await new Promise(resolve => { window.finishWrite = resolve; });
                        for (const [key, value] of Object.entries(body)) window.prefs[key] = key === 'group_order' ? value : { ...window.prefs[key], ...value };
                    }
                    return structuredClone(window.prefs);
                }
                if (requestPath.startsWith('/youtube/channels?')) {
                    const params = new URL(requestPath, 'https://local').searchParams;
                    let items = structuredClone(window.data.items.filter(row => row.user_id === window.actor.id && (!params.get('group') || row.group === params.get('group'))));
                    if (params.get('search')) items = items.filter(row => row.name !== 'Hidden');
                    items = order(items, window.prefs.channel_orders[params.get('group')] || []);
                    for (const item of items) item.playlists = order(item.playlists, window.prefs.playlist_orders[item.id] || []);
                    const offset = Number(params.get('offset')), limit = Number(params.get('limit'));
                    const data = { items: items.slice(offset, offset + limit), total: items.length, groups: order(structuredClone(window.data.groups), window.prefs.group_order), has_keys: true };
                    if (window.holdRead) { window.holdRead = false; await new Promise(resolve => { window.finishRead = () => resolve(); }); }
                    return data;
                }
                if (requestPath === '/youtube/groups' && options.method === 'POST') window.data.groups.push({ name: body.name, count: 0 });
                if (requestPath === '/youtube/groups' && options.method === 'PATCH') {
                    window.data.groups.find(group => group.name === body.old_name).name = body.new_name;
                    for (const item of window.data.items) if (item.group === body.old_name) item.group = body.new_name;
                }
                if (requestPath === '/youtube/groups/delete') {
                    window.data.groups = window.data.groups.filter(group => !body.names.includes(group.name));
                    for (const item of window.data.items) if (body.names.includes(item.group)) item.group = 'Ungrouped';
                    if (!window.data.groups.some(group => group.name === 'Ungrouped')) window.data.groups.push({ name: 'Ungrouped', count: 1 });
                }
                if (requestPath === '/youtube/groups/clear') window.data.items = window.data.items.filter(item => item.group !== body.name);
                if (requestPath === '/youtube/channels/move') for (const item of window.data.items) if (body.channel_ids.includes(item.id)) item.group = body.group;
                if (requestPath === '/youtube/channels/delete') window.data.items = window.data.items.filter(item => !body.channel_ids.includes(item.id));
                const association = requestPath.match(/^\/youtube\/channels\/([^/]+)\/playlists$/);
                if (association && options.method === 'PUT') {
                    const item = window.data.items.find(row => row.id === association[1]);
                    item.playlists = item.playlists.filter(row => body.item_ids.includes(row.id));
                }
                return { accepted: 1 };
            };
            window.options = {
                getUser: () => window.actor,
                request: (path, options) => { window.calls.push({ path, ...options }); return window.handleRequest(path, options); },
                runPlaylistAction: async (action, items) => { window.actions.push({ action, items: structuredClone(items) }); },
                copyLinks: async text => { window.copies.push(text); },
                previewImage: url => { window.previews.push(url); },
                exportChannels: items => { window.exports.push(items.map(item => item.id)); },
            };
            ChannelPlaylists.init(window.options); await ChannelPlaylists.show();
        });
        return page;
    }
    const channelIds = page => page.locator('[data-chp-channel]').evaluateAll(rows => rows.map(row => row.dataset.chpChannel));
    async function drag(page, source, target, after = true) {
        const rect = await page.locator(target).boundingBox();
        await page.locator(source).dragTo(page.locator(target), { sourcePosition: { x: 20, y: 20 }, targetPosition: { x: 20, y: after ? rect.height - 2 : 2 } });
    }

    await t.test('channel selection replaces, Ctrl toggles, Shift ranges and keyboard guards legacy handlers', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-channel="c1"] .stt-cell').click();
            await page.locator('[data-chp-channel="c3"] .stt-cell').click({ modifiers: ['Shift'] });
            assert.equal(await page.locator('.chp-channel[aria-selected="true"]').count(), 3);
            await page.locator('[data-chp-channel="c2"] .stt-cell').click({ modifiers: ['Control'] });
            assert.equal(await page.locator('.chp-channel[aria-selected="true"]').count(), 2);
            await page.locator('[data-chp-channel="c1"] .stt-cell').click();
            assert.equal(await page.locator('.chp-channel[aria-selected="true"]').count(), 1);
            await page.evaluate(() => document.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'a') window.legacyKeys = (window.legacyKeys || 0) + 1; }));
            await page.keyboard.press('Control+a');
            assert.equal(await page.locator('.chp-channel[aria-selected="true"]').count(), 3);
            assert.equal(await page.evaluate(() => window.legacyKeys || 0), 0);
            await page.keyboard.press('Control+c');
            assert.equal((await page.evaluate(() => window.copies[0])).split('\n').length, 3);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('.chp-channel[aria-selected="true"]').count(), 0);
            await page.locator('.chp-search').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
            assert.equal(await page.locator('.chp-dialog').count(), 0);
            await page.locator('[data-chp-channel="c1"]').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
            assert.match(await page.locator('.chp-dialog-body').textContent(), /3 kênh.*Spotify Item/);
            await page.getByRole('button', { name: 'Xóa kênh', exact: true }).click();
            await page.waitForFunction(() => window.calls.some(call => call.path === '/youtube/channels/delete'));
            assert.deepEqual(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/channels/delete').body)), { channel_ids: ['c1', 'c2', 'c3'] });
            assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'DELETE')), false);
        } finally { await page.close(); }
    });

    await t.test('outside clicks clear row selection and channel double-click toggles children only', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-channel="c1"] .stt-cell').click();
            await page.locator('[data-chp-playlist="c1:p1"] .stt-cell').click();
            assert.equal(await page.locator('.chp-channel.row-selected').count(), 0);
            assert.equal(await page.locator('.chp-playlist-grid.row-selected').count(), 1);
            await page.locator('.playlist-hero h2').click();
            assert.equal(await page.locator('#channels-panel .row-selected').count(), 0);
            assert.equal(await page.locator('[data-chp-kpi="Selected"]').textContent(), '0');
            await page.locator('[data-chp-channel="c1"] .stt-cell').dblclick();
            assert.equal(await page.locator('[data-chp-block="c1"] .chp-children').isVisible(), false);
            assert.equal(await page.locator('[data-chp-block="c2"] .chp-children').isVisible(), true);
            await page.locator('[data-chp-channel="c1"] .stt-cell').dblclick();
            assert.equal(await page.locator('[data-chp-block="c1"] .chp-children').isVisible(), true);
            await page.locator('[data-chp-playlist="c1:p1"] .stt-cell').dblclick();
            assert.equal(await page.locator('[data-chp-block="c1"] .chp-children').isVisible(), true);
            await page.locator('.chp-search').click();
            assert.equal(await page.locator('#channels-panel .row-selected').count(), 0);
            await page.locator('[data-chp-channel="c1"] .stt-cell').click();
            await page.locator('[data-chp-channel="c3"] .stt-cell').click({ modifiers: ['Shift'] });
            assert.equal(await page.locator('.chp-channel.row-selected').count(), 3);
            await page.locator('[data-chp-channel="c1"]').click({ button: 'right' });
            await page.getByRole('menuitem', { name: /Move To Group$/ }).click();
            assert.equal(await page.locator('.chp-channel.row-selected').count(), 3);
            await page.keyboard.press('Escape');
        } finally { await page.close(); }
    });

    await t.test('group multiselection rename delete and atomic clear preserve Spotify associations', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-group="G"]').dblclick();
            await page.locator('[name="name"]').fill('Renamed'); await page.getByRole('button', { name: 'Lưu', exact: true }).click();
            await page.waitForSelector('[data-chp-group="Renamed"]');
            assert.deepEqual(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/groups' && call.method === 'PATCH').body)), { old_name: 'G', new_name: 'Renamed' });
            await page.locator('[data-chp-group="Renamed"]').click();
            await page.locator('[data-chp-group="Target"]').click({ modifiers: ['Shift'] });
            assert.equal(await page.locator('.chp-group-multi').count(), 3);
            await page.keyboard.press('Delete');
            await page.getByRole('button', { name: 'Xóa nhóm', exact: true }).click();
            await page.waitForSelector('[data-chp-group="Ungrouped"]');
            assert.equal(await page.evaluate(() => window.data.items.length), 4);
            assert.equal(await page.evaluate(() => window.calls.some(call => /\/items\//.test(call.path) && call.method === 'DELETE')), false);
            await page.locator('[data-chp-channel="c1"]').click({ button: 'right' });
            await page.locator('[data-menu="clear"]').click();
            await page.getByRole('button', { name: 'Xóa kênh', exact: true }).click();
            await page.waitForFunction(() => window.calls.some(call => call.path === '/youtube/groups/clear'));
            assert.deepEqual(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/groups/clear').body)), { name: 'Ungrouped' });
            assert.equal(await page.evaluate(() => window.calls.some(call => call.path === '/youtube/channels/delete')), false);
        } finally { await page.close(); }
    });

    await t.test('CUT paste and row-to-group drop call atomic move without cloning channels', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-channel="c1"] .stt-cell').click();
            await page.locator('[data-chp-channel="c3"] .stt-cell').click({ modifiers: ['Control'] });
            await page.keyboard.press('Control+x'); await page.locator('[data-chp-group="Target"]').click();
            await page.waitForSelector('[data-chp-channel="c4"]'); await page.keyboard.press('Control+v');
            await page.waitForFunction(() => window.calls.some(call => call.path === '/youtube/channels/move'));
            assert.deepEqual(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/channels/move').body)), { channel_ids: ['c1', 'c3'], group: 'Target' });
            await page.locator('[data-chp-group="G"]').click(); await page.waitForSelector('[data-chp-channel="c2"]');
            await drag(page, '[data-chp-channel="c2"]', '[data-chp-group="Target"]');
            await page.waitForFunction(() => window.calls.filter(call => call.path === '/youtube/channels/move').length === 2);
            assert.equal(await page.evaluate(() => window.data.items.length), 4);
        } finally { await page.close(); }
    });

    await t.test('real channel DnD stores complete orders, preserves hidden slots and survives polling', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('.chp-search').fill('visible');
            await page.waitForFunction(() => document.querySelectorAll('[data-chp-channel]').length === 2);
            await drag(page, '[data-chp-channel="c3"]', '[data-chp-channel="c1"]', false);
            await page.waitForFunction(() => window.prefs.channel_orders.G?.[0] === 'c3');
            assert.deepEqual(await page.evaluate(() => window.prefs.channel_orders.G), ['c3', 'c2', 'c1']);
            assert.deepEqual(await channelIds(page), ['c3', 'c1']);
            await page.evaluate(async () => { document.activeElement.blur(); await ChannelPlaylists.reload(true); });
            assert.deepEqual(await channelIds(page), ['c3', 'c1']);
            await page.locator('.chp-search').fill('');
            await page.waitForFunction(() => document.querySelectorAll('[data-chp-channel]').length === 3);
            assert.deepEqual(await channelIds(page), ['c3', 'c2', 'c1']);
            await page.evaluate(async () => { window.prefs.channel_orders.G = ['c1', 'c2', 'c3']; document.activeElement.blur(); await ChannelPlaylists.reload(true); });
            assert.deepEqual(await channelIds(page), ['c1', 'c2', 'c3']);
        } finally { await page.close(); }
    });

    await t.test('group DnD persists a full order and New Group remains appended', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('#channel-group-tools input').fill('G');
            await drag(page, '[data-chp-group="Hidden Group"]', '[data-chp-group="G"]', false);
            await page.waitForFunction(() => window.prefs.group_order.length === 3);
            assert.deepEqual(await page.evaluate(() => window.prefs.group_order), ['Hidden Group', 'G', 'Target']);
            await page.locator('#channel-group-tools input').fill('');
            await page.locator('#channel-group-rail [data-chp-action="new-group"]').click();
            await page.locator('[name="name"]').fill('New'); await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
            await page.waitForSelector('[data-chp-group="New"]');
            assert.deepEqual(await page.locator('[data-chp-group]').evaluateAll(rows => rows.map(row => row.dataset.chpGroup)), ['Hidden Group', 'G', 'Target', 'New']);
        } finally { await page.close(); }
    });

    await t.test('multi-row DnD keeps selection order and pending writes block polling', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-channel="c1"] .stt-cell').click();
            await page.locator('[data-chp-channel="c3"] .stt-cell').click({ modifiers: ['Control'] });
            await page.evaluate(() => { window.holdWrite = true; });
            await drag(page, '[data-chp-channel="c1"]', '[data-chp-channel="c2"]');
            await page.waitForFunction(() => !!window.finishWrite);
            assert.deepEqual(await channelIds(page), ['c2', 'c1', 'c3']);
            const reads = await page.evaluate(() => window.calls.filter(call => call.method === 'GET').length);
            await page.evaluate(async () => { await ChannelPlaylists.reload(true); });
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'GET').length), reads);
            await page.evaluate(() => { window.holdWrite = false; window.finishWrite(); });
            await page.waitForFunction(() => window.prefs.channel_orders.G?.[0] === 'c2');
            assert.deepEqual(await page.evaluate(() => window.prefs.channel_orders.G), ['c2', 'c1', 'c3']);
        } finally { await page.close(); }
    });

    await t.test('large selection moves and refreshes batch 500 without empty requests', async () => {
        const page = await workspaceFixture();
        try {
            await page.evaluate(async () => {
                const item = window.data.items[0];
                window.data.items = Array.from({ length: 501 }, (_, index) => ({ ...item, id: `large-${index}`, playlists: [] }));
                await ChannelPlaylists.reload();
            });
            await page.locator('[data-chp-channel="large-0"]').focus(); await page.keyboard.press('Control+a');
            await page.locator('[data-chp-channel="large-0"]').click({ button: 'right' });
            await page.locator('[data-menu="refresh"]').click();
            await page.waitForFunction(() => window.calls.filter(call => call.path === '/youtube/channels/refresh').length === 2);
            assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.path === '/youtube/channels/refresh').map(call => JSON.parse(call.body).channel_ids.length)), [500, 1]);
            await page.locator('[data-chp-channel="large-0"]').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
            await page.locator('[data-chp-group="Target"]').click(); await page.keyboard.press('Control+v');
            await page.waitForFunction(() => window.calls.filter(call => call.path === '/youtube/channels/move').length === 2);
            assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.path === '/youtube/channels/move').map(call => JSON.parse(call.body).channel_ids.length)), [500, 1]);
        } finally { await page.close(); }
    });

    await t.test('playlist focus selects visible associations, delegates exact actions and unlinks only chosen parent', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-playlist="c1:p1"] .stt-cell').click();
            await page.locator('[data-chp-playlist="c1:p2"] .stt-cell').click({ modifiers: ['Shift'] });
            assert.equal(await page.locator('[data-chp-playlist][aria-selected="true"]').count(), 2);
            await page.keyboard.press('Control+a');
            assert.equal(await page.locator('[data-chp-playlist][aria-selected="true"]').count(), 3);
            for (const action of ['fetch-selected', 'copy-selected-links', 'clipboard-auto', 'txt-playlist-type3', 'export-listview-excel']) {
                await page.locator('[data-chp-playlist="c1:p1"]').click({ button: 'right' });
                await page.locator(`[data-command="${action}"]`).click();
                await page.waitForFunction(action => window.actions.some(entry => entry.action === action), action);
            }
            assert.equal(await page.evaluate(() => window.actions.every(entry => entry.items.length === 2 && entry.items.every(item => item.type === 'playlist' && item.user_id === 'owner'))), true);
            await page.locator('[data-chp-playlist="c1:p1"] .stt-cell').click(); await page.keyboard.press('Delete');
            await page.getByRole('button', { name: 'Gỡ liên kết', exact: true }).click();
            await page.waitForFunction(() => window.calls.some(call => call.path === '/youtube/channels/c1/playlists' && call.method === 'PUT'));
            assert.deepEqual(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/channels/c1/playlists' && call.method === 'PUT').body)), { item_ids: ['p2'], urls: [] });
            assert.equal(await page.evaluate(() => window.data.items.find(item => item.id === 'c3').playlists.length), 1);
            assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'DELETE')), false);
        } finally { await page.close(); }
    });

    await t.test('playlist DnD is same-parent only, sorted channel reorder is disabled', async () => {
        const page = await workspaceFixture();
        try {
            await drag(page, '[data-chp-playlist="c1:p2"]', '[data-chp-playlist="c1:p1"]', false);
            await page.waitForFunction(() => window.prefs.playlist_orders.c1?.[0] === 'p2');
            assert.deepEqual(await page.evaluate(() => window.prefs.playlist_orders.c1), ['p2', 'p1']);
            const writes = await page.evaluate(() => window.calls.filter(call => call.method === 'PUT').length);
            await drag(page, '[data-chp-playlist="c1:p2"]', '[data-chp-playlist="c3:p1"]');
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'PUT').length), writes);
            await page.locator('[data-chp-sort="name"]').click();
            await drag(page, '[data-chp-channel="c3"]', '[data-chp-channel="c1"]', false);
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'PUT').length), writes);
            await page.locator('[data-chp-sort="name"]').click(); assert.deepEqual(await channelIds(page), ['c2', 'c3', 'c1']);
            await page.locator('[data-chp-sort="name"]').click(); assert.deepEqual(await channelIds(page), ['c1', 'c2', 'c3']);
            assert.equal(await page.evaluate(() => window.calls.some(call => /playlists$/.test(call.path) && call.method === 'PUT')), false);
        } finally { await page.close(); }
    });

    await t.test('failed preference write rolls back and a late poll cannot undo optimistic DnD', async () => {
        const page = await workspaceFixture();
        try {
            await page.evaluate(() => { window.failWrite = true; });
            await drag(page, '[data-chp-channel="c3"]', '[data-chp-channel="c1"]', false);
            await page.waitForFunction(() => document.querySelector('.chp-status').textContent.includes('WRITE FAILED'));
            assert.deepEqual(await channelIds(page), ['c1', 'c2', 'c3']);
            await page.evaluate(() => { window.failWrite = false; window.holdRead = true; window.pendingRead = ChannelPlaylists.reload(true); });
            await page.waitForFunction(() => !!window.finishRead);
            await drag(page, '[data-chp-channel="c3"]', '[data-chp-channel="c1"]', false);
            await page.waitForFunction(() => window.prefs.channel_orders.G?.[0] === 'c3');
            await page.evaluate(async () => { window.finishRead(); await window.pendingRead; });
            assert.deepEqual(await channelIds(page), ['c3', 'c1', 'c2']);
        } finally { await page.close(); }
    });

    await t.test('owner-only data, hidden view keyboard and channel export/image hooks stay isolated', async () => {
        const page = await workspaceFixture();
        try {
            await page.evaluate(async () => {
                window.data.items.push({ ...window.data.items[0], id: 'foreign', user_id: 'foreign' });
                const original = window.handleRequest;
                window.handleRequest = async (path, options) => {
                    const data = await original(path, options);
                    if (path.startsWith('/youtube/channels?')) data.items.push({ ...window.data.items.at(-1) });
                    return data;
                };
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.locator('[data-chp-channel="foreign"]').count(), 0);
            await page.evaluate(async () => { window.data.items[0].image = 'https://example.com/channel.png'; await ChannelPlaylists.reload(); });
            await page.locator('[data-chp-channel="c1"] .list-cover-image').click();
            assert.deepEqual(await page.evaluate(() => window.previews), ['https://example.com/channel.png']);
            await page.locator('[data-chp-channel="c1"]').click({ button: 'right' });
            await page.locator('[data-menu="export"]').click();
            assert.deepEqual(await page.evaluate(() => window.exports), [['c1']]);
            await page.evaluate(async () => { ChannelPlaylists.hide(); document.body.focus(); });
            const count = await page.evaluate(() => window.calls.length);
            await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
            assert.equal(await page.locator('.chp-dialog').count(), 0);
            assert.equal(await page.evaluate(() => window.calls.length), count);
        } finally { await page.close(); }
    });

    await t.test('resize is bounded, persisted per account, resettable and canceled on hide', async () => {
        const page = await workspaceFixture();
        try {
            const handle = page.locator('[data-chp-resize="3"]');
            const rect = await handle.boundingBox();
            await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
            await page.mouse.move(rect.x + 3000, rect.y + rect.height / 2); await page.mouse.up();
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('spoticheck_channel_column_widths_owner'))[3]), 800);
            const columns = await page.locator('.chp-channel').first().evaluate(node => getComputedStyle(node).gridTemplateColumns);
            assert.equal(await page.locator('.chp-playlist-grid').first().evaluate(node => getComputedStyle(node).gridTemplateColumns), columns);
            await page.evaluate(async () => { ChannelPlaylists.init(window.options); await ChannelPlaylists.show(); });
            assert.match(await page.locator('.chp-channel').first().evaluate(node => getComputedStyle(node).gridTemplateColumns), /800px/);
            await page.locator('[data-chp-resize="3"]').dblclick();
            assert.equal(await page.evaluate(() => localStorage.getItem('spoticheck_channel_column_widths_owner')), null);
            await page.evaluate(async () => {
                localStorage.setItem('spoticheck_channel_column_widths_other', JSON.stringify([1, 280, 160, 9999, 160, 200]));
                window.actor.id = 'other'; for (const item of window.data.items) item.user_id = 'other';
                await ChannelPlaylists.syncAccountScope();
            });
            assert.equal(await page.locator('#channels-panel').evaluate(node => node.style.getPropertyValue('--chp-columns')), '48px 280px 160px 800px 160px 200px');
            const next = await page.locator('[data-chp-resize="0"]').boundingBox();
            await page.mouse.move(next.x + 5, next.y + 5); await page.mouse.down();
            await page.evaluate(() => ChannelPlaylists.hide()); await page.mouse.move(next.x + 100, next.y + 5); await page.mouse.up();
            assert.equal(await page.locator('body').evaluate(node => node.classList.contains('chp-resizing')), false);
        } finally { await page.close(); }
    });

    await t.test('keys/check renders per-key results without echoing secrets or owner filters', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                await ChannelPlaylists.show({ userId: 'other-owner' });
                await ChannelPlaylists.showKeySettings();
            });
            await page.locator('[data-check]').click();
            await page.waitForFunction(() => document.querySelector('.chp-key-status').textContent.includes('Key 1:'));
            assert.match(await page.locator('.chp-key-status').textContent(), /Key 1: Key không hợp lệ/);
            assert.doesNotMatch(await page.locator('.chp-key-status').textContent(), /SECRET/);
            await page.evaluate(() => {
                window.keyResults = [
                    { index: 0, status: 'valid' }, { index: 1, status: 'quota_exceeded' },
                    { index: 2, valid: false, error_code: 'network_error', error_message: 'SECRET' },
                ];
            });
            await page.locator('[data-check]').click();
            await page.waitForFunction(() => document.querySelector('.chp-key-status').textContent.includes('Key 3:'));
            assert.match(await page.locator('.chp-key-status').textContent(), /Key 1: Hợp lệ.*Key 2: Hết quota.*Key 3: Lỗi kết nối/);
            const keyCalls = await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/keys')));
            assert.ok(keyCalls.every(call => !call.path.includes('?')));
            assert.equal(JSON.parse(keyCalls.find(call => call.path.endsWith('/check')).body).api_keys, 'SECRET');
        } finally { await page.close(); }
    });

    await t.test('legacy foreign account options cannot change the signed-in data scope', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                await ChannelPlaylists.show({ userId: 'foreign-account' });
                await ChannelPlaylists.syncAccountScope('foreign-account');
            });
            const ids = await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/channels?')).map(call => new URL(call.path, 'https://local').searchParams.get('user_id')));
            assert.ok(ids.length > 0 && ids.every(id => id === 'owner'));
            assert.equal(await page.evaluate(() => typeof ChannelPlaylists.setUserFilter), 'undefined');
            assert.equal(await page.locator('[data-chp-channel="c1"]').count(), 1);
        } finally { await page.close(); }
    });

    await t.test('New Group persists an owner-scoped empty group, selects it and remains available on mobile', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                const original = window.handleRequest;
                window.handleRequest = async (requestPath, options) => {
                    if (requestPath === '/youtube/groups' && options.method === 'POST') {
                        const body = JSON.parse(options.body);
                        window.data.groups.push({ name: body.name, count: 0 });
                        return { name: body.name, count: 0 };
                    }
                    if (requestPath.startsWith('/youtube/channels?') && new URL(requestPath, 'https://local').searchParams.get('group') === 'Nhóm mới') {
                        return { ...structuredClone(window.data), items: [], total: 0 };
                    }
                    return original(requestPath, options);
                };
                await ChannelPlaylists.show({ userId: 'owner' });
            });
            assert.equal(await page.locator('[data-chp-group="Nhóm Việt"]').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('[data-chp-group=""]').count(), 0);
            await page.locator('#channel-group-rail [data-chp-action="new-group"]').click();
            await page.locator('[name="name"]').fill('   ');
            await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('.chp-dialog-status').textContent.includes('Nhập tên nhóm'));
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.path === '/youtube/groups').length), 0);
            await page.locator('[name="name"]').fill('  Nhóm mới  ');
            await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
            await page.waitForSelector('[data-chp-group="Nhóm mới"]');
            const call = await page.evaluate(() => window.calls.find(entry => entry.path === '/youtube/groups'));
            assert.equal(call.method, 'POST');
            assert.deepEqual(JSON.parse(call.body), { name: 'Nhóm mới', target_user_id: 'owner' });
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"]').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"] .group-count').textContent(), '0');
            await page.evaluate(() => ChannelPlaylists.reload());
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"]').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"] .group-count').textContent(), '0');
            await page.setViewportSize({ width: 600, height: 900 });
            assert.equal(await page.locator('.chp-new-group-toolbar').isVisible(), true);
            await page.locator('.chp-new-group-toolbar').click();
            assert.equal(await page.locator('[name="name"]').isVisible(), true);
        } finally { await page.close(); }
    });

    await t.test('owner changes reject stale success and stale error even when wrapper ignores abort', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                const original = window.handleRequest;
                window.handleRequest = requestPath => {
                    if (requestPath.includes('user_id=slow')) return new Promise(resolve => { window.finishSlow = resolve; });
                    if (requestPath.includes('user_id=failed')) return new Promise((_, reject) => { window.failSlow = reject; });
                    return original(requestPath);
                };
                window.actor.id = 'slow';
                window.oldLoad = ChannelPlaylists.show();
                await Promise.resolve(); await Promise.resolve();
                window.actor.id = 'owner';
                await ChannelPlaylists.syncAccountScope();
                window.finishSlow({ items: [{ id: 'stale', name: 'STALE', playlists: [] }], total: 1, groups: [] });
                await window.oldLoad;
            });
            assert.equal(await page.locator('[data-chp-channel="c1"]').count(), 1);
            assert.equal(await page.locator('[data-chp-channel="stale"]').count(), 0);
            await page.evaluate(async () => {
                window.actor.id = 'failed';
                window.failedLoad = ChannelPlaylists.syncAccountScope();
                await Promise.resolve(); await Promise.resolve();
                window.actor.id = 'owner';
                await ChannelPlaylists.syncAccountScope();
                window.failSlow(new Error('STALE ERROR')); await window.failedLoad;
            });
            assert.doesNotMatch(await page.locator('.chp-status').textContent(), /STALE ERROR/);
        } finally { await page.close(); }
    });

    await t.test('group-only bootstrap never renders aggregate rows and missing groups select the first replacement', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                const original = window.handleRequest;
                window.handleRequest = requestPath => {
                    if (requestPath.startsWith('/youtube/channels?') && new URL(requestPath, 'https://local').searchParams.has('group')) {
                        return new Promise(resolve => { window.finishScoped = () => resolve(structuredClone(window.data)); });
                    }
                    return original(requestPath);
                };
                window.showPending = ChannelPlaylists.show({ userId: 'owner' });
            });
            await page.waitForFunction(() => typeof window.finishScoped === 'function');
            assert.equal(await page.locator('.chp-channel').count(), 0);
            assert.equal(await page.locator('[data-chp-group=""]').count(), 0);
            assert.equal(await page.locator('.chp-groups option[value=""]').count(), 0);
            await page.evaluate(async () => { window.finishScoped(); await window.showPending; });
            assert.equal(await page.locator('.chp-channel').count(), 1);
            await page.evaluate(async () => {
                window.data.groups = [{ name: 'Nhóm thay thế', count: 0 }];
                window.data.items = []; window.data.total = 0;
                window.handleRequest = async () => structuredClone(window.data);
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.locator('[data-chp-group="Nhóm thay thế"]').getAttribute('aria-pressed'), 'true');
            const latest = await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/channels?')).at(-1).path);
            assert.equal(new URL(latest, 'https://local').searchParams.get('group'), 'Nhóm thay thế');
        } finally { await page.close(); }
    });

    await t.test('no groups renders New Group, disables the mobile placeholder and does not recurse', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                window.data.groups = [];
                await ChannelPlaylists.show({ userId: 'owner' });
            });
            assert.equal(await page.locator('.chp-channel').count(), 0);
            assert.equal(await page.locator('[data-chp-group]').count(), 0);
            assert.equal(await page.locator('.chp-groups').isDisabled(), true);
            assert.equal(await page.locator('.chp-groups option').isDisabled(), true);
            assert.equal(await page.locator('.chp-list [data-chp-action="new-group"]').count(), 0);
            assert.equal(await page.locator('#channel-group-rail [data-chp-action="new-group"]').isVisible(), true);
            assert.equal(await page.locator('[data-chp-action="add"]').isDisabled(), true);
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/channels?')).length), 1);
            await page.evaluate(() => ChannelPlaylists.reload());
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/channels?')).length), 2);
        } finally { await page.close(); }
    });

    await t.test('poll leaves open modal, draft, details and focused rows intact; hide cancels polling', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show({ userId: 'owner' }));
            assert.equal(await page.locator('.chp-children').isVisible(), true);
            await page.locator('.chp-channel').click({ button: 'right' });
            await page.locator('[data-menu="edit"]').click();
            await page.waitForSelector('.chp-pick');
            await page.locator('[name="urls"]').fill('https://open.spotify.com/playlist/draft');
            const count = await page.evaluate(() => window.calls.length);
            await page.evaluate(() => { for (const callback of window.polls.values()) callback(); });
            assert.equal(await page.evaluate(() => window.calls.length), count);
            assert.equal(await page.locator('[name="urls"]').inputValue(), 'https://open.spotify.com/playlist/draft');
            assert.equal(await page.locator('[name="urls"]').evaluate(node => node === document.activeElement), true);
            await page.getByRole('button', { name: 'Hủy', exact: true }).click();
            await page.evaluate(async () => {
                document.querySelector('.chp-channel').focus();
                window.focused = document.activeElement;
                window.data.items[0].view_count = 999;
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.evaluate(() => window.focused === document.activeElement && window.focused.isConnected), true);
            await page.evaluate(() => ChannelPlaylists.hide());
            assert.equal(await page.evaluate(() => window.polls.size), 0);
            assert.equal(await page.locator('#channel-group-rail').isVisible(), false);
        } finally { await page.close(); }
    });

    await t.test('expanded flat rows escape titles, keep unchanged DOM, show nonwrapping vi-VN metrics and deltas', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                await ChannelPlaylists.show({ userId: 'owner' });
                window.originalRow = document.querySelector('.chp-channel');
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.locator('.chp-channel img').count(), 0);
            assert.equal(await page.evaluate(() => window.originalRow === document.querySelector('.chp-channel')), true);
            assert.match(await page.locator('.chp-numeric').first().textContent(), /2\.328\.473.*\+200\/2/);
            assert.match(await page.locator('.chp-numeric').nth(1).textContent(), /-1\/2/);
            assert.equal(await page.locator('.chp-delta').first().getAttribute('title'), '+200 trong 2 ngày');
            assert.equal(await page.locator('.chp-numeric').first().evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
            await page.setViewportSize({ width: 1440, height: 900 });
            assert.ok(await page.locator('.chp-numeric').first().evaluate(node => {
                const next = node.nextElementSibling.getBoundingClientRect();
                const delta = node.querySelector('.chp-delta').getBoundingClientRect();
                return delta.right < next.left && node.getBoundingClientRect().width >= 150;
            }));
            await page.setViewportSize({ width: 997, height: 900 });
            assert.equal(await page.locator('.chp-list').evaluate(node => node.scrollWidth > node.clientWidth), true);
            await page.locator('[data-chp-group="Nhóm Việt"]').click();
            assert.equal(await page.locator('[data-chp-group="Nhóm Việt"]').getAttribute('aria-pressed'), 'true');
        } finally { await page.close(); }
    });

    await t.test('playlist picker filters groups/search, displays covers and preserves hidden selections', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => {
                const base = window.data.items[0].playlists[0];
                base.group = 'Jazz'; base.image = 'https://example.com/cover.jpg';
                const original = window.handleRequest;
                window.handleRequest = (path, options) => path.startsWith('/items?') ? { items: [base,
                    { ...base, id: 'p2', name: 'Lofi Study', spotify_id: 'LOFI-ID', group: 'Lofi' },
                    { ...base, id: 'p3', name: 'Coffee Jazz', spotify_id: 'JAZZ-ID', group: 'Jazz' }], total: 3 } : original(path, options);
            });
            await page.evaluate(() => ChannelPlaylists.show());
            await page.locator('.chp-channel').click({ button: 'right' });
            assert.equal(await page.locator('.chp-menu [data-menu]').first().getAttribute('data-menu'), 'edit');
            await page.locator('[data-menu="edit"]').click();
            await page.waitForSelector('.chp-pick');
            assert.equal(await page.locator('.chp-pick-cover').count(), 3);
            assert.deepEqual(await page.locator('[name="picker_group"] option').allTextContents(),
                ['Tất cả nhóm', 'Empty Album', 'Empty Playlist', 'Jazz', 'Lofi', 'Track Only']);
            await page.getByLabel('Nhóm playlist', { exact: true }).selectOption('group:Empty Playlist');
            assert.equal(await page.locator('[name="playlist"]').count(), 0);
            assert.match(await page.locator('.chp-picker-count').textContent(), /Đã chọn 1/);
            await page.getByLabel('Nhóm playlist', { exact: true }).selectOption('');
            const visual = await page.locator('.chp-playlist-editor').evaluate(editor => {
                const style = selector => getComputedStyle(editor.querySelector(selector));
                return { radius: style('[name="picker_group"]').borderRadius,
                    inputHeight: style('[name="picker_search"]').height,
                    titleWeight: style('.chp-pick > span:last-child').fontWeight,
                    checkboxAccent: style('[name="playlist"]').accentColor,
                    saveIcon: editor.querySelector('[type="submit"] .material-icons-round').textContent };
            });
            assert.deepEqual(visual, { radius: '14px', inputHeight: '44px', titleWeight: '700', checkboxAccent: 'rgb(15, 15, 15)', saveIcon: 'save' });
            await page.setViewportSize({ width: 390, height: 640 });
            const geometry = await page.locator('.chp-playlist-editor').evaluate(editor => {
                const rect = editor.getBoundingClientRect();
                const footer = editor.querySelector('footer').getBoundingClientRect();
                return { left: rect.left, right: rect.right, bottom: rect.bottom, footerBottom: footer.bottom,
                    overflow: editor.scrollWidth > editor.clientWidth };
            });
            assert.ok(geometry.left >= 0 && geometry.right <= 390 && geometry.bottom <= 640);
            assert.ok(geometry.footerBottom <= geometry.bottom);
            assert.equal(geometry.overflow, false);
            await page.getByLabel('Nhóm playlist', { exact: true }).selectOption('group:Lofi');
            assert.equal(await page.locator('[name="playlist"]').count(), 1);
            await page.locator('[name="playlist"]').check();
            await page.getByLabel('Nhóm playlist', { exact: true }).selectOption('group:Jazz');
            await page.getByLabel('Tìm playlist', { exact: true }).fill('JAZZ-ID');
            assert.equal(await page.locator('[name="playlist"]').count(), 1);
            await page.locator('[name="playlist"]').check();
            await page.getByLabel('Tìm playlist', { exact: true }).fill('nothing matches');
            assert.equal(await page.locator('[name="playlist"]').count(), 0);
            assert.match(await page.locator('.chp-picker-count').textContent(), /Đã chọn 3/);
            await page.getByRole('button', { name: 'Lưu liên kết', exact: true }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            const body = await page.evaluate(() => JSON.parse(window.calls.find(call => call.path.endsWith('/playlists') && call.method === 'PUT').body));
            assert.deepEqual(body.item_ids.sort(), ['p1', 'p2', 'p3']);
        } finally { await page.close(); }
    });

    await t.test('playlist menu icons distinguish unlink from confirmed permanent app deletion', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-playlist="c1:p1"]').click({ button: 'right' });
            const count = await page.locator('.chp-menu [data-command]').count();
            assert.equal(await page.locator('.chp-menu [data-command] .material-icons-round').count(), count);
            assert.equal(await page.locator('[data-command="unlink"] .material-icons-round').textContent(), 'link_off');
            assert.equal(await page.locator('[data-command="delete-link"] .material-icons-round').textContent(), 'delete_forever');
            await page.locator('[data-command="delete-link"]').click();
            assert.match(await page.locator('.chp-dialog-body').textContent(), /mọi kênh/);
            assert.equal(await page.evaluate(() => window.actions.some(call => call.action === 'delete-selected-links')), false);
            await page.getByRole('button', { name: 'Hủy', exact: true }).click();
            await page.locator('[data-chp-playlist="c1:p1"]').click({ button: 'right' });
            await page.locator('[data-command="delete-link"]').click();
            await page.getByRole('button', { name: 'Xoá link', exact: true }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            assert.ok(await page.evaluate(() => window.actions.some(call => call.action === 'delete-selected-links' && call.items.some(item => item.id === 'p1'))));
        } finally { await page.close(); }
    });

    await t.test('playlist replacement uses owner pagination and unlink never deletes Item; owner switch closes editor', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show({ userId: 'owner' }));
            await page.locator('.chp-channel').click({ button: 'right' });
            await page.locator('[data-menu="edit"]').click(); await page.waitForSelector('.chp-pick');
            await page.locator('[name="playlist"]').uncheck();
            await page.locator('[name="urls"]').fill('https://open.spotify.com/playlist/new');
            await page.getByRole('button', { name: 'Lưu liên kết' }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            const calls = await page.evaluate(() => window.calls);
            const pickerCall = calls.find(call => call.path.startsWith('/items?'));
            assert.equal(new URL(pickerCall.path, 'https://local').searchParams.get('user_id'), 'owner');
            assert.equal(new URL(pickerCall.path, 'https://local').searchParams.get('limit'), '500');
            assert.deepEqual(JSON.parse(calls.find(call => call.method === 'PUT').body), {
                item_ids: [], urls: ['https://open.spotify.com/playlist/new'],
            });
            assert.ok(!calls.some(call => call.method === 'DELETE' && call.path.startsWith('/items')));
            await page.locator('.chp-channel').click({ button: 'right' });
            await page.locator('[data-menu="edit"]').click();
            await page.evaluate(() => { window.actor.id = 'new-owner'; return ChannelPlaylists.syncAccountScope(); });
            assert.equal(await page.locator('.chp-dialog').count(), 0);
        } finally { await page.close(); }
    });

    await t.test('Refresh All includes linked playlists and never sends an empty channel_ids payload', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show({ userId: 'owner' }));
            await page.locator('[data-chp-action="refresh-all"]').click();
            await page.waitForFunction(() => document.querySelector('.chp-status').textContent.includes('Đã yêu cầu refresh'));
            const calls = await page.evaluate(() => window.calls);
            assert.deepEqual(JSON.parse(calls.find(call => call.path === '/youtube/channels/refresh').body), { channel_ids: ['c1'] });
            assert.ok(calls.some(call => call.path === '/youtube/channels/c1/playlists/refresh' && call.method === 'POST'));
            await page.evaluate(async () => {
                window.calls = []; window.data = { items: [], total: 0, groups: [], has_keys: true };
                await ChannelPlaylists.reload();
            });
            await page.locator('[data-chp-action="refresh-all"]').click();
            await page.waitForFunction(() => document.querySelector('.chp-status').textContent.includes('Không có kênh để refresh'));
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'POST').length), 0);
        } finally { await page.close(); }
    });

    await t.test('shared shell hosts, hero and row typography match Spotify, without table or row edit buttons', async () => {
        const page = await fixture();
        try {
            await page.setViewportSize({ width: 1920, height: 1080 });
            await page.evaluate(() => ChannelPlaylists.show({ userId: 'owner' }));
            assert.equal(await page.locator('#channels-panel > .playlist-hero').count(), 1);
            assert.equal(await page.locator('#channels-panel .chp-search, #channels-panel [data-chp-action="add"], table, .chp-toolbar, .chp-pagination, .chp-edit, .chp-more').count(), 0);
            assert.equal(await page.locator('#channel-header-tools .search-pill').count(), 1);
            assert.equal(await page.locator('#channel-header-tools .btn-ghost[data-chp-action="refresh-all"]').count(), 1);
            assert.equal(await page.locator('#channel-header-tools .btn-accent[data-chp-action="add"]').count(), 1);
            assert.equal(await page.locator('#channel-group-tools input').count(), 1);
            assert.equal(await page.locator('#channel-group-rail .group-item .material-icons-round').textContent(), 'folder');
            assert.equal(await page.locator('#channel-group-rail .group-item-selected .group-count').textContent(), '1');
            assert.equal(await page.locator('.chp-mobile-groups').isVisible(), false);
            assert.equal(await page.locator('.playlist-hero').evaluate(node => getComputedStyle(node).minHeight), '230px');
            assert.equal(await page.locator('.playlist-hero h2').evaluate(node => getComputedStyle(node).fontSize), '52px');
            assert.deepEqual(await page.locator('.chp-channel .list-asset-title').evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight]), ['15px', '700']);
            assert.equal(await page.locator('.chp-channel .list-cover-image').evaluate(node => getComputedStyle(node).width), '44px');
            assert.equal(await page.locator('.chp-children .list-cover-image').evaluate(node => getComputedStyle(node).width), '44px');
            assert.equal(await page.locator('.chp-channel .status-dot.active').count(), 1);
            assert.equal(await page.locator('.chp-children .list-columns-head').count(), 0);
            assert.equal(await page.locator('.chp-list > .list-head .head-cell-label').allTextContents().then(labels => labels.join('|')), 'STT|Channel|Owner|View|Delta / Days|Checked');
            for (const width of [1920, 1440, 997]) {
                await page.setViewportSize({ width, height: 1080 });
                const head = await page.locator('.chp-list > .list-head .head-cell').nth(2).boundingBox();
                const owner = await page.locator('.chp-playlist-grid .playlist-owner-cell').boundingBox();
                assert.ok(Math.abs(head.x - owner.x) < 2, `Owner must align at ${width}px`);
            }
            assert.equal(await page.locator('.chp-playlist-grid > div').count(), 6);
            assert.doesNotMatch(await page.locator('.chp-playlist-grid').textContent(), /User <script>/);
            assert.equal(await page.locator('.chp-channel-labels .chp-playlist-count').textContent(), '1 playlists');
            assert.equal(await page.locator('.chp-channel .list-asset-subtitle').count(), 0);
            const bounds = await page.locator('.chp-channel-labels').evaluate(node => [...node.children].map(child => child.getBoundingClientRect().toJSON()));
            assert.ok(Math.abs(bounds[0].top - bounds[1].top) < 3);
            assert.ok(bounds[1].left > bounds[0].right);
            assert.ok(await page.locator('.chp-channel').evaluate(node => node.getBoundingClientRect().height <= 80));
            assert.ok(await page.locator('.chp-playlist-grid').evaluate(node => node.getBoundingClientRect().height <= 80));
            assert.ok(await page.locator('.chp-list > .list-head .list-columns-head').evaluate(node => node.getBoundingClientRect().height <= 50));
        } finally { await page.close(); }
    });

    await t.test('all pages commit atomically, over 50 channels have no visible pagination', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                await ChannelPlaylists.show({ userId: 'owner' });
                window.data.items = Array.from({ length: 137 }, (_, index) => ({ ...window.data.items[0], id: `channel-${index}`, name: `Channel ${index}`, playlists: [] }));
                window.data.total = 137;
                window.data.groups[0].count = 137;
                const original = window.handleRequest;
                window.handleRequest = (path, options) => {
                    if (path.includes('offset=100')) return new Promise(resolve => { window.finishPage = () => original(path, options).then(resolve); });
                    return original(path, options);
                };
                window.pendingPages = ChannelPlaylists.reload();
            });
            await page.waitForFunction(() => !!window.finishPage);
            assert.equal(await page.locator('[data-chp-channel]').count(), 1);
            await page.evaluate(async () => { window.finishPage(); await window.pendingPages; });
            assert.equal(await page.locator('[data-chp-channel]').count(), 137);
            assert.equal(await page.locator('[data-chp-channel="channel-136"] .stt-cell').textContent(), '137');
            assert.equal(await page.locator('[data-chp-kpi="Channels"]').textContent(), '137');
            assert.equal(await page.locator('[data-chp-action="prev"], [data-chp-action="next"], .chp-pagination').count(), 0);
            await page.evaluate(() => {
                const original = window.handleRequest;
                window.handleRequest = (path, options) => path.includes('offset=100') ? { ...structuredClone(window.data), items: window.data.items.slice(100) } : original(path, options);
            });
            await page.locator('[data-chp-action="refresh-all"]').click();
            await page.waitForFunction(() => window.calls.some(call => call.path === '/youtube/channels/refresh'));
            assert.equal(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/channels/refresh').body).channel_ids.length), 137);
        } finally { await page.close(); }
    });

    await t.test('first filtered channel banner only, group KPIs stay complete and focused polls update hero', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                window.data.items[0].banner = 'https://example.com/first-banner.jpg';
                window.data.items[0].image = 'https://example.com/avatar.jpg';
                window.data.items.push({ ...window.data.items[0], id: 'c2', name: 'Second', banner: 'https://example.com/second-banner.jpg', playlists: [] });
                window.data.total = 2;
                const original = window.handleRequest;
                window.handleRequest = (path, options) => {
                    if (path.startsWith('/youtube/channels?') && new URL(path, 'https://local').searchParams.get('search')) return { ...structuredClone(window.data), items: [window.data.items[1]], total: 1 };
                    return original(path, options);
                };
                await ChannelPlaylists.show({ userId: 'owner' });
            });
            assert.match(await page.locator('.playlist-hero').evaluate(node => node.style.getPropertyValue('--hero-image')), /first-banner/);
            await page.locator('.chp-search').fill('Second');
            await page.waitForFunction(() => document.querySelectorAll('[data-chp-channel]').length === 1 && !!document.querySelector('[data-chp-channel="c2"]'));
            assert.match(await page.locator('.playlist-hero').evaluate(node => node.style.getPropertyValue('--hero-image')), /second-banner/);
            assert.equal(await page.locator('[data-chp-kpi="Channels"]').textContent(), '2');
            await page.evaluate(async () => {
                document.querySelector('.chp-channel').focus();
                window.originalFocus = document.activeElement;
                window.data.items[1].banner = null;
                await ChannelPlaylists.reload(true);
            });
            assert.equal(await page.locator('.playlist-hero').evaluate(node => node.style.getPropertyValue('--hero-image')), '');
            assert.equal(await page.evaluate(() => document.activeElement === window.originalFocus && window.originalFocus.isConnected), true);
            assert.equal(await page.locator('.playlist-hero').evaluate(node => getComputedStyle(node, '::before').backgroundImage), 'none');
        } finally { await page.close(); }
    });

    await t.test('selection, keyboard-only edit menu, checked filters and collapse remain local UI semantics', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show({ userId: 'owner' }));
            await page.locator('.chp-channel .stt-cell').click();
            assert.equal(await page.locator('.chp-channel').getAttribute('aria-selected'), 'true');
            assert.equal(await page.locator('[data-chp-kpi="Selected"]').textContent(), '1');
            assert.equal(await page.locator('[data-menu="edit"]').count(), 0);
            await page.locator('.chp-channel').focus();
            await page.keyboard.press('Shift+F10');
            assert.equal(await page.locator('.row-context-menu .row-context-item[data-menu="edit"]').isVisible(), true);
            await page.locator('[data-menu="collapse"]').click();
            assert.equal(await page.locator('.chp-children').isVisible(), false);
            await page.locator('.chp-channel').click({ button: 'right' });
            await page.locator('[data-menu="expand"]').click();
            assert.equal(await page.locator('.chp-children').isVisible(), true);
            await page.locator('[data-chp-action="filter"]').click();
            await page.locator('[data-filter="changed"]').click();
            await page.waitForFunction(() => window.calls.some(call => call.path.includes('filter=changed')));
            assert.equal(await page.locator('[data-chp-kpi="Selected"]').textContent(), '0');
            await page.locator('.chp-channel').click({ button: 'right' });
            assert.equal(await page.locator('[data-filter="changed"]').getAttribute('aria-checked'), 'true');
            await page.locator('[data-filter="errors"]').click();
            await page.waitForFunction(() => window.calls.some(call => call.path.includes('filter=errors')));
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.method !== 'GET').length), 0);
        } finally { await page.close(); }
    });

    await t.test('YouTube bare banner crop matches YTM and existing crops are never appended twice', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                window.data.items[0].banner = 'https://yt3.googleusercontent.com/banner-id';
                await ChannelPlaylists.show({ userId: 'owner' });
            });
            const cropped = await page.locator('.playlist-hero').evaluate(node => node.style.getPropertyValue('--hero-image'));
            assert.equal(cropped, 'url("https://yt3.googleusercontent.com/banner-id=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj")');
            await page.evaluate(async () => {
                window.data.items[0].banner += '=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj';
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.locator('.playlist-hero').evaluate(node => node.style.getPropertyValue('--hero-image')), cropped);
            await page.evaluate(async () => {
                window.data.items[0].banner = 'https://yt3.googleusercontent.com/banner-id=w1280';
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.locator('.playlist-hero').evaluate(node => node.style.getPropertyValue('--hero-image')), 'url("https://yt3.googleusercontent.com/banner-id=w1280")');
        } finally { await page.close(); }
    });

    await t.test('optional shell time helpers format Checked and Updated without changing timestamps or contracts', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                window.data.items[0].last_checked = '2026-10-02T10:30:00';
                window.data.items[0].playlists[0].last_checked = '2026-10-02T10:30:00';
                ChannelPlaylists.init({ getUser: () => ({ id: 'owner' }), request: window.handleRequest,
                    formatChecked: value => value ? 'Just now' : '-', formatUpdatedAt: value => value ? '02/10/2026' : '-' });
                await ChannelPlaylists.show({ userId: 'owner' });
            });
            assert.equal(await page.locator('.chp-channel .list-checked-text').textContent(), 'Just now');
            assert.match(await page.locator('.chp-channel .list-checked-text').getAttribute('title'), /17:30/);
            assert.equal(await page.locator('.chp-channel .checked-status').textContent(), 'Active');
            assert.equal(await page.locator('.chp-playlist-grid .list-asset-subtitle').count(), 0);
        } finally { await page.close(); }
    });

    await t.test('390px channel topbar grows with controls, never clips or overlaps hero; Spotify is untouched', async () => {
        const page = await fixture();
        try {
            await page.setViewportSize({ width: 390, height: 844 });
            // Reproduce shell utility sizing instead of the forgiving isolated fixture header.
            await page.addStyleTag({ content: '.topbar{display:flex;height:80px;align-items:center;justify-content:space-between;padding:0 32px;flex-wrap:nowrap}.px-6{padding-left:24px;padding-right:24px}.py-2{padding-top:8px;padding-bottom:8px}body{margin:0}' });
            await page.evaluate(async () => {
                document.body.classList.add('channels-view');
                document.querySelector('#page-title').textContent = 'Channel & Playlist';
                await ChannelPlaylists.show({ userId: 'owner' });
            });
            const geometry = await page.evaluate(() => {
                const header = document.querySelector('.topbar').getBoundingClientRect();
                const hero = document.querySelector('.playlist-hero').getBoundingClientRect();
                const controls = [...document.querySelectorAll('.chp-search, #channel-header-tools > button, .chp-mobile-groups')].filter(node => getComputedStyle(node).display !== 'none').map(node => {
                    const rect = node.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                });
                return { header: { height: header.height, bottom: header.bottom }, heroTop: hero.top, controls,
                    direction: getComputedStyle(document.querySelector('.topbar')).flexDirection,
                    warningFont: getComputedStyle(document.querySelector('.chp-key-warning')).fontSize };
            });
            assert.equal(geometry.direction, 'column');
            assert.ok(geometry.header.height > 80);
            assert.equal(geometry.warningFont, '14px');
            assert.ok(geometry.heroTop >= geometry.header.bottom);
            assert.ok(geometry.controls.every(rect => rect.left >= 0 && rect.right <= 390 && rect.top >= 0 && rect.bottom <= geometry.header.bottom));
            await page.evaluate(() => document.body.classList.remove('channels-view'));
            assert.deepEqual(await page.locator('.topbar').evaluate(node => [getComputedStyle(node).height, getComputedStyle(node).flexDirection]), ['80px', 'row']);
            await page.evaluate(() => document.body.classList.add('channels-view'));
            await page.setViewportSize({ width: 1440, height: 900 });
            assert.deepEqual(await page.locator('.topbar').evaluate(node => [getComputedStyle(node).height, getComputedStyle(node).flexDirection]), ['80px', 'row']);
            assert.equal(await page.locator('.chp-mobile-groups').isVisible(), false);
        } finally { await page.close(); }
    });

    await t.test('stale second page owner poll and hidden callbacks cannot overwrite the active group', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                await ChannelPlaylists.show({ userId: 'owner' });
                const original = window.handleRequest;
                window.handleRequest = (path, options) => {
                    if (path.includes('user_id=owner') && path.includes('offset=100')) return new Promise(resolve => { window.finishOldPage = resolve; });
                    if (path.includes('user_id=owner')) return { ...structuredClone(window.data), items: Array.from({ length: 100 }, (_, index) => ({ ...window.data.items[0], id: `old-${index}` })), total: 101 };
                    return original(path, options);
                };
                window.oldPoll = ChannelPlaylists.reload(true);
            });
            await page.waitForFunction(() => !!window.finishOldPage);
            await page.evaluate(async () => {
                window.actor.id = 'new-owner';
                window.data.items[0].user_id = 'new-owner';
                window.data.items[0].playlists[0].user_id = 'new-owner';
                await ChannelPlaylists.syncAccountScope();
                window.finishOldPage({ items: [{ id: 'old-last', name: 'STALE', playlists: [] }], total: 101 });
                await window.oldPoll;
            });
            assert.equal(await page.locator('[data-chp-channel]').count(), 1);
            assert.equal(await page.locator('[data-chp-channel="c1"]').count(), 1);
            await page.evaluate(async () => {
                ChannelPlaylists.hide();
                window.hiddenCallbackCount = window.groupChanges.length;
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.evaluate(() => window.groupChanges.length === window.hiddenCallbackCount), true);
            assert.equal(await page.locator('#channel-header-tools').isVisible(), false);
            assert.equal(await page.locator('#channel-group-tools').isVisible(), false);
        } finally { await page.close(); }
    });
});
