# Flowlet design notes

**Direction: "Clear current"** (light, since Nov 2026). Flowlet is automation you can watch working. It now reads like a modern iOS fintech app, not a neon Web3 dashboard: a soft off-white canvas, pure white floating cards, near-black text and one mint/teal accent. The brand is still a current: a wave mark and a flow rail (Your wallet → Reactive brain → Vault rules). The first version was dark ("Night current"); see the light-direction section below for why it moved.


## Redesign v2: white-first (Nov 2026) — current

This section supersedes the layout above where they conflict.

- **Look:** a white UI (`--bg:#FAFBFA`, cards `#FFFFFF`). `#066A4F` is reserved for important states and actions; mint accents are `#E4F4EC` / `#A8E6CE`.
- **Brand mark:** bubbles, a large white bubble and two mint bubbles on `#066A4F`. Masters are in `docs/brand/`; the favicon, PWA icons and OG image are generated from them.
- **Navigation:** Home · Flows · Activity · Settings (the demo loop has its own `#/demo` screen, reached from Home).
- **Home:** a status card (Watching / Triggered / Executed), metric cards (Active flows, Executions, Allowance), a **My automations** preview, **Recent execution**, **Pause all** and a demo tile.
- **Flows:** one card per automation (rent standing orders, Auto-save, Safety Guard) with View / Create / Edit / Pause. **Pause** is *Pause all*: the vault has no per-rule pause, and the UI says so.
- **Automation detail:** a Basic view (what it does, trigger, amount, status), a lifecycle timeline, and an **Advanced** section: reactive contract, event source, callback proxy, chains (Sepolia / Lasna), addresses, hashes and proof links.
- **Create:** a 5-step guided flow (type → trigger → amount → safety → review). Only triggers the contracts support can be activated; price and whale triggers are labelled **Coming soon**. Activation submits the existing on-chain rule forms (owner only).
- **Activity:** filters Watching / Triggered / Executed / Failed / Paused, and a lifecycle timeline per loop: Event detected → Trigger verified → Callback sent → Execution confirmed. When no live loop exists, the recorded run is shown with a clear "recorded" label.
- **Settings:** Wallet / Automation (Pause all, Funds & permissions) / Preferences (Notifications — *coming soon*, Security & privacy) / About (About Flowlet, Testnet information).

## Palette

| Token | Hex | Use |
|---|---|---|
| bg | `#F7F7F8` | page |
| surface | `#FFFFFF` | cards, settings groups |
| surface-2 | `#F2F4F6` | nested panels, trace legs (opaque so the connector line never shows through) |
| text | `#0F1720` | primary text |
| muted | `#55606B` | secondary text (AA on every surface) |
| dim | `#58636E` | captions, step numbers. Darkened from `#616C77` after axe-core flagged it at 4.48:1 |
| mint | `#066A4F` | the single accent: primary action (Run demo), success, auto-save. Darkened from `#087A5B` so 12px badges on tinted panels pass AA |
| lilac | `#5644C9` | the reactive brain (Lasna), mandate |
| sky | `#1A62A0` | wallet, origin events |
| peach | `#9A4E17` | standing orders (rent), local-network pill |
| rose | `#B02A47` | guard tripped, revoked, Pause |

Status pills use 9 to 12% tints of their accent with the solid accent as text. Radius is 24px for cards and 16px for controls; shadows are two soft layers (`0 1px 2px` + `0 10px 30px` at 4 to 6% ink). The hero accent line is solid mint (no gradient text). The aurora glow from the dark version is switched off.

## Type (Fontshare, self-hosted)

- **Cabinet Grotesk** 700 to 800 (Fontshare) for display: the hero, section and status titles.
- **Switzer** 400 to 600 (Fontshare) for the UI and for every number (balances, stats, fund grid). Cabinet Grotesk has no tabular figures; Switzer's digits are equal-width, so numbers that update in place don't jitter.
- **Geist Mono** (variable, OFL) for hashes, step numbers and the activity log.
- Self-hosted woff2 in `web/fonts/`, `font-display: swap`, Switzer 400 and Cabinet 700 preloaded, CSP `font-src 'self'`, no font CDN.
- **License.** Fontshare's ITF Free Font License allows personal and commercial use and self-hosting on our own site, but not redistribution from a repository or conversion of the files. The Cabinet Grotesk and Switzer files are gitignored and fetched with `bash scripts/fetch-fonts.sh web/fonts cabinet-grotesk@500 cabinet-grotesk@700 cabinet-grotesk@800 switzer@400 switzer@500 switzer@600`. Geist Mono is OFL and committed with `web/fonts/OFL-NOTICE.md`.

