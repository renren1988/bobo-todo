const { app, BrowserWindow, ipcMain, screen, Notification, Menu, powerMonitor, net, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { shouldRemind, reminderKey, sortTasks } = require('../public/shared.js');
const { autoUpdater } = require('electron-updater');
const projectRoot = path.resolve(__dirname, '..');
const runtime = path.resolve(process.env.BOBO_DESKTOP_DATA_DIR || (app.isPackaged ? path.join(app.getPath('appData'), 'bobo-todo') : path.join(projectRoot, '.runtime/desktop')));
if (!app.isPackaged && !runtime.startsWith(projectRoot + path.sep)) throw new Error('Desktop data must remain inside bobo_todo');
fs.mkdirSync(runtime, { recursive: true });
app.setPath('userData', runtime);
app.setPath('sessionData', path.join(runtime, 'session'));
app.setPath('logs', path.join(runtime, 'logs'));
app.setPath('crashDumps', path.join(runtime, 'crashes'));
// Transparent always-on-top windows can trigger GPU/DWM stalls on some Windows drivers.
app.disableHardwareAcceleration();
app.setAppUserModelId('com.bobo.todo');
app.name = '啵啵待办';
const { validateUrl, validateRequest } = require('./connection.cjs');

let base, localService;
const connectionPath = path.join(runtime, 'connection.json');
let connection = fs.existsSync(connectionPath) ? JSON.parse(fs.readFileSync(connectionPath)) : null;
const legacyConnection = connection && !connection.token?.startsWith('bb_') ? connection : null;
if (legacyConnection) connection = null;
let orb, panel, quitting = false, dragging = null, tasks = [], notices = [];
let updateState = { status: 'idle', version: null, error: null, percent: 0 };
let sent = {};
const sentPath = path.join(runtime, 'reminded.json');
if (fs.existsSync(sentPath)) sent = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
function showPanel(text) {
    panel.show(); panel.focus();
    if (text) panel.webContents.send('drop-text', text);
}
function from(event, win) { return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
function check() {
    for (const task of sortTasks(tasks)) {
        const key = reminderKey(task);
        if (!shouldRemind(task) || sent[key] || !Notification.isSupported()) continue;
        const note = new Notification({ title: '啵啵轻轻提醒你 🌱', body: `${task.title}\n${new Date(task.due).toLocaleString('zh-CN')} 截止` });
        note.on('click', () => showPanel());
        note.on('show', () => { sent[key] = Date.now(); fs.writeFileSync(sentPath, JSON.stringify(sent)); });
        note.on('close', () => { notices = notices.filter(n => n !== note); });
        note.on('failed', () => { notices = notices.filter(n => n !== note); });
        notices.push(note); note.show();
    }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => { if (panel) showPanel(); });
    app.whenReady().then(async () => {
        // Serve bundled UI on loopback only. All accounts synchronize with the HTTPS service.
        localService = require('../server.cjs').createServer({ dataDir: path.join(runtime, 'space') });
        await new Promise((resolve, reject) => {
            localService.server.once('error', reject);
            const saved = path.join(runtime, 'port.json');
            const port = fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved)) : 18787;
            localService.server.listen(port, '127.0.0.1', resolve);
        });
        base = new URL(`http://127.0.0.1:${localService.server.address().port}`);
        const work = screen.getPrimaryDisplay().workArea;
        const prefs = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true };
        panel = new BrowserWindow({ width: 520, height: 790, minWidth: 380, minHeight: 500, title: '啵啵待办', icon: path.join(projectRoot, 'desktop/icon.ico'), backgroundColor: '#f8f7f2', autoHideMenuBar: true, show: false, webPreferences: prefs });
        orb = new BrowserWindow({ width: 100, height: 100, x: work.x + work.width - 125, y: work.y + work.height - 135, transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, webPreferences: prefs });
        orb.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        orb.loadFile(path.join(__dirname, '../public/orb.html'));
        ipcMain.handle('get-connection', event => {
            if (!from(event, panel)) throw new Error('Untrusted frame');
            return { url: 'https://bobo.taorenlove.live', token: connection?.token || '',
                legacyToken: legacyConnection?.url === 'https://bobo.taorenlove.live' ? legacyConnection.token : null,
                legacyTasks: localService.db.tasks || [] };
        });
        ipcMain.handle('set-connection', (event, value) => {
            if (!from(event, panel)) throw new Error('Untrusted frame');
            if (value && value.url) validateUrl(value.url);
            connection = value && value.token ? { url: 'https://bobo.taorenlove.live', token: value.token } : { url: 'https://bobo.taorenlove.live', token: '' };
            tasks = []; if (orb) orb.webContents.send('count', 0);
            fs.writeFileSync(connectionPath, JSON.stringify(connection)); return true;
        });
        ipcMain.handle('check-for-updates', event => {
            if (!from(event, panel)) throw new Error('Untrusted frame');
            if (!app.isPackaged || process.platform !== 'win32') return { status: 'unsupported', version: app.getVersion() };
            if (['available', 'downloading', 'downloaded', 'checking'].includes(updateState.status)) return updateState;
            autoUpdater.checkForUpdates().catch(error => { updateState = { status: 'error', version: null, error: error.message, percent: 0 }; panel.webContents.send('update-status', updateState); });
            return { ...updateState, version: app.getVersion() };
        });
        ipcMain.handle('download-update', event => {
            if (!from(event, panel)) throw new Error('Untrusted frame');
            if (updateState.status === 'available') autoUpdater.downloadUpdate().catch(error => { updateState = { status: 'error', version: null, error: error.message, percent: 0 }; panel.webContents.send('update-status', updateState); });
            return updateState;
        });
        ipcMain.on('install-update', event => { if (from(event, panel) && updateState.status === 'downloaded') { quitting = true; autoUpdater.quitAndInstall(false, true); } });
        const sendUpdate = state => { updateState = state; if (panel && !panel.isDestroyed()) panel.webContents.send('update-status', state); };
        autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.disableDifferentialDownload = true;
        autoUpdater.setFeedURL({ provider: 'generic', url: 'https://bobo.taorenlove.live/downloads/updates/' });
        autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking', version: null, error: null, percent: 0 }));
        autoUpdater.on('update-available', info => sendUpdate({ status: 'available', version: info.version, error: null, percent: 0 }));
        autoUpdater.on('update-not-available', info => sendUpdate({ status: 'latest', version: info.version, error: null, percent: 0 }));
        autoUpdater.on('download-progress', p => sendUpdate({ status: 'downloading', version: updateState.version, error: null, percent: Math.round(p.percent) }));
        autoUpdater.on('update-downloaded', info => sendUpdate({ status: 'downloaded', version: info.version, error: null, percent: 100 }));
        autoUpdater.on('error', error => sendUpdate({ status: 'error', version: null, error: error.message, percent: 0 }));

        ipcMain.handle('api-request', async (event, value) => {
            if (!from(event, panel)) throw new Error('Untrusted frame');
            const origin = validateRequest(value);
            const response = await net.fetch(origin + '/api/' + value.route, { method: value.method, headers: { Authorization: 'Bearer ' + value.token, 'Content-Type': 'application/json' }, body: value.data ? JSON.stringify(value.data) : undefined, redirect: 'error', signal: AbortSignal.timeout(value.route === 'auth/email-code' ? 45000 : 10000) });
            const data = await response.json(); if (!response.ok) { if (response.status === 401 && value.route === 'tasks') { tasks = []; orb.webContents.send('count', 0); } throw new Error(data.error || '连接失败'); } return data;
        });
        panel.loadURL(base.href);
        panel.once('ready-to-show', () => { if (app.isPackaged && process.platform === 'win32') setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000); if (!fs.existsSync(path.join(runtime, 'onboarded'))) { showPanel(); fs.writeFileSync(path.join(runtime, 'onboarded'), '1'); } });
        panel.webContents.on('did-fail-load', (_, code, description) => { console.error(`无法连接待办服务 (${code}): ${description}。请先启动服务或设置 BOBO_URL。`); });
        for (const win of [panel, orb]) {
            win.webContents.setWindowOpenHandler(({ url }) => { if (win === panel && url === 'https://github.com/renren1988/bobo-todo/releases') shell.openExternal(url); return { action: 'deny' }; });
            win.webContents.on('will-navigate', (event, url) => { if (win === orb || new URL(url).origin !== base.origin) { event.preventDefault(); if (win === panel && url === 'https://github.com/renren1988/bobo-todo/releases') shell.openExternal(url); } });
        }
        panel.on('close', e => { if (!quitting) { e.preventDefault(); panel.hide(); } });
        orb.webContents.on('context-menu', () => Menu.buildFromTemplate([{ label: '打开啵啵待办', click: () => showPanel() }, { label: '收起清单', click: () => panel.hide() }, { type: 'separator' }, { label: '退出啵啵（停止电脑提醒）', click: () => app.quit() }]).popup({ window: orb }));
        ipcMain.on('collapse', event => { if (from(event, panel)) panel.hide(); });
        ipcMain.on('open-panel', event => { if (from(event, orb)) showPanel(); });
        ipcMain.on('tasks', (event, value) => {
            if (!from(event, panel) || !Array.isArray(value)) return;
            tasks = value.filter(t => t && typeof t.title === 'string' && t.title.length <= 200 && typeof t.id === 'string' && (t.due === null || typeof t.due === 'string') && Number.isInteger(t.reminder) && t.reminder >= 0 && typeof t.done === 'boolean' && typeof t.created === 'string').slice(0, 10000);
            orb.webContents.send('count', tasks.filter(t => !t.done).length); check();
        });
        ipcMain.handle('enable-notifications', event => {
            if (!from(event, panel) || !Notification.isSupported()) return false;
            new Notification({ title: '啵啵的提醒已准备好', body: '小球运行期间，我会按每件事的设置提醒你。' }).show(); return true;
        });
        ipcMain.on('drag-start', event => { if (from(event, orb)) dragging = { point: screen.getCursorScreenPoint(), bounds: orb.getBounds() }; });
        ipcMain.on('drag-move', event => {
            if (!from(event, orb) || !dragging) return;
            const cursor = screen.getCursorScreenPoint(), area = screen.getDisplayNearestPoint(cursor).workArea;
            orb.setPosition(Math.round(Math.max(area.x, Math.min(area.x + area.width - 100, dragging.bounds.x + cursor.x - dragging.point.x))), Math.round(Math.max(area.y, Math.min(area.y + area.height - 100, dragging.bounds.y + cursor.y - dragging.point.y))));
        });
        ipcMain.on('drag-end', event => { if (from(event, orb)) dragging = null; });
        ipcMain.on('drop', (event, text) => { if (from(event, orb) && typeof text === 'string') showPanel(text.slice(0, 200)); });
        const timer = setInterval(check, 10000);
        powerMonitor.on('resume', () => { panel.webContents.send('wake'); check(); });
        app.on('before-quit', () => { quitting = true; clearInterval(timer); localService.server.close(); });
    }).catch(error => { dialog.showErrorBox('啵啵启动失败', error.message); app.quit(); });
}
