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
        await page.setContent('<html data-theme="light"><head><meta charset="UTF-8"></head><body><header class="topbar"><div><h1 id="page-title"></h1><span id="breadcrumb-group"></span></div><div id="channel-header-tools"></div></header><aside id="group-panel"><div id="channel-group-tools" class="p-5 pb-3"></div><div id="channel-group-rail"></div></aside><div id="channels-panel"></div>' +
            '<div id="youtube-key-settings"></div><button id="nav-settings">Settings</button>');
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
                if (requestPath === '/youtube/keys') return { api_keys: 'SECRET' };
                if (requestPath === '/youtube/keys/check') return { results: window.keyResults };
                return { accepted: 1, skipped: 0 };
            };
            ChannelPlaylists.init({
                getUser: () => ({ id: 'actor' }),
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
                window.oldLoad = ChannelPlaylists.show({ userId: 'slow' });
                await Promise.resolve(); await Promise.resolve();
                await ChannelPlaylists.setUserFilter('owner');
                window.finishSlow({ items: [{ id: 'stale', name: 'STALE', playlists: [] }], total: 1, groups: [] });
                await window.oldLoad;
            });
            assert.equal(await page.locator('[data-chp-channel="c1"]').count(), 1);
            assert.equal(await page.locator('[data-chp-channel="stale"]').count(), 0);
            await page.evaluate(async () => {
                window.failedLoad = ChannelPlaylists.setUserFilter('failed');
                await Promise.resolve(); await Promise.resolve();
                await ChannelPlaylists.setUserFilter('owner');
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
            const latest = await page.evaluate(() => window.calls.at(-1).path);
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
            assert.equal(await page.evaluate(() => window.calls.length), 1);
            await page.evaluate(() => ChannelPlaylists.reload());
            assert.equal(await page.evaluate(() => window.calls.length), 2);
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
            await page.evaluate(() => ChannelPlaylists.setUserFilter('new-owner'));
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
                ChannelPlaylists.init({ getUser: () => ({ id: 'actor' }), request: window.handleRequest,
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
                await ChannelPlaylists.setUserFilter('new-owner');
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
