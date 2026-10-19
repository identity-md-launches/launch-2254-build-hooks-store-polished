# The Hooks Store — offline export

The replacement page displays only **This site is offline.** It has no application entrypoint, scripts, links, controls, wallets, analytics, remote resources or runtime dependencies.

The existing publication target is https://the-hooks-store-uniswap-v4-hooks.sites.imd.fun/. **Publication is incomplete:** the available tools cannot update this hosting record, and the assignment prohibits every `imd` CLI command. The exact hostname still served the original app during validation. No new site, domain or CID was substituted. See [validation](VALIDATION.md); the separate artifact delivery includes `artifacts/live-check.json`.

## Install and rebuild

The offline export needs Node.js with ES modules and `node:fs/promises` (Node 18 or later). No package installation is needed.

```sh
node scripts/build-offline.mjs
```

The builder reads root `index.html`, removes and recreates `dist/`, and writes exactly:

- `dist/index.html`: the offline page, byte-for-byte from root.
- `dist/404.html`: the same page.
- `dist/robots.txt`: `User-agent: *` and `Disallow: /`, on separate lines.

It never copies `public/`, bundles React or reads the old application configuration. There are no asset URLs to resolve, so the page works at a static-host subpath. Serve **only `dist/`**, never the repository root. Hosts may use `404.html` for missing paths or return not-found; old asset and configuration URLs must not resolve to the old files.

### Protected package-script conflict

The assignment explicitly forbids changing existing `package.json` and lockfiles, while also requiring `scripts.build` to become `node scripts/build-offline.mjs`. The stronger file restriction was preserved; **that requested package-script change is not implemented**. The existing package scripts and dependency lockfile are unchanged. Use the direct Node command above. The existing `npm run build` still targets the archived TypeScript/Vite app and can copy `public/`; it is unsuitable for producing this withdrawal export.

## Preview

With Python 3 installed, run this in the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:4173/`. The root, `#/browse`, `#/create`, `#/workspace`, `#/operator` and arbitrary fragments show the same message. This basic preview returns HTTP 404 for missing files; a host that supports custom error documents can show `404.html` instead.

## Validation

```sh
node --check scripts/build-offline.mjs
node --test tests/offline.test.mjs
```

Both regression tests passed. They seed stale JS, source maps, configuration, deployment artifacts, images and nested files before **each of two builds**, then verify the exact three-file output, identical HTML, robots text, deterministic bytes and working-directory independence.

The browser regression accepts an explicitly installed external Playwright module:

```sh
node tests/offline-browser.mjs /path/to/playwright/index.mjs
```

Set Playwright's browser location explicitly when using an external installation. Test dependencies and downloaded browsers used for this run were kept in temporary storage, outside the submission.

Actual results:

- Direct offline production builds and syntax checks: passed.
- Chromium: all ten navigation cases and five further hash transitions passed; only document requests, no scripts, wallet calls, provider discovery, console errors or app activity. Missing asset/config paths returned 404 with the offline document in the test server.
- Layout: no horizontal overflow at 320, 390, 768 or 1440 CSS pixels; the complete message is visible on the first screen. Text enlargement to 200%, reduced motion and changing hashes while disconnected passed.
- WebKit: could not launch because its browser runtime dependencies were unavailable. The browser runner consequently exits 1; WebKit behavior is unverified.
- Pinned design probe: 15/16 checks passed. Its favicon/share-image check failed; both assets are intentionally omitted to honor the three-file, inline-styling-only offline brief. Title, description and `og:title` are present.
- Root `npm run typecheck` and `npm run build`: exit 127 because the local TypeScript executable was absent. An isolated copy of the unchanged source, configuration and locked dependencies passed `npm run typecheck` (exit 0) after `npm ci --ignore-scripts`. The offline page contains no TypeScript.
- Live hostname: root and supplied fragments still returned the old app; the previous bundle and `site-config.json` remained available. Post-publication success is not claimed.

[DESIGN.md](DESIGN.md) documents the final source. [VALIDATION.md](VALIDATION.md) contains the six-domain review, findings, commands and limitations. A copy, browser screenshots and compact measurement records are in the separate `artifacts/` delivery.

The production export is 1,596 bytes. The measured source/export delivery payload is under 1 MiB, with no dependency caches, archives or submodules included. Full-history Git bundle packing could not complete in the read-only checkout, so its final submission size is not certified; see [export integrity](artifacts/export-integrity.json).

## Preserved application

The original React/TypeScript application, wallet code, pinned contract artifacts, original client under `site/`, tests and `public/` inputs remain recoverable in their existing paths and Git history. They are excluded from the offline export. Solidity, dependency manifests, lockfiles and existing build configuration were not changed. No contract deployment, wallet signing or movement of funds was performed.
