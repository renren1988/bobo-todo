const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const { createAccounts } = require('./accounts.cjs');

const root = __dirname;
function createServer(options = {}) {
const dataDir = path.resolve(options.dataDir || process.env.BOBO_DATA_DIR || path.join(root, '.runtime/server'));
if (!options.dataDir && !dataDir.startsWith(root + path.sep)) throw new Error('BOBO_DATA_DIR must remain inside bobo_todo');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const dbPath = path.join(dataDir, 'space.json');
const fresh = () => ({ token: crypto.randomBytes(24).toString('base64url'), vapid: webpush.generateVAPIDKeys(), tasks: [], subscriptions: [] });
let db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath)) : fresh();
function save() {
    fs.writeFileSync(dbPath + '.new', JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(dbPath + '.new', dbPath);
}
const accounts = createAccounts(db, save, { mailer: options.mailer, now: options.now });
save();
webpush.setVapidDetails(process.env.BOBO_PUSH_CONTACT || 'mailto:admin@example.com', db.vapid.publicKey, db.vapid.privateKey);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
}
async function body(req) {
    let data = '';
    for await (const chunk of req) {
        data += chunk;
        if (Buffer.byteLength(data) > 16384) throw new Error('请求过大');
    }
    return JSON.parse(data || '{}');
}
function validate(value) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new Error('待办标题需要 1–200 个字');
    if (value.due !== null && (typeof value.due !== 'string' || !Number.isFinite(Date.parse(value.due)))) throw new Error('截止时间不正确');
    if (!Number.isInteger(value.reminder) || value.reminder < 0 || value.reminder > 525600) throw new Error('提醒时间应为 0–525600 分钟');
    if (!['life', 'work', 'study'].includes(value.category)) throw new Error('分类不正确');
    if (typeof value.done !== 'boolean') throw new Error('完成状态不正确');
    return { title: value.title.trim(), due: value.due ? new Date(value.due).toISOString() : null, reminder: value.reminder, category: value.category, done: value.done };
}
const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true, app: 'bobo-todo', version: '0.4.1' });
        if (url.pathname.startsWith('/api/')) {
            const authRoute = url.pathname.match(/^\/api\/auth\/(register|login|recover|me|logout|migrate|email-code|email-bind|email-reset)$/);
            if (authRoute) return json(res, 200, await accounts.handle(authRoute[1], req.method, req.method === 'POST' ? await body(req) : {}, req));
            const principal = accounts.authenticate(req);
            if (!principal) return json(res, 401, { error: '登录已失效，请重新登录' });
            const space = principal.space;
            if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: space.tasks, publicKey: db.vapid.publicKey });
            if (url.pathname === '/api/tasks' && req.method === 'POST') {
                const value = await body(req);
                if (space.tasks.length >= 10000) return json(res, 400, { error: '空间已满，请先整理待办' });
                if (typeof value.importId === 'string') { const prior = space.tasks.find(t => t.importId === value.importId); if (prior) return json(res, 200, prior); }
                const task = { ...(typeof value.importId === 'string' && value.importId.length < 100 ? { importId: value.importId } : {}), ...validate({ reminder: 30, category: 'life', done: false, due: null, ...value }), id: crypto.randomUUID(), revision: 1, created: new Date().toISOString() };
                space.tasks.push(task); save(); return json(res, 201, task);
            }
            const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
            if (match && ['PUT', 'DELETE'].includes(req.method)) {
                const task = space.tasks.find(t => t.id === match[1]);
                if (!task) return json(res, 404, { error: '这件事已被另一台设备移除' });
                const value = await body(req);
                if (value.revision !== task.revision) return json(res, 409, { error: '另一台设备刚刚更新了这件事，已刷新，请再试一次' });
                if (req.method === 'DELETE') space.tasks = space.tasks.filter(t => t.id !== task.id);
                else Object.assign(task, validate(value), { revision: task.revision + 1 });
                save(); return json(res, 200, task);
            }
            if (url.pathname === '/api/push' && req.method === 'POST') {
                const sub = await body(req);
                const endpoint = new URL(sub.endpoint);
                const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];
                if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !allowed.some(host => endpoint.hostname === host || endpoint.hostname.endsWith('.' + host)) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('不支持此推送服务');
                if (!space.subscriptions.some(s => s.endpoint === sub.endpoint)) {
                    if (space.subscriptions.length >= 50) throw new Error('已达到 50 台推送设备上限');
                    space.subscriptions.push({ endpoint: sub.endpoint, keys: sub.keys, sent: {}, sessionHash: principal.session?.hash }); save();
                }
                return json(res, 200, { ok: true });
            }
            if (url.pathname === '/api/push' && req.method === 'DELETE') {
                const value = await body(req);
                space.subscriptions = space.subscriptions.filter(s => s.endpoint !== value.endpoint); save();
                return json(res, 200, { ok: true });
            }
            return json(res, 404, { error: '接口不存在' });
        }
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
        const download = url.pathname.match(/^\/downloads\/(?:updates\/)?(latest\.yml|BoboTodo-[0-9.]+-(?:Windows-Setup(?:-r[2345])?\.exe|Windows-x64\.zip|Android\.apk)|BoboTodo-[0-9.]+-Windows-Setup\.exe\.blockmap)$/);
        if (download) {
            const file = path.join(dataDir, 'downloads', url.pathname.includes('/updates/') ? 'updates' : '', download[1]);
            if (!fs.existsSync(file)) return json(res, 404, { error: '安装包暂未上传' });
            const stat = fs.statSync(file); const range = req.headers.range; const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Disposition': `attachment; filename="${download[1]}"`, 'Cache-Control': download[1] === 'latest.yml' ? 'no-store' : 'public, max-age=86400', 'Last-Modified': stat.mtime.toUTCString() };
            if (range) {
                const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
                const startByte = Number(match[1]); const endByte = match[2] ? Number(match[2]) : stat.size - 1;
                if (startByte >= stat.size || endByte < startByte || endByte >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
                headers['Content-Range'] = `bytes ${startByte}-${endByte}/${stat.size}`; headers['Content-Length'] = endByte - startByte + 1;
                res.writeHead(206, headers); if (req.method === 'HEAD') return res.end(); return fs.createReadStream(file, { start: startByte, end: endByte }).on('error', () => res.destroy()).pipe(res);
            }
            headers['Content-Length'] = stat.size; res.writeHead(200, headers);
            if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
            return;
        }
        const files = new Set(['index.html', 'style.css', 'native.js', 'app.js', 'shared.js', 'sw.js', 'icon.svg', 'icon192.png', 'icon512.png', 'manifest.webmanifest', 'android-version.json', 'orb.html', 'orb.js']);
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!files.has(name)) return json(res, 404, { error: 'Not found' });
        const contents = fs.readFileSync(path.join(root, 'public', name));
        res.writeHead(200, { 'Content-Type': mime[path.extname(name)] || 'text/plain', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) { json(res, error.status || 400, { error: error.message || '请求失败' }); }
});

