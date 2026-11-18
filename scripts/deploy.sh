#!/usr/bin/env bash
# Deploys Reactive Autopilot: MockUSD + AutopilotVault on the destination chain, AutopilotReactive on Lasna.
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
if [ "$LASNA_BAL" = "0" ]; then
  if [ "${AUTO_LREACT:-1}" = "1" ] && [ "$DEST_CHAIN_ID" = "84532" ]; then
    echo "Requesting lREACT via faucet contract on Base Sepolia (${LREACT_ETH:-0.03ether} -> lREACT)..."
    FAUCET_TX=$(cast send "$LREACT_FAUCET" "request(address)" "$DEPLOYER" --value "${LREACT_ETH:-0.03ether}" \
      --rpc-url "$DEST_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash)
    echo "faucet tx: $FAUCET_TX  (waiting for lREACT to arrive)"
    for _ in $(seq 1 60); do sleep 5; LASNA_BAL=$(cast balance "$DEPLOYER" --rpc-url "$LASNA_RPC"); [ "$LASNA_BAL" != "0" ] && break; done
    [ "$LASNA_BAL" != "0" ] || { echo "lREACT did not arrive yet; re-run later"; exit 2; }
  else
    echo "No lREACT on Lasna. Fund $DEPLOYER first."; exit 2
  fi
fi

create() { # rpc, contract, value, args...
  local rpc=$1 c=$2 v=$3; shift 3
  forge create --broadcast --json --rpc-url "$rpc" --private-key "$PRIVATE_KEY" --value "$v" "$c" \
    ${1:+--constructor-args "$@"}
}

echo "1/4 MockUSD on $DEST_NAME"
OUT=$(create "$DEST_RPC" src/MockUSD.sol:MockUSD 0)
TOKEN=$(jq -r .deployedTo <<<"$OUT"); TOKEN_TX=$(jq -r .transactionHash <<<"$OUT")

echo "2/4 AutopilotReactive on Lasna"
OUT=$(create "$LASNA_RPC" src/AutopilotReactive.sol:AutopilotReactive "$REACTIVE_FUNDING" "$DEST_CHAIN_ID" "$CRON_TOPIC")
REACTIVE=$(jq -r .deployedTo <<<"$OUT"); REACTIVE_TX=$(jq -r .transactionHash <<<"$OUT")

echo "3/4 AutopilotVault on $DEST_NAME (proxy $DEST_PROXY, sender $REACTIVE)"
OUT=$(create "$DEST_RPC" src/AutopilotVault.sol:AutopilotVault "$VAULT_FUNDING" "$DEST_PROXY" "$REACTIVE")
VAULT=$(jq -r .deployedTo <<<"$OUT"); VAULT_TX=$(jq -r .transactionHash <<<"$OUT")

echo "4/4 wiring reactive -> vault"
SETVAULT_TX=$(cast send "$REACTIVE" "setVault(address,address)" "$VAULT" "$DEPLOYER" \
  --rpc-url "$LASNA_RPC" --private-key "$PRIVATE_KEY" --json | jq -r .transactionHash)

DEST_START_BLOCK=$(cast receipt "$TOKEN_TX" blockNumber --rpc-url "$DEST_RPC")
LASNA_START_BLOCK=$(cast receipt "$REACTIVE_TX" blockNumber --rpc-url "$LASNA_RPC")

jq -n --arg dest "$DEST_NAME" --arg destChainId "$DEST_CHAIN_ID" --arg destRpc "$DEST_RPC" \
  --arg lasnaRpc "$LASNA_RPC" --arg deployer "$DEPLOYER" --arg proxy "$DEST_PROXY" \
  --arg token "$TOKEN" --arg tokenTx "$TOKEN_TX" --arg reactive "$REACTIVE" --arg reactiveTx "$REACTIVE_TX" \
  --arg vault "$VAULT" --arg vaultTx "$VAULT_TX" --arg setVaultTx "$SETVAULT_TX" \
  --arg destStart "$DEST_START_BLOCK" --arg lasnaStart "$LASNA_START_BLOCK" --arg cron "$CRON_TOPIC" \
  '{destination:$dest, destinationChainId:($destChainId|tonumber), destinationRpc:$destRpc, lasnaRpc:$lasnaRpc,
    deployer:$deployer, callbackProxy:$proxy, cronTopic:$cron,
    contracts:{mockUSD:$token, autopilotVault:$vault, autopilotReactive:$reactive},
    txs:{mockUSD:$tokenTx, autopilotVault:$vaultTx, autopilotReactive:$reactiveTx, setVault:$setVaultTx},
    startBlocks:{destination:($destStart|tonumber), lasna:($lasnaStart|tonumber)}}' > "$DEPLOY_FILE"

echo "saved $DEPLOY_FILE"
cat "$DEPLOY_FILE"
