const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { NsisUpdater } = require('electron-updater/out/NsisUpdater');
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const afterPack = require('../scripts/after-pack.cjs');
test('NSIS updater reproduces missing config then checks and downloads with packaged config', async t => {
    const root = fs.mkdtempSync(path.join(__dirname, '../artifacts/updater-test-'));
    const payload = Buffer.from('MZ test-only installer payload, never executed');
    const sha512 = crypto.createHash('sha512').update(payload).digest('base64');
    let downloads = 0;
    const server = http.createServer((req, res) => {
        if (req.url.split('?')[0].endsWith('.yml')) { res.end(`version: 0.4.2\nfiles:\n  - url: BoboTodo-0.4.2-Windows-Setup.exe\n    sha512: ${sha512}\n    size: ${payload.length}\n`); }
        else { downloads++; res.setHeader('Content-Length', payload.length); res.end(payload); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const config = path.join(root, 'resources/app-update.yml');
    function updater() {
        const u = new NsisUpdater(null, { version: '0.4.1', name: 'bobo-todo', isPackaged: true, appUpdateConfigPath: config, userDataPath: root, baseCachePath: root, whenReady: async () => {}, onQuit: () => {} });
        u.httpExecutor = new NodeHttpExecutor(); u.httpExecutor.download = ElectronHttpExecutor.prototype.download;
        u.logger = {info(){},warn(){},error(){},debug(){}};
        u.autoDownload = false; u.autoInstallOnAppQuit = false; u.disableDifferentialDownload = true;
        u._testOnlyOptions = {platform:'win32'};
        u.setFeedURL({ provider:'generic', url:base });
        return u;
    }
    const broken = updater(); assert.equal((await broken.checkForUpdates()).updateInfo.version,'0.4.2');
    await assert.rejects(broken.downloadUpdate(), e => e.code === 'ENOENT' && e.path === config);
    assert.equal(downloads,0,'setFeedURL alone still needs the on-disk cache configuration');
    await afterPack({ electronPlatformName:'win32', appOutDir:root, packager:{config:{publish:{provider:'generic',url:'https://bobo.taorenlove.live/downloads/updates/'}}} });
    const fixed = updater(); assert.equal((await fixed.checkForUpdates()).updateInfo.version,'0.4.2');
    const files = await fixed.downloadUpdate(); assert.equal(downloads,1);
    assert.deepEqual(fs.readFileSync(files[0]),payload);
    assert.ok(files[0].includes('bobo-todo-updater'));
});