let sending = false;
async function reminders() {
    if (sending) return;
    sending = true;
    try {
        const now = Date.now();
        for (const space of [db, ...db.accounts]) for (const sub of [...space.subscriptions]) {
            for (const task of space.tasks) {
                if (task.done || !task.due) continue;
                const time = Date.parse(task.due);
                const key = `${task.id}:${task.due}:${task.reminder}`;
                if (now < time - task.reminder * 60000 || now > time + 86400000 || sub.sent[key]) continue;
                try {
                    await webpush.sendNotification(sub, JSON.stringify({ title: '啵啵轻轻提醒你', body: `${task.title} · ${now >= time ? '已到截止时间' : `还有 ${Math.ceil((time - now) / 60000)} 分钟`}`, tag: key }), { TTL: 3600, timeout: 8000 });
                    sub.sent[key] = now; save();
                } catch (error) {
                    if ([404, 410].includes(error.statusCode)) { space.subscriptions = space.subscriptions.filter(s => s !== sub); save(); break; }
                    console.error('Push delivery failed:', error.statusCode || error.code || 'network');
                }
            }
        }
    } finally { sending = false; }
}
const timer = setInterval(reminders, 15000);
server.on('close', () => clearInterval(timer));
return { server, db, reminders };
}

let instance;
const defaults = () => instance || (instance = createServer());
if (require.main === module) {
    const { server } = defaults();
    server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
        console.log(`啵啵待办已启动：http://${process.env.HOST || '127.0.0.1'}:${server.address().port}`);
        console.log('配对密钥保存在数据目录 space.json 的 token 字段。');
    });
}
module.exports = { createServer, get server() { return defaults().server; }, get db() { return defaults().db; }, get reminders() { return defaults().reminders; } };
