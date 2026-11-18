// Flowlet control center: mode badge, "What rule is running?", "Last automation", execution proof, welcome, network sheet.
// Everything here renders data emitted by app.js (vault + reactive contract reads, on-chain trace) or the recorded
// snapshot web/recorded-loops.json, which is always labelled as recorded. Nothing is simulated.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const svg = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const EXT = svg('<path d="M15 3h6v6"/> <path d="M10 14 21 3"/> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const HELP = svg('<circle cx="12" cy="12" r="10"/> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/> <path d="M12 17h.01"/>');
const KNOWN = { "0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d": "Landlord (demo address)", "0x5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e": "Savings (demo address)" };
const who = (a) => KNOWN[String(a).toLowerCase()] || short(a);
const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–");
const ago = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
const tusd = (units) => (Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

let conf = null, st = null, rules = null, rows = [], wallet = { account: null, wrong: false, owner: false }, replay = false, recorded = null;

// Plain-English helper text for the terms people trip over.
const GLOSSARY = {
  Loop: "One complete automatic run: an event on Sepolia, the reactive contract's transaction on Lasna, and the callback that executes your rule back on Sepolia. Each loop has a number.",
  "Reactive Lasna": "Reactive Network's testnet. Flowlet's reactive contract lives there: it watches Sepolia for your events and sends the callback that runs your rule. No server or bot of ours is involved.",
  "Vault rules": "Your standing orders and auto-save, stored in the Flowlet vault contract on Sepolia. Only your wallet can change them; the vault can only move what your allowance permits.",
  "Safety Guard": "Built-in limits: a daily cap for standing orders that pauses automation instead of overspending, and an emergency reserve auto-save never goes below.",
  Allowance: "How many tUSD the vault may pull from your wallet, set by you with a standard token approval. Your tokens stay in your wallet. Setting it to 0 stops everything.",
};
const term = (t, label = t) => `<button type="button" class="term" data-term="${esc(t)}" aria-label="${esc(label)}: what does this mean?">${esc(label)}${HELP}</button>`;
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-term]"); if (b) return sheet(b.dataset.term, `<p>${esc(GLOSSARY[b.dataset.term] || "")}</p>`);
  const p = e.target.closest?.("[data-proof]"); if (p) return proofSheet(Number(p.dataset.proof), p.dataset.src === "rec");
});
function sheet(title, html) {
  $("sheet")?.remove();
  const d = document.createElement("dialog");
  d.id = "sheet"; d.className = "modal sheet"; d.setAttribute("aria-labelledby", "sheetTitle");
  d.innerHTML = `<div class="grabber" aria-hidden="true"></div><div class="section-head"><h2 id="sheetTitle" class="h3">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${svg('<path d="M18 6 6 18"/> <path d="m6 6 12 12"/>')}</button></div>${html}`;
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d); d.showModal(); return d;
}

// ------------------------------------------------------------------ mode badge (the capitalised keyword is a status label, not an eyebrow)
function paintMode() {
  const el = $("mode"); if (!el || !conf) return;
  let kind, key, rest;
  if (replay) [kind, key, rest] = ["demo", "DEMO MODE", "replay of recorded testnet transactions · nothing is sent"];
  else if (conf.isLocal) [kind, key, rest] = ["local", "LOCAL REHEARSAL", "private test chains on this computer · not real data"];
  else if (!wallet.account) [kind, key, rest] = ["live", "LIVE TESTNET", "read-only view of the public demo vault · no wallet"];
  else if (wallet.wrong) [kind, key, rest] = ["warn", "LIVE TESTNET", "wallet connected · wrong network, switch to Sepolia"];
  else if (!wallet.owner) [kind, key, rest] = ["live", "LIVE TESTNET", "wallet connected · network verified · read-only (not this vault's owner)"];
  else [kind, key, rest] = ["live", "LIVE TESTNET", "wallet connected · network verified"];
  el.className = `mode ${kind}`;
  el.innerHTML = `<span class="mode-dot" aria-hidden="true"></span><b>${key}</b><span class="mode-rest">${esc(rest)}</span>`;
  el.setAttribute("aria-label", `${key}: ${rest}`);
  // Only the vault owner (or the local rehearsal) can run the loop live; everyone else gets the recorded replay.
  const canLive = conf.isLocal || (wallet.account && wallet.owner && !wallet.wrong);
  const rb = $("replayBtn"), run = $("runDemo");
  if (rb) rb.hidden = !canLive;
  if (run && !run.disabled && !run.classList.contains("done")) { const svg = run.querySelector("svg")?.outerHTML || ""; run.innerHTML = svg + (canLive ? "Run demo loop" : "Replay recorded loop"); }
}

