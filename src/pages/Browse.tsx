import { useEffect, useMemo, useState } from "react";
import type { ConfigState } from "../App";
import { PRESETS } from "../lib/presets";
import { readStore, type Listing, type Placement } from "../lib/listings";
import { AdBadge, Notice, Tag } from "../components/ui";
import { FEES, formatImd } from "../lib/protocol";

type Card = { href: string; title: string; summary: string; tags: string[]; kind: "Preset" | "Listing"; ad?: boolean };

export function Browse({ cfg }: { cfg: ConfigState }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [store, setStore] = useState<{ listings: Listing[]; placements: Placement[] } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!cfg.configured || !cfg.config) return;
    setState("loading");
    readStore(cfg.config).then((s) => { setStore(s); setState("idle"); }).catch((e: Error) => { setError(e.message); setState("error"); });
  }, [cfg.configured, cfg.config]);

  const cards: Card[] = useMemo(() => {
    const listed = (store?.listings ?? []).filter((l) => l.active).map((l) => ({
      href: `#/hook/listing/${l.id}`, title: l.name, summary: l.feeDisclosure || l.callbackDisclosure, tags: l.labels, kind: "Listing" as const,
    }));
    const presets = PRESETS.map((p) => ({ href: `#/hook/preset/${p.id}`, title: p.title, summary: p.summary, tags: p.tags, kind: "Preset" as const }));
    return [...listed, ...presets];
  }, [store]);
  const tags = useMemo(() => [...new Set(cards.flatMap((c) => c.tags))].sort(), [cards]);
  const q = query.trim().toLowerCase();
  const shown = cards.filter((c) => (!tag || c.tags.includes(tag)) && (!q || `${c.title} ${c.summary} ${c.tags.join(" ")}`.toLowerCase().includes(q)));
  const ads = (store?.placements ?? []).map((p) => ({ p, l: store?.listings.find((l) => l.id === p.listingId) }));

  return (
    <>
      <section className="hero">
        <h1>Uniswap v4 hooks, reviewed first</h1>
        <p className="lede">Find a hook, or build your own and deploy it only after a signed oracle review.</p>
        <div className="hero-actions">
          <a className="btn primary" href="#/create">Create a hook</a>
          <label className="search">
            <span className="sr">Search hooks</span>
            <input type="search" placeholder="Search hooks" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </section>

      <div className="chips" role="group" aria-label="Filter by tag">
        <button className={`chip${tag === null ? " on" : ""}`} aria-pressed={tag === null} onClick={() => setTag(null)}>All</button>
        {tags.map((t) => <button key={t} className={`chip${tag === t ? " on" : ""}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}
      </div>

      <section aria-labelledby="featured-h" className="block">
        <div className="block-head"><h2 id="featured-h">Featured</h2><AdBadge /></div>
        {ads.length ? (
          <div className="grid">
            {ads.map(({ p, l }) => (
              <a key={String(p.id)} className="card ad" href={`#/hook/listing/${p.listingId}`}>
                <div className="card-top"><AdBadge /><span className="muted">until {new Date(Number(p.endsAt) * 1000).toLocaleDateString()}</span></div>
                <h3>{l?.name ?? `Listing ${p.listingId}`}</h3>
                <p className="muted">Paid placement for revision {String(p.revision)}. Not a review or endorsement.</p>
              </a>
            ))}
          </div>
        ) : (
          <div className="card ad slot">
            <div className="card-top"><AdBadge /></div>
            <h3>This placement is open</h3>
            <p className="muted">Feature a listed hook here for {formatImd(FEES.ad)} per {FEES.adDays} days, labelled #ad.</p>
            <a className="btn" href="#/workspace/promotions">Promote a listing</a>
          </div>
        )}
      </section>

      <section aria-labelledby="all-h" className="block">
        <div className="block-head"><h2 id="all-h">All hooks</h2><span className="muted">{shown.length} shown</span></div>
        {state === "loading" && <p className="muted" role="status">Reading listings from Robinhood Chain…</p>}
        {state === "error" && <Notice tone="error" title="Listings could not load">{error}. Presets are still shown.</Notice>}
        {!cfg.configured && <Notice title="No live listings yet">Until the registry is configured, only presets appear: templates to build from, not deployed hooks.</Notice>}
        {shown.length ? (
          <div className="grid">
            {shown.map((c) => (
              <a key={c.href} className="card" href={c.href}>
                <div className="card-top"><span className={`kind ${c.kind.toLowerCase()}`}>{c.kind}</span></div>
                <h3>{c.title}</h3>
                <p>{c.summary}</p>
                <div className="tags">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
              </a>
            ))}
          </div>
        ) : <p className="empty-line">Nothing matches “{query}”. <button className="link" onClick={() => { setQuery(""); setTag(null); }}>Clear filters</button></p>}
      </section>
    </>
  );
}
