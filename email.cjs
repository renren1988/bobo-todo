const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function normalizeEmail(value) {
    if (typeof value !== 'string') throw fail('请输入邮箱地址');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(email)) throw fail('邮箱地址格式不正确');
    return email;
}
function createMailer(env = process.env) {
    const configured = !!(env.BOBO_SMTP_HOST && env.BOBO_SMTP_USER && env.BOBO_SMTP_PASSWORD && env.BOBO_MAIL_FROM);
    if (!configured) return { configured: false, send: async () => { throw fail('邮件服务尚未配置，请联系管理员', 503); } };
    const port = Number(env.BOBO_SMTP_PORT || 465);
    if (![465, 587].includes(port)) throw new Error('BOBO_SMTP_PORT must be 465 or 587 (TLS required)');
    const transport = nodemailer.createTransport({ host: env.BOBO_SMTP_HOST, port, secure: port === 465, requireTLS: true,
        auth: { user: env.BOBO_SMTP_USER, pass: env.BOBO_SMTP_PASSWORD }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
    return { configured: true, async send({ to, code, purpose }) {
        const action = { register: '注册账号', bind: '绑定邮箱', reset: '找回密码' }[purpose];
        const result = await transport.sendMail({ from: env.BOBO_MAIL_FROM, to,
            subject: `啵啵待办 · ${action}验证码`,
            text: `你正在${action}，验证码：${code}\n\n验证码 10 分钟内有效，仅可使用一次。请勿转发验证码。\n如果不是你本人操作，请忽略本邮件。\n\n啵啵待办` });
        if (!result.accepted?.length) throw new Error('Mail recipient was not accepted');
    } };
}
function createEmailCodes(db, save, mailer, now = Date.now) {
    db.emailChallenges ||= [];
    const rates = new Map();
    const digest = (id, code) => crypto.createHash('sha256').update(id + ':' + code).digest('hex');
    function limit(key, maximum, window) {
        for (const [k, value] of rates) if (value.until <= now()) rates.delete(k);
        const record = rates.get(key) || { count: 0, until: now() + window };
        if (record.count >= maximum || rates.size > 10000) throw fail('验证码请求较多，请稍后重试', 429);
        record.count++; rates.set(key, record);
    }
    async function send(email, purpose, owner, ip, deliver = true) {
        if (!mailer.configured) throw fail('邮件服务尚未配置，请联系管理员', 503);
        limit('email-minute:' + email, 1, 60000);
        limit('email-hour:' + email, 5, 3600000);
        limit('ip:' + ip, 20, 3600000); limit('global', 200, 3600000);
        const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
        const id = crypto.randomBytes(24).toString('base64url');
        db.emailChallenges = db.emailChallenges.filter(c => c.expires > now() && !(c.email === email && c.purpose === purpose && c.owner === owner));
        if (db.emailChallenges.length >= 1000) throw fail('请求较多，请稍后重试', 429);
        const record = { id, email, purpose, owner, hash: digest(id, code), expires: now() + 600000, attempts: 0, ready: false };
        db.emailChallenges.push(record); save();
        try {
            if (deliver) await mailer.send({ to: email, code, purpose });
            record.ready = true; save();
        } catch {
            db.emailChallenges = db.emailChallenges.filter(c => c !== record); save();
            throw fail('邮件发送失败，请稍后重试或联系管理员', 503);
        }
        return { ok: true, challengeId: id, expiresIn: 600, retryAfter: 60, message: purpose === 'reset' ? '如果该邮箱已绑定账号，你会收到验证码。' : '验证码已发送，请检查收件箱和垃圾邮件。' };
    }
    function check(data, email, purpose, owner) {
        const c = db.emailChallenges.find(c => c.id === data.challengeId && c.email === email && c.purpose === purpose && c.owner === owner);
        if (!c || !c.ready || c.expires <= now() || c.attempts >= 5) throw fail('验证码无效或已过期，请重新获取');
        c.attempts++; save();
        if (typeof data.code !== 'string' || !/^\d{6}$/.test(data.code) || !crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(digest(c.id, data.code)))) throw fail('验证码不正确');
        return c;
    }
    function consume(c) {
        if (!db.emailChallenges.includes(c) || c.expires <= now() || c.attempts > 5) throw fail('验证码已使用或过期，请重新获取');
        db.emailChallenges = db.emailChallenges.filter(x => x !== c);
    }
    function clear(owner) { db.emailChallenges = db.emailChallenges.filter(c => c.owner !== owner); }
    return { send, check, consume, clear };
}
module.exports = { createMailer, createEmailCodes, normalizeEmail };
