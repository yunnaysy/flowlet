# Flowlet: pitch

**Flowlet: Money moves on your rules.** Standing orders, auto-save and a safety circuit breaker for your crypto
wallet, run by a reactive contract instead of a bot.

**Problem.** Banks have offered "pay my rent every month" and "save 20% of my salary" for decades. On-chain, the same
thing needs a keeper bot, a centralized scheduler or a custodial app. Most people never set it up, and the few who do
have to keep a server alive holding a hot key.

**Solution.** Flowlet is a non-custodial vault (it only holds a capped allowance) plus a reactive contract on
Reactive Network that watches the chain for you:

* **Standing orders:** pay X to Y every N seconds or days. Reactive's CRON triggers each payment when it's due.
* **Auto-save:** when a deposit lands, a share moves to savings within seconds.
* **Safety Guard:** a daily payment limit, an emergency reserve that overrides auto-save, and *revoke = stop*. When you
  set the allowance to 0, the reactive contract pauses itself and the vault.

**Why Reactive is essential, not bolted on.**
1. The reactive contract configures itself from the vault's events, so users set rules in one place.
2. It changes its own subscriptions at runtime (CRON, deposits). An idle or paused Flowlet costs nothing.
3. The circuit breaker runs on Reactive: a revoked mandate stops callbacks at the source.
4. Omni's ~1 s finality makes auto-save feel instant.

**Proof, not promises.** The *Live Reactive Proof* timeline rebuilds every action from on-chain logs: origin event →
Lasna reactive tx → callback through Reactive's proxy → rule decision → transfer, with explorer links and per-leg
latency. Each callback is shown to come from Reactive's callback proxy, not from the user or the page.

**Craft.** 21 Foundry tests (full-loop simulation, circuit breaker, daily limit, reserve override, fuzzing), a
one-click RUN DEMO, a local two-chain rehearsal, a CLI, and a report script for the submission.

**Who it's for.** Anyone paid in stablecoins (freelancers, DAO contributors, remote workers) who wants rent,
savings and safety handled automatically without trusting a bot.
