import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Database,
  Download,
  File as FileIcon,
  Files,
  FolderOpen,
  Globe2,
  Loader2,
  MessageSquare,
  PlugZap,
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

const createMessage = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
});

type ActivityId = "chat" | "search" | "downloads" | "files" | "browser" | "databases" | "settings";
type SidebarId = "chat" | "serving" | "downloads" | "databases";
type SettingsSection =
  | "chat"
  | "search"
  | "files"
  | "browser"
  | "serving"
  | "downloads"
  | "databases";
type VectorSource = "local" | "collections";
type VectorSetupMode = "database" | "collection";
type DownloadStatus = "downloading" | "ready" | "failed";

type DownloadTask = {
  id: string;
  title: string;
  fileName: string;
  status: DownloadStatus;
  path?: string;
  error?: string;
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
  const [draft, setDraft] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeActivity, setActiveActivity] = useState<ActivityId>("chat");
  const [activeSidebar, setActiveSidebar] = useState<SidebarId | null>(null);
  const [isSettingsMode, setIsSettingsMode] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("chat");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeModel = model || config?.ai_model || models[0]?.id || "";
  const isConnected = health?.status === "ok";
  const isChatPanelOpen = !isSettingsMode && activeSidebar === "chat";
  const isChatVisible = !isSettingsMode && activeActivity === "chat" && !isChatPanelOpen;
  const isServingPanelOpen = !isSettingsMode && activeSidebar === "serving";
  const isDownloadsPanelOpen = !isSettingsMode && activeSidebar === "downloads";
  const isDatabasePanelOpen = !isSettingsMode && activeSidebar === "databases";
  const isSidebarOpen = !isSettingsMode && activeSidebar !== null;
  const isSearchVisible = !isSettingsMode && activeActivity === "search";
  const isDownloadsVisible =
    !isSettingsMode && activeActivity === "downloads" && !isDownloadsPanelOpen;
  const chatNavActive = isSettingsMode ? settingsSection === "chat" : isChatVisible || isChatPanelOpen;
  const searchNavActive = isSettingsMode ? settingsSection === "search" : isSearchVisible;
  const filesNavActive = isSettingsMode && settingsSection === "files";
  const browserNavActive = isSettingsMode && settingsSection === "browser";
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
      return [];
    }

    const zimPaths = new Set<string>();

    for (const file of selectedLocalZims) {
      setVectorStatus(`Registering ${file.fileName} with Tensor Serve...`);
      zimPaths.add(file.path);
      await registerZim(baseUrl, file.path);
    }

    for (const file of selectedCollectionFiles) {
      zimPaths.add(file.path);
    }

    const paths = [...zimPaths];
    setVectorStatus(`Prepared ${paths.length} ZIM file(s).`);
    return paths;
  }

  async function setupKnowledgeBase() {
    if (!vectorDbName.trim()) {
      setVectorStatus("Vector database name is required.");
      return;
    }

    setIsVectorWorking(true);

    try {
      const zimPaths = await resolveSelectedZimPaths();

      if (zimPaths.length === 0) return;

      setVectorStatus(`Building ${generatedVectorDbId}...`);
      await ingestMultiple(baseUrl, zimPaths, generatedVectorDbId);

      setVectorStatus(`Loading ${generatedVectorDbId}...`);
      await loadVectorDb(baseUrl, generatedVectorDbId);

      const nextHealth = await getHealth(baseUrl);
      setHealth(nextHealth);
      setVectorStatus(`Vector database ready: ${generatedVectorDbId}`);
    } catch (caught) {
      setVectorStatus(
        caught instanceof Error ? caught.message : "Unable to set up the knowledge base.",
      );
    } finally {
      setIsVectorWorking(false);
    }
  }

  async function saveCollection() {
    if (!collectionName.trim()) {
      setVectorStatus("Collection name is required.");
      return;
    }

    setIsVectorWorking(true);

    try {
      const zimPaths = await resolveSelectedZimPaths();

      if (zimPaths.length === 0) return;

      setVectorStatus(`Creating collection ${generatedCollectionId}...`);
      await createCollection(
        baseUrl,
        generatedCollectionId,
        collectionName.trim(),
        collectionDescription.trim() || "Created by TSRC from selected ZIM files.",
        zimPaths,
      );

      await refreshCollections();
      setVectorStatus(`Collection ready: ${generatedCollectionId}`);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to create collection.");
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
    setIsVectorWorking(true);
    setVectorStatus(`Deploying ${database.name}...`);

    try {
      await loadVectorDb(baseUrl, database.path);
      const nextHealth = await getHealth(baseUrl);
      setHealth(nextHealth);
      setVectorStatus(`Deployed ${database.name}.`);
    } catch (caught) {
      setVectorStatus(caught instanceof Error ? caught.message : "Unable to deploy database.");
    } finally {
      setIsVectorWorking(false);
    }
  }

  function selectActivity(section: "chat" | "search") {
    if (isSettingsMode) {
      setSettingsSection(section);
      return;
    }

    if (section === "chat") {
      setActiveSidebar((current) => (current === "chat" ? null : current));
    }

    setActiveActivity(section);
  }

  function selectDownloadsActivity() {
    if (isSettingsMode) {
      setSettingsSection("downloads");
      return;
    }

    setActiveSidebar((current) => (current === "downloads" ? null : current));
    setActiveActivity("downloads");
  }

  function dockActivity(section: "chat" | "downloads") {
    if (isSettingsMode) {
      setSettingsSection(section);
      return;
    }

    if (section === activeActivity) {
      setActiveActivity(section === "chat" ? "search" : "chat");
    }

    setActiveSidebar(section);
  }

  function selectInactiveSection(section: "files" | "browser") {
    if (isSettingsMode) {
      setSettingsSection(section);
    }
  }

  function toggleSidebar(section: SidebarId) {
    if (isSettingsMode) {
      setSettingsSection(section);
      return;
    }

    setActiveSidebar((current) => (current === section ? null : section));
  }

  function toggleSettingsMode() {
    if (!isSettingsMode) {
      if (activeSidebar) {
        setSettingsSection(activeSidebar);
      } else if (
        activeActivity === "chat" ||
        activeActivity === "search" ||
        activeActivity === "downloads"
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
    search: "Search settings",
    files: "File settings",
    browser: "Browser settings",
    serving: "Serving settings",
    downloads: "Download settings",
    databases: "Vector database settings",
  }[settingsSection];

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
            onClick={() => selectActivity("chat")}
            onContextMenu={(event) => {
              event.preventDefault();
              dockActivity("chat");
            }}
          >
            <MessageSquare size={22} />
          </button>
          <button
            className={`activity-button ${searchNavActive ? "active" : ""}`}
            type="button"
            aria-label="Search"
            aria-pressed={searchNavActive}
            title="Search"
            onClick={() => selectActivity("search")}
          >
            <Search size={22} />
          </button>
          <button
            className={`activity-button ${filesNavActive ? "active" : ""}`}
            type="button"
            aria-label="Files"
            aria-pressed={filesNavActive}
            title="Files"
            onClick={() => selectInactiveSection("files")}
          >
            <Files size={22} />
          </button>
          <button
            className={`activity-button ${browserNavActive ? "active" : ""}`}
            type="button"
            aria-label="Browser"
            aria-pressed={browserNavActive}
            title="Browser"
            onClick={() => selectInactiveSection("browser")}
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
            onClick={() => toggleSidebar("serving")}
          >
            <Server size={22} />
          </button>
          <button
            className={`activity-button ${downloadsNavActive ? "active" : ""}`}
            type="button"
            aria-label="Downloads"
            aria-pressed={downloadsNavActive}
            title="Downloads"
            onClick={selectDownloadsActivity}
            onContextMenu={(event) => {
              event.preventDefault();
              dockActivity("downloads");
            }}
          >
            <Download size={22} />
          </button>
          <button
            className={`activity-button ${databaseNavActive ? "active" : ""}`}
            type="button"
            aria-label="Vector databases"
            aria-pressed={databaseNavActive}
            title="Vector databases"
            onClick={() => toggleSidebar("databases")}
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
                        <small>{task.path ?? task.fileName}</small>
                        {task.error && <small>{task.error}</small>}
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
                {vectorDatabases.map((database) => (
                  <article className="database-sidebar-item" key={database.path}>
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
                      disabled={isVectorWorking}
                    >
                      {isVectorWorking ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <PlugZap size={16} />
                      )}
                      Deploy
                    </button>
                  </article>
                ))}
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
                  </dl>
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
                      <Files size={16} />
                      Choose folder
                    </button>
                  </div>
                </section>
              </div>
            )}

            {settingsSection === "browser" && (
              <div className="settings-grid">
                <section className="settings-panel">
                  <h3>Browser</h3>
                  <p className="settings-note">
                    Browser controls will live here when the webview experience is added.
                  </p>
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
                  </dl>
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

                <section className="settings-panel settings-list-panel">
                  <h3>Available databases</h3>
                  {vectorDatabases.length === 0 ? (
                    <p className="settings-note">No local vector databases found.</p>
                  ) : (
                    <div className="database-sidebar-items">
                      {vectorDatabases.map((database) => (
                        <article className="database-sidebar-item" key={database.path}>
                          <div>
                            <strong>{database.name}</strong>
                            <small>{database.path}</small>
                          </div>
                          <button
                            className="send-button wide-button"
                            type="button"
                            onClick={() => void deployVectorDatabase(database)}
                            disabled={isVectorWorking}
                          >
                            <PlugZap size={16} />
                            Deploy
                          </button>
                        </article>
                      ))}
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
                        <small>{task.path ?? task.fileName}</small>
                        {task.error && <small>{task.error}</small>}
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
              <h2>Search and prepare sources</h2>
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
                      <Files size={16} />
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

              {vectorStatus && <p className="vector-status">{vectorStatus}</p>}
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
