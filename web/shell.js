// Flowlet app shell: tabs (sidebar / rail / bottom bar), automation status card, mobile wallet, PWA.
// Every state shown in the status card comes from the vault, the reactive contract or the on-chain trace; nothing is simulated.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? 0 : ms));
const desktop = window.matchMedia("(min-width: 1024px)");
const svg = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  wallet: svg('<path d="M5 7.5V7a2 2 0 0 1 2-2h10"/><rect x="4" y="7.5" width="16" height="11.5" rx="2.5"/><path d="M15.5 13.25h1.5"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  phone: svg('<rect x="7" y="3.5" width="10" height="17" rx="2.5"/><path d="M11 17.5h2"/>'),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/>'),
  ext: svg('<path d="M14 5h5v5M19 5l-8 8"/><path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"/>'),
};
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobileDevice = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (window.matchMedia?.("(pointer: coarse)").matches && innerWidth <= 1024);

// ------------------------------------------------------------------ tabs
const TABS = ["status", "timeline", "proof", "settings"];
const TITLE = { status: "Status", timeline: "Timeline", proof: "Proof", settings: "Settings" };
const LEGACY = { proof: ["timeline", "proof"], guard: ["proof", "guard"], funds: ["settings", "funds"], "rules-card": ["settings", "rules-card"] };
let cur = null;
function applyTab() {
  const [raw, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  let tab = TABS.includes(raw) ? raw : "status", scrollTo = null;
  if (LEGACY[raw] && !location.hash.startsWith("#/")) [tab, scrollTo] = LEGACY[raw];
  const main = $("main");
  const changed = tab !== cur, first = cur == null; cur = tab;
  main.dataset.tab = tab;
  for (const el of document.querySelectorAll("[data-tabs]")) {
    const on = el.dataset.tabs.split(" ").includes(tab) || (desktop.matches && (el.dataset.dtabs || "").split(" ").includes(tab));
    el.classList.toggle("tab-hidden", !on);
  }
  for (const a of document.querySelectorAll("#tabs a")) { const on = a.dataset.tab === tab; a.classList.toggle("active", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); }
  $("appbarTitle").textContent = TITLE[tab];
  document.title = tab === "status" ? "Flowlet · Money moves on your rules" : `${TITLE[tab]} · Flowlet`;
  // Tabs are peers (Appllama / Emil): switching is instant, no slide. Each tab opens at its top.
  if (changed && !first) window.scrollTo({ top: 0, behavior: "auto" });
  // Sidebar "Pause all rules" lands here: open Manage rules and focus the real Pause button. Pausing still takes a tap and a wallet confirmation.
  if (/(^|&)pause=1/.test(query)) requestAnimationFrame(() => { const b = $("pauseBtn"); if (!b) return; const d = b.closest("details"); if (d) d.open = true; b.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" }); b.focus({ preventScroll: true }); });
  if (scrollTo) requestAnimationFrame(() => $(scrollTo)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" }));
}
window.addEventListener("hashchange", applyTab);
// Re-tapping the active tab scrolls back to its top, like a native tab bar.
document.querySelectorAll("#tabs a").forEach((a) => a.addEventListener("click", (e) => {
  if (a.dataset.tab === cur && location.hash.split("?")[0] === a.getAttribute("href")) { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); }
}));
// ------------------------------------------------------------------ sidebar: collapse to an icon rail, drawer on tablet, arrow keys
{
  const root = document.documentElement, tog = $("sideToggle");
  const sync = () => { const ex = desktop.matches ? !root.classList.contains("side-collapsed") : root.classList.contains("side-open"); tog.setAttribute("aria-expanded", String(ex)); tog.setAttribute("aria-label", ex ? "Collapse sidebar" : "Expand sidebar"); };
  if (localStorage.getItem("flowlet.side") === "rail") root.classList.add("side-collapsed");
  const closeDrawer = () => { root.classList.remove("side-open"); sync(); };
  tog.onclick = () => {
    if (desktop.matches) { root.classList.toggle("side-collapsed"); localStorage.setItem("flowlet.side", root.classList.contains("side-collapsed") ? "rail" : "full"); }
    else { root.classList.toggle("side-open"); if (root.classList.contains("side-open")) document.querySelector("#tabs a.active, #tabs a")?.focus(); }
    sync();
  };
  desktop.addEventListener?.("change", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("side-open")) { closeDrawer(); tog.focus(); } });
  $("tabs").addEventListener("click", () => root.classList.contains("side-open") && closeDrawer());
  document.querySelector(".side-pause").addEventListener("click", () => root.classList.contains("side-open") && closeDrawer());
  document.querySelector(".main-col").addEventListener("click", (e) => { if (root.classList.contains("side-open") && !e.target.closest("button, a")) closeDrawer(); });
  $("tabs").addEventListener("keydown", (e) => {
    const links = [...document.querySelectorAll("#tabs a")]; const i = links.indexOf(document.activeElement); if (i < 0) return;
    const j = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: links.length - 1 }[e.key];
    if (j == null) return; e.preventDefault(); links[(j + links.length) % links.length].focus();
  });
  document.querySelectorAll("#tabs a, .side-pause").forEach((a) => (a.title = a.textContent.trim()));
  sync();
}
desktop.addEventListener?.("change", applyTab);
applyTab();

