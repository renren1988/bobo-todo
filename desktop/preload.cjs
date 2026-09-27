const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('boboDesktop', {
    getConnection: () => ipcRenderer.invoke('get-connection'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.send('install-update'),
    onUpdateStatus: callback => ipcRenderer.on('update-status', (_, state) => callback(state)),
    setConnection: value => ipcRenderer.invoke('set-connection', value),
    request: value => ipcRenderer.invoke('api-request', value),
    collapse: () => ipcRenderer.send('collapse'),
    updateTasks: tasks => ipcRenderer.send('tasks', tasks),
    enableNotifications: () => ipcRenderer.invoke('enable-notifications'),
    onDrop: callback => ipcRenderer.on('drop-text', (_, text) => callback(text)),
    open: () => ipcRenderer.send('open-panel'),
    dragStart: () => ipcRenderer.send('drag-start'),
    dragMove: () => ipcRenderer.send('drag-move'),
    dragEnd: () => ipcRenderer.send('drag-end'),
    drop: text => ipcRenderer.send('drop', text),
    onCount: callback => ipcRenderer.on('count', (_, count) => callback(count))
});
