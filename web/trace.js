// Flowlet execution trace builder. Shared by the dashboard (browser) and scripts/report.mjs (Node).
// Pure JSON-RPC, no dependencies. Every row is reconstructed from on-chain logs only:
//   origin event (destination) -> FlowRequested(nonce) on Reactive Lasna -> callback tx (destination)
//   -> Decision(nonce) rule evaluation -> token Transfer action, with latency for each leg.

export const TOPICS = {
  flowRequested: "0xa4ee71073fda2f5805a18c2fd636e387d39a28744655934badada7f015cd7a4f",
  decision: "0xe0e5a320ade0eec575be48782f059f491c1d6e08d83b0bc6e3318ede46589989",
  orderScheduled: "0xb1c3a8497f1205da18f02ad17204221c6c8bf084b683899c093c8ceed51eddbe",
  orderExecuted: "0x101d2461aacd1f55424dc24794a4f5e698037eeeabb7317c7c3b02fd710d4e71",
  transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  approval: "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  guardTripped: "0xbae3885f34b074cf54b714a0e2a6f03bddbee124176308a8877cf4af3e0b024b",
  orderClosed: "0x044bfef10661bc2f1f87760f6f53f1b8db59a04ddf6fa91825b132a26c46aa5c",
};

export const KIND = { 1: "Standing order", 2: "Auto-save", 3: "Safety Guard" };
export const REASON = {
  0: "Executed", 1: "Reserve override", 2: "Not due yet", 3: "Rule inactive", 4: "Paused by Safety Guard",
  5: "Daily limit reached", 6: "Transfer failed", 7: "Duplicate event", 8: "Below minimum", 9: "Unknown order",
  10: "Reserve protected", 11: "Mandate revoked", 12: "Manual pause",
};

export const EXPLORERS = {
  11155111: { tx: "https://sepolia.etherscan.io/tx/", addr: "https://sepolia.etherscan.io/address/" },
  84532: { tx: "https://sepolia.basescan.org/tx/", addr: "https://sepolia.basescan.org/address/" },
  1301: { tx: "https://sepolia.uniscan.xyz/tx/", addr: "https://sepolia.uniscan.xyz/address/" },
  lasna: { tx: "https://lasna.reactscan.net/tx/", addr: "https://lasna.reactscan.net/address/" },
};

const word = (data, i) => BigInt("0x" + data.slice(2 + 64 * i, 2 + 64 * (i + 1)));
const hex = (n) => "0x" + BigInt(n).toString(16);
const addrFromTopic = (t) => "0x" + t.slice(26);
export const fmtAmount = (v, decimals = 6) =>
  (Number(v) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "?");

export function makeRpc(url) {
  let id = 0;
  return async function rpc(method, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        });
        const j = await r.json();
        if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
        return j.result;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((s) => setTimeout(s, 700 * (attempt + 1)));
      }
    }
  };
}

/** Incremental log reader with block-range chunking and caches for blocks, txs and receipts. */
export class ChainReader {
  constructor(url, startBlock, chunk = 5000n) {
    this.rpc = makeRpc(url);
    this.next = BigInt(startBlock);
    this.chunk = BigInt(chunk);
    this.logs = [];
    this.blocks = new Map();
    this.txs = new Map();
    this.receipts = new Map();
  }
  async sync(filters) {
    const head = BigInt(await this.rpc("eth_blockNumber", []));
    for (let from = this.next; from <= head; from += this.chunk) {
      const to = from + this.chunk - 1n > head ? head : from + this.chunk - 1n;
      for (const f of filters) {
        const got = await this.rpc("eth_getLogs", [{ ...f, fromBlock: hex(from), toBlock: hex(to) }]);
        this.logs.push(...got);
      }
      this.next = to + 1n;
    }
    return this.logs;
  }
  async ts(blockHex) {
    if (!this.blocks.has(blockHex)) {
      const b = await this.rpc("eth_getBlockByNumber", [blockHex, false]);
      this.blocks.set(blockHex, Number(BigInt(b.timestamp)));
    }
    return this.blocks.get(blockHex);
  }
  async tx(hash) {
    if (!this.txs.has(hash)) this.txs.set(hash, await this.rpc("eth_getTransactionByHash", [hash]));
    return this.txs.get(hash);
  }
  async receipt(hash) {
    if (!this.receipts.has(hash)) this.receipts.set(hash, await this.rpc("eth_getTransactionReceipt", [hash]));
    return this.receipts.get(hash);
  }
}

