const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.BOBO_DATA_DIR = fs.mkdtempSync(path.join(__dirname, '../artifacts/ui-data-'));
const { server, db } = require('../server.cjs');
const output = fs.mkdtempSync(path.join(__dirname, '../artifacts/preview-'));
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    const errors = [];
    try {
        const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
        const page = await desktop.newPage(); page.on('pageerror', err => errors.push(err.message));
        await page.goto(base);
        await page.getByRole('button', { name: '＋ 添加第一件小事' }).click();
        assert.equal(await page.locator('#task-reminder').inputValue(), '30');
        await page.locator('#task-title').fill('无截止的小事');
        await page.locator('#save-task').click();
        await page.locator('.task-title').filter({ hasText: '无截止的小事' }).waitFor();
        await page.reload(); assert.equal(await page.locator('.task-row').count(), 1);
        await page.locator('#sync-open').click(); await page.locator('#space-token').fill(db.token); await page.locator('#connect-form button').click();
        await page.locator('#mode-label').filter({ hasText: '已连接' }).waitFor();
        assert.equal(db.tasks.length, 1);
        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
        const phone = await mobile.newPage(); phone.on('pageerror', err => errors.push(err.message));
        await phone.goto(base);
        await phone.locator('#mode-label').click();
        await phone.locator('#space-token').fill(db.token); await phone.locator('#connect-form button').click();
        await phone.locator('.task-row').waitFor();
        await phone.locator('#add-task').click(); await phone.locator('#task-title').fill('手机丢进来的事');
        await phone.locator('#task-due').fill('2026-12-25T18:00'); await phone.locator('#task-reminder').fill('15'); await phone.locator('#save-task').click();
        await phone.locator('#task-dialog').waitFor({ state: 'hidden' });
        await page.locator('.task-title').filter({ hasText: '手机丢进来的事' }).waitFor({ timeout: 12000 });
        assert.equal(await page.locator('.task-title').first().textContent(), '手机丢进来的事');
        await page.locator('.task-title').first().click(); await page.locator('#task-title').fill('电脑改好的事'); await page.locator('#save-task').click();
        await phone.locator('.task-title').filter({ hasText: '电脑改好的事' }).waitFor({ timeout: 12000 });
        await phone.locator('.check').first().click();
        await page.locator('#stat-done').filter({ hasText: '1' }).waitFor({ timeout: 12000 });
        await page.locator('#tab-done').click(); await page.locator('.check').first().click(); await page.locator('#tab-pending').click();
        await page.locator('#floating-orb').click(); await page.locator('#orb-popover').waitFor({ state: 'visible' }); await page.locator('#orb-close').click();
        const before = await page.locator('#floating-orb').boundingBox(); await page.mouse.move(before.x + 35, before.y + 35); await page.mouse.down(); await page.mouse.move(before.x - 100, before.y - 100, { steps: 8 }); await page.mouse.up();
        const after = await page.locator('#floating-orb').boundingBox(); assert.ok(after.x < before.x - 50);
        await page.reload();
        // Seed only the isolated test space for the preview, never a user's real space.
        const samples = [
            ['把新方案发给设计小伙伴', 110, 'work', 30, false],
            ['读完《小王子》的下一章', 290, 'study', 15, false],
            ['下班路上，带一束花回家', 420, 'life', 30, false],
            ['整理这周的灵感和小笔记', 1640, 'work', 60, false],
            ['给妈妈打个电话', 2920, 'life', 30, false],
            ['给窗边的小植物浇水', null, 'life', 30, false],
            ['好好吃一顿早餐', -120, 'life', 30, true]
        ];
        db.tasks = samples.map(([title, offset, category, reminder, done], i) => ({ id: `preview-${i}`, title, due: offset === null ? null : new Date(Date.now() + offset * 60000).toISOString(), reminder, category, done, created: new Date().toISOString(), revision: 1 }));
        await page.reload(); await page.locator('.task-title').filter({ hasText: '把新方案' }).waitFor();
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true, animations: 'disabled' });
        await page.locator('#add-task').click(); await page.locator('#task-title').fill('做一个可爱的小球，装下所有小事');
        await page.screenshot({ path: path.join(output, 'add-task.png'), fullPage: true, animations: 'disabled' });
        await phone.reload(); await phone.locator('.task-title').filter({ hasText: '把新方案' }).waitFor();
        assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
        await phone.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true, animations: 'disabled' });
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: local persistence, two-device CRUD, DDL order, default/custom reminders, completion, draggable orb, mobile layout.');
        console.log('Previews: ' + output);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