// ------------------------------------------------------------------ bottom sheet (native <dialog>)
const haptic = (kind) => { if (!navigator.vibrate || reduceMotion() || innerWidth > 1024) return; try { navigator.vibrate(kind === "error" ? [12, 60, 12] : 10); } catch {} };
/** Phone sheets follow the finger down from the grabber; past a quarter of their height (or a quick flick) they close. Exit 200ms, settle 250ms. */
function dragToDismiss(panel, handle, close) {
  const phone = () => window.matchMedia("(max-width: 640px)").matches;
  let y0 = 0, t0 = 0, last = 0, lastT = 0, dy = 0, active = false;
  handle.classList.add("grabber-zone");
  handle.addEventListener("pointerdown", (e) => { if (!phone()) return; active = true; y0 = last = e.clientY; t0 = lastT = performance.now(); dy = 0; panel.classList.remove("settling", "leaving"); panel.classList.add("dragging"); handle.setPointerCapture?.(e.pointerId); });
  handle.addEventListener("pointermove", (e) => { if (!active) return; const raw = e.clientY - y0; dy = raw > 0 ? raw : raw / 4; panel.style.transform = `translateY(${dy}px)`; lastT = performance.now(); last = e.clientY; });
  const end = (e) => {
    if (!active) return; active = false;
    const v = (e.clientY - last) / Math.max(1, performance.now() - lastT) || dy / Math.max(1, performance.now() - t0);
    panel.classList.remove("dragging");
    if (dy > panel.offsetHeight / 4 || (v > 0.5 && dy > 10)) { panel.classList.add("leaving"); panel.style.transform = "translateY(100%)"; panel.style.opacity = "0"; setTimeout(() => { close(); panel.classList.remove("leaving"); panel.style.transform = panel.style.opacity = ""; }, 200); }
    else { panel.classList.add("settling"); panel.style.transform = ""; setTimeout(() => panel.classList.remove("settling"), 260); }
  };
  handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
}
{ const t = $("trust"); if (t) dragToDismiss(t, t.querySelector(".grabber"), () => t.close()); }
function sheet(title, html) {
  $("sheet")?.remove();
  const d = document.createElement("dialog");
  d.id = "sheet"; d.className = "modal sheet"; d.setAttribute("aria-labelledby", "sheetTitle");
  d.innerHTML = `<div class="grabber" aria-hidden="true"></div><div class="section-head"><h2 id="sheetTitle" class="h3">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${IC.close}</button></div>${html}`;
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d); d.showModal();
  dragToDismiss(d, d.querySelector(".grabber"), () => d.close());
  return d;
}

