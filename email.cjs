const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function normalizeEmail(value) {
    if (typeof value !== 'string') throw fail('请输入邮箱地址');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(email)) throw fail('邮箱地址格式不正确');
    return email;
}
function verificationMail(code, purpose) {
    const copy = {
        register: ['注册账号', '叮！你的小空间准备好啦', '啵啵带着一枚验证码，来迎接你啦。'],
        bind: ['绑定邮箱', '给你的小空间留个联络方式', '绑好邮箱，就不怕和小事们走散啦。'],
        reset: ['找回密码', '别着急，啵啵带你回家', '你记下的小事都还在，我们一起找回账号。']
    }[purpose];
    if (!copy || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('Invalid verification email');
    const [action, title, intro] = copy;
    return {
        subject: `啵啵待办 · ${action}验证码`,
        text: `${title} 🌱\n\n${intro}\n\n${action}验证码：${code}\n\n10 分钟内有效，仅可使用一次。请在啵啵中输入，不要转发给别人。\n如果不是你本人操作，忽略这封邮件就好。\n\n把小事交给小球，把时间留给生活。\n啵啵待办`,
        html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>啵啵待办验证码</title></head>
<body style="margin:0;padding:0;background:#f8f6ef;color:#40513b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">啵啵送来了${action}验证码，10 分钟内有效。</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8f6ef;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid #e7ebde;border-radius:28px;"><tr><td align="center" style="padding:32px 24px 28px;">
<p style="margin:0 0 20px;color:#82906e;font-size:12px;letter-spacing:3px;">一封来自啵啵的小信</p>
<img src="cid:bobo-mascot" width="88" height="88" alt="微笑的啵啵小球" style="display:block;width:88px;height:88px;border:0;border-radius:26px;">
<h1 style="margin:22px 0 10px;font-size:23px;line-height:1.5;font-weight:700;color:#40513b;">${title}</h1>
<p style="margin:0;font-size:14px;line-height:1.9;color:#7a8373;">${intro}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;background:#f0f4e6;border:1px solid #dce6c9;border-radius:20px;"><tr><td align="center" style="padding:23px 12px;">
<p style="margin:0 0 12px;font-size:12px;color:#78856a;">你的${action}验证码</p>
<p dir="ltr" style="margin:0;font-family:Consolas,Menlo,monospace;font-size:36px;line-height:1.4;font-weight:700;letter-spacing:6px;color:#526b3e;">${code}</p>
<p style="margin:12px 0 0;font-size:12px;line-height:1.8;color:#7a876d;">10 分钟内有效 · 只用一次的小暗号</p>
</td></tr></table>
<p style="margin:23px 0 0;font-size:13px;line-height:1.9;color:#788270;">回到啵啵，输入上面的小暗号就好。<br>请把它留给自己，不要转发给别人哦。</p>
<p style="margin:18px 0 0;font-size:12px;line-height:1.8;color:#949c8c;">如果不是你本人操作，忽略这封邮件就好。</p>
</td></tr></table>
<p style="margin:22px 0 5px;font-size:12px;line-height:1.8;color:#929b85;">把小事交给小球，把时间留给生活。</p>
<p style="margin:0;font-size:12px;color:#a4ac9a;">啵啵待办 · 陪你慢慢完成每一件小事</p>
</td></tr></table></body></html>`,
        attachments: [{ filename: 'bobo.png', path: require('path').join(__dirname, 'public/icon192.png'), cid: 'bobo-mascot', contentDisposition: 'inline' }]
    };
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
        const result = await transport.sendMail({ from: env.BOBO_MAIL_FROM, to, ...verificationMail(code, purpose) });
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
module.exports = { createMailer, createEmailCodes, normalizeEmail, verificationMail };
