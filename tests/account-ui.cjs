const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createServer } = require('../server.cjs');
const dataDir = fs.mkdtempSync(path.join(__dirname, '../artifacts/account-ui-'));
const { server, db } = createServer({ dataDir });
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch();
    const errors = [];
    try {
        const desktopContext = await browser.newContext({ viewport:{width:1280,height:1000}, reducedMotion:'reduce' });
        const mobileContext = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, reducedMotion:'reduce' });
        const desktop = await desktopContext.newPage(), phone = await mobileContext.newPage();
        for (const p of [desktop,phone]) p.on('pageerror', e => errors.push(e.message));
        async function auth(page, name, mode) {
            await page.goto(base); await page.locator('#mode-label').click();
            if (mode === 'register') await page.locator('#auth-register').click();
            await page.locator('#auth-username').fill(name); await page.locator('#auth-password').fill('password-test-123');
            if (mode === 'register') await page.locator('#auth-confirm').fill('password-test-123');
            await page.locator('#auth-submit').click(); await page.locator('#account-name').filter({hasText:name}).waitFor();
        }
        await auth(desktop, 'ui_alice', 'register');
        assert.equal(await desktop.locator('#recovery-result').isVisible(), true);
        assert.equal(await desktop.locator('#share-url').count(), 0);
        await desktop.screenshot({path:path.join(dataDir,'account.png'),animations:'disabled'});
        await desktop.locator('#settings-dialog .close-dialog').click();
        await desktop.locator('#add-task').click(); await desktop.locator('#task-title').fill('账号版：电脑手机一起记');
        assert.equal(await desktop.locator('#task-reminder').inputValue(), '30');
        await desktop.locator('#save-task').click(); await desktop.locator('.task-title').filter({hasText:'账号版'}).waitFor();
        await auth(phone, 'ui_alice', 'login'); await phone.locator('#settings-dialog .close-dialog').click();
        await phone.locator('.task-title').filter({hasText:'账号版'}).waitFor({timeout:12000});
        await phone.locator('.check').click();
        await desktop.locator('#stat-done').filter({hasText:'1'}).waitFor({timeout:12000});
        await phone.locator('#mode-label').click(); await phone.locator('#disconnect').click();
        await phone.locator('#auth-panel').waitFor(); assert.equal(await phone.locator('.task-row').count(),0);
        await auth(phone,'ui_bob','register'); await phone.locator('#settings-dialog .close-dialog').click();
        assert.equal(await phone.locator('.task-row').count(),0);
        await phone.reload(); await phone.locator('#mode-label').filter({hasText:'已登录'}).waitFor();
        assert.equal(await phone.locator('.task-row').count(),0);
        assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
        await phone.screenshot({path:path.join(dataDir,'mobile.png'),animations:'disabled'});
        assert.equal(db.accounts.length,2); assert.deepEqual(errors,[]);
        console.log('Account UI passed: register, recovery display, login on second device, sync, complete, logout/cache clearing, isolated second account, mobile layout.');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e=>{ console.error(e);server.close();process.exitCode=1; });
