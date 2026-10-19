import { useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import type { ConfigState } from "../App";
import { Mono, Notice } from "../components/ui";

export const CHAIN_ID = 4663;
export const JOB_STATUS = ["None", "Open", "Delivered", "Failed", "Expired"] as const;
export const REVIEW_STATUS = ["None", "Pending", "Passed", "Not passed", "Unanswered"] as const;
export const PLACEMENT_STATUS = ["None", "Open", "Cancelled", "Settled"] as const;

export function walletError(e: unknown): string {
  const err = e as { code?: number; message?: string; shortMessage?: string; cause?: { code?: number } };
  if (err?.code === 4001 || err?.cause?.code === 4001 || /user rejected|denied/i.test(err?.message ?? "")) return "You rejected the request in your wallet. Nothing was sent.";
  return (err?.shortMessage ?? err?.message ?? String(e)).split("\n")[0]!;
}

/**
 * Why a write is not possible right now, or null when it is. Free writes need the reviewed
 * site-config, a connected wallet and chain 4663; paid writes also need customerPaymentsEnabled.
 */
export function useWriteGate(cfg: ConfigState, opts: { payment?: boolean } = {}): string | null {
  const { isConnected, chainId } = useAccount();
  if (!cfg.configured) return "The store contracts are not configured yet.";
  if (opts.payment && cfg.config?.customerPaymentsEnabled !== true) return "Payments stay off until an approved live pilot.";
  if (!isConnected) return "Connect a wallet first.";
  if (chainId !== CHAIN_ID) return "Switch your wallet to Robinhood Chain (4663).";
  return null;
}

export function GateNotice({ reason }: { reason: string | null }) {
  const config = useConfig();
  const [err, setErr] = useState<string | null>(null);
  if (!reason) return null;
  const wrongChain = reason.startsWith("Switch");
  return (
    <Notice tone="warn" title="Not available yet">
      {reason}
      {wrongChain && <> <button className="btn link" onClick={() => switchChain(config, { chainId: CHAIN_ID }).catch((e) => setErr(walletError(e)))}>Switch network</button></>}
      {err && <span className="err"> {err}</span>}
    </Notice>
  );
}

export type TxState = { status: "idle" | "signing" | "pending" | "done" | "error"; label?: string; hash?: Hex; error?: string; note?: string };
export type WriteRequest = { address: Address; abi: Abi; functionName: string; args: unknown[] };

/**
 * One write at a time: sign, wait for the receipt, run the readback, report. An error keeps the
 * last submitted hash so a slow receipt is never mistaken for nothing sent; retry is a click, never automatic.
 */
export function useTx() {
  const config = useConfig();
  const [state, setState] = useState<TxState>({ status: "idle" });
  const busy = state.status === "signing" || state.status === "pending";
  async function run(label: string, req: WriteRequest, after?: (r: TransactionReceipt) => Promise<string | void>): Promise<TransactionReceipt | null> {
    if (busy) return null;
    setState((s) => ({ status: "signing", label, hash: s.hash }));
    let hash: Hex | undefined;
    try {
      hash = await writeContract(config, { ...req, chainId: CHAIN_ID } as never);
      setState({ status: "pending", label, hash });
      const r = await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID });
      if (r.status !== "success") throw new Error("The transaction reverted on chain. Nothing changed.");
      const note = after ? await after(r) : undefined;
      setState({ status: "done", label, hash, note: note || undefined });
      return r;
    } catch (e) {
      setState((s) => ({ status: "error", label, hash: hash ?? s.hash, error: walletError(e) }));
      return null;
    }
  }
  return { state, busy, run, reset: () => setState({ status: "idle" }) };
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const hash = state.hash ? <> Transaction <Mono>{state.hash}</Mono>.</> : null;
  if (state.status === "signing") return <Notice title={`${state.label}: confirm in your wallet`}>One wallet prompt. Nothing is sent until you approve it.</Notice>;
  if (state.status === "pending") return <Notice title={`${state.label}: waiting for the receipt`}>{hash} Do not resend; this page keeps checking.</Notice>;
  if (state.status === "done") return <Notice tone="ok" title={`${state.label}: confirmed`}>{state.note ?? "Receipt succeeded."}{hash}</Notice>;
  return <Notice tone="error" title={`${state.label}: failed`}>{state.error}{hash && <> Last submitted:{hash} Check it in your wallet before trying again.</>}</Notice>;
}
