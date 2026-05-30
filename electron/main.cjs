const { app, BrowserView, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
let tensorServeProcess = null;
let tensorServeExit = null;
let tensorServeShutdownPromise = null;
let isQuittingAfterTensorServeShutdown = false;
const tensorServeLogs = [];
let mainWindow = null;
let browserView = null;
const browserState = {
  url: "https://www.wikipedia.org",
  title: "Web browser",
  loading: false,
  canGoBack: false,
  canGoForward: false,
};
const nativeDownloadTasks = new Map();
const kiwixDownloadTasks = new Map();
const zimitTasks = new Map();
const zimitProcesses = new Map();
const downloadSessions = new WeakSet();
const DESKTOP_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ZIMIT_IMAGE = "ghcr.io/openzim/zimit";

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

function isHostedTensorServeRunning() {
  return Boolean(tensorServeProcess && tensorServeExit === null);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeBrowserBounds(bounds = {}) {
  return {
    x: Math.max(0, Math.round(Number(bounds.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds.y) || 0)),
    width: Math.max(0, Math.round(Number(bounds.width) || 0)),
    height: Math.max(0, Math.round(Number(bounds.height) || 0)),
  };
}

function sendBrowserState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("browser-view:state", { ...browserState });
}

function sendDownloadState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("downloads:state", [
    ...nativeDownloadTasks.values(),
    ...kiwixDownloadTasks.values(),
    ...zimitTasks.values(),
  ]);
}

function getUniqueDownloadPath(fileName) {
  const downloadsDirectory = app.getPath("downloads");
  const parsed = path.parse(fileName || "download");
  const baseName = parsed.name || "download";
  const extension = parsed.ext || "";
  let candidate = path.join(downloadsDirectory, `${baseName}${extension}`);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsDirectory, `${baseName} (${index})${extension}`);
    index += 1;
  }

  return candidate;
}

