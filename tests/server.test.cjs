const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sortTasks, shouldRemind, reminderKey } = require('../public/shared.js');
process.env.BOBO_DATA_DIR = fs.mkdtempSync(path.join(__dirname, '../artifacts/api-test-'));
const { server, db, reminders } = require('../server.cjs');
const webpush = require('web-push');

test('two devices share CRUD, default reminders, conflict handling and push scheduling', async t => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function api(route, method = 'GET', data, token = db.token) {
        const res = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
        return { status: res.status, value: await res.json() };
    }
    assert.equal((await api('/api/tasks', 'GET', null, 'wrong')).status, 401);
    assert.equal((await fetch(base + '/server.cjs')).status, 404);
    assert.equal((await fetch(base + '/.runtime/server/space.json')).status, 404);
    const created = await api('/api/tasks', 'POST', { title: '手机新建', due: new Date(Date.now() + 3600000).toISOString() });
    assert.equal(created.status, 201); assert.equal(created.value.reminder, 30);
    const task = created.value;
    assert.equal((await api('/api/tasks')).value.tasks[0].title, '手机新建');
    const changed = await api('/api/tasks/' + task.id, 'PUT', { ...task, title: '电脑修改', reminder: 15 });
    assert.equal(changed.status, 200); assert.equal(changed.value.revision, 2);
    assert.equal((await api('/api/tasks/' + task.id, 'PUT', { ...task, title: '过期修改' })).status, 409);
    assert.equal((await api('/api/tasks/' + task.id, 'DELETE', { revision: 1 })).status, 409);
    assert.equal((await api('/api/tasks')).value.tasks[0].title, '电脑修改');
    for (const bad of [{ title: ' ' }, { reminder: -1 }, { reminder: 0.1 }, { due: 'bad' }, { category: 'html' }, { done: 'false' }]) {
        assert.equal((await api('/api/tasks', 'POST', { title: 'invalid', ...bad })).status, 400);
    }
    assert.equal((await api('/api/push', 'POST', { endpoint: 'https://127.0.0.1/private', keys: { auth: 'x', p256dh: 'y' } })).status, 400);
    const now = Date.now();
    const due = { ...changed.value, due: new Date(now + 29 * 60000).toISOString(), reminder: 30 };
    await api('/api/tasks/' + due.id, 'PUT', due);
    let calls = [];
    webpush.sendNotification = async (sub, payload) => { calls.push({ sub, payload: JSON.parse(payload) }); };
    db.subscriptions.push({ endpoint: 'https://fcm.googleapis.com/fake-test', keys: {}, sent: {} });
    await reminders(); await reminders();
    assert.equal(calls.length, 1, 'each device is reminded only once for an unchanged deadline');
    assert.match(calls[0].payload.body, /电脑修改/);
    const current = (await api('/api/tasks')).value.tasks[0];
    const finished = await api('/api/tasks/' + current.id, 'PUT', { ...current, done: true });
    await reminders(); assert.equal(calls.length, 1, 'completed task must not notify');
    const result = await api('/api/tasks/' + current.id, 'DELETE', { revision: finished.value.revision });
    assert.equal(result.status, 200); assert.equal((await api('/api/tasks')).value.tasks.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.BOBO_DATA_DIR, 'space.json'))).tasks.length, 0);
});

test('deadline order, no deadline last, exact reminder boundary and edited schedules', () => {
    const now = Date.now();
    const a = { id: 'a', done: false, due: null, created: '2026-01-01', reminder: 30 };
    const b = { ...a, id: 'b', due: new Date(now + 31 * 60000).toISOString() };
    const c = { ...a, id: 'c', due: new Date(now + 30 * 60000).toISOString() };
    assert.deepEqual(sortTasks([a, b, c]).map(t => t.id), ['c', 'b', 'a']);
    assert.equal(shouldRemind(c, now - 1), false); assert.equal(shouldRemind(c, now), true);
    assert.equal(shouldRemind(b, now), false); assert.equal(shouldRemind(a, now), false);
    assert.equal(shouldRemind({ ...c, done: true }, now), false);
    assert.notEqual(reminderKey(c), reminderKey({ ...c, reminder: 15 }));
    assert.equal(shouldRemind({ ...c, reminder: 0 }, Date.parse(c.due) - 1), false);
    assert.equal(shouldRemind({ ...c, reminder: 0 }, Date.parse(c.due)), true);
});
