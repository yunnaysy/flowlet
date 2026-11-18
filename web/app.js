import { buildTrace, makeRpc, EXPLORERS, REASON, fmtAmount } from "./trace.js";

const $ = (id) => document.getElementById(id);
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(`flowlet:${name}`, { detail }));

const params = new URLSearchParams(location.search);
const NET = params.get("net") ?? "eth-sepolia";
let cfg, d, destRpc, lasnaRpc, traceState, isLocal;
const LANDLORD = "0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d";
const SAVINGS = "0x5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e";

// ------------------------------------------------------------------ encoding
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const E = { a: (x) => pad(x), u: (n) => pad(BigInt(n).toString(16)), b: (x) => pad(x ? "1" : "0") };
const word = (data, i) => BigInt("0x" + data.slice(2 + 64 * i, 2 + 64 * (i + 1)));
const addrAt = (data, i) => "0x" + data.slice(2 + 64 * i + 24, 2 + 64 * (i + 1));
const SEL = {
  createOrder: "0xa116da5b", cancelOrder: "0x514fcac7", configureSweep: "0xba342e91", configureGuard: "0xd2d54671",
  resume: "0x046f7da2", pause: "0x8456cb59", guard: "0x7ceab3b1", sweepRule: "0xa7d43cb7", getOrder: "0xd09ef241",
  orderCount: "0x2453ffa8", remainingToday: "0xfc3c5515", paused: "0x5c975abb", cronSubscribed: "0xc0d062c6",
  depositWatch: "0xdf1929f7", nonce: "0xaffed0e0", ticks: "0x2cfffaf6", approve: "0x095ea7b3", mint: "0x40c10f19",
  balanceOf: "0x70a08231", allowance: "0xdd62ed3e",
};
const units = (x) => BigInt(Math.round(parseFloat(x) * 1e6));
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "–");
const ago = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : new Date(ts * 1000).toLocaleTimeString(); };

// Escape anything interpolated into innerHTML. On-chain values are hex/numbers, but nothing user-controlled is trusted.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a).trim());
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// One outline icon set (24px grid, currentColor). No emoji glyphs.
const svg = (d, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  ext: svg('<path d="M15 3h6v6"/> <path d="M10 14 21 3"/> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  home: svg('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/> <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  leaf: svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/> <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'),
  shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/> <path d="M12 8v4"/> <path d="M12 16h.01"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  // Ethereum glyph only on the Ethereum Sepolia chip, where it is technically correct.
  eth: svg('<path d="M12 3l6 9.2-6 3.6-6-3.6z"/><path d="M6 13.6l6 7.4 6-7.4-6 3.6z"/>'),
  lasna: svg('<circle cx="12" cy="12" r="2.4"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5M12 20.5A8.5 8.5 0 0 1 3.5 12"/>'),
};
/** tUSD token badge, used on every balance and amount. */
const TOK = `<span class="tok" translate="no">${svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.6 10.3h6.8M8.6 13.7h6.8"/>')}tUSD</span>`;
const chain = (cls, icon, name) => `<span class="chain ${cls}" translate="no">${icon}${esc(name)}</span>`;
/** Hash chip: monospace value, copy button, explorer link when one exists. */
function hashChip(base, h, kind = "tx") {
  if (!h) return "–";
  const what = kind === "tx" ? "transaction hash" : "address";
  const url = base ? (kind === "tx" ? base.tx : base.addr) + h : null;
  return `<span class="hash" translate="no"><code title="${esc(h)}">${esc(short(h))}</code><button type="button" class="hc-btn" data-copy="${esc(h)}" aria-label="Copy ${what}" title="Copy ${what}">${IC.copy}</button>${url ? `<a class="hc-btn" href="${esc(url)}" target="_blank" rel="noopener" aria-label="View ${what} on the explorer (opens in a new tab)" title="View on explorer">${IC.ext}</a>` : ""}</span>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest?.("[data-copy]"); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.innerHTML = IC.check; b.classList.add("done"); announce("Copied"); setTimeout(() => { b.innerHTML = IC.copy; b.classList.remove("done"); }, 1400); } catch { log("copy failed: select the value and copy it manually"); }
});
function announce(msg) { const el = $("srStatus"); if (el) { el.textContent = ""; setTimeout(() => (el.textContent = msg), 30); } }
function log(msg) { $("log").textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + $("log").textContent; }

// --------------------------------------------------------------------- setup
async function loadConfig() {
  const res = await fetch(`../deployments/${NET}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`deployments/${NET}.json not found. Deploy first (scripts/deploy.sh) or open ?net=local with scripts/local-stack.sh running.`);
  d = await res.json();
  isLocal = d.destination === "local";
  destRpc = makeRpc(d.destinationRpc);
  lasnaRpc = makeRpc(d.lasnaRpc);
  cfg = {
    destRpc: d.destinationRpc, lasnaRpc: d.lasnaRpc, destChainId: d.destinationChainId, vault: d.contracts.flowletVault,
    reactive: d.contracts.flowletReactive, token: d.contracts.mockUSD, wallet: d.wallet, callbackProxy: d.callbackProxy,
    startBlocks: d.startBlocks, logChunk: isLocal ? 2000 : 5000,
  };
  const destName = { 11155111: "Ethereum Sepolia", 84532: "Base Sepolia" }[d.destinationChainId] || d.destination;
  $("netPill").innerHTML = isLocal
    ? `<span class="chain local">Local rehearsal</span>${chain("eth", IC.eth, "Sepolia (anvil)")}${chain("lasna", IC.lasna, "Lasna (anvil)")}`
    : `${chain("eth", d.destinationChainId === 11155111 ? IC.eth : IC.lasna, destName)}${chain("lasna", IC.lasna, "Reactive Lasna")}`;
  $("netPill").insertAdjacentHTML("beforeend", '<span class="sr-only"> · network details</span>');
  $("netPill").className = "chains";
  $("connectBtn").hidden = isLocal;
  const dx = isLocal ? null : EXPLORERS[d.destinationChainId], lx = isLocal ? null : EXPLORERS.lasna;
  const a = (base, addr) => hashChip(base, addr, "address");
  const contractsHtml = `<span>Vault ${a(dx, cfg.vault)}</span><span>Reactive contract ${a(lx, cfg.reactive)}</span><span>${TOK} ${a(dx, cfg.token)}</span><span>Callback proxy ${a(dx, cfg.callbackProxy)}</span>`;
  if ($("contracts")) $("contracts").innerHTML = contractsHtml;
  emit("config", { isLocal, destChainId: d.destinationChainId, destName, owner: cfg.wallet, explorers: { dest: dx, lasna: lx }, addrs: { vault: cfg.vault, reactive: cfg.reactive, token: cfg.token, callbackProxy: cfg.callbackProxy } });
  $("footer").innerHTML = `<span>Vault ${a(dx, cfg.vault)}</span><span>Reactive contract ${a(lx, cfg.reactive)}</span><span>${TOK} ${a(dx, cfg.token)}</span><span>Callback proxy ${a(dx, cfg.callbackProxy)}</span><p>Flowlet is open source. Testnet only.</p>`;
}

