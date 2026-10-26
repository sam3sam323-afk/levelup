const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("nexusBrowser", Object.freeze({
  goBack: () => ipcRenderer.invoke("nexus:browser:back"),
  goForward: () => ipcRenderer.invoke("nexus:browser:forward"),
  reload: () => ipcRenderer.invoke("nexus:browser:reload"),
  navigate: (address) => ipcRenderer.invoke("nexus:browser:navigate", address),
  panelState: (open) => ipcRenderer.send("nexus:browser:panel-state", Boolean(open)),
  inspectMedia: (id) => ipcRenderer.invoke("nexus:browser:inspect", id),
  downloadMedia: (request) => ipcRenderer.invoke("nexus:browser:download", request),
  openSupport: () => ipcRenderer.invoke("nexus:support:open"),
  onMediaCandidates: (callback) => subscribe("nexus:browser:candidates", callback),
  onPageState: (callback) => subscribe("nexus:browser:page-state", callback),
  onLanguage: (callback) => subscribe("nexus:browser:language", callback),
}));
