# The Hooks Store design system

All styling is in `src/styles.css`, a single plain-CSS file of custom properties and class names. There is no
CSS-in-JS, no Tailwind and no theme provider. Shared React primitives are in `src/components/ui.tsx`.

## Overview

The store is for people who browse, commission and deploy Uniswap v4 hooks on Robinhood Chain. Its look follows
a Steam-style storefront: dark blue-slate surfaces, a sky-blue accent for navigation and selection, and a green
"buy" color reserved for the main action on each screen. Density is moderate. Content sits in one 1120px
column. Cards and lists carry the information, and long protocol values (addresses, hashes) are set in
monospace and wrap anywhere. There are three destinations (Browse, Create, My workspace) under one header. The
operator page uses the same components and is reached only from the footer.

## Colors

Defined at `src/styles.css:2-19`. There is one dark theme (`color-scheme: dark`) and no light variant.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#171d25` | Page background, `theme-color` |
| `--surface` | `#1e2833` | Cards, buy box, stepper items, chips, sheet |
| `--raised` | `#2a3a4d` | Default button fill, hovered cards and rows, current stepper step |
| `--line` | `#34465c` | Borders, dividers, inactive stepper underline |
| `--text` | `#c7d5e0` | Body text |
| `--strong` | `#ffffff` | Headings, labels, button text, focus outline |
| `--muted` | `#9aa6b1` | Hints, secondary text, `dt` labels |
| `--accent` | `#66c0f4` | Links, active nav and tab underline, selected chip and segment, focus of selection |
| `--buy` / `--buy-hover` | `#5c7e10` / `#6e9614` | Primary action (`.btn.primary`, `.cta`) only |
| `--ad` | `#e5b143` | The `#ad` badge. `.card.ad` uses a tinted surface `#262418` |
| `--ok` / `--bad` | `#8bc34a` / `#ff7a6b` | Passed checks and done steps / errors and invalid fields |
| `--info-bg`, `--warn-bg`, `--err-bg`, `--ok-bg` | `#1f3347`, `#3a3220`, `#3d2226`, `#22331f` | `Notice` tones and the preview banner |

Fixed one-off values: header `#12171e`, input fill `#0f141a` (also `.tag` and `.code`), hover border
`#46607c`, active fill `#3e5470`, chip/segment text on accent `#0b1a26`, and the chat bubble for your own
messages, `#1f3a55`. The design-critic probe measured all rendered text on the Browse page at 320/390/1440 as at
least 4.5:1 (3:1 for large text). Other pages were not contrast-measured; see `VALIDATION.md`.

## Typography

- Family: `--font` = `"Motiva Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`. No font file
  is bundled. Motiva Sans is used only where the visitor already has it installed; otherwise the system UI font
  renders. `--mono` = `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace` for addresses, hashes and calldata.
- Weights: 400 body, 600 headings, labels, buttons and nav, 700 brand, totals, step numbers and the `#ad` badge.
- Scale (`src/styles.css:20-26`), six sizes:

| Token | Size | Role |
| --- | --- | --- |
| `--t1` | 13px | Hints, errors, tags, chips, badge, banner, footer, mono values, mobile nav |
| `--t2` | 15px | Body (`body`, line-height 1.55) |
| `--t3` | 17px | `h3`, brand, lede |
| `--t4` | 21px | `h2`, price |
| `--t5` | 28px | `h1`; Browse hero `h1` below 760px |
| `--t6` | 36px | Browse hero `h1` at desktop |

- Headings use line-height 1.2 and `text-wrap: balance`. Paragraphs cap at `70ch`. There is no uppercase
  styling and no letter-spacing anywhere.

## Layout

- Spacing scale `--s1…--s7` = 4, 8, 12, 16, 24, 32, 48px (`src/styles.css:27`). Gaps within a group use
  `--s2`/`--s3`, gaps between fields use `--s4`, and gaps between page sections (`.block`) use `--s6`.
- `.wrap` is the content column: `max-width: 1120px`, inline padding `--s4`. The header (`.top-in`) uses the same width.
- Grids: `.grid` is `repeat(auto-fill, minmax(260px, 1fr))` for hook cards. `.detail-head` is `1fr 320px` (content
  plus buy box). `.kv` rows are `160px 1fr`. `.row2` is `2fr 1fr` for paired fields.
- One breakpoint, `@media (max-width: 760px)` (`src/styles.css:203`):
  - The nav moves under the brand row as a full-width three-column tab bar with 44px targets.
  - The hero `h1` drops from `--t6` to `--t5`. `.detail-head`, `.kv` and `.row2` collapse to one column.
  - The Create stepper hides every label except the current step's. Each step button keeps the accessible
    name "Step n: Label".
  - The connect sheet docks to the bottom edge.
