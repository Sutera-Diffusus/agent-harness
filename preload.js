const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('harness', {
  listClis: () => ipcRenderer.invoke('clis:list'),
  createPty: (paneId, cliId, cmd, args, cwd, record, cols, rows) => ipcRenderer.invoke('pty:create', paneId, cliId, cmd, args, cwd, record, cols, rows),
  input: (paneId, data) => ipcRenderer.send('pty:input', paneId, data),
  resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
  kill: (paneId) => ipcRenderer.send('pty:kill', paneId),
  onData: (cb) => ipcRenderer.on('pty:data', (e, id, d) => cb(id, d)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (e, id, code) => cb(id, code)),
  listHistory: () => ipcRenderer.invoke('hist:list'),
  listQuota: () => ipcRenderer.invoke('quota:list'),
  pickDir: () => ipcRenderer.invoke('pick:dir'),
  gitBranches: (cwds) => ipcRenderer.invoke('git:branches', cwds),
  projectMenu: (payload) => ipcRenderer.invoke('menu:project', payload),
  onMenuLaunch: (cb) => ipcRenderer.on('menu:launch', (e, p) => cb(p)),
  recList: () => ipcRenderer.invoke('rec:list'),
  recRead: (file) => ipcRenderer.invoke('rec:read', file),
  platform: process.platform,
});
