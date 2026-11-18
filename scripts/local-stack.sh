#!/usr/bin/env bash
# Local Flowlet stack for development, UI work and recording without testnet funds:
#   - anvil "Ethereum Sepolia" (chain 11155111, :18545) and anvil "Lasna" (chain 5318007, :18546)
#   - MockSystem at 0x8888…8 on the Lasna anvil, MockCallbackProxy on the destination anvil
#   - deploy.sh against both, then a relayer loop that plays Reactive Network:
#       forwards destination logs into react() (impersonating the system contract), fires CRON ticks,
#       and delivers requested callbacks through the mock proxy
#   - serves the dashboard at http://localhost:8000/web/?net=local
# Uses anvil's public dev key only. Ctrl-C stops everything.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.foundry/bin:$PATH"
SYS=0x8888888888888888888888888888888888888888
LEGACY=0x0000000000000000000000000000000000fffFfF
DEV_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil account #0 (public)
RELAYER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # anvil account #1 (public), plays the Reactive signer
D=http://127.0.0.1:18545; L=http://127.0.0.1:18546
CRON_EVERY="${CRON_EVERY:-5}"   # seconds between simulated CRON ticks
WEB_PORT="${WEB_PORT:-8000}"

anvil --port 18545 --chain-id 11155111 --block-time 1 >/tmp/anvil-dest.log 2>&1 & P1=$!
anvil --port 18546 --chain-id 5318007 --block-time 1 >/tmp/anvil-lasna.log 2>&1 & P2=$!
python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 >/tmp/flowlet-web.log 2>&1 & P3=$!
trap '[ "$BASHPID" = "$$" ] && kill $P1 $P2 $P3 2>/dev/null' EXIT
sleep 2
forge build -q
cast rpc anvil_setCode $SYS "$(jq -r .deployedBytecode.object out/MockSystem.sol/MockSystem.json)" --rpc-url $L >/dev/null
PROXY=$(forge create --broadcast --json --rpc-url $D --private-key $DEV_KEY test/mocks/MockSystem.sol:MockCallbackProxy | jq -r .deployedTo)

export NETWORK=eth-sepolia PRIVATE_KEY=$DEV_KEY DEST_RPC=$D LASNA_RPC=$L DEST_PROXY=$PROXY DEST_NAME=local DEPLOY_FILE=$ROOT/deployments/local.json
scripts/deploy.sh >/tmp/deploy-local.log
RC=$(jq -r .contracts.flowletReactive $DEPLOY_FILE); VAULT=$(jq -r .contracts.flowletVault $DEPLOY_FILE)
TOKEN=$(jq -r .contracts.mockUSD $DEPLOY_FILE)
cast rpc anvil_impersonateAccount $SYS --rpc-url $L >/dev/null
cast rpc anvil_setBalance $SYS 0x3635C9ADC5DEA00000 --rpc-url $L >/dev/null
TUPLE="react((uint256,address,uint256,uint256,uint256,uint256,bytes,uint256,uint256,uint256,uint256,uint256))"
LAST_DEST=$(jq -r .startBlocks.destination $DEPLOY_FILE); DELIVERED=0; LAST_CRON=0

relay_dest_logs() {
  local head; head=$(cast block-number --rpc-url $D)
  [ "$head" -lt "$LAST_DEST" ] && return 0
  { cast logs --json --from-block $LAST_DEST --to-block $head --address $VAULT --rpc-url $D
    cast logs --json --from-block $LAST_DEST --to-block $head --address $TOKEN --rpc-url $D; } |
  jq -cs 'add | sort_by((.blockNumber|ltrimstr("0x")|length), .blockNumber, (.logIndex|ltrimstr("0x")|length), .logIndex) | .[]' |
  while read -r l; do
    local addr; addr=$(jq -r .address <<<"$l")
    local t; mapfile -t t < <(jq -r '.topics[]' <<<"$l")
    local n=${#t[@]}; for i in 0 1 2 3; do [ -z "${t[$i]:-}" ] && t[$i]=0x0; done
    cast send $RC "$TUPLE" "(11155111,$addr,${t[0]},${t[1]},${t[2]},${t[3]},$(jq -r .data <<<"$l"),$(( $(jq -r .blockNumber <<<"$l") )),$n,$(jq -r .blockHash <<<"$l"),$(jq -r .transactionHash <<<"$l"),$(( $(jq -r .logIndex <<<"$l") )))" \
      --from $SYS --unlocked --rpc-url $L >/dev/null || echo "[relayer] react() failed for log $(jq -c '{address,topics,transactionHash}' <<<"$l")"
  done
  LAST_DEST=$((head + 1))
}
cron_tick() {
  [ "$(cast call $RC 'cronSubscribed()(bool)' --rpc-url $L)" = true ] || return 0  # honour the subscription
  cast send $RC "$TUPLE" "(5318007,$LEGACY,$(cast call $RC 'cronTopic()(uint256)' --rpc-url $L | awk '{print $1}'),0,0,0,0x,0,1,0,0,0)" --from $SYS --unlocked --rpc-url $L >/dev/null
}
deliver_callbacks() {
  local n; n=$(cast call $SYS 'callbackCount()(uint256)' --rpc-url $L | awk '{print $1}')
  while [ "$DELIVERED" -lt "$n" ]; do
    local cfg; cfg=$(cast call $SYS 'callbackAt(uint256)((uint256,address,uint64,bytes))' $DELIVERED --rpc-url $L)
    local payload; payload=$(sed -E 's/.*, (0x[0-9a-fA-F]+)\)$/\1/' <<<"$cfg")
    cast send $PROXY 'deliver(address,bytes,address)' $VAULT $payload $RC --rpc-url $D --private-key $RELAYER_KEY >/dev/null || echo "[relayer] callback #$DELIVERED reverted"
    DELIVERED=$((DELIVERED + 1)); echo "[relayer] delivered callback #$DELIVERED"
  done
}

set +e  # the relayer loop must survive individual failures; they are logged
echo "Flowlet local stack ready."
echo "  dashboard: http://localhost:$WEB_PORT/web/?net=local"
echo "  vault $VAULT | reactive $RC | token $TOKEN"
touch /tmp/flowlet-local.ready
while true; do
  relay_dest_logs
  now=$(date +%s); if [ $((now - LAST_CRON)) -ge "$CRON_EVERY" ]; then cron_tick; LAST_CRON=$now; fi
  deliver_callbacks
  relay_dest_logs
  sleep 1
done