// ------------------------------------------------------------------ wallet: injected provider, MetaMask deep link, wrong network, disconnect
let conf = null, account = null;
const metamaskLink = () => `https://link.metamask.io/dapp/${location.host}${location.pathname}${location.search}${location.hash}`;
function noWallet(reason) {
  const mobile = isMobileDevice();
  const demo = reason === "demo";
  sheet(demo ? "Run the live demo" : "No wallet in this browser", `
    <p class="muted">${demo ? "The live demo signs testnet transactions from the vault owner's wallet on Ethereum Sepolia. " : ""}${mobile
      ? "Phone browsers can't talk to a wallet directly. Open Flowlet inside the MetaMask app's browser and connect there. Your keys never leave MetaMask."
      : "Flowlet connects to a browser wallet such as the MetaMask extension. Install it, reload this page, then connect."}</p>
    ${mobile ? `<a class="btn primary wide" href="${esc(metamaskLink())}" rel="noopener">${IC.wallet}Open in MetaMask</a>` : `<a class="btn primary wide" href="https://metamask.io/download/" target="_blank" rel="noopener">${IC.wallet}Get MetaMask</a>`}
    <hr class="sep" />
    <p class="small muted">No wallet needed for these: every row is rebuilt from real on-chain logs.</p>
    <div class="sheet-actions"><button type="button" class="btn ghost wide" data-close data-replay>${IC.replay}Replay the last real loop</button><a class="btn ghost wide" href="#/timeline" data-close>See the live timeline</a></div>`)
    .querySelector("[data-replay]").addEventListener("click", () => { location.hash = "#/status"; setTimeout(replayLoop, 250); });
}
$("sideWallet").addEventListener("click", () => $("connectBtn").click());
window.addEventListener("flowlet:nowallet", (e) => noWallet(e.detail?.reason));
async function checkNetwork() {
  const w = $("netWarn");
  if (!account || !conf || conf.isLocal || !window.ethereum) { w.hidden = true; return; }
  const hex = await ethereum.request({ method: "eth_chainId" }).catch(() => null);
  const wrong = hex != null && Number(hex) !== Number(conf.destChainId);
  w.hidden = !wrong;
  $("connectBtn").classList.toggle("wrong", wrong);
  if (wrong) {
    w.innerHTML = `<span>Your wallet is on another network. Flowlet's vault is on ${esc(conf.destName)}.</span><button type="button" class="btn small primary" id="switchNet">Switch network</button>`;
    $("switchNet").onclick = () => ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + Number(conf.destChainId).toString(16) }] }).then(checkNetwork).catch(() => {});
  }
}
function setPill() {
  const b = $("connectBtn");
  b.innerHTML = account ? `${IC.wallet}<code>${esc(short(account))}</code>` : `${IC.wallet}<span>Connect</span>`;
  $("swName").textContent = account ? short(account) : "Not connected"; $("swName").className = account ? "mono" : "";
  $("swNet").textContent = account ? (conf && account.toLowerCase() === conf.owner?.toLowerCase() ? "Vault owner" : "Connected") + (conf?.destName ? ` · ${conf.destName}` : "") : "Connect a wallet";
  b.setAttribute("aria-label", account ? `Wallet ${short(account)}${conf && account.toLowerCase() === conf.owner?.toLowerCase() ? ", vault owner" : ""}` : "Connect wallet");
}
$("connectBtn").addEventListener("click", async () => {
  if (!window.ethereum) return noWallet("connect");
  const [a] = await ethereum.request({ method: "eth_requestAccounts" }).catch(() => []);
  if (!a) return;
  account = a; setPill(); checkNetwork();
});
if (window.ethereum) {
  ethereum.request({ method: "eth_accounts" }).then((accs) => { if (accs?.[0]) { account = accs[0]; setPill(); checkNetwork(); } }).catch(() => {});
  ethereum.on?.("accountsChanged", (accs) => { account = accs?.[0] || null; setPill(); checkNetwork(); });
  ethereum.on?.("chainChanged", () => checkNetwork());
}
window.addEventListener("flowlet:config", (e) => { conf = e.detail; $("sideWallet").hidden = !!conf.isLocal; setPill(); checkNetwork(); });

