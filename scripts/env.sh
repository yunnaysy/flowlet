#!/usr/bin/env bash
# Shared configuration. Every value can be overridden from the environment or a local .env file.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
export PATH="$HOME/.foundry/bin:$PATH"

# Key file: KEY=VALUE lines with PRIVATE_KEY=0x... (never commit it; it is git-ignored).
DEPLOYER_SECRET_FILE="${DEPLOYER_SECRET_FILE:-$ROOT/DEPLOYER_SECRET.txt}"
if [ -z "${PRIVATE_KEY:-}" ]; then
  [ -f "$DEPLOYER_SECRET_FILE" ] || { echo "missing $DEPLOYER_SECRET_FILE (or PRIVATE_KEY env)"; exit 1; }
  PRIVATE_KEY="$(grep '^PRIVATE_KEY=' "$DEPLOYER_SECRET_FILE" | cut -d= -f2)"
fi
export PRIVATE_KEY
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"

# Reactive Lasna testnet (https://dev.reactive.network/reactive-mainnet)
LASNA_RPC="${LASNA_RPC:-https://lasna-rpc.rnk.dev/}"
LASNA_CHAIN_ID="${LASNA_CHAIN_ID:-5318007}"

# Destination chain. Defaults to Base Sepolia; for Unichain Sepolia use
#   DEST_RPC=https://sepolia.unichain.org DEST_CHAIN_ID=1301 DEST_PROXY=0x775c9B990ADe401060B78D0e98684eEf8d2466C1
DEST_NAME="${DEST_NAME:-base-sepolia}"
DEST_RPC="${DEST_RPC:-https://sepolia.base.org}"
DEST_CHAIN_ID="${DEST_CHAIN_ID:-84532}"
DEST_PROXY="${DEST_PROXY:-0x476F44b11F5C942c58f4c8E3d0300E5710743585}"

# Lasna faucet contract living on the destination chain (Base Sepolia). 1 ETH -> 100 lREACT, max 5 ETH/tx.
LREACT_FAUCET="${LREACT_FAUCET:-0x2afaFD298b23b62760711756088F75B7409f5967}"

# CRON topics (legacy system contract 0x...fffFfF on Reactive)
CRON10=0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687
CRON100=0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70
CRON_TOPIC="${CRON_TOPIC:-$CRON10}"

# Funding (testnet units)
REACTIVE_FUNDING="${REACTIVE_FUNDING:-2ether}"   # lREACT sent to the reactive contract for reactive txs
VAULT_FUNDING="${VAULT_FUNDING:-0.002ether}"      # destination ETH sent to the vault for callback gas

DEPLOY_FILE="${DEPLOY_FILE:-$ROOT/deployments/$DEST_NAME.json}"

# Safety rail: refuse anything that looks like a mainnet.
for cid in "$LASNA_CHAIN_ID" "$DEST_CHAIN_ID"; do
  case "$cid" in 1|10|56|130|137|1597|8453|42161|43114|999|4663) echo "refusing mainnet chain id $cid"; exit 1;; esac
done
