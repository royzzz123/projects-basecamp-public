"use strict";
const API = "";
const DIMNAMES = { A: "Scale / Mass-Population", B: "Financial Magnitude", C: "Fraud & Severity", D: "Entity Importance", E: "Velocity", F: "Vulnerability", G: "Market Integrity", H: "Distress / Coordination", I: "Process Failure", J: "Cross-Portal", K: "Legal / Reputational" };
const TYPE_COLOR = { Entity: "#4da3ff", Typology: "#ff5da2", Cluster: "#2ee6a6", Product: "#ffd93d", Category: "#a98bff" };
const TIER_COLOR = { 3: "#ff4d5e", 2: "#ff9f43", 1: "#ffd93d", 0: "#7482a0" };
const state = { minTier: 2, search: "", tab: "clusters", cy: null, selectedId: null, queueItems: [] };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
async function api(p) { const r = await fetch(API + p); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }
const tc = (t) => `t${t}`;

async function init() {
  if (window.cytoscapeFcose) cytoscape.use(window.cytoscapeFcose);
  wireTopbar(); wireTabs(); wireGraphTools(); wireChat();
  await Promise.all([loadKpis(), loadQueue(), loadGraph(), loadTab()]);
  const params = new URLSearchParams(location.search);
  if (params.get("id")) selectComplaint(+params.get("id"));
  if (params.get("expand")) { $(".main3").classList.add("expanded"); setTimeout(() => { if (state.cy) { state.cy.resize(); state.cy.fit(null, 40); } }, 600); }
  const ask = params.get("ask");
  if (ask) { $("#chatfab").click(); $("#chatq").value = ask; sendChat(); }
}

/* ── top KPIs ─────────────────────────────────────────────── */
async function loadKpis() {
  let k; try { k = await api("/kg/kpis"); } catch (e) { return; }
  const bt = Object.fromEntries((k.tiers || []).map((t) => [t.tier, t.n]));
  const cards = [
    { l: "Critical", v: bt[3] || 0, c: "c3" }, { l: "Priority", v: bt[2] || 0, c: "c2" },
    { l: "Watch", v: bt[1] || 0, c: "c1" }, { l: "Scored", v: k.totals.scored, c: "" },
    { l: "Enriched", v: `${k.totals.enriched}/${k.totals.total}`, c: "" },
  ];
  $("#top-kpis").innerHTML = cards.map((c) => `<div class="mkpi ${c.c}"><div class="v">${esc(c.v)}</div><div class="l">${esc(c.l)}</div></div>`).join("");
}

/* ── queue cards ──────────────────────────────────────────── */
async function loadQueue() {
  const q = new URLSearchParams({ min_tier: state.minTier, limit: 120 });
  let d; try { d = await api("/kg/queue?" + q); } catch (e) { return; }
  state.queueItems = d.items;
  renderQueue(d.total);
}
function renderQueue(total) {
  const s = state.search.toLowerCase();
  const items = state.queueItems.filter((i) => !s ||
    (i.entity || "").toLowerCase().includes(s) || (i.typology || "").toLowerCase().includes(s) || String(i.id).includes(s));
  $("#queue-count").textContent = total != null ? `${items.length}/${total}` : items.length;
  $("#queue").innerHTML = items.map((i) => `
    <div class="card ${tc(i.tier)} ${i.id === state.selectedId ? "sel" : ""}" data-id="${i.id}">
      <div class="row1"><span class="scs" style="color:${TIER_COLOR[i.tier]}">${i.scs != null ? i.scs.toFixed(1) : "-"}</span>
        <span class="tier ${tc(i.tier)}">${esc(i.tier_name)}</span>
        <span class="ent" title="${esc(i.entity)}">${esc(i.entity || "—")}</span></div>
      <div class="typ">${esc(i.typology || "—")}</div>
      ${(i.hard_triggers || []).length ? `<div class="trg">${i.hard_triggers.slice(0, 3).map((t) => `<span class="tchip">${esc(t.split(":")[0])}</span>`).join("")}${i.hard_triggers.length > 3 ? `<span class="tchip">+${i.hard_triggers.length - 3}</span>` : ""}</div>` : ""}
    </div>`).join("") || `<div class="empty-tab">no cases at this tier</div>`;
  $("#queue").querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => selectComplaint(+c.dataset.id)));
}

