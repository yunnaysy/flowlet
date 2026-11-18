import { buildTrace, makeRpc, EXPLORERS, REASON, fmtAmount } from "./trace.js";

const $ = (id) => document.getElementById(id);
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
  $("netPill").textContent = isLocal ? "Local rehearsal · anvil" : `${d.destination} + Reactive Lasna · testnet`;
  $("netPill").className = "pill " + (isLocal ? "warn" : "soft");
  $("connectBtn").hidden = isLocal;
  const dx = isLocal ? null : EXPLORERS[d.destinationChainId], lx = isLocal ? null : EXPLORERS.lasna;
  const a = (base, addr) => (base ? `<a href="${esc(base.addr + addr)}" target="_blank" rel="noopener">${esc(short(addr))}</a>` : `<code>${esc(short(addr))}</code>`);
  $("footer").innerHTML = `Vault ${a(dx, cfg.vault)} · Reactive contract ${a(lx, cfg.reactive)} · tUSD ${a(dx, cfg.token)} · Callback proxy ${a(dx, cfg.callbackProxy)}<br/>Flowlet is open source. Testnet only.`;
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
  ["Give Flowlet a 2,000 tUSD mandate", async () => {
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
function renderSteps(state = {}) {
  $("demoSteps").innerHTML = DEMO.map(([label], i) => {
    const st = state[i] ?? "";
    const dot = st === "run" ? `<span class="dm" aria-hidden="true">${"<i></i>".repeat(9)}</span>` : st === "done" ? "✓" : st === "err" ? "!" : String(i + 1).padStart(2, "0");
    return `<li class="${st}"${st === "run" ? ' aria-current="step"' : ""}><span class="dot">${dot}</span>${esc(label)}</li>`;
  }).join("");
}
async function runDemo() {
  const btn = $("runDemo"); btn.disabled = true; btn.classList.remove("done"); btn.classList.add("running"); btn.textContent = "Running… watch the proof below";
  const state = {}; const ctx = {};
  try {
    for (let i = 0; i < DEMO.length; i++) {
      state[i] = "run"; renderSteps(state);
      await DEMO[i][1](ctx);
      state[i] = "done"; renderSteps(state);
      $("demoCount").textContent = `${i + 1} / ${DEMO.length}`;
    }
    btn.classList.remove("running"); btn.classList.add("done");
    btn.textContent = "✓ Demo complete · rules ran on their own";
    log("Demo complete. Every transfer above was executed by a Reactive callback, not by this page.");
  } catch (e) {
    const i = Object.keys(state).find((k) => state[k] === "run"); if (i != null) state[i] = "err"; renderSteps(state);
    log("demo stopped: " + e.message); btn.classList.remove("running"); btn.textContent = "▶ RUN DEMO"; btn.disabled = false;
  }
}

// ------------------------------------------------------------------ rendering
function stat(k, v, s, cls) { return `<div class="stat ${cls}" data-k="${esc(k)}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`; }
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
    stat("Wallet balance", `${fmtAmount(bal)}`, "tUSD, stays in your wallet", "sky") +
    stat("Saved", fmtAmount(saved), "tUSD moved to savings", "mint") +
    stat("Rent paid", fmtAmount(paid), "tUSD to the landlord", "peach") +
    stat("Flowlet mandate", allowance !== 0n ? fmtAmount(allowance) : revoked ? "Revoked" : "None", allowance !== 0n ? "tUSD it may still move" : revoked ? "nothing can move" : "no access granted yet", allowance === 0n && revoked ? "rose" : "lilac"));

  const sub = (name, on, desc) => `<li><span><b>${esc(name)}</b><br/><small>${esc(desc)}</small></span><span class="switch ${on ? "on" : ""}" role="img" aria-label="${on ? "on" : "off"}"></span></li>`;
  $("subs").innerHTML =
    sub("Vault rules", true, "Mirrors every rule from the vault's own events") +
    sub("Mandate watch", true, "Approval(you → vault): the circuit breaker's trigger") +
    sub("CRON clock", cron, cron ? "Ticking because a standing order is active" : "Off: nothing scheduled or paused (costs nothing)") +
    sub("Deposit watch", dep, dep ? "Transfer(→ your wallet) for auto-save" : "Off: auto-save disabled or paused") +
    `<li><span><b>Callbacks requested</b></span><span class="count">${nonce}</span></li><li><span><b>CRON ticks seen</b></span><span class="count">${ticks}</span></li>`;

  const remTxt = guard.limit === 0n ? "no daily limit" : `${fmtAmount(rem)} of ${fmtAmount(guard.limit)} tUSD left today`;
  $("guardBox").innerHTML = `
    <p><span class="pill ${guard.paused || rPaused ? "bad" : "soft"}">${guard.paused || rPaused ? "Paused · " + esc(REASON[guard.reason] ?? "") : "● Watching"}</span></p>
    <ul class="subs">
      <li><span><b>Daily payment limit</b><br/><small class="muted">${esc(remTxt)}</small></span></li>
      <li><span><b>Emergency reserve</b><br/><small class="muted">Auto-save never takes your wallet below ${fmtAmount(guard.reserve)} tUSD. This rule overrides the auto-save %.</small></span></li>
      <li><span><b>Revoke = stop</b><br/><small class="muted">Setting the allowance to 0 makes the reactive contract pause itself and the vault.</small></span></li>
    </ul>`;

  const cell = (k, v, sub) => `<div><small>${esc(k)}</small><b>${esc(v)}</b><span class="small muted">${esc(sub)}</span></div>`;
  $("fundGrid").innerHTML =
    cell("In your wallet", `${fmtAmount(bal)} tUSD`, "Flowlet never holds a deposit") +
    cell("Flowlet may move at most", allowance === 0n ? (revoked ? "0 · revoked" : "0 · not granted") : `${fmtAmount(allowance)} tUSD`, "your ERC-20 allowance to the vault") +
    cell("Left today", guard.limit === 0n ? "no limit" : `${fmtAmount(rem)} tUSD`, "standing orders, Safety Guard") +
    cell("Emergency reserve", `${fmtAmount(guard.reserve)} tUSD`, "auto-save never goes below");
  let rows = "";
  for (let i = 0; i < n; i++) {
    const o = await call(destRpc, cfg.vault, SEL.getOrder + E.u(i));
    const ord = { payee: addrAt(o, 0), amount: word(o, 1), interval: Number(word(o, 2)), nextDue: Number(word(o, 3)), runs: Number(word(o, 4)), max: Number(word(o, 5)), active: word(o, 7) === 1n };
    const due = ord.nextDue - Math.floor(Date.now() / 1000);
    rows += `<tr><td><span class="tag peach">⌂</span> #${i}</td><td>${esc(fmtAmount(ord.amount))} tUSD → <code>${esc(short(ord.payee))}</code></td><td>every ${ord.interval}s</td>
      <td>${ord.active ? (due > 0 ? `next in ${due}s` : "due now") : "finished"}</td><td>${ord.runs}${ord.max ? "/" + ord.max : ""} runs</td>
      <td>${ord.active ? `<button class="btn ghost small" data-cancel="${i}">Cancel</button>` : ""}</td></tr>`;
  }
  $("rules").innerHTML = `<table><tr><th>Rule</th><th>What</th><th>When</th><th>Status</th><th>Progress</th><th></th></tr>${rows}
    <tr><td><span class="tag mint">❀</span> Auto-save</td><td>${sw.on ? `${sw.bps / 100}% of deposits ≥ ${esc(fmtAmount(sw.min))} → <code>${esc(short(sw.savings))}</code>` : "off"}</td><td>on every deposit</td><td>${sw.on ? "on" : "off"}</td><td></td><td></td></tr></table>`;
  document.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => { if (confirm(`Cancel standing order #${b.dataset.cancel}?`)) tx.cancel(b.dataset.cancel).catch((e) => log(e.message)); }));
}

