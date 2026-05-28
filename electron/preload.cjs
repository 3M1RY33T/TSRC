const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tensorDesktop", {
  request: (request) => ipcRenderer.invoke("tensor:request", request),
  kiwixCatalog: (request) => ipcRenderer.invoke("kiwix:catalog", request),
  downloadZim: (request) => ipcRenderer.invoke("kiwix:download-zim", request),
});