## Layout

1. **Hero:** headline and story on the left, with the flow rail below them. On the right is the **One-click rehearsal** card: RUN DEMO plus 10 numbered steps that tick as the on-chain demo advances.
2. **Stats strip:** wallet balance, saved, rent paid and Flowlet mandate. Each card has a 2px accent top border, and the number bumps when it changes.
3. **Live Reactive Proof:** a timeline of reactive loops. Each loop shows 5 legs (origin event → reactive tx on Lasna → callback via Reactive's proxy → rule evaluation → action), with latency chips. The empty state is a dot-matrix loader.
4. **Reactive brain** (subscriptions as switches) | **Safety Guard** (daily limit, reserve, "Revoke = stop").
5. **Funds & permissions:** wallet, the most Flowlet may move (the allowance), what's left today and the emergency reserve. Then a can/can't list, the recovery path and the on-chain privacy note. **How your funds are protected** opens a native `<dialog>`.
6. **Your rules** table, the manage forms (kept in a details block), and the activity log.

## Motion

- The aurora is three blurred colour blobs, now **static** (the anti-slop pass removed the endless drift). The flow-rail dots travel only while the demo runs (`body.demo-running`). The logo and the live dot are still. Run demo is a solid mint button with no shimmer; it shows a spinner and `aria-busy` while running, then a done state.
- **Wow moment:** when a new reactive loop lands, its proof card fades in. The legs stagger in (`legIn`, about 400ms apart, so the loop reads left to right in about 2s). A pulse sweeps left → right along the connector over 2.2s, and the "sent by Reactive's callback proxy" badge glows once at the end. The headline badge counts "N reactive loops · live".
- Timeline updates are keyed (`nonce:pending`), so existing rows only update their "Xs ago" text and never re-animate.
- Easing is `cubic-bezier(.22,1,.36,1)` for UI, 160 to 260ms (stat bump 600ms). `cubic-bezier(.65,0,.35,1)` is used only for ambient loops.
- `prefers-reduced-motion: reduce` removes the travelling dots and the leg stagger. State changes still show instantly.

## Which source inspired what

| Source | What we took |
|---|---|
| ChatGPT critique for Kindly (shared spec) | Polish rules applied here too: one primary action, persistent states over toasts, a calm hierarchy, confirm dialogs for destructive actions, and a 10-to-15-second wow sequence |
| ChatGPT security & privacy guidance | Funds & permissions panel, "How your funds are protected" modal, recovery path, "What's visible on-chain", and the line "Flowlet doesn't hold your money. It holds your rules." |
| @amananimates 2113599514103906657 (animated shader backgrounds, scrolltide, free typefaces, easing curves) | The aurora is a CSS-only take on the animated gradient-mesh shader backgrounds. Also the single ease-out curve and the free expressive display face |
| @Skirook 2116857233887907988 (dotmatrix loaders, devault ASCII, motionin, quickpick) | Dot-matrix loaders (the empty proof state and the step spinner), the mono "terminal" eyebrow style, and the numbered step list |
| @iamtanzil_ 2117951858404913336 (jiro.build, land-book, godly, 60fps.design, 3dicons) | A dark gallery-style SaaS hero with a product object (the rehearsal card) beside the headline. Micro-interactions at 60fps (stat bump, button states) |
| @Skirook 2119305314759749692 (DESIGN.md resources) | This file as an agent-readable design system |
| @creativedash 2118192577849741393 (iconmcp) | Small, consistent glyph icons in tinted tiles (⌂ rent, ❀ save, ✦ brain) |
| @e1genqq 2122435244028542995 (UI UX Pro Max, Penpot, shadcn/ui, Radix, Tailwind, Lucide, Motion, Magic UI, Storybook, axe-core, Playwright) | Radix-style accessible primitives (native dialog, switch roles, focus rings), Magic UI–style shimmer and glow, and the testing step: **axe-core** reports 0 WCAG 2 A/AA violations, and a headless browser flow test runs the full demo |
| @BNBCHAIN 2123020505083199585, @Zorvh87 2123041742371140030 | Not design (a hackathon and a bug-bounty list) |

All fonts are free (Fontshare FFL + OFL). Icons are inline SVG and the backgrounds are pure CSS. No paid assets.

## Anti-slop audit (Nov 2026)

Source: @achxvi's post "10 skills that kill AI slop" (x.com/achxvi/status/2123016367125540918). We read all 10 as reference text only. Nothing was installed and none of their scripts were run: uizze.com, pbakaus/impeccable, Leonxlnx/taste-skill, emilkowalski/skills, vercel-labs/web-interface-guidelines, anthropics/skills (frontend-design), Nutlope/hallmark, jakubkrehel/make-interfaces-feel-better, nextlevelbuilder/ui-ux-pro-max-skill and benjitaylor/skills.

**The 3 we used as the checklist:**
1. **Vercel Web Interface Guidelines.** These are concrete, testable MUSTs: focus-visible, hit targets, `aria-live`, form errors next to the field, `color-scheme`, tabular numbers and skip links.
2. **Emil Kowalski's design-eng skill.** Motion rules: strong ease-out curves, short durations, `scale(.97)` on press, never `ease-in`, and no animation on things people see a hundred times.
3. **Anthropic frontend-design.** A list of slop tells: gradient headline text, ALL-CAPS tracked eyebrows, emoji icons, endless ambient motion, shimmer CTAs and the default card kit.

Jakub Krehel's make-interfaces-feel-better was a secondary reference for tabular nums, `text-wrap` and hit areas.

| Before | After |
|---|---|
| Gradient-filled headline accent (`.grad`) | Solid mint `.accent` |
| Emoji and Unicode icons (◎ ✦ ⇢ ⌂ ❀ ◈ $ ✓ ✕) | One inline SVG stroke set |
| ALL-CAPS tracked eyebrows, leg labels and table heads | Sentence case; several decorative eyebrows removed |
| Aurora drifting forever, logo stroke loop, pinging live dot, CTA shimmer | Static. The rail dots animate only while the demo runs |
| Network shown as one text pill | Chain identity chips: Ethereum Sepolia (ETH glyph) and Reactive Lasna. Local runs show "Local rehearsal" plus "(anvil)" chips |
| Amounts printed as plain "tUSD" text | tUSD token badge, with tabular figures everywhere |
| Raw addresses and tx hashes | Hash chips with a copy button (screen-reader announced) and an explorer link |
| No skip link; demo log announced every line | Skip link to `main`; a polite `#srStatus` live region for outcomes; the log is `role=log`, `aria-live=off` |
| Form errors only in a toast | Inline `.ferr` message under the form, and focus moves to the field |
| No `color-scheme` (native controls and scrollbars were light) | `color-scheme: dark` |
| Mixed button heights, no press feedback | 44px minimum, `scale(.97)` on press, 16px inputs on mobile (no iOS zoom) |
| "RUN DEMO" / "Approve 2000" | "Run demo" / "Allow 2,000 tUSD", plus a note that it uses throwaway test money |
| A hidden Connect button still showed on local (`.btn` beat `[hidden]`) | `[hidden] { display: none !important }`, and button labels no longer wrap |

**Considered and kept:** the mint accent (Flowlet's own identity, distinct from Kindly; the dark palette was later replaced, see the light direction below) and the numbered demo steps (a real sequence, not decoration). The proof-card leg stagger stays because it is the one-time wow moment, and it is skipped under reduced motion.

Verified with axe-core (0 violations), a headless Run demo (all 10 steps), `forge test` (24/24) and fresh screenshots in `docs/img/`.

## Native app shell (Nov 2026)

Flowlet is a PWA, not an APK: it installs to the home screen and opens full screen.

- **Tabs:** Home · Flows · Activity · Settings (was Status · Timeline · Proof · Settings; old links still land on the right tab). Bottom tab bar on phones (≤640px), an icon rail on tablet, a 240px sidebar on desktop. Tabs are peers: switching is instant (no slide), each tab opens at its top, and re-tapping the active tab scrolls back up.
- **Automation status card** (top of Home): "Your automation is live / Waiting for trigger…", the track Monitoring → Triggered → Executed, and the "Monitoring · Reactive Lasna" chip. Every state comes from the vault, the reactive contract or the on-chain trace: Triggered is a real pending loop (the reactive tx landed on Lasna, the callback hasn't), Executed is a freshly completed loop and stays for 9s. Paused and revoked states say so. **Replay the last real loop** walks the newest completed loop with its real transaction links, no wallet needed.
- **Phone details:** safe areas, `interactive-widget=resizes-content`, a sticky Run demo above the tab bar, dialogs as bottom sheets with a grabber and drag-to-dismiss, the rules table as stacked rows, icon-only chain chips, 16px inputs, no long-press callout on chrome, tap highlight off, overscroll contained.
- **Wallet on phones:** without an injected provider, Connect or Run demo opens a sheet with **Open in MetaMask** (`https://link.metamask.io/dapp/<host>/…`) plus Replay and the live timeline. Wrong network shows a banner with Switch network; accountsChanged to empty disconnects.
- **PWA:** manifest (standalone, `#F7F7F8`), icons 192/512/maskable/apple-touch, `sw.js` v2 network-first for the shell, cache-first for the self-hosted fonts. It never caches `deployments/*.json`, RPC, explorer or wallet traffic. Offline shows "You're offline. Wallet and automation state may be outdated…". An install hint uses `beforeinstallprompt` (Android) or Share → Add to Home Screen (iOS).
- **Desktop (≥1024px):** sidebar + top bar with chains and wallet. Status at ≥1280px is two columns: hero, live status and timeline on the left, stats and the reactive brain / Safety Guard in a 400px column on the right. The tablet layout is the icon rail with one column.

### Sidebar patterns from navbar.gallery (side-bar type)

Studied for patterns only (Aveon, Bud, Ayush Wanjari, Significa, Three Circles):

- **Groups with quiet sentence-case labels:** Automation (Status, Timeline) · Trust (Proof) · Account (Settings).
- **Active state:** a filled surface pill with a hairline border, the icon in mint, `aria-current="page"`.
- **Account block at the bottom:** the wallet card (address in mono, "Vault owner · network"), which connects or shows the wallet. Hidden on the local rehearsal, which uses demo keys.
- **One prominent action:** **Pause all rules** in rose above the wallet. It opens Settings → Manage rules and focuses the real Pause all button; pausing still needs a tap and a wallet confirmation.
- **Collapsible rail:** desktop collapses to a 92px icon rail (remembered); tablet's rail expands into a drawer. `aria-expanded`/`aria-controls`, `title` tooltips, labels kept for screen readers.
- **Keyboard:** skip link, focus rings, Up/Down/Home/End between destinations, Escape closes the drawer.

### What we took from the three skill repos (@jaimintf post), read as text only

- **Appllama (main source):** tab bar of peers, re-tap to top, the page title in the app bar, sheets with grabbers, press feedback by role (tab items dim, buttons scale 0.97).
- **Expo skills (transferable rules):** 44px targets, 16px inputs, safe areas, no long-press callout, haptics as punctuation (one tick when a real loop executes, Android only, never the only signal), and avoiding native slop (floating pill tab bar, X-only sheets, a grand entrance).
- **Emil Kowalski:** ease-out 150 to 250ms, exits faster than entrances, no animation on tab switches, reduced-motion fallbacks. The old tab slide was removed in this pass.
- **Honest gap:** no dark mode. Flowlet is a single light theme ("Clear current"); the earlier dark "Night current" was retired in Nov 2026.

### Design resources from @iamtanzil_ (2108066324907962575), guidance only

| Resource | What we took |
|---|---|
| AppShot Gallery | Finance and wallet app screenshots: status first, one big number, plain rows, the primary action at the thumb |
| Component Gallery | Tabs, sidebars, sheets, steppers and empty states as mature systems build them: the status track is a stepper with `aria-current="step"`, empty states give one line of why and one action |
| Refero Styles | Type and spacing check for the Cabinet Grotesk + Switzer pairing: display face for titles only, UI face for numbers and body |
| MicroKit, Motion Primitives | Ideas rebuilt in plain CSS/JS, no dependencies: the copy-hash check pops in (0.6 → 1, 160ms) with a screen-reader "Copied"; the status title settles in (opacity + 4px, 200ms) when Waiting → Triggered → Executed changes |
| Minimal Gallery | Restraint check: one accent per state, no decoration that doesn't carry state |

Deliberately skipped: gradient buttons, liquid glass, CSS text effects, 3D icons, and flashy Aceternity / Magic UI effects (beams, spotlights, count-up numbers). They conflict with the anti-slop rules.

## Light iOS fintech direction (ChatGPT, Nov 2026)

The brief: look like a modern iOS fintech app, not a neon Web3 dashboard. What changed and why:

- **Dark to light.** Flowlet moved from "Night current" to a light theme: `#F7F7F8` canvas, white cards, near-black text, radius 24, soft shadows, round icons and avatars. Its accent is mint/teal (`#066A4F`) so it never looks like Kindly's coral.
- **Four tabs.** Home (automation status card, balances, run/replay demo, the flow rail), Flows (rules, Safety Guard, reactive brain), Activity (live proof timeline, contracts, log) and Settings. `#/status`, `#/timeline` and `#/proof` redirect; the pre-tab anchors too. On desktop the Home tab is a two-column dashboard: status + stats on top, the hero and run panel full width, proof next to the reactive brain.
- **Pause all rules is always one tap away:** the primary button on the Home status card, the first row of Settings → Security & Permissions, and the sidebar footer on desktop. It is the existing pause, not a new one, and it still asks MetaMask to sign. When access is revoked the button becomes "Review access", because there is nothing left to pause.
- **iPhone-style Settings.** Grouped rounded lists: Wallet (the MetaMask fox, short address, a Connected pill; Networks with a Testnet pill), Security & Permissions (Pause all rules, Funds & permissions with a Secured pill, how funds are protected, what's visible on-chain), Notifications, Help & Support (Replay the last real loop, source code), and Disconnect wallet. The funds panel and install card sit next to it on desktop.
- **Notifications are honest.** The row says Triggered and Executed show on Home as they happen and that push notifications aren't available. We don't ask for a permission we wouldn't use.
- **Disconnect** calls `wallet_revokePermissions` (MetaMask supports it; other wallets ignore it) and forgets the account in the page. It never claims to log the wallet out.
- **Crypto details moved to detail screens.** Home shows words and small status pills (Active, Connected, Secured, Waiting). Hashes, contracts and chain IDs live in Activity and in the sheets.
- **Icons are Lucide** (ISC license, v0.460.0) drawn inline as SVG. No emoji icons. The Settings tab uses Lucide's gear. The Ethereum and Lasna chain glyphs stay custom.
- **MetaMask fox.** `web/brand/metamask-fox.svg` is the official fox from the MetaMask logo pack on metamask.io/assets, unmodified (not redrawn, recoloured or stretched). It only appears next to the words "MetaMask" (Open in MetaMask, Get MetaMask, the connected-wallet row), on a white or neutral background, and nothing suggests MetaMask endorses Flowlet. The assets page lists the colours but no written usage rules, so we followed the usual brand-pack norms.
- **No WalletConnect logo.** Flowlet only supports injected wallets, so showing WalletConnect would promise something that isn't there.
- **Docked tab bar, not a floating pill.** The brief asked for "floating" UI; we float the cards (white on off-white, soft shadows) but keep the bottom bar docked, because Expo's native-feel guidance lists a floating tab pill as a web-app tell, and a docked bar keeps 44px targets above the home indicator.
- **Kept:** the Run demo, Replay the last real loop, the proof timeline with tx links, funds sheet, trust and privacy sheets, offline notice, focus rings, 44px touch targets and 150 to 250ms ease-out motion. Verified again with axe-core on phone, tablet and desktop (0 violations), a full Run demo on the local stack, and `forge test` (24/24).

## Phase 3: control center, proof, honest modes (ChatGPT critique, Nov 2026)

- **Welcome screen.** The marketing story moved off Home into `#/welcome` (shown once on a first visit with no link hash): "Your wallet. Your rules. Automatic execution.", an Event → Reactive → Action rail, and three paths: Connect wallet · Try live; Explore demo without wallet; Watch the 60-second walkthrough (says there is no video yet). Settings → Welcome screen brings it back.
- **Home is a control center.** Automation state (Watching → Triggered → Executed), "What rule is running?" as a When / Then / Guard / Network list, "Last automation", "View execution proof", and Pause all rules. When the vault is paused or revoked, the whole Home changes: the status card turns amber (paused) or rose (revoked), the stage chips go neutral, the monitoring pill says Reactive is not watching, "When" is marked on hold, and the main action becomes Resume rules or Review access.
- **Pause vs revoke copy.** Pause: every rule stops and Reactive drops its CRON and deposit subscriptions; the allowance is unchanged. Revoke: allowance 0, Reactive pauses itself and the vault, nothing can move. We never call a revoked vault "live".
- **Execution proof sheet.** Three numbered legs (origin, Lasna, callback) with explorer links, then a before → after table read from the callback's own logs (runs, next due time, wallet and receiver deltas, vault running → paused). Recorded rows say "Recorded snapshot".
- **Run demo loop in five numbered steps.** Fund & allow, Set your rules, Reactive subscribes, Salary event, Reactive executes, ending in the three transaction links. It runs live only for the vault owner or the local rehearsal; otherwise the button reads "Replay recorded loop" and plays back real recorded transactions.
- **Mode badge.** `DEMO MODE` / `LIVE TESTNET` / `LOCAL REHEARSAL`, the same documented status-label caps exception as Kindly. The rest of the line is sentence case.
- **Glossary.** Loop, Reactive Lasna, Vault rules, Safety Guard and Allowance, as dotted-underlined buttons that open a short sheet.

## v3: the user's reference style (Nov 2026)

The user rejected the "restrained premium" pass and sent three reference images. v3 follows them closely.

- **Greeting:** a big two-line greeting ("Morning" in bold, then "there" or the short wallet address in a lighter weight) and one helper line.
- **Colour cards:**
  - flat cards (radius 28) with a 3D object each:
    - brand green #066A4F: Active flows, with bubbles
    - violet #6050EE: Executions, with a bolt
    - sky #A8D4FF: Allowance, with a loop and gear
    - mint #A8E6CE: Chains, with connected nodes
  - The numbers are real: they are read from the vault, or from the recorded loops in demo mode, and the revoked and paused states still show on the first card.
  - Contrast:
    - White text only on green (6.6:1) and violet (5.4:1).
    - Dark ink on sky and mint (over 11:1).
- **Layout:**
  - On phones the cards sit in a snap carousel. From 1024 px they become a 4-column row under the greeting.
  - The status card stays first in the content, as a white card. Paused or revoked now shows as a thin tinted ring instead of a pink fill, while the orb and the copy still carry the state.
- **Shortcuts bento:** Demo loop (big mint tile), Full trace (sky) and Funds & permissions (violet).
- **Pills:**
  - "View all" in grey next to semibold section titles
  - pill filter chips with the active one filled black
  - the Watching, Triggered and Executed track as pills
- **Tab bar on phones:**
  - white, with the active icon in brand green and a small orange tab above it (reference 1)
  - labels visually hidden but kept as the accessible name
  - The desktop sidebar is white, with a soft green pill on the active item.
- **Welcome:**
  - a centred floating composition of the four 3D objects
  - a heavy title with a lighter second line
  - the three entry paths as white cards, with Connect as a black pill
  - "Not now · go to the control center" as a text link
- **Unchanged:** the four tabs, the information architecture, the honesty and mode labels, the proof sheets, and every flow.

### What we took from each source (Meng To's design-skills list)

Nothing below is vendored into the app. We read the skills, applied the ideas by hand, and ran one tool locally.

- **Impeccable** (pbakaus/impeccable, Apache-2.0):
  - We ran its browser anti-pattern detector (`detect-antipatterns-browser.js`, `impeccableDetectAsync()`) locally against Welcome, Home and the demo at 390 and 1440 px. It is a test-time tool only and is not shipped.
  - It found two things, both fixed:
    - the 10.4 px "tUSD8" token label, now at least 11 px
    - the tiny "01 / 02 / 03" numbered section labels, now colour tiles with a 3D object
  - From its checklist we also avoided: purple gradients (cards use flat fills), zero-offset glow halos (we use colour shadows offset downward), uppercase kicker labels above headings, grey text on coloured fills, bounce easing, and thin borders paired with wide shadows.
- **Emil Kowalski's skills** (MIT), for motion:
  - ease-out curves, 150 to 250 ms for UI and up to 600 ms only for the one-time entrance of the 3D composition
  - press feedback with `scale(.98)`
  - no animation from `scale(0)`
  - everything gated behind `prefers-reduced-motion: no-preference`
- **MengTo/skills** (MIT):
  - the "reference first" workflow: match the user's three reference images closely, with type scale, card radius, colour blocking and object placement taken from the references rather than invented
- **Stageshow** (benjitaylor/skills, no licence file in the repo, so ideas only and nothing copied):
  - bento grids of mixed tile sizes (the Shortcuts block)
  - composing README, OG and video stills around the hero cards
- **open-design** (nexu-io/open-design, Apache-2.0, ideas only):
  - pairing one heavy display weight with a light secondary line
- **solid-glass** (deeplethe/solid-glass, MIT, nothing vendored):
  - the bottom bar and sheets stay solid and opaque instead of translucent glass, so the text on them keeps AA contrast