// ------------------------------------------------------------------ What rule is running?
function paintRule() {
  const box = $("ruleWTGN"); if (!box || !rules) return;
  const o = rules.orders.filter((x) => x.active);
  const net = conf?.isLocal ? "Local rehearsal: Sepolia (anvil) + Lasna (anvil)" : `${esc(conf?.destName || "Ethereum Sepolia")} · watched from Reactive Lasna`;
  const whenTxt = [o.length ? o.map((x) => `every ${x.interval} s (order #${x.id}, next ${x.nextDue > Date.now() / 1000 ? `in ${Math.round(x.nextDue - Date.now() / 1000)} s` : "due now"})`).join("; ") : null, rules.sweep.on ? `a deposit of ${esc(rules.sweep.min)} tUSD or more arrives` : null].filter(Boolean).join(" · or when ");
  const thenTxt = [o.map((x) => `pay ${esc(x.amount)} tUSD to ${esc(who(x.payee))} (${x.runs}${x.max ? `/${x.max}` : ""} runs)`).join("; "), rules.sweep.on ? `save ${rules.sweep.pct}% to ${esc(who(rules.sweep.savings))}` : null].filter(Boolean).join(" · ");
  const guardTxt = `${rules.guard.limit ? `${esc(rules.guard.left)} of ${esc(rules.guard.limit)} tUSD left today` : "no daily limit"} · reserve ${esc(rules.guard.reserve)} tUSD · allowance ${esc(rules.allowance)} tUSD`;
  const none = !o.length && !rules.sweep.on;
  box.innerHTML = `
    <div><dt>When</dt><dd>${none ? "No rule is set. Run the demo loop to create a rent order and auto-save." : rules.paused ? `On hold: nothing is watched while ${rules.revoked ? "access is revoked" : "the vault is paused"}. Rule when running: ${whenTxt}` : whenTxt}</dd></div>
    <div><dt>Then</dt><dd>${none ? "–" : thenTxt}</dd></div>
    <div><dt>${term("Safety Guard", "Guard")}</dt><dd>${guardTxt}</dd></div>
    <div><dt>Network</dt><dd>${net}</dd></div>`;
  const s = $("rcState");
  const mode = rules.revoked ? ["bad", "Access revoked"] : rules.paused ? ["warn", "Paused"] : none ? ["soft", "No rules"] : ["ok", "Active"];
  s.className = `pill ${mode[0]}`; s.textContent = mode[1];
}

