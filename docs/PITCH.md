# Reactive Autopilot – pitch

**One line:** Standing orders and auto-save for your crypto wallet, run by a reactive contract instead of a bot.

**Problem.** Banks have had "pay my rent every month" and "save 20% of my salary" for decades. On-chain, the same
thing needs a keeper bot, a centralized scheduler or a custodial app. Most people never set it up, and the ones who do
have to keep a server alive and trust it with a hot key.

**Solution.** Reactive Autopilot is a vault that holds only an allowance, plus a reactive contract on Reactive Network
that watches the chain for you:

* **Standing orders:** pay X to Y every N seconds/days, optionally N times. Reactive's CRON triggers the payment the moment it is due.
* **Auto-save:** when your wallet receives a deposit above a threshold, a share is moved to savings within seconds.

**Why Reactive is essential, not bolted on.**
1. The reactive contract configures itself by listening to the vault's own events. Users set rules in one place.
2. It changes its own subscriptions at runtime: it starts watching your wallet's deposits for the token you pick, and
   turns CRON on only while an order is active, so an idle autopilot costs nothing.
3. It batches every due order into one callback and de-duplicates in-flight requests.
4. Omni's ~1 s finality makes auto-save feel instant: the sweep lands a few seconds after the salary does.

**Safety.** Non-custodial; double-authenticated callbacks (proxy + reactive sender); the vault re-checks every rule;
no catch-up bursts; failing orders auto-close; timestamp-based timers for 200 ms Base blocks.

**Proof.** 17 Foundry tests including full-loop simulation and fuzzing, a local two-chain rehearsal, testnet
deployment on Base Sepolia + Lasna, and a report script that links every loop: origin tx → Lasna reactive tx →
callback tx, with measured latency.

**Who uses it.** Anyone paid in stablecoins: freelancers, DAO contributors, remote workers. They get rent,
subscriptions and savings handled automatically, without trusting a bot.
