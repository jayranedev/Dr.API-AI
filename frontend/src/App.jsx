import { useState, useRef } from "react";

const API_BASE = "https://drapi-ai-production.up.railway.app";

const methodColors = {
  GET: { bg: "rgba(34,197,94,0.12)", text: "#22c55e", border: "rgba(34,197,94,0.25)" },
  POST: { bg: "rgba(59,130,246,0.12)", text: "#3b82f6", border: "rgba(59,130,246,0.25)" },
  PUT: { bg: "rgba(234,179,8,0.12)", text: "#eab308", border: "rgba(234,179,8,0.25)" },
  DELETE: { bg: "rgba(239,68,68,0.12)", text: "#ef4444", border: "rgba(239,68,68,0.25)" },
  PATCH: { bg: "rgba(168,85,247,0.12)", text: "#a855f7", border: "rgba(168,85,247,0.25)" },
};

function PulsingDot({ delay = 0 }) {
  return (
    <span style={{
      display: "inline-block", width: 4, height: 4, borderRadius: "50%",
      background: "#818cf8", animation: "pulse-dot 1.4s ease-in-out infinite",
      animationDelay: `${delay}s`,
    }} />
  );
}

export default function APIForgeApp() {
  const [stage, setStage] = useState("landing");
  const [url, setUrl] = useState("");
  const [endpoints, setEndpoints] = useState([]);
  const [apiSchema, setApiSchema] = useState(null);
  const [docText, setDocText] = useState("");
  const [scrapeInfo, setScrapeInfo] = useState(null);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("python");
  const [sdkCache, setSdkCache] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("sdk_cache") || "{}"); } catch { return {}; }
  }); 
  const [showCode, setShowCode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("endpoints");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);
  const [analyzeStep, setAnalyzeStep] = useState(0);
  const [error, setError] = useState("");
  const codeRef = useRef(null);
  const chatBottomRef = useRef(null);

  const analyzeSteps = [
    "Fetching documentation...",
    "Parsing HTML structure...",
    "Extracting endpoints with AI...",
    "Detecting authentication...",
    "Building API schema...",
    "Done!"
  ];

  const mapEndpoints = (rawEndpoints) =>
    rawEndpoints.map((ep, i) => ({
      id: i + 1,
      method: ep.method,
      path: ep.path,
      description: ep.description,
      parameters: ep.parameters || [],
      params: (ep.parameters || []).map(p => p.name),
      request_body: ep.request_body || "",
      response_example: ep.response_example || "",
      selected: true,
    }));

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setError("");
    setStage("analyzing");
    setAnalyzeStep(0);

   
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setAnalyzeStep(s => Math.min(s + 1, analyzeSteps.length - 2));
    }, 800);

    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      clearInterval(interval);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Analysis failed");
      }

      const data = await res.json();
      const schema = data.api_schema;
      setApiSchema(schema);
      setScrapeInfo(data.scrape_info);

      const sessionRes = await fetch(`${API_BASE}/session`);
      if (sessionRes.ok) {
        const session = await sessionRes.json();
        setDocText(session.doc_text || "");
      }

      setEndpoints(mapEndpoints(schema.endpoints || []));
      setShowCode(false);
      setSdkCache({});
      sessionStorage.removeItem("sdk_cache");
      setChatMessages([]);
      setSelectedEndpoint(null);
      setAnalyzeStep(analyzeSteps.length - 1);

      setTimeout(() => setStage("results"), 500);
    } catch (err) {
      clearInterval(interval);
      setError(err.message);
      setStage("landing");
    }
  };

  const toggleEndpoint = (id) => {
    setEndpoints(prev => prev.map(e => e.id === id ? { ...e, selected: !e.selected } : e));
  };

  const selectAll = () => {
    const allSelected = endpoints.every(e => e.selected);
    setEndpoints(prev => prev.map(e => ({ ...e, selected: !allSelected })));
  };

  const selectedEndpoints = endpoints
    .filter(e => e.selected)
    .map(e => `${e.method} ${e.path}`);

  const selectedCount = endpoints.filter(e => e.selected).length;

  const filteredEndpoints = endpoints.filter(
    e => e.path.toLowerCase().includes(search.toLowerCase()) ||
         e.description.toLowerCase().includes(search.toLowerCase()) ||
         e.method.toLowerCase().includes(search.toLowerCase())
  );

  const fetchAndCacheSDK = async (lang, force = false) => {
    if (!apiSchema || selectedCount === 0) return;

    if (!force && sdkCache[lang]) return;

    setIsGenerating(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_schema: apiSchema,
          language: lang,
          selected_endpoints: selectedEndpoints,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Generation failed");
      }

      const data = await res.json();
      setSdkCache(prev => {
        const updated = { ...prev, [lang]: data.code };
        sessionStorage.setItem("sdk_cache", JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      setError(err.message);
      if (!sdkCache[lang]) setShowCode(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSDK = async () => {
    if (selectedCount === 0 || !apiSchema) return;
    setShowCode(true);
    await fetchAndCacheSDK(language);
  };

  const handleLanguageChange = async (lang) => {
    setLanguage(lang);
    if (showCode) await fetchAndCacheSDK(lang);
  };

  const handleRegenerate = () => fetchAndCacheSDK(language, true);

  const handleChat = async () => {
    if (!chatInput.trim() || !apiSchema) return;
    const question = chatInput;
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: question }]);
    setIsChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_text: docText,
          api_schema: apiSchema,
          question,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Chat failed");
      }

      const data = await res.json();
      setChatMessages(prev => [...prev, { role: "ai", text: data.answer }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "ai", text: `Error: ${err.message}` }]);
    } finally {
      setIsChatLoading(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const handleExportPostman = async () => {
    if (!apiSchema) return;
    try {
      const res = await fetch(`${API_BASE}/postman`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_schema: apiSchema,
          selected_endpoints: selectedEndpoints,
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      const collection = await res.json();
      const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${apiSchema.api_name || "api"}_postman.json`;
      link.click();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadSDK = () => {
    const code = sdkCache[language];
    if (!code) return;
    const ext = { python: "py", nodejs: "js", curl: "sh" }[language] || "txt";
    const blob = new Blob([code], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sdk.${ext}`;
    link.click();
  };

  if (stage === "landing") {
    return (
      <div style={styles.container}>
        <style>{keyframes}</style>
        <div style={styles.landing}>
          <div style={styles.gridBg} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={styles.logoIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
                <line x1="14" y1="4" x2="10" y2="20" opacity="0.5" />
              </svg>
            </div>
            <h1 style={styles.landingTitle}>APIForge AI</h1>
          </div>

          <p style={styles.landingSubtitle}>
            Transform API documentation into production-ready SDKs in seconds.
          </p>

          {error && (
            <div style={styles.errorBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <div style={styles.inputGroup}>
            <div style={styles.inputIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <input
              style={styles.urlInput}
              placeholder="Paste API documentation URL..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAnalyze()}
            />
            <button
              style={{ ...styles.analyzeBtn, opacity: url.trim() ? 1 : 0.4, cursor: url.trim() ? "pointer" : "not-allowed" }}
              onClick={handleAnalyze}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              Analyze
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <span style={styles.exampleLabel}>Try:</span>
            {["docs.stripe.com/api", "platform.openai.com/docs", "twilio.com/docs/api"].map(ex => (
              <button key={ex} style={styles.exampleChip} onClick={() => setUrl(`https://${ex}`)}>
                {ex}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 20, marginTop: 40, flexWrap: "wrap", justifyContent: "center" }}>
            {[
              { icon: "⚡", label: "Instant Parsing" },
              { icon: "🔐", label: "Auth Detection" },
              { icon: "🧠", label: "AI-Powered" },
              { icon: "📦", label: "Multi-Language SDK" },
            ].map(f => (
              <div key={f.label} style={styles.featurePill}>
                <span>{f.icon}</span>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (stage === "analyzing") {
    return (
      <div style={styles.container}>
        <style>{keyframes}</style>
        <div style={styles.analyzing}>
          <div style={styles.analyzeSpinner} />
          <h2 style={{ color: "#e2e8f0", fontSize: 20, fontFamily: "'JetBrains Mono', monospace", marginTop: 24 }}>
            Analyzing Documentation
          </h2>
          <div style={{ marginTop: 24, textAlign: "left", width: 300 }}>
            {analyzeSteps.map((step, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 0",
                opacity: i <= analyzeStep ? 1 : 0.25,
                transition: "opacity 0.4s ease",
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: i < analyzeStep ? "#818cf8" : i === analyzeStep ? "rgba(129,140,248,0.3)" : "rgba(100,116,139,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.3s ease",
                }}>
                  {i < analyzeStep && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                  {i === analyzeStep && <PulsingDot />}
                </div>
                <span style={{ color: i <= analyzeStep ? "#cbd5e1" : "#475569", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                  {step}
                </span>
              </div>
            ))}
          </div>
          {scrapeInfo && (
            <p style={{ color: "#475569", fontSize: 12, marginTop: 16, fontFamily: "'JetBrains Mono', monospace" }}>
              {scrapeInfo.pages_scraped} page{scrapeInfo.pages_scraped !== 1 ? "s" : ""} scraped
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style>{keyframes}</style>

      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ ...styles.logoIcon, width: 28, height: 28 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <span style={{ color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>APIForge AI</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {apiSchema?.base_url && (
            <div style={styles.infoBadge}>
              <span style={{ color: "#64748b", fontSize: 11 }}>BASE</span>
              <span style={{ color: "#cbd5e1", fontSize: 12 }}>{apiSchema.base_url.replace(/^https?:\/\//, "")}</span>
            </div>
          )}
          {apiSchema?.auth_type && (
            <div style={styles.infoBadge}>
              <span style={{ color: "#64748b", fontSize: 11 }}>AUTH</span>
              <span style={{ color: "#22c55e", fontSize: 12 }}>{apiSchema.auth_type}</span>
            </div>
          )}
          <div style={styles.infoBadge}>
            <span style={{ color: "#64748b", fontSize: 11 }}>ENDPOINTS</span>
            <span style={{ color: "#818cf8", fontSize: 12 }}>{endpoints.length}</span>
          </div>
          <button style={styles.newAnalysisBtn} onClick={() => { setStage("landing"); setError(""); }}>
            ← New Analysis
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, margin: "8px 16px", borderRadius: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Split layout */}
      <div style={styles.splitLayout}>

        {/* ── LEFT PANEL ── */}
        <div style={styles.leftPanel}>
          <div style={styles.tabBar}>
            {[
              { key: "endpoints", label: "Endpoints", count: endpoints.length },
              { key: "chat", label: "Ask AI" },
            ].map(tab => (
              <button
                key={tab.key}
                style={{ ...styles.tab, ...(activeTab === tab.key ? styles.tabActive : {}) }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.count > 0 && <span style={styles.tabCount}>{tab.count}</span>}
              </button>
            ))}
          </div>

          {activeTab === "endpoints" && (
            <>
              <div style={styles.searchRow}>
                <div style={styles.searchBox}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    style={styles.searchInput}
                    placeholder="Search endpoints..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <button style={styles.selectAllBtn} onClick={selectAll}>
                  {endpoints.every(e => e.selected) ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div style={styles.endpointList}>
                {filteredEndpoints.map(ep => (
                  <div
                    key={ep.id}
                    style={{ ...styles.endpointRow, ...(selectedEndpoint?.id === ep.id ? styles.endpointRowActive : {}) }}
                    onClick={() => setSelectedEndpoint(ep)}
                  >
                    <div
                      style={{ ...styles.checkbox, ...(ep.selected ? styles.checkboxChecked : {}) }}
                      onClick={(e) => { e.stopPropagation(); toggleEndpoint(ep.id); }}
                    >
                      {ep.selected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </div>
                    <span style={{
                      ...styles.methodBadge,
                      background: methodColors[ep.method]?.bg,
                      color: methodColors[ep.method]?.text,
                      border: `1px solid ${methodColors[ep.method]?.border}`,
                    }}>{ep.method}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.endpointPath}>{ep.path}</div>
                      <div style={styles.endpointDesc}>{ep.description}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={styles.bottomBar}>
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  {selectedCount} of {endpoints.length} selected
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={styles.exportBtn} onClick={handleExportPostman}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Postman
                  </button>
                  <button
                    style={{ ...styles.generateBtn, opacity: selectedCount > 0 ? 1 : 0.4 }}
                    onClick={handleGenerateSDK}
                    disabled={selectedCount === 0 || isGenerating}
                  >
                    {isGenerating ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={styles.miniSpinner} />
                        Generating...
                      </span>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                        Generate SDK
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === "chat" && (
            <div style={styles.chatPanel}>
              <div style={styles.chatMessages}>
                {chatMessages.length === 0 && (
                  <div style={{ color: "#475569", fontSize: 13, textAlign: "center", marginTop: 40 }}>
                    Ask anything about the <strong style={{ color: "#818cf8" }}>{apiSchema?.api_name || "API"}</strong>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ ...styles.chatBubble, ...(msg.role === "user" ? styles.chatUser : styles.chatAI) }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                      {msg.role === "user" ? "YOU" : "APIFORGE AI"}
                    </div>
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
                  </div>
                ))}
                {isChatLoading && (
                  <div style={{ ...styles.chatBubble, ...styles.chatAI }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>APIFORGE AI</div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <PulsingDot delay={0} /><PulsingDot delay={0.2} /><PulsingDot delay={0.4} />
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>
              <div style={styles.chatInputRow}>
                <input
                  style={styles.chatInput}
                  placeholder="Ask about the API..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !isChatLoading && handleChat()}
                  disabled={isChatLoading}
                />
                <button style={{ ...styles.chatSendBtn, opacity: isChatLoading ? 0.5 : 1 }} onClick={handleChat} disabled={isChatLoading}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={styles.rightPanel}>
          {showCode ? (
            <>
              <div style={styles.langBar}>
                <div style={{ display: "flex", gap: 2 }}>
                  {["python", "nodejs", "curl"].map(lang => (
                    <button
                      key={lang}
                      style={{ ...styles.langTab, ...(language === lang ? styles.langTabActive : {}) }}
                      onClick={() => handleLanguageChange(lang)}
                      disabled={isGenerating}
                    >
                      {lang === "nodejs" ? "Node.js" : lang === "curl" ? "cURL" : "Python"}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={styles.copyBtn} onClick={() => navigator.clipboard?.writeText(sdkCache[language] || "")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </button>
                  <button
                    style={{ ...styles.regenerateBtn, opacity: isGenerating ? 0.5 : 1 }}
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    title="Force re-generate from AI"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    Regenerate
                  </button>
                  <button style={styles.downloadBtn} onClick={handleDownloadSDK}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </button>
                </div>
              </div>

              <div style={styles.codeBlock} ref={codeRef}>
                {isGenerating && !sdkCache[language] ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
                    <div style={styles.analyzeSpinner} />
                    <span style={{ color: "#64748b", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                      Generating {language === "nodejs" ? "Node.js" : language === "curl" ? "cURL" : "Python"} SDK...
                    </span>
                  </div>
                ) : (
                  <>
                    {isGenerating && (
                      <div style={styles.regeneratingBanner}>
                        <div style={{ ...styles.miniSpinner, borderTopColor: "#818cf8" }} />
                        Regenerating...
                      </div>
                    )}
                    <pre style={styles.codePre}>{sdkCache[language] || ""}</pre>
                  </>
                )}
              </div>
            </>
          ) : (
            selectedEndpoint ? (
              <div style={styles.detailPanel}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <span style={{
                    ...styles.methodBadge,
                    fontSize: 13, padding: "4px 12px",
                    background: methodColors[selectedEndpoint.method]?.bg,
                    color: methodColors[selectedEndpoint.method]?.text,
                    border: `1px solid ${methodColors[selectedEndpoint.method]?.border}`,
                  }}>{selectedEndpoint.method}</span>
                  <span style={{ color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", fontSize: 15 }}>
                    {selectedEndpoint.path}
                  </span>
                </div>

                <div style={styles.detailSection}>
                  <div style={styles.detailLabel}>Description</div>
                  <p style={styles.detailText}>{selectedEndpoint.description}</p>
                </div>

                {selectedEndpoint.parameters.length > 0 && (
                  <div style={styles.detailSection}>
                    <div style={styles.detailLabel}>Parameters</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {selectedEndpoint.parameters.map((p, i) => (
                        <div key={i} style={styles.paramRow}>
                          <span style={styles.paramName}>{p.name}</span>
                          <span style={styles.paramType}>{p.type || "string"}</span>
                          {p.required && (
                            <span style={{ color: "#ef4444", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", marginLeft: 4 }}>required</span>
                          )}
                          {p.description && (
                            <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto" }}>{p.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedEndpoint.request_body && selectedEndpoint.request_body !== "unknown" && (
                  <div style={styles.detailSection}>
                    <div style={styles.detailLabel}>Request Body Example</div>
                    <div style={{ ...styles.codeBlock, padding: 14 }}>
                      <pre style={{ ...styles.codePre, fontSize: 12 }}>{selectedEndpoint.request_body}</pre>
                    </div>
                  </div>
                )}

                {selectedEndpoint.response_example && selectedEndpoint.response_example !== "unknown" && (
                  <div style={styles.detailSection}>
                    <div style={styles.detailLabel}>Response Example</div>
                    <div style={{ ...styles.codeBlock, padding: 14 }}>
                      <pre style={{ ...styles.codePre, fontSize: 12 }}>{selectedEndpoint.response_example}</pre>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.emptyState}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
                <p style={{ color: "#475569", fontSize: 14, textAlign: "center", lineHeight: 1.6, marginTop: 12 }}>
                  Select an endpoint to see details<br />
                  or click <strong style={{ color: "#818cf8" }}>Generate SDK</strong> to create code
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const keyframes = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
  @keyframes pulse-dot {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
`;

const styles = {
  container: {
    width: "100%", height: "100vh", background: "#0a0e1a",
    fontFamily: "'Inter', sans-serif", color: "#e2e8f0",
    display: "flex", flexDirection: "column", overflow: "hidden",
  },
  landing: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    position: "relative", padding: 24,
  },
  gridBg: {
    position: "absolute", inset: 0, opacity: 0.04,
    backgroundImage: "linear-gradient(#818cf8 1px, transparent 1px), linear-gradient(90deg, #818cf8 1px, transparent 1px)",
    backgroundSize: "60px 60px", pointerEvents: "none",
  },
  logoIcon: {
    width: 40, height: 40, borderRadius: 10,
    background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.2)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  landingTitle: {
    fontSize: 32, fontWeight: 800, margin: 0,
    fontFamily: "'JetBrains Mono', monospace",
    background: "linear-gradient(135deg, #818cf8, #c084fc, #818cf8)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  landingSubtitle: {
    color: "#64748b", fontSize: 16, margin: "4px 0 32px",
    textAlign: "center", maxWidth: 420,
  },
  errorBox: {
    display: "flex", alignItems: "center", gap: 8,
    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
    color: "#fca5a5", fontSize: 13, padding: "10px 14px",
    borderRadius: 8, marginBottom: 16,
  },
  inputGroup: {
    display: "flex", alignItems: "center",
    background: "#0f1629", border: "1px solid rgba(129,140,248,0.15)",
    borderRadius: 12, padding: "4px 4px 4px 14px",
    width: "100%", maxWidth: 560, marginBottom: 16,
  },
  inputIcon: { display: "flex", marginRight: 8, flexShrink: 0 },
  urlInput: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#e2e8f0", fontSize: 14, fontFamily: "'JetBrains Mono', monospace",
    padding: "10px 0",
  },
  analyzeBtn: {
    background: "linear-gradient(135deg, #6366f1, #818cf8)",
    border: "none", color: "white", padding: "10px 20px",
    borderRadius: 8, fontWeight: 600, fontSize: 14,
    display: "flex", alignItems: "center", gap: 8,
    cursor: "pointer", fontFamily: "'Inter', sans-serif", flexShrink: 0,
  },
  exampleLabel: { color: "#475569", fontSize: 12, lineHeight: "28px" },
  exampleChip: {
    background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.15)",
    color: "#818cf8", fontSize: 12, padding: "4px 12px",
    borderRadius: 20, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
  },
  featurePill: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 16px", borderRadius: 24,
    background: "rgba(30,41,59,0.5)", border: "1px solid rgba(51,65,85,0.5)",
  },
  analyzing: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },
  analyzeSpinner: {
    width: 48, height: 48, borderRadius: "50%",
    border: "3px solid rgba(129,140,248,0.15)",
    borderTopColor: "#818cf8", animation: "spin 1s linear infinite",
  },
  miniSpinner: {
    width: 14, height: 14, borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.3)",
    borderTopColor: "white", animation: "spin 0.8s linear infinite",
  },
  topBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 20px", borderBottom: "1px solid rgba(51,65,85,0.4)",
    background: "rgba(15,22,41,0.8)", backdropFilter: "blur(12px)",
    flexWrap: "wrap", gap: 10,
  },
  infoBadge: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "4px 14px", borderRadius: 8,
    background: "rgba(30,41,59,0.6)", border: "1px solid rgba(51,65,85,0.4)", gap: 2,
  },
  newAnalysisBtn: {
    background: "none", border: "1px solid rgba(51,65,85,0.5)",
    color: "#64748b", fontSize: 12, padding: "6px 12px",
    borderRadius: 6, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  splitLayout: { flex: 1, display: "flex", overflow: "hidden" },
  leftPanel: {
    width: "50%", display: "flex", flexDirection: "column",
    borderRight: "1px solid rgba(51,65,85,0.4)",
    background: "rgba(10,14,26,0.6)",
  },
  tabBar: {
    display: "flex", gap: 0, padding: "0 16px",
    borderBottom: "1px solid rgba(51,65,85,0.3)",
  },
  tab: {
    padding: "12px 16px", background: "none", border: "none",
    color: "#64748b", fontSize: 13, cursor: "pointer",
    fontWeight: 500, display: "flex", alignItems: "center", gap: 6,
    borderBottom: "2px solid transparent", fontFamily: "'Inter', sans-serif",
  },
  tabActive: { color: "#818cf8", borderBottomColor: "#818cf8" },
  tabCount: {
    background: "rgba(129,140,248,0.15)", color: "#818cf8",
    fontSize: 10, padding: "2px 6px", borderRadius: 10,
    fontFamily: "'JetBrains Mono', monospace",
  },
  searchRow: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 16px", borderBottom: "1px solid rgba(51,65,85,0.2)",
  },
  searchBox: {
    flex: 1, display: "flex", alignItems: "center", gap: 8,
    background: "#0f1629", borderRadius: 8, padding: "6px 12px",
    border: "1px solid rgba(51,65,85,0.3)",
  },
  searchInput: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#e2e8f0", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
  },
  selectAllBtn: {
    background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.2)",
    color: "#818cf8", fontSize: 11, padding: "6px 12px",
    borderRadius: 6, cursor: "pointer", fontWeight: 500,
    whiteSpace: "nowrap", fontFamily: "'Inter', sans-serif",
  },
  endpointList: { flex: 1, overflow: "auto", padding: "4px 8px" },
  endpointRow: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 12px", borderRadius: 8, cursor: "pointer",
    marginBottom: 2, transition: "background 0.15s ease",
    border: "1px solid transparent",
  },
  endpointRowActive: {
    background: "rgba(129,140,248,0.06)",
    border: "1px solid rgba(129,140,248,0.12)",
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 4, border: "1.5px solid #334155",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", flexShrink: 0, transition: "all 0.15s ease",
  },
  checkboxChecked: { background: "#6366f1", borderColor: "#6366f1" },
  methodBadge: {
    fontSize: 10, fontWeight: 700, padding: "3px 8px",
    borderRadius: 4, fontFamily: "'JetBrains Mono', monospace",
    flexShrink: 0, letterSpacing: 0.5,
  },
  endpointPath: { color: "#e2e8f0", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" },
  endpointDesc: { color: "#475569", fontSize: 11, marginTop: 2 },
  bottomBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 16px", borderTop: "1px solid rgba(51,65,85,0.3)",
    background: "rgba(15,22,41,0.5)",
  },
  exportBtn: {
    display: "flex", alignItems: "center", gap: 6,
    background: "rgba(30,41,59,0.6)", border: "1px solid rgba(51,65,85,0.5)",
    color: "#94a3b8", fontSize: 12, padding: "7px 14px",
    borderRadius: 6, cursor: "pointer", fontWeight: 500,
    fontFamily: "'Inter', sans-serif",
  },
  generateBtn: {
    display: "flex", alignItems: "center", gap: 6,
    background: "linear-gradient(135deg, #6366f1, #818cf8)",
    border: "none", color: "white", fontSize: 13, padding: "8px 18px",
    borderRadius: 8, cursor: "pointer", fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
  },
  rightPanel: {
    width: "50%", display: "flex", flexDirection: "column",
    background: "rgba(8,11,22,0.8)",
  },
  langBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 16px", borderBottom: "1px solid rgba(51,65,85,0.3)",
    flexWrap: "wrap", gap: 8,
  },
  langTab: {
    background: "none", border: "none", color: "#475569", fontSize: 12,
    padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontWeight: 500,
    fontFamily: "'JetBrains Mono', monospace",
  },
  langTabActive: { background: "rgba(129,140,248,0.12)", color: "#818cf8" },
  copyBtn: {
    display: "flex", alignItems: "center", gap: 5,
    background: "none", border: "1px solid rgba(51,65,85,0.4)",
    color: "#94a3b8", fontSize: 11, padding: "5px 12px",
    borderRadius: 6, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  regenerateBtn: {
    display: "flex", alignItems: "center", gap: 5,
    background: "rgba(129,140,248,0.06)", border: "1px solid rgba(129,140,248,0.2)",
    color: "#818cf8", fontSize: 11, padding: "5px 12px",
    borderRadius: 6, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  regeneratingBanner: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 12px", marginBottom: 12,
    background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.15)",
    borderRadius: 6, color: "#818cf8", fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  downloadBtn: {
    display: "flex", alignItems: "center", gap: 5,
    background: "rgba(129,140,248,0.12)", border: "1px solid rgba(129,140,248,0.25)",
    color: "#c7d2fe", fontSize: 11, padding: "5px 12px",
    borderRadius: 6, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  codeBlock: {
    flex: 1, overflow: "auto", background: "#080b16", padding: 20,
  },
  codePre: {
    margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.7,
    fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap",
  },
  emptyState: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },
  detailPanel: { flex: 1, overflow: "auto", padding: 24, animation: "fadeIn 0.3s ease" },
  detailSection: { marginBottom: 24 },
  detailLabel: {
    color: "#64748b", fontSize: 10, fontWeight: 600,
    letterSpacing: 1.2, textTransform: "uppercase",
    marginBottom: 8, fontFamily: "'JetBrains Mono', monospace",
  },
  detailText: { color: "#cbd5e1", fontSize: 14, lineHeight: 1.7, margin: 0 },
  paramRow: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "6px 12px", borderRadius: 6,
    background: "rgba(30,41,59,0.4)", border: "1px solid rgba(51,65,85,0.3)",
    flexWrap: "wrap",
  },
  paramName: { color: "#818cf8", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 },
  paramType: { color: "#475569", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  chatPanel: { flex: 1, display: "flex", flexDirection: "column" },
  chatMessages: {
    flex: 1, overflow: "auto", padding: 16,
    display: "flex", flexDirection: "column", gap: 12,
  },
  chatBubble: {
    padding: "12px 16px", borderRadius: 12,
    fontSize: 13, lineHeight: 1.6, maxWidth: "85%",
  },
  chatUser: {
    background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.15)",
    alignSelf: "flex-end", color: "#c7d2fe",
  },
  chatAI: {
    background: "rgba(30,41,59,0.5)", border: "1px solid rgba(51,65,85,0.3)",
    alignSelf: "flex-start", color: "#cbd5e1",
  },
  chatInputRow: {
    display: "flex", gap: 8, padding: "12px 16px",
    borderTop: "1px solid rgba(51,65,85,0.3)",
  },
  chatInput: {
    flex: 1, background: "#0f1629", border: "1px solid rgba(51,65,85,0.3)",
    borderRadius: 8, padding: "10px 14px", color: "#e2e8f0",
    fontSize: 13, outline: "none", fontFamily: "'Inter', sans-serif",
  },
  chatSendBtn: {
    background: "linear-gradient(135deg, #6366f1, #818cf8)",
    border: "none", borderRadius: 8, padding: "0 14px",
    cursor: "pointer", display: "flex", alignItems: "center",
  },
};
