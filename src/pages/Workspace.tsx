import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { readContract } from "wagmi/actions";
import type { Abi, Address, Hex } from "viem";
import type { ConfigState } from "../App";
import { useRoute } from "../lib/route";
import { ARTIFACTS, FEES, PROTOCOL, formatImd } from "../lib/protocol";
import { CHAIN_ID, GateNotice, JOB_STATUS, PLACEMENT_STATUS, REVIEW_STATUS, TxStatus, useTx, useWriteGate, walletError } from "../lib/tx";
import { KV, Mono, Notice } from "../components/ui";
import { ListingForm, emptyListing, type ListingDraft } from "../components/ListingForm";
import { DeployHook } from "../components/DeployHook";

const TABS = [
  { id: "builds", label: "Builds and reviews" },
  { id: "requests", label: "Requests" },
  { id: "listings", label: "Profile and listings" },
  { id: "promotions", label: "Promotions" },
  { id: "refunds", label: "Refunds" },
] as const;

const REQ = ARTIFACTS.AutoHookJobRequester.abi as Abi, REG = ARTIFACTS.HookListingRegistry.abi as Abi, ADS = ARTIFACTS.FeaturedPlacements.abi as Abi;
const SCAN_CAP = 300n;
type Load<T> = { status: "idle" | "loading" | "ready" | "error"; data?: T; error?: string };

