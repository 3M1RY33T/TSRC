export type TensorHealth = {
  status: string;
  db_loaded: boolean;
  bm25_loaded: boolean;
  ai_configured: boolean;
  active_collection: string | null;
};

export type TensorConfig = {
  ai_provider?: string;
  ai_endpoint?: string | null;
  ai_model?: string | null;
  ai_api_key_configured?: boolean;
  context_size?: number;
  zim_source_folder?: string | null;
};

export type TensorModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export type DetectedEndpoint = {
  endpoint: string;
  model_count: number;
  models: string[];
  provider: string;
  source: string;
};

export type KiwixCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  language: string;
  name: string;
  category: string;
  tags: string;
  updated: string;
  issued: string;
  articleCount: number;
  mediaCount: number;
  downloadUrl: string;
  sizeBytes: number;
  previewUrl: string;
};

export type KiwixCatalogResponse = {
  totalResults: number;
  entries: KiwixCatalogEntry[];
};

export type DownloadedZim = {
  path: string;
  fileName: string;
  sizeBytes: number;
  sourceUrl: string;
};

export type LocalZimFile = {
  path: string;
  fileName: string;
  sizeBytes: number;
};

export type LocalBrowserEntry = {
  type: "directory" | "zim";
  name: string;
  path: string;
  sizeBytes?: number;
};

export type LocalDirectoryListing = {
  currentPath: string;
  parentPath: string | null;
  entries: LocalBrowserEntry[];
};

export type VectorDatabaseSummary = {
  name: string;
  path: string;
  hasBm25: boolean;
  sizeBytes: number;
  updatedMs: number;
};

export type TensorCollectionSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  path: string | null;
  file_count: number;
};

export type TensorCollectionFile = {
  name: string;
  path: string;
  size?: string | null;
  installed?: boolean;
  needs_download?: boolean;
};

export type TensorCollectionDetails = TensorCollectionSummary & {
  files?: TensorCollectionFile[];
  zim_files?: TensorCollectionFile[];
};

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
};

type DesktopTensorRequest = {
  baseUrl: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type DesktopTensorResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
};

export type TensorServeProcessStatus = {
  running: boolean;
  pid: number | null;
  exitCode: number | null;
  logs: string[];
};

export type BrowserViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserViewState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type NativeDownloadTask = {
  id: string;
  title: string;
  fileName: string;
  status: "downloading" | "ready" | "failed";
  path?: string;
  error?: string;
  sourceUrl?: string;
  receivedBytes?: number;
  totalBytes?: number;
  logs?: string[];
};

export type ZimitCaptureRequest = {
  seedUrl: string;
  name: string;
  outputDir?: string;
  pageLimit?: number;
  workers?: number;
  waitUntil?: string;
  scopeExcludeRx?: string[];
  keep?: boolean;
  disableAdBlocking?: boolean;
  image?: string;
  extraArgs?: string;
};

declare global {
  interface Window {
    tensorDesktop?: {
      request: (request: DesktopTensorRequest) => Promise<DesktopTensorResponse>;
      tensorServeStatus?: () => Promise<TensorServeProcessStatus>;
      startTensorServe?: (request: {
        command: string;
        cwd?: string;
      }) => Promise<TensorServeProcessStatus>;
      stopTensorServe?: () => Promise<TensorServeProcessStatus>;
      kiwixCatalog?: (request: {
        query?: string;
        language?: string;
        category?: string;
        start?: number;
        count?: number;
      }) => Promise<KiwixCatalogResponse>;
      downloadZim?: (request: {
        taskId?: string;
        downloadUrl: string;
        title?: string;
        name: string;
        sizeBytes?: number;
        downloadDir?: string;
      }) => Promise<DownloadedZim>;
      browseLocalZims?: () => Promise<LocalZimFile[]>;
      browseLocalZimFolder?: () => Promise<{ folderPath: string; files: LocalZimFile[] }>;
      chooseLocalFolder?: () => Promise<string | null>;
      listLocalDirectory?: (folderPath: string) => Promise<LocalDirectoryListing>;
      getLocalHomeDirectory?: () => Promise<string>;
      getLocalDownloadsDirectory?: () => Promise<string>;
      listVectorDatabases?: (request: { roots?: string[] }) => Promise<VectorDatabaseSummary[]>;
      showBrowserView?: (request: {
        url: string;
        bounds: BrowserViewBounds;
      }) => Promise<BrowserViewState>;
      setBrowserViewBounds?: (bounds: BrowserViewBounds) => Promise<BrowserViewState>;
      hideBrowserView?: () => Promise<BrowserViewState>;
      navigateBrowserView?: (url: string) => Promise<BrowserViewState>;
      browserGoBack?: () => Promise<BrowserViewState>;
      browserGoForward?: () => Promise<BrowserViewState>;
      browserReload?: () => Promise<BrowserViewState>;
      browserStop?: () => Promise<BrowserViewState>;
      browserOpenExternal?: (url: string) => Promise<BrowserViewState>;
      onBrowserViewState?: (callback: (state: BrowserViewState) => void) => () => void;
      listNativeDownloads?: () => Promise<NativeDownloadTask[]>;
      onNativeDownloads?: (callback: (tasks: NativeDownloadTask[]) => void) => () => void;
      startZimitCapture?: (request: ZimitCaptureRequest) => Promise<NativeDownloadTask>;
      cancelZimitCapture?: (id: string) => Promise<NativeDownloadTask | null>;
    };
  }
}

