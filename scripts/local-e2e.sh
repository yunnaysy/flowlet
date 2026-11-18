#!/usr/bin/env bash
# Headless rehearsal: local stack + scripts/demo.sh + report. Exits non-zero if the expected outcome is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.foundry/bin:$PATH"
rm -f /tmp/flowlet-local.ready
scripts/local-stack.sh >/tmp/flowlet-stack.log 2>&1 & STACK=$!
trap 'kill $STACK 2>/dev/null; pkill -f "anvil --port 1854" 2>/dev/null; pkill -f "http.server ${WEB_PORT:-8000}" 2>/dev/null; true' EXIT
for _ in $(seq 1 60); do [ -f /tmp/flowlet-local.ready ] && break; sleep 1; done
D=http://127.0.0.1:18545; L=http://127.0.0.1:18546
export NETWORK=eth-sepolia PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 DEST_RPC=$D LASNA_RPC=$L DEST_NAME=local DEPLOY_FILE=$ROOT/deployments/local.json
REVOKE_AFTER=${REVOKE_AFTER:-150} scripts/demo.sh
sleep 5
TOKEN=$(jq -r .contracts.mockUSD $DEPLOY_FILE); RC=$(jq -r .contracts.flowletReactive $DEPLOY_FILE)
bal() { cast call $TOKEN 'balanceOf(address)(uint256)' $1 --rpc-url $D | awk '{print $1}'; }
PAID=$(bal 0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d); SAVED=$(bal 0x5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e)
echo "landlord received: $PAID   savings received: $SAVED"
echo "reactive paused=$(cast call $RC 'paused()(bool)' --rpc-url $L) cron=$(cast call $RC 'cronSubscribed()(bool)' --rpc-url $L) deposits=$(cast call $RC 'depositWatch()(bool)' --rpc-url $L)"
LOG_CHUNK=2000 node scripts/report.mjs $DEPLOY_FILE
[ "$PAID" -ge 25000000 ] && [ "$SAVED" -gt 0 ] && [ "$SAVED" -lt 200000000 ] && [ "$(cast call $RC 'paused()(bool)' --rpc-url $L)" = true ] \
  && echo "LOCAL E2E: OK" || { echo "LOCAL E2E: UNEXPECTED RESULT"; exit 1; }
