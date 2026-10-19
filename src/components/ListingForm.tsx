import { useState } from "react";
import { decodeEventLog, isAddress, type Abi, type Address } from "viem";
import type { ConfigState } from "../App";
import { ARTIFACTS } from "../lib/protocol";
import { CHAIN_ID, GateNotice, TxStatus, useTx, useWriteGate } from "../lib/tx";
import { Field } from "./ui";

export type ListingDraft = {
  hook: string; name: string; sourceRef: string; testRef: string; reviewRef: string; auditRef: string;
  callbackMask: string; callbackDisclosure: string; feeDisclosure: string; adminDisclosure: string; labels: string;
};
export const emptyListing = (p: Partial<ListingDraft> = {}): ListingDraft => ({
  hook: "", name: "", sourceRef: "", testRef: "", reviewRef: "", auditRef: "", callbackMask: "",
  callbackDisclosure: "", feeDisclosure: "No creator fee.", adminDisclosure: "No admin functions.", labels: "", ...p,
});

const reg = ARTIFACTS.HookListingRegistry.abi as Abi;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const labelsOf = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** The registry's own _validate rules, checked before the wallet is asked. */
export function listingIssues(d: ListingDraft, update: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!update && (!isAddress(d.hook) || /^0x0{40}$/i.test(d.hook))) e.hook = "Enter the deployed hook address.";
  if (!bytes(d.name) || bytes(d.name) > 96) e.name = "Give the listing a name of up to 96 bytes.";
  for (const k of ["sourceRef", "testRef", "reviewRef", "auditRef"] as const) if (bytes(d[k]) > 512) e[k] = "Keep references to 512 bytes.";
  for (const k of ["callbackDisclosure", "feeDisclosure", "adminDisclosure"] as const) if (!bytes(d[k]) || bytes(d[k]) > 1024) e[k] = "Required, up to 1024 bytes.";
  if (!/^(0x[0-9a-f]{1,4}|\d{1,5})$/i.test(d.callbackMask.trim()) || Number(d.callbackMask) > 0x3fff) e.callbackMask = "A callback mask from 0 to 0x3fff.";
  const ls = labelsOf(d.labels);
  if (ls.length > 16 || ls.some((l) => !/^[a-z0-9-]{1,32}$/.test(l)) || new Set(ls).size !== ls.length) e.labels = "Up to 16 unique labels of a-z, 0-9 and hyphens.";
  return e;
}

/** Create (free, gas only) or update a listing revision on HookListingRegistry. */
export function ListingForm({ cfg, initial, listingId, onDone }: { cfg: ConfigState; initial: ListingDraft; listingId?: bigint; onDone?: (id: bigint) => void }) {
  const [d, setD] = useState(initial);
  const [touched, setTouched] = useState(false);
  const gate = useWriteGate(cfg);
  const tx = useTx();
  const update = listingId !== undefined;
  const issues = listingIssues(d, update);
  const err = (k: string) => (touched ? issues[k] : undefined);
  const set = (k: keyof ListingDraft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const registry = cfg.config?.contracts.HookListingRegistry as Address;

  async function submit() {
    setTouched(true);
    if (Object.keys(issues).length || gate) return;
    const data = {
      name: d.name, sourceRef: d.sourceRef, testRef: d.testRef, reviewRef: d.reviewRef, auditRef: d.auditRef,
      callbackMask: BigInt(d.callbackMask.trim()), callbackDisclosure: d.callbackDisclosure, feeDisclosure: d.feeDisclosure,
      adminDisclosure: d.adminDisclosure, labels: labelsOf(d.labels),
    };
    await tx.run(update ? "Update listing" : "Publish listing",
      { address: registry, abi: reg, functionName: update ? "updateListing" : "createListing", args: update ? [listingId, data] : [BigInt(CHAIN_ID), d.hook, data] },
      async (r) => {
        let id = listingId;
        for (const log of r.logs) {
          try { const ev = decodeEventLog({ abi: reg, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: { listingId: bigint } }; if (ev.eventName === "ListingCreated" && log.address.toLowerCase() === registry.toLowerCase()) id = ev.args.listingId; } catch { /* other events */ }
        }
        if (id === undefined) throw new Error("The receipt has no ListingCreated event from the configured registry.");
        onDone?.(id);
        return `Listing #${id} is ${update ? "updated" : "published"}. It shows in Browse after the next read.`;
      });
  }

  const input = (k: keyof ListingDraft, label: string, hint?: string) => (
    <Field id={`l-${k}`} label={label} hint={hint} error={err(k)}>
      <input id={`l-${k}`} value={d[k]} onChange={set(k)} aria-invalid={!!err(k)} autoComplete="off" />
    </Field>
  );
  const area = (k: keyof ListingDraft, label: string) => (
    <Field id={`l-${k}`} label={label} error={err(k)}>
      <textarea id={`l-${k}`} rows={2} value={d[k]} onChange={set(k)} aria-invalid={!!err(k)} />
    </Field>
  );

  return (
    <form className="listing-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={tx.busy}>
        <legend className="sr">{update ? `Edit listing #${listingId}` : "New listing"}</legend>
        {!update && input("hook", "Hook address", "The address GatedHookDeployer deployed.")}
        {input("name", "Name")}
        <div className="row2">
          {input("labels", "Labels", "Comma separated, lowercase.")}
          {input("callbackMask", "Callback mask", "Low 14 bits of the hook address, e.g. 0x10c0.")}
        </div>
        {input("sourceRef", "Source link")}
        {input("reviewRef", "Signed review evidence", "Job id or review link.")}
        <div className="row2">{input("testRef", "Tests link")}{input("auditRef", "Audit link (optional)")}</div>
        {area("callbackDisclosure", "What the callbacks do")}
        {area("feeDisclosure", "Creator fees")}
        {area("adminDisclosure", "Admin powers")}
      </fieldset>
      <GateNotice reason={gate} />
      <TxStatus state={tx.state} />
      <div className="actions">
        <button className="btn primary" type="submit" disabled={!!gate || tx.busy}>{tx.busy ? "Working…" : tx.state.status === "error" ? "Try again" : update ? "Save new revision" : "Publish listing"}</button>
        <span className="hint">Free. You only pay gas.</span>
      </div>
    </form>
  );
}
