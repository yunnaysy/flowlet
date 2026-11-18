# Demo video script (target 2:45, hard limit < 3:00)

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Title card, then the dashboard | "This is Reactive Autopilot: standing orders and auto-save for your crypto wallet, with no bots and no custody. It runs entirely on a reactive contract." |
| 0:15–0:40 | README architecture diagram | "Users only configure a vault on Base Sepolia. A reactive contract on Lasna listens to the vault's own events, mirrors every rule, turns CRON on only when something is due, and subscribes at runtime to deposits into your wallet." |
| 0:40–1:05 | Dashboard: approve, create order "25 tUSD every 60 s, 3 times" | "I approve a capped allowance, then create a standing order. That's the only thing I do." |
| 1:05–1:25 | lasna.reactscan.net: reactive contract txs (OrderMirrored, CronToggled) | "Seconds later, the reactive contract has picked up the order and switched on its CRON subscription." |
| 1:25–1:50 | Basescan: `executeDue` callback tx, payee balance +25 | "When the order is due, a CRON tick triggers a callback through Reactive's proxy, and the payment lands. Three runs later the order completes and CRON switches itself off." |
| 1:50–2:20 | Enable auto-save 20% ≥ 100; click "Simulate salary" (mint 1,000) | "Now auto-save. A salary of 1,000 tUSD arrives, and a few seconds later 200 goes to savings. Omni's one-second finality is what makes this feel instant." |
| 2:20–2:40 | Terminal: `node scripts/report.mjs` table | "Every loop is on-chain: origin transaction, Lasna reactive transaction, callback transaction, with measured latency." |
| 2:40–2:50 | `forge test` output | "17 tests cover the full loop, security checks and fuzzing. The code is open source. Thanks!" |

Recording tips: pre-deploy, keep `scripts/autopilot.sh cron fast` during recording, have Basescan and Reactscan tabs
open, and cut waiting time.
