const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateUrl, validateRequest } = require('../desktop/connection.cjs');
const { createServer } = require('../server.cjs');
const dataDir = fs.mkdtempSync(path.join(__dirname, '../artifacts/native-ui-'));
const { server, db } = createServer({ dataDir });
(async () => {
    assert.equal(validateUrl('https://bobo.taorenlove.live'), 'https://bobo.taorenlove.live');
    assert.throws(() => validateUrl('http://192.168.1.2:18787'));
    for (const bad of ['http://example.com', 'file:///etc/passwd', 'https://x/y', 'https://user:pass@example.com']) assert.throws(() => validateUrl(bad));
    assert.throws(() => validateRequest({ route: '../secrets', method: 'GET', token: '', url: 'https://example.com' }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext();
        let config = { url: 'https://bobo.taorenlove.live', token: '' }, snapshots = [];
        await context.exposeBinding('__nativeCall', async (_, id, payload) => {
            const m = JSON.parse(payload); let result = true;
            try {
                if (m.action === 'getConnection') result = config;
                else if (m.action === 'setConnection') config = m.value || { url: '', token: '' };
                else if (m.action === 'updateTasks') snapshots.push(m.value);
                else if (m.action === 'request') {
                    validateRequest(m.value); const v = m.value;
                    const res = await fetch(base + '/api/' + v.route, { method: v.method, headers: { Authorization: 'Bearer ' + v.token, 'Content-Type': 'application/json' }, body: v.data ? JSON.stringify(v.data) : undefined });
                    result = await res.json(); if (!res.ok) throw new Error(result.error);
                }
                return { id, result: { value: result } };
            } catch (e) { return { id, result: { error: e.message } }; }
        });
        await context.addInitScript(() => { window.BoboAndroid = { call: (id, payload) => { window.__nativeCall(id, payload).then(r => window.__boboReply(r.id, r.result)); } }; });
        const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(base); await page.locator('#mode-label').click();
        assert.equal(await page.locator('#server-url-field').count(), 0);
        assert.equal(await page.locator('#install-links').isVisible(), false);
        await page.locator('#auth-register').click();
        await page.locator('#auth-username').fill('native_user');
        await page.locator('#auth-password').fill('native-password-123');
        await page.locator('#auth-confirm').fill('native-password-123');
        await page.locator('#auth-submit').click();
        await page.locator('#mode-label').filter({ hasText: '已登录' }).waitFor();
        await page.locator('#settings-dialog .close-dialog').click();
        await page.locator('#add-task').click(); await page.locator('#task-title').fill('原生桥接同步验证'); await page.locator('#save-task').click();
        await page.locator('.task-title').filter({ hasText: '原生桥接同步验证' }).waitFor();
        assert.equal(db.accounts[0].tasks.length, 1); assert.equal(db.accounts[0].tasks[0].reminder, 30);
        await page.reload(); await page.locator('.task-title').filter({ hasText: '原生桥接同步验证' }).waitFor();
        assert.ok(snapshots.some(s => s.some(t => t.title === '原生桥接同步验证')));
        await page.locator('#mode-label').click(); await page.locator('#disconnect').click();
        await page.locator('#mode-label').filter({ hasText: '登录 / 注册' }).waitFor();
        assert.equal(config.token, ''); assert.equal(db.accounts[0].tasks.length, 1);
        assert.deepEqual(errors, []);
        console.log('Native bridge contract passed: configurable server, API validation, connect, CRUD, snapshot handoff, reload, disconnect. This is a mocked bridge test, not Android OS alarm delivery.');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