// ------------------------------------------------------------------ Last automation + execution proof
const delta = (c) => { const v = BigInt(c.delta); return `${v < 0n ? "−" : "+"}${tusd(v < 0n ? -v : v)} tUSD`; };
function proofHtml(r, ex, recordedAt) {
  const link = (base, h, label, chain) => `<li class="pl"><span class="pl-n">${label}</span><span class="pl-c">${chain}</span>${h ? (base ? `<a class="txl" href="${esc(base.tx + h)}" target="_blank" rel="noopener"><code>${esc(short(h))}</code>${EXT}<span class="sr-only"> (opens the explorer in a new tab)</span></a>` : `<code>${esc(short(h))}</code>`) : `<span class="muted">pending</span>`}</li>`;
  const loc = conf?.isLocal;
  const ch = (r.change || []).map((c) => `<tr><th scope="row">${esc(c.what)}</th><td>${c.delta != null ? "–" : c.time ? esc(when(c.before)) : esc(c.before)}</td><td>${c.delta != null ? esc(delta(c)) : c.time ? esc(when(c.after)) : esc(c.after)}</td></tr>`).join("");
  return `
    ${recordedAt ? `<p class="rec-note small">Recorded snapshot from ${esc(new Date(recordedAt).toLocaleString())}. Every link is a real transaction.</p>` : ""}
    <p class="small muted">Loop #${esc(r.nonce)} · ${esc(r.kindLabel)} · ${esc((r.decisions || []).map((x) => x.label).join(", "))}</p>
    <ol class="proof-legs">
      ${link(ex.dest, r.origin?.tx, `1 · Origin${r.origin?.isDueTime ? " (set the due time)" : ""}`, loc ? "Sepolia (anvil)" : "Sepolia")}
      ${link(ex.lasna, r.reactive?.tx, "2 · Reactive transaction", loc ? "Lasna (anvil)" : "Reactive Lasna")}
      ${link(ex.dest, r.callback?.tx, "3 · Callback that ran the rule", loc ? "Sepolia (anvil)" : "Sepolia")}
    </ol>
    ${(r.decisions || []).map((x) => `<p class="explain">${esc(x.text)}</p>`).join("")}
    <h3 class="h4">Contract state, before → after</h3>
    ${ch ? `<div class="ba-wrap"><table class="ba"><thead><tr><th scope="col">What</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${ch}</tbody></table></div>` : `<p class="small muted">No state change was recorded for this loop.</p>`}
    <p class="small muted">Read from the callback transaction's own logs (OrderExecuted, GuardTripped and token transfers), so it needs no archive node.</p>
    <p class="small">${r.callback?.viaProxy && !r.callback?.sentByWallet ? "Sent by Reactive's callback proxy, not by your wallet or this page." : r.callback ? "Callback sender not verified as Reactive's proxy." : ""}${r.latency?.total != null ? ` End to end: ${esc(r.latency.total)} s.` : ""}</p>`;
}
function proofSheet(nonce, fromRecorded) {
  const src = fromRecorded || !rows.length ? recorded?.rows : rows;
  const r = (src || []).find((x) => x.nonce === nonce);
  if (!r) return sheet("Execution proof", `<p class="muted">Loop #${esc(nonce)} isn't loaded yet.</p>`);
  const ex = fromRecorded || !rows.length ? recorded.explorers : conf?.explorers || {};
  sheet(`Execution proof · loop #${nonce}`, proofHtml(r, ex, fromRecorded || !rows.length ? recorded?.recordedAt : null));
}
function paintLast() {
  const body = $("lastBody"); if (!body) return;
  const live = rows.find((r) => !r.pending && r.callback);
  const r = live || recorded?.rows?.find((x) => x.callback);
  if (!r) { body.innerHTML = `<p class="muted small">No automation has run on this deployment yet. Run the demo loop.</p>`; $("lcWhen").textContent = ""; return; }
  const rec = !live;
  const moved = (r.actions || []).map((a) => `${esc(a.amount)} tUSD to ${esc(who(a.to))}`).join(", ");
  const ok = (r.decisions || []).some((x) => BigInt(x.executed || 0) > 0n) || r.kind === 3;
  $("lcWhen").textContent = r.callback?.ts ? `${ago(r.callback.ts)}${rec ? " · recorded" : ""}` : "";
  body.innerHTML = `
    <p class="lc-res"><span class="pill ${r.kind === 3 ? "warn" : ok ? "ok" : "soft"}">${esc((r.decisions || []).map((x) => x.label).join(", ") || "Evaluated")}</span> <b>${esc(r.kindLabel)}</b></p>
    <p class="small">${moved || (r.kind === 3 ? "Vault paused by the reactive contract" : "Nothing moved")}</p>
    <p class="small muted">Loop #${esc(r.nonce)} · ${esc(when(r.callback?.ts))}${r.latency?.total != null ? ` · ${esc(r.latency.total)} s end to end` : ""}</p>
    <button type="button" class="btn ghost" data-proof="${esc(r.nonce)}"${rec ? ' data-src="rec"' : ""}>View execution proof</button>`;
}