const call = (rpc, to, data) => rpc("eth_call", [{ to, data }, "latest"]);

// ----------------------------------------------------------------- tx sending
async function send(to, data, label) {
  log(`→ ${label}`);
  let hash;
  if (isLocal) {
    hash = await destRpc("eth_sendTransaction", [{ from: cfg.wallet, to, data }]);
  } else {
    if (!window.ethereum) throw new Error("No wallet found. Install MetaMask or use scripts/demo.sh.");
    const [from] = await ethereum.request({ method: "eth_requestAccounts" });
    if (from.toLowerCase() !== cfg.wallet.toLowerCase()) log(`warning: connected ${short(from)} is not the vault owner ${short(cfg.wallet)}; owner-only calls will fail`);
    const chainHex = "0x" + Number(d.destinationChainId).toString(16);
    if ((await ethereum.request({ method: "eth_chainId" })) !== chainHex) await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    hash = await ethereum.request({ method: "eth_sendTransaction", params: [{ from, to, data }] });
  }
  for (let i = 0; i < 120; i++) {
    const r = await destRpc("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== "0x1") throw new Error(`${label} reverted (${hash})`);
      log(`✓ ${label}  ${hash}`);
      return hash;
    }
    await sleep(1000);
  }
  throw new Error(`${label}: no receipt yet (${hash})`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tx = {
  mint: (amt) => send(cfg.token, SEL.mint + E.a(cfg.wallet) + E.u(amt), `receive ${fmtAmount(amt)} tUSD`),
  approve: (amt) => send(cfg.token, SEL.approve + E.a(cfg.vault) + E.u(amt), amt === 0n ? "revoke Flowlet's access" : `allow Flowlet up to ${fmtAmount(amt)} tUSD`),
  order: (payee, amt, every, runs) => send(cfg.vault, SEL.createOrder + E.a(payee) + E.u(amt) + E.u(every) + E.u(0) + E.u(runs), `standing order ${fmtAmount(amt)} tUSD every ${every}s`),
  save: (savings, min, bps, on) => send(cfg.vault, SEL.configureSweep + E.a(savings) + E.u(min) + E.u(bps) + E.b(on), on ? `auto-save ${Number(bps) / 100}% of deposits ≥ ${fmtAmount(min)}` : "auto-save off"),
  guard: (limit, reserve) => send(cfg.vault, SEL.configureGuard + E.u(limit) + E.u(reserve), `Safety Guard: limit ${fmtAmount(limit)}/day, reserve ${fmtAmount(reserve)}`),
  pause: () => send(cfg.vault, SEL.pause, "pause all"),
  resume: () => send(cfg.vault, SEL.resume, "resume"),
  cancel: (id) => send(cfg.vault, SEL.cancelOrder + E.u(id), `cancel order #${id}`),
};
const lasnaBool = async (sel) => BigInt(await call(lasnaRpc, cfg.reactive, sel)) === 1n;
async function waitFor(fn, label, timeout = 90) {
  for (let i = 0; i < timeout; i++) { if (await fn()) return true; await sleep(1000); }
  throw new Error(`timed out waiting for: ${label}`);
}
const balanceOf = async (a) => BigInt(await call(destRpc, cfg.token, SEL.balanceOf + E.a(a)));

// ------------------------------------------------------------------ RUN DEMO
const DEMO = [
  ["Get 5,000 test dollars", async (c) => { await tx.mint(5000n * 10n ** 6n); c.bal = await balanceOf(cfg.wallet); }],
  ["Allow Flowlet to move up to 2,000 tUSD", async () => {
    await tx.approve(2000n * 10n ** 6n);
    const g = await call(destRpc, cfg.vault, SEL.guard);
    if (word(g, 4) === 1n) { await tx.resume(); await waitFor(async () => !(await lasnaBool(SEL.paused)), "Reactive resumed"); }
  }],
  ["Safety Guard: 500/day limit + emergency reserve", async (c) => tx.guard(500n * 10n ** 6n, c.bal + 1000n * 10n ** 6n - 25n * 10n ** 6n - 100n * 10n ** 6n)],
  ["Rent: 25 tUSD every 60s, 3 times", async () => tx.order(LANDLORD, 25n * 10n ** 6n, 60, 3)],
  ["Auto-save 20% of deposits ≥ 100", async () => tx.save(SAVINGS, 100n * 10n ** 6n, 2000, true)],
  ["Reactive starts watching deposits", async () => waitFor(() => lasnaBool(SEL.depositWatch), "deposit watch on Lasna")],
  ["Salary of 1,000 tUSD arrives", async () => tx.mint(1000n * 10n ** 6n)],
  ["Watch rent + saving happen on their own", async () => {
    const start = await balanceOf(LANDLORD);
    await waitFor(async () => (await balanceOf(SAVINGS)) > 0n && (await balanceOf(LANDLORD)) > start, "auto-save and a rent payment", 150);
  }],
  ["Revoke access (circuit breaker test)", async () => tx.approve(0n)],
  ["Reactive pauses everything", async () => waitFor(() => lasnaBool(SEL.paused), "Safety Guard on Lasna")],
];
// Five numbered steps for people; each groups real transactions from DEMO above. Revoke is a separate, optional test.
const GROUPS = [
  { title: "Fund & allow", sub: "Get test tUSD and allow the vault to move up to 2,000 (a paused vault is resumed)", steps: [0, 1] },
  { title: "Set your rules", sub: "Safety Guard, rent 25 tUSD every 60 s (3 times), auto-save 20% of deposits of 100 or more", steps: [2, 3, 4] },
  { title: "Reactive subscribes", sub: "The reactive contract on Lasna starts watching deposits and its CRON clock", steps: [5] },
  { title: "Salary event", sub: "1,000 tUSD arrives in the wallet: the event Reactive is watching for", steps: [6] },
  { title: "Reactive executes", sub: "Rent and auto-save run from Reactive callbacks, not from this page", steps: [7] },
];
const BREAKER = [8, 9];
let demoLinks = {};
function renderSteps(state = {}) {
  const gState = (g) => { const xs = g.steps.map((i) => state[i] ?? ""); return xs.includes("err") ? "err" : xs.includes("run") ? "run" : xs.every((x) => x === "done") ? "done" : ""; };
  $("demoSteps").innerHTML = GROUPS.map((g, gi) => {
    const st = state.groups?.[gi] ?? gState(g);
    const dot = st === "run" ? `<span class="dm" aria-hidden="true">${"<i></i>".repeat(9)}</span>` : st === "done" ? IC.check : st === "err" ? "!" : String(gi + 1);
    return `<li class="${st}"${st === "run" ? ' aria-current="step"' : ""}><span class="dot">${dot}</span><span class="st-txt"><b>${esc(g.title)}</b><small>${esc(g.sub)}</small>${demoLinks[gi] ? `<span class="st-links">${demoLinks[gi]}</span>` : ""}</span></li>`;
  }).join("");
}
let lastRows = [];
const txA = (base, h, label) => (h ? (base ? `<a class="txl" href="${esc(base.tx + h)}" target="_blank" rel="noopener">${esc(label)} ${IC.ext}</a>` : `<span class="txl">${esc(label)} <code>${esc(short(h))}</code></span>`) : "");
const loopLinks = (r, dx, lx) => `${txA(dx, r.origin?.tx, `Origin tx · ${isLocal ? "Sepolia (anvil)" : "Sepolia"}`)}${txA(lx, r.reactive?.tx, `Reactive tx · ${isLocal ? "Lasna (anvil)" : "Lasna"}`)}${txA(dx, r.callback?.tx, `Callback tx · ${isLocal ? "Sepolia (anvil)" : "Sepolia"}`)}`;
function demoBusy(btn, on, label) {
  btn.disabled = on; btn.classList.toggle("running", on); on ? btn.setAttribute("aria-busy", "true") : btn.removeAttribute("aria-busy");
  if (label) btn.innerHTML = label; document.body.classList.toggle("demo-running", on);
}
async function runDemo() {
  // On the public site only the vault owner's wallet can run the live loop. Everyone else gets the replay of the recorded loop.
  if (!isLocal) {
    const accs = window.ethereum ? await ethereum.request({ method: "eth_accounts" }).catch(() => []) : [];
    if (!accs?.[0] || accs[0].toLowerCase() !== cfg.wallet.toLowerCase()) return replayDemo(!window.ethereum ? "nowallet" : !accs?.[0] ? "notconnected" : "notowner");
  }
  emit("demo", { running: true, live: true });
  const btn = $("runDemo"); demoLinks = {};
  demoBusy(btn, true, `<span class="spin" aria-hidden="true"></span>Running… about two minutes`);
  const state = {}; const ctx = {}; const t0 = Math.floor(Date.now() / 1000);
  try {
    for (let i = 0; i <= 7; i++) {
      state[i] = "run"; renderSteps(state);
      await DEMO[i][1](ctx);
      state[i] = "done"; renderSteps(state);
      const g = GROUPS.findIndex((x) => x.steps.at(-1) === i); if (g >= 0) { $("demoCount").textContent = `${g + 1} of ${GROUPS.length}`; announce(`Step ${g + 1} of ${GROUPS.length} done: ${GROUPS[g].title}`); }
    }
    // The three transactions of the loop this run produced (newest completed loop after the start).
    await waitFor(async () => lastRows.some((r) => r.callback?.ts >= t0 - 5), "the loop to appear in the trace", 60).catch(() => {});
    const r = lastRows.find((x) => x.callback?.ts >= t0 - 5) || lastRows.find((x) => x.callback);
    if (r) { demoLinks[4] = loopLinks(r, isLocal ? null : EXPLORERS[d.destinationChainId], isLocal ? null : EXPLORERS.lasna); renderSteps(state); }
    demoBusy(btn, false, `${IC.check}Done. The rules ran on their own.`); btn.classList.add("done");
    announce("Demo complete."); emit("demo", { running: false, done: true, nonce: r?.nonce });
    $("breakerBox").hidden = false;
    log("Demo complete. Every transfer above was executed by a Reactive callback, not by this page.");
  } catch (e) {
    const i = Object.keys(state).find((k) => state[k] === "run"); if (i != null) state[i] = "err"; renderSteps(state);
    log("demo stopped: " + e.message); demoBusy(btn, false, `${IC.play}Try again`);
    $("demoErr").hidden = false; $("demoErr").textContent = `Stopped: ${e.message}. Nothing else was sent.`;
    announce(`Demo stopped: ${e.message}`); emit("demo", { running: false, error: e.message });
  }
}
/** Optional circuit-breaker test: revoke the allowance and watch Reactive pause itself and the vault. */
async function runBreaker() {
  const b = $("runBreaker"); demoBusy(b, true, `<span class="spin" aria-hidden="true"></span>Revoking…`);
  try { for (const i of BREAKER) await DEMO[i][1]({}); demoBusy(b, false, `${IC.check}Reactive paused everything`); }
  catch (e) { demoBusy(b, false, "Test the circuit breaker"); log("breaker: " + e.message); $("demoErr").hidden = false; $("demoErr").textContent = `Circuit-breaker test stopped: ${e.message}`; }
}
/** No owner wallet: replay the recorded loop step by step with its real transactions. Clearly labelled; nothing is sent. */
let recorded = null;
async function loadRecorded() {
  if (recorded) return recorded;
  const r = await fetch("recorded-loops.json", { cache: "no-store" }).catch(() => null);
  recorded = r?.ok ? await r.json() : null; return recorded;
}
async function replayDemo(why) {
  const rec = isLocal ? null : await loadRecorded();
  const btn = $("runDemo"); demoLinks = {};
  const note = { nowallet: "No wallet in this browser.", notconnected: "No wallet connected.", notowner: "Your wallet isn't this demo vault's owner." }[why] || "";
  $("demoNote").innerHTML = `<b>Replay.</b> ${esc(note)} Showing the recorded run on Sepolia and Lasna; every link is a real transaction and nothing is sent.`;
  if (!rec?.rows?.length) { $("demoErr").hidden = false; $("demoErr").textContent = "The recorded run couldn't be loaded. The Activity tab still shows every loop from live chain data."; return; }
  emit("demo", { running: true, replay: true });
  demoBusy(btn, true, `<span class="spin" aria-hidden="true"></span>Replaying the recorded run…`);
  const dx = rec.explorers.dest, lx = rec.explorers.lasna, S = rec.setup;
  const loop = rec.rows.find((r) => r.kind === 2 && r.callback) || rec.rows.find((r) => r.callback);
  const L = {
    0: `${txA(dx, S.mint_start, "Test tUSD")}${txA(dx, S.approve_mandate, "Allowance")}`,
    1: `${txA(dx, S.configure_guard, "Safety Guard")}${txA(dx, S.create_order, "Rent order")}${txA(dx, S.configure_sweep, "Auto-save")}`,
    2: `<span class="txl muted">Subscriptions live inside the reactive contract; its transaction is in step 5.</span>`,
    3: txA(dx, S.salary_deposit, "Salary deposit"),
    4: loop ? loopLinks(loop, dx, lx) : "",
  };
  const state = { groups: {} };
  for (let g = 0; g < GROUPS.length; g++) {
    state.groups[g] = "run"; renderSteps(state); await sleep(reduceMotion() ? 0 : 900);
    state.groups[g] = "done"; demoLinks[g] = L[g]; renderSteps(state); $("demoCount").textContent = `${g + 1} of ${GROUPS.length}`;
  }
  demoBusy(btn, false, `${IC.replay || IC.play}Replay again`);
  announce("Replay complete."); emit("demo", { running: false, replay: true, done: true, nonce: loop?.nonce, recorded: true });
}
// ------------------------------------------------------------------ rendering
function stat(k, v, s, cls, unit = false) { return `<div class="stat ${cls}" data-k="${esc(k)}"><div class="k">${esc(k)}</div><div class="v-row"><span class="v">${esc(v)}</span>${unit ? TOK : ""}</div><div class="s">${esc(s)}</div></div>`; }
const lastStats = {};
function renderStats(html) {
  const box = $("stats"); const tmp = document.createElement("div"); tmp.innerHTML = html;
  if (!box.children.length) { box.replaceChildren(...tmp.children); for (const el of box.children) lastStats[el.dataset.k] = el.querySelector(".v").textContent; return; }
  for (const el of [...tmp.children]) {
    const cur = [...box.children].find((x) => x.dataset.k === el.dataset.k);
    const v = el.querySelector(".v").textContent;
    if (!cur) { box.append(el); continue; }
    if (cur.className.replace(" bump", "") !== el.className) cur.className = el.className;
    cur.querySelector(".s").textContent = el.querySelector(".s").textContent;
    if (!!cur.querySelector(".v-row > :not(.v)") !== !!el.querySelector(".v-row > :not(.v)")) cur.querySelector(".v-row").innerHTML = el.querySelector(".v-row").innerHTML;
    if (lastStats[el.dataset.k] !== v) { cur.querySelector(".v").textContent = v; cur.classList.remove("bump"); void cur.offsetWidth; cur.classList.add("bump"); lastStats[el.dataset.k] = v; }
  }
}

async function refreshState() {
  const [bal, saved, paid, allowance, g, sweep, n, rem, rPaused, cron, dep, nonce, ticks] = await Promise.all([
    balanceOf(cfg.wallet), balanceOf(SAVINGS), balanceOf(LANDLORD),
    call(destRpc, cfg.token, SEL.allowance + E.a(cfg.wallet) + E.a(cfg.vault)).then(BigInt),
    call(destRpc, cfg.vault, SEL.guard), call(destRpc, cfg.vault, SEL.sweepRule),
    call(destRpc, cfg.vault, SEL.orderCount).then((x) => Number(BigInt(x))),
    call(destRpc, cfg.vault, SEL.remainingToday).then(BigInt),
    lasnaBool(SEL.paused), lasnaBool(SEL.cronSubscribed), lasnaBool(SEL.depositWatch),
    call(lasnaRpc, cfg.reactive, SEL.nonce).then((x) => Number(BigInt(x))),
    call(lasnaRpc, cfg.reactive, SEL.ticks).then((x) => Number(BigInt(x))),
  ]);
  const guard = { limit: word(g, 0), reserve: word(g, 1), spent: word(g, 2), paused: word(g, 4) === 1n, reason: Number(word(g, 5)) };
  const revoked = guard.paused && guard.reason === 11; // MANDATE_REVOKED
  const sw = { savings: addrAt(sweep, 0), min: word(sweep, 1), bps: Number(word(sweep, 2)), on: word(sweep, 3) === 1n };

  renderStats(
    stat("Wallet balance", `${fmtAmount(bal)}`, "stays in your wallet", "sky", true) +
    stat("Saved", fmtAmount(saved), "moved to savings", "mint", true) +
    stat("Rent paid", fmtAmount(paid), "paid to the landlord", "peach", true) +
    stat("Flowlet allowance", allowance !== 0n ? fmtAmount(allowance) : revoked ? "Revoked" : "None", allowance !== 0n ? "it may still move" : revoked ? "nothing can move" : "no access granted yet", allowance === 0n && revoked ? "rose" : "lilac", allowance !== 0n));

  emit("state", { paused: guard.paused || rPaused, revoked, reason: REASON[guard.reason] ?? "", cron, dep, orders: n, sweepOn: sw.on, allowance: allowance.toString(), nonce });
  const sub = (name, on, desc) => `<li><span><b>${esc(name)}</b><br/><small>${esc(desc)}</small></span><span class="switch ${on ? "on" : ""}" role="img" aria-label="${on ? "on" : "off"}"></span></li>`;
  $("subs").innerHTML =
    sub("Vault rules", true, "Mirrors every rule from the vault's own events") +
    sub("Mandate watch", true, "Approval(you → vault): the circuit breaker's trigger") +
    sub("CRON clock", cron, cron ? "Ticking because a standing order is active" : "Off: nothing scheduled or paused (costs nothing)") +
    sub("Deposit watch", dep, dep ? "Transfer(→ your wallet) for auto-save" : "Off: auto-save disabled or paused") +
    `<li><span><b>Callbacks requested</b></span><span class="count">${nonce}</span></li><li><span><b>CRON ticks seen</b></span><span class="count">${ticks}</span></li>`;

  const remTxt = guard.limit === 0n ? "no daily limit" : `${fmtAmount(rem)} of ${fmtAmount(guard.limit)} tUSD left today`;
  $("guardBox").innerHTML = `
    <p><span class="pill ${guard.paused || rPaused ? "bad" : "soft"}">${guard.paused || rPaused ? "Paused · " + esc(REASON[guard.reason] ?? "") : '<span class="dot" aria-hidden="true"></span>Watching'}</span></p>
    <ul class="subs">
      <li><span><b>Daily payment limit</b><br/><small class="muted">${esc(remTxt)}</small></span></li>
      <li><span><b>Emergency reserve</b><br/><small class="muted">Auto-save never takes your wallet below ${fmtAmount(guard.reserve)} tUSD. This rule overrides the auto-save %.</small></span></li>
      <li><span><b>Revoke = stop</b><br/><small class="muted">Setting the allowance to 0 makes the reactive contract pause itself and the vault.</small></span></li>
    </ul>`;

  const cell = (k, v, sub, unit = true) => `<div><small>${esc(k)}</small><b><span class="n">${esc(v)}</span>${unit ? " " + TOK : ""}</b><span class="small muted">${esc(sub)}</span></div>`;
  $("fundGrid").innerHTML =
    cell("In your wallet", fmtAmount(bal), "Flowlet never holds a deposit") +
    cell("Flowlet may move at most", allowance === 0n ? (revoked ? "0, revoked" : "0, not granted") : fmtAmount(allowance), "your ERC-20 allowance to the vault", allowance !== 0n) +
    cell("Left today", guard.limit === 0n ? "No limit" : fmtAmount(rem), "standing orders, Safety Guard", guard.limit !== 0n) +
    cell("Emergency reserve", fmtAmount(guard.reserve), "auto-save never goes below");
  let rows = ""; const orderList = [];
  for (let i = 0; i < n; i++) {
    const o = await call(destRpc, cfg.vault, SEL.getOrder + E.u(i));
    const ord = { payee: addrAt(o, 0), amount: word(o, 1), interval: Number(word(o, 2)), nextDue: Number(word(o, 3)), runs: Number(word(o, 4)), max: Number(word(o, 5)), active: word(o, 7) === 1n };
    orderList.push({ id: i, payee: ord.payee, amount: fmtAmount(ord.amount), interval: ord.interval, nextDue: ord.nextDue, runs: ord.runs, max: ord.max, active: ord.active });
    const due = ord.nextDue - Math.floor(Date.now() / 1000);
    rows += `<tr><td><span class="tag peach">${IC.home}</span> #${i}</td><td><span class="n">${esc(fmtAmount(ord.amount))}</span> ${TOK} to ${hashChip(isLocal ? null : EXPLORERS[d.destinationChainId], ord.payee, "address")}</td><td>every ${ord.interval}s</td>
      <td>${ord.active ? (due > 0 ? `next in ${due}s` : "due now") : "finished"}</td><td>${ord.runs}${ord.max ? "/" + ord.max : ""} runs</td>
      <td>${ord.active ? `<button class="btn ghost small" data-cancel="${i}">Cancel</button>` : ""}</td></tr>`;
  }
  $("rules").innerHTML = `<table><thead><tr><th scope="col">Rule</th><th scope="col">What</th><th scope="col">When</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}
    <tr><td><span class="tag mint">${IC.leaf}</span> Auto-save</td><td>${sw.on ? `${sw.bps / 100}% of deposits ≥ <span class="n">${esc(fmtAmount(sw.min))}</span> ${TOK} to ${hashChip(isLocal ? null : EXPLORERS[d.destinationChainId], sw.savings, "address")}` : "Off"}</td><td>on every deposit</td><td>${sw.on ? "On" : "Off"}</td><td></td><td></td></tr></tbody></table>`;
  { const hs = ["Rule", "What", "When", "Status", "Progress", ""]; $("rules").querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => hs[i] && td.setAttribute("data-label", hs[i]))); }
  emit("rules", { orders: orderList, sweep: { on: sw.on, pct: sw.bps / 100, min: fmtAmount(sw.min), savings: sw.savings }, guard: { limit: guard.limit === 0n ? null : fmtAmount(guard.limit), left: fmtAmount(rem), reserve: fmtAmount(guard.reserve) }, allowance: allowance === 0n ? "0" : fmtAmount(allowance), paused: guard.paused || rPaused, revoked, reason: REASON[guard.reason] ?? "" });
  document.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => { if (confirm(`Cancel standing order #${b.dataset.cancel}?`)) tx.cancel(b.dataset.cancel).catch((e) => log(e.message)); }));
}

