#!/usr/bin/env bash
# Deploys Flowlet: MockUSD + FlowletVault on the destination chain, FlowletReactive on Lasna.
# Writes addresses and transaction hashes to deployments/<dest>.json. Testnet only.
. "$(dirname "$0")/env.sh"
cd "$ROOT"
mkdir -p "$(dirname "$DEPLOY_FILE")"

echo "deployer:     $DEPLOYER"
echo "destination:  $DEST_NAME ($DEST_CHAIN_ID)  rpc=$DEST_RPC"
echo "reactive:     Lasna ($LASNA_CHAIN_ID)  rpc=$LASNA_RPC"
[ "$(cast chain-id --rpc-url "$DEST_RPC")" = "$DEST_CHAIN_ID" ] || { echo "dest chain id mismatch"; exit 1; }
[ "$(cast chain-id --rpc-url "$LASNA_RPC")" = "$LASNA_CHAIN_ID" ] || { echo "lasna chain id mismatch"; exit 1; }

DEST_BAL=$(cast balance "$DEPLOYER" --rpc-url "$DEST_RPC")
LASNA_BAL=$(cast balance "$DEPLOYER" --rpc-url "$LASNA_RPC")
echo "balances:     dest=$(cast from-wei "$DEST_BAL") ETH  lasna=$(cast from-wei "$LASNA_BAL") lREACT"
if [ "$DEST_BAL" = "0" ]; then
  echo "No destination-chain ETH. Fund $DEPLOYER from a faucet first (see README > Funding)."; exit 2
fi
# Rough budget: ~3.5M gas of deployments + ~1M gas of demo txs on the destination, plus funding.
GAS_PRICE=$(cast gas-price --rpc-url "$DEST_RPC")
EST=$(( GAS_PRICE * 4500000 * 2 ))  # x2 safety margin for price spikes
echo "gas price:    $(cast from-wei "$GAS_PRICE" gwei) gwei  (deploy+demo gas ≈ $(cast from-wei "$EST") ETH with 2x margin)"
NEED_LREACT=0; [ "$LASNA_BAL" = "0" ] && NEED_LREACT=$(cast to-wei "${LREACT_ETH%ether}")
NEED=$(python3 -c "print($EST + $(cast to-wei "${VAULT_FUNDING%ether}") + $NEED_LREACT)")
if python3 -c "import sys; sys.exit(0 if int('$DEST_BAL') < int('$NEED') else 1)"; then
  echo "Need about $(cast from-wei "$NEED") ETH on $DEST_NAME, have $(cast from-wei "$DEST_BAL"). Fund $DEPLOYER and re-run."; exit 2
