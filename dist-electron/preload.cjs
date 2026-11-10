const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("landerBridge", {
  checkStatus: () => ipcRenderer.invoke("lander:checkStatus"),
  saveConfig: (cfg) => ipcRenderer.invoke("lander:saveConfig", cfg),
  countSessions: (args) => ipcRenderer.invoke("lander:countSessions", args),
  extractSessions: (args) => ipcRenderer.invoke("lander:extractSessions", args),
  getLatestSessionId: () => ipcRenderer.invoke("lander:getLatestSessionId"),
  extractNewSessions: (args) => ipcRenderer.invoke("lander:extractNewSessions", args),
  // Auto-updater (GitHub Releases en segundo plano)
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadAndInstallUpdate: (downloadUrl, fileName, version, expectedBytes) =>
    ipcRenderer.invoke("updater:downloadAndInstall", { downloadUrl, fileName, version, expectedBytes }),
  openExternalUrl: (url) => ipcRenderer.invoke("updater:openExternal", url),
  onUpdateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("updater:downloadProgress", listener);
    return () => ipcRenderer.removeListener("updater:downloadProgress", listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("updater:downloaded", listener);
    return () => ipcRenderer.removeListener("updater:downloaded", listener);
  },
  onUpdateDownloadError: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("updater:downloadError", listener);
    return () => ipcRenderer.removeListener("updater:downloadError", listener);
  },
});

