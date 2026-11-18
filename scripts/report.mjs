#!/usr/bin/env node
// Full-loop evidence report from RPC data only (no private key).
//   node scripts/report.mjs [deployments/eth-sepolia.json]
// Writes deployments/<name>.LOOP_REPORT.md with: origin tx -> Lasna reactive tx -> callback tx -> decision -> transfer.
import { readFileSync, writeFileSync } from "node:fs";
import { buildTrace, EXPLORERS, fmtAmount } from "../web/trace.js";

const file = process.argv[2] ?? "deployments/eth-sepolia.json";
const d = JSON.parse(readFileSync(file, "utf8"));
const cfg = {
  destRpc: d.destinationRpc, lasnaRpc: d.lasnaRpc, destChainId: d.destinationChainId,
  vault: d.contracts.flowletVault, reactive: d.contracts.flowletReactive, token: d.contracts.mockUSD,
  wallet: d.wallet, callbackProxy: d.callbackProxy, startBlocks: d.startBlocks, logChunk: process.env.LOG_CHUNK ?? 5000,
};
const { rows } = await buildTrace(cfg);
const local = d.destination === "local";
const dx = local ? null : EXPLORERS[d.destinationChainId];
const link = (base, h) => (h ? (base ? `[${h.slice(0, 10)}…](${base.tx}${h})` : `\`${h.slice(0, 10)}…\``) : "–");
const s = (v) => (v == null ? "–" : `${v}s`);

let md = `# Flowlet – full-loop evidence (${d.destination})\n\nGenerated ${new Date().toISOString()} from RPC data.\n\n`;
md += `| Nonce | Rule | Origin (${d.destination}) | Reactive tx (Lasna) | Callback tx (${d.destination}) | Via callback proxy | Decision | Moved | origin→Lasna | origin→callback |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of [...rows].reverse()) {
  const dec = (r.decisions ?? []).map((x) => x.label).join(", ") || "pending";
  const moved = (r.actions ?? []).map((a) => fmtAmount(a.amount)).join(" + ") || "0";
  md += `| ${r.nonce} | ${r.kindLabel} | ${r.origin?.label ?? ""} ${link(dx, r.origin?.tx)} | ${link(local ? null : EXPLORERS.lasna, r.reactive.tx)} | ${link(dx, r.callback?.tx)} | ${r.callback ? (r.callback.viaProxy ? "yes" : "NO") : "–"} | ${dec} | ${moved} | ${s(r.latency?.originToReactive)} | ${s(r.latency?.total)} |\n`;
}
md += `\n## What happened\n\n`;
for (const r of [...rows].reverse()) for (const x of r.decisions ?? []) md += `- **#${r.nonce} ${r.kindLabel}:** ${x.text}\n`;
md += `\nFor standing orders the origin is the transaction that set the due time, and latency is measured from the due timestamp (it includes the CRON cadence).\n`;
const out = file.replace(/\.json$/, ".LOOP_REPORT.md");
writeFileSync(out, md);
console.log(md);
console.log(`written ${out}`);