fi
if [ "$LASNA_BAL" = "0" ]; then
  if [ "${AUTO_LREACT:-1}" = "1" ] && [ -n "$LREACT_FAUCET" ]; then
    echo "Requesting lREACT: $LREACT_ETH -> faucet $LREACT_FAUCET on $DEST_NAME..."
    FAUCET_TX=$(cast send "$LREACT_FAUCET" "request(address)" "$DEPLOYER" --value "$LREACT_ETH" \
      --rpc-url "$DEST_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash)
    echo "faucet tx: $FAUCET_TX  (waiting for lREACT on Lasna, up to 5 min)"
    for _ in $(seq 1 60); do sleep 5; LASNA_BAL=$(cast balance "$DEPLOYER" --rpc-url "$LASNA_RPC"); [ "$LASNA_BAL" != "0" ] && break; done
    [ "$LASNA_BAL" != "0" ] || { echo "lREACT did not arrive yet; re-run deploy.sh later (it will skip the faucet)"; exit 2; }
    echo "lREACT balance: $(cast from-wei "$LASNA_BAL")"
  else
    echo "No lREACT on Lasna and no faucet contract for $DEST_NAME. Fund $DEPLOYER on Lasna first."; exit 2
  fi
fi
FUND_WEI=$(cast to-wei "${REACTIVE_FUNDING%ether}")
if python3 -c "import sys; sys.exit(0 if int('$LASNA_BAL') <= int('$FUND_WEI') else 1)"; then  # keep some lREACT for the deploy + setVault gas
  REACTIVE_FUNDING="$(python3 -c "print(f'{int($LASNA_BAL)*0.7/1e18:.4f}')")ether"
  echo "lowering REACTIVE_FUNDING to $REACTIVE_FUNDING (70% of the lREACT balance)"
fi

create() { # rpc, contract, value, args...
  local rpc=$1 c=$2 v=$3; shift 3
  forge create --broadcast --json --rpc-url "$rpc" --private-key "$PRIVATE_KEY" --value "$v" "$c" \
    ${1:+--constructor-args "$@"}
}

echo "1/4 MockUSD on $DEST_NAME"
OUT=$(create "$DEST_RPC" src/MockUSD.sol:MockUSD 0)
TOKEN=$(jq -r .deployedTo <<<"$OUT"); TOKEN_TX=$(jq -r .transactionHash <<<"$OUT")

echo "2/4 FlowletReactive on Lasna"
OUT=$(create "$LASNA_RPC" src/FlowletReactive.sol:FlowletReactive "$REACTIVE_FUNDING" "$DEST_CHAIN_ID" "$CRON_TOPIC")
REACTIVE=$(jq -r .deployedTo <<<"$OUT"); REACTIVE_TX=$(jq -r .transactionHash <<<"$OUT")

echo "3/4 FlowletVault on $DEST_NAME (proxy $DEST_PROXY, sender $REACTIVE, token $TOKEN)"
OUT=$(create "$DEST_RPC" src/FlowletVault.sol:FlowletVault "$VAULT_FUNDING" "$DEST_PROXY" "$REACTIVE" "$TOKEN")
VAULT=$(jq -r .deployedTo <<<"$OUT"); VAULT_TX=$(jq -r .transactionHash <<<"$OUT")

echo "4/4 wiring reactive -> vault"
SETVAULT_TX=$(cast send "$REACTIVE" "setVault(address,address,address)" "$VAULT" "$DEPLOYER" "$TOKEN" \
  --rpc-url "$LASNA_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash)

DEST_START_BLOCK=$(cast receipt "$TOKEN_TX" blockNumber --rpc-url "$DEST_RPC")
LASNA_START_BLOCK=$(cast receipt "$REACTIVE_TX" blockNumber --rpc-url "$LASNA_RPC")

jq -n --arg dest "$DEST_NAME" --arg destChainId "$DEST_CHAIN_ID" --arg destRpc "$DEST_RPC" \
  --arg lasnaRpc "$LASNA_RPC" --arg deployer "$DEPLOYER" --arg proxy "$DEST_PROXY" \
  --arg token "$TOKEN" --arg tokenTx "$TOKEN_TX" --arg reactive "$REACTIVE" --arg reactiveTx "$REACTIVE_TX" \
  --arg vault "$VAULT" --arg vaultTx "$VAULT_TX" --arg setVaultTx "$SETVAULT_TX" \
  --arg faucetTx "${FAUCET_TX:-}" --arg destStart "$DEST_START_BLOCK" --arg lasnaStart "$LASNA_START_BLOCK" --arg cron "$CRON_TOPIC" \
  '{destination:$dest, destinationChainId:($destChainId|tonumber), destinationRpc:$destRpc, lasnaRpc:$lasnaRpc,
    deployer:$deployer, callbackProxy:$proxy, cronTopic:$cron,
    wallet:$deployer, contracts:{mockUSD:$token, flowletVault:$vault, flowletReactive:$reactive},
    txs:{mockUSD:$tokenTx, flowletVault:$vaultTx, flowletReactive:$reactiveTx, setVault:$setVaultTx, lreactFaucet:$faucetTx},
    startBlocks:{destination:($destStart|tonumber), lasna:($lasnaStart|tonumber)}}' > "$DEPLOY_FILE"

echo "saved $DEPLOY_FILE"
cat "$DEPLOY_FILE"