/* ── graph ────────────────────────────────────────────────── */
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
async function loadGraph() {
  let g; try { g = await api("/kg/graph/overview?min_tier=" + state.minTier + "&limit=150"); } catch (e) { return; }
  const els = [];
  g.nodes.forEach((n) => els.push({ data: { id: n.id, label: n.type === "Complaint" ? "" : trunc(n.label, 18), full: n.label, type: n.type, tier: (n.props || {}).tier, scs: (n.props || {}).scs, deg: n.degree || 1, sz: (n.props || {}).size || 0 } }));
  g.edges.forEach((e, i) => els.push({ data: { id: "e" + i, source: e.source, target: e.target, type: e.type } }));
  if (state.cy) state.cy.destroy();
  state.cy = cytoscape({
    container: $("#cy"), elements: els, wheelSensitivity: 0.22,
    style: graphStyle(),
    layout: fcoseOpts(),
  });
  const cy = state.cy;
  cy.on("tap", "node", (ev) => { const n = ev.target; focusNode(n); if (n.data("type") === "Complaint") selectComplaint(+n.id().slice(2)); });
  cy.on("dbltap", "node", (ev) => expandNode(ev.target));
  cy.on("tap", (ev) => { if (ev.target === cy) { clearFocus(); } });
  $("#graph-hint").textContent = `${g.meta.complaints} escalated cases · ${g.meta.entities} entities · click to explore, double-click to expand`;
}
function graphStyle() {
  return [
    { selector: "node", style: {
      "background-color": (n) => n.data("type") === "Complaint" ? (TIER_COLOR[n.data("tier")] || "#7482a0") : (TYPE_COLOR[n.data("type")] || "#888"),
      width: (n) => nodeSize(n), height: (n) => nodeSize(n),
      "border-width": 1.4, "border-color": "#090b12", "border-opacity": 1,
      label: "data(label)", color: "#dbe1ee", "font-size": (n) => n.data("type") === "Complaint" ? 0 : 10, "font-weight": 600,
      "text-wrap": "wrap", "text-max-width": 120, "text-valign": "bottom", "text-margin-y": 3,
      "text-outline-color": "#080a10", "text-outline-width": 2.5, "min-zoomed-font-size": 7, "z-index": 2,
    } },
    { selector: 'node[type="Entity"]', style: { shape: "round-rectangle" } },
    { selector: 'node[type="Cluster"]', style: { shape: "diamond" } },
    { selector: 'node[type="Typology"]', style: { shape: "hexagon" } },
    { selector: "edge", style: {
      width: 0.9, "line-color": "#8a93a9", opacity: 0.4, "curve-style": "straight",
      "target-arrow-shape": "triangle", "target-arrow-color": "#8a93a9", "arrow-scale": 0.6, "z-index": 1 } },
    { selector: ".foc", style: { "border-width": 3, "border-color": "#35d0ba", "z-index": 30, color: "#fff", label: "data(full)", "font-size": 11 } },
    { selector: ".neigh", style: { "z-index": 20, color: "#f0f3fa" } },
    { selector: ".dim", style: { opacity: 0.1 } },
    { selector: ".edim", style: { opacity: 0.03 } },
    { selector: ".ehi", style: { "line-color": "#35d0ba", "target-arrow-color": "#35d0ba", opacity: 0.95, width: 1.8, "z-index": 25 } },
  ];
}
function nodeSize(n) {
  const t = n.data("type");
  if (t === "Complaint") return 9 + (n.data("scs") || 10) * 0.32;
  if (t === "Entity") return 18 + Math.min(30, (n.data("deg") || 1) * 3);
  if (t === "Cluster") return 20 + Math.min(30, (n.data("sz") || 3) * 0.5);
  if (t === "Typology") return 15 + Math.min(24, (n.data("deg") || 1) * 1.8);
  return 14;
}
function fcoseOpts() {
  return { name: window.cytoscapeFcose ? "fcose" : "cose", quality: "proof", animate: false, randomize: true,
    nodeSeparation: 130, idealEdgeLength: 95, nodeRepulsion: 11000, gravity: 0.1, gravityRange: 3.2,
    packComponents: true, numIter: 3500, tile: true, padding: 40 };
}
function focusNode(n) {
  const cy = state.cy; if (!cy) return;
  const hood = n.closedNeighborhood();
  cy.elements().addClass("dim"); cy.edges().addClass("edim");
  hood.removeClass("dim edim"); hood.nodes().addClass("neigh");
  hood.connectedEdges().removeClass("edim").addClass("ehi");
  cy.$(".foc").removeClass("foc"); n.addClass("foc");
}
function clearFocus() { const cy = state.cy; if (!cy) return; cy.elements().removeClass("dim edim neigh ehi foc"); }
function highlightComplaintInGraph(id) {
  const cy = state.cy; if (!cy) return; const n = cy.$id("c:" + id);
  if (n.nonempty()) { focusNode(n); cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 300 }); }
}
async function expandNode(n) {
  const cy = state.cy; if (!cy) return;
  if (n.data("type") !== "Complaint") { focusNode(n); return; }
  let g; try { g = await api("/kg/graph/complaint/" + n.id().slice(2)); } catch (e) { return; }
  const add = [];
  g.nodes.forEach((nd) => { if (cy.$id(nd.id).empty()) add.push({ data: { id: nd.id, label: nd.type === "Complaint" ? "" : nd.label, full: nd.label, type: nd.type, tier: (nd.props || {}).tier, scs: (nd.props || {}).scs, deg: 1 } }); });
  g.edges.forEach((e, i) => { const eid = "x" + n.id() + i; if (cy.$id(eid).empty()) add.push({ data: { id: eid, source: e.source, target: e.target, type: e.type } }); });
  if (add.length) { cy.add(add); cy.layout(fcoseOpts()).run(); }
  focusNode(n);
}

