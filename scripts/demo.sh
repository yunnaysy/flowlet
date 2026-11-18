#!/usr/bin/env bash
# Drives the full loop on testnet after deploy.sh:
#   standing order: createOrder (origin event) -> Lasna react() mirrors it -> CRON tick -> executeDue() callback
#   auto-save:      configureSweep -> Lasna subscribes to Transfer(to=wallet) -> "salary" mint -> sweep() callback
. "$(dirname "$0")/env.sh"
cd "$ROOT"
TOKEN=$(jq -r .contracts.mockUSD "$DEPLOY_FILE"); VAULT=$(jq -r .contracts.autopilotVault "$DEPLOY_FILE")
PAYEE="${PAYEE:-0x000000000000000000000000000000000000dEaD}"
SAVINGS="${SAVINGS:-0x5A7e000000000000000000000000000000005a7E}"
send() { cast send "$@" --rpc-url "$DEST_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash; }
LOG="$ROOT/deployments/$DEST_NAME.demo-txs.txt"; : > "$LOG"
note() { echo "$1 $2" | tee -a "$LOG"; }

note mint_start      "$(send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 5000000000)"
note approve         "$(send "$TOKEN" "approve(address,uint256)" "$VAULT" 2000000000)"
# Pay 25 tUSD to PAYEE every 60s, 3 times.
note create_order    "$(send "$VAULT" "createOrder(address,address,uint128,uint64,uint64,uint32)" "$TOKEN" "$PAYEE" 25000000 60 0 3)"
# Save 20% of every deposit >= 100 tUSD.
note configure_sweep "$(send "$VAULT" "configureSweep(address,address,uint256,uint16,bool)" "$TOKEN" "$SAVINGS" 100000000 2000 true)"
echo "waiting 20s so Lasna can mirror the sweep rule and subscribe to Transfer events..."; sleep 20
note salary_deposit  "$(send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 1000000000)"
echo "Now wait ~3-4 minutes, then run: node scripts/report.mjs"
