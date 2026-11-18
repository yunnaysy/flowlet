#!/usr/bin/env node
// Snapshot of the real reactive loops, read from public RPCs only (no key, no transactions).
// The web app uses it as a clearly labelled fallback when live log reads fail, and for the no-wallet demo replay.
//   node scripts/snapshot-loops.mjs [deployments/eth-sepolia.json]
import { readFileSync, writeFileSync } from "node:fs";
import { buildTrace, EXPLORERS } from "../web/trace.js";

const file = process.argv[2] ?? "deployments/eth-sepolia.json";
const d = JSON.parse(readFileSync(file, "utf8"));
const cfg = {
  destRpc: d.destinationRpc, lasnaRpc: d.lasnaRpc, destChainId: d.destinationChainId,
  vault: d.contracts.flowletVault, reactive: d.contracts.flowletReactive, token: d.contracts.mockUSD,
  wallet: d.wallet, callbackProxy: d.callbackProxy, startBlocks: d.startBlocks, logChunk: process.env.LOG_CHUNK ?? 5000,
};
const { rows } = await buildTrace(cfg);
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const setup = Object.fromEntries(readFileSync(file.replace(/\.json$/, ".demo-txs.txt"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/)));
const out = { network: d.destination, chainId: d.destinationChainId, recordedAt: new Date().toISOString(), explorers: { dest: EXPLORERS[d.destinationChainId], lasna: EXPLORERS.lasna }, setup, rows };
writeFileSync("web/recorded-loops.json", JSON.stringify(out, big, 1) + "\n");
console.log(`web/recorded-loops.json: ${rows.length} loops, ${Object.keys(setup).length} setup txs`);