- Workspace tabs (`.tabs`) and the Create stepper scroll horizontally rather than wrap. The page itself never
  scrolls sideways at 320, 390 or 1440px.

## Elevation & Depth

The system is flat: no `box-shadow` elevation. Depth comes from tonal layers, `--bg` → `--surface` → `--raised`.
The sticky header (`z-index: 20`) has a bottom border. The connect sheet sits on a `rgba(5, 8, 12, .7)` backdrop at
`z-index: 40`. The skip link is at `z-index: 50`. The only `box-shadow` is the inset 2px underline that marks the
active nav item and workspace tab.

## Shapes

`--r` = 6px for buttons, inputs, cards, notices and the sheet (on mobile the sheet rounds only its top corners).
Tags and the `#ad` badge use 4px. Chips are pills (`999px`). Stepper items have a 3px bottom border, and operator
transaction cards and spec blocks have a 3px left border that encodes state (accent = current, ok = done).

## Components

| Component | Source | Notes |
| --- | --- | --- |
| Buttons | `.btn`, `.btn.primary`, `.cta`, `.cta.ghost`, `.cta.warn`, `.btn.block`, `.btn.link` (`styles.css:65-76`) | 44px minimum height. Hover, active and `:disabled` (opacity .6, not-allowed) states. Primary green is one per screen. Labels start with a verb ("Create a hook", "Approve in wallet") |
| Nav and tabs | `App.tsx` `.nav`, `Workspace.tsx` `.tabs` | Links with `aria-current="page"`, shown with an accent underline |
| Field | `Field` in `ui.tsx` + `.field`, `.hint`, `.err` | `label[for]` is bound to the input. Hint and error sit under the control, and `.invalid` turns the border `--bad` |
| Checkbox confirm | `.check` | Used to confirm the operator's admin and ad-recipient addresses and the bootstrap approval |
| Notice | `Notice` in `ui.tsx` | Tones info, warn, error and ok. Error renders `role="alert"`, the rest `role="status"` |
| Card | `.card`, `.card.ad`, `.card.on`, `.card.slot` | Hook cards are links. Preset cards are buttons. Ad cards carry `AdBadge` (`aria-label="Advertisement"`) |
| Chips | `.chip`, `.chip.on` | Tag filter buttons on Browse |
| Stepper | `.stepper` in `Create.tsx` | `ol` with `aria-current="step"`. The next-action line under it is `role="status"` |
| Segmented control | `.seg` | Two toggle buttons (`aria-pressed`) in a labelled group that switch Create between Guide and Blocks. Both edit the same HookSpec |
| Chat | `.chat`, `.msgs .guide/.you`, `.say` | Preset guidance, labelled as scripted, not live AI |
| Key-value list | `KV` in `ui.tsx`, `.kv`, `.kv.small` | Hook details and transaction parameters |
| Fee table | `.fees` | Build and signed oracle review on separate rows, listing (free), network gas, then a bold "Total before gas" |
| Checks list | `.checks` | Operator preflight and readbacks, each showing expected vs actual with an ok/bad marker in text as well as color |
| Transaction steps | `.txsteps`, `.tx-head`, `.state` | Operator wizard. The state label is text ("Verified", "Next", "Submitted, no receipt yet") |
| Connect sheet | `src/wallet/ConnectSheet.tsx`, `.sheet`, `.row` | EIP-6963 wallets (Rabby and others), Coinbase Smart Wallet, and open-in-wallet links on phones |
| Empty, loading, error | `.empty`, `.empty-line`, `LoadState` in `Workspace.tsx` | Honest messages, never placeholder metrics |

Focus: global `:focus-visible { outline: 2px solid var(--strong); outline-offset: 2px }`, plus a skip link to
`#main`. Motion is limited to 150ms background and border-color transitions, all removed under
`prefers-reduced-motion: reduce`.

## Do's and Don'ts

- Do start a new page inside `<main className="wrap">` with one `h1`. Use `.block` sections with a `.block-head` (h2 plus
  an optional action) and reuse `Field`, `Notice`, `KV` and `.btn`.
- Do keep one green primary action per view. Secondary actions use `.btn`, and inline actions use `.btn.link`.
- Do show every protocol value (address, hash, calldata) with `Mono` so it wraps rather than overflowing.
- Do mark promoted content with `AdBadge` and `.card.ad`. Don't use `--ad` yellow for anything else.
- Do express state in text as well as color (checks, step states, badges).
- Don't add sizes outside `--t1…--t6`, shadows, gradients, uppercase or tracked labels.
- Don't add new breakpoints for a single component. Let grids and wrapping absorb width, and only change layout at 760px.
- Recipe for a new workspace tab: add `{ id, label }` to `TABS` in `src/pages/Workspace.tsx`. Then render a
  `<section className="block">` with a `.block-head` and a `LoadState` around a `.plain.stack` list, with an empty
  message that says what to do next.
