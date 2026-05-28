import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Database,
  Files,
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
  TensorConfig,
  TensorHealth,
  TensorModel,
  createCollection,
  detectLocalAi,
  downloadZim,
  getConfig,
  getHealth,
  ingestCollection,
  listModels,
  loadVectorDb,
  registerZim,
  searchKiwixCatalog,
  sendChatCompletion,
  setAiEndpoint,
} from "./api/tensorServe";

const DEFAULT_TENSOR_SERVE_URL = window.tensorDesktop
  ? "http://localhost:8000"
  : import.meta.env.DEV
    ? "/tensor"
    : "http://localhost:8000";

const createMessage = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
});

type ActivityId = "chat" | "search" | "files" | "browser" | "databases" | "serving" | "settings";

function App() {
  const [baseUrl, setBaseUrl] = useState(
    () => localStorage.getItem("tensor.baseUrl") ?? DEFAULT_TENSOR_SERVE_URL,
  );
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
  const [selectedZims, setSelectedZims] = useState<KiwixCatalogEntry[]>([]);
  const [downloadedZims, setDownloadedZims] = useState<Record<string, DownloadedZim>>({});
  const [collectionId, setCollectionId] = useState("local_knowledge");
  const [collectionName, setCollectionName] = useState("Local Knowledge");
  const [vectorStatus, setVectorStatus] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isVectorWorking, setIsVectorWorking] = useState(false);
  const [draft, setDraft] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeActivity, setActiveActivity] = useState<ActivityId>("chat");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeModel = model || config?.ai_model || models[0]?.id || "";
  const isConnected = health?.status === "ok";
  const isServingPanelOpen = activeActivity === "serving";
  const isChatVisible = activeActivity === "chat" || activeActivity === "serving";
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

  async function refreshConnection() {
    setIsChecking(true);
    setError(null);

    try {
      let [nextHealth, nextConfig] = await Promise.all([
        getHealth(baseUrl),
        getConfig(baseUrl),
      ]);

      if (!nextHealth.ai_configured && nextConfig.ai_endpoint && nextConfig.ai_model) {
        await setAiEndpoint(
          baseUrl,
          nextConfig.ai_endpoint,
          nextConfig.ai_model,
          nextConfig.ai_provider,
        );
        [nextHealth, nextConfig] = await Promise.all([getHealth(baseUrl), getConfig(baseUrl)]);
      }

      setHealth(nextHealth);
      setConfig(nextConfig);
      if (nextConfig.ai_endpoint) {
        setSelectedEndpoint(nextConfig.ai_endpoint);
        setLocalAiEndpoint(nextConfig.ai_endpoint);
      }

      try {
        const [nextModels, nextDetectedEndpoints] = await Promise.all([
          listModels(baseUrl).catch(() => []),
          detectLocalAi(baseUrl).catch(() => []),
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

  useEffect(() => {
    void refreshConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function toggleZim(entry: KiwixCatalogEntry) {
    setSelectedZims((current) =>
      current.some((item) => item.id === entry.id)
        ? current.filter((item) => item.id !== entry.id)
        : [...current, entry],
    );
  }

  async function downloadSelectedZims() {
    if (selectedZims.length === 0) {
      setVectorStatus("Select at least one ZIM file first.");
      return [];
    }

    const downloaded: DownloadedZim[] = [];

    for (const entry of selectedZims) {
      setVectorStatus(`Downloading ${entry.title}...`);
      const file = downloadedZims[entry.id] ?? (await downloadZim(entry));
      downloaded.push(file);
      setDownloadedZims((current) => ({ ...current, [entry.id]: file }));

      setVectorStatus(`Registering ${entry.title} with Tensor Serve...`);
      await registerZim(baseUrl, file.path, entry);
    }

    setVectorStatus(`Downloaded and registered ${downloaded.length} ZIM file(s).`);
    return downloaded;
  }

  async function setupKnowledgeBase() {
    if (!collectionId.trim()) {
      setVectorStatus("Collection ID is required.");
      return;
    }

    setIsVectorWorking(true);

    try {
      const downloaded = await downloadSelectedZims();
      const zimPaths = downloaded.map((file) => file.path);

      if (zimPaths.length === 0) return;

      setVectorStatus("Creating Tensor Serve collection...");
      await createCollection(
        baseUrl,
        collectionId.trim(),
        collectionName.trim() || collectionId.trim(),
        "Created by TSRC from the live Kiwix catalog.",
        zimPaths,
      );

      setVectorStatus("Ingesting collection into a vector database...");
      await ingestCollection(baseUrl, collectionId.trim());

      const dbName = `${collectionId.trim()}_db`;
      setVectorStatus(`Loading ${dbName}...`);
      await loadVectorDb(baseUrl, dbName);

      const nextHealth = await getHealth(baseUrl);
      setHealth(nextHealth);
      setVectorStatus(`Knowledge base ready: ${dbName}`);
    } catch (caught) {
      setVectorStatus(
        caught instanceof Error ? caught.message : "Unable to set up the knowledge base.",
      );
    } finally {
      setIsVectorWorking(false);
    }
  }

  return (
    <main className={`app-shell ${isServingPanelOpen ? "serving-open" : ""}`}>
      <nav className="activity-bar" aria-label="Primary navigation">
        <div className="activity-group">
          <button
            className={`activity-button ${isChatVisible ? "active" : ""}`}
            type="button"
            aria-label="Chat"
            aria-pressed={isChatVisible}
            title="Chat"
            onClick={() => setActiveActivity("chat")}
          >
            <MessageSquare size={22} />
          </button>
          <button
            className="activity-button"
            type="button"
            aria-label="Search"
            aria-pressed="false"
            title="Search"
          >
            <Search size={22} />
          </button>
          <button
            className="activity-button"
            type="button"
            aria-label="Files"
            aria-pressed="false"
            title="Files"
          >
            <Files size={22} />
          </button>
          <button
            className="activity-button"
            type="button"
            aria-label="Browser"
            aria-pressed="false"
            title="Browser"
          >
            <Globe2 size={22} />
          </button>
          <button
            className={`activity-button ${activeActivity === "databases" ? "active" : ""}`}
            type="button"
            aria-label="Vector databases"
            aria-pressed={activeActivity === "databases"}
            title="Vector databases"
            onClick={() => setActiveActivity("databases")}
          >
            <Database size={22} />
          </button>
        </div>

        <div className="activity-group">
          <button
            className={`activity-button ${activeActivity === "serving" ? "active" : ""}`}
            type="button"
            aria-label="Serving"
            aria-pressed={activeActivity === "serving"}
            title="Serving"
            onClick={() =>
              setActiveActivity((current) => (current === "serving" ? "chat" : "serving"))
            }
          >
            <Server size={22} />
          </button>
          <button
            className="activity-button"
            type="button"
            aria-label="Settings"
            aria-pressed="false"
            title="Settings"
          >
            <Settings2 size={22} />
          </button>
        </div>
      </nav>

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
                onClick={refreshConnection}
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
                <dt>AI</dt>
                <dd>{health?.ai_configured ? "Configured" : "Not live"}</dd>
              </div>
              <div>
                <dt>Tensor Serve</dt>
                <dd>{baseUrl}</dd>
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
        </aside>
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

      {activeActivity === "databases" && (
        <section className="vector-surface" aria-label="Vector databases">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Knowledge base</p>
              <h2>Vector database setup</h2>
            </div>
          </header>

          <div className="vector-layout">
            <section className="vector-panel">
              <form className="vector-form" onSubmit={submitCatalogSearch}>
                <label className="field">
                  <span>Kiwix catalog search</span>
                  <input
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="python, stackoverflow, devdocs..."
                  />
                </label>
                <label className="field compact-field">
                  <span>Language</span>
                  <input
                    value={catalogLanguage}
                    onChange={(event) => setCatalogLanguage(event.target.value)}
                    placeholder="eng"
                  />
                </label>
                <button
                  className="secondary-button compact-button vector-search-button"
                  type="submit"
                  disabled={isCatalogLoading}
                >
                  {isCatalogLoading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                  Search
                </button>
              </form>

              <div className="catalog-results">
                {catalogResults.map((entry) => {
                  const isSelected = selectedZims.some((item) => item.id === entry.id);
                  const sizeLabel = entry.sizeBytes
                    ? `${Math.round(entry.sizeBytes / 1024 / 1024)} MB`
                    : "size unknown";

                  return (
                    <button
                      className={`catalog-item ${isSelected ? "selected" : ""}`}
                      type="button"
                      key={entry.id}
                      onClick={() => toggleZim(entry)}
                    >
                      <span>
                        <strong>{entry.title}</strong>
                        <small>{entry.summary || entry.name}</small>
                      </span>
                      <span className="catalog-meta">
                        {entry.language} · {entry.category} · {sizeLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="vector-panel setup-panel">
              <h3>Collection</h3>
              <label className="field">
                <span>Collection ID</span>
                <input
                  value={collectionId}
                  onChange={(event) => setCollectionId(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  value={collectionName}
                  onChange={(event) => setCollectionName(event.target.value)}
                />
              </label>

              <div className="selected-list">
                <span>{selectedZims.length} selected ZIM file(s)</span>
                {selectedZims.map((entry) => (
                  <div key={entry.id}>
                    <strong>{entry.title}</strong>
                    <small>{downloadedZims[entry.id]?.fileName ?? entry.name}</small>
                  </div>
                ))}
              </div>

              <button
                className="send-button wide-button"
                type="button"
                disabled={isVectorWorking || selectedZims.length === 0}
                onClick={() => void setupKnowledgeBase()}
              >
                {isVectorWorking ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
                Build knowledge base
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
