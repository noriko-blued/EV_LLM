const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSchools: () => ipcRenderer.invoke('get-schools'),
  selectPdf: () => ipcRenderer.invoke('select-pdf'),
  startAutomation: (payload) => ipcRenderer.invoke('start-automation', payload),
  stopAutomation: (payload) => ipcRenderer.invoke('stop-automation', payload),
  onLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('log', listener);
    return () => ipcRenderer.removeListener('log', listener);
  },
  onJobStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('job-status', listener);
    return () => ipcRenderer.removeListener('job-status', listener);
  }
});
