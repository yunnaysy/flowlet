#!/usr/bin/env bash
# Local end-to-end rehearsal of deploy.sh + demo.sh + report.mjs on two anvil chains.
# A tiny bash "relayer" plays the part of Reactive Network: it forwards destination logs into react()
# (impersonating the system contract), fires CRON ticks, and delivers requested callbacks through a mock proxy.
# Uses anvil's well-known dev key only. Nothing here touches a public network.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.foundry/bin:$PATH"
SYS=0x8888888888888888888888888888888888888888
LEGACY=0x0000000000000000000000000000000000fffFfF
DEV_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil account #0 (public)
D=http://127.0.0.1:18545; L=http://127.0.0.1:18546

anvil --port 18545 --chain-id 84532 --block-time 1 >/tmp/anvil-dest.log 2>&1 & P1=$!
anvil --port 18546 --chain-id 5318007 --block-time 1 >/tmp/anvil-lasna.log 2>&1 & P2=$!
trap '[ "$BASHPID" = "$$" ] && kill $P1 $P2 2>/dev/null' EXIT
sleep 2
forge build -q
cast rpc anvil_setCode $SYS "$(jq -r .deployedBytecode.object out/MockSystem.sol/MockSystem.json)" --rpc-url $L >/dev/null
PROXY=$(forge create --broadcast --json --rpc-url $D --private-key $DEV_KEY test/mocks/MockSystem.sol:MockCallbackProxy | jq -r .deployedTo)

export PRIVATE_KEY=$DEV_KEY DEST_RPC=$D LASNA_RPC=$L DEST_PROXY=$PROXY DEST_NAME=local DEPLOY_FILE=$ROOT/deployments/local.json
scripts/deploy.sh >/tmp/deploy-local.log && tail -1 /tmp/deploy-local.log
RC=$(jq -r .contracts.autopilotReactive $DEPLOY_FILE); VAULT=$(jq -r .contracts.autopilotVault $DEPLOY_FILE)
TOKEN=$(jq -r .contracts.mockUSD $DEPLOY_FILE)
cast rpc anvil_impersonateAccount $SYS --rpc-url $L >/dev/null
cast rpc anvil_setBalance $SYS 0x3635C9ADC5DEA00000 --rpc-url $L >/dev/null
TUPLE="react((uint256,address,uint256,uint256,uint256,uint256,bytes,uint256,uint256,uint256,uint256,uint256))"
LAST_DEST=0; DELIVERED=0

relay_dest_logs() { # forward new vault/token logs into react(), in chain order
  local head; head=$(cast block-number --rpc-url $D)
  { cast logs --json --from-block $LAST_DEST --to-block $head --address $VAULT --rpc-url $D
    cast logs --json --from-block $LAST_DEST --to-block $head --address $TOKEN --rpc-url $D; } |
  jq -cs 'add | sort_by((.blockNumber|ltrimstr("0x")|explode|length), .blockNumber, (.logIndex|ltrimstr("0x")|explode|length), .logIndex) | .[]' |
  while read -r l; do
    local addr; addr=$(jq -r .address <<<"$l")
    local t; mapfile -t t < <(jq -r '.topics[]' <<<"$l")
    local n=${#t[@]}; for i in 0 1 2 3; do [ -z "${t[$i]:-}" ] && t[$i]=0x0; done
    cast send $RC "$TUPLE" "(84532,$addr,${t[0]},${t[1]},${t[2]},${t[3]},$(jq -r .data <<<"$l"),$(( $(jq -r .blockNumber <<<"$l") )),$n,$(jq -r .blockHash <<<"$l"),$(jq -r .transactionHash <<<"$l"),$(( $(jq -r .logIndex <<<"$l") )))" \
      --from $SYS --unlocked --rpc-url $L >/dev/null
  done
  LAST_DEST=$((head + 1))
}
cron_tick() { cast send $RC "$TUPLE" "(5318007,$LEGACY,$(cast call $RC 'cronTopic()(uint256)' --rpc-url $L | awk '{print $1}'),0,0,0,0x,0,1,0,0,0)" --from $SYS --unlocked --rpc-url $L >/dev/null; }
deliver_callbacks() {
  local n; n=$(cast call $SYS 'callbackCount()(uint256)' --rpc-url $L | awk '{print $1}')
  while [ "$DELIVERED" -lt "$n" ]; do
    local cfg; cfg=$(cast call $SYS 'callbackAt(uint256)((uint256,address,uint64,bytes))' $DELIVERED --rpc-url $L)
    local payload; payload=$(sed -E 's/.*, (0x[0-9a-fA-F]+)\)$/\1/' <<<"$cfg")
    cast send $PROXY 'deliver(address,bytes,address)' $VAULT $payload $RC --rpc-url $D --private-key $DEV_KEY >/dev/null
    DELIVERED=$((DELIVERED + 1)); echo "  delivered callback #$DELIVERED"
  done
}
step() { relay_dest_logs; cron_tick; deliver_callbacks; relay_dest_logs; }

# Run the demo while relaying in the background, like the live network would.
scripts/demo.sh & DEMO=$!
while kill -0 $DEMO 2>/dev/null; do relay_dest_logs; sleep 3; done
for i in $(seq 1 8); do step; sleep 10; done   # ~3 order runs at 60s interval need ~2+ minutes of chain time
cast rpc evm_increaseTime 70 --rpc-url $D >/dev/null; cast rpc evm_increaseTime 70 --rpc-url $L >/dev/null
for i in 1 2 3; do cast rpc evm_increaseTime 65 --rpc-url $D >/dev/null; cast rpc evm_increaseTime 65 --rpc-url $L >/dev/null; sleep 2; step; done
echo "payee balance:   $(cast call $TOKEN 'balanceOf(address)(uint256)' 0x000000000000000000000000000000000000dEaD --rpc-url $D)"
echo "savings balance: $(cast call $TOKEN 'balanceOf(address)(uint256)' 0x5A7e000000000000000000000000000000005a7E --rpc-url $D)"
echo "cron subscribed: $(cast call $RC 'cronSubscribed()(bool)' --rpc-url $L)"
LOG_CHUNK=1000 node scripts/report.mjs $DEPLOY_FILE | head -20
