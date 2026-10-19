import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import type { Abi, Address } from "viem";
import type { ConfigState } from "../App";
import { useRoute } from "../lib/route";
import { ARTIFACTS, FEES, PROTOCOL, formatImd } from "../lib/protocol";
import { KV, Notice } from "../components/ui";

const TABS = [
  { id: "builds", label: "Builds and reviews" },
  { id: "requests", label: "Requests" },
  { id: "listings", label: "Profile and listings" },
  { id: "promotions", label: "Promotions" },
  { id: "refunds", label: "Refunds" },
] as const;

function Balance({ label, abi, address, fn, args, enabled }: { label: string; abi: Abi; address?: string | null; fn: string; args: unknown[]; enabled: boolean }) {
  const q = useReadContract({ abi, address: address as Address, functionName: fn, args, query: { enabled: enabled && !!address } } as never);
  const v = q.data as bigint | undefined;
  return <>{!enabled || !address ? `${label}: not available` : q.isLoading ? `${label}: reading…` : q.error ? `${label}: could not read` : `${label}: ${formatImd(v ?? 0n)}`}</>;
}

export function Workspace({ cfg }: { cfg: ConfigState }) {
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route[1]) ?? TABS[0]).id;
  const { address, isConnected } = useAccount();
  const [draft, setDraft] = useState<{ step: number; draft: { name: string } } | null>(null);
  useEffect(() => { try { setDraft(JSON.parse(localStorage.getItem("hooks-store:draft:v1") ?? "null")); } catch { setDraft(null); } }, []);
  const c = cfg.config?.contracts;
  const reads = cfg.configured && isConnected;

  return (
    <div>
      <h1>My workspace</h1>
      <nav className="tabs" aria-label="Workspace sections">
        {TABS.map((t) => <a key={t.id} href={`#/workspace/${t.id}`} aria-current={tab === t.id ? "page" : undefined}>{t.label}</a>)}
      </nav>
      {!isConnected && <Notice title="Connect to see your activity">Your builds, listings and balances are read from the chain for the connected wallet.</Notice>}

      {tab === "builds" && (
        <section className="block">
          <h2>Builds and reviews</h2>
          <p className="empty-line">{reads ? "No builds found for this wallet yet." : "No builds yet. Builds appear here once the store is configured and you open one."}</p>
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
          <h2>Profile and listings</h2>
          <p>Listings and profile edits are free; you only pay gas. Each edit creates a new revision; older revisions stay readable.</p>
          <KV rows={[["Listing owner", address ?? "Not connected"], ["Registry", c?.HookListingRegistry ?? "Not configured"]]} />
          <p className="empty-line">{cfg.configured ? "No listings for this wallet yet." : "Listing is off until the registry is configured."}</p>
          <button className="btn" disabled={!cfg.configured || !isConnected}>New listing</button>
        </section>
      )}

      {tab === "promotions" && (
        <section className="block">
          <h2>Promotions</h2>
          <KV rows={[
            ["Price", `${formatImd(FEES.ad)} per ${FEES.adDays} days, labelled #ad`],
            ["Recipient", "Snapshotted at purchase. Later recipient changes never redirect a bought placement."],
            ["Cancel", "The payer or the listing owner can cancel before it ends. The unused time is refunded to the payer's store balance."],
            ["Expiry", "Anyone can settle an expired placement. No keeper is needed."],
          ]} />
          <p className="empty-line">{cfg.configured ? "No placements bought from this wallet." : "Promotions are off until FeaturedPlacements is configured."}</p>
          <button className="btn" disabled={!cfg.configured || !isConnected}>Promote a listing</button>
        </section>
      )}

      {tab === "refunds" && (
        <section className="block">
          <h2>Refunds and withdrawals</h2>
          <ul className="plain">
            <li><Balance label="Unused review reserve" abi={ARTIFACTS.AutoHookJobRequester.abi as Abi} address={c?.AutoHookJobRequester} fn="reserved" args={[address]} enabled={!!reads} /></li>
            <li><Balance label="Store ad balance" abi={ARTIFACTS.FeaturedPlacements.abi as Abi} address={c?.FeaturedPlacements} fn="available" args={[address]} enabled={!!reads} /></li>
            <li><Balance label="Ad proceeds (recipient only)" abi={ARTIFACTS.FeaturedPlacements.abi as Abi} address={c?.FeaturedPlacements} fn="proceeds" args={[address]} enabled={!!reads} /></li>
          </ul>
          <p className="muted">Review reserves refund through withdrawRefund({PROTOCOL.asset.slice(0, 8)}…). Ad balances use withdraw(), and recipients collect earned ad fees with withdrawProceeds().</p>
          <div className="actions">
            <button className="btn" disabled={!reads}>Withdraw refund</button>
            <button className="btn" disabled={!reads}>Withdraw proceeds</button>
          </div>
        </section>
      )}
    </div>
  );
}