export function explain(kind, d, ctx) {
  const amt = (v) => `${fmtAmount(v)} tUSD`;
  if (kind === 1) {
    if (d.reason === 0) return `Paid ${amt(d.executed)} to ${short(d.to)} (order #${d.ruleId}).`;
    if (d.reason === 5) return `Order #${d.ruleId} would exceed the daily limit, so the payment was held and the Safety Guard paused automation.`;
    if (d.reason === 2) return `Order #${d.ruleId} was not due yet on the destination clock, so nothing moved (harmless retry).`;
    return `Order #${d.ruleId}: ${REASON[d.reason] ?? d.reason}, nothing moved.`;
  }
  if (kind === 2) {
    const inc = ctx?.incoming != null ? ` of the ${amt(ctx.incoming)} deposit` : "";
    if (d.reason === 0) return `Saved ${amt(d.executed)}${inc} to ${short(d.to)}.`;
    if (d.reason === 1) return `Auto-save wanted ${amt(d.requested)}${inc}, but the emergency reserve rule overrides it: saved ${amt(d.executed)} so the wallet stays above its reserve.`;
    if (d.reason === 10) return `Auto-save wanted ${amt(d.requested)}, but the wallet is at its emergency reserve, so nothing was saved.`;
    return `Auto-save: ${REASON[d.reason] ?? d.reason}, nothing moved.`;
  }
  if (kind === 3) {
    if (d.reason === 11) return "The allowance was revoked. Reactive paused itself, dropped its CRON and deposit subscriptions, and paused the vault.";
    return `Safety Guard: ${REASON[d.reason] ?? d.reason}.`;
  }
  return "";
}

/**
 * Build the execution trace.
 * cfg: { destRpc, lasnaRpc, destChainId, vault, reactive, token, wallet, callbackProxy, startBlocks:{destination,lasna} }
 * state (optional): object returned by a previous call, for incremental polling.
 */
