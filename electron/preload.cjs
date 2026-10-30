const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("landerBridge", {
  checkStatus: () => ipcRenderer.invoke("lander:checkStatus"),
  saveConfig: (cfg) => ipcRenderer.invoke("lander:saveConfig", cfg),
  countSessions: (args) => ipcRenderer.invoke("lander:countSessions", args),
  extractSessions: (args) => ipcRenderer.invoke("lander:extractSessions", args),
});

