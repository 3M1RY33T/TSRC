import { FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import openZimLogo from "./assets/openzim-logo.svg";
import type {
  BrowserViewBounds,
  BrowserViewState,
  NativeDownloadTask,
  ZimitCaptureRequest,
} from "./api/tensorServe";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Database,
  Download,
  ExternalLink,
  File as FileIcon,
  FolderOpen,
  Globe2,
  Home,
  Loader2,
  MessageSquare,
  PlugZap,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Server,
  Settings2,
  User,
} from "lucide-react";
import {
  ChatMessage,
  DetectedEndpoint,
  DownloadedZim,
  KiwixCatalogEntry,
  LocalBrowserEntry,
  LocalZimFile,
  TensorCollectionDetails,
  TensorCollectionSummary,
  TensorConfig,
  TensorHealth,
  TensorModel,
  TensorServeProcessStatus,
  VectorDatabaseSummary,
  chooseLocalFolder,
  createCollection,
  detectLocalAi,
  downloadZim,
  getConfig,
  getCollectionDetails,
  getHealth,
  getLocalDownloadsDirectory,
  getTensorServeProcessStatus,
  ingestMultiple,
  listLocalDirectory,
  listCollections,
  listModels,
  listVectorDatabases,
  loadVectorDb,
  registerZim,
  searchKiwixCatalog,
  sendChatCompletion,
  setAiEndpoint,
  startTensorServe,
  stopTensorServe,
} from "./api/tensorServe";

const DEFAULT_TENSOR_SERVE_URL = window.tensorDesktop
  ? "http://localhost:8000"
  : import.meta.env.DEV
    ? "/tensor"
    : "http://localhost:8000";
const DEFAULT_TENSOR_SERVE_COMMAND = "tensor-serve start --host 127.0.0.1 --port 8000";
const DEFAULT_BROWSER_HOME_URL = "https://www.wikipedia.org";

const createMessage = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
});

type ActivityId = "chat" | "search" | "downloads" | "browser";
type SidebarId = "chat" | "search" | "serving" | "downloads" | "databases";
type SidebarCapableActivityId = Extract<ActivityId, SidebarId>;
type SettingsSection =
  | "chat"
  | "search"
  | "files"
  | "browser"
  | "serving"
  | "downloads"
  | "databases";
type VectorSource = "local" | "collections" | "archive";
type VectorSetupMode = "database" | "collection";
type DownloadStatus = "downloading" | "ready" | "failed";
type VectorProgressStatus = "working" | "ready" | "failed";

type DownloadTask = {
  id: string;
  title: string;
  fileName: string;
  status: DownloadStatus;
  path?: string;
  error?: string;
  sourceUrl?: string;
  receivedBytes?: number;
  totalBytes?: number;
  logs?: string[];
};

type VectorProgress = {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  indeterminate?: boolean;
  status: VectorProgressStatus;
};

const slugifyId = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || fallback;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const getDirectoryPath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
};

const normalizePathId = (value?: string | null) => (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

const toDownloadTask = (task: NativeDownloadTask): DownloadTask => ({
  id: task.id,
  title: task.title,
  fileName: task.fileName,
  status: task.status,
  path: task.path,
  error: task.error,
  sourceUrl: task.sourceUrl,
  receivedBytes: task.receivedBytes,
  totalBytes: task.totalBytes,
  logs: task.logs,
});

const normalizeBrowserUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") || trimmed.startsWith("localhost")) return `https://${trimmed}`;

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
};