/** Runs an async chain read when `key` is set and keeps loading, error and result apart, so an empty state only follows a read. */
function useLoad<T>(key: string | null, fn: () => Promise<T>): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: "idle" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!key) { setState({ status: "idle" }); return; }
    let live = true;
    setState((s) => ({ status: "loading", data: s.data }));
    fn().then((data) => { if (live) setState({ status: "ready", data }); }, (e) => { if (live) setState({ status: "error", error: walletError(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  return [state, () => setN((x) => x + 1)];
}

function LoadState<T>({ s, what, empty, children }: { s: Load<T[]>; what: string; empty: string; children: (rows: T[]) => ReactNode }) {
  if (s.status === "idle") return null;
  if (s.status === "loading" && !s.data) return <p className="empty-line" role="status">Reading {what} from the chain…</p>;
  if (s.status === "error") return <Notice tone="error" title={`Could not read ${what}`}>{s.error}</Notice>;
  return <>{s.data && s.data.length ? children(s.data) : <p className="empty-line">{empty}</p>}</>;
}

function JobRow({ cfg, id }: { cfg: ConfigState; id: Hex }) {
  const q = useReadContract({ abi: REQ, address: cfg.config?.contracts.AutoHookJobRequester as Address, functionName: "getJob", args: [id], chainId: CHAIN_ID } as never);
  const [open, setOpen] = useState(false);
  const j = q.data as { status: number; review: number } | undefined;
  return (
    <li className="card">
      <p><Mono>{id}</Mono></p>
      {q.isLoading ? <p className="muted">Reading job…</p> : q.error ? <p className="err">Could not read this job.</p> : j && (
        <KV rows={[["Job", JOB_STATUS[j.status] ?? String(j.status)], ["Signed review", REVIEW_STATUS[j.review] ?? String(j.review)]]} />
      )}
      {j && j.status === 2 && j.review !== 2 && <p className="muted">Delivered is not approved. Deploying needs a passed signed review.</p>}
      {j && j.status === 2 && j.review === 2 && (open ? <DeployHook cfg={cfg} jobId={id} /> : <div className="actions"><button className="btn primary" onClick={() => setOpen(true)}>Deploy this build</button></div>)}
    </li>
  );
}

type Owned = { id: bigint; revision: bigint; active: boolean; hook: Address; meta: Record<string, unknown> };
type Bought = { id: bigint; listingId: bigint; endsAt: bigint; status: number; refund: bigint };

export function Workspace({ cfg }: { cfg: ConfigState }) {
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route[1]) ?? TABS[0]).id;
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const [draft, setDraft] = useState<{ step: number; draft: { name: string } } | null>(null);
  useEffect(() => { try { setDraft(JSON.parse(localStorage.getItem("hooks-store:draft:v1") ?? "null")); } catch { setDraft(null); } }, []);
  const c = cfg.config?.contracts;
  const reads = cfg.configured && isConnected && !!address;
  const read = (to: string | null | undefined, abi: Abi, functionName: string, args: unknown[] = []) =>
    readContract(config, { address: to as Address, abi, functionName, args, chainId: CHAIN_ID } as never) as Promise<unknown>;
  const free = useWriteGate(cfg), paid = useWriteGate(cfg, { payment: true });
  const tx = useTx();
  const [editing, setEditing] = useState<{ id?: bigint; initial: ListingDraft } | null>(null);
  const [promote, setPromote] = useState("");
  const who = reads ? address!.toLowerCase() : null;

  const [jobs, reloadJobs] = useLoad(tab === "builds" && who ? `jobs:${who}` : null, async () => (await read(c?.AutoHookJobRequester, REQ, "jobsOf", [address])) as Hex[]);
  const [owned, reloadOwned] = useLoad(tab === "listings" && who ? `listings:${who}` : null, async () => {
    const count = (await read(c?.HookListingRegistry, REG, "listingCount")) as bigint;
    const out: Owned[] = [];
    for (let id = count; id >= 1n && id > count - SCAN_CAP; id--) {
      const l = (await read(c?.HookListingRegistry, REG, "getListing", [id])) as { owner: Address; revision: bigint; active: boolean; hook: Address };
      if (l.owner.toLowerCase() !== who) continue;
      out.push({ id, revision: l.revision, active: l.active, hook: l.hook, meta: (await read(c?.HookListingRegistry, REG, "getMetadata", [id, l.revision])) as Record<string, unknown> });
    }
    return out;
  });
  const [bought, reloadBought] = useLoad(tab === "promotions" && who ? `ads:${who}` : null, async () => {
    const count = (await read(c?.FeaturedPlacements, ADS, "placementCount")) as bigint;
    const out: Bought[] = [];
    for (let id = count; id >= 1n && id > count - SCAN_CAP; id--) {
      const p = (await read(c?.FeaturedPlacements, ADS, "getPlacement", [id])) as Bought & { payer: Address };
      if (p.payer.toLowerCase() === who) out.push({ id, listingId: p.listingId, endsAt: p.endsAt, status: p.status, refund: p.refund });
    }
    return out;
  });
  const [bal, reloadBal] = useLoad(tab === "refunds" && who ? `bal:${who}` : null, async () => ({
    refund: (await read(c?.AutoHookJobRequester, REQ, "refunds", [PROTOCOL.asset, address])) as bigint,
    available: (await read(c?.FeaturedPlacements, ADS, "available", [address])) as bigint,
    proceeds: (await read(c?.FeaturedPlacements, ADS, "proceeds", [address])) as bigint,
  }));

  const edit = (o: Owned) => setEditing({ id: o.id, initial: emptyListing({
    hook: o.hook, name: String(o.meta.name ?? ""), sourceRef: String(o.meta.sourceRef ?? ""), testRef: String(o.meta.testRef ?? ""),
    reviewRef: String(o.meta.reviewRef ?? ""), auditRef: String(o.meta.auditRef ?? ""), callbackMask: `0x${(o.meta.callbackMask as bigint).toString(16)}`,
    callbackDisclosure: String(o.meta.callbackDisclosure ?? ""), feeDisclosure: String(o.meta.feeDisclosure ?? ""),
    adminDisclosure: String(o.meta.adminDisclosure ?? ""), labels: ((o.meta.labels as string[]) ?? []).join(", "),
  }) });
  const now = BigInt(Math.floor(Date.now() / 1000));

  return (
    <div>
      <h1>My workspace</h1>
      <nav className="tabs" aria-label="Workspace sections">
        {TABS.map((t) => <a key={t.id} href={`#/workspace/${t.id}`} aria-current={tab === t.id ? "page" : undefined}>{t.label}</a>)}
      </nav>
      {!isConnected && <Notice title="Connect to see your activity">Your builds, listings and balances are read from the chain for the connected wallet.</Notice>}

      {tab === "builds" && (
        <section className="block">
          <div className="block-head"><h2>Builds and reviews</h2>{reads && <button className="btn" disabled={jobs.status === "loading"} onClick={reloadJobs}>Refresh</button>}</div>
          {!cfg.configured && <p className="empty-line">Builds appear here once the store is configured and you open one.</p>}
          <LoadState s={jobs} what="your jobs" empty="No jobs opened from this wallet.">
            {(rows) => <ul className="plain stack">{rows.map((id) => <JobRow key={id} cfg={cfg} id={id} />)}</ul>}
          </LoadState>
          <p className="muted">Each build shows its job status (Open, Delivered, Failed, Expired) and its review verdict separately. Delivered is not approved.</p>
          <a className="btn primary" href="#/create">Create a hook</a>
        </section>
      )}

      {tab === "requests" && (
        <section className="block">
          <h2>Resumable requests</h2>
          {draft?.draft ? (
            <div className="card">
              <h3>{draft.draft.name || "Untitled hook"}</h3>
              <p className="muted">Draft saved in this browser at step {draft.step + 1} of 7. Nothing has been paid.</p>
              <div className="actions">
                <a className="btn primary" href="#/create">Resume</a>
                <button className="btn" onClick={() => { localStorage.removeItem("hooks-store:draft:v1"); setDraft(null); }}>Discard draft</button>
              </div>
            </div>
          ) : <p className="empty-line">No saved drafts. A draft is kept here as soon as you pick a preset.</p>}
        </section>
      )}

      {tab === "listings" && (
        <section className="block">
          <div className="block-head"><h2>Profile and listings</h2>{reads && <button className="btn" disabled={owned.status === "loading"} onClick={reloadOwned}>Refresh</button>}</div>
          <p>Listings and profile edits are free; you only pay gas. Each edit creates a new revision; older revisions stay readable.</p>
          <KV rows={[["Listing owner", address ?? "Not connected"], ["Registry", c?.HookListingRegistry ?? "Not configured"]]} />
          {!cfg.configured && <p className="empty-line">Listing is off until the registry is configured.</p>}
          <LoadState s={owned} what="your listings" empty={`No listings owned by this wallet in the newest ${SCAN_CAP} listings.`}>
            {(rows) => (
              <ul className="plain stack">{rows.map((o) => (
                <li key={String(o.id)} className="card">
                  <h3>#{String(o.id)} {String(o.meta.name)}</h3>
                  <KV rows={[["Hook", <Mono key="h">{o.hook}</Mono>], ["Revision", String(o.revision)], ["Visibility", o.active ? "Shown in Browse" : "Hidden"]]} />
                  <div className="actions">
                    <button className="btn" disabled={!!free || tx.busy} onClick={() => edit(o)}>Edit</button>
                    <button className="btn" disabled={!!free || tx.busy} onClick={() => tx.run(o.active ? "Hide listing" : "Show listing", { address: c!.HookListingRegistry as Address, abi: REG, functionName: "setListingActive", args: [o.id, !o.active] }, async () => { reloadOwned(); })}>{o.active ? "Hide" : "Show"}</button>
                  </div>
                </li>
              ))}</ul>
            )}
          </LoadState>
          <TxStatus state={tx.state} />
          {editing ? (
            <div className="card">
              <div className="block-head"><h3>{editing.id ? `Edit listing #${editing.id}` : "New listing"}</h3><button className="btn link" onClick={() => setEditing(null)}>Close</button></div>
              <ListingForm key={String(editing.id ?? "new")} cfg={cfg} initial={editing.initial} listingId={editing.id} onDone={() => reloadOwned()} />
            </div>
          ) : (
            <div className="actions"><button className="btn primary" disabled={!!free} onClick={() => setEditing({ initial: emptyListing() })}>New listing</button></div>
          )}
          <GateNotice reason={cfg.configured ? free : null} />
        </section>
      )}

      {tab === "promotions" && (
        <section className="block">
          <div className="block-head"><h2>Promotions</h2>{reads && <button className="btn" disabled={bought.status === "loading"} onClick={reloadBought}>Refresh</button>}</div>
          <KV rows={[
            ["Price", `${formatImd(FEES.ad)} per ${FEES.adDays} days, labelled #ad`],
            ["Recipient", "Snapshotted at purchase. Later recipient changes never redirect a bought placement."],
            ["Cancel", "The payer or the listing owner can cancel before it ends. The unused time is refunded to the payer's store balance."],
            ["Expiry", "Anyone can settle an expired placement. No keeper is needed."],
          ]} />
          {!cfg.configured && <p className="empty-line">Promotions are off until FeaturedPlacements is configured.</p>}
          <LoadState s={bought} what="your placements" empty={`No placements bought from this wallet in the newest ${SCAN_CAP}.`}>
            {(rows) => (
              <ul className="plain stack">{rows.map((p) => {
                const open = p.status === 1, ended = p.endsAt <= now;
                return (
                  <li key={String(p.id)} className="card">
                    <h3>Placement #{String(p.id)} for listing #{String(p.listingId)}</h3>
                    <KV rows={[["Status", open && ended ? "Ended, not settled" : PLACEMENT_STATUS[p.status] ?? String(p.status)], ["Ends", new Date(Number(p.endsAt) * 1000).toLocaleString()], ["Refunded", formatImd(p.refund)]]} />
                    {open && (
                      <div className="actions">
                        {ended
                          ? <button className="btn" disabled={!!free || tx.busy} onClick={() => tx.run("Settle placement", { address: c!.FeaturedPlacements as Address, abi: ADS, functionName: "settle", args: [p.id] }, async () => { reloadBought(); })}>Settle</button>
                          : <button className="btn" disabled={!!free || tx.busy} onClick={() => tx.run("Cancel placement", { address: c!.FeaturedPlacements as Address, abi: ADS, functionName: "cancel", args: [p.id] }, async () => { reloadBought(); return "Cancelled. The unused time is in your store ad balance under Refunds."; })}>Cancel and refund unused time</button>}
                      </div>
                    )}
                  </li>
                );
              })}</ul>
            )}
          </LoadState>
          <TxStatus state={tx.state} />
          <form className="actions" onSubmit={async (e) => {
            e.preventDefault();
            if (paid || !/^\d+$/.test(promote)) return;
            const id = BigInt(promote);
            const l = (await read(c?.HookListingRegistry, REG, "getListing", [id]).catch(() => null)) as { revision: bigint } | null;
            const recipient = (await read(c?.FeaturedPlacements, ADS, "proceedsRecipient").catch(() => null)) as Address | null;
            if (!l || !recipient) return;
            await tx.run("Promote listing", { address: c!.FeaturedPlacements as Address, abi: ADS, functionName: "purchase", args: [id, l.revision, recipient, now + 600n] }, async () => { reloadBought(); });
          }}>
            <label htmlFor="promote-id" className="sr">Listing number to promote</label>
            <input id="promote-id" inputMode="numeric" placeholder="Listing #" value={promote} onChange={(e) => setPromote(e.target.value.replace(/\D/g, ""))} disabled={!!paid} />
            <button className="btn primary" type="submit" disabled={!!paid || tx.busy || !promote}>Promote a listing</button>
          </form>
          <GateNotice reason={cfg.configured ? paid : null} />
        </section>
      )}

      {tab === "refunds" && (
        <section className="block">
          <div className="block-head"><h2>Refunds and withdrawals</h2>{reads && <button className="btn" disabled={bal.status === "loading"} onClick={reloadBal}>Refresh</button>}</div>
          {!reads && <p className="empty-line">{cfg.configured ? "Connect to read your balances." : "Balances are not available until the store is configured."}</p>}
          {bal.status === "loading" && !bal.data && <p className="empty-line" role="status">Reading balances…</p>}
          {bal.status === "error" && <Notice tone="error" title="Could not read balances">{bal.error}</Notice>}
          {bal.data && (
            <ul className="plain stack">
              {([
                ["Refunded review reserve", bal.data.refund, "Withdraw refund", { address: c!.AutoHookJobRequester, abi: REQ, functionName: "withdrawRefund", args: [PROTOCOL.asset] }],
                ["Store ad balance", bal.data.available, "Withdraw ad balance", { address: c!.FeaturedPlacements, abi: ADS, functionName: "withdraw", args: [bal.data.available, address] }],
                ["Ad proceeds (recipient only)", bal.data.proceeds, "Withdraw proceeds", { address: c!.FeaturedPlacements, abi: ADS, functionName: "withdrawProceeds", args: [bal.data.proceeds, address] }],
              ] as const).map(([label, v, action, call]) => (
                <li key={label} className="card row-between">
                  <span>{label}: <strong>{formatImd(v)}</strong></span>
                  <button className="btn" disabled={!!free || tx.busy || v === 0n} onClick={() => tx.run(action, { ...call, address: call.address as Address, args: [...call.args] }, async () => { reloadBal(); })}>{action}</button>
                </li>
              ))}
            </ul>
          )}
          <TxStatus state={tx.state} />
          <p className="muted">Unused review reserves refund through withdrawRefund(IMD). Ad balances use withdraw(), and the snapshotted recipient collects earned ad fees with withdrawProceeds(). Withdrawals cost gas only.</p>
          <GateNotice reason={cfg.configured && reads ? free : null} />
        </section>
      )}
    </div>
  );
}
