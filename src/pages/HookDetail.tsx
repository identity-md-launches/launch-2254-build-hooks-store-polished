import { useEffect, useState } from "react";
import type { ConfigState } from "../App";
import { PRESETS } from "../lib/presets";
import { readStore, type Listing } from "../lib/listings";
import { BUILD, FEES, SOURCE, formatImd } from "../lib/protocol";
import { KV, Mono, Notice, Tag } from "../components/ui";

const hookFacts: [string, string][] = [
  ["Behavior", "Rejects any swap whose specified amount is above the fixed limit, for exact-input and exact-output swaps alike. Pools must be initialized through the hook; dynamic fees are refused."],
  ["Permissions", "afterInitialize, beforeSwap, afterSwap (flags 4288). No liquidity callbacks, so liquidity can always be removed."],
  ["Creator fees", "None. The hook takes no fee and holds no funds."],
  ["Admin powers", "None. No owner, setters, pause or upgrade. A new limit needs a new hook and a new pool."],
];

export function HookDetail({ id, cfg }: { id: string; cfg: ConfigState }) {
  const [kind, key] = id.split("/");
  const preset = kind === "preset" ? PRESETS.find((p) => p.id === key) : undefined;
  const [listing, setListing] = useState<Listing | null | undefined>(kind === "listing" ? undefined : null);
  useEffect(() => {
    if (kind !== "listing" || !cfg.config || !cfg.configured) { setListing(null); return; }
    readStore(cfg.config).then((s) => setListing(s.listings.find((l) => String(l.id) === key) ?? null)).catch(() => setListing(null));
  }, [kind, key, cfg.config, cfg.configured]);

  if (kind === "listing" && listing === undefined) return <p role="status" className="muted">Reading listing…</p>;
  if (!preset && !listing) return <section className="empty"><h1>Hook not found</h1><p>This listing does not exist or the registry is not configured. <a href="#/browse">Back to Browse</a></p></section>;
  const fp = BUILD.contracts.BoundedSwapHook!;

  return (
    <article className="detail">
      <a className="back" href="#/browse">← Browse</a>
      <div className="detail-head">
        <div>
          <span className={`kind ${preset ? "preset" : "listing"}`}>{preset ? "Preset" : "Listing"}</span>
          <h1>{preset?.title ?? listing!.name}</h1>
          <p className="lede">{preset?.summary ?? listing!.feeDisclosure}</p>
          <div className="tags">{(preset?.tags ?? listing!.labels).map((t) => <Tag key={t}>{t}</Tag>)}</div>
        </div>
        <aside className="buybox">
          {preset ? (
            <>
              <p className="price">{formatImd(FEES.build + FEES.review)} <span className="muted">plus gas</span></p>
              <p className="muted">Build {formatImd(FEES.build)} and signed review {formatImd(FEES.review)}, charged separately. Listing is free.</p>
              <a className="btn primary block" href={`#/create?preset=${preset.id}`} onClick={() => sessionStorage.setItem("hooks-store:preset", preset.id)}>Build from this preset</a>
            </>
          ) : (
            <>
              <p className="muted">Listings are claims by their owners. References are not verified by the store.</p>
              <a className="btn block" href={listing!.sourceRef} rel="noreferrer noopener" target="_blank">Open source</a>
            </>
          )}
        </aside>
      </div>

      <section className="block">
        <h2>What it does</h2>
        {preset ? <KV rows={hookFacts} /> : (
          <KV rows={[["Callbacks", listing!.callbackDisclosure], ["Fees", listing!.feeDisclosure], ["Admin", listing!.adminDisclosure],
            ["Hook", <Mono key="h">{listing!.hook}</Mono>], ["Owner", <Mono key="o">{listing!.owner}</Mono>], ["Callback mask", String(listing!.callbackMask)]]} />
        )}
      </section>

      <section className="block">
        <h2>Source and evidence</h2>
        {preset ? (
          <>
            <KV rows={[
              ["Source", <a key="s" href={SOURCE.file("src/BoundedSwapHook.sol")}>BoundedSwapHook.sol at 46e17ea</a>],
              ["Build", <span key="b">solc 0.8.26, Cancun, 200 runs. Runtime sha256 <Mono>{fp.deployedBytecode.sha256.slice(0, 16)}…</Mono> ({fp.deployedBytecode.bytes} bytes), from deployment/current-build.json</span>],
              ["Review", "None yet. A preset is a template; each build gets its own signed oracle review."],
              ["Deployment", "None. Nothing is deployed until the exact reviewed artifact passes GatedHookDeployer."],
            ]} />
            <Notice tone="warn" title="Delivered is not approved">A build that is delivered still needs a passing signed oracle review of that exact artifact. GatedHookDeployer refuses anything else.</Notice>
          </>
        ) : (
          <KV rows={[["Source", listing!.sourceRef], ["Tests", listing!.testRef || "Not given"], ["Review", listing!.reviewRef || "Not given"], ["Audit", listing!.auditRef || "Not given"]]} />
        )}
      </section>
    </article>
  );
}