function App() {
  const [baseUrl, setBaseUrl] = useState(
    () => localStorage.getItem("tensor.baseUrl") ?? DEFAULT_TENSOR_SERVE_URL,
  );
  const [tensorServeCommand, setTensorServeCommand] = useState(
    () => {
      const savedCommand = localStorage.getItem("tensor.serveCommand");
      return !savedCommand || savedCommand === "tensor-serve api"
        ? DEFAULT_TENSOR_SERVE_COMMAND
        : savedCommand;
    },
  );
  const [tensorServeCwd, setTensorServeCwd] = useState(
    () => localStorage.getItem("tensor.serveCwd") ?? "",
  );
  const [tensorServeProcess, setTensorServeProcess] = useState<TensorServeProcessStatus>({
    running: false,
    pid: null,
    exitCode: null,
    logs: [],
  });
  const [model, setModel] = useState(() => localStorage.getItem("tensor.model") ?? "");
  const [health, setHealth] = useState<TensorHealth | null>(null);
  const [config, setConfig] = useState<TensorConfig | null>(null);
  const [models, setModels] = useState<TensorModel[]>([]);
  const [detectedEndpoints, setDetectedEndpoints] = useState<DetectedEndpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState(
    () => localStorage.getItem("tensor.endpoint") ?? "",
  );
  const [localAiEndpoint, setLocalAiEndpoint] = useState(
    () => localStorage.getItem("tensor.endpoint") ?? "",
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage("assistant", "Tensor client ready. Connect to Tensor Serve and start chatting."),
  ]);
  const [catalogQuery, setCatalogQuery] = useState("python");
  const [catalogLanguage, setCatalogLanguage] = useState("eng");
  const [catalogResults, setCatalogResults] = useState<KiwixCatalogEntry[]>([]);
  const [localBrowserEntries, setLocalBrowserEntries] = useState<LocalBrowserEntry[]>([]);
  const [localBrowserParentPath, setLocalBrowserParentPath] = useState<string | null>(null);
  const [localBrowserPath, setLocalBrowserPath] = useState("");
  const [selectedLocalZims, setSelectedLocalZims] = useState<LocalZimFile[]>([]);
  const [availableCollections, setAvailableCollections] = useState<TensorCollectionSummary[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<TensorCollectionDetails[]>([]);
  const [vectorDatabases, setVectorDatabases] = useState<VectorDatabaseSummary[]>([]);
  const [activeVectorDbPath, setActiveVectorDbPath] = useState(
    () => localStorage.getItem("tensor.activeVectorDbPath") ?? "",
  );
  const [downloadedZims, setDownloadedZims] = useState<Record<string, DownloadedZim>>({});
  const [downloadTasks, setDownloadTasks] = useState<Record<string, DownloadTask>>({});
  const [isDownloadListOpen, setIsDownloadListOpen] = useState(true);
  const [vectorSource, setVectorSource] = useState<VectorSource>("local");
  const [vectorSetupMode, setVectorSetupMode] = useState<VectorSetupMode>("database");
  const [vectorDbName, setVectorDbName] = useState("Local Knowledge");
  const [collectionName, setCollectionName] = useState("Local Collection");
  const [collectionDescription, setCollectionDescription] = useState(
    "Created by TSRC from selected ZIM files.",
  );
  const [vectorStatus, setVectorStatus] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isCollectionsLoading, setIsCollectionsLoading] = useState(false);
  const [isVectorDbLoading, setIsVectorDbLoading] = useState(false);
  const [isVectorWorking, setIsVectorWorking] = useState(false);
  const [vectorProgress, setVectorProgress] = useState<VectorProgress | null>(null);
  const [draft, setDraft] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeActivity, setActiveActivity] = useState<ActivityId>("chat");
  const [activeSidebar, setActiveSidebar] = useState<SidebarId | null>(null);
  const [isSettingsMode, setIsSettingsMode] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("chat");
  const [error, setError] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState(
    () => localStorage.getItem("tensor.browserUrl") ?? DEFAULT_BROWSER_HOME_URL,
  );
  const [browserInput, setBrowserInput] = useState(
    () => localStorage.getItem("tensor.browserUrl") ?? DEFAULT_BROWSER_HOME_URL,
  );
  const [browserHomeUrl, setBrowserHomeUrl] = useState(
    () => localStorage.getItem("tensor.browserHomeUrl") ?? DEFAULT_BROWSER_HOME_URL,
  );
  const [browserTitle, setBrowserTitle] = useState("Web browser");
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [browserCanGoBack, setBrowserCanGoBack] = useState(false);
  const [browserCanGoForward, setBrowserCanGoForward] = useState(false);
  const [isZimitPanelOpen, setIsZimitPanelOpen] = useState(false);
  const [zimitName, setZimitName] = useState("");
  const [zimitOutputDir, setZimitOutputDir] = useState("");
  const [zimitPageLimit, setZimitPageLimit] = useState("100");
  const [zimitWorkers, setZimitWorkers] = useState("1");
  const [zimitWaitUntil, setZimitWaitUntil] = useState("load");
  const [zimitScopeExclude, setZimitScopeExclude] = useState("");
  const [zimitScopeExcludeDraft, setZimitScopeExcludeDraft] = useState("");
  const [zimitKeep, setZimitKeep] = useState(false);
  const [zimitDisableAdBlocking, setZimitDisableAdBlocking] = useState(false);
  const [zimitImage, setZimitImage] = useState("ghcr.io/openzim/zimit");
  const [zimitExtraArgs, setZimitExtraArgs] = useState("");
  const [zimitStatus, setZimitStatus] = useState("");
  const [isZimitStarting, setIsZimitStarting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const browserFrameRef = useRef<HTMLDivElement | null>(null);

  const activeModel = model || config?.ai_model || models[0]?.id || "";
  const isConnected = health?.status === "ok";
  const isChatPanelOpen = !isSettingsMode && activeSidebar === "chat";
  const isChatVisible = !isSettingsMode && activeActivity === "chat" && !isChatPanelOpen;
  const isSearchPanelOpen = !isSettingsMode && activeSidebar === "search";
  const isServingPanelOpen = !isSettingsMode && activeSidebar === "serving";
  const isDownloadsPanelOpen = !isSettingsMode && activeSidebar === "downloads";
  const isDatabasePanelOpen = !isSettingsMode && activeSidebar === "databases";
  const isSidebarOpen = !isSettingsMode && activeSidebar !== null;
  const isSearchVisible = !isSettingsMode && activeActivity === "search" && !isSearchPanelOpen;
  const isBrowserVisible = !isSettingsMode && activeActivity === "browser";
  const isDownloadsVisible =
    !isSettingsMode && activeActivity === "downloads" && !isDownloadsPanelOpen;
  const chatNavActive = isSettingsMode ? settingsSection === "chat" : isChatVisible || isChatPanelOpen;
  const searchNavActive = isSettingsMode ? settingsSection === "search" : isSearchVisible || isSearchPanelOpen;
  const browserNavActive = isSettingsMode ? settingsSection === "browser" : isBrowserVisible;
  const servingNavActive = isSettingsMode ? settingsSection === "serving" : isServingPanelOpen;
  const downloadsNavActive = isSettingsMode
    ? settingsSection === "downloads"
    : isDownloadsVisible || isDownloadsPanelOpen;
  const databaseNavActive = isSettingsMode ? settingsSection === "databases" : isDatabasePanelOpen;
  const generatedVectorDbId = useMemo(
    () => slugifyId(vectorDbName, "local_knowledge"),
    [vectorDbName],
  );
  const generatedCollectionId = useMemo(
    () => slugifyId(collectionName, "local_collection"),
    [collectionName],
  );
  const selectedCollectionFiles = useMemo(
    () =>
      selectedCollections.flatMap((collection) =>
        (collection.files ?? collection.zim_files ?? []).filter(
          (file) => file.path && file.installed !== false,
        ),
      ),
    [selectedCollections],
  );
  const selectedSourceCount = selectedLocalZims.length + selectedCollectionFiles.length;
  const downloadTaskList = useMemo(() => Object.values(downloadTasks), [downloadTasks]);
  const activeZimitTasks = useMemo(
    () => downloadTaskList.filter((task) => task.id.startsWith("zimit:")),
    [downloadTaskList],
  );
  const zimitScopeExcludeTags = useMemo(
    () =>
      zimitScopeExclude
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [zimitScopeExclude],
  );
  const activeVectorDbId = normalizePathId(activeVectorDbPath);
  const modelOptions = useMemo(() => {
    const options = new Map<
      string,
      { value: string; model: string; endpoint: string; provider?: string; label: string }
    >();

    detectedEndpoints.forEach((endpoint) => {
      endpoint.models.forEach((detectedModel) => {
        const value = `${endpoint.endpoint}::${detectedModel}`;
        options.set(value, {
          value,
          model: detectedModel,
          endpoint: endpoint.endpoint,
          provider: endpoint.provider,
          label: `${detectedModel} · ${endpoint.provider} · ${endpoint.endpoint}`,
        });
      });
    });

    models.forEach((listedModel) => {
      const endpoint = config?.ai_endpoint ?? selectedEndpoint ?? localAiEndpoint;
      const value = endpoint ? `${endpoint}::${listedModel.id}` : `configured::${listedModel.id}`;

      if (!options.has(value)) {
        options.set(value, {
          value,
          model: listedModel.id,
          endpoint,
          provider: config?.ai_provider,
          label: endpoint ? `${listedModel.id} · configured · ${endpoint}` : listedModel.id,
        });
      }
    });

    return [...options.values()];
  }, [
    config?.ai_endpoint,
    config?.ai_provider,
    detectedEndpoints,
    localAiEndpoint,
    models,
    selectedEndpoint,
  ]);

  const activeModelValue = useMemo(() => {
    const endpoint = selectedEndpoint || config?.ai_endpoint || "";
    const match = modelOptions.find(
      (option) => option.model === activeModel && (!endpoint || option.endpoint === endpoint),
    );
    return match?.value ?? "";
  }, [activeModel, config?.ai_endpoint, modelOptions, selectedEndpoint]);

  const statusLabel = useMemo(() => {
    if (isChecking) return "Checking";
    if (isConnected) return health.ai_configured ? "Ready" : "Service online";
    return "Offline";
  }, [health, isChecking, isConnected]);

  useEffect(() => {
    localStorage.setItem("tensor.baseUrl", baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    localStorage.setItem("tensor.serveCommand", tensorServeCommand);
  }, [tensorServeCommand]);

  useEffect(() => {
    localStorage.setItem("tensor.serveCwd", tensorServeCwd);
  }, [tensorServeCwd]);

  useEffect(() => {
    if (model) localStorage.setItem("tensor.model", model);
  }, [model]);

  useEffect(() => {
    if (selectedEndpoint) localStorage.setItem("tensor.endpoint", selectedEndpoint);
  }, [selectedEndpoint]);

  useEffect(() => {
    localStorage.setItem("tensor.browserUrl", browserUrl);
  }, [browserUrl]);

  useEffect(() => {
    localStorage.setItem("tensor.browserHomeUrl", browserHomeUrl);
  }, [browserHomeUrl]);

  useEffect(() => {
    if (health?.db_loaded && activeVectorDbPath) {
      localStorage.setItem("tensor.activeVectorDbPath", activeVectorDbPath);
    } else if (!health?.db_loaded) {
      localStorage.removeItem("tensor.activeVectorDbPath");
      setActiveVectorDbPath("");
    }
  }, [activeVectorDbPath, health?.db_loaded]);

  useEffect(() => {
    const unsubscribe = window.tensorDesktop?.onBrowserViewState?.((state) => {
      applyBrowserViewState(state);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const mergeNativeDownloads = (tasks: NativeDownloadTask[]) => {
      setDownloadTasks((current) => {
        const next = { ...current };
        tasks.forEach((task) => {
          next[task.id] = toDownloadTask(task);
        });
        return next;
      });

      const readyZims = tasks.filter(
        (task) =>
          task.status === "ready" &&
          task.path &&
          task.fileName.toLowerCase().endsWith(".zim"),
      );

      if (readyZims.length > 0) {
        setSelectedLocalZims((current) => {
          const next = [...current];
          readyZims.forEach((task) => {
            if (!task.path || next.some((file) => file.path === task.path)) return;
            next.push({
              path: task.path,
              fileName: task.fileName,
              sizeBytes: task.totalBytes ?? task.receivedBytes ?? 0,
            });
          });
          return next;
        });
      }
    };

    void window.tensorDesktop?.listNativeDownloads?.().then(mergeNativeDownloads);
    const unsubscribe = window.tensorDesktop?.onNativeDownloads?.(mergeNativeDownloads);

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!isZimitPanelOpen || zimitName.trim()) return;

    try {
      const url = new URL(browserUrl);
      setZimitName(slugifyId(url.hostname.replace(/^www\./, ""), "website_capture"));
    } catch {
      setZimitName("website_capture");
    }
  }, [browserUrl, isZimitPanelOpen, zimitName]);

  useEffect(() => {
    if (!isBrowserVisible || !window.tensorDesktop?.showBrowserView) return;

    let animationFrame = 0;
    const syncBrowserBounds = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const bounds = getBrowserFrameBounds();
        if (!bounds) return;

        void window.tensorDesktop?.setBrowserViewBounds?.(bounds);
      });
    };

    const showBrowser = () => {
      const bounds = getBrowserFrameBounds();
      if (!bounds) return;

      void window.tensorDesktop?.showBrowserView?.({ url: browserUrl, bounds }).then((state) => {
        applyBrowserViewState(state);
      });
    };

    showBrowser();

    const resizeObserver = new ResizeObserver(syncBrowserBounds);
    if (browserFrameRef.current) resizeObserver.observe(browserFrameRef.current);
    window.addEventListener("resize", syncBrowserBounds);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncBrowserBounds);
      void window.tensorDesktop?.hideBrowserView?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowserVisible]);

  useEffect(() => {
    if (!isBrowserVisible || !window.tensorDesktop?.setBrowserViewBounds) return;

    const frame = window.requestAnimationFrame(() => {
      const bounds = getBrowserFrameBounds();
      if (bounds) void window.tensorDesktop?.setBrowserViewBounds?.(bounds);
    });

    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowserVisible, isZimitPanelOpen]);

  useEffect(() => {
    if (localAiEndpoint) localStorage.setItem("tensor.endpoint", localAiEndpoint);
  }, [localAiEndpoint]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  async function refreshConnection(targetBaseUrl = baseUrl) {
    const serviceUrl = targetBaseUrl.replace(/\/+$/, "");
    setIsChecking(true);
    setError(null);

    try {
      let [nextHealth, nextConfig] = await Promise.all([
        getHealth(serviceUrl),
        getConfig(serviceUrl),
      ]);

      if (!nextHealth.ai_configured && nextConfig.ai_endpoint && nextConfig.ai_model) {
        await setAiEndpoint(
          serviceUrl,
          nextConfig.ai_endpoint,
          nextConfig.ai_model,
          nextConfig.ai_provider,
        );
        [nextHealth, nextConfig] = await Promise.all([getHealth(serviceUrl), getConfig(serviceUrl)]);
      }

      setBaseUrl(serviceUrl);
      setHealth(nextHealth);
      setConfig(nextConfig);
      if (nextConfig.ai_endpoint) {
        setSelectedEndpoint(nextConfig.ai_endpoint);
        setLocalAiEndpoint(nextConfig.ai_endpoint);
      }

      try {
        const [nextModels, nextDetectedEndpoints] = await Promise.all([
          listModels(serviceUrl).catch(() => []),
          detectLocalAi(serviceUrl).catch(() => []),
        ]);
        setModels(nextModels);
        setDetectedEndpoints(nextDetectedEndpoints);

        if (nextConfig.ai_model) {
          setModel(nextConfig.ai_model);
        } else if (!model && nextModels[0]?.id) {
          setModel(nextModels[0].id);
        } else if (!model && nextDetectedEndpoints[0]?.models[0]) {
          setModel(nextDetectedEndpoints[0].models[0]);
          setSelectedEndpoint(nextDetectedEndpoints[0].endpoint);
          setLocalAiEndpoint(nextDetectedEndpoints[0].endpoint);
        }
      } catch {
        setModels([]);
        setDetectedEndpoints([]);
      }
    } catch (caught) {
      setHealth(null);
      setConfig(null);
      setModels([]);
      setDetectedEndpoints([]);
      setError(caught instanceof Error ? caught.message : "Unable to reach Tensor Serve.");
    } finally {
      setIsChecking(false);
    }
  }

  async function autoConnectTensorServe() {
    const candidates = [
      localStorage.getItem("tensor.baseUrl"),
      baseUrl,
      DEFAULT_TENSOR_SERVE_URL,
      "http://localhost:8000",
      "http://127.0.0.1:8000",
    ]
      .filter(Boolean)
      .map((candidate) => String(candidate).replace(/\/+$/, ""));
    const uniqueCandidates = [...new Set(candidates)];

    for (const candidate of uniqueCandidates) {
      try {
        await getHealth(candidate);
        await refreshConnection(candidate);
        return;
      } catch {
        // Try the next likely Tensor Serve endpoint.
      }
    }

    await refreshConnection(uniqueCandidates[0] ?? baseUrl);
  }

  useEffect(() => {
    void autoConnectTensorServe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void getTensorServeProcessStatus().then(setTensorServeProcess).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!tensorServeProcess.running) return;

    const interval = window.setInterval(() => {
      void getTensorServeProcessStatus().then(setTensorServeProcess).catch(() => undefined);
    }, 1500);

    return () => window.clearInterval(interval);
  }, [tensorServeProcess.running]);

  useEffect(() => {
    if (vectorSource !== "local" || localBrowserPath) return;

    void openDefaultLocalDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.zim_source_folder, localBrowserPath, vectorSource]);

  useEffect(() => {
    if (activeSidebar !== "databases") return;

    void refreshVectorDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSidebar, config?.zim_source_folder, localBrowserPath]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!content || isSending) return;

    if (!activeModel) {
      setError("Tensor Serve has no active model configured.");
      return;
    }

    const userMessage = createMessage("user", content);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setError(null);

    try {
      if (!health?.ai_configured && (config?.ai_endpoint || localAiEndpoint)) {
        const endpoint = config?.ai_endpoint ?? localAiEndpoint;
        await setAiEndpoint(baseUrl, endpoint, activeModel, config?.ai_provider);
        const [nextConfig, nextHealth] = await Promise.all([getConfig(baseUrl), getHealth(baseUrl)]);
        setConfig(nextConfig);
        setHealth(nextHealth);
      }

      const reply = await sendChatCompletion(baseUrl, activeModel, nextMessages);
      setMessages((current) => [...current, createMessage("assistant", reply)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chat request failed.");
      setMessages((current) => [
        ...current,
        createMessage("assistant", "I could not complete that request."),
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function selectModel(value: string) {
    const option = modelOptions.find((item) => item.value === value);
    if (!option) return;

    setModel(option.model);
    setSelectedEndpoint(option.endpoint);
    setLocalAiEndpoint(option.endpoint);
    setError(null);

    if (!option.endpoint || option.endpoint === "configured") return;

    try {
      await setAiEndpoint(baseUrl, option.endpoint, option.model, option.provider);
      const [nextConfig, nextHealth] = await Promise.all([getConfig(baseUrl), getHealth(baseUrl)]);
      setConfig(nextConfig);
      setHealth(nextHealth);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to configure Tensor Serve with that model.",
      );
    }
  }

  async function applyLocalAiConfig() {
    if (!localAiEndpoint.trim() || !activeModel) {
      setError("Choose a local AI endpoint and model first.");
      return;
    }

    const option = modelOptions.find(
      (item) => item.model === activeModel && item.endpoint === localAiEndpoint,
    );

    setError(null);
    setIsChecking(true);

    try {
      await setAiEndpoint(baseUrl, localAiEndpoint.trim(), activeModel, option?.provider);
      const [nextConfig, nextHealth, nextModels] = await Promise.all([
        getConfig(baseUrl),
        getHealth(baseUrl),
        listModels(baseUrl).catch(() => []),
      ]);
      setConfig(nextConfig);
      setHealth(nextHealth);
      setModels(nextModels);
      setSelectedEndpoint(localAiEndpoint.trim());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to configure Tensor Serve with that local AI endpoint.",
      );
    } finally {
      setIsChecking(false);
    }
  }

  async function chooseTensorServeFolder() {
    try {
      const folderPath = await chooseLocalFolder();
      if (folderPath) setTensorServeCwd(folderPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to choose Tensor Serve folder.");
    }
  }

  async function launchTensorServe() {
    if (!tensorServeCommand.trim()) {
      setError("Enter a Tensor Serve launch command first.");
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      const status = await startTensorServe(tensorServeCommand.trim(), tensorServeCwd.trim());
      setTensorServeProcess(status);
      const connected = await waitForTensorServe();
      const nextStatus = await getTensorServeProcessStatus();
      setTensorServeProcess(nextStatus);

      if (!connected) {
        setError("Tensor Serve was launched, but it is not answering yet. Check the process log.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start Tensor Serve.");
    } finally {
      setIsChecking(false);
    }
  }

  async function waitForTensorServe() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await getHealth(baseUrl);
        await refreshConnection();
        return true;
      } catch {
        const nextStatus = await getTensorServeProcessStatus().catch(() => tensorServeProcess);
        setTensorServeProcess(nextStatus);

        if (nextStatus.exitCode !== null) {
          return false;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
    }

    return false;
  }

  async function haltTensorServe() {
    setIsChecking(true);
    setError(null);

    try {
      const status = await stopTensorServe();
      setTensorServeProcess(status);
      await refreshConnection();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to stop Tensor Serve.");
    } finally {
      setIsChecking(false);
    }
  }

  async function searchCatalog() {
    setIsCatalogLoading(true);
    setVectorStatus("");

    try {
      const response = await searchKiwixCatalog({
        query: catalogQuery.trim(),
        language: catalogLanguage.trim() || undefined,
        count: 25,
      });
      setCatalogResults(response.entries);
      setVectorStatus(`Found ${response.totalResults.toLocaleString()} matching ZIM files.`);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to search Kiwix catalog.");
    } finally {
      setIsCatalogLoading(false);
    }
  }

  function submitCatalogSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchCatalog();
  }

  async function downloadCatalogEntry(entry: KiwixCatalogEntry) {
    const existingTask = downloadTasks[entry.id];
    if (existingTask?.status === "downloading") return null;

    setDownloadTasks((current) => ({
      ...current,
      [entry.id]: {
        id: entry.id,
        title: entry.title,
        fileName: entry.name,
        status: "downloading",
        sourceUrl: entry.downloadUrl,
        receivedBytes: 0,
        totalBytes: entry.sizeBytes,
      },
    }));

    try {
      const file =
        downloadedZims[entry.id] ?? (await downloadZim(entry, config?.zim_source_folder));
      setDownloadedZims((current) => ({ ...current, [entry.id]: file }));
      setDownloadTasks((current) => ({
        ...current,
        [entry.id]: {
          id: entry.id,
          title: entry.title,
          fileName: file.fileName,
          path: file.path,
          status: "ready",
          sourceUrl: file.sourceUrl,
          receivedBytes: file.sizeBytes,
          totalBytes: file.sizeBytes,
        },
      }));

      if (!config?.zim_source_folder?.trim()) {
        const downloadFolder = getDirectoryPath(file.path);
        if (downloadFolder) void openLocalDirectory(downloadFolder);
      }

      return file;
    } catch (caught) {
      setDownloadTasks((current) => ({
        ...current,
        [entry.id]: {
          id: entry.id,
          title: entry.title,
          fileName: entry.name,
          status: "failed",
          error: caught instanceof Error ? caught.message : "Download failed.",
          sourceUrl: entry.downloadUrl,
          receivedBytes: 0,
          totalBytes: entry.sizeBytes,
        },
      }));
      throw caught;
    }
  }

  function removeLocalZim(path: string) {
    setSelectedLocalZims((current) => current.filter((file) => file.path !== path));
  }

  function toggleLocalZim(file: LocalBrowserEntry) {
    if (file.type !== "zim") return;

    setSelectedLocalZims((current) =>
      current.some((item) => item.path === file.path)
        ? current.filter((item) => item.path !== file.path)
        : [
            ...current,
            {
              path: file.path,
              fileName: file.name,
              sizeBytes: file.sizeBytes ?? 0,
            },
          ],
    );
  }

  async function openLocalDirectory(folderPath: string) {
    setVectorStatus("");

    try {
      const listing = await listLocalDirectory(folderPath);
      setLocalBrowserPath(listing.currentPath);
      setLocalBrowserParentPath(listing.parentPath);
      setLocalBrowserEntries(listing.entries);
      setVectorStatus(`Showing ${listing.entries.length} folder item(s).`);
      return true;
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to browse local folder.");
      return false;
    }
  }

  async function openDefaultLocalDirectory() {
    setVectorStatus("");

    try {
      const latestConfig = config ?? (await getConfig(baseUrl).catch(() => null));
      const zimSourceFolder = latestConfig?.zim_source_folder?.trim();

      if (zimSourceFolder && (await openLocalDirectory(zimSourceFolder))) {
        return;
      }

      const latestDownloadedFile = Object.values(downloadedZims).at(-1);
      const latestDownloadFolder = latestDownloadedFile
        ? getDirectoryPath(latestDownloadedFile.path)
        : "";

      if (latestDownloadFolder && (await openLocalDirectory(latestDownloadFolder))) {
        return;
      }

      const downloadsPath = await getLocalDownloadsDirectory();
      await openLocalDirectory(downloadsPath);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to open local files.");
    }
  }

  async function chooseLocalDirectory() {
    setVectorStatus("");

    try {
      const folderPath = await chooseLocalFolder();
      if (folderPath) void openLocalDirectory(folderPath);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to browse local folder.");
    }
  }

  async function refreshCollections() {
    setIsCollectionsLoading(true);
    setVectorStatus("");

    try {
      const collections = await listCollections(baseUrl);
      setAvailableCollections(collections);
      setVectorStatus(`Found ${collections.length} Tensor Serve collection(s).`);
    } catch (caught) {
      setVectorStatus(
        caught instanceof Error ? caught.message : "Unable to load Tensor Serve collections.",
      );
    } finally {
      setIsCollectionsLoading(false);
    }
  }

  async function toggleCollection(collection: TensorCollectionSummary) {
    if (selectedCollections.some((item) => item.id === collection.id)) {
      setSelectedCollections((current) => current.filter((item) => item.id !== collection.id));
      return;
    }

    setIsCollectionsLoading(true);
    setVectorStatus("");

    try {
      const details = await getCollectionDetails(baseUrl, collection.id);
      const usableFiles = (details.files ?? details.zim_files ?? []).filter(
        (file) => file.path && file.installed !== false,
      );

      if (usableFiles.length === 0) {
        setVectorStatus(`${collection.name} has no installed ZIM files to ingest.`);
        return;
      }

      setSelectedCollections((current) => [...current, details]);
      setVectorStatus(`Added ${usableFiles.length} file(s) from ${collection.name}.`);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to load collection files.");
    } finally {
      setIsCollectionsLoading(false);
    }
  }

  function removeSelectedCollection(collectionId: string) {
    setSelectedCollections((current) => current.filter((collection) => collection.id !== collectionId));
  }

  async function resolveSelectedZimPaths() {
    if (selectedSourceCount === 0) {
      setVectorStatus("Select at least one local or collection ZIM file first.");
      setVectorProgress(null);
      return [];
    }

    const zimPaths = new Set<string>();
    const totalRegistrationSteps = Math.max(selectedSourceCount, 1);
    let completedRegistrationSteps = 0;

    setVectorProgress({
      label: "Preparing ZIM files",
      detail: `${selectedSourceCount} selected source(s)`,
      current: 0,
      total: totalRegistrationSteps,
      status: "working",
    });

    for (const file of selectedLocalZims) {
      setVectorStatus(`Registering ${file.fileName} with Tensor Serve...`);
      setVectorProgress({
        label: "Registering local ZIM files",
        detail: file.fileName,
        current: completedRegistrationSteps,
        total: totalRegistrationSteps,
        status: "working",
      });
      zimPaths.add(file.path);
      await registerZim(baseUrl, file.path);
      completedRegistrationSteps += 1;
      setVectorProgress({
        label: "Registering local ZIM files",
        detail: file.fileName,
        current: completedRegistrationSteps,
        total: totalRegistrationSteps,
        status: "working",
      });
    }

    for (const file of selectedCollectionFiles) {
      zimPaths.add(file.path);
      completedRegistrationSteps += 1;
      setVectorProgress({
        label: "Preparing collection ZIM files",
        detail: file.name,
        current: completedRegistrationSteps,
        total: totalRegistrationSteps,
        status: "working",
      });
    }

    const paths = [...zimPaths];
    setVectorStatus(`Prepared ${paths.length} ZIM file(s).`);
    setVectorProgress({
      label: "ZIM files prepared",
      detail: `${paths.length} unique file(s) ready`,
      current: totalRegistrationSteps,
      total: totalRegistrationSteps,
      status: "working",
    });
    return paths;
  }

  async function setupKnowledgeBase() {
    if (!vectorDbName.trim()) {
      setVectorStatus("Vector database name is required.");
      setVectorProgress(null);
      return;
    }

    setIsVectorWorking(true);
    setVectorProgress({
      label: "Starting ingestion",
      detail: generatedVectorDbId,
      current: 0,
      total: 4,
      status: "working",
    });

    try {
      const zimPaths = await resolveSelectedZimPaths();

      if (zimPaths.length === 0) return;

      setVectorStatus(`Building ${generatedVectorDbId}...`);
      setVectorProgress({
        label: zimPaths.length === 1 ? "Ingesting ZIM file" : "Building vector database",
        detail: `${zimPaths.length} ZIM file(s)`,
        current: zimPaths.length === 1 ? 0 : undefined,
        total: zimPaths.length === 1 ? 1 : undefined,
        indeterminate: zimPaths.length !== 1,
        status: "working",
      });
      await ingestMultiple(baseUrl, zimPaths, generatedVectorDbId);
      setVectorProgress({
        label: zimPaths.length === 1 ? "ZIM file ingested" : "Vector database built",
        detail: `${zimPaths.length} ZIM file(s)`,
        current: zimPaths.length === 1 ? 1 : undefined,
        total: zimPaths.length === 1 ? 1 : undefined,
        indeterminate: zimPaths.length !== 1,
        status: "working",
      });

      setVectorStatus(`Loading ${generatedVectorDbId}...`);
      setVectorProgress({
        label: "Loading vector database",
        detail: generatedVectorDbId,
        current: 3,
        total: 4,
        status: "working",
      });
      await loadVectorDb(baseUrl, generatedVectorDbId);

      const nextHealth = await getHealth(baseUrl);
      setHealth(nextHealth);
      setActiveVectorDbPath(generatedVectorDbId);
      setVectorStatus(`Vector database ready: ${generatedVectorDbId}`);
      setVectorProgress({
        label: "Vector database ready",
        detail: generatedVectorDbId,
        current: 4,
        total: 4,
        status: "ready",
      });
    } catch (caught) {
      setVectorStatus(
        caught instanceof Error ? caught.message : "Unable to set up the knowledge base.",
      );
      setVectorProgress({
        label: "Ingestion failed",
        detail: caught instanceof Error ? caught.message : "Unable to set up the knowledge base.",
        status: "failed",
      });
    } finally {
      setIsVectorWorking(false);
    }
  }

  async function saveCollection() {
    if (!collectionName.trim()) {
      setVectorStatus("Collection name is required.");
      setVectorProgress(null);
      return;
    }

    setIsVectorWorking(true);
    setVectorProgress({
      label: "Starting collection save",
      detail: generatedCollectionId,
      current: 0,
      total: 3,
      status: "working",
    });

    try {
      const zimPaths = await resolveSelectedZimPaths();

      if (zimPaths.length === 0) return;

      setVectorStatus(`Creating collection ${generatedCollectionId}...`);
      setVectorProgress({
        label: "Creating collection",
        detail: `${zimPaths.length} ZIM file(s)`,
        indeterminate: true,
        status: "working",
      });
      await createCollection(
        baseUrl,
        generatedCollectionId,
        collectionName.trim(),
        collectionDescription.trim() || "Created by TSRC from selected ZIM files.",
        zimPaths,
      );

      await refreshCollections();
      setVectorStatus(`Collection ready: ${generatedCollectionId}`);
      setVectorProgress({
        label: "Collection ready",
        detail: generatedCollectionId,
        current: 3,
        total: 3,
        status: "ready",
      });
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to create collection.");
      setVectorProgress({
        label: "Collection failed",
        detail: caught instanceof Error ? caught.message : "Unable to create collection.",
        status: "failed",
      });
    } finally {
      setIsVectorWorking(false);
    }
  }

  async function refreshVectorDatabases() {
    setIsVectorDbLoading(true);
    setVectorStatus("");

    try {
      const roots = [config?.zim_source_folder, localBrowserPath].filter(Boolean) as string[];
      const databases = await listVectorDatabases(roots);
      setVectorDatabases(databases);
      setVectorStatus(`Found ${databases.length} vector database(s).`);
    } catch (caught) {
      setVectorStatus(
        caught instanceof Error ? caught.message : "Unable to discover vector databases.",
      );
    } finally {
      setIsVectorDbLoading(false);
    }
  }

  async function deployVectorDatabase(database: VectorDatabaseSummary) {
    if (isVectorDatabaseActive(database)) {
      setVectorStatus(`${database.name} is already deployed.`);
      return;
    }

    setIsVectorWorking(true);
    setVectorStatus(`Deploying ${database.name}...`);

    try {
      await loadVectorDb(baseUrl, database.path);
      const nextHealth = await getHealth(baseUrl);
      setHealth(nextHealth);
      setActiveVectorDbPath(database.path);
      setVectorStatus(`Deployed ${database.name}.`);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to deploy database.");
    } finally {
      setIsVectorWorking(false);
    }
  }

  function isVectorDatabaseActive(database: VectorDatabaseSummary) {
    if (!health?.db_loaded || !activeVectorDbId) return false;

    const databasePath = normalizePathId(database.path);
    const databaseName = normalizePathId(database.name);

    return (
      activeVectorDbId === databasePath ||
      activeVectorDbId === databaseName ||
      activeVectorDbId.endsWith(`/${database.name}`)
    );
  }

  function openFullScreen(section: ActivityId) {
    if (isSettingsMode) {
      setSettingsSection(section);
      return;
    }

    setActiveSidebar(null);
    setIsSettingsMode(false);
    setActiveActivity(section);
  }

  function noteMissingFullScreenView(label: string, settingsFallback?: SettingsSection) {
    if (isSettingsMode) {
      if (settingsFallback) setSettingsSection(settingsFallback);
      return;
    }

    setIsSettingsMode(false);
    setActiveSidebar(null);
    setError(`${label} does not have a full-screen view yet. Right-click its navbar icon to open the sidebar.`);
  }

  function openSidebar(section: SidebarId) {
    if (isSettingsMode) {
      setSettingsSection(section);
      return;
    }

    if (activeSidebar === section) {
      setActiveSidebar(null);
      return;
    }

    setIsSettingsMode(false);

    if (isSidebarCapableActivity(section) && activeActivity === section) {
      return;
    }

    setActiveSidebar(section);
  }

  function isSidebarCapableActivity(section: SidebarId): section is SidebarCapableActivityId {
    return section === "chat" || section === "search" || section === "downloads";
  }

  function handleSidebarContextMenu(event: MouseEvent, section: SidebarId) {
    event.preventDefault();
    openSidebar(section);
  }

  function toggleSettingsMode() {
    if (!isSettingsMode) {
      if (activeSidebar) {
        setSettingsSection(activeSidebar);
      } else if (
        activeActivity === "chat" ||
        activeActivity === "search" ||
        activeActivity === "downloads" ||
        activeActivity === "browser"
      ) {
        setSettingsSection(activeActivity);
      } else {
        setSettingsSection("chat");
      }
    }

    setIsSettingsMode((current) => !current);
  }

  const settingsTitle = {
    chat: "Chat settings",
    search: "Create settings",
    files: "File settings",
    browser: "Browser settings",
    serving: "Serving settings",
    downloads: "Download settings",
    databases: "Vector database settings",
  }[settingsSection];

  function applyBrowserViewState(state?: BrowserViewState | null) {
    if (!state) return;

    setBrowserUrl(state.url);
    setBrowserInput(state.url);
    setBrowserTitle(state.title || "Web browser");
    setIsBrowserLoading(state.loading);
    setBrowserCanGoBack(state.canGoBack);
    setBrowserCanGoForward(state.canGoForward);
  }

  function getBrowserFrameBounds(): BrowserViewBounds | null {
    const frame = browserFrameRef.current;
    if (!frame) return null;

    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  function submitBrowserNavigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = normalizeBrowserUrl(browserInput);
    if (!nextUrl) return;

    void navigateBrowserTo(nextUrl);
  }

  async function navigateBrowserTo(nextUrl: string) {
    setBrowserInput(nextUrl);
    setBrowserUrl(nextUrl);
    await window.tensorDesktop?.navigateBrowserView?.(nextUrl).then((state) => {
      applyBrowserViewState(state);
    });
  }

  function openBrowserUrlExternally() {
    if (window.tensorDesktop?.browserOpenExternal) {
      void window.tensorDesktop.browserOpenExternal(browserUrl);
      return;
    }

    window.open(browserUrl, "_blank", "noopener,noreferrer");
  }

  function getDownloadTaskDetail(task: DownloadTask) {
    if (task.status === "downloading" && task.totalBytes && task.totalBytes > 0) {
      const percent = Math.min(100, Math.round(((task.receivedBytes ?? 0) / task.totalBytes) * 100));
      return `${formatBytes(task.receivedBytes ?? 0)} of ${formatBytes(task.totalBytes)} (${percent}%)`;
    }

    if (task.status === "downloading" && task.receivedBytes) {
      return `${formatBytes(task.receivedBytes)} downloaded`;
    }

    return task.path ?? task.sourceUrl ?? task.fileName;
  }

  function getDownloadProgress(task: DownloadTask) {
    if (!task.totalBytes || task.totalBytes <= 0) return null;

    return Math.min(100, Math.round(((task.receivedBytes ?? 0) / task.totalBytes) * 100));
  }

  function renderDownloadProgress(task: DownloadTask) {
    const progress = getDownloadProgress(task);

    if (progress === null) {
      return task.status === "downloading" ? <div className="download-progress indeterminate" /> : null;
    }

    return (
      <div
        className="download-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    );
  }

  function renderVectorProgress() {
    if (!vectorProgress) return null;

    const progress =
      vectorProgress.total && vectorProgress.total > 0 && vectorProgress.current !== undefined
        ? Math.min(100, Math.round((vectorProgress.current / vectorProgress.total) * 100))
        : null;
    const isIndeterminate = vectorProgress.indeterminate || progress === null;

    return (
      <div className={`vector-progress-card ${vectorProgress.status}`}>
        <div className="vector-progress-heading">
          <strong>{vectorProgress.label}</strong>
          {progress !== null && <span>{progress}%</span>}
        </div>
        {vectorProgress.detail && <small>{vectorProgress.detail}</small>}
        <div
          className={`download-progress ${isIndeterminate ? "indeterminate" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
        >
          {!isIndeterminate && <span style={{ width: `${progress}%` }} />}
        </div>
      </div>
    );
  }

  async function chooseZimitOutputDirectory() {
    try {
      const folderPath = await chooseLocalFolder();
      if (folderPath) setZimitOutputDir(folderPath);
    } catch (caught) {
      setZimitStatus(caught instanceof Error ? caught.message : "Unable to choose output folder.");
    }
  }

  function zimitNumber(value: string) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  function setZimitScopeExcludeTags(tags: string[]) {
    const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    setZimitScopeExclude(normalizedTags.join("\n"));
  }

  function addZimitScopeExcludeTag(value = zimitScopeExcludeDraft) {
    const nextTags = value
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (nextTags.length === 0) return;

    setZimitScopeExcludeTags([...zimitScopeExcludeTags, ...nextTags]);
    setZimitScopeExcludeDraft("");
  }

  function removeZimitScopeExcludeTag(index: number) {
    setZimitScopeExcludeTags(zimitScopeExcludeTags.filter((_, tagIndex) => tagIndex !== index));
  }

  function handleZimitScopeExcludeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addZimitScopeExcludeTag();
    }
  }

  function renderZimitScopeExcludeInput(className = "") {
    return (
      <div className={`field tag-field ${className}`.trim()}>
        <span id="zimit-scope-exclude-label">Scope exclude regex</span>
        <div className="tag-input-shell">
          {zimitScopeExcludeTags.map((tag, index) => (
            <button
              className="tag-chip"
              type="button"
              key={`${tag}-${index}`}
              onClick={() => removeZimitScopeExcludeTag(index)}
              title="Remove regex"
            >
              <span>{tag}</span>
              <span aria-hidden="true">x</span>
            </button>
          ))}
          <input
            value={zimitScopeExcludeDraft}
            onChange={(event) => setZimitScopeExcludeDraft(event.target.value)}
            onKeyDown={handleZimitScopeExcludeKeyDown}
            onBlur={() => addZimitScopeExcludeTag()}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (!/\r?\n/.test(text)) return;
              event.preventDefault();
              addZimitScopeExcludeTag(text);
            }}
            placeholder={zimitScopeExcludeTags.length === 0 ? "\\?q= or /login" : "Add regex"}
            aria-label="Add scope exclude regex"
            aria-labelledby="zimit-scope-exclude-label"
          />
        </div>
      </div>
    );
  }

  async function startZimitCapture() {
    const seedUrl = normalizeBrowserUrl(browserUrl);
    if (!seedUrl) {
      setZimitStatus("Open a website before starting a Zimit capture.");
      return;
    }

    if (!window.tensorDesktop?.startZimitCapture) {
      setZimitStatus("Restart TSRC to enable local Zimit captures.");
      return;
    }

    const request: ZimitCaptureRequest = {
      seedUrl,
      name: zimitName.trim() || slugifyId(browserTitle, "website_capture"),
      outputDir: zimitOutputDir.trim() || config?.zim_source_folder?.trim() || undefined,
      pageLimit: zimitNumber(zimitPageLimit),
      workers: zimitNumber(zimitWorkers),
      waitUntil: zimitWaitUntil,
      scopeExcludeRx: zimitScopeExcludeTags,
      keep: zimitKeep,
      disableAdBlocking: zimitDisableAdBlocking,
      image: zimitImage.trim() || undefined,
      extraArgs: zimitExtraArgs.trim() || undefined,
    };

    setIsZimitStarting(true);
    setZimitStatus("Starting Zimit capture...");

    try {
      const task = await window.tensorDesktop.startZimitCapture(request);
      setDownloadTasks((current) => ({ ...current, [task.id]: toDownloadTask(task) }));
      setZimitStatus("Capture started. Track progress in Downloads.");
      setIsDownloadListOpen(true);
      setActiveSidebar("downloads");
    } catch (caught) {
      setZimitStatus(caught instanceof Error ? caught.message : "Unable to start Zimit.");
    } finally {
      setIsZimitStarting(false);
    }
  }

  async function cancelZimitCapture(taskId: string) {
    const task = await window.tensorDesktop?.cancelZimitCapture?.(taskId);
    if (task) {
      setDownloadTasks((current) => ({ ...current, [task.id]: toDownloadTask(task) }));
    }
  }

  function resetConversation() {
    setMessages([
      createMessage("assistant", "Tensor client ready. Connect to Tensor Serve and start chatting."),
    ]);
    setDraft("");
  }

  function clearFinishedDownloads() {
    setDownloadTasks((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, task]) => task.status === "downloading"),
      ),
    );
  }

  return (
    <main className={`app-shell ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <nav className="activity-bar" aria-label="Primary navigation">
        <div className="activity-group">
          <button
            className={`activity-button ${chatNavActive ? "active" : ""}`}
            type="button"
            aria-label="Chat"
            aria-pressed={chatNavActive}
            title="Chat"
            onClick={() => openFullScreen("chat")}
            onContextMenu={(event) => handleSidebarContextMenu(event, "chat")}
          >
            <MessageSquare size={22} />
          </button>
          <button
            className={`activity-button ${searchNavActive ? "active" : ""}`}
            type="button"
            aria-label="Create"
            aria-pressed={searchNavActive}
            title="Create"
            onClick={() => openFullScreen("search")}
            onContextMenu={(event) => handleSidebarContextMenu(event, "search")}
          >
            <Plus size={22} />
          </button>
          <button
            className={`activity-button ${browserNavActive ? "active" : ""}`}
            type="button"
            aria-label="Browser"
            aria-pressed={browserNavActive}
            title="Browser"
            onClick={() => openFullScreen("browser")}
          >
            <Globe2 size={22} />
          </button>
        </div>

        <div className="activity-group">
          <button
            className={`activity-button ${servingNavActive ? "active" : ""}`}
            type="button"
            aria-label="Serving"
            aria-pressed={servingNavActive}
            title="Serving"
            onClick={() => openSidebar("serving")}
            onContextMenu={(event) => handleSidebarContextMenu(event, "serving")}
          >
            <Server size={22} />
          </button>
          <button
            className={`activity-button ${downloadsNavActive ? "active" : ""}`}
            type="button"
            aria-label="Downloads"
            aria-pressed={downloadsNavActive}
            title="Downloads"
            onClick={() => openFullScreen("downloads")}
            onContextMenu={(event) => handleSidebarContextMenu(event, "downloads")}
          >
            <Download size={22} />
          </button>
          <button
            className={`activity-button ${databaseNavActive ? "active" : ""}`}
            type="button"
            aria-label="Vector databases"
            aria-pressed={databaseNavActive}
            title="Vector databases"
            onClick={() => openSidebar("databases")}
            onContextMenu={(event) => handleSidebarContextMenu(event, "databases")}
          >
            <Database size={22} />
          </button>
          <button
            className={`activity-button ${isSettingsMode ? "active" : ""}`}
            type="button"
            aria-label="Settings"
            aria-pressed={isSettingsMode}
            title="Settings"
            onClick={toggleSettingsMode}
          >
            <Settings2 size={22} />
          </button>
        </div>
      </nav>

      {isChatPanelOpen && (
        <aside className="sidebar chat-sidebar">
          <div className="brand">
            <div className="brand-mark">
              <MessageSquare size={22} />
            </div>
            <div>
              <h1>Chat</h1>
              <p>{activeModel || "No model selected"}</p>
            </div>
          </div>

          <section className="panel sidebar-chat-panel">
            <div className="status-row">
              <span className={`status-dot ${isConnected ? "online" : ""}`} />
              <strong>{statusLabel}</strong>
            </div>

            {error && (
              <div className="sidebar-error" role="alert">
                <CircleAlert size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="sidebar-message-list">
              {messages.map((message) => (
                <article className={`sidebar-message ${message.role}`} key={message.id}>
                  <div className="avatar">
                    {message.role === "user" ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className="bubble">{message.content}</div>
                </article>
              ))}

              {isSending && (
                <article className="sidebar-message assistant">
                  <div className="avatar">
                    <Bot size={16} />
                  </div>
                  <div className="bubble loading">
                    <Loader2 className="spin" size={16} />
                    Thinking
                  </div>
                </article>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="sidebar-composer" onSubmit={submitMessage}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Ask Tensor Serve..."
                rows={2}
              />
              <button className="send-button wide-button" disabled={!draft.trim() || isSending}>
                {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                Send
              </button>
            </form>
          </section>
        </aside>
      )}

      {isSearchPanelOpen && (
        <aside className="sidebar create-sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Plus size={22} />
            </div>
            <div>
              <h1>Create</h1>
              <p>{selectedSourceCount} selected source(s)</p>
            </div>
          </div>

          <section className="create-sidebar-section">
            <h3>Sources</h3>
            <div className="setup-tabs create-sidebar-tabs" role="tablist" aria-label="Create source">
              <button
                className={vectorSource === "local" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={vectorSource === "local"}
                onClick={() => setVectorSource("local")}
              >
                Local
              </button>
              <button
                className={vectorSource === "collections" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={vectorSource === "collections"}
                onClick={() => {
                  setVectorSource("collections");
                  if (availableCollections.length === 0) void refreshCollections();
                }}
              >
                Collections
              </button>
              <button
                className={vectorSource === "archive" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={vectorSource === "archive"}
                onClick={() => setVectorSource("archive")}
              >
                Archive
              </button>
            </div>

            {vectorSource === "local" && (
              <div className="create-sidebar-list">
                {localBrowserPath ? (
                  <div className="local-browser-path compact-path">
                    <strong>{localBrowserPath}</strong>
                    <small>{localBrowserEntries.length} visible item(s)</small>
                  </div>
                ) : (
                  <div className="sidebar-empty">
                    <strong>No folder opened</strong>
                    <small>Open a folder to browse local ZIM files.</small>
                  </div>
                )}
                {localBrowserParentPath && (
                  <button
                    className="tree-row"
                    type="button"
                    onClick={() => void openLocalDirectory(localBrowserParentPath)}
                  >
                    <ChevronLeft size={16} />
                    <span>
                      <strong>Parent folder</strong>
                      <small>{localBrowserParentPath}</small>
                    </span>
                  </button>
                )}
                {localBrowserEntries.map((entry) => {
                  const isSelected = selectedLocalZims.some((item) => item.path === entry.path);

                  return (
                    <button
                      className={`tree-row ${isSelected ? "selected" : ""}`}
                      type="button"
                      key={entry.path}
                      onClick={() =>
                        entry.type === "directory"
                          ? void openLocalDirectory(entry.path)
                          : toggleLocalZim(entry)
                      }
                    >
                      {entry.type === "directory" ? <FolderOpen size={16} /> : <FileIcon size={16} />}
                      <span>
                        <strong>{entry.name}</strong>
                        <small>
                          {entry.type === "directory"
                            ? "Folder"
                            : `${Math.round((entry.sizeBytes ?? 0) / 1024 / 1024)} MB`}
                        </small>
                      </span>
                    </button>
                  );
                })}
                <button
                  className="secondary-button wide-button"
                  type="button"
                  onClick={() => void chooseLocalDirectory()}
                >
                  <FolderOpen size={16} />
                  Choose folder
                </button>
              </div>
            )}

            {vectorSource === "collections" && (
              <div className="create-sidebar-list">
                <button
                  className="secondary-button wide-button"
                  type="button"
                  onClick={() => void refreshCollections()}
                  disabled={isCollectionsLoading}
                >
                  {isCollectionsLoading ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <RefreshCcw size={16} />
                  )}
                  Refresh collections
                </button>
                {availableCollections.length === 0 ? (
                  <div className="sidebar-empty">
                    <strong>No collections loaded</strong>
                    <small>Refresh Tensor Serve collections.</small>
                  </div>
                ) : (
                  availableCollections.map((collection) => {
                    const isSelected = selectedCollections.some((item) => item.id === collection.id);

                    return (
                      <button
                        className={`tree-row ${isSelected ? "selected" : ""}`}
                        type="button"
                        key={collection.id}
                        onClick={() => void toggleCollection(collection)}
                        disabled={isCollectionsLoading}
                      >
                        <Database size={16} />
                        <span>
                          <strong>{collection.name}</strong>
                          <small>{collection.file_count} file(s) · {collection.category || "collection"}</small>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {vectorSource === "archive" && (
              <div className="create-sidebar-list">
                <form className="sidebar-archive-search" onSubmit={submitCatalogSearch}>
                  <label className="field">
                    <span>Search archive</span>
                    <input
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                      placeholder="python, devdocs..."
                    />
                  </label>
                  <label className="field">
                    <span>Language</span>
                    <input
                      value={catalogLanguage}
                      onChange={(event) => setCatalogLanguage(event.target.value)}
                      placeholder="eng"
                    />
                  </label>
                  <button className="secondary-button wide-button" type="submit" disabled={isCatalogLoading}>
                    {isCatalogLoading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                    Search archive
                  </button>
                </form>
                {catalogResults.length === 0 ? (
                  <div className="sidebar-empty">
                    <strong>No archive results</strong>
                    <small>Search Kiwix to find ZIM files.</small>
                  </div>
                ) : (
                  catalogResults.slice(0, 8).map((entry) => {
                    const task = downloadTasks[entry.id];
                    const isReady = Boolean(downloadedZims[entry.id]) || task?.status === "ready";

                    return (
                      <article className="archive-sidebar-item" key={entry.id}>
                        <div>
                          <strong>{entry.title}</strong>
                          <small>{entry.language} · {entry.category} · {formatBytes(entry.sizeBytes)}</small>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void downloadCatalogEntry(entry)}
                          disabled={task?.status === "downloading" || isReady}
                        >
                          {task?.status === "downloading" ? (
                            <Loader2 className="spin" size={14} />
                          ) : isReady ? (
                            <CircleCheck size={14} />
                          ) : (
                            <Download size={14} />
                          )}
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            )}
          </section>

          <section className="create-sidebar-section create-output-section">
            <h3>Knowledge output</h3>
            <label className="field">
              <span>Type</span>
              <select
                value={vectorSetupMode}
                onChange={(event) => setVectorSetupMode(event.target.value as VectorSetupMode)}
              >
                <option value="database">Vector database</option>
                <option value="collection">Collection</option>
              </select>
            </label>

            {vectorSetupMode === "database" ? (
              <>
                <label className="field">
                  <span>Name</span>
                  <input
                    value={vectorDbName}
                    onChange={(event) => setVectorDbName(event.target.value)}
                  />
                </label>
                <p className="generated-id">ID: {generatedVectorDbId}</p>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Name</span>
                  <input
                    value={collectionName}
                    onChange={(event) => setCollectionName(event.target.value)}
                  />
                </label>
                <p className="generated-id">ID: {generatedCollectionId}</p>
                <label className="field">
                  <span>Description</span>
                  <textarea
                    value={collectionDescription}
                    onChange={(event) => setCollectionDescription(event.target.value)}
                    rows={3}
                  />
                </label>
              </>
            )}

            <div className="selected-list create-sidebar-selected">
              <span>{selectedSourceCount} selected ZIM file(s)</span>
              {selectedLocalZims.map((file) => (
                <div key={file.path}>
                  <strong>{file.fileName}</strong>
                  <small>{file.path}</small>
                  <button type="button" onClick={() => removeLocalZim(file.path)}>
                    Remove
                  </button>
                </div>
              ))}
              {selectedCollections.map((collection) => {
                const fileCount = (collection.files ?? collection.zim_files ?? []).filter(
                  (file) => file.path && file.installed !== false,
                ).length;

                return (
                  <div key={collection.id}>
                    <strong>{collection.name}</strong>
                    <small>
                      {collection.id} · {fileCount} collection file(s)
                    </small>
                    <button type="button" onClick={() => removeSelectedCollection(collection.id)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              className="send-button wide-button"
              type="button"
              disabled={isVectorWorking || selectedSourceCount === 0}
              onClick={() =>
                vectorSetupMode === "database"
                  ? void setupKnowledgeBase()
                  : void saveCollection()
              }
            >
              {isVectorWorking ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
              {vectorSetupMode === "database" ? "Build database" : "Create collection"}
            </button>

            {renderVectorProgress()}
            {vectorStatus && <p className="vector-status">{vectorStatus}</p>}
          </section>
        </aside>
      )}

      {isServingPanelOpen && (
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">T</div>
            <div>
              <h1>TSRC</h1>
              <p>Tensor Serve client</p>
            </div>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <Settings2 size={18} aria-hidden="true" />
              <h2>Connection</h2>
            </div>

            <button
              className="secondary-button apply-button wide-button"
              onClick={() =>
                tensorServeProcess.running ? void haltTensorServe() : void launchTensorServe()
              }
              disabled={isChecking || !tensorServeCommand.trim()}
              type="button"
            >
              {isChecking ? (
                <Loader2 className="spin" size={16} />
              ) : tensorServeProcess.running ? (
                <CircleAlert size={16} />
              ) : (
                <PlugZap size={16} />
              )}
              {tensorServeProcess.running ? "Stop Tensor Serve" : "Start Tensor Serve"}
            </button>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <Bot size={18} aria-hidden="true" />
              <h2>Model</h2>
            </div>
            <label className="field">
              <span>Local AI endpoint</span>
              <input
                value={localAiEndpoint}
                onChange={(event) => setLocalAiEndpoint(event.target.value)}
                placeholder="http://localhost:1234"
              />
            </label>

            <label className="field">
              <span>Model</span>
              <select
                value={activeModelValue}
                onChange={(event) => void selectModel(event.target.value)}
                disabled={modelOptions.length === 0}
              >
                <option value="">
                  {modelOptions.length === 0 ? "No models detected" : "Select a model"}
                </option>
                {modelOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="button-row">
              <button
                className="secondary-button"
                onClick={() => void refreshConnection()}
                disabled={isChecking}
                type="button"
              >
                {isChecking ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                Refresh
              </button>
              <button
                className="secondary-button apply-button"
                onClick={() => void applyLocalAiConfig()}
                disabled={isChecking || !activeModel || !localAiEndpoint.trim()}
                type="button"
              >
                <CircleCheck size={16} />
                Apply
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="status-row">
              <span className={`status-dot ${isConnected ? "online" : ""}`} />
              <strong>{statusLabel}</strong>
            </div>
            <dl className="facts">
              <div>
                <dt>Host</dt>
                <dd>{tensorServeProcess.running ? "TSRC" : "External"}</dd>
              </div>
              <div>
                <dt>AI</dt>
                <dd>{health?.ai_configured ? "Configured" : "Not live"}</dd>
              </div>
              <div>
                <dt>Tensor Serve</dt>
                <dd>{baseUrl}</dd>
              </div>
              <div>
                <dt>Hosted</dt>
                <dd>
                  {tensorServeProcess.running
                    ? tensorServeProcess.pid
                      ? `PID ${tensorServeProcess.pid}`
                      : "Yes"
                    : tensorServeProcess.exitCode !== null
                      ? `Exited ${tensorServeProcess.exitCode}`
                      : "No"}
                </dd>
              </div>
              <div>
                <dt>Vector DB</dt>
                <dd>{health?.db_loaded ? "Loaded" : "Not loaded"}</dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>{health?.active_collection ?? "None"}</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>{config?.context_size ?? "Default"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel console-panel">
            <div className="panel-heading">
              <Server size={18} aria-hidden="true" />
              <h2>Tensor Serve console</h2>
            </div>
            <div className="process-log" aria-label="Tensor Serve process log">
              {tensorServeProcess.logs.length > 0 ? (
                tensorServeProcess.logs.slice(-8).map((line, index) => (
                  <code key={`${line}-${index}`}>{line}</code>
                ))
              ) : (
                <code>No Tensor Serve output yet.</code>
              )}
            </div>
          </section>
        </aside>
      )}

      {isDownloadsPanelOpen && (
        <aside className="sidebar downloads-sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Download size={22} />
            </div>
            <div>
              <h1>Downloads</h1>
              <p>Ongoing queue</p>
            </div>
          </div>

          <section className="panel downloads-list-panel">
            <button
              className="downloads-collapse"
              type="button"
              onClick={() => setIsDownloadListOpen((current) => !current)}
              aria-expanded={isDownloadListOpen}
            >
              <span>
                <Download size={18} aria-hidden="true" />
                <strong>Ongoing downloads</strong>
              </span>
              <small>{downloadTaskList.length}</small>
            </button>

            {isDownloadListOpen && (
              <div className="downloads-task-list">
                {downloadTaskList.length === 0 ? (
                  <div className="sidebar-empty">
                    <strong>No downloads yet</strong>
                    <small>Open Downloads full screen to search the archive.</small>
                  </div>
                ) : (
                  downloadTaskList.map((task) => (
                    <article className={`download-task ${task.status}`} key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <small>{getDownloadTaskDetail(task)}</small>
                        {task.status === "downloading" && task.logs?.at(-1) && (
                          <small>{task.logs.at(-1)}</small>
                        )}
                        {task.error && <small>{task.error}</small>}
                        {renderDownloadProgress(task)}
                      </div>
                      <span className="download-task-status">
                        {task.status === "downloading" && <Loader2 className="spin" size={14} />}
                        {task.status === "ready" && <CircleCheck size={14} />}
                        {task.status === "failed" && <CircleAlert size={14} />}
                        {task.status}
                      </span>
                    </article>
                  ))
                )}
              </div>
            )}
          </section>
        </aside>
      )}

      {isDatabasePanelOpen && (
        <aside className="sidebar database-sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Database size={22} />
            </div>
            <div>
              <h1>Vector DBs</h1>
              <p>Deploy local databases</p>
            </div>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <Database size={18} aria-hidden="true" />
              <h2>Deployment</h2>
            </div>
            <dl className="facts database-status-facts">
              <div>
                <dt>Vector DB</dt>
                <dd>{health?.db_loaded ? "Loaded" : "Not loaded"}</dd>
              </div>
              <div>
                <dt>Search</dt>
                <dd>{health?.bm25_loaded ? "Hybrid" : health?.db_loaded ? "Semantic" : "None"}</dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>{vectorDatabases.length}</dd>
              </div>
            </dl>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void refreshVectorDatabases()}
              disabled={isVectorDbLoading}
            >
              {isVectorDbLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              Refresh
            </button>
          </section>

          <section className="panel database-sidebar-list">
            <div className="panel-heading">
              <PlugZap size={18} aria-hidden="true" />
              <h2>Available databases</h2>
            </div>

            {vectorDatabases.length === 0 ? (
              <div className="sidebar-empty">
                <strong>No databases found</strong>
                <small>Build one from Search, then deploy it here.</small>
              </div>
            ) : (
              <div className="database-sidebar-items">
                {vectorDatabases.map((database) => {
                  const isActive = isVectorDatabaseActive(database);

                  return (
                    <article className={`database-sidebar-item ${isActive ? "active" : ""}`} key={database.path}>
                      <div>
                        <strong>{database.name}</strong>
                        <small>{database.path}</small>
                      </div>
                      <dl className="database-facts">
                        <div>
                          <dt>Search</dt>
                          <dd>{database.hasBm25 ? "Hybrid" : "Semantic"}</dd>
                        </div>
                        <div>
                          <dt>Size</dt>
                          <dd>{formatBytes(database.sizeBytes)}</dd>
                        </div>
                      </dl>
                      <button
                        className="send-button wide-button"
                        type="button"
                        onClick={() => void deployVectorDatabase(database)}
                        disabled={isVectorWorking || isActive}
                      >
                        {isVectorWorking && !isActive ? (
                          <Loader2 className="spin" size={16} />
                        ) : isActive ? (
                          <CircleCheck size={16} />
                        ) : (
                          <PlugZap size={16} />
                        )}
                        {isActive ? "Deployed" : "Deploy"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            {vectorStatus && <p className="vector-status">{vectorStatus}</p>}
          </section>
        </aside>
      )}

      {isSettingsMode && (
        <section className="settings-surface" aria-label="Settings">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>{settingsTitle}</h2>
            </div>
            <div className="connection-pill connected">
              <Settings2 size={16} />
              Settings mode
            </div>
          </header>

          <div className="settings-layout">
            {settingsSection === "chat" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Model</h3>
                  <label className="field">
                    <span>Local AI endpoint</span>
                    <input
                      value={localAiEndpoint}
                      onChange={(event) => setLocalAiEndpoint(event.target.value)}
                      placeholder="http://localhost:1234"
                    />
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <select
                      value={activeModelValue}
                      onChange={(event) => void selectModel(event.target.value)}
                      disabled={modelOptions.length === 0}
                    >
                      <option value="">
                        {modelOptions.length === 0 ? "No models detected" : "Select a model"}
                      </option>
                      {modelOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void refreshConnection()}
                      disabled={isChecking}
                    >
                      {isChecking ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <RefreshCcw size={16} />
                      )}
                      Refresh
                    </button>
                    <button
                      className="secondary-button apply-button"
                      type="button"
                      onClick={() => void applyLocalAiConfig()}
                      disabled={isChecking || !activeModel || !localAiEndpoint.trim()}
                    >
                      <CircleCheck size={16} />
                      Apply
                    </button>
                  </div>
                </section>

                <section className="settings-panel">
                  <h3>Conversation</h3>
                  <dl className="facts">
                    <div>
                      <dt>Active model</dt>
                      <dd>{activeModel || "None"}</dd>
                    </div>
                    <div>
                      <dt>Context</dt>
                      <dd>{config?.context_size ?? "Default"}</dd>
                    </div>
                    <div>
                      <dt>Messages</dt>
                      <dd>{messages.length}</dd>
                    </div>
                    <div>
                      <dt>Connection</dt>
                      <dd>{statusLabel}</dd>
                    </div>
                  </dl>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={resetConversation}
                    >
                      <MessageSquare size={16} />
                      Reset chat
                    </button>
                  </div>
                </section>
              </div>
            )}

            {settingsSection === "search" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Kiwix catalog</h3>
                  <label className="field">
                    <span>Default search</span>
                    <input
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Language</span>
                    <input
                      value={catalogLanguage}
                      onChange={(event) => setCatalogLanguage(event.target.value)}
                    />
                  </label>
                </section>

                <section className="settings-panel">
                  <h3>Create defaults</h3>
                  <label className="field">
                    <span>Default source</span>
                    <select
                      value={vectorSource}
                      onChange={(event) => setVectorSource(event.target.value as VectorSource)}
                    >
                      <option value="local">Local files</option>
                      <option value="collections">Collections</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Default create type</span>
                    <select
                      value={vectorSetupMode}
                      onChange={(event) => setVectorSetupMode(event.target.value as VectorSetupMode)}
                    >
                      <option value="database">Vector database</option>
                      <option value="collection">Collection</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Vector database name</span>
                    <input
                      value={vectorDbName}
                      onChange={(event) => setVectorDbName(event.target.value)}
                    />
                  </label>
                  <p className="generated-id">ID: {generatedVectorDbId}</p>
                  <label className="field">
                    <span>Collection name</span>
                    <input
                      value={collectionName}
                      onChange={(event) => setCollectionName(event.target.value)}
                    />
                  </label>
                  <p className="generated-id">ID: {generatedCollectionId}</p>
                  <label className="field">
                    <span>Collection description</span>
                    <textarea
                      value={collectionDescription}
                      onChange={(event) => setCollectionDescription(event.target.value)}
                      rows={3}
                    />
                  </label>
                </section>
              </div>
            )}

            {settingsSection === "files" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Local files</h3>
                  <dl className="facts">
                    <div>
                      <dt>Browser path</dt>
                      <dd>{localBrowserPath || "Not opened"}</dd>
                    </div>
                    <div>
                      <dt>ZIM source</dt>
                      <dd>{config?.zim_source_folder ?? "Not configured"}</dd>
                    </div>
                    <div>
                      <dt>Selected ZIMs</dt>
                      <dd>{selectedLocalZims.length}</dd>
                    </div>
                    <div>
                      <dt>Collections</dt>
                      <dd>{selectedCollections.length}</dd>
                    </div>
                  </dl>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void openDefaultLocalDirectory()}
                    >
                      <FolderOpen size={16} />
                      Open default
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void chooseLocalDirectory()}
                    >
                      <FolderOpen size={16} />
                      Choose folder
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setSelectedLocalZims([]);
                        setSelectedCollections([]);
                      }}
                      disabled={selectedSourceCount === 0}
                    >
                      <CircleAlert size={16} />
                      Clear selected
                    </button>
                  </div>
                </section>
              </div>
            )}

            {settingsSection === "browser" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Browser</h3>
                  <label className="field">
                    <span>Home page</span>
                    <input
                      value={browserHomeUrl}
                      onChange={(event) => setBrowserHomeUrl(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Current address</span>
                    <input
                      value={browserInput}
                      onChange={(event) => setBrowserInput(event.target.value)}
                    />
                  </label>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void navigateBrowserTo(normalizeBrowserUrl(browserInput))}
                      disabled={!browserInput.trim()}
                    >
                      <Globe2 size={16} />
                      Navigate
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void navigateBrowserTo(normalizeBrowserUrl(browserHomeUrl))}
                      disabled={!browserHomeUrl.trim()}
                    >
                      <Home size={16} />
                      Home
                    </button>
                  </div>
                </section>

                <section className="settings-panel">
                  <h3>Zimit capture</h3>
                  <label className="field">
                    <span>Default ZIM name</span>
                    <input value={zimitName} onChange={(event) => setZimitName(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Output folder</span>
                    <input
                      value={zimitOutputDir}
                      onChange={(event) => setZimitOutputDir(event.target.value)}
                      placeholder={config?.zim_source_folder || "Downloads/TSRC Zimit"}
                    />
                  </label>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void chooseZimitOutputDirectory()}
                    >
                      <FolderOpen size={16} />
                      Folder
                    </button>
                  </div>
                  <label className="field">
                    <span>Page limit</span>
                    <input
                      value={zimitPageLimit}
                      onChange={(event) => setZimitPageLimit(event.target.value)}
                      inputMode="numeric"
                    />
                  </label>
                  <label className="field">
                    <span>Workers</span>
                    <input
                      value={zimitWorkers}
                      onChange={(event) => setZimitWorkers(event.target.value)}
                      inputMode="numeric"
                    />
                  </label>
                  <label className="field">
                    <span>Wait until</span>
                    <select
                      value={zimitWaitUntil}
                      onChange={(event) => setZimitWaitUntil(event.target.value)}
                    >
                      <option value="load">load</option>
                      <option value="domcontentloaded">domcontentloaded</option>
                      <option value="networkidle0">networkidle0</option>
                      <option value="networkidle2">networkidle2</option>
                    </select>
                  </label>
                </section>

                <section className="settings-panel">
                  <h3>Zimit advanced</h3>
                  <label className="field">
                    <span>Docker image</span>
                    <input value={zimitImage} onChange={(event) => setZimitImage(event.target.value)} />
                  </label>
                  {renderZimitScopeExcludeInput()}
                  <label className="field">
                    <span>Extra args</span>
                    <input
                      value={zimitExtraArgs}
                      onChange={(event) => setZimitExtraArgs(event.target.value)}
                    />
                  </label>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={zimitKeep}
                      onChange={(event) => setZimitKeep(event.target.checked)}
                    />
                    Keep crawl artifacts
                  </label>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={zimitDisableAdBlocking}
                      onChange={(event) => setZimitDisableAdBlocking(event.target.checked)}
                    />
                    Disable image ad filtering
                  </label>
                </section>
              </div>
            )}

            {settingsSection === "serving" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Tensor Serve host</h3>
                  <label className="field">
                    <span>Tensor Serve URL</span>
                    <input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="http://localhost:8000"
                    />
                  </label>
                  <label className="field">
                    <span>Launch command</span>
                    <input
                      value={tensorServeCommand}
                      onChange={(event) => setTensorServeCommand(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Working directory</span>
                    <input
                      value={tensorServeCwd}
                      onChange={(event) => setTensorServeCwd(event.target.value)}
                      placeholder="Optional Tensor Serve project folder"
                    />
                  </label>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void chooseTensorServeFolder()}
                    >
                      <FolderOpen size={16} />
                      Folder
                    </button>
                    <button
                      className="secondary-button apply-button"
                      type="button"
                      onClick={() =>
                        tensorServeProcess.running
                          ? void haltTensorServe()
                          : void launchTensorServe()
                      }
                      disabled={isChecking || !tensorServeCommand.trim()}
                    >
                      {isChecking ? (
                        <Loader2 className="spin" size={16} />
                      ) : tensorServeProcess.running ? (
                        <CircleAlert size={16} />
                      ) : (
                        <PlugZap size={16} />
                      )}
                      {tensorServeProcess.running ? "Stop" : "Start"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void refreshConnection()}
                      disabled={isChecking}
                    >
                      <RefreshCcw size={16} />
                      Connect
                    </button>
                  </div>
                </section>

                <section className="settings-panel">
                  <h3>Status</h3>
                  <dl className="facts">
                    <div>
                      <dt>Service</dt>
                      <dd>{statusLabel}</dd>
                    </div>
                    <div>
                      <dt>Hosted</dt>
                      <dd>{tensorServeProcess.running ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>PID</dt>
                      <dd>{tensorServeProcess.pid ?? "None"}</dd>
                    </div>
                  </dl>
                  {tensorServeProcess.logs.length > 0 && (
                    <div className="process-log" aria-label="Tensor Serve process log">
                      {tensorServeProcess.logs.slice(-6).map((line, index) => (
                        <code key={`${line}-${index}`}>{line}</code>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {settingsSection === "downloads" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Kiwix downloads</h3>
                  <label className="field">
                    <span>Default search</span>
                    <input
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Language</span>
                    <input
                      value={catalogLanguage}
                      onChange={(event) => setCatalogLanguage(event.target.value)}
                    />
                  </label>
                  <dl className="facts">
                    <div>
                      <dt>Downloaded</dt>
                      <dd>{Object.keys(downloadedZims).length}</dd>
                    </div>
                    <div>
                      <dt>Tracked</dt>
                      <dd>{downloadTaskList.length}</dd>
                    </div>
                    <div>
                      <dt>Active</dt>
                      <dd>{downloadTaskList.filter((task) => task.status === "downloading").length}</dd>
                    </div>
                    <div>
                      <dt>Save path</dt>
                      <dd>{config?.zim_source_folder || "System Downloads"}</dd>
                    </div>
                  </dl>
                  <div className="settings-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={clearFinishedDownloads}
                      disabled={downloadTaskList.every((task) => task.status === "downloading")}
                    >
                      <CircleCheck size={16} />
                      Clear finished
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void searchCatalog()}
                      disabled={isCatalogLoading}
                    >
                      {isCatalogLoading ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Search size={16} />
                      )}
                      Search catalog
                    </button>
                  </div>
                </section>
              </div>
            )}

            {settingsSection === "databases" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Discovery</h3>
                  <dl className="facts">
                    <div>
                      <dt>Available</dt>
                      <dd>{vectorDatabases.length}</dd>
                    </div>
                    <div>
                      <dt>Loaded</dt>
                      <dd>{health?.db_loaded ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Search</dt>
                      <dd>{health?.bm25_loaded ? "Hybrid" : health?.db_loaded ? "Semantic" : "None"}</dd>
                    </div>
                    <div>
                      <dt>Active</dt>
                      <dd>{activeVectorDbPath || "Unknown"}</dd>
                    </div>
                  </dl>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void refreshVectorDatabases()}
                    disabled={isVectorDbLoading}
                  >
                    {isVectorDbLoading ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <RefreshCcw size={16} />
                    )}
                    Refresh databases
                  </button>
                </section>

                <section className="settings-panel">
                  <h3>Create defaults</h3>
                  <label className="field">
                    <span>Vector database name</span>
                    <input
                      value={vectorDbName}
                      onChange={(event) => setVectorDbName(event.target.value)}
                    />
                  </label>
                  <p className="generated-id">ID: {generatedVectorDbId}</p>
                  <label className="field">
                    <span>Collection name</span>
                    <input
                      value={collectionName}
                      onChange={(event) => setCollectionName(event.target.value)}
                    />
                  </label>
                  <p className="generated-id">ID: {generatedCollectionId}</p>
                  <label className="field">
                    <span>Collection description</span>
                    <textarea
                      value={collectionDescription}
                      onChange={(event) => setCollectionDescription(event.target.value)}
                      rows={3}
                    />
                  </label>
                </section>

                <section className="settings-panel settings-list-panel">
                  <h3>Available databases</h3>
                  {vectorDatabases.length === 0 ? (
                    <p className="settings-note">No local vector databases found.</p>
                  ) : (
                    <div className="database-sidebar-items">
                      {vectorDatabases.map((database) => {
                        const isActive = isVectorDatabaseActive(database);

                        return (
                          <article className={`database-sidebar-item ${isActive ? "active" : ""}`} key={database.path}>
                            <div>
                              <strong>{database.name}</strong>
                              <small>{database.path}</small>
                            </div>
                            <button
                              className="send-button wide-button"
                              type="button"
                              onClick={() => void deployVectorDatabase(database)}
                              disabled={isVectorWorking || isActive}
                            >
                              {isActive ? <CircleCheck size={16} /> : <PlugZap size={16} />}
                              {isActive ? "Deployed" : "Deploy"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {vectorStatus && <p className="vector-status">{vectorStatus}</p>}
                </section>
              </div>
            )}
          </div>
        </section>
      )}

      {isDownloadsVisible && (
        <section className="downloads-surface" aria-label="Downloads">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Downloads</p>
              <h2>Kiwix archive</h2>
            </div>
            <div className="connection-pill connected">
              <Download size={16} />
              {downloadTaskList.length} tracked
            </div>
          </header>

          <div className="downloads-page-layout">
            <section className="vector-panel downloads-catalog-panel">
              <div className="panel-heading downloads-panel-heading">
                <Search size={18} aria-hidden="true" />
                <h2>Live Kiwix archive</h2>
              </div>

              {!config?.zim_source_folder?.trim() && (
                <div className="warning-note" role="status">
                  <CircleAlert size={16} />
                  <span>
                    Tensor Serve has no ZIM source folder set. Downloads will be saved to
                    Electron's default Downloads folder.
                  </span>
                </div>
              )}

              <form className="download-search-form downloads-page-search" onSubmit={submitCatalogSearch}>
                <label className="field">
                  <span>Search</span>
                  <input
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="python, devdocs..."
                  />
                </label>
                <label className="field">
                  <span>Language</span>
                  <input
                    value={catalogLanguage}
                    onChange={(event) => setCatalogLanguage(event.target.value)}
                    placeholder="eng"
                  />
                </label>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={isCatalogLoading}
                >
                  {isCatalogLoading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                  Search
                </button>
              </form>

              <div className="download-catalog-list">
                {catalogResults.length === 0 ? (
                  <div className="sidebar-empty">
                    <strong>No archive results</strong>
                    <small>Search Kiwix to find ZIM files.</small>
                  </div>
                ) : (
                  catalogResults.map((entry) => {
                    const task = downloadTasks[entry.id];
                    const isReady = Boolean(downloadedZims[entry.id]) || task?.status === "ready";
                    const sizeLabel = entry.sizeBytes
                      ? `${Math.round(entry.sizeBytes / 1024 / 1024)} MB`
                      : "size unknown";

                    return (
                      <article className="download-catalog-item" key={entry.id}>
                        <div>
                          <strong>{entry.title}</strong>
                          <small>{entry.summary || entry.name}</small>
                          <span className="catalog-meta">
                            {entry.language} · {entry.category} · {sizeLabel}
                          </span>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void downloadCatalogEntry(entry)}
                          disabled={task?.status === "downloading" || isReady}
                        >
                          {task?.status === "downloading" ? (
                            <Loader2 className="spin" size={15} />
                          ) : isReady ? (
                            <CircleCheck size={15} />
                          ) : (
                            <Download size={15} />
                          )}
                          {task?.status === "downloading"
                            ? "Downloading"
                            : isReady
                              ? "Ready"
                              : "Get"}
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <aside className="vector-panel setup-panel downloads-queue-panel">
              <h3>Ongoing downloads</h3>
              <div className="downloads-task-list">
                {downloadTaskList.length === 0 ? (
                  <div className="sidebar-empty">
                    <strong>No downloads yet</strong>
                    <small>Download files from the archive.</small>
                  </div>
                ) : (
                  downloadTaskList.map((task) => (
                    <article className={`download-task ${task.status}`} key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <small>{getDownloadTaskDetail(task)}</small>
                        {task.status === "downloading" && task.logs?.at(-1) && (
                          <small>{task.logs.at(-1)}</small>
                        )}
                        {task.error && <small>{task.error}</small>}
                        {renderDownloadProgress(task)}
                      </div>
                      <span className="download-task-status">
                        {task.status === "downloading" && <Loader2 className="spin" size={14} />}
                        {task.status === "ready" && <CircleCheck size={14} />}
                        {task.status === "failed" && <CircleAlert size={14} />}
                        {task.status}
                      </span>
                    </article>
                  ))
                )}
              </div>
            </aside>
          </div>
        </section>
      )}

      {isBrowserVisible && (
        <section className="browser-surface" aria-label="Web browser">
          <header className="browser-toolbar">
            <div className="browser-nav-controls" aria-label="Browser navigation">
              <button
                className="icon-button"
                type="button"
                aria-label="Back"
                title="Back"
                disabled={!browserCanGoBack}
                onClick={() =>
                  window.tensorDesktop?.browserGoBack?.().then((state) => {
                    applyBrowserViewState(state);
                  })
                }
              >
                <ArrowLeft size={18} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Forward"
                title="Forward"
                disabled={!browserCanGoForward}
                onClick={() =>
                  window.tensorDesktop?.browserGoForward?.().then((state) => {
                    applyBrowserViewState(state);
                  })
                }
              >
                <ArrowRight size={18} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={isBrowserLoading ? "Stop loading" : "Reload"}
                title={isBrowserLoading ? "Stop loading" : "Reload"}
                onClick={() =>
                  isBrowserLoading
                    ? window.tensorDesktop?.browserStop?.().then((state) => {
                        applyBrowserViewState(state);
                      })
                    : window.tensorDesktop?.browserReload?.().then((state) => {
                        applyBrowserViewState(state);
                      })
                }
              >
                {isBrowserLoading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Home"
                title="Home"
                onClick={() => {
                  const homeUrl = normalizeBrowserUrl(browserHomeUrl) || DEFAULT_BROWSER_HOME_URL;
                  setBrowserInput(homeUrl);
                  setBrowserUrl(homeUrl);
                  void window.tensorDesktop?.navigateBrowserView?.(homeUrl).then((state) => {
                    applyBrowserViewState(state);
                  });
                }}
              >
                <Home size={18} />
              </button>
            </div>

            <form className="browser-address-form" onSubmit={submitBrowserNavigation}>
              <Globe2 size={16} aria-hidden="true" />
              <input
                value={browserInput}
                onChange={(event) => setBrowserInput(event.target.value)}
                aria-label="Address or search"
                placeholder="Search or enter address"
              />
            </form>

            <button
              className="icon-button"
              type="button"
              aria-label="Open externally"
              title="Open externally"
              onClick={openBrowserUrlExternally}
            >
              <ExternalLink size={18} />
            </button>
            <button
              className={`icon-button ${isZimitPanelOpen ? "active" : ""}`}
              type="button"
              aria-label="Save website as ZIM"
              title="Save website as ZIM"
              onClick={() => setIsZimitPanelOpen((current) => !current)}
            >
              <img className="openzim-logo-icon" src={openZimLogo} alt="" aria-hidden="true" />
            </button>
          </header>

          <div className="browser-titlebar">
            <span>{browserTitle}</span>
            <small>{browserUrl}</small>
          </div>

          {isZimitPanelOpen && (
            <section className="zimit-panel" aria-label="Zimit capture">
              <div className="zimit-panel-header">
                <div>
                  <strong>Save website as ZIM</strong>
                  <small>{browserUrl}</small>
                </div>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => void startZimitCapture()}
                  disabled={isZimitStarting}
                >
                  {isZimitStarting ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <img className="openzim-logo-icon small" src={openZimLogo} alt="" aria-hidden="true" />
                  )}
                  Start
                </button>
              </div>

              <div className="zimit-grid">
                <label className="field">
                  <span>ZIM name</span>
                  <input value={zimitName} onChange={(event) => setZimitName(event.target.value)} />
                </label>
                <label className="field">
                  <span>Page limit</span>
                  <input
                    value={zimitPageLimit}
                    onChange={(event) => setZimitPageLimit(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span>Workers</span>
                  <input
                    value={zimitWorkers}
                    onChange={(event) => setZimitWorkers(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span>Wait until</span>
                  <select
                    value={zimitWaitUntil}
                    onChange={(event) => setZimitWaitUntil(event.target.value)}
                  >
                    <option value="load">load</option>
                    <option value="domcontentloaded">domcontentloaded</option>
                    <option value="networkidle0">networkidle0</option>
                    <option value="networkidle2">networkidle2</option>
                  </select>
                </label>
                <label className="field zimit-output-field">
                  <span>Output folder</span>
                  <input
                    value={zimitOutputDir}
                    onChange={(event) => setZimitOutputDir(event.target.value)}
                    placeholder={config?.zim_source_folder || "Downloads/TSRC Zimit"}
                  />
                </label>
                <button
                  className="secondary-button zimit-folder-button"
                  type="button"
                  onClick={() => void chooseZimitOutputDirectory()}
                >
                  <FolderOpen size={16} />
                  Folder
                </button>
                {renderZimitScopeExcludeInput("zimit-wide")}
                <label className="field zimit-wide">
                  <span>Advanced Zimit / Browsertrix / warc2zim args</span>
                  <input
                    value={zimitExtraArgs}
                    onChange={(event) => setZimitExtraArgs(event.target.value)}
                    placeholder='--description "Offline site" --lang eng'
                  />
                </label>
                <label className="field">
                  <span>Docker image</span>
                  <input value={zimitImage} onChange={(event) => setZimitImage(event.target.value)} />
                </label>
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={zimitKeep}
                    onChange={(event) => setZimitKeep(event.target.checked)}
                  />
                  Keep crawl artifacts
                </label>
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={zimitDisableAdBlocking}
                    onChange={(event) => setZimitDisableAdBlocking(event.target.checked)}
                  />
                  Disable image ad filtering
                </label>
              </div>

              {activeZimitTasks.length > 0 && (
                <div className="zimit-active-list">
                  {activeZimitTasks.slice(0, 3).map((task) => (
                    <article className={`download-task ${task.status}`} key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <small>{getDownloadTaskDetail(task)}</small>
                        {task.logs?.at(-1) && <small>{task.logs.at(-1)}</small>}
                        {task.error && <small>{task.error}</small>}
                        {renderDownloadProgress(task)}
                      </div>
                      {task.status === "downloading" ? (
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => void cancelZimitCapture(task.id)}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="download-task-status">
                          {task.status === "ready" ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                          {task.status}
                        </span>
                      )}
                    </article>
                  ))}
                </div>
              )}

              {zimitStatus && <p className="vector-status">{zimitStatus}</p>}
            </section>
          )}

          <div className="browser-frame" ref={browserFrameRef}>
            {window.tensorDesktop?.showBrowserView ? (
              <div className="native-browser-placeholder" aria-hidden="true" />
            ) : (
              <iframe
                src={browserUrl}
                title={browserTitle}
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              />
            )}
          </div>
        </section>
      )}

      {isChatVisible && (
        <section className="chat-surface" aria-label="Chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Tensor chat</p>
            <h2>{activeModel || "No model selected"}</h2>
          </div>
          <div className={`connection-pill ${isConnected ? "connected" : ""}`}>
            {isConnected ? <CircleCheck size={16} /> : <PlugZap size={16} />}
            {statusLabel}
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
          </div>
        )}

        <div className="message-list">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="avatar">
                {message.role === "user" ? <User size={18} /> : <Bot size={18} />}
              </div>
              <div className="bubble">{message.content}</div>
            </article>
          ))}

          {isSending && (
            <article className="message assistant">
              <div className="avatar">
                <Bot size={18} />
              </div>
              <div className="bubble loading">
                <Loader2 className="spin" size={18} />
                Thinking
              </div>
            </article>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="composer" onSubmit={submitMessage}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask Tensor Serve..."
            rows={1}
          />
          <button className="send-button" disabled={!draft.trim() || isSending}>
            {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            Send
          </button>
        </form>
        </section>
      )}

      {isSearchVisible && (
        <section className="vector-surface" aria-label="Knowledge source search">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Knowledge sources</p>
              <h2>Create and prepare sources</h2>
            </div>
          </header>

          <div className="vector-layout">
            <section className="vector-panel">
              <div className="source-tabs" role="tablist" aria-label="ZIM sources">
                <button
                  className={vectorSource === "local" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={vectorSource === "local"}
                  onClick={() => setVectorSource("local")}
                >
                  Local files
                </button>
                <button
                  className={vectorSource === "collections" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={vectorSource === "collections"}
                  onClick={() => {
                    setVectorSource("collections");
                    if (availableCollections.length === 0) void refreshCollections();
                  }}
                >
                  Collections
                </button>
              </div>

              {vectorSource === "local" && (
                <div className="local-source">
                  <div className="catalog-results local-browser-results">
                    {!localBrowserPath && (
                      <div className="local-browser-empty">
                        <strong>Loading local files...</strong>
                        <small>Choose a folder if TSRC does not open your home folder.</small>
                      </div>
                    )}
                    {localBrowserPath && (
                      <div className="local-browser-path">
                        <strong>{localBrowserPath}</strong>
                        <small>{localBrowserEntries.length} visible item(s)</small>
                      </div>
                    )}
                    {localBrowserParentPath && (
                      <button
                        className="local-browser-tile"
                        type="button"
                        onClick={() => void openLocalDirectory(localBrowserParentPath)}
                      >
                        <span className="local-browser-icon">
                          <ChevronLeft size={30} />
                        </span>
                        <strong>Parent folder</strong>
                        <small>{localBrowserParentPath}</small>
                      </button>
                    )}
                    {localBrowserEntries.map((entry) => {
                      const isSelected = selectedLocalZims.some((item) => item.path === entry.path);

                      return (
                        <button
                          className={`local-browser-tile ${isSelected ? "selected" : ""}`}
                          type="button"
                          key={entry.path}
                          onClick={() =>
                            entry.type === "directory"
                              ? void openLocalDirectory(entry.path)
                              : toggleLocalZim(entry)
                          }
                        >
                          <span className="local-browser-icon">
                            {entry.type === "directory" ? (
                              <FolderOpen size={34} />
                            ) : (
                              <FileIcon size={34} />
                            )}
                          </span>
                          <strong>{entry.name}</strong>
                          <small>
                            {entry.type === "directory"
                              ? "Folder"
                              : `${Math.round((entry.sizeBytes ?? 0) / 1024 / 1024)} MB`}
                          </small>
                        </button>
                      );
                    })}
                  </div>

                  <div className="local-action-row">
                    <button
                      className="secondary-button local-browse-button"
                      type="button"
                      onClick={() => void chooseLocalDirectory()}
                    >
                      <FolderOpen size={16} />
                      Choose folder
                    </button>
                  </div>
                </div>
              )}

              {vectorSource === "collections" && (
                <div className="local-source">
                  <button
                    className="secondary-button local-browse-button"
                    type="button"
                    onClick={() => void refreshCollections()}
                    disabled={isCollectionsLoading}
                  >
                    {isCollectionsLoading ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <RefreshCcw size={16} />
                    )}
                    Refresh collections
                  </button>

                  <div className="catalog-results">
                    {availableCollections.map((collection) => {
                      const isSelected = selectedCollections.some(
                        (item) => item.id === collection.id,
                      );

                      return (
                        <button
                          className={`catalog-item ${isSelected ? "selected" : ""}`}
                          type="button"
                          key={collection.id}
                          onClick={() => void toggleCollection(collection)}
                          disabled={isCollectionsLoading}
                        >
                          <span>
                            <strong>{collection.name}</strong>
                            <small>{collection.description || collection.id}</small>
                          </span>
                          <span className="catalog-meta">
                            {collection.category || "collection"} · {collection.file_count} file(s)
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <aside className="vector-panel setup-panel">
              <h3>Create</h3>
              <label className="field">
                <span>Type</span>
                <select
                  value={vectorSetupMode}
                  onChange={(event) =>
                    setVectorSetupMode(event.target.value as VectorSetupMode)
                  }
                >
                  <option value="database">Vector database</option>
                  <option value="collection">Collection</option>
                </select>
              </label>

              {vectorSetupMode === "database" ? (
                <>
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={vectorDbName}
                      onChange={(event) => setVectorDbName(event.target.value)}
                    />
                  </label>
                  <p className="generated-id">ID: {generatedVectorDbId}</p>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={collectionName}
                      onChange={(event) => setCollectionName(event.target.value)}
                    />
                  </label>
                  <p className="generated-id">ID: {generatedCollectionId}</p>
                  <label className="field">
                    <span>Description</span>
                    <textarea
                      value={collectionDescription}
                      onChange={(event) => setCollectionDescription(event.target.value)}
                      rows={3}
                    />
                  </label>
                </>
              )}

              <div className="selected-list">
                <span>{selectedSourceCount} selected ZIM file(s)</span>
                {selectedLocalZims.map((file) => (
                  <div key={file.path}>
                    <strong>{file.fileName}</strong>
                    <small>{file.path}</small>
                    <button type="button" onClick={() => removeLocalZim(file.path)}>
                      Remove
                    </button>
                  </div>
                ))}
                {selectedCollections.map((collection) => {
                  const fileCount = (collection.files ?? collection.zim_files ?? []).filter(
                    (file) => file.path && file.installed !== false,
                  ).length;

                  return (
                    <div key={collection.id}>
                      <strong>{collection.name}</strong>
                      <small>
                        {collection.id} · {fileCount} collection file(s)
                      </small>
                      <button
                        type="button"
                        onClick={() => removeSelectedCollection(collection.id)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                className="send-button wide-button"
                type="button"
                disabled={isVectorWorking || selectedSourceCount === 0}
                onClick={() =>
                  vectorSetupMode === "database"
                    ? void setupKnowledgeBase()
                    : void saveCollection()
                }
              >
                {isVectorWorking ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
                {vectorSetupMode === "database" ? "Build vector database" : "Create collection"}
              </button>

              {renderVectorProgress()}
              {vectorStatus && <p className="vector-status">{vectorStatus}</p>}
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