export async function getTensorServeProcessStatus() {
  if (!window.tensorDesktop?.tensorServeStatus) {
    return { running: false, pid: null, exitCode: null, logs: [] };
  }

  return window.tensorDesktop.tensorServeStatus();
}

export async function startTensorServe(command: string, cwd?: string) {
  if (!window.tensorDesktop?.startTensorServe) {
    throw new Error("Restart TSRC to enable Tensor Serve hosting.");
  }

  return window.tensorDesktop.startTensorServe({ command, cwd });
}

export async function stopTensorServe() {
  if (!window.tensorDesktop?.stopTensorServe) {
    throw new Error("Restart TSRC to enable Tensor Serve hosting.");
  }

  return window.tensorDesktop.stopTensorServe();
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const KIWIX_CATALOG_BASE = "https://opds.library.kiwix.org";

function xmlText(parent: Element | Document, selector: string) {
  return parent.querySelector(selector)?.textContent?.trim() ?? "";
}

function parseKiwixCatalogXml(xml: string): KiwixCatalogResponse {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const entries = [...doc.querySelectorAll("entry")].map((entry) => {
    const links = [...entry.querySelectorAll("link")];
    const acquisitionLink = links.find((link) =>
      link.getAttribute("rel")?.includes("opds-spec.org/acquisition"),
    );
    const previewLink = links.find((link) => link.getAttribute("type") === "text/html");

    return {
      id: xmlText(entry, "id").replace(/^urn:uuid:/, ""),
      title: xmlText(entry, "title"),
      summary: xmlText(entry, "summary"),
      language: xmlText(entry, "language"),
      name: xmlText(entry, "name"),
      category: xmlText(entry, "category"),
      tags: xmlText(entry, "tags"),
      updated: xmlText(entry, "updated"),
      issued: xmlText(entry, "issued"),
      articleCount: Number(xmlText(entry, "articleCount") || 0),
      mediaCount: Number(xmlText(entry, "mediaCount") || 0),
      downloadUrl: acquisitionLink?.getAttribute("href") ?? "",
      sizeBytes: Number(acquisitionLink?.getAttribute("length") ?? 0),
      previewUrl: previewLink?.getAttribute("href") ?? "",
    };
  });

  return {
    totalResults: Number(xmlText(doc, "totalResults") || entries.length),
    entries,
  };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (window.tensorDesktop) {
    const response = await window.tensorDesktop.request({
      baseUrl,
      path,
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const data = response.body ? JSON.parse(response.body) : null;

    if (!response.ok) {
      const message =
        data?.detail || data?.error?.message || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return data as T;
  }

  const response = await fetch(`${trimTrailingSlash(baseUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      data?.detail || data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return data as T;
}

export async function getHealth(baseUrl: string) {
  return requestJson<TensorHealth>(baseUrl, "/health");
}

export async function getConfig(baseUrl: string) {
  return requestJson<TensorConfig>(baseUrl, "/config");
}

export async function listModels(baseUrl: string) {
  const response = await requestJson<{ data?: TensorModel[] }>(baseUrl, "/v1/models");
  return response.data ?? [];
}

export async function detectLocalAi(baseUrl: string) {
  const response = await requestJson<{
    detected_endpoints?: DetectedEndpoint[];
    endpoints?: DetectedEndpoint[];
  }>(
    baseUrl,
    "/config/local-ai/detect",
  );
  return response.detected_endpoints ?? response.endpoints ?? [];
}

export async function setAiEndpoint(
  baseUrl: string,
  endpoint: string,
  model: string,
  provider?: string,
) {
  return requestJson<TensorConfig>(baseUrl, "/config/set-ai-endpoint", {
    method: "POST",
    body: JSON.stringify({
      ai_endpoint: endpoint,
      ai_model: model,
      ai_provider: provider,
    }),
  });
}

export async function searchKiwixCatalog(params: {
  query?: string;
  language?: string;
  category?: string;
  start?: number;
  count?: number;
}) {
  if (window.tensorDesktop?.kiwixCatalog) {
    return window.tensorDesktop.kiwixCatalog(params);
  }

  const searchParams = new URLSearchParams();
  searchParams.set("count", String(params.count ?? 25));
  searchParams.set("start", String(params.start ?? 0));

  if (params.query) searchParams.set("q", params.query);
  if (params.language) searchParams.set("lang", params.language);
  if (params.category) searchParams.set("category", params.category);

  const response = await fetch(`${KIWIX_CATALOG_BASE}/catalog/v2/entries?${searchParams}`);
  const xml = await response.text();

  if (!response.ok) {
    throw new Error(`Kiwix catalog returned ${response.status}: ${xml.slice(0, 160)}`);
  }

  return parseKiwixCatalogXml(xml);
}

export async function downloadZim(entry: KiwixCatalogEntry, downloadDir?: string | null) {
  if (!window.tensorDesktop?.downloadZim) {
    throw new Error("Restart TSRC to enable desktop ZIM downloads.");
  }

  return window.tensorDesktop.downloadZim({
    taskId: entry.id,
    downloadUrl: entry.downloadUrl,
    title: entry.title,
    name: entry.name,
    sizeBytes: entry.sizeBytes,
    downloadDir: downloadDir?.trim() || undefined,
  });
}

export async function browseLocalZims() {
  if (!window.tensorDesktop?.browseLocalZims) {
    throw new Error("Restart TSRC to enable local ZIM file browsing.");
  }

  return window.tensorDesktop.browseLocalZims();
}

export async function browseLocalZimFolder() {
  if (!window.tensorDesktop?.browseLocalZimFolder) {
    throw new Error("Restart TSRC to enable local folder browsing.");
  }

  return window.tensorDesktop.browseLocalZimFolder();
}

export async function chooseLocalFolder() {
  if (!window.tensorDesktop?.chooseLocalFolder) {
    throw new Error("Restart TSRC to enable local folder browsing.");
  }

  return window.tensorDesktop.chooseLocalFolder();
}

export async function listLocalDirectory(folderPath: string) {
  if (!window.tensorDesktop?.listLocalDirectory) {
    throw new Error("Restart TSRC to enable local folder browsing.");
  }

  return window.tensorDesktop.listLocalDirectory(folderPath);
}

export async function getLocalHomeDirectory() {
  if (!window.tensorDesktop?.getLocalHomeDirectory) {
    throw new Error("Restart TSRC to enable local folder browsing.");
  }

  return window.tensorDesktop.getLocalHomeDirectory();
}

export async function getLocalDownloadsDirectory() {
  if (!window.tensorDesktop?.getLocalDownloadsDirectory) {
    throw new Error("Restart TSRC to enable local folder browsing.");
  }

  return window.tensorDesktop.getLocalDownloadsDirectory();
}

export async function listVectorDatabases(roots: string[] = []) {
  if (!window.tensorDesktop?.listVectorDatabases) {
    throw new Error("Restart TSRC to enable vector database discovery.");
  }

  return window.tensorDesktop.listVectorDatabases({ roots });
}

export async function registerZim(baseUrl: string, zimPath: string, entry?: KiwixCatalogEntry) {
  return requestJson(baseUrl, "/zim/register", {
    method: "POST",
    body: JSON.stringify({
      path: zimPath,
      file_id: entry?.id || entry?.name,
      title: entry?.title,
    }),
  });
}

export async function createCollection(
  baseUrl: string,
  collectionId: string,
  name: string,
  description: string,
  zimPaths: string[],
) {
  return requestJson(baseUrl, "/collections", {
    method: "POST",
    body: JSON.stringify({
      collection_id: collectionId,
      name,
      description,
      zim_paths: zimPaths,
    }),
  });
}

export async function ingestCollection(baseUrl: string, collectionId: string) {
  return requestJson(baseUrl, `/collections/${encodeURIComponent(collectionId)}/ingest`, {
    method: "POST",
  });
}

export async function listCollections(baseUrl: string) {
  const response = await requestJson<{
    collections?: Record<string, Omit<TensorCollectionSummary, "id">>;
    active?: string | null;
  }>(baseUrl, "/collections");

  return Object.entries(response.collections ?? {}).map(([id, collection]) => ({
    id,
    ...collection,
  }));
}

export async function getCollectionDetails(baseUrl: string, collectionId: string) {
  return requestJson<TensorCollectionDetails>(
    baseUrl,
    `/collections/${encodeURIComponent(collectionId)}`,
  );
}

export async function ingestMultiple(baseUrl: string, zimPaths: string[], outputName: string) {
  return requestJson(baseUrl, "/ingest-multiple", {
    method: "POST",
    body: JSON.stringify({
      zim_paths: zimPaths,
      output_name: outputName,
    }),
  });
}

export async function loadVectorDb(baseUrl: string, dbName: string) {
  return requestJson(baseUrl, `/load?name=${encodeURIComponent(dbName)}`);
}

export async function sendChatCompletion(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
) {
  const response = await requestJson<ChatCompletionResponse>(
    baseUrl,
    "/v1/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
      }),
    },
  );

  const content =
    response.choices?.[0]?.message?.content ?? response.choices?.[0]?.text ?? "";

  if (!content && response.error?.message) {
    throw new Error(response.error.message);
  }

  return content || "The model returned an empty response.";
}
