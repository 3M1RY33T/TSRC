const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
let tensorServeProcess = null;
let tensorServeExit = null;
const tensorServeLogs = [];

function addTensorServeLog(chunk) {
  const line = String(chunk ?? "").trim();
  if (!line) return;
  tensorServeLogs.push(line);
  if (tensorServeLogs.length > 80) tensorServeLogs.shift();
}

function getTensorServeStatus() {
  return {
    running: Boolean(tensorServeProcess && tensorServeExit === null),
    pid: tensorServeProcess?.pid ?? null,
    exitCode: tensorServeExit,
    logs: tensorServeLogs.slice(-12),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopHostedTensorServe() {
  if (!tensorServeProcess || tensorServeExit !== null) {
    return getTensorServeStatus();
  }

  const pid = tensorServeProcess.pid;
  addTensorServeLog("Stopping Tensor Serve...");

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"]);
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      tensorServeProcess.kill("SIGTERM");
    } catch {
      // Process may already be gone.
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (tensorServeExit !== null) return getTensorServeStatus();
    await sleep(100);
  }

  try {
    if (process.platform !== "win32") {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Process may already be gone.
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (tensorServeExit !== null) return getTensorServeStatus();
    await sleep(100);
  }

  return getTensorServeStatus();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    title: "TSRC",
    backgroundColor: "#eef0ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(devServerUrl).catch((error) => {
      console.error("[electron] Failed to load dev server:", error);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html")).catch((error) => {
      console.error("[electron] Failed to load built app:", error);
    });
  }

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error("[electron] did-fail-load", { code, description, url });
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[electron] render-process-gone", details);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("tensor:request", async (_event, request) => {
  const baseUrl = String(request.baseUrl ?? "").replace(/\/+$/, "");
  const pathName = String(request.path ?? "");

  if (!baseUrl || !pathName.startsWith("/")) {
    throw new Error("Invalid Tensor Serve request.");
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
    method: request.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(request.headers ?? {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: text,
  };
});

ipcMain.handle("tensor-serve:status", async () => getTensorServeStatus());

ipcMain.handle("tensor-serve:start", async (_event, request) => {
  if (tensorServeProcess && tensorServeExit === null) {
    return getTensorServeStatus();
  }

  const command = String(request?.command ?? "").trim();
  const cwd = String(request?.cwd ?? "").trim();

  if (!command) {
    throw new Error("Tensor Serve launch command is required.");
  }

  if (cwd && (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())) {
    throw new Error("Tensor Serve working directory does not exist.");
  }

  tensorServeExit = null;
  tensorServeLogs.length = 0;
  addTensorServeLog(`$ ${command}`);

  tensorServeProcess = spawn(command, {
    cwd: cwd || process.cwd(),
    detached: true,
    shell: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
  });

  tensorServeProcess.stdout?.on("data", addTensorServeLog);
  tensorServeProcess.stderr?.on("data", addTensorServeLog);
  tensorServeProcess.on("error", (error) => {
    tensorServeExit = -1;
    addTensorServeLog(error.message);
  });
  tensorServeProcess.on("exit", (code, signal) => {
    tensorServeExit = code ?? -1;
    addTensorServeLog(`Tensor Serve exited${signal ? ` (${signal})` : ""}.`);
  });

  return getTensorServeStatus();
});

ipcMain.handle("tensor-serve:stop", async () => {
  return stopHostedTensorServe();
});

const KIWIX_CATALOG_BASE = "https://opds.library.kiwix.org";

function textBetween(source, tagName) {
  const match = source.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
}

function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1]?.replace(/&amp;/g, "&") ?? "";
}

function parseCatalog(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const entry = match[1];
    const id = textBetween(entry, "id").replace(/^urn:uuid:/, "");
    const acquisitionLink =
      [...entry.matchAll(/<link\b[^>]*>/gi)]
        .map((linkMatch) => linkMatch[0])
        .find((link) => link.includes("opds-spec.org/acquisition")) ?? "";
    const previewLink =
      [...entry.matchAll(/<link\b[^>]*>/gi)]
        .map((linkMatch) => linkMatch[0])
        .find((link) => link.includes('type="text/html"')) ?? "";

    return {
      id,
      title: textBetween(entry, "title"),
      summary: textBetween(entry, "summary"),
      language: textBetween(entry, "language"),
      name: textBetween(entry, "name"),
      category: textBetween(entry, "category"),
      tags: textBetween(entry, "tags"),
      updated: textBetween(entry, "updated"),
      issued: textBetween(entry, "dc:issued"),
      articleCount: Number(textBetween(entry, "articleCount") || 0),
      mediaCount: Number(textBetween(entry, "mediaCount") || 0),
      downloadUrl: attr(acquisitionLink, "href"),
      sizeBytes: Number(attr(acquisitionLink, "length") || 0),
      previewUrl: attr(previewLink, "href"),
    };
  });

  return {
    totalResults: Number(textBetween(xml, "totalResults") || entries.length),
    entries,
  };
}

ipcMain.handle("kiwix:catalog", async (_event, request) => {
  const params = new URLSearchParams();
  params.set("count", String(request.count ?? 25));
  params.set("start", String(request.start ?? 0));

  if (request.query) params.set("q", request.query);
  if (request.language) params.set("lang", request.language);
  if (request.category) params.set("category", request.category);

  const response = await fetch(`${KIWIX_CATALOG_BASE}/catalog/v2/entries?${params}`);
  const xml = await response.text();

  if (!response.ok) {
    throw new Error(`Kiwix catalog returned ${response.status}: ${xml.slice(0, 160)}`);
  }

  return parseCatalog(xml);
});

