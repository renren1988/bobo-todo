(() => {
    if (window.boboDesktop) {
        window.boboDevice = { ...window.boboDesktop, platform: 'windows' };
        return;
    }
    if (!window.BoboAndroid) return;
    let next = 1; const pending = new Map();
    window.__boboReply = (id, result) => {
        const entry = pending.get(id); if (!entry) return;
        pending.delete(id); clearTimeout(entry.timer);
        if (result.error) entry.reject(new Error(result.error)); else entry.resolve(result.value);
    };
    const call = (action, value) => new Promise((resolve, reject) => {
        const id = next++, timer = setTimeout(() => { pending.delete(id); reject(new Error('设备暂时没有响应，请重试')); }, 20000);
        pending.set(id, { resolve, reject, timer }); window.BoboAndroid.call(id, JSON.stringify({ action, value }));
    });
    window.boboDevice = {
        platform: 'android', getConnection: () => call('getConnection'),
        setConnection: value => call('setConnection', value), request: value => call('request', value),
        updateTasks: tasks => call('updateTasks', tasks).catch(() => {}),
        enableNotifications: () => call('enableNotifications'), checkAppUpdate: () => call('checkAppUpdate'), downloadAppUpdate: url => call('downloadAppUpdate', url), exportBackup: text => call('exportBackup', text)
    };
})();