function splitCommandArgs(value) {
  const args = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of String(value ?? "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

function toSafeZimName(value, fallback = "website-capture") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function newestZimFile(outputDir, startedAtMs, preferredName) {
  const files = findZimFiles(outputDir)
    .map((file) => ({
      ...file,
      mtimeMs: fs.statSync(file.path).mtimeMs,
    }))
    .filter((file) => file.mtimeMs >= startedAtMs - 2000)
    .sort((left, right) => {
      const leftPreferred = left.fileName.includes(preferredName) ? 1 : 0;
      const rightPreferred = right.fileName.includes(preferredName) ? 1 : 0;
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
      return right.mtimeMs - left.mtimeMs;
    });

  return files[0] ?? null;
}

function updateZimitTask(id, patch) {
  const existing = zimitTasks.get(id);
  if (!existing) return;
  zimitTasks.set(id, { ...existing, ...patch });
  sendDownloadState();
}

function updateKiwixDownloadTask(id, patch) {
  const existing = kiwixDownloadTasks.get(id);
  if (!existing) return;
  kiwixDownloadTasks.set(id, { ...existing, ...patch });
  sendDownloadState();
}

function appendZimitLog(id, chunk) {
  const text = String(chunk ?? "").trim();
  if (!text) return;
  const existing = zimitTasks.get(id);
  if (!existing) return;
  const logs = [...(existing.logs ?? []), ...text.split(/\r?\n/).filter(Boolean)].slice(-18);
  zimitTasks.set(id, { ...existing, logs });
  sendDownloadState();
}

async function stopZimitTask(id) {
  const processInfo = zimitProcesses.get(id);
  if (!processInfo) return;

  updateZimitTask(id, { status: "failed", error: "Capture cancelled." });

  try {
    if (processInfo.containerName) {
      spawn("docker", ["stop", processInfo.containerName], { stdio: "ignore" });
    }
  } catch {
    // The container may already be gone.
  }

  try {
    processInfo.process.kill("SIGTERM");
  } catch {
    // The docker process may already be gone.
  }
}

function watchDownloads(session) {
  if (!session || downloadSessions.has(session)) return;
  downloadSessions.add(session);

  session.on("will-download", (_event, item) => {
    const id = `web:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const fileName = item.getFilename() || "download";
    const destination = getUniqueDownloadPath(fileName);
    item.setSavePath(destination);

    nativeDownloadTasks.set(id, {
      id,
      title: fileName,
      fileName,
      path: destination,
      status: "downloading",
      sourceUrl: item.getURL(),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
    });
    sendDownloadState();

    item.on("updated", (_updateEvent, state) => {
      const task = nativeDownloadTasks.get(id);
      if (!task) return;

      nativeDownloadTasks.set(id, {
        ...task,
        status: state === "interrupted" ? "failed" : "downloading",
        error: state === "interrupted" ? "Download interrupted." : undefined,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
      sendDownloadState();
    });

    item.once("done", (_doneEvent, state) => {
      const task = nativeDownloadTasks.get(id);
      if (!task) return;

      nativeDownloadTasks.set(id, {
        ...task,
        status: state === "completed" ? "ready" : "failed",
        error: state === "completed" ? undefined : `Download ${state}.`,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        path: item.getSavePath() || destination,
      });
      sendDownloadState();
    });
  });
}

function updateBrowserState(patch = {}) {
  Object.assign(browserState, patch);

  if (browserView && !browserView.webContents.isDestroyed()) {
    browserState.canGoBack = browserView.webContents.canGoBack();
    browserState.canGoForward = browserView.webContents.canGoForward();
    browserState.url = browserView.webContents.getURL() || browserState.url;
  }

  sendBrowserState();
}

function createBrowserView() {
  if (browserView) return browserView;

  browserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  browserView.webContents.setUserAgent(DESKTOP_BROWSER_USER_AGENT);
  watchDownloads(browserView.webContents.session);
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  browserView.webContents.on("did-start-loading", () => updateBrowserState({ loading: true }));
  browserView.webContents.on("did-stop-loading", () => {
    updateBrowserState({
      loading: false,
      title: browserView.webContents.getTitle() || browserState.title,
    });
  });
  browserView.webContents.on("did-navigate", (_event, url) => updateBrowserState({ url }));
  browserView.webContents.on("did-navigate-in-page", (_event, url) => updateBrowserState({ url }));
  browserView.webContents.on("page-title-updated", (_event, title) => {
    updateBrowserState({ title });
  });
  browserView.webContents.on("did-fail-load", (_event, _code, description, url) => {
    updateBrowserState({
      loading: false,
      url: url || browserState.url,
      title: description || browserState.title,
    });
  });

  return browserView;
}

async function stopHostedTensorServe() {
  if (!isHostedTensorServeRunning()) {
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

function stopHostedTensorServeOnce() {
  if (!isHostedTensorServeRunning()) {
    return Promise.resolve(getTensorServeStatus());
  }

  if (!tensorServeShutdownPromise) {
    tensorServeShutdownPromise = stopHostedTensorServe().finally(() => {
      tensorServeShutdownPromise = null;
    });
  }

  return tensorServeShutdownPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.on("closed", () => {
    for (const id of zimitProcesses.keys()) {
      void stopZimitTask(id);
    }
    browserView?.webContents.destroy();
    browserView = null;
    mainWindow = null;
  });
}

ipcMain.handle("browser-view:show", async (_event, request = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Browser window is not ready.");
  }

  const view = createBrowserView();
  const bounds = sanitizeBrowserBounds(request.bounds);

  if (bounds.width > 0 && bounds.height > 0) {
    view.setBounds(bounds);
    view.setAutoResize({ width: true, height: true });
  }

  mainWindow.setBrowserView(view);

  const requestedUrl = String(request.url ?? browserState.url).trim();
  if (requestedUrl && requestedUrl !== view.webContents.getURL()) {
    browserState.url = requestedUrl;
    await view.webContents.loadURL(requestedUrl);
  }

  updateBrowserState();
  return { ...browserState };
});

ipcMain.handle("browser-view:set-bounds", async (_event, bounds) => {
  if (!browserView) return { ...browserState };

  const nextBounds = sanitizeBrowserBounds(bounds);
  if (nextBounds.width > 0 && nextBounds.height > 0) {
    browserView.setBounds(nextBounds);
  }

  return { ...browserState };
});

ipcMain.handle("browser-view:hide", async () => {
  if (mainWindow && browserView && !mainWindow.isDestroyed()) {
    mainWindow.removeBrowserView(browserView);
  }

  return { ...browserState };
});

ipcMain.handle("browser-view:navigate", async (_event, url) => {
  const view = createBrowserView();
  const nextUrl = String(url ?? "").trim();
  if (!nextUrl) return { ...browserState };

  browserState.url = nextUrl;
  await view.webContents.loadURL(nextUrl);
  updateBrowserState();
  return { ...browserState };
});

ipcMain.handle("browser-view:back", async () => {
  if (browserView?.webContents.canGoBack()) browserView.webContents.goBack();
  updateBrowserState();
  return { ...browserState };
});

ipcMain.handle("browser-view:forward", async () => {
  if (browserView?.webContents.canGoForward()) browserView.webContents.goForward();
  updateBrowserState();
  return { ...browserState };
});

ipcMain.handle("browser-view:reload", async () => {
  browserView?.webContents.reload();
  updateBrowserState();
  return { ...browserState };
});

ipcMain.handle("browser-view:stop", async () => {
  browserView?.webContents.stop();
  updateBrowserState({ loading: false });
  return { ...browserState };
});

ipcMain.handle("browser-view:open-external", async (_event, url) => {
  const targetUrl = String(url ?? browserState.url).trim();
  if (targetUrl) await shell.openExternal(targetUrl);
  return { ...browserState };
});

ipcMain.handle("downloads:list-native", async () => {
  return [...nativeDownloadTasks.values(), ...kiwixDownloadTasks.values(), ...zimitTasks.values()];
});

ipcMain.handle("zimit:start", async (_event, request = {}) => {
  const seedUrl = String(request.seedUrl ?? browserState.url ?? "").trim();
  if (!seedUrl) throw new Error("Choose a website URL to capture.");

  const outputDir = String(request.outputDir ?? "").trim() || path.join(app.getPath("downloads"), "TSRC Zimit");
  await mkdir(outputDir, { recursive: true });

  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    throw new Error("Choose a valid Zimit output folder.");
  }

  const id = `zimit:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const name = toSafeZimName(request.name, new URL(seedUrl).hostname || "website-capture");
  const containerName = `tsrc-zimit-${id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const startedAtMs = Date.now();
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--shm-size=1gb",
    "-v",
    `${outputDir}:/output`,
  ];

  if (request.disableAdBlocking) {
    args.push("--entrypoint", "");
  }

  args.push(String(request.image || ZIMIT_IMAGE), "zimit", "--seeds", seedUrl, "--name", name, "--output", "/output");

  if (request.pageLimit) args.push("--pageLimit", String(request.pageLimit));
  if (request.workers) args.push("--workers", String(request.workers));
  if (request.waitUntil) args.push("--waitUntil", String(request.waitUntil));
  if (request.keep) args.push("--keep");

  for (const pattern of request.scopeExcludeRx ?? []) {
    const trimmed = String(pattern ?? "").trim();
    if (trimmed) args.push("--scopeExcludeRx", trimmed);
  }

  args.push(...splitCommandArgs(request.extraArgs));

  zimitTasks.set(id, {
    id,
    title: `Zimit: ${name}`,
    fileName: `${name}.zim`,
    status: "downloading",
    path: outputDir,
    sourceUrl: seedUrl,
    receivedBytes: 0,
    logs: [`docker ${args.join(" ")}`],
  });
  sendDownloadState();

  const dockerProcess = spawn("docker", args, {
    cwd: outputDir,
    env: process.env,
  });

  zimitProcesses.set(id, { process: dockerProcess, containerName });

  dockerProcess.stdout?.on("data", (chunk) => appendZimitLog(id, chunk));
  dockerProcess.stderr?.on("data", (chunk) => appendZimitLog(id, chunk));
  dockerProcess.on("error", (error) => {
    zimitProcesses.delete(id);
    updateZimitTask(id, {
      status: "failed",
      error:
        error.code === "ENOENT"
          ? "Docker was not found. Install or start Docker Desktop, then try again."
          : error.message,
    });
  });
  dockerProcess.on("exit", (code, signal) => {
    zimitProcesses.delete(id);

    if (code === 0) {
      const zimFile = newestZimFile(outputDir, startedAtMs, name);
      updateZimitTask(id, {
        status: zimFile ? "ready" : "failed",
        path: zimFile?.path ?? outputDir,
        fileName: zimFile?.fileName ?? `${name}.zim`,
        error: zimFile ? undefined : "Zimit finished, but no new ZIM file was found.",
        receivedBytes: zimFile?.sizeBytes,
        totalBytes: zimFile?.sizeBytes,
      });
      return;
    }

    updateZimitTask(id, {
      status: "failed",
      error: signal ? `Zimit stopped with ${signal}.` : `Zimit exited with code ${code}.`,
    });
  });

  return zimitTasks.get(id);
});

ipcMain.handle("zimit:cancel", async (_event, id) => {
  await stopZimitTask(String(id ?? ""));
  return zimitTasks.get(String(id ?? "")) ?? null;
});

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
  return stopHostedTensorServeOnce();
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
  const taskId = String(request.taskId ?? `kiwix:${sourceUrl}`);

  await mkdir(downloadDir, { recursive: true });

  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with ${response.status} ${response.statusText}`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? request.sizeBytes ?? 0);
  let receivedBytes = 0;
  let lastProgressAt = 0;

  kiwixDownloadTasks.set(taskId, {
    id: taskId,
    title: String(request.title ?? request.name ?? fileName),
    fileName,
    path: destination,
    status: "downloading",
    sourceUrl,
    receivedBytes,
    totalBytes,
  });
  sendDownloadState();

  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      const now = Date.now();
      if (now - lastProgressAt > 250 || (totalBytes && receivedBytes >= totalBytes)) {
        lastProgressAt = now;
        updateKiwixDownloadTask(taskId, { receivedBytes, totalBytes });
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), progressStream, fs.createWriteStream(destination));
  } catch (error) {
    updateKiwixDownloadTask(taskId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Download failed.",
      receivedBytes,
      totalBytes,
    });
    throw error;
  }

  updateKiwixDownloadTask(taskId, {
    status: "ready",
    receivedBytes: totalBytes || receivedBytes,
    totalBytes: totalBytes || receivedBytes,
    path: destination,
  });

  return {
    path: destination,
    fileName,
    sizeBytes: totalBytes || receivedBytes,
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

app.on("before-quit", (event) => {
  if (isQuittingAfterTensorServeShutdown || !isHostedTensorServeRunning()) return;

  event.preventDefault();
  isQuittingAfterTensorServeShutdown = true;

  void stopHostedTensorServeOnce().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (isHostedTensorServeRunning()) {
    void stopHostedTensorServeOnce();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
