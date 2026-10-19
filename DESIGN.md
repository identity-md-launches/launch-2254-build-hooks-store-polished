# Offline page design

## Overview

This Website project now exports a terminal offline notice for visitors to the existing Hooks Store URL. The only visible content is the exact sentence “This site is offline.” A single normal-flow text block on white communicates the state immediately, including at 390 CSS pixels. There is no primary action because the explicit withdrawal brief forbids controls and navigation.

Root `index.html` is the source of truth. `scripts/build-offline.mjs` copies it unchanged into `dist/index.html` and `dist/404.html`. The preserved application's `src/styles.css` and React components are outside the published design.

## Colors

The two literal color values are in `index.html:12`: foreground `#111`, page background `#fff`. No custom-property tokens, accent colors, status ramps or theme variants are implemented. Color is not the only status cue: the sentence states the offline condition. The pinned Chromium probe measured this rendered text/background pair at **18.88:1**. There are no translucent layers or images behind it.

## Typography

`index.html:12` declares `font: 1rem/1.5 system-ui, sans-serif`. The single `h1` inherits that font (`index.html:14`) and uses normal weight 400, normal letter spacing and natural sentence case. Chromium measured 16px text and 24px line height at its default text size. No fonts are downloaded, and no particular installed font is assumed. Text is selectable and may wrap naturally; there is no clipping, ellipsis, fixed height or `nowrap` rule.

The native `main` landmark and single `h1` provide semantic hierarchy without increasing the visual type size. English is declared on the document.

## Layout

`body { margin: 2rem; }` at `index.html:13` provides the only spacing value (32px at the tested default font size). `h1` has zero margin. The content follows normal block flow, with no grid, fixed positioning, viewport-height constraint, breakpoint or device-specific variant.

Chromium checks at 320, 390, 768 and 1440 CSS pixels found no horizontal overflow; the text starts 32px from the top at the default size. The inspected 390 and 1440 screenshots show the complete notice on the first screen. A separate 200% root-text-size check at 320px preserved the message without horizontal overflow. This was text enlargement, not browser-native zoom. WebKit, physical devices and native zoom remain unverified.

## Elevation & Depth

The page is flat. No shadows, cards, overlays, borders or stacked surfaces exist.

## Shapes

There are no shaped components, radii, decorative graphics or clipping rules.

## Components

The sole pattern is `main > h1` at `index.html:18`. It has one static offline state and no props, event handlers, focusable controls, loading states, hover states or error-recovery action. There is no motion. A keyboard Tab check found no page focus targets. An accessibility-tree/source check is not a screen-reader test; no screen-reader session was performed.

The head contains a title, description, `og:title`, viewport and `noindex,nofollow,noarchive` metadata. Its CSP allows inline styling and denies all other resource types by default; base URLs and form submission are also disabled (`index.html:5`). Favicon and `og:image` are intentionally absent because the task permits only three output documents and inline styling.

## Maintenance rules

- Keep the visible sentence exact and retain the semantic landmark and heading.
- Use the root inline style block; preserve natural wrapping and relative text sizing.
- Rebuild both HTML documents with `node scripts/build-offline.mjs` after a source edit.
- Keep all old application files, configuration and assets outside `dist/`.
- Do not add navigation, calls to action, scripts, images, fonts, wallet flows or network activity to the offline page.

## Attribution

The implementation and six-domain review used the pinned Better Interface guidance by Jakub Krehel ([source](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT). The documentation method is adapted from Paul Bakaus's Impeccable ([source](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0). The supplied combined license is retained in [docs/design-guidance-LICENSE.txt](docs/design-guidance-LICENSE.txt).
