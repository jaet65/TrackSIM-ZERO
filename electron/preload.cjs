const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("landerBridge", {
  checkStatus: () => ipcRenderer.invoke("lander:checkStatus"),
  saveConfig: (cfg) => ipcRenderer.invoke("lander:saveConfig", cfg),
  countSessions: (args) => ipcRenderer.invoke("lander:countSessions", args),
  extractSessions: (args) => ipcRenderer.invoke("lander:extractSessions", args),
  // Auto-updater (GitHub Releases)
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadAndInstallUpdate: (downloadUrl, fileName) =>
    ipcRenderer.invoke("updater:downloadAndInstall", { downloadUrl, fileName }),
  openExternalUrl: (url) => ipcRenderer.invoke("updater:openExternal", url),
  onUpdateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("updater:downloadProgress", listener);
    return () => ipcRenderer.removeListener("updater:downloadProgress", listener);
  },
});