function legHtml(title, cls, body) { return `<div class="leg ${cls}"><b>${esc(title)}</b>${body}</div>`; }
function hashLink(base, h) { return h ? (base ? `<a class="h" href="${esc(base.tx + h)}" target="_blank" rel="noopener">${esc(short(h))}</a>` : `<span class="h">${esc(short(h))}</span>`) : "–"; }
const seen = new Set(); let firstTrace = true; let lastTraceHtml = "";

async function refreshTrace() {
  const { rows, state } = await buildTrace(cfg, traceState);
  traceState = state;
  $("traceStatus").textContent = `● ${rows.length} reactive loop${rows.length === 1 ? "" : "s"} · live`;
  if (!rows.length) return;
  const fresh = new Set(rows.filter((r) => !seen.has(`${r.nonce}:${r.pending ? 0 : 1}`) && !firstTrace).map((r) => r.nonce));
  const dx = isLocal ? null : EXPLORERS[d.destinationChainId], lx = isLocal ? null : EXPLORERS.lasna;
  const htmls = rows.map((r) => {
    const dec = r.decisions ?? [];
    const okAny = dec.some((x) => x.executed > 0n);
    const moved = (r.actions ?? []).map((a) => `${esc(fmtAmount(a.amount))} tUSD → ${esc(short(a.to))}`).join("<br/>");
    const icon = r.kind === 1 ? "⌂" : r.kind === 2 ? "❀" : "◈";
    return `<article class="trace kind-${Number(r.kind)}${fresh.has(r.nonce) ? " fresh" : ""}" data-key="${esc(`${r.nonce}:${r.pending ? 0 : 1}`)}">
      <div class="trace-head"><span class="title"><span class="glyph" aria-hidden="true">${icon}</span>#${esc(r.nonce)} · ${esc(r.kindLabel)}</span>
        <span class="pill ${r.pending ? "warn" : dec.some((x) => x.reason === 11 || x.reason === 5) ? "bad" : "soft"}">${r.pending ? `<span class="dm" aria-hidden="true">${"<i></i>".repeat(9)}</span> callback in flight…` : esc(dec.map((x) => x.label).join(", "))}</span></div>
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
        ${r.callback ? (r.callback.viaProxy && !r.callback.sentByWallet ? `<span class="badge proof">✓ sent by Reactive's callback proxy, not by you or this page</span>` : `<span class="badge warn">callback sender not verified</span>`) : ""}
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
const addr = (a, name) => { if (!isAddr(a)) throw new Error(`${name} must be a 0x address with 40 hex characters.`); };
const amt = (x, name, positive = false) => { if (!/^\d+(\.\d{1,6})?$/.test(String(x).trim()) || (positive && !(Number(x) > 0))) throw new Error(`${name} must be a ${positive ? "positive " : ""}number with at most 6 decimals.`); };
const int = (x, name, min) => { if (!/^\d+$/.test(String(x).trim()) || Number(x) < min) throw new Error(`${name} must be a whole number ≥ ${min}.`); };
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
  const f = (id, fn) => ($(id).onsubmit = (e) => { e.preventDefault(); fn(Object.fromEntries(new FormData(e.target))).catch((err) => log(err.message)); });
  f("fOrder", async (v) => { addr(v.payee, "Pay to"); amt(v.amount, "Amount", true); int(v.interval, "Every", 1); int(v.runs, "Times", 0); return tx.order(v.payee.trim(), units(v.amount), Number(v.interval), Number(v.runs)); });
  f("fSave", async (v) => { addr(v.savings, "Savings address"); amt(v.min, "Minimum deposit"); const pct = Number(v.pct); if (!(pct > 0 && pct <= 100)) throw new Error("Save (%) must be between 0 and 100."); return tx.save(v.savings.trim(), units(v.min), Math.round(pct * 100), true); });
  f("fGuard", async (v) => { amt(v.limit, "Daily limit"); amt(v.reserve, "Emergency reserve"); return tx.guard(units(v.limit), units(v.reserve)); });
  f("fMint", async (v) => { amt(v.amount, "Amount", true); return tx.mint(units(v.amount)); });
  $("saveOff").onclick = () => tx.save("0x0000000000000000000000000000000000000000", 0, 0, false).catch((e) => log(e.message));
  $("pauseBtn").onclick = () => { if (confirm("Pause every Flowlet rule? Nothing will move until you resume.")) tx.pause().catch((e) => log(e.message)); };
  $("resumeBtn").onclick = () => tx.resume().catch((e) => log(e.message));
  $("revokeBtn").onclick = () => { if (confirm("Revoke Flowlet's access? The reactive contract will pause itself and every rule.")) tx.approve(0n).catch((e) => log(e.message)); };
  $("approveBtn").onclick = () => tx.approve(2000n * 10n ** 6n).catch((e) => log(e.message));
  $("runDemo").onclick = runDemo;
  $("connectBtn").onclick = async () => { const [a] = await ethereum.request({ method: "eth_requestAccounts" }); $("connectBtn").textContent = short(a); };
  document.querySelectorAll(".mini input").forEach((i) => i.addEventListener("input", () => i.removeAttribute("aria-invalid")));
}

async function tick() {
  try { await refreshState(); await refreshTrace(); } catch (e) { log("refresh: " + e.message); }
  setTimeout(tick, isLocal ? 2000 : 4000);
}

renderSteps();
bindForms();
loadConfig().then(tick).catch((e) => { $("netPill").textContent = "Not deployed"; $("netPill").className = "pill bad"; log(e.message); $("runDemo").disabled = true; });
