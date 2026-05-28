const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

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
  const downloadDir = path.join(app.getPath("userData"), "zim-files");
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

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
