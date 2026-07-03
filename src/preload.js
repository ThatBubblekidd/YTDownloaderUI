const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytApp', {
  getStatus: (settings) => ipcRenderer.invoke('app:status', settings),
  pickFolder: () => ipcRenderer.invoke('app:pick-folder'),
  pickCookiesFile: () => ipcRenderer.invoke('app:pick-cookies-file'),
  search: (payload) => ipcRenderer.invoke('app:search', payload),
  getFormats: (payload) => ipcRenderer.invoke('app:formats', payload),
  download: (payload) => ipcRenderer.invoke('app:download', payload),
  cancelDownload: (id) => ipcRenderer.invoke('app:cancel-download', id),
  reveal: (filePath) => ipcRenderer.invoke('app:reveal', filePath),
  onProgress: (callback) => ipcRenderer.on('download:progress', (_event, payload) => callback(payload)),
  onLog: (callback) => ipcRenderer.on('download:log', (_event, payload) => callback(payload)),
  onComplete: (callback) => ipcRenderer.on('download:complete', (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on('download:error', (_event, payload) => callback(payload)),
});
