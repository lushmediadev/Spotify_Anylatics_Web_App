import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../channels.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../channels.css', import.meta.url), 'utf8');

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
        await page.setContent('<div id="channel-group-rail"></div><div id="channels-panel"></div>' +
            '<div id="youtube-key-settings"></div><button id="nav-settings">Settings</button>');
        await page.addStyleTag({ content: css });
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
                if (requestPath.startsWith('/youtube/channels?')) return structuredClone(window.data);
                if (requestPath.startsWith('/items?')) return { items: window.data.items[0].playlists, total: 1 };
                if (requestPath === '/youtube/keys') return { api_keys: 'SECRET' };
                if (requestPath === '/youtube/keys/check') return { results: window.keyResults };
                return { accepted: 1, skipped: 0 };
            };
            ChannelPlaylists.init({
                getUser: () => ({ id: 'actor' }),
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
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"] .chp-muted').textContent(), '0');
            await page.evaluate(() => ChannelPlaylists.reload());
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"]').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('[data-chp-group="Nhóm mới"] .chp-muted').textContent(), '0');
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
            assert.equal(await page.locator('.chp-list [data-chp-action="new-group"]').isVisible(), true);
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
            await page.locator('.chp-edit').click();
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
            await page.locator('.chp-edit').click(); await page.waitForSelector('.chp-pick');
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
            await page.locator('.chp-edit').click();
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
});
