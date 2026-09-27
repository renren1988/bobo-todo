const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.BOBO_DATA_DIR = fs.mkdtempSync(path.join(__dirname, '../artifacts/desktop-data-'));
const { server } = require('../server.cjs');
(async () => {
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        console.log('SKIP desktop integration: a real desktop session is required.'); server.close(); return;
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let app;
    try {
        app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, BOBO_URL: `http://127.0.0.1:${server.address().port}`, BOBO_DESKTOP_DATA_DIR: path.join(process.env.BOBO_DATA_DIR, 'client') }, timeout: 20000 });
        await app.firstWindow();
        const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), top: w.isAlwaysOnTop(), size: w.getSize() })));
        assert.equal(windows.length, 2);
        assert.ok(windows.some(w => w.top && w.size[0] === 100));
        let orb;
        for (const win of app.windows()) if ((await win.title()).includes('悬浮球')) orb = win;
        assert.ok(orb); await orb.locator('#orb').click();
        let panel;
        for (const win of app.windows()) if (!(await win.title()).includes('悬浮球')) panel = win;
        await panel.locator('#add-task').click(); await panel.locator('#task-title').fill('桌面小球测试'); await panel.locator('#save-task').click();
        await orb.locator('#count').filter({ hasText: '1' }).waitFor();
        assert.ok(await panel.evaluate(() => !!window.boboDesktop));
        const status = await app.evaluate(({ BrowserWindow }) => {
            const panel = BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()); panel.close();
            return { count: BrowserWindow.getAllWindows().length, visible: panel.isVisible() };
        });
        assert.equal(status.count, 2); assert.equal(status.visible, false);
        console.log('Electron: always-on-top orb, preload bridge, add task, orb count, close-to-hide passed. OS notification delivery still needs real-device validation.');
    } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