// ------------------------------------------------------------------ welcome (first visit) + network sheet
const WELCOMED = "flowlet.welcomed";
function initWelcome() {
  if (!location.hash && !localStorage.getItem(WELCOMED)) location.replace("#/welcome");
  const done = () => localStorage.setItem(WELCOMED, "1");
  $("wSkip")?.addEventListener("click", done);
  $("wConnect")?.addEventListener("click", () => { done(); location.hash = "#/home"; setTimeout(() => $("connectBtn")?.click(), 50); });
  $("wDemo")?.addEventListener("click", () => { done(); location.hash = "#/home"; setTimeout(() => { $("demoBox")?.scrollIntoView({ block: "start" }); window.dispatchEvent(new CustomEvent("flowlet:runreplay")); }, 120); });
}
function netSheet() {
  if (!conf) return;
  const loc = conf.isLocal;
  sheet(loc ? "Local rehearsal networks" : "Networks", `
    <dl class="kv">
      <dt>Rules and money</dt><dd>${loc ? "Sepolia (anvil) · on this computer" : `${esc(conf.destName)} · chain ID <code>${esc(conf.destChainId)}</code>`}</dd>
      <dt>Reactive contract</dt><dd>${loc ? "Lasna (anvil) · on this computer" : "Reactive Lasna testnet · chain ID <code>5318007</code>"}</dd>
      <dt>Your wallet</dt><dd>${loc ? "Local demo keys" : !wallet.account ? "Not connected" : wallet.wrong ? "On another network" : "On Sepolia"}</dd>
    </dl>
    <p class="small muted">${loc ? "Two private chains that run only on this computer, for rehearsing. Nothing here is real data or real money." : "Both are public test networks. tUSD is a free test token with no value; lREACT pays Reactive's gas on Lasna."}</p>
    <p class="small">${term("Reactive Lasna", "What is Reactive Lasna?")} ${term("Loop", "What is a loop?")}</p>`);
}

window.addEventListener("flowlet:config", (e) => { conf = e.detail; paintMode(); if (!conf.isLocal) fetch("recorded-loops.json").then((r) => (r.ok ? r.json() : null)).then((j) => { recorded = j; paintLast(); }).catch(() => {}); });
window.addEventListener("flowlet:wallet", (e) => { wallet = e.detail; paintMode(); });
window.addEventListener("flowlet:rules", (e) => { rules = e.detail; paintRule(); document.body.classList.toggle("auto-paused", !!rules.paused); { const sp = document.querySelector(".side-pause span"); if (sp) sp.textContent = rules.revoked ? "Review access" : rules.paused ? "Resume rules" : "Pause all rules"; const spa = document.querySelector(".side-pause"); if (spa) spa.title = sp?.textContent || ""; } { const mon = document.getElementById("asMon"); if (mon) mon.textContent = rules.revoked ? "Stopped · Reactive Lasna unsubscribed" : rules.paused ? "Paused · Reactive Lasna not watching" : "Monitoring · Reactive Lasna"; } document.body.classList.toggle("auto-revoked", !!rules.revoked); });
window.addEventListener("flowlet:trace", (e) => { rows = e.detail.rows || []; paintLast(); });
window.addEventListener("flowlet:demo", (e) => { replay = !!(e.detail?.replay && e.detail?.running) || (replay && !!e.detail?.replay); if (e.detail?.replay && !e.detail?.running) setTimeout(() => { replay = false; paintMode(); }, 8000); paintMode(); });
$("netPill")?.addEventListener("click", netSheet);
setInterval(paintRule, 5000);
initWelcome();
