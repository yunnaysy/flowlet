# Reactive Autopilot

**Standing orders and auto-save for your crypto wallet, run entirely by a reactive contract.**
No bots, no keepers, no custody, and nothing to keep running on a server.

Built for the [Reactive Omni Buildathon](https://dorahacks.io/hackathon/reactive-omni-buildathon), track **Set It and Forget It**.

> Is this something you'd actually leave running? Yes. It is the crypto version of the two bank features people
> rely on most: *pay my rent every month* and *put 20% of my salary into savings when it lands*.

## What it does

| Rule | Trigger | Action |
|---|---|---|
| **Standing order** – "pay 25 tUSD to my landlord every 60 s / week / month, N times" | Reactive CRON tick, only while an order is due | `executeDue()` pulls exactly the scheduled amount from the user's wallet to the payee |
| **Auto-save sweep** – "when I receive ≥ 100 tUSD, move 20% to my savings wallet" | ERC-20 `Transfer(to = my wallet)` on the destination chain | `sweep()` moves the configured share to savings within seconds |

Funds never leave the user's wallet until a rule fires: the vault only holds a capped ERC-20 allowance.

## Architecture

```
 Base Sepolia (destination + origin)                     Reactive Lasna (5318007)
┌──────────────────────────────────────┐   events      ┌──────────────────────────────────────────┐
│ AutopilotVault (callback contract)   │ ────────────▶ │ AutopilotReactive                        │
│  createOrder / cancelOrder           │ OrderScheduled│  • mirrors every order (id → next due)   │
│  configureSweep                      │ OrderExecuted │  • subscribes to CRON only while ≥1 order│
│  executeDue(rvm, ids[])  ◀───────┐   │ OrderClosed   │    is active, unsubscribes when idle     │
│  sweep(rvm, token, amt, tx, idx) │   │ SweepConfigured│ • on SweepConfigured, subscribes at     │
└──────────────────────────────────┼───┘               │    runtime to Transfer(to = wallet)      │
 MockUSD / any ERC-20 ─ Transfer ──┼─────────────────▶ │  • batches due orders into one callback  │
                                   │   callback proxy  │  • requestCallbackV_1_0(...)             │
                                   └────────────────── └──────────────────────────────────────────┘
```

Why the reactive contract does real work (Integration):

* **Self-configuring.** The user only talks to the vault. The reactive contract learns every rule by listening to
  the vault's own events, so there is one source of truth and zero manual setup on Reactive.
* **Dynamic subscriptions.** Watching deposits requires subscribing to a token chosen by the user, filtered by
  `topic2 = wallet`. The reactive contract subscribes, re-subscribes and unsubscribes at runtime from inside `react()`.
* **Pay only when needed.** CRON billing stops automatically when no order is active (an idle autopilot costs nothing).
* **Batching and de-duplication.** All due orders go out in a single callback; a `pendingSince` timeout prevents
  duplicate requests while a callback is in flight.

Safety on the destination side:

* `onlyServiceProvider` (callback proxy) **and** `onlyCallbackSender` (this reactive contract) on every callback.
* The vault re-checks due time, active flag and duplicate origin logs, so stale or repeated callbacks are no-ops.
* No catch-up bursts after downtime; failed pulls retry after 2 min and auto-close after 3 consecutive failures.
* Timers use `block.timestamp` only (Base Sepolia has 200 ms blocks; block-count timers would run 10× fast).
* Paying yourself or saving into your own wallet is rejected, so a sweep can never trigger itself.

## Repository layout

| Path | What |
|---|---|
| `src/AutopilotReactive.sol` | Reactive contract on Lasna (subscriptions, mirror, CRON, callbacks) |
| `src/AutopilotVault.sol` | Callback contract on Base Sepolia (rules, payments, sweeps) |
| `src/MockUSD.sol` | Testnet ERC-20 with an open faucet for the demo |
| `test/Autopilot.t.sol` | 17 Foundry tests incl. full-loop simulation and fuzzing |
| `scripts/deploy.sh` | Deploys everything, wires it, writes `deployments/<chain>.json` |
| `scripts/demo.sh` | Creates a standing order and a sweep rule, then sends a "salary" deposit |
| `scripts/report.mjs` | Builds the full-loop evidence table (origin tx → Lasna tx → callback tx, latency) from public RPCs |
| `scripts/autopilot.sh` | CLI: status, order, cancel, sweep, mint, cron fast/slow |
| `scripts/local-e2e.sh` | Local rehearsal on two anvil chains with a bash relayer standing in for Reactive |
| `web/index.html` | Single-file dashboard (read via RPC, write via MetaMask) |

## Quick start

```bash
git clone --recursive <this repo> && cd reactive-autopilot
forge test                       # 17 tests
scripts/local-e2e.sh             # optional: full local rehearsal (~3 min)
```

### Deploy to testnet

1. Create a key file `DEPLOYER_SECRET.txt` (git-ignored) containing `PRIVATE_KEY=0x...` for a **fresh testnet-only** key.
2. Fund the address with Base Sepolia ETH (≈0.05 ETH is plenty). The deploy script then buys lREACT automatically by
   calling the Lasna faucet contract on Base Sepolia (`request(address)`, 1 ETH → 100 lREACT).
3. Run:

```bash
scripts/deploy.sh                # MockUSD + AutopilotVault on Base Sepolia, AutopilotReactive on Lasna
scripts/demo.sh                  # order: 25 tUSD every 60 s × 3; sweep: 20% of deposits ≥ 100 tUSD
sleep 240 && node scripts/report.mjs   # writes deployments/base-sepolia.LOOP_REPORT.md
scripts/autopilot.sh cron slow   # switch to Cron100 after the demo to save lREACT
```

Unichain Sepolia works the same way:
`DEST_NAME=unichain-sepolia DEST_RPC=https://sepolia.unichain.org DEST_CHAIN_ID=1301 DEST_PROXY=0x775c9B990ADe401060B78D0e98684eEf8d2466C1`
(fund lREACT separately, since the faucet contract lives on Base Sepolia / Ethereum Sepolia).

### Dashboard

```bash
python3 -m http.server 8000      # then open http://localhost:8000/web/
```

## Network reference (testnet)

| | Value |
|---|---|
| Reactive Lasna RPC / chain id | `https://lasna-rpc.rnk.dev/` / `5318007`, explorer `https://lasna.reactscan.net` |
| System contract | `0x8888888888888888888888888888888888888888` |
| CRON source | `0x0000000000000000000000000000000000fffFfF` (Cron10 ≈ 10 s, Cron100 ≈ 100 s) |
| Base Sepolia callback proxy | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` |
| Unichain Sepolia callback proxy | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` |
| lREACT faucet (Base Sepolia) | `0x2afaFD298b23b62760711756088F75B7409f5967` |
| lREACT faucet (Ethereum Sepolia) | `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434` |

Library: [`reactive-lib-omni`](https://github.com/Reactive-Network/reactive-lib-omni) v0.1.0 (`requestCallbackV_1_0`).

## Deployed contracts and full-loop transactions

_Filled in from `deployments/base-sepolia.json` and `deployments/base-sepolia.LOOP_REPORT.md` after the testnet run._

| Contract | Chain | Address |
|---|---|---|
| AutopilotReactive | Lasna | _pending_ |
| AutopilotVault | Base Sepolia | _pending_ |
| MockUSD | Base Sepolia | _pending_ |

## Limitations and next steps

* One vault per user (by design, it keeps authorization simple). A factory can deploy vault + reactive pairs.
* Up to 32 active orders per autopilot and 8 per callback batch.
* The reactive contract trusts the vault's events; the vault re-validates everything, so a mis-mirror can only
  delay a payment, never move extra funds.
* Ideas: calendar-month schedules, multi-token sweeps, low-balance alerts, Unichain + Base in one autopilot.

## License

MIT
