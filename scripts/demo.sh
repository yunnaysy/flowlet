#!/usr/bin/env bash
# Flowlet demo on testnet (after deploy.sh). Same story as the dashboard's RUN DEMO button:
#   1. mandate: mint + approve      2. Safety Guard: emergency reserve      3. rent: 25 tUSD every 60s x3
#   4. auto-save 20% of deposits >= 100   5. salary 1,000 lands   6. later: allowance revoked -> circuit breaker
. "$(dirname "$0")/env.sh"
cd "$ROOT"
TOKEN=$(jq -r .contracts.mockUSD "$DEPLOY_FILE"); VAULT=$(jq -r .contracts.flowletVault "$DEPLOY_FILE")
RC=$(jq -r .contracts.flowletReactive "$DEPLOY_FILE")
LANDLORD="${LANDLORD:-0x1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d1a4d}"
SAVINGS="${SAVINGS:-0x5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e5a7e}"
REVOKE_AFTER="${REVOKE_AFTER:-90}"
send() { cast send "$@" --rpc-url "$DEST_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash; }
LOG="$ROOT/deployments/$DEST_NAME.demo-txs.txt"; : > "$LOG"
note() { echo "$1 $2" | tee -a "$LOG"; }
wait_for() { # wait until a view on the reactive contract returns true
  for _ in $(seq 1 30); do [ "$(cast call "$RC" "$1()(bool)" --rpc-url "$LASNA_RPC")" = true ] && return 0; sleep 2; done
  echo "warning: $1 still false on Lasna"
}

note mint_start "$(send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 5000000000)"
BAL=$(cast call "$TOKEN" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$DEST_RPC" | awk '{print $1}')
note approve_mandate "$(send "$TOKEN" "approve(address,uint256)" "$VAULT" 2000000000)"
# Re-runs: if a previous demo tripped the Safety Guard, resume (the reactive contract mirrors it).
if [ "$(cast call "$VAULT" "guard()(uint256,uint256,uint256,uint64,bool,uint8)" --rpc-url "$DEST_RPC" | sed -n 5p)" = true ]; then
  note resume "$(send "$VAULT" "resume()")"
  for _ in $(seq 1 30); do [ "$(cast call "$RC" "paused()(bool)" --rpc-url "$LASNA_RPC")" = false ] && break; sleep 2; done
fi
# Reserve = balance + salary - rent - 100, so auto-save is visibly capped by the reserve rule.
RESERVE=$((BAL + 1000000000 - 25000000 - 100000000))
note configure_guard "$(send "$VAULT" "configureGuard(uint256,uint256)" 500000000 "$RESERVE")"
note create_order "$(send "$VAULT" "createOrder(address,uint128,uint64,uint64,uint32)" "$LANDLORD" 25000000 60 0 3)"
note configure_sweep "$(send "$VAULT" "configureSweep(address,uint256,uint16,bool)" "$SAVINGS" 100000000 2000 true)"
echo "waiting for Lasna to start watching deposits..."; wait_for depositWatch
note salary_deposit "$(send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 1000000000)"
echo "letting rent + auto-save run for ${REVOKE_AFTER}s..."; sleep "$REVOKE_AFTER"
note revoke_mandate "$(send "$TOKEN" "approve(address,uint256)" "$VAULT" 0)"
wait_for paused && echo "Safety Guard tripped on Lasna (paused=true)."
echo "Done. Build the evidence table with: node scripts/report.mjs $DEPLOY_FILE"