/* ── analytics tabs ───────────────────────────────────────── */
async function loadTab() {
  const body = $("#tab-body");
  if (state.tab === "clusters") {
    let d; try { d = await api("/kg/clusters?limit=24"); } catch (e) { return; }
    body.innerHTML = `<div class="section-lbl">Root-cause clusters · consolidated case-files</div>` + (d.clusters.map((c, i) => `
      <div class="clist-item" data-cluster="${esc(c.id)}">
        <div class="top"><span class="rank">${i + 1}</span><span class="name">${esc(c.entity || "—")}</span><span class="share">${c.size} · ${c.share}%</span></div>
        <div class="meter"><i style="width:${Math.min(100, c.share * 3)}%"></i></div>
        <div class="sub"><span class="badge2 ${c.tier === 3 ? "t3" : ""}">${c.tier === 3 ? "Critical" : "Tier " + c.tier}</span>
          <span class="badge2">${c.states} states</span>${c.templated >= 0.7 ? `<span class="badge2">templated ${Math.round(c.templated * 100)}%</span>` : ""}</div>
      </div>`).join("") || `<div class="empty-tab">no clusters yet</div>`);
  } else if (state.tab === "dimensions") {
    let d; try { d = await api("/kg/drivers"); } catch (e) { return; }
    const maxT = Math.max(1, ...d.triggers_by_dimension.map((x) => x.n));
    const maxF = Math.max(1, ...Object.values(d.signal_prevalence));
    body.innerHTML = `<div class="section-lbl">Hard-trigger drivers (by dimension)</div>` +
      d.triggers_by_dimension.map((x) => dimBar(DIMNAMES[x.dim] || x.dim, x.n, maxT)).join("") +
      `<div class="section-lbl" style="margin-top:16px">Signal prevalence (of ${d.enriched} enriched)</div>` +
      Object.entries(d.signal_prevalence).map(([k, v]) => dimBar(k.replace(/_/g, " "), v, maxF)).join("");
  } else {
    let k; try { k = await api("/kg/kpis"); } catch (e) { return; }
    const mx = Math.max(1, ...(k.top_entities || []).map((e) => e.escalations));
    body.innerHTML = `<div class="section-lbl">Top REs by escalations</div>` + (k.top_entities || []).map((e) => `
      <div class="clist-item" data-entity="${esc(e.entity_id)}">
        <div class="top"><span class="name">${esc(e.entity)}</span><span class="share">${e.escalations}</span></div>
        <div class="meter"><i style="width:${(e.escalations / mx) * 100}%"></i></div>
        <div class="sub"><span class="badge2 ${e.critical ? "t3" : ""}">${e.critical} critical</span></div>
      </div>`).join("");
  }
  body.querySelectorAll("[data-entity]").forEach((el) => el.addEventListener("click", () => { $("#search").value = el.dataset.entity; state.search = el.dataset.entity; renderQueue(); }));
}
function dimBar(name, v, max) {
  return `<div class="dimrow"><span class="nm" title="${esc(name)}">${esc(name)}</span><span class="bar"><i style="width:${(v / max) * 100}%"></i></span><span class="v">${v}</span></div>`;
}