function legHtml(title, cls, body) { return `<div class="leg ${cls}"><b>${esc(title)}</b>${body}</div>`; }
const hashLink = (base, h) => hashChip(base, h, "tx");
const seen = new Set(); let firstTrace = true; let lastTraceHtml = "";

async function refreshTrace() {
  const { rows, state } = await buildTrace(cfg, traceState);
  traceState = state; lastRows = rows;
  emit("trace", { rows: rows.map((r) => ({ nonce: r.nonce, kind: Number(r.kind), kindLabel: r.kindLabel, pending: !!r.pending, origin: r.origin ? { label: r.origin.label, tx: r.origin.tx, ts: r.origin.ts, isDueTime: !!r.origin.isDueTime } : null, reactive: r.reactive ? { tx: r.reactive.tx, ts: r.reactive.ts } : null, callback: r.callback ? { tx: r.callback.tx, ts: r.callback.ts, viaProxy: r.callback.viaProxy, sentByWallet: r.callback.sentByWallet } : null, decisions: (r.decisions ?? []).map((x) => ({ ruleId: x.ruleId != null ? String(x.ruleId) : undefined, kind: x.kind != null ? Number(x.kind) : undefined, label: x.label, executed: String(x.executed ?? 0), requested: String(x.requested ?? 0), reason: x.reason, text: x.text })), actions: (r.actions ?? []).map((a) => ({ amount: fmtAmount(a.amount), to: a.to })), change: (r.change ?? []).map((c) => ({ ...c, delta: c.delta != null ? String(c.delta) : undefined })), latency: r.latency ?? null })) });
  $("traceStatus").innerHTML = `<span class="dot" aria-hidden="true"></span>${rows.length} reactive loop${rows.length === 1 ? "" : "s"}, live`;
  if (!rows.length) return;
  const fresh = new Set(rows.filter((r) => !seen.has(`${r.nonce}:${r.pending ? 0 : 1}`) && !firstTrace).map((r) => r.nonce));
  const dx = isLocal ? null : EXPLORERS[d.destinationChainId], lx = isLocal ? null : EXPLORERS.lasna;
  const htmls = rows.map((r) => {
    const dec = r.decisions ?? [];
    const okAny = dec.some((x) => x.executed > 0n);
    const moved = (r.actions ?? []).map((a) => `<span class="n">${esc(fmtAmount(a.amount))}</span> ${TOK} to <code>${esc(short(a.to))}</code>`).join("<br/>");
    const icon = r.kind === 1 ? IC.home : r.kind === 2 ? IC.leaf : IC.shield;
    return `<article class="trace kind-${Number(r.kind)}${fresh.has(r.nonce) ? " fresh" : ""}" data-key="${esc(`${r.nonce}:${r.pending ? 0 : 1}`)}">
      <div class="trace-head"><span class="title"><span class="glyph" aria-hidden="true">${icon}</span>#${esc(r.nonce)} · ${esc(r.kindLabel)}</span>
        ${r.callback ? `<button type="button" class="btn ghost small proof-btn" data-proof="${esc(r.nonce)}">Proof<span class="sr-only"> for loop ${esc(r.nonce)}</span></button>` : ""}        <span class="pill ${r.pending ? "warn" : dec.some((x) => x.reason === 11 || x.reason === 5) ? "bad" : "soft"}">${r.pending ? `<span class="dm" aria-hidden="true">${"<i></i>".repeat(9)}</span> callback in flight…` : esc(dec.map((x) => x.label).join(", "))}</span></div>
      <div class="flow"><span class="pulse" aria-hidden="true"></span>
        ${legHtml("① Origin event", "", `${esc(r.origin?.label ?? "")}<br/>${hashLink(dx, r.origin?.tx)}${r.origin?.isDueTime ? '<div class="t">due-time set here</div>' : ""}${r.origin?.ts ? `<div class="t">${ago(r.origin.ts)}</div>` : ""}`)}
        ${legHtml("② Reactive · Lasna", "note", `${r.kind === 1 ? "CRON tick found it due" : r.kind === 2 ? "Deposit matched" : "Mandate revoked → paused"}<br/>${hashLink(lx, r.reactive.tx)}<div class="t">${ago(r.reactive.ts)}</div>`)}
        ${legHtml("③ Callback", r.callback ? "ok" : "wait", r.callback ? `via ${r.callback.viaProxy ? "Reactive proxy" : esc(short(r.callback.to))}<br/>${hashLink(dx, r.callback.tx)}<div class="t">${ago(r.callback.ts)}</div>` : "waiting for delivery…")}
        ${legHtml("④ Rule evaluation", r.callback ? "ok" : "wait", dec.map((x) => esc(`${x.label}${x.requested ? ` · wanted ${fmtAmount(x.requested)}` : ""}`)).join("<br/>") || "–")}
        ${legHtml("⑤ Action", okAny ? "ok" : "", moved || (r.kind === 3 && r.callback ? "Vault paused" : "nothing moved"))}
      </div>
      ${dec.map((x) => `<p class="explain">${esc(x.text)}</p>`).join("")}
      <div class="latency">
        ${r.latency ? `<span class="badge">origin → Lasna ${esc(r.latency.originToReactive ?? "–")}s</span><span class="badge">Lasna → callback ${esc(r.latency.reactiveToCallback)}s</span><span class="badge">end-to-end ${esc(r.latency.total ?? "–")}s</span>` : ""}
        ${r.callback ? (r.callback.viaProxy && !r.callback.sentByWallet ? `<span class="badge proof">${IC.check}Sent by Reactive's callback proxy, not by you or this page</span>` : `<span class="badge warn">callback sender not verified</span>`) : ""}
      </div>
    </article>`;
  });
  // Keyed patch: existing rows only get their relative times refreshed, so the "fresh" flow animation plays once per new row.
  const box = $("timeline"); box.querySelector(".empty")?.remove();
  const want = htmls.map((html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; });
  const have = new Map([...box.querySelectorAll("article.trace")].map((el) => [el.dataset.key, el]));
  const next = want.map((el) => {
    const cur = have.get(el.dataset.key);
    if (!cur) return el;
    const nt = el.querySelectorAll(".t"); cur.querySelectorAll(".t").forEach((x, i) => { if (nt[i]) x.textContent = nt[i].textContent; });
    have.delete(el.dataset.key); return cur;
  });
  have.forEach((el) => el.remove());
  next.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] ?? null); });
  rows.forEach((r) => seen.add(`${r.nonce}:${r.pending ? 0 : 1}`));
  firstTrace = false;
}

// ------------------------------------------------------------------- wiring
const fieldErr = (field, msg) => Object.assign(new Error(msg), { field });
const addr = (a, name, field) => { if (!isAddr(a)) throw fieldErr(field, `${name} must be a 0x address with 40 hex characters.`); };
const amt = (x, name, positive = false, field) => { if (!/^\d+(\.\d{1,6})?$/.test(String(x).trim()) || (positive && !(Number(x) > 0))) throw fieldErr(field, `${name} must be a ${positive ? "positive " : ""}number with at most 6 decimals.`); };
const int = (x, name, min, field) => { if (!/^\d+$/.test(String(x).trim()) || Number(x) < min) throw fieldErr(field, `${name} must be a whole number ≥ ${min}.`); };
const TRUST = {
  funds: `<p class="muted">Non-custodial by design: your tUSD stays in your wallet. The vault holds only an ERC-20 allowance you set, and pulls with transferFrom(owner → payee) when a rule fires.</p>
    <div class="tgrid">
      <div class="tcard"><span class="num">01</span><h3>Capped allowance</h3><p>The vault can never move more than the allowance you approve (the demo approves 2,000 tUSD). Revoking it to 0 stops everything.</p></div>
      <div class="tcard"><span class="num">02</span><h3>Authenticated callbacks</h3><p>Rule execution only accepts calls from Reactive's callback proxy, carrying your FlowletReactive contract's id. Anyone else is rejected.</p></div>
      <div class="tcard"><span class="num">03</span><h3>Safety Guard</h3><p>A daily limit for standing orders trips a circuit breaker instead of overspending. An emergency reserve caps auto-save. No catch-up bursts after downtime.</p></div>
      <div class="tcard"><span class="num">04</span><h3>Pause, revoke, recover</h3><p>Pause all or revoke the allowance at any time. Revoking also makes the reactive contract pause itself. Rules, payees and limits are owner-only.</p></div>
    </div>
    <details class="manage"><summary>Implemented vs. roadmap</summary><div class="grid2 tight"><div><b>Implemented (testnet)</b><ul class="plain"><li>Owner-only rules, guard, pause and resume</li><li>Proxy + reactive-id check on every callback</li><li>Idempotent auto-save per origin log</li><li>Decision events tagged with the reactive nonce</li></ul></div><div><b>Roadmap</b><ul class="plain"><li>Per-payee allowlist caps</li><li>Multi-token vaults</li><li>External audit before any mainnet use</li></ul></div></div></details>
    <p class="small muted">Testnet software with automated and fuzz tests, but no external audit. Never use it with real funds.</p>`,
  privacy: `<p class="muted">Blockchains are public. Flowlet does not make payments private.</p><div class="grid2 tight"><div><b>Public, forever</b><ul class="plain"><li>Your wallet, payee and savings addresses</li><li>Rule amounts, intervals and run counts</li><li>Every transfer and every Decision event</li><li>Reactive transactions on Lasna</li></ul></div><div><b>Keep private</b><ul class="plain"><li>Don't reuse an address that is linked to your identity</li><li>Don't publish which address is your landlord's</li><li>Flowlet stores no names, emails or memos on-chain</li></ul></div></div>`,
};
function openTrust(kind) { $("trustTitle").textContent = kind === "privacy" ? "What's visible on-chain" : "How your funds are protected"; $("trustBody").innerHTML = TRUST[kind]; $("trust").showModal(); }
function bindForms() {
  $("trustBtn").onclick = () => openTrust("funds"); $("privacyBtn").onclick = () => openTrust("privacy");
  $("trustClose").onclick = () => $("trust").close(); $("trust").addEventListener("click", (e) => { if (e.target === $("trust")) $("trust").close(); });
  // Errors appear inline next to the form (and the field gets aria-invalid + focus), not only in the log.
  const f = (id, fn) => ($(id).onsubmit = (e) => {
    e.preventDefault();
    const form = e.target; const out = form.querySelector(".ferr"); const btn = e.submitter || form.querySelector("button:not([type=button])");
    out.hidden = true; out.textContent = "";
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    fn(Object.fromEntries(new FormData(form))).then(() => announce("Saved on-chain")).catch((err) => {
      log(err.message); out.textContent = err.message; out.hidden = false;
      const inp = err.field && form.elements[err.field]; if (inp) { inp.setAttribute("aria-invalid", "true"); inp.focus(); }
    }).finally(() => { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } });
  });
  f("fOrder", async (v) => { addr(v.payee, "Pay to", "payee"); amt(v.amount, "Amount", true, "amount"); int(v.interval, "Every", 1, "interval"); int(v.runs, "Times", 0, "runs"); return tx.order(v.payee.trim(), units(v.amount), Number(v.interval), Number(v.runs)); });
  f("fSave", async (v) => { addr(v.savings, "Savings address", "savings"); amt(v.min, "Minimum deposit", false, "min"); const pct = Number(v.pct); if (!(pct > 0 && pct <= 100)) throw fieldErr("pct", "Save (%) must be between 0 and 100."); return tx.save(v.savings.trim(), units(v.min), Math.round(pct * 100), true); });
  f("fGuard", async (v) => { amt(v.limit, "Daily limit", false, "limit"); amt(v.reserve, "Emergency reserve", false, "reserve"); return tx.guard(units(v.limit), units(v.reserve)); });
  f("fMint", async (v) => { amt(v.amount, "Amount", true, "amount"); return tx.mint(units(v.amount)); });
  $("saveOff").onclick = () => tx.save("0x0000000000000000000000000000000000000000", 0, 0, false).catch((e) => log(e.message));
  $("pauseBtn").onclick = () => { if (confirm("Pause every Flowlet rule? Nothing will move until you resume.")) tx.pause().catch((e) => log(e.message)); };
  $("resumeBtn").onclick = () => tx.resume().catch((e) => log(e.message));
  $("revokeBtn").onclick = () => { if (confirm("Revoke Flowlet's access? The reactive contract will pause itself and every rule.")) tx.approve(0n).catch((e) => log(e.message)); };
  $("approveBtn").onclick = () => tx.approve(2000n * 10n ** 6n).catch((e) => log(e.message));
  $("runDemo").onclick = runDemo;
  $("runBreaker").onclick = () => { if (confirm("Revoke Flowlet's allowance? The reactive contract will pause itself and the vault. You can allow and resume again afterwards.")) runBreaker(); };
  window.addEventListener("flowlet:runreplay", () => replayDemo("button"));
  document.querySelectorAll(".mini input").forEach((i) => i.addEventListener("input", () => i.removeAttribute("aria-invalid")));
}

async function tick() {
  try { await refreshState(); await refreshTrace(); } catch (e) { log("refresh: " + e.message); }
  setTimeout(tick, isLocal ? 2000 : 4000);
}

renderSteps();
bindForms();
loadConfig().then(tick).catch((e) => { $("netPill").textContent = "Not deployed"; $("netPill").className = "chains bad"; log(e.message); $("runDemo").disabled = true; });