async function resolveZimDownloadUrl(url) {
  if (!url.endsWith(".meta4")) return url;

  const response = await fetch(url);
  const xml = await response.text();

  if (!response.ok) {
    throw new Error(`Unable to resolve metalink ${response.status}`);
  }

  const urls = [...xml.matchAll(/<url[^>]*>([\s\S]*?)<\/url>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  return urls.find((candidate) => candidate.endsWith(".zim")) ?? url.replace(/\.meta4$/, "");
}

ipcMain.handle("kiwix:download-zim", async (_event, request) => {
  const sourceUrl = await resolveZimDownloadUrl(String(request.downloadUrl));
  const fileName =
    path.basename(new URL(sourceUrl).pathname) ||
    `${String(request.name ?? "kiwix-archive").replace(/[^a-z0-9._-]+/gi, "_")}.zim`;
  const requestedDownloadDir = String(request.downloadDir ?? "").trim();
  const downloadDir = requestedDownloadDir || app.getPath("downloads");
  const destination = path.join(downloadDir, fileName);

  await mkdir(downloadDir, { recursive: true });

  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));

  return {
    path: destination,
    fileName,
    sizeBytes: Number(response.headers.get("content-length") ?? request.sizeBytes ?? 0),
    sourceUrl,
  };
});

ipcMain.handle("local:browse-zims", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select local ZIM files",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "ZIM archives", extensions: ["zim"] }],
  });

  if (result.canceled) return [];

  return result.filePaths.map((filePath) => {
    const stats = fs.statSync(filePath);
    return {
      path: filePath,
      fileName: path.basename(filePath),
      sizeBytes: stats.size,
    };
  });
});

function findZimFiles(folderPath) {
  const files = [];
  const pending = [folderPath];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".zim")) {
        const stats = fs.statSync(entryPath);
        files.push({
          path: entryPath,
          fileName: entry.name,
          sizeBytes: stats.size,
        });
      }
    }
  }

  return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

ipcMain.handle("local:browse-zim-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Browse local ZIM folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { folderPath: "", files: [] };
  }

  const folderPath = result.filePaths[0];
  return {
    folderPath,
    files: findZimFiles(folderPath),
  };
});

function listDirectory(folderPath) {
  const entries = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        return [
          {
            type: "directory",
            name: entry.name,
            path: entryPath,
          },
        ];
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".zim")) {
        const stats = fs.statSync(entryPath);
        return [
          {
            type: "zim",
            name: entry.name,
            path: entryPath,
            sizeBytes: stats.size,
          },
        ];
      }

      return [];
    });

  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  const parentPath = path.dirname(folderPath);

  return {
    currentPath: folderPath,
    parentPath: parentPath === folderPath ? null : parentPath,
    entries,
  };
}

ipcMain.handle("local:choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose local folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  return result.filePaths[0];
});

ipcMain.handle("local:list-directory", async (_event, folderPath) => {
  const targetPath = String(folderPath ?? "");

  if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    throw new Error("Choose a valid folder.");
  }

  return listDirectory(targetPath);
});

ipcMain.handle("local:home-directory", async () => app.getPath("home"));

ipcMain.handle("local:downloads-directory", async () => app.getPath("downloads"));

function collectVectorDatabasesFrom(rootPath, databases, visited, depth = 0) {
  if (!rootPath || visited.has(rootPath) || depth > 3) return;
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) return;

  visited.add(rootPath);

  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      if (!["node_modules", "dist", ".git", "__pycache__"].includes(entry.name)) {
        collectVectorDatabasesFrom(entryPath, databases, visited, depth + 1);
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".index")) continue;

    const baseName = entry.name.slice(0, -".index".length);
    const pklPath = path.join(rootPath, `${baseName}.pkl`);
    if (!fs.existsSync(pklPath)) continue;

    const indexStats = fs.statSync(entryPath);
    const pklStats = fs.statSync(pklPath);
    const bm25Path = path.join(rootPath, `${baseName}.bm25`);
    const dbPath = path.join(rootPath, baseName);

    databases.set(dbPath, {
      name: baseName,
      path: dbPath,
      hasBm25: fs.existsSync(bm25Path),
      sizeBytes: indexStats.size + pklStats.size,
      updatedMs: Math.max(indexStats.mtimeMs, pklStats.mtimeMs),
    });
  }
}

ipcMain.handle("vector:list-databases", async (_event, request = {}) => {
  const cwd = process.cwd();
  const appPath = app.getAppPath();
  const roots = new Set();
  const addRoot = (candidate) => {
    if (!candidate) return;
    const resolved = path.resolve(String(candidate));
    if (!fs.existsSync(resolved)) return;
    roots.add(fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved));
  };

  addRoot(cwd);
  addRoot(path.dirname(cwd));
  addRoot(appPath);
  addRoot(path.dirname(appPath));
  addRoot(app.getPath("userData"));
  addRoot(path.join(path.dirname(cwd), "Tensor", "tensor-serve"));
  addRoot(path.join(path.dirname(appPath), "Tensor", "tensor-serve"));

  for (const candidate of request.roots ?? []) {
    addRoot(candidate);
  }

  const databases = new Map();
  const visited = new Set();
  for (const root of roots) {
    collectVectorDatabasesFrom(root, databases, visited);
  }

  return [...databases.values()].sort((left, right) => right.updatedMs - left.updatedMs);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (tensorServeProcess && tensorServeExit === null) {
    void stopHostedTensorServe();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
