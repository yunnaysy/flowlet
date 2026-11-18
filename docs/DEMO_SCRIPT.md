# Flowlet: demo video script (target 2:40, hard limit < 3:00)

Setup before recording: contracts deployed (`scripts/deploy.sh`), `scripts/flowlet.sh cron fast`, dashboard open at
`http://localhost:8000/web/` with the deployer account in MetaMask (or run `scripts/demo.sh` in a terminal next to
the dashboard), and Sepolia Etherscan + Lasna Reactscan tabs ready. Cut the waiting time in editing.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Dashboard hero | "This is Flowlet: money moves on your rules. Standing orders, auto-save and a safety switch for your wallet, run by a reactive contract on Reactive Network. No bots, no servers, no custody." |
| 0:15–0:35 | README architecture | "You only set rules on the vault on Ethereum Sepolia. The reactive contract on Lasna learns them from the vault's events and subscribes to exactly what it needs: CRON while an order is active, your deposits while auto-save is on, and your allowance at all times." |
| 0:35–0:55 | Press **Run demo loop** (owner wallet); steps 1–5 tick | "One click: test money, a 2,000 tUSD allowance, a daily limit and an emergency reserve, rent of 25 every minute, and auto-save of 20%." |
| 0:55–1:25 | Timeline: Standing order row | "No button paid the rent. A CRON tick on Lasna found it due, Reactive's callback proxy called the vault, the rule was evaluated, and 25 tUSD moved. Here are all three hashes and the latency of each leg." |
| 1:25–1:55 | Salary arrives; Auto-save row with "Reserve override" | "A 1,000 tUSD salary lands. Seconds later auto-save fires, but my emergency reserve rule overrides the 20%, so Flowlet saves only what keeps the reserve intact and explains why." |
| 1:55–2:20 | Revoke step; Safety Guard row; subscriptions switch off | "Now I revoke access. The reactive contract sees the Approval, pauses itself, drops its CRON and deposit subscriptions, and tells the vault to pause. Nothing can move until I resume." |
| 2:20–2:35 | Reactscan + Etherscan tabs, then `forge test` | "Everything is on-chain and verifiable, with 24 tests behind it." |
| 2:35–2:40 | Logo + tagline | "Flowlet. Money moves on your rules." |
