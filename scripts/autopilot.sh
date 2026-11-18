#!/usr/bin/env bash
# Tiny CLI for a deployed Reactive Autopilot.
#   scripts/autopilot.sh status
#   scripts/autopilot.sh order <payee> <amount_units> <interval_s> [max_runs]
#   scripts/autopilot.sh cancel <id>
#   scripts/autopilot.sh sweep <savings> <min_units> <bps>      # e.g. sweep 0xSav 100000000 2000
#   scripts/autopilot.sh sweep-off
#   scripts/autopilot.sh mint <to> <units>                      # MockUSD faucet
#   scripts/autopilot.sh cron fast|slow                         # Cron10 (~10s) or Cron100 (~100s)
. "$(dirname "$0")/env.sh"
TOKEN=$(jq -r .contracts.mockUSD "$DEPLOY_FILE"); VAULT=$(jq -r .contracts.autopilotVault "$DEPLOY_FILE")
RC=$(jq -r .contracts.autopilotReactive "$DEPLOY_FILE")
d() { cast send "$@" --rpc-url "$DEST_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash; }
l() { cast send "$@" --rpc-url "$LASNA_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash; }
case "${1:-status}" in
  status)
    n=$(cast call "$VAULT" "orderCount()(uint256)" --rpc-url "$DEST_RPC")
    echo "vault $VAULT  orders=$n  now=$(date +%s)"
    for ((i = 0; i < n; i++)); do
      echo "  #$i $(cast call "$VAULT" "getOrder(uint256)((address,address,uint128,uint64,uint64,uint32,uint32,uint8,bool))" $i --rpc-url "$DEST_RPC")"
    done
    echo "  sweep $(cast call "$VAULT" "sweepRule()(address,address,uint256,uint16,bool)" --rpc-url "$DEST_RPC" | tr '\n' ' ')"
    echo "reactive $RC"
    for f in ticks executionRequests sweepRequests cronSubscribed sweepSubscribed; do
      echo "  $f=$(cast call "$RC" "$f()(uint256)" --rpc-url "$LASNA_RPC" 2>/dev/null || cast call "$RC" "$f()(bool)" --rpc-url "$LASNA_RPC")"
    done
    echo "  reactive balance=$(cast from-wei "$(cast balance "$RC" --rpc-url "$LASNA_RPC")") lREACT  vault balance=$(cast from-wei "$(cast balance "$VAULT" --rpc-url "$DEST_RPC")") ETH";;
  order) d "$VAULT" "createOrder(address,address,uint128,uint64,uint64,uint32)" "$TOKEN" "$2" "$3" "$4" 0 "${5:-0}";;
  cancel) d "$VAULT" "cancelOrder(uint256)" "$2";;
  sweep) d "$VAULT" "configureSweep(address,address,uint256,uint16,bool)" "$TOKEN" "$2" "$3" "$4" true;;
  sweep-off) d "$VAULT" "configureSweep(address,address,uint256,uint16,bool)" 0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 0 0 false;;
  mint) d "$TOKEN" "mint(address,uint256)" "$2" "$3";;
  cron) l "$RC" "setCronTopic(uint256)" "$([ "$2" = fast ] && echo $CRON10 || echo $CRON100)";;
  *) sed -n '2,10p' "$0";;
esac
