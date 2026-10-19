# Offline withdrawal validation

## Completion and scope

**Incomplete: local replacement export implemented and checked; hosting update and the requested package-script change remain unresolved.**

The only production surface is the exact offline sentence in root `index.html`, exported unchanged to `dist/index.html` and `dist/404.html`. The export also contains `robots.txt`. Existing application/contract source, pinned artifacts, wallet code, public inputs and Git history are preserved. They are outside the export. No Solidity, dependency, lockfile or existing build-configuration edits were made. No deployment, signature or transfer was performed.

The explicit withdrawal requirements govern the generic website criteria: no primary interaction, favicon, share-image asset, navigation or app states were added. The page's visual idea is one plain, immediately visible offline notice on white.

## Requirements

| Requirement | Result and evidence |
| --- | --- |
| Replace root with only “This site is offline.” | Met: `index.html:18`; exact body text checked in source and Chromium. |
| No scripts, entrypoint, links, controls, wallets, forms or remote activity | Met locally: no such elements; Chromium recorded document requests only, zero wallet calls/provider-discovery events and no console/page errors. |
| Minimal inline CSS and restrictive CSP | Met: `index.html:5` and `index.html:11`; default resources denied, inline styles allowed, base URLs/forms denied. |
| `noindex,nofollow,noarchive` | Met: `index.html:7`; verified in the rendered DOM. |
| Built-ins-only clean offline builder | Met: `scripts/build-offline.mjs:1`; source read before deleting output; only three writes. |
| Exactly index, identical 404 and robots output | Met: regression test checks filenames and bytes after each seeded build. |
| Set package `scripts.build` to the Node builder | **Not met:** the task also explicitly prohibits modifying existing `package.json` and says such edits are rejected automatically. That file remains unchanged. The direct Node builder is usable. The conflict was raised; no exception was supplied. |
| Build twice and remove stale files | Met: both rounds seed old JS, maps, config, deployment files, images and nested hidden files; both produce the exact clean output. |
| All named hashes and arbitrary hashes show only the notice | Met locally in Chromium: `/`, `#/browse`, `#/create`, `#/workspace`, `#/operator`, `#arbitrary`, `#/<arbitrary>`, a hook-like hash, subpath navigation and `404.html`; five additional in-document hash changes remain inert. |
| Old asset/config URLs and missing paths | Met locally for twelve paths: HTTP 404 with the offline HTML in the test server. The export contains none of those old files. Real-host behavior remains unverified after an update. |
| Responsive first screen | Met in Chromium: 320, 390, 768, 1440 CSS pixels; complete message is visible without overflow. No main action exists by explicit request. |
| Title, description, `og:title`, favicon, `og:image` | First three met. Favicon and image intentionally omitted to preserve the strict three-document, inline-styling-only export. The generic share criterion is consequently unmet. |
| Source, lockfile and static export retained | Met in the working-tree delivery; original source and lockfile preserved, export regenerated. There are no runtime assets or asset URLs. No repository history was rewritten. |
| Production build, typecheck and useful validation | Direct offline build and regression checks passed. Preserved source typecheck passed in an isolated locked-dependency copy. Root npm commands and WebKit limitations are recorded below. |
| Better Interface six-domain review and design documentation | Reviewed below; `DESIGN.md` describes actual final values. |
| Publish to the same hostname and verify after publication | **Blocked:** no supported hosting-update tool is available and the `imd` CLI is prohibited. No hosting change was attempted. The exact hostname still served the old app and bundle. No alternative URL is offered as completion. |

## Six-domain review

The pinned Better Interface workflow and core principles for all six domains were read and applied during implementation. Source checks were supplemented by actual Chromium rendering and screenshots.

| Domain | Coverage, findings and limits |
| --- | --- |
| Accessibility | **Checked:** English document, native main/heading, exact visible status, selectable text, no focusable controls or keyboard trap, Tab leaves focus on body, 200% text enlargement and rendered contrast. Forms, dialogs and hit targets are **not applicable**. Screen-reader and physical-device sessions were **not performed**. |
| Layout | **Checked:** source normal flow, relative text/margins, no fixed dimensions or clipping; Chromium at 320/390/768/1440 and a `/preview/` subpath. Actual 390/1440 screenshots inspected. No horizontal overflow, clipping or overlap. Browser-native zoom and RTL variants were **not verified**; there is no requested localized variant. |
| Writing | **Checked:** the four-word sentence matches the brief exactly, using natural case and a calm status. No misleading recovery action or duplicate copy. Control/error-label checks are **not applicable**. |
| Typography | **Checked:** one size, one system-font family stack and normal weight; computed 16px/24px/400 at default size, natural wrapping and letter spacing, no external fonts or truncation. 200% root text size at 320px passed. Actual system font availability on other devices is **not verified**. |
| Colors | **Checked:** computed `rgb(17,17,17)` on opaque `rgb(255,255,255)`; pinned probe measured **18.88:1**. No alpha, image or gradient backgrounds. Only a single light appearance exists; other theme variants are **not applicable**. |
| UI | **Checked:** one static text pattern, no elevated surfaces, icons, overlays, interactive variants, animation or transitions. Reduced-motion measurement found no animation. Loading, pending, success, retry and pointer-state checks are **not applicable**. |