export async function buildTrace(cfg, state) {
  const s = state ?? {
    dest: new ChainReader(cfg.destRpc, cfg.startBlocks.destination, BigInt(cfg.logChunk ?? 5000)),
    lasna: new ChainReader(cfg.lasnaRpc, cfg.startBlocks.lasna, BigInt(cfg.logChunk ?? 5000)),
  };
  const [destLogs, lasnaLogs] = await Promise.all([
    s.dest.sync([{ address: cfg.vault }]),
    s.lasna.sync([{ address: cfg.reactive, topics: [TOPICS.flowRequested] }]),
  ]);

  // Due times of standing orders, replayed in chain order.
  const vaultLogs = destLogs
    .filter((l) => l.address.toLowerCase() === cfg.vault.toLowerCase())
    .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  const due = new Map(); // id -> [{due, setBy, block}]
  for (const l of vaultLogs) {
    if (l.topics[0] === TOPICS.orderScheduled) {
      const id = BigInt(l.topics[1]).toString();
      (due.get(id) ?? due.set(id, []).get(id)).push({ due: Number(word(l.data, 2)), setBy: l.transactionHash });
    } else if (l.topics[0] === TOPICS.orderExecuted) {
      const id = BigInt(l.topics[1]).toString();
      (due.get(id) ?? due.set(id, []).get(id)).push({ due: Number(word(l.data, 1)), setBy: l.transactionHash });
    }
  }

  const decisionsByNonce = new Map();
  for (const l of vaultLogs.filter((l) => l.topics[0] === TOPICS.decision)) {
    const nonce = BigInt(l.topics[1]).toString();
    const d = {
      kind: Number(BigInt(l.topics[2])),
      ruleId: BigInt(l.topics[3]).toString(),
      requested: word(l.data, 0),
      executed: word(l.data, 1),
      reason: Number(word(l.data, 2)),
      to: "0x" + l.data.slice(2 + 64 * 3 + 24, 2 + 64 * 4),
      tx: l.transactionHash,
      block: l.blockNumber,
    };
    (decisionsByNonce.get(nonce) ?? decisionsByNonce.set(nonce, []).get(nonce)).push(d);
  }

  const rows = [];
  for (const r of lasnaLogs) {
    const nonce = BigInt(r.topics[1]).toString();
    const kind = Number(BigInt(r.topics[2]));
    const originTx = r.topics[3];
    const value = word(r.data, 0);
    const n = Number(word(r.data, 2));
    const ids = Array.from({ length: n }, (_, i) => word(r.data, 3 + i).toString());
    const tReactive = await s.lasna.ts(r.blockNumber);
    const row = { nonce: Number(nonce), kind, kindLabel: KIND[kind], reactive: { tx: r.transactionHash, ts: tReactive } };

    // Origin leg
    if (kind === 1) {
      // CRON-driven: origin is the event that set the due time; the trigger is the CRON tick in this Lasna tx.
      const id = ids[0];
      const hist = due.get(id) ?? [];
      const prior = [...hist].reverse().find((h) => h.due <= tReactive) ?? hist[0];
      row.origin = prior
        ? { tx: prior.setBy, ts: prior.due, label: `Order #${id}${ids.length > 1 ? ` (+${ids.length - 1} more)` : ""} due`, isDueTime: true }
        : { label: `Order #${id} due` };
    } else if (originTx && BigInt(originTx) !== 0n) {
      const rc = await s.dest.receipt(originTx);
      const ts = rc ? await s.dest.ts(rc.blockNumber) : null;
      const label = kind === 2 ? `Deposit of ${fmtAmount(value)} tUSD` : "Allowance set to 0";
      row.origin = { tx: originTx, ts, label, block: rc?.blockNumber };
      if (kind === 2) row.incoming = value;
    }

    // Callback leg + rule evaluation + action
    const ds = decisionsByNonce.get(nonce) ?? [];
    if (ds.length) {
      const cbTx = ds[0].tx;
      const [tx, rc] = await Promise.all([s.dest.tx(cbTx), s.dest.receipt(cbTx)]);
      const ts = await s.dest.ts(ds[0].block);
      row.callback = {
        tx: cbTx, ts, from: tx?.from, to: tx?.to,
        viaProxy: !!(tx?.to && cfg.callbackProxy && tx.to.toLowerCase() === cfg.callbackProxy.toLowerCase()),
        sentByWallet: !!(tx?.from && cfg.wallet && tx.from.toLowerCase() === cfg.wallet.toLowerCase()),
      };
      row.decisions = ds.map((d) => ({ ...d, label: REASON[d.reason], text: explain(kind, d, row) }));
      row.actions = (rc?.logs ?? [])
        .filter((l) => l.address.toLowerCase() === cfg.token.toLowerCase() && l.topics[0] === TOPICS.transfer)
        .map((l) => ({ from: addrFromTopic(l.topics[1]), to: addrFromTopic(l.topics[2]), amount: BigInt(l.data) }));
      // Contract state before → after, derived from the callback receipt's own logs (no archive node needed):
      // OrderExecuted carries the new run count and due time; GuardTripped means the vault went from running to paused.
      row.change = [];
      const vlogs = (rc?.logs ?? []).filter((l) => l.address.toLowerCase() === cfg.vault.toLowerCase());
      for (const l of vlogs) {
        if (l.topics[0] === TOPICS.orderExecuted) {
          const id = BigInt(l.topics[1]).toString();
          const runs = Number(word(l.data, 0)), next = Number(word(l.data, 1));
          const hist = due.get(id) ?? []; const i = hist.findIndex((h) => h.setBy === cbTx);
          row.change.push({ what: `Order #${id} runs`, before: String(runs - 1), after: String(runs) });
          if (i > 0) row.change.push({ what: `Order #${id} next due`, before: hist[i - 1].due, after: next, time: true });
        } else if (l.topics[0] === TOPICS.orderClosed) {
          row.change.push({ what: `Order #${BigInt(l.topics[1])}`, before: "active", after: "finished" });
        } else if (l.topics[0] === TOPICS.guardTripped) {
          row.change.push({ what: "Vault", before: "running", after: `paused (${REASON[Number(BigInt(l.topics[1]))] ?? "guard"})` });
        }
      }
      for (const a of row.actions) {
        if (cfg.wallet && a.from.toLowerCase() === cfg.wallet.toLowerCase()) row.change.push({ what: "Your wallet", delta: -a.amount });
        row.change.push({ what: `Receiver ${short(a.to)}`, delta: a.amount });
      }
      row.latency = {
        originToReactive: row.origin?.ts != null ? tReactive - row.origin.ts : null,
        reactiveToCallback: ts - tReactive,
        total: row.origin?.ts != null ? ts - row.origin.ts : null,
      };
    } else {
      row.pending = true;
    }
    rows.push(row);
  }
  rows.sort((a, b) => b.nonce - a.nonce);
  return { rows, state: s };
}
