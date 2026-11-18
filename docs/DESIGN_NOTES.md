# Flowlet design notes

**Direction: "Night current."** Flowlet is automation you can watch working. The UI is calm and dark, with soft aurora light behind the hero. The brand is a current: a wave mark, a flow rail (Your wallet → Reactive brain → Vault rules) with dots travelling along it, and a proof timeline where every row lights up as a reactive loop completes on-chain. It keeps Flowlet's own identity, distinct from Kindly's light "Quiet trust" look. It shares Kindly's polish rules: one easing curve, calm defaults, AA contrast and reduced-motion support.

## Palette

| Token | Hex | Use |
|---|---|---|
| bg | `#0A0E13` | page |
| surface | `#111821` | cards |
| surface-2 | `#16202B` | nested panels, trace legs (opaque so the connector line never shows through) |
| text | `#E8EEF2` | primary text |
| muted | `#A3AFBA` | secondary text (AA on every surface) |
| dim | `#8D9AA7` | captions, step numbers. Raised from `#6B7885` after axe-core flagged it |
| mint | `#5BE3B0` | primary action (RUN DEMO), success, auto-save |
| lilac | `#A99BFF` | the reactive brain (Lasna), mandate |
| sky | `#7CC4FF` | wallet, origin events |
| peach | `#FFB38A` | standing orders (rent), local-network pill |
| rose | `#FF8FA3` | guard tripped, revoked, danger |

Nav links use `#B6C2CC`, the eyebrow uses `#B6C2CC` and status pills use 12 to 16% tints of their accent. The hero headline runs a mint → sky → lilac gradient.

## Type (Google Fonts)

- **Bricolage Grotesque** 700 for display: the hero is about 76px with letter-spacing −0.04em, section titles 26 to 28px. This was the expressive free display face we picked from the type resources in the @amananimates and fontinlogo posts.
- **Geist** for the UI (body 15 to 16px).
- **Geist Mono** for eyebrows (uppercase, +0.12em), hashes, step numbers and the activity log.

## Layout

1. **Hero:** headline and story on the left, with the flow rail below them. On the right is the **One-click rehearsal** card: RUN DEMO plus 10 numbered steps that tick as the on-chain demo advances.
2. **Stats strip:** wallet balance, saved, rent paid and Flowlet mandate. Each card has a 2px accent top border, and the number bumps when it changes.
3. **Live Reactive Proof:** a timeline of reactive loops. Each loop shows 5 legs (origin event → reactive tx on Lasna → callback via Reactive's proxy → rule evaluation → action), with latency chips. The empty state is a dot-matrix loader.
4. **Reactive brain** (subscriptions as switches) | **Safety Guard** (daily limit, reserve, "Revoke = stop").
5. **Funds & permissions:** wallet, the most Flowlet may move (the allowance), what's left today and the emergency reserve. Then a can/can't list, the recovery path and the on-chain privacy note. **How your funds are protected** opens a native `<dialog>`.
6. **Your rules** table, the manage forms (kept in a details block), and the activity log.

## Motion

- The aurora is three blurred colour blobs that drift over 22s (ease-in-out, alternating). The flow-rail dots travel along it every 2.4s. The logo wave strokes itself, and the live dot pings. RUN DEMO has a shimmer sweep and shows a dot-matrix spinner while running, then a done state.
- **Wow moment:** when a new reactive loop lands, its proof card fades in. The legs stagger in (`legIn`, about 400ms apart, so the loop reads left to right in about 2s). A pulse sweeps left → right along the connector over 2.2s, and the "sent by Reactive's callback proxy" badge glows once at the end. The headline badge counts "N reactive loops · live".
- Timeline updates are keyed (`nonce:pending`), so existing rows only update their "Xs ago" text and never re-animate.
- Easing is `cubic-bezier(.22,1,.36,1)` for UI, 160 to 260ms (stat bump 600ms). `cubic-bezier(.65,0,.35,1)` is used only for ambient loops.
- `prefers-reduced-motion: reduce` removes the aurora drift, the travelling dots, shimmer and the leg stagger. State changes still show instantly.

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

All fonts are free Google Fonts. Icons are inline SVG or Unicode, and the backgrounds are pure CSS. No paid assets.
