# Flowlet: security, custody & privacy

> **Testnet software.** Flowlet runs on Ethereum Sepolia (vault, the live deployment) and Reactive Lasna (reactive contract) with a test token (tUSD). It has automated, fuzz and static-analysis checks but **no external audit**. Never use it with real funds.

**Flowlet doesn't hold your money. It holds your rules.**

## 1. Custody: exactly what the contracts do

Checked against `src/FlowletVault.sol` and `src/FlowletReactive.sol`.

| Claim (UI and pitch) | Why it is true in the code |
|---|---|
| **Your tokens stay in your wallet.** | The vault never receives tUSD. Every movement is one `transferFrom(owner → payee/savings)` in `_pull`. `owner` and `token` are `immutable`, fixed at deployment. |
| **Flowlet can move at most the allowance you approve.** | `_pull` depends on your ERC-20 allowance to the vault. The demo approves 2,000 tUSD, never an unlimited amount. |
| **Only your own reactive contract can trigger a rule.** | `executeDue`, `sweep` and `tripGuard` have `onlyServiceProvider` (only Reactive's callback proxy may call) and `onlyCallbackSender(reactive_)`. The proxy injects the sending reactive contract's id, and it must equal the vault's immutable callback sender (your FlowletReactive). `react()` on Lasna has `onlySystem`. Tests: `test_vaultRejectsDirectCalls`, `test_vaultRejectsForeignReactiveContract`, `testFuzz_foreignCallbackSenderRejected`, `test_reactOnlySystem`. |
| **Only you can change the rules.** | `createOrder`, `cancelOrder`, `configureSweep`, `configureGuard`, `pause`, `resume` and `withdrawNative` are `onlyOwner` (the wallet that deployed the vault). Tests: `test_onlyOwner`, `testFuzz_nonOwnerCannotConfigure`. |
| **Rules can only pay the payees you set.** | A standing order pays its fixed `payee`/`amount` and can't run before `nextDue`. Auto-save pays only the configured `savings` address. Neither can be your own address or 0, and the amount is ≤ `bps` of the deposit. |
| **The daily limit trips a circuit breaker instead of overspending.** | In `_execute`, `spentInWindow + amount > dailyLimit` → a `DAILY_LIMIT` Decision and `_trip`. The limit applies to standing orders. Test: `test_dailyLimitTripsBreaker`. |
| **Auto-save never breaks your emergency reserve.** | `sweep` caps the amount at `balance − reserveFloor` (RESERVE_CAPPED/BLOCKED). Fuzzed in `testFuzz_sweepNeverBreaksReserve`. |
| **No double saves, no catch-up bursts.** | `processedLog[keccak(originTxHash, logIndex)]` makes each deposit sweep once (`test_sweepIdempotent`, `testFuzz_sweepSameLogOnlyOnce`). A missed interval reschedules from now rather than paying several times (`test_noCatchUpBurst`). The reactive side tracks pending orders (`test_pendingPreventsDuplicates`). |
| **Revoke = stop.** | Setting the allowance to 0 emits `Approval(wallet, vault, 0)`. FlowletReactive is subscribed to it, so it pauses itself, drops its CRON and deposit subscriptions and sends `tripGuard(MANDATE_REVOKED)` to the vault. Test: `test_mandateRevoked_reactiveCircuitBreaker`. |
| **Every decision is on-chain.** | `Decision(nonce, kind, ruleId, requested, executed, reason, to)` is emitted for every order, sweep and guard callback, including refusals (PAUSED, NOT_DUE, DUPLICATE, DAILY_LIMIT, RESERVE_*, PULL_FAILED). The reactive nonce links each one to its `FlowRequested` on Lasna. That is how the Live Reactive Proof timeline is built. |

**Admin powers.** The reactive contract's deployer can change the CRON topic and the callback gas limit, and can withdraw the contract's own REACT gas balance. It cannot craft callbacks (payloads are built only inside `react()` from real logs), change your rules or move tokens. `setVault` can be called only once. The vault's native ETH balance pays callback gas debt (`coverDebt`), and only the vault owner can withdraw it.

### Recovery path (shown in Funds & permissions)

1. **Pause all.** Every rule stops, and the reactive contract drops its CRON and deposit subscriptions.
2. **Revoke access** (allowance → 0). Nothing can move, and the reactive contract pauses itself.
3. Your tokens never left your wallet, so there is nothing to withdraw. Only the vault's small native gas balance is withdrawable, by you.

## 2. Contract checklist

| Area | Status |
|---|---|
| Access control | `onlyOwner` (vault rules), `onlyServiceProvider` + `onlyCallbackSender` (callbacks), `onlySystem` (`react`), `onlyOwner` on the reactive admin functions. |
| Reentrancy | The only external call during rule execution is to the **immutable** token chosen at deployment. Callbacks can't be re-entered by anyone but the proxy with the right sender. Owner functions need the owner. Slither's reentrancy notes are therefore not exploitable (see §3). |
| Integers and limits | Solidity 0.8 checked math. `bps ≤ 10_000`. Minimum interval. `MAX_BATCH` per `executeDue`. `MAX_FAILURES` auto-closes a failing order. |
| Replay / duplicates | `processedLog` per origin log. `nextDue` gating. Pending tracking on the reactive side. |
| Pause / revoke | `pause`/`resume` (owner), the guard trip (daily limit, revoke), and allowance → 0. Callbacks while paused are recorded as no-ops (`test_manualPauseAndPausedCallbacksAreNoops`). |
| Events | `Decision`, `OrderScheduled/Executed/PaymentFailed/Closed`, `SweepConfigured`, `GuardConfigured/Tripped/Reset` on the vault. `FlowRequested`, `SubscriptionChanged` and `VaultSet` on the reactive contract. |

## 3. Tooling results (2026-11-18)

- **Foundry:** `forge test` gives 24 passed, 0 failed, including 4 fuzz tests at 256 runs each. New in this pass: `testFuzz_foreignCallbackSenderRejected`, `testFuzz_nonOwnerCannotConfigure` and `testFuzz_sweepSameLogOnlyOnce`.
- **Local end-to-end** (`scripts/local-e2e.sh`): three anvil chains plus a relayer that emulates Reactive. Result: `LOCAL E2E: OK`. The headless browser run of RUN DEMO completes all 10 steps with no page errors, and axe-core reports 0 WCAG A/AA violations.
- **Slither 0.11** (`--filter-paths "lib|test|script" --exclude-informational`) reports 31 results, all reviewed. None is exploitable:
  - `incorrect-equality` (3): `headroom == 0`, `dailyLimit == 0` and the ERC-20 return-data length check. These are intended exact comparisons on values nobody else controls.
  - `reentrancy-no-eth` / `reentrancy-benign` / `reentrancy-events` (17): the external calls are to the immutable token (vault) or to Reactive's system contract (subscribe/unsubscribe/callback). Neither can re-enter a privileged path.
  - `uninitialized-local` (2): `reason` deliberately starts at 0 (`OK`).
  - `events-maths` (2): `setCronTopic` and `setCallbackGasLimit` don't emit an event. These are admin tuning functions with no effect on funds. Noted for the next deployment.
  - `calls-loop` (1): `_pull` inside the batch loop, which `MAX_BATCH` bounds.
  - `timestamp` (7): schedules are by design minute- to month-scale.
  - `cache-array-length` (1): a gas optimisation only.
- **gitleaks 8.21** over the full git history reports 4 hits. All of them are the **public Anvil default development keys** in `scripts/local-stack.sh` and `scripts/local-e2e.sh`, which are used only for local chains. False positives.
- **Key check:** `DEPLOYER_SECRET.txt` is gitignored (`*SECRET*`, `.env`). A scripted comparison shows its key appears nowhere in tracked files, the git history or the diff. The web app has no build step and contains no keys.
- **npm audit:** not applicable. The web app is plain ES modules with no npm dependencies.

## 4. Frontend hardening

- **Strict CSP** meta: `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and `connect-src` limited to `'self'`, https RPCs and the local rehearsal ports.
- **Escaping:** every value interpolated into `innerHTML` goes through `esc()`, including on-chain values. The activity log uses `textContent`.
- **Validation** before any wallet prompt: addresses (`0x` + 40 hex), amounts (positive, at most 6 decimals), whole-number intervals and run counts, and an auto-save % above 0 and at most 100.
- **Confirm dialogs:** pause all, revoke access and cancel an order.
- **Testnet labels:** a network pill ("eth-sepolia + Reactive Lasna · testnet" or "Local rehearsal · anvil"), "Testnet" in the hero eyebrow and footer, "tUSD" everywhere and the audit disclaimer in the funds modal.
- **No keys in the page.** Transactions go through the user's wallet (`window.ethereum`). Only the local rehearsal uses anvil's own unlocked dev account.

## 5. Privacy: what's public on-chain

Public forever: your wallet, payee and savings addresses, rule amounts, intervals and run counts, every transfer and Decision event, and the reactive transactions on Lasna. Flowlet stores no names, emails or memos on-chain, so there is no free-text field where personal data could leak. The UI explains this in "What's visible on-chain" and suggests not reusing an identity-linked address.

## 6. Known limitations

1. **Auto-save trusts the deposit amount reported by the reactive contract.** It is read from a real `Transfer(→ wallet)` log. Only your reactive contract can deliver it, and the transfer is still bounded by `bps`, your allowance and the reserve floor.
2. **The daily limit covers standing orders only.** Auto-save is bounded by `bps` and the reserve instead.
3. **Liveness depends on Reactive Network.** If it is down, rules don't run, but nothing moves without it either.
4. **Two admin tuning functions emit no event** (see Slither). This is cosmetic and doesn't justify a redeploy.
5. **No external audit.**

**Redeploy decision:** no vulnerability that lets anyone move funds they shouldn't was found, so the contracts were **not redeployed**.

## 7. Implemented vs. roadmap

| Implemented (testnet) | Roadmap |
|---|---|
| Allowance-only custody. Owner-only rules. Proxy- and sender-authenticated callbacks. Daily-limit circuit breaker. Emergency reserve. Idempotent auto-save. Revoke-triggered self-pause. Decision events for everything. CSP and escaping. | A daily limit covering all rule types. Per-payee caps. Events on admin tuning. Multi-sig owner option. External audit before any mainnet use. |
