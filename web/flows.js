// Flowlet product surfaces: Home glance (metrics, My automations), Flows (automation cards, detail screen with
// Basic + Advanced, guided Create), Activity (filters + lifecycle timeline). Everything renders data emitted by
// app.js (vault + reactive reads, on-chain trace) or the recorded snapshot, which is always labelled. Nothing is simulated;
// Create only fills and submits the real vault forms, and only the vault owner (or local rehearsal) can activate.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const svg = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  home: svg('<path d="M4.5 11L12 4.5l7.5 6.5"/><path d="M6.5 9.5V19h11V9.5"/>'),
  leaf: svg('<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z"/><path d="M12 8v5M12 16h.01"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chev: svg('<path d="m9 18 6-6-6-6"/>'),
  ext: svg('<path d="M15 3h6v6"/> <path d="M10 14 21 3"/> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  pause: svg('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  play: svg('<path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.2 5.1A.8.8 0 0 0 8 5.8z"/>'),
  wave: svg('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'),
};
const KNOWN = { "0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d": "the landlord (demo address)", "0x5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e": "savings (demo address)" };
const who = (a) => KNOWN[String(a).toLowerCase()] || short(a);
const ago = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–");
const every = (s) => (s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let conf = null, rules = null, st = null, rows = [], recorded = null, wallet = { account: null, wrong: false, owner: false }, loadedAt = Date.now();
const canWrite = () => !!conf && (conf.isLocal || (wallet.account && wallet.owner && !wallet.wrong));

function sheet(title, html, cls = "") {
  $("sheet")?.remove();
  const d = document.createElement("dialog");
  d.id = "sheet"; d.className = `modal sheet ${cls}`; d.setAttribute("aria-labelledby", "sheetTitle");
  d.innerHTML = `<div class="grabber" aria-hidden="true"></div><div class="section-head"><h2 id="sheetTitle" class="h3">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${I.x}</button></div><div class="sheet-body">${html}</div>`;
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  d.addEventListener("close", () => { d.remove(); if (/[?&]id=/.test(location.hash)) history.replaceState(null, "", location.hash.split("?")[0]); });
  document.body.append(d); d.showModal(); return d;
}

// ------------------------------------------------------------------ automations model (from the vault's own state)
const loopsFor = (kind, ruleId) => (rows.length ? rows : []).filter((r) => r.kind === kind && (ruleId == null || (r.decisions || []).some((d) => d.ruleId == null || d.ruleId === String(ruleId))));
const executed = (r) => (r.decisions || []).some((d) => BigInt(d.executed || 0) > 0n);
function automations() {
  if (!rules) return null;
  const paused = rules.paused, revoked = rules.revoked;
  const stopped = revoked ? "Access revoked" : paused ? "Paused" : null;
  const list = rules.orders.map((o) => ({
    id: `order-${o.id}`, kind: 1, ruleId: o.id, icon: I.home, tone: "peach",
    name: String(o.payee).toLowerCase() === "0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d" ? `Rent payment · #${o.id}` : `Standing order #${o.id}`,
    status: !o.active ? "Finished" : stopped || "Active",
    trigger: `Schedule · every ${every(o.interval)}`, triggerType: "Time (Reactive CRON)",
    desc: `Pays ${o.amount} tUSD to ${who(o.payee)} every ${every(o.interval)}.`,
    action: `Transfer ${o.amount} tUSD to ${short(o.payee)}`,
    limits: `${o.runs}${o.max ? ` of ${o.max}` : ""} runs done · ${rules.guard.limit ? `daily limit ${rules.guard.limit} tUSD` : "no daily limit"}`,
    next: o.active && !stopped ? (o.nextDue > Date.now() / 1000 ? `next in ${Math.round(o.nextDue - Date.now() / 1000)} s` : "due now") : null,
    sub: "CRON clock", subOn: !!st?.cron, payee: o.payee,
  }));
  list.push({
    id: "save", kind: 2, icon: I.leaf, tone: "mint", name: "Auto-save",
    status: !rules.sweep.on ? "Off" : stopped || "Active",
    trigger: `Event · deposit of ${rules.sweep.min} tUSD or more`, triggerType: "Event (token Transfer into your wallet)",
    desc: rules.sweep.on ? `Saves ${rules.sweep.pct}% of each deposit to ${who(rules.sweep.savings)}.` : "Off. Turn it on to save part of every deposit automatically.",
    action: rules.sweep.on ? `Transfer ${rules.sweep.pct}% to ${short(rules.sweep.savings)}` : "None while off",
    limits: `never below the ${rules.guard.reserve} tUSD emergency reserve`, sub: "Deposit watch", subOn: !!st?.dep,
  });
  list.push({
    id: "guard", kind: 3, icon: I.shield, tone: "rose", name: "Safety Guard",
    status: revoked ? "Tripped" : paused ? "Paused" : "Watching",
    trigger: "Event · your allowance to the vault changes", triggerType: "Event (ERC-20 Approval from your wallet)",
    desc: "Pauses everything if you revoke access, and stops standing orders at the daily limit.",
    action: "Pause the vault and the reactive contract", limits: rules.guard.limit ? `${rules.guard.left} of ${rules.guard.limit} tUSD left today` : "no daily limit set",
    sub: "Mandate watch", subOn: true,
  });
  return list;
}
const pillCls = (s) => (s === "Active" || s === "Watching" ? "ok" : s === "Paused" ? "warn" : s === "Access revoked" || s === "Tripped" ? "bad" : "soft");
function lastRun(a) {
  const r = loopsFor(a.kind, a.ruleId).find((x) => x.callback) || null;
  if (!r) return { html: `<span class="muted">No run yet on this deployment</span>`, r: null };
  const ok = executed(r);
  const label = a.kind === 3 ? (r.decisions || []).map((d) => d.label).join(", ") || "Guard ran" : ok ? "Executed" : `Not executed · ${(r.decisions || []).map((d) => d.label).join(", ")}`;
  return { html: `<span class="ev ${a.kind === 3 ? "warn" : ok ? "ok" : "bad"}">${esc(label)}</span> <span class="muted">· ${esc(ago(r.callback.ts))}</span>`, r };
}

// ------------------------------------------------------------------ Home: greeting, colour cards + My automations preview
function paintGreet() {
  const hr = new Date().getHours(), d = $("gDay"), w = $("gWho"); if (!d || !w) return;
  d.textContent = hr < 5 ? "Evening" : hr < 12 ? "Morning" : hr < 18 ? "Afternoon" : "Evening";
  const a = wallet?.account; w.textContent = a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "there";
}
function paintHome() {
  const m = $("homeMetrics"), body = $("homeFlowsBody"); if (!m || !body) return;
  const list = automations();
  if (!list) {
    const slow = Date.now() - loadedAt > 20000;
    m.dataset.h = ""; m.innerHTML = ["Active flows", "Executions", "Allowance"].map((t, i) => `<div class="kcard ${["green hero-k", "violet", "sky"][i]} sk-card"><span class="kc-l">${t}</span><b class="kc-n sk">—</b></div>`).join("");
    paintGreet();
    body.innerHTML = slow ? `<div class="empty-box err" role="alert"><b>Couldn't read the vault yet</b><p class="small muted">The testnet RPC may be slow. Flowlet keeps retrying every few seconds.</p><button type="button" class="btn ghost small" id="hfReload">Reload</button></div>` : `<div class="skel-rows" aria-label="Loading"><i></i><i></i></div>`;
    $("hfReload")?.addEventListener("click", () => location.reload());
    return;
  }
  const active = list.filter((a) => a.kind !== 3 && a.status === "Active").length;
  const live = rows.filter((r) => r.callback && executed(r)).length;
  const rec = !rows.length && recorded ? recorded.rows.filter((r) => r.callback && (r.decisions || []).some((d) => BigInt(d.executed || 0) > 0n)).length : null;
  const kc = (tone, o, label, value, sub) => `<div class="kcard ${tone}" role="listitem"><span class="kc-l">${label}</span><b class="kc-n">${value}</b><span class="kc-s">${sub}</span><img class="kc-obj" src="3d/f-${o}.webp" alt="" aria-hidden="true" width="512" height="512" decoding="async"></div>`;
  const html = kc("green hero-k", "bubbles", "Active flows", active, rules.revoked ? "Access revoked · nothing can move" : rules.paused ? "All rules paused" : `of ${list.length - 1} automations`)
    + kc("violet", "bolt", "Executions", rec != null ? rec : live, rec != null ? "recorded loops" : "completed loops")
    + kc("sky", "loop", "Allowance", esc(rules.allowance), "tUSD the vault may move")
    + kc("mint", "nodes", "Chains", "2", "Sepolia + Reactive Lasna");
  if (m.dataset.h !== html) { m.innerHTML = html; m.dataset.h = html; }
  paintGreet();
  const shown = list.filter((a) => a.status !== "Finished").slice(0, 3);
  body.innerHTML = `<ul class="auto-mini">${shown.map((a) => `<li><a href="#/flows?id=${a.id}" class="am-row"><span class="tag ${a.tone}" aria-hidden="true">${a.icon}</span><span class="am-txt"><b>${esc(a.name)}</b><small>${esc(a.trigger)}</small></span><span class="pill ${pillCls(a.status)}">${esc(a.status)}</span><span class="am-go" aria-hidden="true">${I.chev}</span></a></li>`).join("")}</ul>`;
}

// ------------------------------------------------------------------ Flows: cards, detail screen, create
function paintFlows() {
  const box = $("flowsList"); if (!box) return;
  const list = automations();
  const head = `<div class="flows-head"><div><h2 class="h3">Automations</h2><p class="small muted">Each one runs only when the reactive contract calls your vault back.</p></div><button type="button" class="btn primary" id="createBtn">${I.plus}Create automation</button></div>`;
  if (!list) { box.innerHTML = head + `<div class="card"><div class="skel-rows" aria-label="Loading automations"><i></i><i></i><i></i></div></div>`; bindHead(); return; }
  box.innerHTML = head + `<div class="flow-cards">${list.map((a) => {
    const lr = lastRun(a);
    const pauseLbl = rules.paused ? (rules.revoked ? "Review access" : "Resume all") : "Pause all";
    return `<article class="card fcard ${a.status === "Active" || a.status === "Watching" ? "on" : ""}" aria-labelledby="fc-${a.id}">
      <div class="fc-top"><span class="tag ${a.tone}" aria-hidden="true">${a.icon}</span><div class="fc-t"><h3 id="fc-${a.id}">${esc(a.name)}</h3><small>${esc(a.trigger)}</small></div><span class="pill ${pillCls(a.status)}">${esc(a.status)}</span></div>
      <p class="fc-desc">${esc(a.desc)}</p>
      <dl class="fc-kv"><div><dt>Last run</dt><dd>${lr.html}</dd></div><div><dt>Limits</dt><dd>${esc(a.limits)}</dd></div></dl>
      <div class="fc-act"><a class="btn ghost small" href="#/flows?id=${a.id}">View</a>${a.kind !== 3 ? `<button type="button" class="btn ghost small" data-edit="${a.kind === 1 ? "fOrder" : "fSave"}">Edit</button>` : `<button type="button" class="btn ghost small" data-edit="fGuard">Edit limits</button>`}<button type="button" class="btn ghost small" data-pauseall>${pauseLbl}</button></div>
    </article>`;
  }).join("")}</div>
  <p class="small muted fc-note">The vault pauses all rules together; there is no per-rule pause on-chain yet. Cancel a single standing order under Manage rules.</p>`;
  bindHead();
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openEdit(b.dataset.edit)));
  box.querySelectorAll("[data-pauseall]").forEach((b) => (b.onclick = () => $("asPause")?.click()));
}
function bindHead() { const c = $("createBtn"); if (c) c.onclick = openCreate; }
function openEdit(formId) {
  const f = $(formId); if (!f) return;
  const d = f.closest("details"); if (d) d.open = true;
  f.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  f.querySelector("input")?.focus({ preventScroll: true });
}
function link(base, h, label) { return h ? (base ? `<a class="txl" href="${esc(base.tx + h)}" target="_blank" rel="noopener"><code>${esc(short(h))}</code>${I.ext}<span class="sr-only"> ${esc(label)} (opens the explorer in a new tab)</span></a>` : `<code>${esc(short(h))}</code>`) : `<span class="muted">pending</span>`; }
function addr(base, a) { return a ? (base ? `<a class="txl" href="${esc(base.addr + a)}" target="_blank" rel="noopener"><code>${esc(short(a))}</code>${I.ext}<span class="sr-only"> (opens the explorer in a new tab)</span></a>` : `<code>${esc(short(a))}</code>`) : "–"; }
function openDetail(id) {
  const a = (automations() || []).find((x) => x.id === id);
  if (!a) return sheet("Automation", `<p class="muted">This automation isn't loaded yet. Try again in a moment.</p>`);
  const lr = lastRun(a); const r = lr.r;
  const ex = conf?.explorers || {}, A = conf?.addrs || {}, loc = conf?.isLocal;
  const topics = { 1: "Reactive CRON ticks on Lasna, then the vault's OrderScheduled events", 2: "ERC-20 Transfer events into your wallet on Sepolia", 3: "ERC-20 Approval events from your wallet to the vault" };
  sheet(a.name, `
    <div class="det-head"><span class="tag ${a.tone} big" aria-hidden="true">${a.icon}</span><div><span class="pill ${pillCls(a.status)}">${esc(a.status)}</span><p class="small muted">${esc(a.desc)}</p></div></div>
    <dl class="kv det-kv">
      <dt>Trigger</dt><dd>${esc(a.trigger)}<br/><small class="muted">${esc(a.triggerType)}</small></dd>
      <dt>Action</dt><dd>${esc(a.action)}</dd>
      <dt>Active?</dt><dd>${esc(a.status)}${a.next ? ` · ${esc(a.next)}` : ""}</dd>
      <dt>Limits</dt><dd>${esc(a.limits)}</dd>
      <dt>Last run</dt><dd>${lr.html}</dd>
    </dl>
    ${r ? timelineHtml(r, ex) : ""}
    <details class="adv-d"><summary>Advanced</summary>
      <dl class="kv">
        <dt>Reactive contract</dt><dd>${addr(ex.lasna, A.reactive)} <small class="muted">${loc ? "Lasna (anvil)" : "Reactive Lasna · 5318007"}</small></dd>
        <dt>Event source</dt><dd>${esc(topics[a.kind])}</dd>
        <dt>Subscription</dt><dd>${esc(a.sub)} · ${a.subOn ? "on" : "off"}</dd>
        <dt>Callback</dt><dd>Reactive's callback proxy ${addr(ex.dest, A.callbackProxy)} calls the vault</dd>
        <dt>Vault</dt><dd>${addr(ex.dest, A.vault)} <small class="muted">${loc ? "Sepolia (anvil)" : `${esc(conf?.destName || "Sepolia")} · ${esc(conf?.destChainId ?? "")}`}</small></dd>
        <dt>Token</dt><dd>tUSD ${addr(ex.dest, A.token)}</dd>
        ${r ? `<dt>Last loop</dt><dd>#${esc(r.nonce)} · origin ${link(ex.dest, r.origin?.tx, "origin")} · reactive ${link(ex.lasna, r.reactive?.tx, "reactive")} · callback ${link(ex.dest, r.callback?.tx, "callback")}</dd>` : ""}
      </dl>
      ${r ? `<button type="button" class="btn ghost" data-proof="${esc(r.nonce)}">View full execution proof</button>` : ""}
    </details>
    <div class="row det-act">${a.kind !== 3 ? `<button type="button" class="btn ghost" id="detEdit">Edit</button>` : `<button type="button" class="btn ghost" id="detEdit">Edit limits</button>`}<button type="button" class="btn ghost" id="detPause">${rules.paused ? (rules.revoked ? "Review access" : "Resume all") : "Pause all"}</button></div>`, "screen");
  $("detEdit").onclick = () => { $("sheet").close(); openEdit(a.kind === 1 ? "fOrder" : a.kind === 2 ? "fSave" : "fGuard"); };
  $("detPause").onclick = () => { $("sheet").close(); $("asPause")?.click(); };
}

// ------------------------------------------------------------------ lifecycle timeline (only steps Flowlet really has)
function loopState(r) {
  if (!r.callback) return "triggered";
  if (r.kind === 3 || (r.decisions || []).some((d) => [4, 11, 12].includes(Number(d.reason)))) return "paused";
  return executed(r) ? "executed" : "failed";
}
function timelineHtml(r, ex, recordedAt) {
  const s = loopState(r);
  const step = (state, title, sub, tx, base) => `<li class="tl ${state}"><span class="tl-dot" aria-hidden="true">${state === "done" ? I.check : state === "fail" ? I.x : ""}</span><div><b>${title}</b> <span class="tl-st">${state === "done" ? "confirmed" : state === "fail" ? "not executed" : "pending"}</span><br/><small class="muted">${sub}</small>${tx ? `<br/>${link(base, tx, title)}` : ""}</div></li>`;
  const moved = (r.actions || []).map((a) => `${esc(a.amount)} tUSD to ${esc(who(a.to))}`).join(", ");
  const decision = (r.decisions || []).map((d) => d.label).join(", ");
  return `<h3 class="h4">Lifecycle${recordedAt ? ` <span class="pill soft">Recorded</span>` : ""}</h3><ol class="timeline-v">
    ${step(r.origin ? "done" : "pend", "Event detected", `${esc(r.origin?.label || "Waiting for the origin event")} · ${conf?.isLocal ? "Sepolia (anvil)" : "Sepolia"}${r.origin?.ts ? ` · ${esc(when(r.origin.ts))}` : ""}`, r.origin?.tx, ex.dest)}
    ${step(r.reactive ? "done" : "pend", "Trigger verified", `Reactive contract matched it and requested a callback · ${conf?.isLocal ? "Lasna (anvil)" : "Reactive Lasna"}`, r.reactive?.tx, ex.lasna)}
    ${step(r.callback ? "done" : "pend", "Callback sent", r.callback ? (r.callback.viaProxy && !r.callback.sentByWallet ? "Sent by Reactive's callback proxy, not by a wallet" : "Callback sender not verified as Reactive's proxy") : "Waiting for Reactive to deliver it", r.callback?.tx, ex.dest)}
    ${step(s === "executed" || s === "paused" ? "done" : s === "failed" ? "fail" : "pend", "Execution confirmed", s === "executed" ? esc(moved || decision) : s === "paused" ? `${esc(decision || "Safety Guard")}: the vault paused itself` : s === "failed" ? `Rule evaluated, nothing moved: ${esc(decision)}` : "After the callback lands", null)}
  </ol>${r.latency?.total != null ? `<p class="small muted">End to end: ${esc(r.latency.total)} s.</p>` : ""}`;
}

// ------------------------------------------------------------------ Activity: filters + rows
let filter = "all";
const FILTERS = [["all", "All"], ["watching", "Watching"], ["triggered", "Triggered"], ["executed", "Executed"], ["failed", "Failed"], ["paused", "Paused"]];
function paintActivity() {
  const box = $("actList"); if (!box) return;
  const src = rows.length ? rows : recorded?.rows || [];
  const rec = !rows.length && !!recorded;
  const subs = rules && st ? [
    ["CRON clock", !!st.cron && !rules.paused, "Ticks while a standing order is active"],
    ["Deposit watch", !!st.dep && !rules.paused, "Transfers into your wallet, for auto-save"],
    ["Mandate watch", !rules.revoked, "Approval changes, the circuit breaker's trigger"],
  ] : [];
  const watching = subs.filter((x) => x[1]);
  const count = (f) => (f === "all" ? src.length : f === "watching" ? watching.length : src.filter((r) => loopState(r) === f).length);
  const seg = `<div class="segf" role="group" aria-label="Show activity">${FILTERS.map(([f, t]) => `<button type="button" data-f="${f}" aria-pressed="${f === filter}">${t}<span class="seg-n" aria-hidden="true">${(rules || src.length) ? count(f) : ""}</span></button>`).join("")}</div>`;
  let body;
  if (!conf && !src.length) body = `<div class="skel-rows" aria-label="Loading activity"><i></i><i></i><i></i></div>`;
  else if (filter === "watching") body = subs.length ? `<ul class="act-rows">${subs.map(([n, on, d]) => `<li class="arow static"><span class="a-ic ${on ? "watch" : "off"}" aria-hidden="true">${I.eye}</span><span class="a-main"><b>${n}</b><small>${esc(d)}</small></span><span class="pill ${on ? "ok" : "soft"}">${on ? "Watching" : "Off"}</span></li>`).join("")}</ul>${rules?.paused ? `<p class="small muted">${rules.revoked ? "Access is revoked, so nothing is watched." : "Rules are paused, so nothing is watched until you resume."}</p>` : ""}` : `<div class="empty-box"><b>Reading the reactive contract…</b></div>`;
  else {
    const shown = src.filter((r) => filter === "all" || loopState(r) === filter);
    const E = { all: ["No automation has run yet", "Run the demo loop to watch a rule fire."], triggered: ["Nothing in flight", "Loops waiting for their callback show here."], executed: ["Nothing executed yet", "Rules that moved money show here."], failed: ["Nothing failed", "Rules that were evaluated but didn't move money show here, with the reason."], paused: ["Nothing paused", "Safety Guard trips and pauses show here."] };
    body = shown.length ? `${rec ? `<p class="rec-note small">No loops on this deployment yet. Showing the recorded snapshot from ${esc(new Date(recorded.recordedAt).toLocaleString())}; every link is a real testnet transaction.</p>` : ""}<ul class="act-rows">${shown.map((r) => {
      const s = loopState(r);
      const lab = { executed: "Executed", failed: "Not executed", paused: "Paused", triggered: "Triggered" }[s];
      const what = s === "executed" ? (r.actions || []).map((a) => `${a.amount} tUSD to ${who(a.to)}`).join(", ") || (r.decisions || []).map((d) => d.label).join(", ") : (r.decisions || []).map((d) => d.label).join(", ") || r.origin?.label || "Waiting for callback";
      const ts = r.callback?.ts || r.reactive?.ts || r.origin?.ts;
      return `<li><button type="button" class="arow" data-loop="${esc(r.nonce)}"${rec ? ' data-rec="1"' : ""}><span class="a-ic ${s}" aria-hidden="true">${s === "executed" ? I.check : s === "failed" ? I.x : s === "paused" ? I.pause : I.wave}</span><span class="a-main"><b>${esc(r.kindLabel)} · loop #${esc(r.nonce)}</b><small><span class="ev ${s}">${lab}</span> · ${esc(what)}</small></span><span class="a-side"><small class="muted">${ts ? esc(ago(ts)) : ""}</small>${I.chev}</span></button></li>`;
    }).join("")}</ul>` : `<div class="empty-box"><b>${E[filter][0]}</b><p class="small muted">${E[filter][1]}</p>${filter === "all" ? `<a class="btn ghost small" href="#/demo">Run demo loop</a>` : ""}</div>`;
  }
  box.innerHTML = `${seg}<div class="card act-card">${body}</div>`;
  box.querySelectorAll(".segf button").forEach((b) => (b.onclick = () => { filter = b.dataset.f; paintActivity(); box.querySelector(`.segf button[data-f="${filter}"]`)?.focus(); }));
  box.querySelectorAll("[data-loop]").forEach((b) => (b.onclick = () => {
    const fromRec = !!b.dataset.rec; const list = fromRec ? recorded.rows : rows;
    const r = list.find((x) => String(x.nonce) === b.dataset.loop); if (!r) return;
    sheet(`${r.kindLabel} · loop #${r.nonce}`, timelineHtml(r, fromRec ? recorded.explorers : conf?.explorers || {}, fromRec ? recorded.recordedAt : null) + `<button type="button" class="btn ghost" data-proof="${esc(r.nonce)}"${fromRec ? ' data-src="rec"' : ""}>View full execution proof</button>`, "screen");
  }));
}