/* ── detail slide-over ────────────────────────────────────── */
async function selectComplaint(id) {
  state.selectedId = id;
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("sel", +c.dataset.id === id));
  highlightComplaintInGraph(id);
  let d; try { d = await api("/kg/complaint/" + id); } catch (e) { return; }
  const s = d.scoring, sig = d.signals;
  const dims = Object.entries(s.subscores || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="dimrow"><span class="nm">${esc(k)} · ${esc((DIMNAMES[k] || k).slice(0, 20))}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span><span class="v">${v.toFixed(0)}</span></div>`).join("");
  const trigs = (s.hard_triggers || []).map((t) => `<li>⚑ ${esc(t)}</li>`).join("") || `<li style="color:var(--faint)">none — composite-scored</li>`;
  const flags = [["misappropriation", sig.is_misappropriation], ["liquidity block", sig.liquidity_block], ["market integrity", sig.market_integrity_risk], ["class harm", sig.class_harm_assertion], ["vulnerable", sig.vulnerable], ["criminal language", sig.criminal_language], ["distress", sig.distress], ["senior-mgmt", sig.senior_mgmt_allegation]];
  const chips = flags.map(([l, on]) => `<span class="chip ${on ? "on" : ""}">${on ? "●" : "○"} ${esc(l)}</span>`).join("");
  const amt = sig.amount_inr != null ? `₹${Number(sig.amount_inr).toLocaleString("en-IN")}` : "—";
  const D = $("#detail");
  D.innerHTML = `
    <div class="dhead"><button class="close" id="dclose">✕</button>
      <h2>#${d.complaintid} · ${esc(d.entity || "unknown RE")}</h2>
      <div class="sub">${esc(sig.severity)} · ${esc(sig.typology || "—")} · ${amt} · ${esc(d.state_code || "")}</div>
      <div class="scspill"><span class="n" style="color:${TIER_COLOR[s.tier]}">${s.scs != null ? s.scs.toFixed(1) : "-"}</span><span class="tier ${tc(s.tier)}">${esc(s.tier_name)}</span></div>
      ${s.f_multiplier ? `<div class="fmult">F vulnerability multiplier +${(s.f_multiplier * 100).toFixed(0)}%</div>` : ""}
    </div>
    <div class="dsec"><h3>◆ AI summary</h3><div id="ai-summary" class="aisum">…</div></div>
    <div class="dsec"><h3>Hard triggers</h3><ul class="trigs">${trigs}</ul></div>
    <div class="dsec"><h3>Dimension breakdown</h3>${dims}</div>
    <div class="dsec"><h3>Signals</h3><div class="chips">${chips}</div></div>
    <div class="dsec"><h3>Evidence</h3><blockquote>${esc(sig.evidence_quote || d.details || "—")}</blockquote>${sig.reasoning ? `<div class="reason">${esc(sig.reasoning)}</div>` : ""}</div>`;
  D.classList.add("open");
  $("#dclose").addEventListener("click", () => D.classList.remove("open"));

  const sumEl = $("#ai-summary");
  if (d.ai_summary) { sumEl.innerHTML = mdRender(d.ai_summary); }
  else {
    sumEl.innerHTML = '<span class="muted">generating…</span>';
    fetch("/kg/complaint/" + id + "/summary").then((r) => r.json()).then((x) => {
      if (state.selectedId === id) { const el = $("#ai-summary"); if (el) el.innerHTML = x.summary ? mdRender(x.summary) : '<span class="muted">unavailable</span>'; }
    }).catch(() => {});
  }
}

/* ── wiring ───────────────────────────────────────────────── */
function wireTopbar() {
  $("#tier-filter").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    $("#tier-filter").querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active");
    state.minTier = +b.dataset.tier; loadQueue(); loadGraph();
  }));
  let t; $("#search").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.search = e.target.value.trim(); renderQueue(); searchGraph(); }, 250); });
}
function searchGraph() {
  const cy = state.cy; if (!cy) return; const s = state.search.toLowerCase();
  if (!s) { clearFocus(); return; }
  cy.elements().addClass("dim"); cy.edges().addClass("edim");
  const hit = cy.nodes().filter((n) => (n.data("full") || "").toLowerCase().includes(s));
  hit.removeClass("dim"); hit.neighborhood().removeClass("dim edim");
}
function wireTabs() {
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    $("#tabs").querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active");
    state.tab = b.dataset.tab; loadTab();
  }));
}
function wireGraphTools() {
  $("#zin").onclick = () => state.cy && state.cy.zoom(state.cy.zoom() * 1.3);
  $("#zout").onclick = () => state.cy && state.cy.zoom(state.cy.zoom() / 1.3);
  $("#zfit").onclick = () => state.cy && state.cy.fit(null, 40);
  $("#relayout").onclick = () => state.cy && state.cy.layout(fcoseOpts()).run();
  const resizeFit = () => setTimeout(() => { if (state.cy) { state.cy.resize(); state.cy.fit(null, 40); } }, 260);
  $("#expand").onclick = () => { $(".main3").classList.toggle("expanded"); resizeFit(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $(".main3").classList.remove("expanded"); $("#detail").classList.remove("open"); resizeFit(); } });
}

/* ── chatbot (GraphRAG) ───────────────────────────────────── */
const SUGGEST = ["Top 5 entities by critical complaints", "How many complaints allege misappropriation?", "Biggest root-cause clusters", "Ponzi complaints and their entities"];
function wireChat() {
  const panel = $("#chatpanel"), msgs = $("#chatmsgs"), q = $("#chatq");
  $("#chatsuggest").innerHTML = SUGGEST.map((s) => `<button>${esc(s)}</button>`).join("");
  $("#chatsuggest").querySelectorAll("button").forEach((b) => b.onclick = () => { q.value = b.textContent; sendChat(); });
  $("#chatfab").onclick = () => { panel.classList.add("open"); q.focus(); if (!msgs.dataset.init) { addMsg("bot", "Ask me about complaints, entities, typologies, clusters or scores — I write a **read-only** Cypher query and answer from the graph."); msgs.dataset.init = "1"; } };
  $("#chatclose").onclick = () => panel.classList.remove("open");
  $("#chatsend").onclick = sendChat;
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
}
async function sendChat() {
  const q = $("#chatq"), text = q.value.trim(); if (!text) return; q.value = "";
  addMsg("user", text);
  const t = document.createElement("div"); t.className = "msg bot typing";
  t.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="tlabel">writing Cypher…</span>';
  msgsEl().appendChild(t); scrollChat();
  const _phases = ["writing Cypher…", "querying the graph…", "reading results…", "summarising…"];
  let _pi = 0; const _lbl = t.querySelector(".tlabel");
  const _iv = setInterval(() => { _pi = (_pi + 1) % _phases.length; if (_lbl) _lbl.textContent = _phases[_pi]; }, 2500);
  try {
    const r = await fetch("/kg/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
    const d = await r.json(); clearInterval(_iv); t.remove();
    const el = document.createElement("div"); el.className = "msg bot";
    el.innerHTML = mdRender(d.answer || "(no answer)") + (d.cypher ? `<div class="cy" title="click to copy">${esc(d.cypher)}</div>` : "") + `<div class="meta">${d.row_count || 0} row(s)${d.error ? " · " + esc(d.error) : ""}</div>`;
    msgsEl().appendChild(el); scrollChat();
    const cy = el.querySelector(".cy"); if (cy) cy.addEventListener("click", () => navigator.clipboard && navigator.clipboard.writeText(cy.textContent));
  } catch (e) { clearInterval(_iv); t.remove(); addMsg("bot", "Error contacting the graph."); }
}
const msgsEl = () => $("#chatmsgs");
const scrollChat = () => { const m = msgsEl(); m.scrollTop = m.scrollHeight; };
function addMsg(cls, text) { const el = document.createElement("div"); el.className = "msg " + cls; el.innerHTML = mdRender(text); msgsEl().appendChild(el); scrollChat(); return el; }
function mdInline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
}
function splitRow(l) { let s = l.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|")) s = s.slice(0, -1); return s.split("|").map((x) => x.trim()); }
function mdRender(text) {
  const lines = String(text == null ? "" : text).replace(/\r/g, "").split("\n");
  const isSep = (l) => { const t = l.trim(); return t.includes("-") && /^[|:\-\s]+$/.test(t); };
  let html = "", i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(splitRow(lines[i])); i++; }
      html += "<table class='ctab'><tr>" + head.map((h) => `<th>${mdInline(h)}</th>`).join("") + "</tr>"
        + rows.map((r) => "<tr>" + r.map((c) => `<td>${mdInline(c)}</td>`).join("") + "</tr>").join("") + "</table>";
      continue;
    }
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { html += `<div class="cmh cmh${h[1].length}">${mdInline(h[2])}</div>`; i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      html += "<ul class='cul'>" + items.map((x) => `<li>${mdInline(x)}</li>`).join("") + "</ul>"; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      html += "<ol class='cul'>" + items.map((x) => `<li>${mdInline(x)}</li>`).join("") + "</ol>"; continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*#{1,4}\s/.test(lines[i]) && !lines[i].trim().startsWith("|")) { para.push(lines[i]); i++; }
    html += `<p>${para.map(mdInline).join("<br>")}</p>`;
  }
  return html;
}

init();