### Findings and fixes

1. **High, corrected — executable app and old export remained reachable.** The previous root mounted React and the previous export contained executable bundles and public configuration. Corrected at `index.html:18` and `scripts/build-offline.mjs:7`: replace the root with the native text notice and remove the complete old output before writing three allowlisted documents. The source regression, seeded builds, Chromium DOM/network checks and twelve local missing-path checks passed. The public hostname is a separate unresolved hosting limitation.
2. **Low, accepted conflict — generic share check expects two forbidden assets.** At `index.html:8`, title, description and `og:title` exist; favicon and `og:image` do not. The pinned probe reports exactly those two missing fields. Adding asset files or relaxing the resource policy would conflict with the specific offline export brief, so no such change was made. The observed result remains 15/16, not a claimed clean pass.
3. **Unresolved requirement conflict — package build command.** At `package.json:8`, the original TypeScript/Vite build remains. The explicit protected-path rule takes precedence over the requested script replacement. Direct builds at `scripts/build-offline.mjs:1` are the delivery build; `npm run build` is not claimed to produce this offline export.

No remaining applicable visual defect was found in the inspected Chromium states. This does not establish WebKit, screen-reader or native-device coverage.

## Commands and actual results

| Command or check | Actual result |
| --- | --- |
| `node scripts/build-offline.mjs` | Exit 0; produced the offline export. |
| `node --check scripts/build-offline.mjs` | Exit 0. |
| `node --test tests/offline.test.mjs` | Exit 0; 2 tests passed, 0 failed/skipped. Two seeded builds clean stale output; second build invoked from `tests/` to verify location independence. |
| `npm run typecheck` in the repository | Exit 127: TypeScript executable absent. No project dependency directory was installed or changed. |
| `npm run build` in the repository | Exit 127 for the same absent TypeScript executable. Its protected script remains the legacy build, so it is not used for the final export. |
| `npm ci --ignore-scripts` in an isolated temporary copy of the manifest/lockfile | Exit 0; source/configuration were copied for checking, with dependencies outside the submitted repository. |
| `npm run typecheck` in that isolated source copy | Exit 0; unchanged application source typechecked against its locked dependencies. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/hooks-offline-browsers node tests/offline-browser.mjs /tmp/hooks-offline-validation/node_modules/playwright/index.mjs` | Chromium checks passed. WebKit could not launch because required browser runtime dependencies were unavailable; combined runner exit 1. See `browser-validation.json`. |
| `IMD_PLAYWRIGHT=/tmp/hooks-offline-validation/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/hooks-offline-browsers node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | Probe completed, exit 0; **15/16** checks passed, `share` failed for favicon/og:image. Explicit tool paths avoid the probe's home/cache discovery fallback. Compact results retained in `design-probe.json`. |
| Read-only browser navigation to the exact public root | Displayed the original Hooks Store title with an app script; the offline condition was false. No wallet interaction was attempted. |
| Read-only HTTP GET of public root, hashes, old bundle/config and a missing path | All still served original content. `live-check.json` records time, URLs and statuses without response bodies. Hashes do not reach the server; these GETs do not establish rendered live hash behavior. |

The browser regression manages and closes its own temporary local static server and browser in a bounded foreground command. Its server exposes only the three preloaded export documents. Expected missing URLs use the offline 404 document. This establishes local fallback behavior, not the hosting provider's eventual configuration.

The final export totals **1,596 bytes**. Repository candidate file payload is below **1 MiB**, well below the 8 MiB file budget. The integrity check found no dependency/cache directories, dependency archives or Git submodules, and verified that the protected paths and archived source were unchanged. A full-history Git bundle packing attempt failed because required history objects could not be packed in the read-only checkout; the final history-bundle size is **not certified**. No packing retry or Git metadata change was made.

`offline-390.png` and `offline-1440.png` are actual Chromium screenshots of the production export, both visually inspected. The message was visible at the top with no additional UI. Source checks and screenshots describe the final unchanged page. The last production rebuild and final file/size integrity checks are recorded in `export-integrity.json`.

## Remaining completion limits

- The same-hostname withdrawal has **not** happened. The available toolset exposes no publishing method; this assignment prohibits using the `imd` CLI or reading private configuration to find another route. A hosting operator must replace the export under the existing hostname, then verify root, named hashes, a missing path and the previous asset/config URLs. The current public checks are failures of the withdrawal condition, not proof of publication.
- The package build-script edit remains prohibited; direct `node scripts/build-offline.mjs` builds work. The protected-path conflict is not hidden by a replacement build configuration.
- WebKit was not tested, and the generic favicon/share-image criterion conflicts with the requested output. Native zoom, screen readers and real devices were not tested.

No automatic verifier or these worker-written results independently certify the website's behavior.