// ------------------------------------------------------------------ Create automation: monitor → trigger → action → limits → review
function openCreate() {
  const w = { step: 0, type: null, interval: "60", min: "100", payee: "0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d", amount: "25", savings: "0x5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e", pct: "20", runs: "3" };
  const STEPS = ["What to watch", "Trigger", "Action", "Limits", "Review"];
  const d = sheet("Create automation", `<ol class="wz-steps" aria-label="Steps">${STEPS.map((t, i) => `<li data-i="${i}">${t}</li>`).join("")}</ol><div id="wzBody"></div><p class="ferr" id="wzErr" role="alert" hidden></p><div class="row wz-nav"><button type="button" class="btn ghost" id="wzBack">Back</button><button type="button" class="btn primary" id="wzNext">Next</button></div>`, "screen");
  const body = d.querySelector("#wzBody"), err = d.querySelector("#wzErr"), back = d.querySelector("#wzBack"), next = d.querySelector("#wzNext");
  const field = (name, label, hint, attrs = "") => `<label>${label}<input name="${name}" value="${esc(w[name])}" ${attrs} />${hint ? `<span class="hint small muted">${hint}</span>` : ""}</label>`;
  const opt = (type, icon, title, sub, soon) => `<label class="wz-opt ${soon ? "soon" : ""}"><input type="radio" name="type" value="${type}" ${w.type === type ? "checked" : ""} ${soon ? "disabled" : ""}/><span class="tag ${type === "order" ? "peach" : type === "save" ? "mint" : "soft"}" aria-hidden="true">${icon}</span><span><b>${title}</b><small>${sub}</small></span>${soon ? `<span class="pill soft">Coming soon</span>` : ""}</label>`;
  const paint = () => {
    err.hidden = true;
    d.querySelectorAll(".wz-steps li").forEach((li) => { const i = Number(li.dataset.i); li.className = i < w.step ? "done" : i === w.step ? "cur" : ""; if (i === w.step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
    back.hidden = w.step === 0; next.disabled = false;
    if (w.step === 0) body.innerHTML = `<p class="muted">What should Flowlet watch for you?</p><div class="wz-opts" role="radiogroup" aria-label="What to watch">
      ${opt("order", I.clock, "A schedule", "Run on a timer, like rent every month. Uses Reactive's CRON.")}
      ${opt("save", I.leaf, "Money arriving in your wallet", "React to a token deposit, like saving part of your salary.")}
      ${opt("price", I.wave, "A token price", "React to a price feed.", true)}
      ${opt("whale", I.eye, "Another wallet's transfers", "React to someone else's on-chain activity.", true)}</div>`;
    if (w.step === 1) body.innerHTML = w.type === "order" ? `<p class="muted">How often should it run?</p>${field("interval", "Every (seconds)", "Testnet demo: short intervals so you can watch it run. 2592000 ≈ 30 days.", 'inputmode="numeric"')}` : `<p class="muted">Which deposits count?</p>${field("min", "Deposits of at least (tUSD)", "Smaller deposits are ignored.", 'inputmode="decimal"')}`;
    if (w.step === 2) body.innerHTML = w.type === "order" ? `<p class="muted">What should happen each time?</p>${field("payee", "Pay to (address)", "The demo address is a placeholder landlord.", 'class="mono" maxlength="42" autocomplete="off" spellcheck="false"')}${field("amount", "Amount (tUSD)", "", 'inputmode="decimal"')}` : `<p class="muted">What should happen on each deposit?</p>${field("savings", "Savings address", "The demo address is a placeholder savings wallet.", 'class="mono" maxlength="42" autocomplete="off" spellcheck="false"')}${field("pct", "Save (%)", "", 'inputmode="decimal"')}`;
    if (w.step === 3) body.innerHTML = `${w.type === "order" ? field("runs", "Number of runs (0 = until you cancel)", "", 'inputmode="numeric"') : ""}
      <ul class="wz-limits"><li>${rules?.guard?.limit ? `Daily limit for standing orders: <b>${esc(rules.guard.limit)} tUSD</b>` : "No daily limit set for standing orders"}</li><li>Emergency reserve: auto-save never takes your wallet below <b>${esc(rules?.guard?.reserve ?? "0")} tUSD</b></li><li>The vault can only move up to your allowance: <b>${esc(rules?.allowance ?? "0")} tUSD</b>. Your tokens stay in your wallet.</li></ul>
      <p class="small"><button type="button" class="linkish" id="wzGuard">Change the Safety Guard limits</button></p>
      <details class="adv-d"><summary>Advanced</summary><p class="small muted">${w.type === "order" ? "Activating schedules the order in the vault. The reactive contract turns on its CRON subscription on Lasna and calls the vault back each time the order is due." : "Activating turns on auto-save in the vault. The reactive contract subscribes to tUSD Transfer events into your wallet and calls the vault back on each qualifying deposit."} Callbacks arrive through Reactive's callback proxy; only that proxy can run a rule.</p></details>`;
    if (w.step === 4) {
      body.innerHTML = `<dl class="kv"><dt>Watch</dt><dd>${w.type === "order" ? `A schedule: every ${esc(every(Number(w.interval) || 0))}` : `Deposits of ${esc(w.min)} tUSD or more`}</dd>
        <dt>Then</dt><dd>${w.type === "order" ? `Pay ${esc(w.amount)} tUSD to ${esc(who(w.payee))}` : `Save ${esc(w.pct)}% to ${esc(who(w.savings))}`}</dd>
        <dt>Limits</dt><dd>${w.type === "order" ? `${Number(w.runs) ? `${esc(w.runs)} runs` : "Until you cancel"} · ${rules?.guard?.limit ? `daily limit ${esc(rules.guard.limit)} tUSD` : "no daily limit"}` : `Never below the ${esc(rules?.guard?.reserve ?? "0")} tUSD reserve`}</dd>
        <dt>Network</dt><dd>${conf?.isLocal ? "Local rehearsal (anvil)" : `${esc(conf?.destName || "Sepolia")} · watched from Reactive Lasna`}</dd></dl>
        ${canWrite() ? `<p class="small muted">Your wallet asks you to sign one transaction. You can pause or cancel any time.</p>` : `<p class="note-box small">${!wallet.account && !conf?.isLocal ? "Connect the vault owner's wallet to activate." : "Only the vault owner can activate rules on this public demo vault."} You can still watch a real recorded loop.</p><a class="btn ghost" href="#/demo" data-close>Replay the recorded loop</a>`}`;
      next.textContent = "Activate"; next.disabled = !canWrite();
    } else next.textContent = "Next";
    body.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => { if (i.name !== "type") w[i.name] = i.value; }));
    body.querySelectorAll("input[name=type]").forEach((i) => i.addEventListener("change", () => { w.type = i.value; }));
    d.querySelector("#wzGuard")?.addEventListener("click", () => { d.close(); openEdit("fGuard"); });
    (body.querySelector("input:not([disabled])") || next).focus({ preventScroll: true });
  };
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  back.onclick = () => { w.step = Math.max(0, w.step - 1); paint(); };
  next.onclick = async () => {
    if (w.step === 0 && !w.type) return fail("Choose what to watch.");
    if (w.step === 1 && w.type === "order" && !(Number(w.interval) >= 1)) return fail("Every must be a whole number of seconds, 1 or more.");
    if (w.step === 1 && w.type === "save" && !(Number(w.min) >= 0)) return fail("Enter a minimum deposit of 0 or more.");
    if (w.step === 2 && !/^0x[0-9a-fA-F]{40}$/.test((w.type === "order" ? w.payee : w.savings).trim())) return fail("Enter a valid 0x address (42 characters).");
    if (w.step === 2 && w.type === "order" && !(Number(w.amount) > 0)) return fail("Amount must be more than 0.");
    if (w.step === 2 && w.type === "save" && !(Number(w.pct) > 0 && Number(w.pct) <= 100)) return fail("Save (%) must be between 0 and 100.");
    if (w.step < 4) { w.step++; return paint(); }
    // Activate: fill the real vault form and submit it; its own validation and wallet prompt run as usual.
    const form = $(w.type === "order" ? "fOrder" : "fSave");
    const vals = w.type === "order" ? { payee: w.payee, amount: w.amount, interval: w.interval, runs: w.runs } : { savings: w.savings, min: w.min, pct: w.pct };
    for (const [k, v] of Object.entries(vals)) form.elements[k].value = v;
    const out = form.querySelector(".ferr"); const sub = form.querySelector("button:not([type=button])");
    next.disabled = true; next.setAttribute("aria-busy", "true"); next.textContent = "Waiting for your wallet…";
    form.requestSubmit(sub);
    for (let i = 0; i < 600 && sub.getAttribute("aria-busy") === "true"; i++) await new Promise((r) => setTimeout(r, 200));
    next.removeAttribute("aria-busy");
    if (out && !out.hidden) { next.disabled = false; next.textContent = "Activate"; return fail(out.textContent); }
    body.innerHTML = `<div class="success-hero" role="status"><span class="sh-ic" aria-hidden="true">${I.check}</span><h3>Automation activated</h3><p class="muted">It's saved in the vault on-chain. The reactive contract is now watching; the first run shows up in Activity.</p></div>`;
    d.querySelector(".wz-steps").hidden = true; back.hidden = true; next.textContent = "Done"; next.disabled = false; next.onclick = () => { d.close(); location.hash = "#/flows"; };
  };
  paint();
}

// ------------------------------------------------------------------ wiring
function paintAll() { paintHome(); paintFlows(); paintActivity(); }
function route() { const m = location.hash.match(/^#\/flows\?(?:.*&)?id=([\w-]+)/); if (m && rules) openDetail(m[1]); }
window.addEventListener("flowlet:config", (e) => { conf = e.detail; if (!conf.isLocal) fetch("recorded-loops.json").then((r) => (r.ok ? r.json() : null)).then((j) => { recorded = j; paintAll(); }).catch(() => {}); paintAll(); });
window.addEventListener("flowlet:wallet", (e) => { wallet = e.detail; paintGreet(); });
let first = true;
window.addEventListener("flowlet:rules", (e) => { rules = e.detail; paintHome(); paintFlows(); if (first) { first = false; route(); } });
window.addEventListener("flowlet:state", (e) => { st = e.detail; });
let lastKey = "";
window.addEventListener("flowlet:trace", (e) => {
  rows = e.detail.rows || [];
  const key = rows.map((r) => `${r.nonce}:${r.callback ? 1 : 0}`).join(",");
  if (key !== lastKey) { lastKey = key; paintAll(); }
});
window.addEventListener("hashchange", route);
setInterval(() => { if (!document.querySelector("dialog[open]") && !document.querySelector("#flowsList :focus, #actList :focus")) paintAll(); }, 5000);
paintAll();
