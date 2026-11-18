#!/usr/bin/env node
// Builds a full-loop evidence report from on-chain data only (no private key needed).
//   node scripts/report.mjs [deployments/base-sepolia.json]
// For every loop it prints: origin tx -> Lasna reactive tx -> destination callback tx, with timestamps and latency.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "deployments/base-sepolia.json";
const d = JSON.parse(readFileSync(file, "utf8"));
const CHUNK = BigInt(process.env.LOG_CHUNK ?? 5000);
const EXPLORER = {
  84532: "https://sepolia.basescan.org/tx/",
  1301: "https://sepolia.uniscan.xyz/tx/",
  lasna: "https://lasna.reactscan.net/tx/",
};

const T = {
  orderScheduled: "0x5429eba767781035ccea50f8df8fdeb34dd8b451cf7073f4e58e5c7bd726f5a0",
  orderExecuted: "0x101d2461aacd1f55424dc24794a4f5e698037eeeabb7317c7c3b02fd710d4e71",
  swept: "0xc7c994f93d24e1c2157cef47f65ebb85edf641798124b468baab0c6dc82e564b",
  executionRequested: "0xa035431aeeb004a320173b3a169b784e9af53983c3357062ac1df2287905aaa8",
  sweepRequested: "0x6c9c13bfede304c75d2d7d79b659fba907fac44c23cd4b1f1305fc6d31b60be1",
};

let rpcId = 0;
async function rpc(url, method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const j = await r.json();
    if (!j.error) return j.result;
    if (attempt === 3) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
    await new Promise((s) => setTimeout(s, 1000 * (attempt + 1)));
  }
}
const hex = (n) => "0x" + BigInt(n).toString(16);
const word = (data, i) => BigInt("0x" + data.slice(2 + 64 * i, 2 + 64 * (i + 1)));

async function logs(url, address, topic0, fromBlock) {
  const head = BigInt(await rpc(url, "eth_blockNumber", []));
  const out = [];
  for (let from = BigInt(fromBlock); from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    out.push(...(await rpc(url, "eth_getLogs", [{ address, topics: [topic0], fromBlock: hex(from), toBlock: hex(to) }])));
  }
  return out;
}
const tsCache = new Map();
async function ts(url, blockHex) {
  const k = url + blockHex;
  if (!tsCache.has(k)) tsCache.set(k, Number(BigInt((await rpc(url, "eth_getBlockByNumber", [blockHex, false])).timestamp)));
  return tsCache.get(k);
}
async function txBlock(url, hash) {
  const r = await rpc(url, "eth_getTransactionReceipt", [hash]);
  return r?.blockNumber;
}

const D = d.destinationRpc, L = d.lasnaRpc;
const { autopilotVault: vault, autopilotReactive: reactive } = d.contracts;
const [scheduled, executed, swept, execReq, sweepReq] = await Promise.all([
  logs(D, vault, T.orderScheduled, d.startBlocks.destination),
  logs(D, vault, T.orderExecuted, d.startBlocks.destination),
  logs(D, vault, T.swept, d.startBlocks.destination),
  logs(L, reactive, T.executionRequested, d.startBlocks.lasna),
  logs(L, reactive, T.sweepRequested, d.startBlocks.lasna),
]);

const isLocal = d.destination === "local";
if (isLocal) { EXPLORER.lasna = "#"; }
const destTx = isLocal ? "#" : EXPLORER[d.destinationChainId] ?? "";
const rows = [];

// --- auto-save sweeps: origin Transfer -> SweepRequested (Lasna) -> Swept (destination)
for (const s of swept) {
  const originHash = s.topics[2];
  const req = sweepReq.find((r) => r.topics[1] === originHash);
  const originBlock = await txBlock(D, originHash);
  const tOrigin = originBlock ? await ts(D, originBlock) : null;
  const tReq = req ? await ts(L, req.blockNumber) : null;
  const tCb = await ts(D, s.blockNumber);
  rows.push({
    loop: "auto-save sweep",
    origin: originHash, lasna: req?.transactionHash ?? "?", callback: s.transactionHash,
    originToLasna: tOrigin != null && tReq != null ? tReq - tOrigin : null,
    total: tOrigin != null ? tCb - tOrigin : null,
    blocks: originBlock ? Number(BigInt(s.blockNumber) - BigInt(originBlock)) : null,
  });
}

// --- standing orders: due time (from previous vault event) -> ExecutionRequested (Lasna CRON) -> OrderExecuted
const dueById = new Map();
for (const s of scheduled) dueById.set(BigInt(s.topics[1]), { due: Number(word(s.data, 2)), origin: s.transactionHash });
const timeline = [...executed].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)));
const reqs = await Promise.all(execReq.map(async (r) => {
  const n = Number(word(r.data, 1)); // array length (offset word 0)
  const ids = Array.from({ length: n }, (_, i) => word(r.data, 2 + i));
  return { ...r, ids, t: await ts(L, r.blockNumber) };
}));
for (const e of timeline) {
  const id = BigInt(e.topics[1]);
  const tCb = await ts(D, e.blockNumber);
  const prev = dueById.get(id);
  const req = reqs.filter((r) => r.ids.includes(id) && r.t <= tCb + 2).at(-1);
  rows.push({
    loop: `standing order #${id}`,
    origin: prev?.origin ?? "?", lasna: req?.transactionHash ?? "?", callback: e.transactionHash,
    originToLasna: req && prev ? req.t - prev.due : null, // CRON detection delay after due time
    total: prev ? tCb - prev.due : null, // due time -> paid
    blocks: null,
  });
  dueById.set(id, { due: Number(word(e.data, 1)), origin: e.transactionHash });
}

const fmt = (v) => (v == null ? "?" : `${v}s`);
let md = `# Full-loop evidence (${d.destination})\n\nGenerated ${new Date().toISOString()} from public RPCs.\n\n`;
md += `| Loop | Origin tx (${d.destination}) | Reactive tx (Lasna) | Callback tx (${d.destination}) | origin->Lasna | origin->callback |\n|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.loop} | [${r.origin.slice(0, 10)}…](${destTx}${r.origin}) | [${r.lasna.slice(0, 10)}…](${EXPLORER.lasna}${r.lasna}) | [${r.callback.slice(0, 10)}…](${destTx}${r.callback}) | ${fmt(r.originToLasna)} | ${fmt(r.total)} |\n`;
}
md += `\nFor standing orders, "origin" is the event that set the due time (OrderScheduled or the previous OrderExecuted) and latency is measured from the due timestamp, so it includes the CRON cadence.\n`;
md += `\nRaw:\n\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\`\n`;
const outFile = file.replace(/\.json$/, ".LOOP_REPORT.md");
writeFileSync(outFile, md);
console.log(md);
console.log(`written ${outFile}`);