// ------------------------------------------------------------------ automation status card
let st = null, rows = [], seenDone = null, flash = null, replaying = false, demoRunning = false;
const ago = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(ts * 1000).toLocaleDateString(); };
function paint(stage, title, sub, mode) {
  const card = $("autoStatus");
  card.dataset.stage = stage; card.dataset.mode = mode || "";
  if ($("asTitle").textContent !== title) {
    // Status change: the title settles in (opacity + 4px, 200ms) instead of snapping; a short tick on a real execution.
    const t = $("asTitle"); t.classList.remove("swap"); void t.offsetWidth; t.classList.add("swap"); if (stage === "exec" && !replaying) haptic("ok");
    t.textContent = title; $("asLive").textContent = `${title}. ${sub.replace(/<[^>]+>/g, "")}`; }
  $("asSub").innerHTML = sub;
  const order = ["watch", "trig", "exec"];
  for (const li of $("asTrack").children) {
    const i = order.indexOf(li.dataset.s), si = order.indexOf(stage);
    li.className = si < 0 ? "" : i < si ? "past" : i === si ? "now" : "";
    i === si ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current");
  }
  const last = rows.find((r) => !r.pending);
  $("asLast").textContent = last?.callback?.ts ? `Last loop #${last.nonce} · ${ago(last.callback.ts)}` : rows.length ? "" : "No loops yet";
}
const moved = (r) => (r.actions || []).map((a) => `${esc(a.amount)} tUSD to <code>${esc(short(a.to))}</code>`).join(", ");
function render() {
  if (replaying) return;
  if (flash && Date.now() < flash.until) return paint("exec", "Executed", flash.sub, "exec");
  const pending = rows.find((r) => r.pending);
  if (pending) return paint("trig", "Triggered", `Loop #${esc(pending.nonce)} · ${esc(pending.kindLabel)}. The reactive contract fired on Lasna; the callback is on its way.`, "trig");
  if (!st) return paint("", "Checking your automation…", "Reading the vault and the reactive contract.", "");
  if (st.paused) return paint("", "Automation paused", st.revoked ? "Access was revoked, so the reactive contract paused itself. Nothing can move until you allow it again." : `Paused${st.reason ? ` · ${esc(st.reason)}` : ""}. Nothing moves until you resume.`, "paused");
  if (st.cron || st.dep) {
    const what = [st.cron ? "the schedule" : null, st.dep ? "incoming deposits" : null].filter(Boolean).join(" and ");
    return paint("watch", "Your automation is live", `Waiting for trigger… The reactive contract is watching ${what}.`, "live");
  }
  paint("", "No automation running", demoRunning ? "Setting up rules… the status turns live as soon as the reactive contract subscribes." : "Run the demo to create a standing order and auto-save, or replay the last real loop.", "idle");
}
window.addEventListener("flowlet:state", (e) => { st = e.detail; render(); });
window.addEventListener("flowlet:demo", (e) => { demoRunning = !!e.detail?.running; render(); });
window.addEventListener("flowlet:trace", (e) => {
  rows = e.detail.rows || [];
  const done = rows.filter((r) => !r.pending && r.callback);
  const keys = new Set(done.map((r) => r.nonce));
  if (seenDone) {
    const fresh = done.find((r) => !seenDone.has(r.nonce));
    if (fresh) flash = { until: Date.now() + 9000, sub: `Loop #${esc(fresh.nonce)} · ${esc(fresh.kindLabel)}: ${moved(fresh) || esc(fresh.decisions.map((d) => d.label).join(", ") || "rule evaluated")}. Sent by Reactive's callback proxy.` };
  }
  seenDone = keys; render();
});
setInterval(render, 3000);

/** Replays the newest completed loop using its real timestamps and transaction hashes. One tap, no wallet. */
async function replayLoop() {
  const r = rows.find((x) => !x.pending && x.callback);
  const btn = $("replayBtn");
  if (!r) { paint("", "Nothing to replay yet", "No completed reactive loop is on-chain for this deployment yet. Run the demo first.", "idle"); return; }
  replaying = true; btn.disabled = true;
  const ex = conf?.explorers || {};
  const link = (base, h, label) => (base && h ? `<a href="${esc(base.tx + h)}" target="_blank" rel="noopener">${esc(label)} ${IC.ext}</a>` : esc(label));
  $("autoStatus").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
  const lat = r.origin?.ts && r.callback?.ts ? ` (${r.callback.ts - r.origin.ts}s end to end)` : "";
  paint("watch", "Replay · Waiting for trigger…", `Loop #${esc(r.nonce)}, recorded on-chain ${r.callback?.ts ? ago(r.callback.ts) : ""}. The reactive contract watches the chain.`, "live"); await sleep(1300);
  paint("trig", "Replay · Triggered", `${esc(r.origin?.label || r.kindLabel)}. ${link(ex.dest, r.origin?.tx, "Origin event")} → ${link(ex.lasna, r.reactive?.tx, "Reactive tx on Lasna")}`, "trig"); await sleep(2200);
  paint("exec", "Replay · Executed", `${moved(r) || esc(r.decisions.map((d) => d.label).join(", "))}. ${link(ex.dest, r.callback?.tx, "Callback via Reactive's proxy")}${esc(lat)}`, "exec"); await sleep(5000);
  replaying = false; btn.disabled = false; render();
}
$("replayBtn").addEventListener("click", replayLoop);

