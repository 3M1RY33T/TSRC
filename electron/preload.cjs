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
  showBrowserView: (request) => ipcRenderer.invoke("browser-view:show", request),
  setBrowserViewBounds: (bounds) => ipcRenderer.invoke("browser-view:set-bounds", bounds),
  hideBrowserView: () => ipcRenderer.invoke("browser-view:hide"),
  navigateBrowserView: (url) => ipcRenderer.invoke("browser-view:navigate", url),
  browserGoBack: () => ipcRenderer.invoke("browser-view:back"),
  browserGoForward: () => ipcRenderer.invoke("browser-view:forward"),
  browserReload: () => ipcRenderer.invoke("browser-view:reload"),
  browserStop: () => ipcRenderer.invoke("browser-view:stop"),
  browserOpenExternal: (url) => ipcRenderer.invoke("browser-view:open-external", url),
  onBrowserViewState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("browser-view:state", listener);
    return () => ipcRenderer.removeListener("browser-view:state", listener);
  },
  listNativeDownloads: () => ipcRenderer.invoke("downloads:list-native"),
  onNativeDownloads: (callback) => {
    const listener = (_event, tasks) => callback(tasks);
    ipcRenderer.on("downloads:state", listener);
    return () => ipcRenderer.removeListener("downloads:state", listener);
  },
  startZimitCapture: (request) => ipcRenderer.invoke("zimit:start", request),
  cancelZimitCapture: (id) => ipcRenderer.invoke("zimit:cancel", id),
});
