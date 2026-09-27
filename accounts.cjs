const crypto = require('crypto');
const { promisify } = require('util');
const derive = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function createAccounts(db, save) {
    db.accounts ||= []; db.sessions ||= []; db.schemaVersion = 2;
    let busy = 0;
    const attempts = new Map();
    function limit(key) {
        const now = Date.now();
        for (const [k, entry] of attempts) if (entry.until < now) attempts.delete(k);
        const entry = attempts.get(key) || { count: 0, until: now + 600000 };
        if (++entry.count > 20) throw fail('尝试次数较多，请 10 分钟后重试', 429);
        attempts.set(key, entry);
        if (attempts.size > 5000) throw fail('请求较多，请稍后重试', 429);
    }
    function username(value) {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value)) throw fail('账号需为 3–32 位字母、数字或下划线');
        return value.toLowerCase();
    }
    function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw fail('密码需为 10–128 个字符'); return value; }
    async function hash(value, salt) {
        if (busy >= 4) throw fail('登录请求较多，请稍后重试', 429);
        busy++;
        try { return (await derive(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex'); }
        finally { busy--; }
    }
    function issue(user) {
        const token = 'bb_' + crypto.randomBytes(32).toString('base64url');
        db.sessions = db.sessions.filter(s => s.expires > Date.now());
        const own = db.sessions.filter(s => s.userId === user.id);
        if (own.length >= 20) db.sessions = db.sessions.filter(s => s !== own[0]);
        db.sessions.push({ hash: digest(token), userId: user.id, expires: Date.now() + 30 * 86400000 });
        save(); return { token, user: { id: user.id, username: user.username } };
    }
    function authenticate(req) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const session = db.sessions.find(s => same(s.hash, digest(token)) && s.expires > Date.now());
        if (session) { const user = db.accounts.find(a => a.id === session.userId); if (user) return { user, space: user, session }; }
        if (!db.legacyOwner && same(token, db.token)) return { user: null, space: db, legacy: true };
        return null;
    }
    async function handle(route, method, data, req) {
        if (method === 'POST' && ['register', 'login', 'recover'].includes(route)) {
            const name = username(data.username);
            limit('ip:' + req.socket.remoteAddress); limit('name:' + name);
            const user = db.accounts.find(a => a.username === name);
            if (route === 'register') {
                if (user) throw fail('这个账号已被使用');
                if (db.accounts.length >= 10000) throw fail('暂时无法注册');
                const salt = crypto.randomBytes(16).toString('hex');
                const passwordHash = await hash(password(data.password), salt);
                // Another concurrent registration may have completed during scrypt.
                if (db.accounts.some(a => a.username === name)) throw fail('这个账号已被使用');
                const recoveryCode = crypto.randomBytes(20).toString('hex');
                const record = { id: crypto.randomUUID(), username: name, salt, passwordHash, recoveryHash: digest(recoveryCode), tasks: [], subscriptions: [], created: new Date().toISOString() };
                db.accounts.push(record); return { ...issue(record), recoveryCode };
            }
            if (route === 'login') {
                const computed = await hash(password(data.password), user?.salt || 'invalid-account-salt');
                if (!user || !same(computed, user.passwordHash)) throw fail('账号或密码不正确', 401);
                return issue(user);
            }
            if (typeof data.recoveryCode !== 'string' || data.recoveryCode.length > 100 || !user || !same(digest(data.recoveryCode.trim()), user.recoveryHash)) throw fail('账号或恢复码不正确', 401);
            const oldRecovery = user.recoveryHash;
            const salt = crypto.randomBytes(16).toString('hex'); const passwordHash = await hash(password(data.password), salt);
            if (user.recoveryHash !== oldRecovery) throw fail('恢复码已经使用', 401);
            const recoveryCode = crypto.randomBytes(20).toString('hex');
            Object.assign(user, { salt, passwordHash, recoveryHash: digest(recoveryCode), subscriptions: [] });
            db.sessions = db.sessions.filter(s => s.userId !== user.id);
            return { ...issue(user), recoveryCode };
        }
        const principal = authenticate(req);
        if (!principal?.user) throw fail('请登录账号', 401);
        const user = principal.user;
        if (route === 'me' && method === 'GET') return { user: { id: user.id, username: user.username } };
        if (route === 'logout' && method === 'POST') {
            db.sessions = db.sessions.filter(s => s !== principal.session);
            user.subscriptions = user.subscriptions.filter(s => s.sessionHash !== principal.session.hash);
            save(); return { ok: true };
        }
        if (route === 'migrate' && method === 'POST') {
            if (db.legacyOwner === user.id) return { ok: true, migrated: 0 };
            if (db.legacyOwner || typeof data.legacyToken !== 'string' || !same(data.legacyToken, db.token)) throw fail('未找到可迁移的旧空间');
            const migrated = db.tasks.length;
            user.tasks.push(...db.tasks.map(t => ({ ...t })));
            db.legacyOwner = user.id; db.subscriptions = [];
            // Keep the frozen legacy tasks as a recovery archive. Old tokens cease to authorize access.
            save(); return { ok: true, migrated };
        }
        throw fail('接口不存在', 404);
    }
    return { handle, authenticate };
}
module.exports = { createAccounts };
