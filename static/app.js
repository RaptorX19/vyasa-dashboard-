const { useState, useEffect, useRef, useMemo } = React;

// Categorical palette: distinct hues (brand violet leads) so adjacent slices are easy to tell apart.
const PALETTE = ["#6d3bd4", "#2563eb", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#ef4444", "#14b8a6", "#64748b"];
const RELEVANCE_COLORS = { High: "#b42318", "Medium-High": "#d97706", Medium: "#ca8a04", Low: "#6366f1", "Not specified": "#c9c3df" };

const api = {
  async get(url) { const r = await fetch(url); return r.json(); },
  async post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    return r.json();
  },
  async put(url, body) {
    const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  },
  async del(url) { const r = await fetch(url, { method: "DELETE" }); return r.json(); },
};

const fmtFunding = (m) => {
  if (!m) return "—";
  const v = Math.round(m * 10) / 10;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`;
  return `$${Number.isInteger(v) ? v : v.toFixed(1)}M`;
};
const blankComp = () => ({
  name: "", category: "", categoryGroup: 0, website: "", founder: "", customerSegment: "",
  relevance: "High", overview: "", established: "", fundingStage: "", fundingAmount: 0,
  fundingYear: "", investors: "", strategicNotes: "",
  strengths: [], weaknesses: [], opportunities: [], threats: [],
});

// Composite competitive-threat score 0-100 from relevance, funding and context depth.
const threatScore = (c) => {
  const rel = { High: 40, "Medium-High": 30, Medium: 20, Low: 10 }[c.relevance] || 8;
  const fund = Math.min((Number(c.fundingAmount) || 0) / 15, 30);
  const ctx = (Number(c.contextScore) || 0) * 0.3;
  return Math.min(100, Math.round(rel + fund + ctx));
};
const scoreCls = (n) => (n >= 66 ? "hi" : n >= 40 ? "mid" : "lo");
const capCls = (v) => (v === "full" || v === "direct" ? (v === "direct" ? "direct" : "full") : v === "partial" ? "partial" : "none");
const capText = { full: "Full", partial: "Partial", none: "—", direct: "Direct", };

/* ---------------- Charts ---------------- */
function Donut({ data, colors }) {
  const ref = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    if (chart.current) chart.current.destroy();
    chart.current = new Chart(ref.current, {
      type: "doughnut",
      data: { labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.value), backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
      options: { cutout: "62%", plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false },
    });
    return () => chart.current && chart.current.destroy();
  }, [JSON.stringify(data), JSON.stringify(colors)]);
  return <canvas ref={ref}></canvas>;
}

function Bars({ data, color, horizontal }) {
  const ref = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    if (chart.current) chart.current.destroy();
    chart.current = new Chart(ref.current, {
      type: "bar",
      data: { labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.value), backgroundColor: data.map((d, i) => (Array.isArray(color) ? color[i % color.length] : color)), borderRadius: 6, barThickness: horizontal ? 18 : undefined, maxBarThickness: 46 }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: !horizontal, color: "#eee" }, ticks: { font: { size: 11 } } }, y: { grid: { display: horizontal, color: "#eee" }, ticks: { font: { size: 11 } }, beginAtZero: true } },
        responsive: true, maintainAspectRatio: false,
      },
    });
    return () => chart.current && chart.current.destroy();
  }, [JSON.stringify(data), JSON.stringify(color), horizontal]);
  return <canvas ref={ref}></canvas>;
}

function Legend({ data, colors }) {
  return (
    <div className="legend">
      {data.map((d, i) => (
        <div className="legend-item" key={d.label}>
          <span className="legend-dot" style={{ background: colors[i % colors.length] }}></span>
          <span className="legend-name">{d.label}</span>
          <span className="legend-val">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ items, labels, events, setView }) {
  const total = items.length;
  const totalFunding = items.reduce((s, c) => s + (Number(c.fundingAmount) || 0), 0);
  const highRel = items.filter((c) => c.relevance === "High").length;
  const avgCtx = total ? Math.round(items.reduce((s, c) => s + (Number(c.contextScore) || 0), 0) / total) : 0;

  const byCat = useMemo(() => {
    const m = {};
    items.forEach((c) => { const k = labels[c.categoryGroup] || "Uncategorized"; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [items, labels]);

  const byRel = useMemo(() => {
    const order = ["High", "Medium-High", "Medium", "Low", "Not specified"];
    const m = {};
    items.forEach((c) => { const k = c.relevance || "Not specified"; m[k] = (m[k] || 0) + 1; });
    return order.filter((k) => m[k]).map((k) => ({ label: k, value: m[k] }));
  }, [items]);

  const topThreats = useMemo(() => [...items].map((c) => ({ ...c, ts: threatScore(c) })).sort((a, b) => b.ts - a.ts).slice(0, 6), [items]);
  const recentSignals = (events || []).slice(0, 5);

  const catColors = byCat.map((_, i) => PALETTE[i % PALETTE.length]);
  const relColors = byRel.map((d) => RELEVANCE_COLORS[d.label] || "#ccc");

  return (
    <div>
      <div className="page-head">
        <h1>Competitive Landscape <em>Intelligence</em></h1>
        <p>The reasoning &amp; orchestration layer above the stack — tracking {total} competitors across AI-native ERP, agentic workflows, procurement, and finance automation.</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Total Competitors</div><div className="stat-value violet">{total}</div><div className="stat-sub">{items.filter((c) => c.source === "ai-discovered").length} AI-discovered</div></div>
        <div className="stat-card"><div className="stat-label">Funding Tracked</div><div className="stat-value indigo">{fmtFunding(totalFunding)}</div><div className="stat-sub">Across {items.filter((c) => c.fundingAmount > 0).length} rounds</div></div>
        <div className="stat-card"><div className="stat-label">High-Relevance Threats</div><div className="stat-value warn">{highRel}</div><div className="stat-sub">Direct competitors to Vyasa</div></div>
        <div className="stat-card"><div className="stat-label">Avg Context Score</div><div className="stat-value good">{avgCtx}</div><div className="stat-sub">Vyasa benchmark: 100</div></div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Competitors by Category</h2>
          <div className="chart-row">
            <div className="chart-box"><Donut data={byCat} colors={catColors} /></div>
            <Legend data={byCat} colors={catColors} />
          </div>
        </div>
        <div className="panel">
          <h2>Relevance Distribution</h2>
          <div className="chart-row">
            <div className="chart-box"><Donut data={byRel} colors={relColors} /></div>
            <Legend data={byRel} colors={relColors} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Top Competitive Threats</h2>
          <p className="sub">Composite score from relevance, funding and context-intelligence depth.</p>
          {topThreats.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 150, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div className="bar" style={{ flex: 1 }}><span style={{ width: `${c.ts}%` }}></span></div>
              <span className={`score ${scoreCls(c.ts)}`}>{c.ts}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Recent Signals</h2>
            <button className="btn sm" onClick={() => setView("signals")}>View all →</button>
          </div>
          <p className="sub">Latest funding, product and GTM moves.</p>
          <div className="timeline">
            {recentSignals.length === 0 ? <div className="tag">No signals yet.</div> : recentSignals.map((e) => (
              <div className={`tl-item ${e.type || ""}`} key={e.id}>
                <div className="tl-date">{e.date} · {e.competitor}</div>
                <div className="tl-title">{e.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Companies ---------------- */
function Companies({ items, labels, onOpen, onAdd, onDiscover }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [rel, setRel] = useState("all");
  const [sort, setSort] = useState("threat");

  let filtered = items.filter((c) => {
    if (q && !(`${c.name} ${c.overview} ${c.investors} ${c.customerSegment}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (cat !== "all" && String(c.categoryGroup) !== cat) return false;
    if (rel !== "all" && c.relevance !== rel) return false;
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (sort === "threat") return threatScore(b) - threatScore(a);
    if (sort === "funding") return (b.fundingAmount || 0) - (a.fundingAmount || 0);
    if (sort === "context") return (b.contextScore || 0) - (a.contextScore || 0);
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <div className="page-head">
        <h1>Companies</h1>
        <p>{filtered.length} of {items.length} competitors shown. Click any card for the full profile, capabilities and battlecard.</p>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="Search name, overview, investors, segment…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select" value={rel} onChange={(e) => setRel(e.target.value)}>
          <option value="all">All relevance</option>
          {["High", "Medium-High", "Medium", "Low", "Not specified"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="threat">Sort: Threat</option>
          <option value="funding">Sort: Funding</option>
          <option value="context">Sort: Context score</option>
          <option value="name">Sort: Name</option>
        </select>
        <button className="btn" onClick={onDiscover}>✦ Discover</button>
        <button className="btn primary" onClick={onAdd}>+ Add</button>
      </div>

      {filtered.length === 0 ? <div className="empty">No competitors match your filters.</div> : (
        <div className="card-grid">
          {filtered.map((c) => {
            const ts = threatScore(c);
            return (
              <div className="cc" key={c.id} onClick={() => onOpen(c)}>
                <div className="cc-top">
                  <div className="cc-name">{c.name}</div>
                  <span className={`score ${scoreCls(ts)}`} title="Threat score">{ts}</span>
                </div>
                <div className="cc-meta">
                  <span className="pill cat">{labels[c.categoryGroup] || "Uncategorized"}</span>
                  <span className={`pill ${(c.relevance || "Not specified").replace(/\s/g, "-")}`}>{c.relevance}</span>
                  <span className={`pill src-${c.source}`}>{c.source === "ai-discovered" ? "AI" : c.source}</span>
                </div>
                <div className="cc-overview">{c.overview || "No overview yet."}</div>
                <div className="cc-foot">
                  <span className="cc-funding">{fmtFunding(c.fundingAmount)}{c.fundingStage && c.fundingStage !== "Not specified" ? ` · ${c.fundingStage}` : ""}</span>
                  <span className="tag">Context {c.contextScore != null ? c.contextScore : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Positioning map ---------------- */
function Landscape({ items, axes, vyasa }) {
  const keys = Object.keys(axes || {});
  const [xa, setXa] = useState("orchestration");
  const [ya, setYa] = useState("reasoning");
  if (!keys.length) return <div className="empty">Loading axes…</div>;
  const pts = [...items, vyasa].filter((c) => c && c.positioning);

  const axisLabel = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  return (
    <div>
      <div className="page-head">
        <h1>Positioning &amp; <em>White-space</em></h1>
        <p>Where each competitor sits across the dimensions that define Vyasa. The dashed zone — high reasoning × high orchestration — is largely uncontested white-space.</p>
      </div>
      <div className="toolbar">
        <div className="field" style={{ width: 240 }}><label>X axis</label>
          <select className="select" value={xa} onChange={(e) => setXa(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{axisLabel(k)}</option>)}</select>
        </div>
        <div className="field" style={{ width: 240 }}><label>Y axis</label>
          <select className="select" value={ya} onChange={(e) => setYa(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{axisLabel(k)}</option>)}</select>
        </div>
      </div>
      <div className="panel">
        <div style={{ padding: "12px 30px 50px 50px" }}>
          <div className="map-wrap">
            <div className="whitespace">Vyasa<br />white-space</div>
            {pts.map((c) => {
              const isV = c.id === "vyasa";
              return (
                <div key={c.id} className={`map-pt ${isV ? "vyasa" : ""}`} style={{ left: `${c.positioning[xa]}%`, bottom: `${c.positioning[ya]}%` }} title={`${c.name}: ${axisLabel(xa)} ${c.positioning[xa]}, ${axisLabel(ya)} ${c.positioning[ya]}`}>
                  <span className="map-dot"></span>
                  <span className="map-lbl">{c.name}</span>
                </div>
              );
            })}
            <div className="map-axis-x"><span>{axes[xa] && axes[xa][0]}</span><span>{axes[xa] && axes[xa][1]} →</span></div>
            <div className="map-axis-y"><span className="hi">{axes[ya] && axes[ya][1]} →</span><span className="lo">{axes[ya] && axes[ya][0]}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Compare (capability matrix) ---------------- */
function Compare({ items, labels, capLabels, vyasa }) {
  const [sel, setSel] = useState([]);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));
  const chosen = sel.map((id) => items.find((c) => c.id === id)).filter(Boolean);
  const capKeys = Object.keys(capLabels || {});
  const cols = [vyasa, ...chosen];

  return (
    <div>
      <div className="page-head">
        <h1>Capability <em>Comparison</em></h1>
        <p>Select up to 4 competitors. Each is scored against Vyasa across the seven capabilities that define an enterprise reasoning + orchestration layer.</p>
      </div>
      <div className="chips">
        {items.map((c) => <button key={c.id} className={`chip ${sel.includes(c.id) ? "on" : ""}`} onClick={() => toggle(c.id)}>{c.name}</button>)}
      </div>
      {chosen.length === 0 ? <div className="empty">Pick competitors above to compare capabilities against Vyasa.</div> : (
        <div className="matrix-wrap">
          <table className="matrix">
            <thead><tr>
              <th className="rowlabel">Capability</th>
              {cols.map((c) => <th key={c.id} className={c.id === "vyasa" ? "vyasa" : ""}>{c.name}</th>)}
            </tr></thead>
            <tbody>
              {capKeys.map((k) => (
                <tr key={k}>
                  <td className="rowlabel">{capLabels[k]}</td>
                  {cols.map((c) => {
                    const v = (c.capabilities || {})[k] || "none";
                    return <td key={c.id} className={c.id === "vyasa" ? "vyasa" : ""}><span className={`cap ${capCls(v)}`}>{capText[v] || "—"}</span></td>;
                  })}
                </tr>
              ))}
              <tr>
                <td className="rowlabel">Context score</td>
                {cols.map((c) => <td key={c.id} className={c.id === "vyasa" ? "vyasa" : ""}><b>{c.contextScore != null ? c.contextScore : "—"}</b></td>)}
              </tr>
              <tr>
                <td className="rowlabel">Funding</td>
                {cols.map((c) => <td key={c.id} className={c.id === "vyasa" ? "vyasa" : ""}>{c.id === "vyasa" ? "—" : fmtFunding(c.fundingAmount)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Workflows (overlap heatmap) ---------------- */
function Workflows({ items, wfLabels, vyasa }) {
  const wfKeys = Object.keys(wfLabels || {});
  const [q, setQ] = useState("");
  const rows = [vyasa, ...items.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))];
  return (
    <div>
      <div className="page-head">
        <h1>Workflow-Overlap <em>Mapping</em></h1>
        <p>Direct vs. partial overlap with the eight enterprise workflows Vyasa orchestrates. Red = direct competition on that workflow.</p>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="Filter competitors…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "flex", gap: 14, fontSize: 13, alignItems: "center" }}>
          <span><span className="cap direct" style={{ padding: "2px 10px" }}>Direct</span></span>
          <span><span className="cap partial" style={{ padding: "2px 10px" }}>Partial</span></span>
          <span><span className="cap none" style={{ padding: "2px 10px" }}>None</span></span>
        </div>
      </div>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead><tr>
            <th className="rowlabel">Competitor</th>
            {wfKeys.map((k) => <th key={k}>{wfLabels[k]}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="rowlabel">{c.id === "vyasa" ? <b style={{ color: "#6d3bd4" }}>{c.name}</b> : c.name}</td>
                {wfKeys.map((k) => {
                  const v = (c.workflows || {})[k] || "none";
                  return <td key={k}><span className={`cap ${capCls(v)}`}>{v === "direct" ? "Direct" : v === "partial" ? "Partial" : "—"}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Battlecards ---------------- */
function Battlecards({ items, aiEnabled, onUpdated }) {
  const [selId, setSelId] = useState(items[0] ? items[0].id : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const comp = items.find((c) => c.id === selId);
  const bc = comp && comp.battlecard;

  const regen = async () => {
    setLoading(true); setError("");
    const res = await api.post(`/api/battlecard/${selId}`, {});
    setLoading(false);
    if (res.error) setError(res.error);
    else onUpdated();
  };

  const List = ({ title, items: list, hl }) => (
    <div className={`bc-box ${hl ? "hl" : ""}`}><h4>{title}</h4>{list && list.length ? <ul>{list.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="tag">—</p>}</div>
  );

  return (
    <div>
      <div className="page-head">
        <h1>Sales <em>Battlecards</em></h1>
        <p>GTM positioning for sellers facing each competitor — why they win, where Vyasa is stronger, and how to handle the objection.</p>
      </div>
      <div className="toolbar">
        <select className="select" value={selId || ""} onChange={(e) => setSelId(e.target.value)} style={{ minWidth: 280 }}>
          {items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn accent" disabled={!aiEnabled || loading} onClick={regen}>{loading ? <><span className="spinner"></span> Generating…</> : "✦ Regenerate with AI"}</button>
        {comp && comp.battlecard && <span className={`pill src-${comp.battlecard.source === "ai" ? "ai-discovered" : "seed"}`}>{comp.battlecard.source === "ai" ? "AI-generated" : "Seeded"}</span>}
      </div>
      {!aiEnabled && <div className="note warn">Showing seeded battlecards. Set <code>OPENAI_API_KEY</code> to regenerate with live web research.</div>}
      {error && <div className="note err">{error}</div>}
      {!bc ? <div className="empty">No battlecard for this competitor yet.</div> : (
        <div className="panel">
          <dl className="kv">
            <dt>What they sell</dt><dd>{bc.sells}</dd>
            <dt>Who buys</dt><dd>{bc.buyers}</dd>
            <dt>Why they're chosen</dt><dd>{bc.whyChosen}</dd>
          </dl>
          <div className="bc-grid">
            <List title="Where they're strong" items={bc.strong} />
            <List title="Where Vyasa is stronger" items={bc.vyasaStronger} hl />
          </div>
          <div className="section-label">Objection handling</div>
          <div className="bc-box"><h4>If the buyer says</h4><p>{bc.objection}</p></div>
          <div className="bc-box hl" style={{ marginTop: 12 }}><h4>Vyasa response</h4><p>{bc.response}</p></div>
          <div className="bc-grid" style={{ marginTop: 16 }}>
            <List title="Discovery questions" items={bc.discovery} />
            <List title="Don't compete on" items={bc.doNotCompete} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Accounts ---------------- */
function Accounts({ aiEnabled }) {
  const [account, setAccount] = useState("");
  const [systems, setSystems] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState(null);

  const run = async () => {
    if (!account.trim()) return;
    setLoading(true); setError(""); setRes(null);
    const r = await api.post("/api/account-intel", { account, systems });
    setLoading(false);
    if (r.error) setError(r.error); else setRes(r);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Account <em>Intelligence</em></h1>
        <p>Research a target account: which competitors are likely incumbents, the systems in play, and how Vyasa should be positioned to win it.</p>
      </div>
      {!aiEnabled && <div className="note warn">Account intelligence needs live web research. Set <code>OPENAI_API_KEY</code> and restart the server.</div>}
      <div className="discover-bar">
        <div className="field" style={{ flex: 1, minWidth: 240 }}><label>Target account</label><input className="search" placeholder="e.g. Acme Manufacturing" value={account} onChange={(e) => setAccount(e.target.value)} /></div>
        <div className="field" style={{ flex: 1, minWidth: 240 }}><label>Known systems (optional)</label><input className="search" placeholder="SAP, Salesforce, Coupa…" value={systems} onChange={(e) => setSystems(e.target.value)} /></div>
        <button className="btn accent" disabled={!aiEnabled || loading} onClick={run}>{loading ? <><span className="spinner"></span> Researching…</> : "✦ Analyze account"}</button>
      </div>
      {error && <div className="note err">{error}</div>}
      {res && (
        <div className="grid-2">
          <div className="panel">
            <h2>Likely competitors</h2>
            {(res.likelyCompetitors || []).map((x, i) => <div key={i} style={{ marginBottom: 12 }}><b>{x.name}</b><div className="tag" style={{ fontSize: 13 }}>{x.why}</div></div>)}
          </div>
          <div className="panel">
            <h2>Tech stack</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>{(res.stack || []).map((s, i) => <span key={i} className="pill cat">{s}</span>)}</div>
            <h2>Pain points</h2>
            <ul>{(res.painPoints || []).map((p, i) => <li key={i} style={{ marginBottom: 6 }}>{p}</li>)}</ul>
          </div>
          <div className="panel">
            <h2>Relevant Vyasa use-cases</h2>
            <ul>{(res.relevantUseCases || []).map((u, i) => <li key={i} style={{ marginBottom: 6 }}>{u}</li>)}</ul>
          </div>
          <div className="panel">
            <h2>How to position</h2>
            <div className="evidence" style={{ marginBottom: 14 }}><b>Displace vs. coexist:</b>&nbsp;{res.displacementVsCoexist}</div>
            <p style={{ lineHeight: 1.6 }}>{res.recommendedPositioning}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Signals ---------------- */
function Signals({ events, items, onChange }) {
  const [adding, setAdding] = useState(false);
  const blank = { competitor: "", date: new Date().toISOString().slice(0, 10), type: "funding", title: "", detail: "", source: "", impact: "" };
  const [f, setF] = useState(blank);

  const save = async () => {
    if (!f.title.trim() || !f.competitor) return;
    const comp = items.find((c) => c.id === f.competitor);
    await api.post("/api/events", { ...f, competitorId: f.competitor, competitor: comp ? comp.name : f.competitor });
    setF(blank); setAdding(false); onChange();
  };
  const del = async (id) => { if (confirm("Delete this signal?")) { await api.del(`/api/events/${id}`); onChange(); } };

  return (
    <div>
      <div className="page-head">
        <h1>Competitor <em>Signals</em></h1>
        <p>Funding rounds, product launches and GTM moves across the tracked landscape — newest first.</p>
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add signal"}</button>
        <span className="tag">{events.length} signals</span>
      </div>
      {adding && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="form-grid">
            <div className="field"><label>Competitor</label><select value={f.competitor} onChange={(e) => setF({ ...f, competitor: e.target.value })}><option value="">Select…</option>{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="field"><label>Date</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label>Type</label><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["funding", "product", "gtm", "other"].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="field"><label>Impact</label><input value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} placeholder="High / Medium / Low" /></div>
            <div className="field full"><label>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="field full"><label>Detail</label><textarea value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></div>
            <div className="field full"><label>Source URL</label><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
          </div>
          <div className="form-actions"><button className="btn primary" onClick={save}>Save signal</button></div>
        </div>
      )}
      <div className="panel">
        {events.length === 0 ? <div className="empty">No signals yet.</div> : (
          <div className="timeline">
            {events.map((e) => (
              <div className={`tl-item ${e.type || ""}`} key={e.id}>
                <div className="tl-date">{e.date} · {e.competitor} · {e.type}</div>
                <div className="tl-title">{e.title}</div>
                {e.detail && <div className="tl-detail">{e.detail}</div>}
                <div className="tl-foot">
                  {e.impact && <span className="tag">Impact: {e.impact}</span>}
                  {e.source && <a href={e.source} target="_blank" rel="noreferrer">source</a>}
                  <button className="btn sm danger" onClick={() => del(e.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Insights ---------------- */
function Insights({ aiEnabled }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const run = async () => {
    setLoading(true); setError("");
    const r = await api.post("/api/insights", {});
    setLoading(false);
    if (r.error) setError(r.error); else setData(r);
  };
  useEffect(() => { run(); }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Strategic <em>Insights</em></h1>
        <p>AI-generated "why it matters to Vyasa" analysis across the full competitor set — product gaps, threats, messaging and white-space.</p>
      </div>
      <div className="toolbar">
        <button className="btn accent" disabled={loading} onClick={run}>{loading ? <><span className="spinner"></span> Analyzing…</> : "✦ Regenerate insights"}</button>
        {data && <span className={`pill src-${data.source === "ai" ? "ai-discovered" : "seed"}`}>{data.source === "ai" ? "AI-generated" : "Static fallback"}</span>}
      </div>
      {!aiEnabled && <div className="note warn">Showing static insights. Set <code>OPENAI_API_KEY</code> for live AI-generated strategic analysis.</div>}
      {error && <div className="note err">{error}</div>}
      {loading && !data && <div className="empty"><span className="spinner dark"></span> Generating insights…</div>}
      {data && (data.insights || []).map((ins, i) => (
        <div className="insight" key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h3>{ins.title}</h3>
            <span className="cat-tag">{ins.category}</span>
          </div>
          <p style={{ margin: "6px 0 0", color: "var(--ink-soft)", lineHeight: 1.55 }}>{ins.body}</p>
          <div className="why"><b>Why it matters to Vyasa:</b> {ins.whyItMatters}{ins.confidence && <span className={`conf ${ins.confidence}`} style={{ marginLeft: 8 }}>{ins.confidence}</span>}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Detail modal ---------------- */
function DetailModal({ comp, labels, capLabels, onClose, onEdit, onDelete }) {
  if (!comp) return null;
  const ts = threatScore(comp);
  const Box = ({ cls, title, list }) => (
    <div className={`swot-box ${cls}`}><h4>{title}</h4>{list && list.length ? <ul>{list.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="tag">Not specified</div>}</div>
  );
  const caps = comp.capabilities || {};
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{comp.name}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="pill cat">{labels[comp.categoryGroup] || "Uncategorized"}</span>
              <span className={`pill ${(comp.relevance || "Not specified").replace(/\s/g, "-")}`}>{comp.relevance}</span>
              <span className={`pill src-${comp.source}`}>{comp.source}</span>
              <span className={`score ${scoreCls(ts)}`}>Threat {ts}</span>
              {comp.contextScore != null && <span className="score lo">Context {comp.contextScore}</span>}
            </div>
          </div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {comp.evidenceNote && (
            <div className="evidence">
              <span className={`conf ${comp.confidence || "low"}`}>{comp.confidence || "low"} confidence</span>
              <span>{comp.evidenceNote}{comp.lastVerified ? ` · Verified ${comp.lastVerified}` : ""}</span>
            </div>
          )}
          <dl className="kv">
            <dt>Category</dt><dd>{comp.category || "—"}</dd>
            <dt>Website</dt><dd>{comp.website ? <a href={comp.website} target="_blank" rel="noreferrer">{comp.website}</a> : "—"}</dd>
            {comp.founder && <><dt>Founders</dt><dd>{comp.founder}</dd></>}
            <dt>Customer segment</dt><dd>{comp.customerSegment}</dd>
            <dt>Funding</dt><dd>{fmtFunding(comp.fundingAmount)} {comp.fundingStage && comp.fundingStage !== "Not specified" ? `· ${comp.fundingStage}` : ""} {comp.fundingYear ? `· ${comp.fundingYear}` : ""}</dd>
            <dt>Investors</dt><dd>{comp.investors || "—"}</dd>
            <dt>Overview</dt><dd>{comp.overview || "—"}</dd>
            <dt>Strategic notes</dt><dd>{comp.strategicNotes || "—"}</dd>
          </dl>

          {Object.keys(caps).length > 0 && capLabels && (
            <>
              <div className="section-label">Capabilities vs. Vyasa</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px", marginBottom: 18 }}>
                {Object.entries(capLabels).map(([k, lbl]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5 }}>
                    <span>{lbl}</span><span className={`cap ${capCls(caps[k] || "none")}`} style={{ width: 80 }}>{capText[caps[k]] || "—"}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-label">SWOT</div>
          <div className="swot">
            <Box cls="s" title="Strengths" list={comp.strengths} />
            <Box cls="w" title="Weaknesses" list={comp.weaknesses} />
            <Box cls="o" title="Opportunities" list={comp.opportunities} />
            <Box cls="t" title="Threats" list={comp.threats} />
          </div>
          <div className="form-actions">
            <button className="btn danger" onClick={() => onDelete(comp)}>Delete</button>
            <button className="btn" onClick={() => onEdit(comp)}>Edit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Add/Edit form ---------------- */
function EditModal({ comp, labels, onClose, onSave }) {
  const [f, setF] = useState(() => ({ ...blankComp(), ...comp }));
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setList = (k, v) => set(k, v.split("\n").map((x) => x.trim()).filter(Boolean));
  const isEdit = !!comp;

  const save = () => {
    if (!f.name.trim()) { alert("Name is required"); return; }
    const payload = { ...f, fundingAmount: Number(f.fundingAmount) || 0, categoryGroup: Number(f.categoryGroup) || 0, fundingYear: f.fundingYear ? Number(f.fundingYear) : null };
    onSave(payload, isEdit);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{isEdit ? "Edit competitor" : "Add competitor"}</div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Name *</label><input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field"><label>Website</label><input value={f.website} onChange={(e) => set("website", e.target.value)} /></div>
            <div className="field"><label>Category label</label><input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. 4. Procurement / P2P" /></div>
            <div className="field"><label>Category group</label><select value={f.categoryGroup} onChange={(e) => set("categoryGroup", e.target.value)}>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label>Relevance</label><select value={f.relevance} onChange={(e) => set("relevance", e.target.value)}>{["High", "Medium-High", "Medium", "Low", "Not specified"].map((r) => <option key={r}>{r}</option>)}</select></div>
            <div className="field"><label>Customer segment</label><input value={f.customerSegment} onChange={(e) => set("customerSegment", e.target.value)} /></div>
            <div className="field"><label>Funding stage</label><input value={f.fundingStage} onChange={(e) => set("fundingStage", e.target.value)} placeholder="Seed, Series A…" /></div>
            <div className="field"><label>Funding amount ($M)</label><input type="number" value={f.fundingAmount} onChange={(e) => set("fundingAmount", e.target.value)} /></div>
            <div className="field"><label>Funding year</label><input type="number" value={f.fundingYear || ""} onChange={(e) => set("fundingYear", e.target.value)} /></div>
            <div className="field"><label>Founders</label><input value={f.founder} onChange={(e) => set("founder", e.target.value)} /></div>
            <div className="field full"><label>Investors</label><input value={f.investors} onChange={(e) => set("investors", e.target.value)} /></div>
            <div className="field full"><label>Overview</label><textarea value={f.overview} onChange={(e) => set("overview", e.target.value)} /></div>
            <div className="field full"><label>Strategic notes</label><textarea value={f.strategicNotes} onChange={(e) => set("strategicNotes", e.target.value)} /></div>
            <div className="field"><label>Strengths (one per line)</label><textarea value={(f.strengths || []).join("\n")} onChange={(e) => setList("strengths", e.target.value)} /></div>
            <div className="field"><label>Weaknesses (one per line)</label><textarea value={(f.weaknesses || []).join("\n")} onChange={(e) => setList("weaknesses", e.target.value)} /></div>
            <div className="field"><label>Opportunities (one per line)</label><textarea value={(f.opportunities || []).join("\n")} onChange={(e) => setList("opportunities", e.target.value)} /></div>
            <div className="field"><label>Threats (one per line)</label><textarea value={(f.threats || []).join("\n")} onChange={(e) => setList("threats", e.target.value)} /></div>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save}>{isEdit ? "Save changes" : "Add competitor"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Discover modal ---------------- */
function DiscoverModal({ aiEnabled, onClose, onImported }) {
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [picked, setPicked] = useState({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const run = async () => {
    setLoading(true); setError(""); setInfo(""); setCandidates([]); setPicked({});
    try {
      const res = await api.post("/api/discover", { focus, count: Number(count) });
      if (res.error) setError(res.error);
      else if (!res.candidates || res.candidates.length === 0) setInfo("No new competitors found — they may already be tracked. Try a different focus.");
      else { setCandidates(res.candidates); setPicked(Object.fromEntries(res.candidates.map((_, i) => [i, true]))); }
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  const importSelected = async () => {
    const chosen = candidates.filter((_, i) => picked[i]);
    if (!chosen.length) return;
    setLoading(true);
    const res = await api.post("/api/competitors/import", { competitors: chosen });
    setLoading(false);
    setInfo(`Imported ${res.count} competitor${res.count === 1 ? "" : "s"}.`);
    setCandidates([]); setPicked({});
    onImported();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div className="modal-title">Discover competitors</div><div className="modal-sub">AI web search for new companies in AI-native ERP &amp; agentic enterprise ops.</div></div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!aiEnabled && <div className="note warn">AI discovery is offline. Set the <code>OPENAI_API_KEY</code> environment variable and restart the server to enable live web-search discovery.</div>}
          <div className="discover-bar">
            <div className="field" style={{ flex: 1, minWidth: 260 }}><label>Focus (optional)</label><input className="search" placeholder="e.g. accounts payable agents, EU-based…" value={focus} onChange={(e) => setFocus(e.target.value)} /></div>
            <div className="field" style={{ width: 110 }}><label>How many</label><select className="select" value={count} onChange={(e) => setCount(e.target.value)}>{[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            <button className="btn accent" disabled={!aiEnabled || loading} onClick={run}>{loading ? <><span className="spinner"></span> Searching…</> : "✦ Find"}</button>
          </div>
          {error && <div className="note err">{error}</div>}
          {info && <div className="note">{info}</div>}
          {candidates.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{candidates.length} candidates</h2>
                <button className="btn primary" onClick={importSelected} disabled={loading}>Import selected ({Object.values(picked).filter(Boolean).length})</button>
              </div>
              {candidates.map((c, i) => (
                <div className={`candidate ${picked[i] ? "sel" : ""}`} key={i}>
                  <div className="candidate-top">
                    <input type="checkbox" checked={!!picked[i]} onChange={() => setPicked((p) => ({ ...p, [i]: !p[i] }))} />
                    <span className="candidate-name">{c.name}</span>
                    <span className={`pill ${(c.relevance || "Not specified").replace(/\s/g, "-")}`}>{c.relevance}</span>
                    <span className="cc-funding" style={{ marginLeft: "auto" }}>{fmtFunding(c.fundingAmount)}</span>
                  </div>
                  <div className="cc-overview" style={{ margin: "10px 0 6px" }}>{c.overview}</div>
                  <div className="tag">{c.category}{c.investors ? ` · Backed by ${c.investors}` : ""}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- App shell ---------------- */
const NAV = [
  { id: "overview", label: "Overview", ic: "▦" },
  { id: "companies", label: "Companies", ic: "▤" },
  { id: "landscape", label: "Landscape", ic: "◔" },
  { id: "compare", label: "Compare", ic: "⇄" },
  { id: "workflows", label: "Workflows", ic: "⋈" },
  { id: "battlecards", label: "Battlecards", ic: "▣" },
  { id: "accounts", label: "Accounts", ic: "◎" },
  { id: "signals", label: "Signals", ic: "↯" },
  { id: "insights", label: "Insights", ic: "✦" },
];

function App() {
  const [items, setItems] = useState([]);
  const [labels, setLabels] = useState({});
  const [capLabels, setCapLabels] = useState({});
  const [wfLabels, setWfLabels] = useState({});
  const [axes, setAxes] = useState({});
  const [vyasa, setVyasa] = useState({ id: "vyasa", name: "Vyasa" });
  const [aiEnabled, setAiEnabled] = useState(false);
  const [events, setEvents] = useState([]);
  const [view, setView] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [discover, setDiscover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const reload = async () => setItems(await api.get("/api/competitors"));
  const reloadEvents = async () => setEvents(await api.get("/api/events"));

  useEffect(() => {
    (async () => {
      const m = await api.get("/api/meta");
      setLabels(m.categoryLabels || {});
      setCapLabels(m.capabilityLabels || {});
      setWfLabels(m.workflowLabels || {});
      setAxes(m.positioningAxes || {});
      setVyasa(m.vyasa || { id: "vyasa", name: "Vyasa" });
      setAiEnabled(m.aiEnabled);
      await reload(); await reloadEvents();
    })();
  }, []);

  const save = async (payload, isEdit) => {
    if (isEdit) await api.put(`/api/competitors/${payload.id}`, payload);
    else await api.post("/api/competitors", payload);
    setEditing(undefined); setDetail(null);
    await reload();
  };
  const remove = async (comp) => {
    if (!confirm(`Delete ${comp.name}? This can't be undone.`)) return;
    await api.del(`/api/competitors/${comp.id}`);
    setDetail(null);
    await reload();
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/static/logo.svg" alt="Vyasa logo" />
          <div><div className="brand-name">Vyasa</div><div className="brand-sub">Reason · Orchestrate · Act</div></div>
          <button className="menu-toggle" aria-label="Toggle menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>{menuOpen ? "✕" : "☰"}</button>
        </div>
        <nav className={`nav ${menuOpen ? "open" : ""}`}>
          {NAV.map((n) => <button key={n.id} className={`nav-item ${view === n.id ? "active" : ""}`} onClick={() => { setView(n.id); setMenuOpen(false); }}><span className="ic">{n.ic}</span>{n.label}</button>)}
        </nav>
        <div className="sidebar-foot">
          {items.length} competitors tracked<br />
          <span className={`ai-dot ${aiEnabled ? "on" : "off"}`}></span>{aiEnabled ? "AI features on" : "AI features off"}
        </div>
      </aside>

      <main className="main">
        {view === "overview" && <Overview items={items} labels={labels} events={events} setView={setView} />}
        {view === "companies" && <Companies items={items} labels={labels} onOpen={setDetail} onAdd={() => setEditing(null)} onDiscover={() => setDiscover(true)} />}
        {view === "landscape" && <Landscape items={items} axes={axes} vyasa={vyasa} />}
        {view === "compare" && <Compare items={items} labels={labels} capLabels={capLabels} vyasa={vyasa} />}
        {view === "workflows" && <Workflows items={items} wfLabels={wfLabels} vyasa={vyasa} />}
        {view === "battlecards" && <Battlecards items={items} aiEnabled={aiEnabled} onUpdated={reload} />}
        {view === "accounts" && <Accounts aiEnabled={aiEnabled} />}
        {view === "signals" && <Signals events={events} items={items} onChange={reloadEvents} />}
        {view === "insights" && <Insights aiEnabled={aiEnabled} />}
      </main>

      {detail && <DetailModal comp={detail} labels={labels} capLabels={capLabels} onClose={() => setDetail(null)} onEdit={(c) => { setDetail(null); setEditing(c); }} onDelete={remove} />}
      {editing !== undefined && <EditModal comp={editing} labels={labels} onClose={() => setEditing(undefined)} onSave={save} />}
      {discover && <DiscoverModal aiEnabled={aiEnabled} onClose={() => setDiscover(false)} onImported={() => { reload(); }} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
