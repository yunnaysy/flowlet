#!/usr/bin/env bash
# Flowlet CLI for a deployed instance (reads deployments/<dest>.json).
#   scripts/flowlet.sh status
#   scripts/flowlet.sh order <payee> <amount_units> <interval_s> [max_runs]
#   scripts/flowlet.sh cancel <id>
#   scripts/flowlet.sh save <savings> <min_units> <bps>   |  save-off
#   scripts/flowlet.sh guard <daily_limit_units> <reserve_units>
#   scripts/flowlet.sh pause | resume | revoke | approve <units>
#   scripts/flowlet.sh mint <to> <units>                  # MockUSD faucet
#   scripts/flowlet.sh cron fast|slow                     # Cron10 (~10s) or Cron100 (~100s)
. "$(dirname "$0")/env.sh"
TOKEN=$(jq -r .contracts.mockUSD "$DEPLOY_FILE"); VAULT=$(jq -r .contracts.flowletVault "$DEPLOY_FILE")
RC=$(jq -r .contracts.flowletReactive "$DEPLOY_FILE")
d() { cast send "$@" --rpc-url "$DEST_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash; }
l() { cast send "$@" --rpc-url "$LASNA_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash; }
case "${1:-status}" in
  status)
    n=$(cast call "$VAULT" "orderCount()(uint256)" --rpc-url "$DEST_RPC")
    echo "vault $VAULT  orders=$n  now=$(date +%s)"
    for ((i = 0; i < n; i++)); do
      echo "  #$i $(cast call "$VAULT" "getOrder(uint256)((address,uint128,uint64,uint64,uint32,uint32,uint8,bool))" $i --rpc-url "$DEST_RPC")"
    done
    echo "  auto-save $(cast call "$VAULT" "sweepRule()(address,uint256,uint16,bool)" --rpc-url "$DEST_RPC" | tr '\n' ' ')"
    echo "  guard     $(cast call "$VAULT" "guard()(uint256,uint256,uint256,uint64,bool,uint8)" --rpc-url "$DEST_RPC" | tr '\n' ' ')"
    echo "reactive $RC"
    for f in paused cronSubscribed depositWatch; do echo "  $f=$(cast call "$RC" "$f()(bool)" --rpc-url "$LASNA_RPC")"; done
    for f in nonce ticks; do echo "  $f=$(cast call "$RC" "$f()(uint256)" --rpc-url "$LASNA_RPC")"; done
    echo "  balances: reactive=$(cast from-wei "$(cast balance "$RC" --rpc-url "$LASNA_RPC")") lREACT  vault=$(cast from-wei "$(cast balance "$VAULT" --rpc-url "$DEST_RPC")") ETH";;
  order) d "$VAULT" "createOrder(address,uint128,uint64,uint64,uint32)" "$2" "$3" "$4" 0 "${5:-0}";;
  cancel) d "$VAULT" "cancelOrder(uint256)" "$2";;
  save) d "$VAULT" "configureSweep(address,uint256,uint16,bool)" "$2" "$3" "$4" true;;
  save-off) d "$VAULT" "configureSweep(address,uint256,uint16,bool)" 0x0000000000000000000000000000000000000000 0 0 false;;
  guard) d "$VAULT" "configureGuard(uint256,uint256)" "$2" "$3";;
  pause) d "$VAULT" "pause()";;
  resume) d "$VAULT" "resume()";;
  revoke) d "$TOKEN" "approve(address,uint256)" "$VAULT" 0;;
  approve) d "$TOKEN" "approve(address,uint256)" "$VAULT" "$2";;
  mint) d "$TOKEN" "mint(address,uint256)" "$2" "$3";;
  cron) l "$RC" "setCronTopic(uint256)" "$([ "$2" = fast ] && echo $CRON10 || echo $CRON100)";;
  *) sed -n '2,11p' "$0";;
esac
