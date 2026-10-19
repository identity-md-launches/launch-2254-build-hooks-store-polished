# The Hooks Store

A static dapp for browsing, building, reviewing and publishing Uniswap v4 hooks on Robinhood Chain (4663).
There is no backend, company token or pool. The site reads the chain from the browser and writes only through the
visitor's own wallet. Contracts are from
[`launch-1811-build-technical-foundation-hooks@46e17ea`](https://github.com/identity-md-launches/launch-1811-build-technical-foundation-hooks/tree/46e17ea70534e8a7ac2c4ff78501a3c183d32da8).
Solidity, the compiler, its dependencies and the contract APIs are frozen at that commit.

The site has three destinations plus a separate operator page, all on hash routes:

| Route | What it does |
| --- | --- |
| `#/browse`, `#/hook/<id>` | Search and tag filter, `#ad` featured placements, and hook details: behavior, permissions, creator fees and admin powers, source, and build/review/deployment evidence |
| `#/create` | One guided journey: Preset → Customize (chat-style preset guide or visual blocks, same validated HookSpec) → Review (spec and itemized fees) → Build → Signed review → Deploy → Publish |
| `#/workspace/<tab>` | Builds and reviews, resumable requests, profile and listings, promotions, refunds and withdrawals |
| `#/operator` | Operator-only deployment and setup wizard (linked from the footer, not the main nav) |

Fees shown are the published ones: build 0.5 IMD and signed oracle review 0.5 IMD, itemized separately, plus gas.
An ad costs 0.1 IMD per seven days and is labelled `#ad`. Listings and profiles are free.

## Repository layout

```
index.html, src/          React + TypeScript source (Vite)
src/pinned/               contracts.json (ABIs, initcode, runtime, immutable offsets) and current-build.json,
                          extracted from the pinned commit and checked byte-for-byte against it
public/                   favicon.svg, og.png, site-config.json (the shared public configuration)
dist/                     the committed static export; this is what gets published
site/                     the pinned repository's automatic client, with the readReadiness/bind/open hardening
scripts/extract-artifacts.mjs   regenerates src/pinned from a forge build of the pinned commit
tests/                    hardening regressions (mocked) and operator-wizard tests (local anvil fork)
test-results.txt          the recorded `npm test` run, labelled mock / local fork / unperformed / live
VALIDATION.md             build, browser, design-review and limitation record
DESIGN.md                 tokens, typography, components and responsive behavior
```

## Install, preview, rebuild

Requires Node 20 or later (recorded run: Node 24.21.0).

```sh
npm ci               # install exact versions from package-lock.json
npm run dev          # local dev server
npm run build        # tsc --noEmit, then vite build into dist/
npm run preview      # serve the built dist/ at http://localhost:4173
npm run typecheck    # tsc --noEmit on its own
```

`vite.config.ts` sets `base: "./"`, so every asset URL in `dist/` is relative. The export works from a gateway subpath, an
ENS name or any static host. Routing uses the URL hash, so no server rewrites are needed. After changing source,
run `npm run build` and commit `dist/` together with the source. The publisher serves the committed export and
does not rebuild it.

### Regenerating the pinned contract artifacts

`src/pinned/` is committed, so you don't need this step to build. To reproduce it:

```sh
git clone https://github.com/identity-md-launches/launch-1811-build-technical-foundation-hooks pin
git -C pin checkout 46e17ea70534e8a7ac2c4ff78501a3c183d32da8
(cd pin && forge build)                # foundry.toml pins solc 0.8.26, cancun, optimizer 200
npm run artifacts -- pin               # writes src/pinned/contracts.json and current-build.json
```

The script refuses to write if any initcode, runtime length or hash, or immutable offset differs from that commit's
`deployment/current-build.json`. It only takes HookListingRegistry, FeaturedPlacements, HookRequestCodec,
AutoHookJobRequester and GatedHookDeployer, never the legacy HookJobRequester or HooksStoreFactory. `npm test`
checks the committed files against each other again.

## Tests

```sh
npm test
# optional: ANVIL=/path/to/anvil FORK_RPC=https://rpc.mainnet.chain.robinhood.com npm test
```

- `tests/automatic-ui-hardening.test.cjs` runs `site/automatic-ui.js` against a mocked EIP-1193 provider.
- `tests/operator.test.mjs` first checks the bundled bytes against `current-build.json`. It then starts a local
  `anvil` fork of chain 4663 and runs the operator wizard library (`src/lib/operator.ts`) end to end: preflight,
  wrong chain or wallet, rejected signature, the eight-step bootstrap with readbacks, resume, context drift, a
  foreign receipt and a bytecode mismatch. ArbSys is mocked inside the fork. If `anvil` isn't installed, the fork
  tests are skipped. Nothing is sent to a live chain.

`test-results.txt` has the latest recorded run and says, per check, what was mocked, what ran on a fork and
what was not performed.

## Operator setup (production bootstrap)

This needs explicit approval before it runs on Robinhood Chain. Customers never use this page. Until a reviewed
`public/site-config.json` names every contract, the public site stays read-only.

1. Open `#/operator` and connect the admin/deployer account in Rabby. Rabby is found by EIP-6963. On a phone,
   open the page in Rabby's in-app browser from the Connect sheet.
2. Enter the admin/deployer address and the ad-proceeds recipient, and confirm each one with its checkbox. These
   are your values. The site never hardcodes them.
3. Run the live preflight. It checks the wallet chain (4663), that the connected account is the confirmed admin,
   that Intake and the IMD asset have code, IMD `decimals() = 18`, positive Intake quotes for `job.open@job-1` and
   `oracle.request@oracle-1` at or below maxPrice (0.5 IMD), the frozen PoolManager address and code hash, and the
   ArbSys native clock. Sending stays disabled until every check passes.
4. Tick "I have explicit approval to bootstrap this deployment", then approve each zero-value transaction
   separately in Rabby, in this order. Only the next open step can be sent. Each card shows the parameters,
   calldata and a gas estimate (Estimate gas):
   1. `HookListingRegistry()`
   2. `FeaturedPlacements(owner, registry)`
   3. `HookRequestCodec()`
   4. `AutoHookJobRequester(owner, Intake, asset, oracleSigner, 500000000000000000, codec)`
   5. `GatedHookDeployer(owner, requester)`
   6. `FeaturedPlacements.configureToken(asset)`
   7. `FeaturedPlacements.setProceedsRecipient(adRecipient)`
   8. `GatedHookDeployer.setManager(PoolManager, pinnedCodeHash, true)`

   A step's address is used only after its receipt is successful and verified. Verification covers the sender,
   the exact calldata, the full runtime at the receipt block and now (pinned runtime plus reconstructed
   immutables), and the state readbacks (owner, registry, codec, maxPrice, constructor panel and age defaults,
   `head()` against `ArbSys.arbBlockNumber()`, token, recipient, manager).
5. Resume: progress lives in this browser, keyed by the exact inputs. After a reload, use Recheck. It re-reads
   stored receipts, code and state and never resends. A pending transaction stays pending until you recheck. If
   you change the owner or recipient, that is a new progress key, so old addresses are never reused.
6. Download the deployment manifest and the `site-config.json` from step 4 of the page. Review them, replace
   `public/site-config.json` with the reviewed file, run `npm run build` and commit both `public/` and `dist/`.
   Saving settings in the browser (localStorage) does not configure the public site.
7. `customerPaymentsEnabled` stays `false` until an approved live pilot. Changing it is a separate, approved edit
   to `public/site-config.json`.

No production deployment has been made from this repository, so `public/site-config.json` keeps every address `null`.
