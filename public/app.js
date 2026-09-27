(async () => {
const $ = id => document.getElementById(id);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
let deviceConnection = null;
if (window.boboDevice) deviceConnection = await window.boboDevice.getConnection();
const oldToken = deviceConnection?.token || localStorage.getItem('bobo-token') || '';
const oldUrl = deviceConnection?.url || localStorage.getItem('bobo-url') || location.origin;
if (oldToken && !oldToken.startsWith('bb_') && oldUrl === 'https://bobo.taorenlove.live') localStorage.setItem('bobo-legacy-token', oldToken);
if (deviceConnection?.legacyToken) localStorage.setItem('bobo-legacy-token', deviceConnection.legacyToken);
if (!localStorage.getItem('bobo-account-migrated')) {
    const pending = [...read('bobo-local', []), ...(deviceConnection?.legacyTasks || []), ...(!oldToken.startsWith('bb_') && oldUrl !== 'https://bobo.taorenlove.live' ? deviceConnection?.tasks || read('bobo-cache', []) : [])];
    write('bobo-pending-import', pending);
    localStorage.setItem('bobo-account-migrated', '1');
}
let token = oldToken.startsWith('bb_') ? oldToken : '';
let apiBase = window.boboDevice ? 'https://bobo.taorenlove.live' : location.origin;
let account = read('bobo-account', null);
if (!token) account = null;
let tasks = token ? read('bobo-cache', []) : [];
if (token && Array.isArray(deviceConnection?.tasks)) tasks = deviceConnection.tasks;
let filter = 'all', completed = false, editing = null, online = !token, syncing = false, mutating = false;
let pushKey = '', pushEnabled = false, authMode = 'login', authBusy = false;
let sent = read('bobo-reminded', {});
const labels = { work: '工作', study: '学习', life: '生活' };
const iconPaths = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4M12 2v2"/>',
    sparkle: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',
    flower: '<path d="M12 9C5-4-2 10 9 12-4 19 10 26 12 15c7 13 14-1 3-3 13-7-1-14-3-3Z"/>',
    done: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 12 3 3 7-7"/>',
    settings: '<path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = name => `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = crypto.getRandomValues(new Uint8Array(1))[0] % 16; return (c === 'x' ? n : (n & 3) | 8).toString(16); });
const day = date => new Date(date).toLocaleDateString('en-CA');
const time = date => new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
function dateLabel(date) {
    if (!date) return '不着急，慢慢来';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    return `${day(date) === day(Date.now()) ? '今天' : day(date) === day(tomorrow) ? '明天' : new Date(date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', ...(new Date(date).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })} ${time(date)}`;
}
function relative(task) {
    if (task.done) return ['已完成', ''];
    if (!task.due) return ['留点余地', ''];
    const delta = Date.parse(task.due) - Date.now(), minutes = Math.ceil(Math.abs(delta) / 60000);
    if (delta < 0) return ['已逾期', 'overdue'];
    if (minutes < 60) return [`还有 ${minutes} 分钟`, 'urgent'];
    if (minutes < 1440) return [`还有 ${Math.floor(minutes / 60)} 小时`, minutes < 180 ? 'urgent' : ''];
    return [`还有 ${Math.floor(minutes / 1440)} 天`, ''];
}
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
function persist() { if (token) write('bobo-cache', tasks); }
async function api(route, method = 'GET', data, auth = token, url = apiBase) {
    if (window.boboDevice) return window.boboDevice.request({ route, method, data, token: auth, url });
    if (new URL(url).origin !== location.origin) throw new Error('网页版请直接打开待办空间的地址');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch('/api/' + route, { method, headers: { Authorization: 'Bearer ' + auth, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: controller.signal });
        const value = await response.json();
        if (!response.ok) throw Object.assign(new Error(value.error || '暂时无法同步'), { status: response.status });
        return value;
    } finally { clearTimeout(timer); }
}
function syncState() {
    $('sync-state').textContent = token ? online ? '账号已同步' : '暂时离线' : '登录你的啵啵';
    $('sync-detail').textContent = token ? online ? '同一账号，随时同步' : '保留清单，连接恢复后继续' : '手机和电脑，登录就能一起记';
    $('mode-label').textContent = token ? online ? '已登录 · 自动同步' : '离线 · 只读' : '登录 / 注册';
    document.body.classList.toggle('connected', !!token && online);
    $('auth-panel').hidden = !!token; $('account-panel').hidden = !token;
    $('account-name').textContent = account?.username || '我的啵啵账号';
    $('avatar-settings').textContent = account?.username?.slice(0, 1).toUpperCase() || '我';
    $('migration-panel').hidden = !(token && (localStorage.getItem('bobo-legacy-token') || read('bobo-pending-import', []).length));
}
function openSettings() { syncState(); $('auth-error').textContent = ''; $('settings-dialog').showModal(); }
function render() {
    const pending = tasks.filter(t => !t.done), today = pending.filter(t => t.due && day(t.due) === day(Date.now()));
    const done = tasks.filter(t => t.done), upcoming = pending.filter(t => t.due && new Date(t.due) > new Date() && day(t.due) !== day(Date.now()));
    for (const [id, count] of [['count-all', pending.length], ['count-today', today.length], ['count-upcoming', upcoming.length], ['count-done', done.length], ['orb-count', pending.length]]) $(id).textContent = count;
    $('stat-pending').innerHTML = `${pending.length} <em>件小事</em>`;
    $('stat-today').innerHTML = `${today.length} <em>件待办</em>`;
    $('stat-done').innerHTML = `${done.length} <em>件已完成</em>`;
    const list = Bobo.sortTasks(tasks).filter(t => t.done === completed && (filter === 'all' || filter === 'done' || filter === 'today' && t.due && day(t.due) === day(Date.now()) || filter === 'upcoming' && t.due && new Date(t.due) > new Date() && day(t.due) !== day(Date.now()) || t.category === filter));
    $('list-title').textContent = ({ all: '我的待办', today: '今天的事', upcoming: '即将到来', done: '完成的小事', work: '工作的小事', study: '学习的小事', life: '生活的小事' })[filter];
    $('list-count').textContent = `${list.length} 件`;
    $('tab-pending').classList.toggle('selected', !completed); $('tab-done').classList.toggle('selected', completed);
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    $('empty-state').hidden = !!list.length;
    $('empty-state').querySelector('h3').textContent = tasks.length ? completed ? '完成的小事，会在这里发光' : '这里暂时没有待办，歇一小会儿吧' : '把脑袋里的小事，放下来吧';
    $('empty-add').textContent = tasks.length ? '＋ 再记一件小事' : '＋ 添加第一件小事';
    $('task-list').innerHTML = list.map(t => {
        const [caption, className] = relative(t);
        return `<article class="task-row ${t.done ? 'done' : ''}" data-id="${esc(t.id)}"><button class="check" data-action="toggle" aria-label="${t.done ? '恢复' : '完成'} ${esc(t.title)}">${t.done ? '✓' : ''}</button><div class="task-content"><button class="task-title" data-action="edit">${esc(t.title)}</button><div class="task-meta"><span class="tag ${t.category}">${labels[t.category]}</span><span>${icon('clock')} ${dateLabel(t.due)}</span>${t.due ? `<span>${icon('bell')} 提前 ${t.reminder} 分钟</span>` : ''}</div></div><span class="due-label ${className}">${caption}</span><button class="task-menu" data-action="delete" aria-label="删除 ${esc(t.title)}" title="删除待办">×</button></article>`;
    }).join('');
    const next = Bobo.sortTasks(pending)[0];
    $('orb-next').textContent = next ? `${next.title} · ${dateLabel(next.due)}` : '小事都放下了，今天也可以慢慢来。';
    syncState();
    window.boboDevice?.updateTasks(tasks);
}
async function sync() {
    if (!token || syncing || mutating || authBusy) return;
    syncing = true;
    try { const data = await api('tasks'); tasks = data.tasks; pushKey = data.publicKey; online = true; persist(); render(); }
    catch (error) { online = false; if (error.status === 401 || /登录已失效|请登录账号/.test(error.message)) await clearAccount(); syncState(); }
    finally { syncing = false; }
}
async function mutation(method, task) {
    if (!token) throw new Error('请先登录账号');
    if (mutating || syncing) throw new Error('正在同步，请稍后再试');
    if (token && !online) throw new Error('暂时离线，连接恢复后就能修改啦');
    mutating = true;
    try {
        if (token) {
            const result = await api('tasks' + (method === 'POST' ? '' : '/' + task.id), method, task);
            if (method === 'POST') tasks.push(result);
            else if (method === 'DELETE') tasks = tasks.filter(t => t.id !== task.id);
            else tasks = tasks.map(t => t.id === task.id ? result : t);
        } else {
            if (method === 'POST') tasks.push({ ...task, id: uuid(), revision: 1, created: new Date().toISOString() });
            else if (method === 'DELETE') tasks = tasks.filter(t => t.id !== task.id);
            else tasks = tasks.map(t => t.id === task.id ? { ...task, revision: t.revision + 1 } : t);
        }
        persist(); render();
    } catch (error) { setTimeout(sync, 0); throw error; }
    finally { mutating = false; }
}
function openTask(task = null, text = '') {
    if (!token) { openSettings(); return; }
    editing = task;
    $('task-form').reset(); $('task-error').textContent = '';
    $('form-title').textContent = task ? '照顾一下这件小事' : '丢进一件小事';
    $('task-title').value = task?.title || text;
    $('task-category').value = task?.category || 'life'; $('task-reminder').value = task?.reminder ?? 30;
    if (task?.due) { const d = new Date(task.due); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); $('task-due').value = d.toISOString().slice(0, 16); }
    presets(); $('orb-popover').hidden = true; $('task-dialog').showModal(); $('task-title').focus();
}
function presets() { document.querySelectorAll('[data-minutes]').forEach(b => b.classList.toggle('chosen', Number(b.dataset.minutes) === Number($('task-reminder').value))); }
document.querySelectorAll('[data-minutes]').forEach(b => b.onclick = () => { $('task-reminder').value = b.dataset.minutes; presets(); });
$('task-reminder').oninput = presets;
['add-task', 'empty-add', 'orb-add'].forEach(id => $(id).onclick = () => openTask());
document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
['settings-open', 'sync-open', 'avatar-settings', 'mode-label'].forEach(id => $(id).onclick = openSettings);
$('task-form').onsubmit = async e => {
    e.preventDefault(); $('save-task').disabled = true;
    try {
        const title = $('task-title').value.trim(); if (!title) throw new Error('给这件小事起个名字吧');
        const task = { ...(editing || {}), title, category: $('task-category').value, due: $('task-due').value ? new Date($('task-due').value).toISOString() : null, reminder: Number($('task-reminder').value), done: editing?.done || false };
        await mutation(editing ? 'PUT' : 'POST', task); $('task-dialog').close(); toast(editing ? '已经记好新的安排啦' : '收到！这件小事就交给啵啵了 🌱'); checkReminders();
    } catch (error) { $('task-error').textContent = error.message; }
    finally { $('save-task').disabled = false; }
};
$('task-list').onclick = async e => {
    const button = e.target.closest('[data-action]'); if (!button) return;
    const task = tasks.find(t => t.id === button.closest('[data-id]').dataset.id); if (!task) return;
    try {
        if (button.dataset.action === 'edit') return openTask(task);
        if (button.dataset.action === 'delete') { if (!confirm(`要移除「${task.title}」吗？`)) return; await mutation('DELETE', task); toast('小事已移除'); }
        else { await mutation('PUT', { ...task, done: !task.done }); toast(task.done ? '重新放回待办了' : '又完成了一件，给自己一朵小花 ✿'); }
    } catch (error) { toast(error.message); }
};
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; completed = filter === 'done'; render(); });
$('tab-pending').onclick = () => { completed = false; if (filter === 'done') filter = 'all'; render(); };
$('tab-done').onclick = () => { completed = true; render(); };
function changeAuth(mode) {
    authMode = mode;
    $('confirm-field').hidden = mode === 'login'; $('auth-confirm').required = mode !== 'login';
    $('recover-field').hidden = mode !== 'recover'; $('auth-recovery').required = mode === 'recover';
    $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('password-label').textContent = mode === 'recover' ? '设置新密码' : '密码';
    $('auth-submit').textContent = ({login:'登录我的啵啵', register:'注册并开启小空间', recover:'恢复账号并登录'})[mode];
    $('auth-hint').textContent = mode === 'register' ? '注册后会生成恢复码，请保存，用于忘记密码时找回账号。' : mode === 'recover' ? '输入注册时保存的恢复码。重置后其他设备需要重新登录。' : '登录后，在另一台设备使用同一账号即可同步。';
    ['login','register','recover'].forEach(m => $('auth-' + m).classList.toggle('selected', m === mode));
    $('auth-error').textContent = '';
}
['login','register','recover'].forEach(mode => $('auth-' + mode).onclick = () => changeAuth(mode));
async function clearAccount() {
    token = ''; account = null; tasks = []; pushEnabled = false;
    localStorage.removeItem('bobo-token'); localStorage.removeItem('bobo-account'); localStorage.removeItem('bobo-cache');
    if (window.boboDevice) await window.boboDevice.setConnection(null);
    window.boboDevice?.updateTasks([]); render();
}
$('auth-form').onsubmit = async event => {
    event.preventDefault(); if (authBusy || syncing || mutating) return toast('正在同步，请稍后再试');
    authBusy = true; $('auth-submit').disabled = true; $('auth-error').textContent = '';
    try {
        if (authMode !== 'login' && $('auth-password').value !== $('auth-confirm').value) throw new Error('两次输入的密码不一致');
        const result = await api('auth/' + authMode, 'POST', { username: $('auth-username').value.trim(), password: $('auth-password').value, recoveryCode: $('auth-recovery').value.trim() }, '');
        if (window.boboDevice) await window.boboDevice.setConnection({ url: apiBase, token: result.token });
        token = result.token; account = result.user; tasks = []; online = true;
        localStorage.setItem('bobo-token', token); write('bobo-account', account); persist();
        $('auth-password').value = ''; $('auth-confirm').value = ''; $('auth-recovery').value = '';
        $('recovery-result').hidden = !result.recoveryCode; $('recovery-code').value = result.recoveryCode || '';
        render(); toast('欢迎回来，小事都在这里');
    } catch (error) { $('auth-error').textContent = error.message; }
    finally { authBusy = false; $('auth-submit').disabled = false; }
    await sync();
};
$('save-recovery').onclick = async () => {
    const text = `啵啵待办账号：${account.username}\n恢复码：${$('recovery-code').value}\n请私密保存，不要转发。`;
    if (window.boboDevice?.exportBackup) await window.boboDevice.exportBackup(text);
    else { const url = URL.createObjectURL(new Blob([text], { type:'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'bobo-recovery.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
};
$('migrate-legacy').onclick = async () => {
    if (syncing || mutating || authBusy) return toast('正在同步，请稍后再试');
    if (!confirm('把检测到的旧版待办导入当前账号「' + account.username + '」？')) return;
    authBusy = true; $('migrate-legacy').disabled = true;
    try {
        const legacyToken = localStorage.getItem('bobo-legacy-token');
        if (legacyToken) { await api('auth/migrate', 'POST', {legacyToken}); localStorage.removeItem('bobo-legacy-token'); }
        for (const task of read('bobo-pending-import', [])) {
            await api('tasks', 'POST', {...task, importId: task.id});
            write('bobo-pending-import', read('bobo-pending-import', []).filter(t => t.id !== task.id));
        }
        toast('旧版待办已导入'); $('migration-error').textContent = '';
    } catch (error) { $('migration-error').textContent = error.message; }
    finally { authBusy = false; $('migrate-legacy').disabled = false; }
    await sync();
};
$('disconnect').onclick = async () => {
    if (syncing || mutating || authBusy) return toast('正在同步，请稍后再试');
    authBusy = true;
    try {
        await api('auth/logout', 'POST', {});
        if (!window.boboDevice && 'serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); }
        await clearAccount(); $('recovery-result').hidden = true; $('recovery-code').value = ''; toast('已退出，待办仍保存在你的账号中');
    } catch (error) { toast('请联网后退出，以便停止此设备的账号通知：' + error.message); }
    finally { authBusy = false; }
};
$('export-data').onclick = async () => { if (window.boboDevice?.exportBackup) { await window.boboDevice.exportBackup(JSON.stringify({ exported: new Date().toISOString(), tasks }, null, 2)); return; } const url = URL.createObjectURL(new Blob([JSON.stringify({ exported: new Date().toISOString(), tasks }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `bobo-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
async function enableNotifications() {
    try {
        if (window.boboDevice) { const ok = await window.boboDevice.enableNotifications(); toast(window.boboDevice.platform === 'android' ? '请允许通知与闹钟权限，设置完成后回到啵啵' : ok ? '电脑系统提醒已开启，保持啵啵运行就好' : '这台电脑暂不支持系统通知'); return; }
        if (!('Notification' in window) || !window.isSecureContext) throw new Error('请使用 HTTPS 地址，或在电脑本机 localhost 上开启提醒');
        const permission = await Notification.requestPermission(); if (permission !== 'granted') throw new Error('请在浏览器的网站设置中允许通知');
        if (token && pushKey) {
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(pushKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) });
            await api('push', 'POST', sub.toJSON()); pushEnabled = true;
            $('push-status').textContent = '此设备已订阅后台推送。服务端需持续在线，通知也受系统权限、省电设置与网络影响。'; toast('后台提醒已开启 🌱');
        } else toast('页面提醒已开启；连接小空间后可开启后台推送');
    } catch (error) { $('push-status').textContent = error.message; toast(error.message); }
}
$('enable-push').onclick = enableNotifications; $('notification-button').onclick = enableNotifications;
async function checkUpdate() {
    const status = $('update-status');
    try {
        if (window.boboDevice?.platform === 'android') {
            const info = await window.boboDevice.checkAppUpdate();
            if (!info?.available) { status.textContent = `当前已是 Android 最新版 ${info?.version || ''}`; return; }
            status.textContent = `发现 Android 新版本 ${info.version}，正在准备下载…`;
            await window.boboDevice.downloadAppUpdate(info.url);
            status.textContent = '安装包已开始下载；下载完成后在通知栏点开安装。';
            return;
        }
        if (!window.boboDesktop) { status.textContent = '网页版请下载安装包更新。'; return; }
        const result = await window.boboDesktop.checkForUpdates();
        if (result.status === 'unsupported') { status.textContent = '请在 Windows 桌面版中检查更新。'; return; }
        if (result.status === 'downloaded') { if (confirm('新版本已下载，现在退出啵啵并开始安装？')) window.boboDesktop.installUpdate(); return; }
        if (result.status === 'downloading') { status.textContent = `正在下载：${result.percent}%`; return; }
        if (result.status === 'available') { status.textContent = `发现 Windows ${result.version}，正在下载…`; await window.boboDesktop.downloadUpdate(); return; }
        status.textContent = '正在检查更新…';
    } catch (error) { status.textContent = '检查更新失败：' + error.message; }
}
$('check-update').onclick = checkUpdate;
if (window.boboDesktop) window.boboDesktop.onUpdateStatus(state => {
    const status = $('update-status');
    if (state.status === 'checking') status.textContent = '正在检查 Windows 更新…';
    else if (state.status === 'latest') status.textContent = `当前已是 Windows 最新版 ${state.version}`;
    else if (state.status === 'available') status.textContent = `发现 Windows ${state.version}，点击“检查更新”开始下载。`;
    else if (state.status === 'downloading') status.textContent = `正在下载 Windows ${state.version}：${state.percent}%`;
    else if (state.status === 'downloaded') { status.textContent = `Windows ${state.version} 已下载完成，点击此处重启安装。`; status.onclick = () => { if (confirm('现在退出啵啵并开始安装？')) window.boboDesktop.installUpdate(); }; }
    else if (state.status === 'error') status.textContent = '更新失败：' + state.error;
});
async function checkReminders() {
    if (window.boboDevice || pushEnabled || token && !online) return;
    for (const task of tasks) {
        const key = Bobo.reminderKey(task); if (!Bobo.shouldRemind(task) || sent[key]) continue;
        sent[key] = Date.now(); write('bobo-reminded', sent);
        const body = `${task.title} · ${dateLabel(task.due)}截止`; toast('啵啵提醒你：' + body);
        if ('Notification' in window && Notification.permission === 'granted') {
            try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.showNotification('啵啵轻轻提醒你', { body, tag: key, icon: '/icon.svg' }); else new Notification('啵啵轻轻提醒你', { body, tag: key }); } catch { /* The in-page reminder above remains visible. */ }
        }
    }
}
const orb = $('floating-orb'); let drag = null, moved = false;
orb.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, left: orb.getBoundingClientRect().left, top: orb.getBoundingClientRect().top }; moved = false; orb.setPointerCapture(e.pointerId); };
orb.onpointermove = e => { if (!drag) return; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) moved = true; if (moved) { orb.style.left = Math.min(innerWidth - orb.offsetWidth, Math.max(0, drag.left + e.clientX - drag.x)) + 'px'; orb.style.top = Math.min(innerHeight - orb.offsetHeight, Math.max(0, drag.top + e.clientY - drag.y)) + 'px'; orb.style.right = 'auto'; orb.style.bottom = 'auto'; } };
orb.onpointerup = () => { drag = null; };
orb.onpointercancel = () => { drag = null; moved = true; };
orb.onclick = () => { if (!moved) $('orb-popover').hidden = !$('orb-popover').hidden; };
orb.ondragover = e => { e.preventDefault(); };
orb.ondrop = e => { e.preventDefault(); openTask(null, e.dataTransfer.getData('text/plain').slice(0, 200)); };
$('orb-close').onclick = () => $('orb-popover').hidden = true;
window.addEventListener('resize', () => { orb.style.left = ''; orb.style.top = ''; orb.style.right = ''; orb.style.bottom = ''; });
if (window.boboDesktop) { document.body.classList.add('desktop-panel'); $('desktop-collapse').hidden = false; $('desktop-collapse').onclick = () => window.boboDesktop.collapse(); window.boboDesktop.onDrop(text => openTask(null, text)); }
$('today-label').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
document.querySelectorAll('.spark,.space-label>span,.list-footnote>span').forEach(el => el.innerHTML = icon('sparkle'));
document.querySelector('.heading-flower').innerHTML = icon('flower');
document.querySelector('[data-filter="done"]>span').innerHTML = icon('done');
$('notification-button').innerHTML = icon('bell');
$('settings-open').innerHTML = icon('settings') + '<span>空间设置</span>';
if (!window.boboDevice && 'serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').then(async reg => { pushEnabled = !!(token && await reg.pushManager.getSubscription()); }).catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); checkReminders(); } });
window.addEventListener('online', sync);
window.addEventListener('storage', e => { if (e.key === 'bobo-token') location.reload(); });
if (window.boboDevice) {
    $('install-links').hidden = true;
    $('push-status').textContent = window.boboDevice.platform === 'android' ? '允许通知与闹钟权限后，已同步的事项由 Android 提醒；后台同步可能受省电设置影响。' : '小球运行期间会通过 Windows 系统通知提醒，关闭清单不会退出小球。';
}
if (!token && window.boboDevice) await window.boboDevice.setConnection(null);
render(); await sync(); checkReminders();
if (token && !account) { try { const info = await api('auth/me'); account = info.user; write('bobo-account', account); syncState(); } catch {} }
setInterval(sync, 5000); setInterval(checkReminders, 10000); setInterval(render, 60000);

})().catch(error => { console.error(error); document.getElementById("toast").hidden = false; document.getElementById("toast").textContent = "启动遇到问题：" + error.message; });
