const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tensorDesktop", {
  request: (request) => ipcRenderer.invoke("tensor:request", request),
  tensorServeStatus: () => ipcRenderer.invoke("tensor-serve:status"),
  startTensorServe: (request) => ipcRenderer.invoke("tensor-serve:start", request),
  stopTensorServe: () => ipcRenderer.invoke("tensor-serve:stop"),
  kiwixCatalog: (request) => ipcRenderer.invoke("kiwix:catalog", request),
  downloadZim: (request) => ipcRenderer.invoke("kiwix:download-zim", request),
  browseLocalZims: () => ipcRenderer.invoke("local:browse-zims"),
  browseLocalZimFolder: () => ipcRenderer.invoke("local:browse-zim-folder"),
  chooseLocalFolder: () => ipcRenderer.invoke("local:choose-folder"),
  listLocalDirectory: (folderPath) => ipcRenderer.invoke("local:list-directory", folderPath),
  getLocalHomeDirectory: () => ipcRenderer.invoke("local:home-directory"),
  getLocalDownloadsDirectory: () => ipcRenderer.invoke("local:downloads-directory"),
  listVectorDatabases: (request) => ipcRenderer.invoke("vector:list-databases", request),
});
