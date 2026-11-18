# Flowlet: pitch (60–90 seconds)

> **Set your on-chain automation once. Reactive makes it happen when the event occurs — even when you're offline.**

**Problem.** Banks have offered "pay my rent every month" and "save 20% of my salary" for decades. On-chain, the same thing usually needs a keeper bot, a centralized scheduler or a custodial app, and someone has to keep a server alive holding a hot key.

**Solution.** Your wallet, your rules, automatic execution. Flowlet is a non-custodial vault (it can only use an allowance you set) plus a reactive contract on Reactive Network that watches the chain for you. Set a condition once; when the event happens, Reactive triggers the rule through a callback.

## Five things that stand out

1. **No bot of yours runs 24/7.** Standing orders run on Reactive's CRON; auto-save reacts to the incoming `Transfer`. The UI can be closed.
2. **Proof for every loop.** Each automation shows three transactions you can open (origin on Sepolia, reactive transaction on Lasna, callback on Sepolia) and the contract state before → after, read from the callback's own logs. The callback is shown to come from Reactive's callback proxy, not from the user or the page.
3. **Self-configuring subscriptions.** The reactive contract configures itself from the vault's events and subscribes to CRON or deposits only while a rule needs them. Pausing drops both subscriptions.
4. **Safety Guard: pause vs revoke, honestly.** A daily limit, an emergency reserve that overrides auto-save, and a breaker. Pause stops every rule but keeps the allowance; revoke (allowance 0) makes Reactive pause itself and the vault, so nothing can move. The public demo vault is in the revoked state right now, and the app says so.
5. **A home that is a control center.** "What rule is running?" (When / Then / Guard / Network), the last automation, the Watching → Triggered → Executed state, and one button to pause everything.

## Proof

Five full loops on Ethereum Sepolia + Reactive Lasna (3 standing-order payments, 1 auto-save with the reserve override, 1 Safety Guard revoke), measured 12–24 s from origin to callback. Table with every link: [README](../README.md#deployed-contracts-and-full-loop-transactions).

## Honest scope

- Testnet only, unaudited contracts.
- Live "Run demo loop" sends transactions only for the vault owner's wallet; everyone else sees the recorded replay, so the demo never spends on behalf of visitors.
- Demo video: `docs/video/` (recorded from the live site, replay mode). The [60-second demo](../README.md#60-second-demo) is also written out.
- The local rehearsal uses a stand-in relayer instead of Reactive Network and is labelled as such.

**Ask.** Open the app, choose **Explore demo without wallet**, and tap **View execution proof**.