// ------------------------------------------------------------------ PWA: service worker, install hint, offline screen
let deferred = null;
const HINT = "flowlet.installHint.dismissed";
function renderInstall() {
  const box = $("installBox"); if (!box) return;
  if (isStandalone()) box.innerHTML = `<p class="small">Installed. Flowlet is running as an app on this device.</p>`;
  else if (deferred) { box.innerHTML = `<p class="small muted">Add Flowlet to your home screen. It opens full screen, like an app.</p><button type="button" class="btn primary" id="installBtn">${IC.phone}Install Flowlet</button>`; $("installBtn").onclick = promptInstall; }
  else if (isIOS()) box.innerHTML = `<p class="small">On iPhone or iPad: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p><p class="small muted">Flowlet then opens full screen, with its own icon.</p>`;
  else box.innerHTML = `<p class="small muted">On a phone, open this page in Chrome or Safari and use “Add to Home Screen” (or “Install app”). Flowlet then opens full screen, with its own icon.</p>`;
}
async function promptInstall() { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => null); deferred = null; $("installHint")?.remove(); renderInstall(); }
function installHint() {
  if (isStandalone() || localStorage.getItem(HINT) || $("installHint") || innerWidth > 640 || !(deferred || isIOS())) return;
  const el = document.createElement("div");
  el.id = "installHint"; el.className = "install-hint"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Install Flowlet");
  el.innerHTML = `<span class="ih-ic" aria-hidden="true">${IC.phone}</span>${deferred ? `<span><b>Install Flowlet</b><small>Full screen, one tap from your home screen.</small></span><button type="button" class="btn small primary" id="ihInstall">Install</button>` : `<span><b>Add Flowlet to your Home Screen</b><small>Tap Share, then “Add to Home Screen”.</small></span>`}<button type="button" class="icon-btn" id="ihClose" aria-label="Dismiss install hint">${IC.close}</button>`;
  document.body.append(el);
  $("ihInstall")?.addEventListener("click", promptInstall);
  $("ihClose").onclick = () => { localStorage.setItem(HINT, "1"); el.remove(); };
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; renderInstall(); installHint(); });
window.addEventListener("appinstalled", () => { deferred = null; $("installHint")?.remove(); renderInstall(); });
renderInstall(); setTimeout(installHint, 2500);
function offline() {
  const off = !navigator.onLine; let el = $("offline");
  if (off && !el) {
    el = document.createElement("div"); el.id = "offline"; el.className = "offline"; el.setAttribute("role", "alert");
    el.innerHTML = `<div class="offline-card"><span class="as-orb" aria-hidden="true">${IC.wallet}</span><h2>You're offline.</h2><p class="muted">Wallet and automation state may be outdated. Your rules keep running on-chain; this screen refreshes when you reconnect.</p><p class="small muted">Flowlet never shows a cached balance as live. Nothing is sent while you're offline.</p><div class="row"><button type="button" class="btn primary" id="offRetry">Try again</button><button type="button" class="btn ghost" id="offClose">Keep browsing</button></div></div>`;
    document.body.append(el); $("offRetry").onclick = () => location.reload(); $("offClose").onclick = () => el.remove();
  } else if (!off && el) el.remove();
}
addEventListener("online", offline); addEventListener("offline", offline); offline();
document.documentElement.classList.toggle("standalone", isStandalone());
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
