const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("nexusDesktop", Object.freeze({
  isElectron: true,
  platform: process.platform,
  openBrowser: (language) => ipcRenderer.invoke("nexus:browser:open", language),
  openDownload: (id, action) => ipcRenderer.invoke("nexus:download:open", { id, action }),
  openSupport: () => ipcRenderer.invoke("nexus:support:open"),
  checkForUpdates: () => ipcRenderer.invoke("nexus:update:check"),
  installUpdate: () => ipcRenderer.invoke("nexus:update:install"),
  onUpdateStatus: (callback) => subscribe("nexus:update:status", callback),
}));
