# Flowlet – full-loop evidence (eth-sepolia)

Generated 2026-11-18T15:16:04.014Z from RPC data.

| Nonce | Rule | Origin (eth-sepolia) | Reactive tx (Lasna) | Callback tx (eth-sepolia) | Via callback proxy | Decision | Moved | origin→Lasna | origin→callback |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Standing order | Order #0 due [0xadb2033d…](https://sepolia.etherscan.io/tx/0xadb2033d02077fb1a678e8c720277cd26c6cdf3f6fdd56f40e771d5b8da9e6fb) | [0x384be8c1…](https://lasna.reactscan.net/tx/0x384be8c181648137c8dd9802e5dcda774d9e18854eade7a2ed72320d9beaa568) | [0xbb963e36…](https://sepolia.etherscan.io/tx/0xbb963e3664dd62ece8b31ef37b9dd4b2bdf1c5ea16d4274e5049b302ea22afc7) | yes | Executed | 25 | 10s | 24s |
| 2 | Auto-save | Deposit of 1,000 tUSD [0x765ab31a…](https://sepolia.etherscan.io/tx/0x765ab31a952aa34bbfbca6e53cccee2793178be98bd7933c7cba1a34c4844bcb) | [0x1124cd20…](https://lasna.reactscan.net/tx/0x1124cd205e36b9bf7052c5bdf1af0870964462a2edcd207cc78f7e778d6fbf3f) | [0x9c498032…](https://sepolia.etherscan.io/tx/0x9c498032896cfe348df69b275b9b7a3be39df5356644f723635d5b3da4da3cda) | yes | Reserve override | 100 | 0s | 12s |
| 3 | Standing order | Order #0 due [0xbb963e36…](https://sepolia.etherscan.io/tx/0xbb963e3664dd62ece8b31ef37b9dd4b2bdf1c5ea16d4274e5049b302ea22afc7) | [0xdc3ff283…](https://lasna.reactscan.net/tx/0xdc3ff2834a0c68c1fb1fdc4ce8c26f2c5821c70a3bd0b14d6761e6bfc10ee79a) | [0xaec91c40…](https://sepolia.etherscan.io/tx/0xaec91c403e66a10d7b68dbffccbab92066476aa10ad11d9de69ec8b195cd32ef) | yes | Executed | 25 | 2s | 12s |
| 4 | Standing order | Order #0 due [0xaec91c40…](https://sepolia.etherscan.io/tx/0xaec91c403e66a10d7b68dbffccbab92066476aa10ad11d9de69ec8b195cd32ef) | [0x7bef8106…](https://lasna.reactscan.net/tx/0x7bef81063482c04ac98dac19a30ab2c035a1f2a3d8837410dd6b3baaa1f18761) | [0x2395d899…](https://sepolia.etherscan.io/tx/0x2395d899e8ee6688b0837f614235412475671fdaeebd1f68dbedbd09c58635f7) | yes | Executed | 25 | 6s | 12s |
| 5 | Safety Guard | Allowance set to 0 [0x73b15853…](https://sepolia.etherscan.io/tx/0x73b1585314bb627bdca44fa5d91154894cdcbea9243cb61105bb2a70a09ec197) | [0x80f5a6e1…](https://lasna.reactscan.net/tx/0x80f5a6e14014b0db204c059998aacd6ae883391768e0d0309b4b27d34f38faf3) | [0x4e543009…](https://sepolia.etherscan.io/tx/0x4e5430092a2fd0f18e3d13c9d913646a6fb68b8dadf80fcae38ccda6df37d011) | yes | Mandate revoked | 0 | 1s | 24s |

## What happened

- **#1 Standing order:** Paid 25 tUSD to 0x1a4d…1a4d (order #0).
- **#2 Auto-save:** Auto-save wanted 200 tUSD of the 1,000 tUSD deposit, but the emergency reserve rule overrides it: saved 100 tUSD so the wallet stays above its reserve.
- **#3 Standing order:** Paid 25 tUSD to 0x1a4d…1a4d (order #0).
- **#4 Standing order:** Paid 25 tUSD to 0x1a4d…1a4d (order #0).
- **#5 Safety Guard:** The allowance was revoked. Reactive paused itself, dropped its CRON and deposit subscriptions, and paused the vault.

For standing orders the origin is the transaction that set the due time, and latency is measured from the due timestamp (it includes the CRON cadence).
