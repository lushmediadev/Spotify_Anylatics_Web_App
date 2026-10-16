import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../channels.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../channels.css', import.meta.url), 'utf8');
const sharedCss = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const railSource = await readFile(new URL('../group-rail.js', import.meta.url), 'utf8');
const railCss = await readFile(new URL('../group-rail.css', import.meta.url), 'utf8');

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
        const html = '<html data-theme="light"><head><meta charset="UTF-8"></head><body><header class="topbar"><div><h1 id="page-title"></h1><span id="breadcrumb-group"></span></div><div id="channel-header-tools"></div></header><aside id="group-panel" class="group-panel"><div id="channel-group-rail" class="group-rail"></div></aside><div id="channels-panel"></div>' +
            '<div id="youtube-key-settings"></div><button id="nav-settings">Settings</button>';
        await page.route('http://channel.test/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
        await page.goto('http://channel.test/');
        await page.addStyleTag({ content: sharedCss + railCss + css + '\n.flex{display:flex}.items-center{align-items:center}.gap-4{gap:16px}.px-4{padding-left:16px;padding-right:16px}.py-3{padding-top:12px;padding-bottom:12px}.px-5{padding-left:20px;padding-right:20px}.py-8{padding-top:32px;padding-bottom:32px}.text-right{text-align:right}.relative{position:relative}.absolute{position:absolute}.topbar{height:auto;flex-wrap:wrap}body{display:block;overflow:auto}@media(max-width:767px){#group-panel{display:none}}' });
        await page.evaluate(() => {
            window.polls = new Map();
            let timerId = 0;
            window.setInterval = callback => { window.polls.set(++timerId, callback); return timerId; };
            window.clearInterval = id => window.polls.delete(id);
        });
        await page.addScriptTag({ content: railSource });
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
                if (requestPath === '/youtube/keys') return { keys: [], count: 0 };
                if (requestPath === '/youtube/keys/check') return { results: window.keyResults };
                return { accepted: 1, skipped: 0 };
            };
            window.actor = { id: 'owner' };
            ChannelPlaylists.init({
                getUser: () => window.actor,
                onGroupChanged: name => { (window.groupChanges ||= []).push(name); },
                onItemChanged: () => { window.itemChangeCount = (window.itemChangeCount || 0) + 1; },
                request: (requestPath, options) => {
                    // Workspace writes carry ?user_id=<owner>; keep paths comparable and record the owner.
                    const path = requestPath.startsWith('/youtube/channels?') ? requestPath : requestPath.replace(/[?&]user_id=[^&]*$/, '');
                    window.calls.push({ path, owner: new URL(requestPath, 'https://local').searchParams.get('user_id'), ...options });
                    return window.handleRequest(path, options);
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
                const edit = requestPath.match(/^\/youtube\/channels\/([^/]+)(?:\/playlists\/([^/]+))?$/);
                if (edit && options.method === 'PATCH') {
                    const channel = window.data.items.find(row => row.id === edit[1]);
                    const row = edit[2] ? channel.playlists.find(item => item.id === edit[2]) : channel;
                    if ('note' in body) Object.assign(row, { note: body.note || null, note_updated_at: '2026-10-13T03:00:00', note_updated_by_name: 'Owner' });
                    if (body.url) row.spotify_id = body.url.split('/').pop();
                    return structuredClone(channel);
                }
                return { accepted: 1 };
            };
            window.options = {
                getUser: () => window.actor,
                request: (requestPath, options) => {
                    const path = requestPath.startsWith('/youtube/channels?') ? requestPath : requestPath.replace(/[?&]user_id=[^&]*$/, '');
                    window.calls.push({ path, owner: new URL(requestPath, 'https://local').searchParams.get('user_id'), ...options });
                    return window.handleRequest(path, options);
                },
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
            assert.match(await page.locator('.chp-dialog-body').textContent(), /3 YouTube channels.*Spotify items/);
            await page.getByRole('button', { name: 'Delete channels', exact: true }).click();
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
            await page.locator('[data-rail-input]').fill('Renamed'); await page.keyboard.press('Enter');
            await page.waitForSelector('[data-chp-group="Renamed"]');
            assert.deepEqual(await page.evaluate(() => JSON.parse(window.calls.find(call => call.path === '/youtube/groups' && call.method === 'PATCH').body)), { old_name: 'G', new_name: 'Renamed' });
            await page.locator('[data-chp-group="Renamed"]').click();
            await page.locator('[data-chp-group="Target"]').click({ modifiers: ['Shift'] });
            assert.equal(await page.locator('#channel-group-rail .group-item-multi, #channel-group-rail .group-item-selected').count(), 3);
            await page.keyboard.press('Delete');
            await page.getByRole('button', { name: 'Delete Group', exact: true }).click();
            await page.waitForSelector('[data-chp-group="Ungrouped"]');
            assert.equal(await page.evaluate(() => window.data.items.length), 4);
            assert.equal(await page.evaluate(() => window.calls.some(call => /\/items\//.test(call.path) && call.method === 'DELETE')), false);
            await page.locator('[data-chp-channel="c1"]').click({ button: 'right' });
            await page.locator('[data-menu="clear"]').click();
            await page.getByRole('button', { name: 'Delete channels', exact: true }).click();
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
            await page.evaluate(() => ChannelPlaylists.setGroupSearch('G'));
            await drag(page, '[data-chp-group="Hidden Group"]', '[data-chp-group="G"]', false);
            await page.waitForFunction(() => window.prefs.group_order.length === 3);
            assert.deepEqual(await page.evaluate(() => window.prefs.group_order), ['Hidden Group', 'G', 'Target']);
            await page.evaluate(() => ChannelPlaylists.setGroupSearch(''));
            await page.evaluate(() => document.getElementById('channel-group-rail').__groupRail.startCreate());
            await page.locator('[data-rail-input]').fill('New'); await page.keyboard.press('Enter');
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

    await t.test('playlist focus delegates exact independent actions and Delete asks for confirmation', async () => {
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
            await page.getByRole('button', { name: 'Delete links', exact: true }).click();
            await page.waitForFunction(() => window.actions.some(call => call.action === 'delete-selected-links'));
            assert.deepEqual(await page.evaluate(() => window.actions.find(call => call.action === 'delete-selected-links').items.map(item => item.id)), ['p1']);
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
            assert.equal(await page.locator('#channels-panel').evaluate(node => node.style.getPropertyValue('--chp-columns')), '48px 280px 160px 800px 160px 140px 200px');
            const next = await page.locator('[data-chp-resize="0"]').boundingBox();
            await page.mouse.move(next.x + 5, next.y + 5); await page.mouse.down();
            await page.evaluate(() => ChannelPlaylists.hide()); await page.mouse.move(next.x + 100, next.y + 5); await page.mouse.up();
            assert.equal(await page.locator('body').evaluate(node => node.classList.contains('chp-resizing')), false);
        } finally { await page.close(); }
    });

    await t.test('system key settings are admin-only, show full keys, and never echo provider messages or owner filters', async () => {
        const page = await fixture();
        try {
            await page.evaluate(async () => {
                await ChannelPlaylists.show({ userId: 'other-owner' });
                await ChannelPlaylists.showKeySettings();
            });
            // Managers and users never load or see the key pool.
            assert.equal(await page.locator('#youtube-key-settings').evaluate(node => node.hidden && node.textContent === ''), true);
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/keys')).length), 0);
            assert.match(await page.locator('.chp-key-warning').textContent(), /No system API key configured — contact an admin\./);
            assert.equal(await page.locator('.chp-key-warning [data-chp-action="settings"]').count(), 0);

            await page.evaluate(async () => {
                window.actor.role = 'admin';
                window.pool = [{ id: 'k1', key: 'AIzaFULLKEYabcd', masked: 'AIza…abcd', owner: 'Root', position: 0 }];
                window.keyResults = [
                    { index: 0, key: 'RAWKEY01', status: 'valid' }, { index: 1, key: '<b>RAWKEY02</b>', status: 'quota_exceeded' },
                    { index: 2, valid: false, error_code: 'network_error', error_message: 'SECRET' },
                ];
                const original = window.handleRequest;
                window.handleRequest = async (requestPath, options = {}) => {
                    if (requestPath === '/youtube/keys' && options.method === 'PUT') {
                        const lines = JSON.parse(options.body).api_keys.split('\n').map(line => line.trim()).filter(Boolean);
                        window.pool = lines.map((key, position) => ({ id: `n${position}`, key, masked: key, owner: 'Root', position }));
                        return { saved: lines.length, keys: window.pool, count: window.pool.length, api_keys: lines.join('\n') };
                    }
                    if (requestPath === '/youtube/keys') return { keys: window.pool, count: window.pool.length, api_keys: window.pool.map(key => key.key).join('\n') };
                    if (requestPath === '/youtube/keys/check') return { results: window.keyResults };
                    return original(requestPath, options);
                };
                await ChannelPlaylists.reload();
                await ChannelPlaylists.showKeySettings();
            });
            assert.equal(await page.locator('.chp-key-warning [data-chp-action="settings"]').count(), 1);
            const host = page.locator('#youtube-key-settings');
            assert.equal(await host.evaluate(node => node.hidden), false);
            // Internal tool: the stored keys are shown in full, one per line.
            assert.equal(await host.locator('textarea').inputValue(), 'AIzaFULLKEYabcd');
            assert.equal(await host.locator('.chp-key-list li').count(), 0);

            await host.locator('textarea').fill('RAWKEY01\nRAWKEY02\nRAWKEY03');
            await page.locator('[data-check]').click();
            await page.waitForFunction(() => document.querySelectorAll('.chp-key-list li').length === 3);
            assert.equal(await page.locator('.chp-key-status').textContent(), 'Checked 3 key(s): 1 valid.');
            assert.deepEqual(await host.locator('.chp-key-list code').allTextContents(), ['RAWKEY01', '<b>RAWKEY02</b>', 'Key 3']);
            assert.deepEqual(await host.locator('.chp-key-result').allTextContents(), ['Valid', 'Quota exceeded', 'Connection error']);
            assert.equal(await host.locator('.chp-key-list b').count(), 0);
            assert.doesNotMatch(await host.textContent(), /SECRET/);

            await host.locator('textarea').fill(' RAWKEY01\n\nRAWKEY03 ');
            await host.locator('button[type="submit"]').click();
            await page.waitForFunction(() => document.querySelector('.chp-key-status').textContent.startsWith('Saved'));
            assert.equal(await page.locator('.chp-key-status').textContent(), 'Saved 2 key(s).');
            assert.equal(await host.locator('textarea').inputValue(), 'RAWKEY01\nRAWKEY03');

            const keyCalls = await page.evaluate(() => window.calls.filter(call => call.path.startsWith('/youtube/keys')));
            assert.ok(keyCalls.every(call => !call.path.includes('?')));
            const checks = keyCalls.filter(call => call.path.endsWith('/check')).map(call => JSON.parse(call.body));
            assert.deepEqual(checks, [{ api_keys: 'RAWKEY01\nRAWKEY02\nRAWKEY03' }]);
            assert.ok(keyCalls.some(call => call.method === 'PUT' && call.path === '/youtube/keys'));
            assert.ok(keyCalls.every(call => call.method !== 'POST' || call.path.endsWith('/check')));
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
            await page.evaluate(() => document.getElementById('channel-group-rail').__groupRail.startCreate());
            await page.locator('[data-rail-input]').fill('   ');
            await page.locator('[data-rail-save]').click();
            assert.equal(await page.evaluate(() => window.calls.filter(call => call.path === '/youtube/groups').length), 0);
            await page.evaluate(() => document.getElementById('channel-group-rail').__groupRail.startCreate());
            await page.locator('[data-rail-input]').fill('  Nhóm mới  ');
            await page.keyboard.press('Enter');
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
            assert.equal(await page.locator('.group-rail-prompt-input').isVisible(), true);
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
            assert.equal(await page.locator('#channel-group-rail .group-rail-empty').isVisible(), true);
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
            await page.waitForSelector('[name="urls"]');
            await page.locator('[name="urls"]').fill('https://open.spotify.com/playlist/draft');
            const count = await page.evaluate(() => window.calls.length);
            await page.evaluate(() => { for (const callback of window.polls.values()) callback(); });
            assert.equal(await page.evaluate(() => window.calls.length), count);
            assert.equal(await page.locator('[name="urls"]').inputValue(), 'https://open.spotify.com/playlist/draft');
            assert.equal(await page.locator('[name="urls"]').evaluate(node => node === document.activeElement), true);
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.evaluate(async () => {
                document.querySelector('.chp-channel').focus();
                window.focused = document.activeElement;
                window.data.items[0].view_count = 999;
                await ChannelPlaylists.reload();
            });
            assert.equal(await page.evaluate(() => window.focused === document.activeElement && window.focused.isConnected), true);
            await page.evaluate(() => ChannelPlaylists.hide());
            assert.equal(await page.evaluate(() => window.polls.size), 0);
            assert.equal(await page.locator('#channels-panel').isVisible(), false);
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
            assert.equal(await page.locator('.chp-delta').first().getAttribute('title'), '+200 in 2 days');
            assert.equal(await page.locator('.chp-numeric').first().evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
            await page.setViewportSize({ width: 1440, height: 900 });
            assert.ok(await page.locator('.chp-numeric').first().evaluate(node => {
                const next = node.nextElementSibling.getBoundingClientRect();
                const delta = node.querySelector('.chp-delta').getBoundingClientRect();
                return delta.right < next.left && node.getBoundingClientRect().width >= 96;
            }));
            await page.setViewportSize({ width: 997, height: 900 });
            // Below 1100px Delta / Days and Checked are hidden, so the list fits without horizontal scroll.
            assert.equal(await page.locator('.chp-list').evaluate(node => node.scrollWidth > node.clientWidth), false);
            assert.equal(await page.locator('.chp-list > .list-head .head-cell').nth(4).isVisible(), false);
            assert.equal(await page.locator('.chp-list > .list-head .head-cell').nth(6).isVisible(), false);
            await page.locator('[data-chp-group="Nhóm Việt"]').click();
            assert.equal(await page.locator('[data-chp-group="Nhóm Việt"]').getAttribute('aria-pressed'), 'true');
        } finally { await page.close(); }
    });

    await t.test('paste-only edit is prefilled and never reads Spotify Checker groups or items', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show());
            await page.locator('.chp-channel').click({ button: 'right' });
            await page.locator('[data-menu="edit"]').click();
            assert.equal(await page.locator('.chp-pick, .chp-picker-filters').count(), 0);
            assert.match(await page.locator('[name="urls"]').inputValue(), /open.spotify.com\/playlist\/abc/);
            await page.locator('[name="urls"]').fill('https://open.spotify.com/playlist/new');
            await page.getByRole('button', { name: 'Save links', exact: true }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            const calls = await page.evaluate(() => window.calls);
            assert.equal(calls.some(call => call.path.startsWith('/items?') || call.path === '/auth/me/groups'), false);
            assert.deepEqual(JSON.parse(calls.find(call => call.path.endsWith('/playlists') && call.method === 'PUT').body), { urls: ['https://open.spotify.com/playlist/new'] });
        } finally { await page.close(); }
    });

    await t.test('Note column clamps, shows edit details, edits inline and through the playlist Edit dialog', async () => {
        const page = await workspaceFixture();
        try {
            const patches = () => page.evaluate(() => window.calls.filter(call => call.method === 'PATCH').map(call => [call.path, JSON.parse(call.body)]));
            const long = 'Line "one" & <b>\nLine two\nLine three';
            await page.evaluate(async note => {
                Object.assign(window.data.items[0].playlists[0], { note, note_updated_at: '2026-10-13T03:00:00', note_updated_by_name: 'Owner' });
                await ChannelPlaylists.reload();
                window.noteRow = document.querySelector('[data-chp-playlist="c1:p1"]');
                await ChannelPlaylists.reload();
            }, long);
            const cell = page.locator('[data-chp-playlist="c1:p1"] [data-chp-note]');
            assert.equal(await page.evaluate(() => window.noteRow === document.querySelector('[data-chp-playlist="c1:p1"]')), true);
            assert.equal(await cell.locator('.chp-note-text').textContent(), long);
            assert.equal(await cell.locator('.chp-note-text').evaluate(node => getComputedStyle(node).webkitLineClamp), '2');
            assert.match(await cell.getAttribute('title'), /Line three\n\nLast edited .+ · Owner$/);
            assert.equal(await page.locator('.chp-playlist-grid [data-chp-note] b').count(), 0);
            // Same playlist under another channel and the channel row itself start empty.
            assert.equal(await page.locator('[data-chp-playlist="c3:p1"] .chp-note-text').textContent(), '');
            assert.equal(await page.locator('[data-chp-channel="c1"] .chp-note-text').textContent(), '');
            const head = await page.locator('.chp-list > .list-head .head-cell').nth(5).boundingBox();
            const box = await cell.boundingBox();
            assert.ok(Math.abs(head.x - box.x) < 2, 'Note cells align with the Note header');

            // Double-clicking a note does nothing; the pencil button opens the editor.
            await cell.dblclick();
            assert.equal(await page.locator('.chp-note-input').count(), 0);
            await cell.locator('[data-chp-note-edit]').click();
            const input = page.locator('[data-chp-playlist="c1:p1"] .chp-note-input');
            assert.equal(await input.inputValue(), long);
            assert.equal(await input.getAttribute('maxlength'), '1000');
            await page.evaluate(() => ChannelPlaylists.reload(true));
            assert.equal(await input.count(), 1, 'polling must not replace an open editor');
            await input.fill('  Updated note  '); await input.press('Enter');
            await page.waitForFunction(() => document.querySelector('[data-chp-playlist="c1:p1"] .chp-note-text')?.textContent === 'Updated note');
            assert.deepEqual(await patches(), [['/youtube/channels/c1/playlists/p1', { note: 'Updated note' }]]);
            assert.equal(await page.locator('[data-chp-playlist="c3:p1"] .chp-note-text').textContent(), '');
            assert.equal(await page.locator('[data-chp-playlist="c1:p1"]').getAttribute('draggable'), 'true');

            await page.locator('[data-chp-playlist="c1:p2"] [data-chp-note-edit]').click();
            await page.locator('[data-chp-playlist="c1:p2"] .chp-note-input').fill('discarded draft');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('.chp-note-input').count(), 0);
            assert.equal(await page.locator('[data-chp-playlist="c1:p2"] .chp-note-text').textContent(), '');
            assert.equal((await patches()).length, 1);

            // Channel rows take a note too; the pencil edits it without collapsing the row.
            await page.locator('[data-chp-channel="c1"] [data-chp-note-edit]').click();
            await page.locator('[data-chp-channel="c1"] .chp-note-input').fill('Channel note');
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.querySelector('[data-chp-channel="c1"] .chp-note-text')?.textContent === 'Channel note');
            assert.equal(await page.locator('[data-chp-playlist="c1:p1"]').isVisible(), true);
            assert.deepEqual((await patches())[1], ['/youtube/channels/c1', { note: 'Channel note' }]);

            await page.locator('[data-chp-playlist="c1:p2"]').click({ button: 'right' });
            assert.equal(await page.locator('.chp-menu [data-command]').first().getAttribute('data-command'), 'edit');
            await page.locator('[data-command="edit"]').click();
            assert.equal(await page.locator('.chp-dialog [name="url"]').inputValue(), 'https://open.spotify.com/playlist/def');
            assert.equal(await page.locator('.chp-dialog [name="note"]').getAttribute('maxlength'), '1000');
            await page.locator('.chp-dialog [name="url"]').fill('https://open.spotify.com/playlist/xyz');
            await page.locator('.chp-dialog [name="note"]').fill('From dialog\nsecond line');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            assert.deepEqual((await patches())[2], ['/youtube/channels/c1/playlists/p2', { url: 'https://open.spotify.com/playlist/xyz', note: 'From dialog\nsecond line' }]);
            await page.waitForFunction(() => document.querySelector('[data-chp-playlist="c1:p2"] .chp-note-text')?.textContent === 'From dialog\nsecond line');
            assert.match(await page.locator('[data-chp-playlist="c1:p2"] .list-asset-uri').textContent(), /xyz/);

            // Unchanged dialog sends nothing; multi-selection has no single Edit entry.
            await page.locator('[data-chp-playlist="c1:p2"]').click({ button: 'right' });
            await page.locator('[data-command="edit"]').click();
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            assert.equal((await patches()).length, 3);
            await page.locator('[data-chp-playlist="c1:p1"]').click();
            await page.locator('[data-chp-playlist="c1:p2"]').click({ modifiers: ['Control'] });
            await page.locator('[data-chp-playlist="c1:p2"]').click({ button: 'right' });
            assert.equal(await page.locator('[data-command="edit"]').count(), 0);
            await page.keyboard.press('Escape');
            await page.locator('[data-chp-channel="c1"]').click({ button: 'right' });
            assert.equal(await page.locator('[data-menu="note"]').count(), 1);
        } finally { await page.close(); }
    });

    await t.test('playlist menu removes unlink and confirms independent playlist deletion', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-playlist="c1:p1"]').click({ button: 'right' });
            const count = await page.locator('.chp-menu [data-command]').count();
            assert.equal(await page.locator('.chp-menu [data-command] .material-icons-round').count(), count);
            assert.equal(await page.locator('[data-command="unlink"]').count(), 0);
            assert.equal(await page.locator('[data-command="delete-link"] .material-icons-round').textContent(), 'delete_forever');
            await page.locator('[data-command="delete-link"]').click();
            assert.match(await page.locator('.chp-dialog-body').textContent(), /Spotify Checker.*not affected/);
            assert.equal(await page.evaluate(() => window.actions.some(call => call.action === 'delete-selected-links')), false);
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.locator('[data-chp-playlist="c1:p1"]').click({ button: 'right' });
            await page.locator('[data-command="delete-link"]').click();
            await page.getByRole('button', { name: 'Delete links', exact: true }).click();
            await page.waitForSelector('.chp-dialog', { state: 'detached' });
            assert.ok(await page.evaluate(() => window.actions.some(call => call.action === 'delete-selected-links' && call.items.some(item => item.id === 'p1'))));
        } finally { await page.close(); }
    });

    await t.test('paste-only editor closes on account switch without saving another owner draft', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show());
            await page.locator('.chp-channel').click({ button: 'right' });
            await page.locator('[data-menu="edit"]').click();
            await page.locator('[name="urls"]').fill('https://open.spotify.com/playlist/draft');
            await page.evaluate(() => { window.actor.id = 'new-owner'; return ChannelPlaylists.syncAccountScope(); });
            assert.equal(await page.locator('.chp-dialog').count(), 0);
            assert.equal(await page.evaluate(() => window.calls.some(call => call.path.endsWith('/playlists') && call.method === 'PUT')), false);
        } finally { await page.close(); }
    });

    await t.test('collapsed rows show Playlist counts and mixed expansion keeps owner metrics', async () => {
        const page = await workspaceFixture();
        try {
            await page.locator('[data-chp-channel="c1"] .stt-cell').dblclick();
            assert.equal(await page.locator('[data-chp-channel="c1"] .chp-owner-empty').textContent(), '2');
            assert.equal(await page.locator('.list-columns-head .head-cell:nth-child(3) .head-cell-label').textContent(), 'Owner / Playlist');
            await page.locator('[data-chp-channel="c2"] .stt-cell').dblclick();
            await page.locator('[data-chp-channel="c3"] .stt-cell').dblclick();
            assert.equal(await page.locator('.list-columns-head .head-cell:nth-child(3) .head-cell-label').textContent(), 'Playlist');
            await page.locator('[data-chp-channel="c1"] .stt-cell').dblclick();
            assert.equal(await page.locator('[data-chp-channel="c1"] .chp-owner-empty').textContent(), '');
            assert.equal(await page.locator('[data-chp-playlist="c1:p1"]').isVisible(), true);
        } finally { await page.close(); }
    });

    await t.test('Refresh All includes linked playlists and never sends an empty channel_ids payload', async () => {
        const page = await fixture();
        try {
            await page.evaluate(() => ChannelPlaylists.show({ userId: 'owner' }));
            await page.locator('[data-chp-action="refresh-all"]').click();
            await page.waitForFunction(() => document.querySelector('.chp-status').textContent.includes('Refresh requested'));
            const calls = await page.evaluate(() => window.calls);
            assert.deepEqual(JSON.parse(calls.find(call => call.path === '/youtube/channels/refresh').body), { channel_ids: ['c1'] });
            assert.ok(calls.some(call => call.path === '/youtube/channels/c1/playlists/refresh' && call.method === 'POST'));
            await page.evaluate(async () => {
                window.calls = []; window.data = { items: [], total: 0, groups: [], has_keys: true };
                await ChannelPlaylists.reload();
            });
            await page.locator('[data-chp-action="refresh-all"]').click();
            await page.waitForFunction(() => document.querySelector('.chp-status').textContent.includes('No channels to refresh'));
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
            assert.equal(await page.locator('#channel-group-rail .group-item .group-rail-icon').textContent(), 'folder');
            assert.equal(await page.locator('#channel-group-rail .group-item-selected .group-count').textContent(), '1');
            assert.equal(await page.locator('.chp-mobile-groups').isVisible(), false);
            assert.equal(await page.locator('.playlist-hero').evaluate(node => getComputedStyle(node).minHeight), '230px');
            assert.equal(await page.locator('.playlist-hero h2').evaluate(node => getComputedStyle(node).fontSize), '52px');
            assert.deepEqual(await page.locator('.chp-channel .list-asset-title').evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight]), ['15px', '700']);
            // Same row geometry as Spotify Checker / YouTube Checker.
            assert.equal(await page.locator('.chp-channel .list-cover-image').evaluate(node => getComputedStyle(node).width), '44px');
            assert.equal(await page.locator('.chp-children .list-cover-image').evaluate(node => getComputedStyle(node).width), '44px');
            assert.equal(await page.locator('.chp-channel .status-dot.active').count(), 1);
            assert.equal(await page.locator('.chp-children .list-columns-head').count(), 0);
            assert.equal(await page.locator('.chp-list > .list-head .head-cell-label').allTextContents().then(labels => labels.join('|')), 'STT|Channel|Owner|View|Delta / Days|Note|Checked');
            for (const width of [1920, 1440, 997]) {
                await page.setViewportSize({ width, height: 1080 });
                const head = await page.locator('.chp-list > .list-head .head-cell').nth(2).boundingBox();
                const owner = await page.locator('.chp-playlist-grid .playlist-owner-cell').boundingBox();
                assert.ok(Math.abs(head.x - owner.x) < 2, `Owner must align at ${width}px`);
            }
            assert.equal(await page.locator('.chp-playlist-grid > div').count(), 7);
            assert.doesNotMatch(await page.locator('.chp-playlist-grid').textContent(), /User <script>/);
            assert.equal(await page.locator('.chp-channel-labels .chp-playlist-count').textContent(), '1 playlists');
            assert.equal(await page.locator('.chp-channel .list-asset-subtitle').count(), 0);
            const bounds = await page.locator('.chp-channel-labels').evaluate(node => [...node.children].map(child => child.getBoundingClientRect().toJSON()));
            assert.ok(Math.abs(bounds[0].top - bounds[1].top) < 3);
            assert.ok(bounds[1].left > bounds[0].right);
            assert.equal(await page.locator('.chp-channel').evaluate(node => getComputedStyle(node).minHeight), '76px');
            assert.equal(await page.locator('.chp-playlist-grid').evaluate(node => getComputedStyle(node).minHeight), '76px');
            assert.equal(await page.locator('.chp-list > .list-head .head-cell').first().evaluate(node => getComputedStyle(node).minHeight), '46px');
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
            // The Checked column (with its filter button) is hidden below 1100px; the row menu keeps the filters.
            assert.equal(await page.locator('[data-chp-action="filter"]').isVisible(), false);
            await page.setViewportSize({ width: 1280, height: 900 });
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

    await t.test('390px topbar grows with controls and never clips or overlaps hero in every workspace', async () => {
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
            // The narrow-screen topbar layout is shared by every workspace, not only Channel & Playlist.
            await page.evaluate(() => document.body.classList.remove('channels-view'));
            assert.equal(await page.locator('.topbar').evaluate(node => getComputedStyle(node).flexDirection), 'column');
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
        } finally { await page.close(); }
    });
});
