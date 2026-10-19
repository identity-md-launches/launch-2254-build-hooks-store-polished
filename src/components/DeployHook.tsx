import { useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { readContract } from "wagmi/actions";
import { concat, isHex, keccak256, type Abi, type Address, type Hex } from "viem";
import type { ConfigState } from "../App";
import { ARTIFACTS } from "../lib/protocol";
import { CHAIN_ID, GateNotice, JOB_STATUS, REVIEW_STATUS, TxStatus, useTx, useWriteGate, walletError } from "../lib/tx";
import { Field, Mono, Notice } from "./ui";

const req = ARTIFACTS.AutoHookJobRequester.abi as Abi, dep = ARTIFACTS.GatedHookDeployer.abi as Abi;
const PAGE = 4096n, MAX_PAGES = 64;
type Artifact = { jobRequestId: Hex; deployer: Address; creationCodeHash: Hex; constructorArgsHash: Hex; permissions: bigint; [k: string]: unknown };
type Plan = { artifact: Artifact; creationCode: Hex; constructorArgs: Hex; salt: Hex; hook: Address; digest: Hex };
type Line = { label: string; ok: boolean; value: string };

/**
 * Port of the pinned sdk/gated_deploy.py automatic `prepare`: every gate is read back before the
 * wallet is asked, and GatedHookDeployer.check runs as the caller. The contract still enforces it all.
 */
export function DeployHook({ cfg, jobId: initialJob = "", onDeployed }: { cfg: ConfigState; jobId?: string; onDeployed?: (hook: Address, permissions: bigint) => void }) {
  const config = useConfig();
  const { address } = useAccount();
  const gate = useWriteGate(cfg);
  const tx = useTx();
  const [job, setJob] = useState(initialJob);
  const [code, setCode] = useState("");
  const [args, setArgs] = useState("0x");
  const [lines, setLines] = useState<Line[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requester = cfg.config?.contracts.AutoHookJobRequester as Address, deployer = cfg.config?.contracts.GatedHookDeployer as Address;
  const read = (a: Address, abi: Abi, functionName: string, fnArgs: unknown[] = []) => readContract(config, { address: a, abi, functionName, args: fnArgs, chainId: CHAIN_ID } as never) as Promise<unknown>;

  async function check() {
    setPlan(null); setLines([]); setError(null);
    if (!/^0x[0-9a-fA-F]{64}$/.test(job)) return setError("The job id is a 0x-prefixed 32-byte value.");
    if (!isHex(code) || code.length < 4 || code.length % 2) return setError("Paste the delivered creation code as 0x-prefixed hex.");
    if (!isHex(args) || args.length % 2) return setError("Constructor arguments are 0x-prefixed hex (0x when there are none).");
    if (gate || !address) return;
    setChecking(true);
    const out: Line[] = [];
    const add = (label: string, ok: boolean, value: string) => { out.push({ label, ok, value }); setLines([...out]); return ok; };
    try {
      const cand = (await read(requester, req, "getCandidate", [job])) as { artifact: Artifact; reviewedCommit: Hex };
      const a = cand.artifact;
      if (!add("Committed candidate for this job", a.jobRequestId.toLowerCase() === job.toLowerCase() && !/^0x0+$/.test(cand.reviewedCommit), cand.reviewedCommit)) return;
      if (!add("Candidate names the configured GatedHookDeployer", a.deployer.toLowerCase() === deployer.toLowerCase(), a.deployer)) return;
      if (!add("keccak256(creation code) = committed hash", keccak256(code) === a.creationCodeHash, keccak256(code))) return;
      if (!add("keccak256(constructor args) = committed hash", keccak256(args) === a.constructorArgsHash, keccak256(args))) return;
      const j = (await read(requester, req, "getJob", [job])) as { requester: Address; status: number; review: number; reviewRequestId: Hex };
      if (!add("You opened this job", j.requester.toLowerCase() === address.toLowerCase(), j.requester)) return;
      if (!add("Job delivered", j.status === 2, JOB_STATUS[j.status] ?? String(j.status))) return;
      if (!add("Signed oracle review passed (delivered is not approved)", j.review === 2, REVIEW_STATUS[j.review] ?? String(j.review))) return;
      const digest = (await read(deployer, dep, "artifactDigest", [a])) as Hex;
      const approved = (await read(requester, req, "approvedArtifact", [job])) as Hex;
      if (!add("Signed question authorizes this exact artifact", approved.toLowerCase() === digest.toLowerCase(), digest)) return;
      const epoch = (await read(requester, req, "reviewReceiptSignerEpoch", [j.reviewRequestId])) as number;
      const revoked = epoch ? ((await read(requester, req, "revokedSignerEpochs", [epoch])) as Hex) : "0x";
      if (!add("Signer epoch present and not revoked", epoch !== 0 && /^0x0+$/.test(revoked), String(epoch))) return;
      const init = keccak256(concat([code, args]));
      let start = 0n, salt: Hex | null = null, hook: Address | null = null;
      for (let p = 0; p < MAX_PAGES && !salt; p++) {
        const [found, s, h, next] = (await read(deployer, dep, "mine", [init, a.permissions, start, PAGE])) as [boolean, Hex, Address, bigint];
        if (found) { salt = s; hook = h; } else start = next;
      }
      if (!add("CREATE2 salt with the exact permission bits", !!salt, salt ?? `none; resume at nonce ${start}`) || !salt || !hook) return;
      const [checked, checkedDigest] = (await read(deployer, dep, "check", [a, "0x", code, args, salt, address])) as [Address, Hex];
      if (!add("GatedHookDeployer.check as you", checked.toLowerCase() === hook.toLowerCase() && checkedDigest === digest, checked)) return;
      setPlan({ artifact: a, creationCode: code, constructorArgs: args, salt, hook, digest });
    } catch (e) {
      setError(`${walletError(e)} Nothing was sent.`);
    } finally { setChecking(false); }
  }

  async function deploy() {
    if (!plan || gate) return;
    await tx.run("Deploy hook", { address: deployer, abi: dep, functionName: "deploy", args: [plan.artifact, "0x", plan.creationCode, plan.constructorArgs, plan.salt, plan.hook] }, async () => {
      const at = (await read(deployer, dep, "deployedHookOf", [plan.artifact.jobRequestId])) as Address;
      if (at.toLowerCase() !== plan.hook.toLowerCase()) throw new Error(`deployedHookOf reads ${at}, expected ${plan.hook}.`);
      onDeployed?.(plan.hook, plan.artifact.permissions);
      return `Hook deployed at ${plan.hook}; deployedHookOf(job) reads it back.`;
    });
  }

  return (
    <div className="deploy">
      <fieldset disabled={checking || tx.busy}>
        <legend className="sr">Deploy a reviewed build</legend>
        <Field id="d-job" label="Job id" hint="From Builds and reviews."><input id="d-job" value={job} onChange={(e) => { setJob(e.target.value.trim()); setPlan(null); }} autoComplete="off" spellCheck={false} /></Field>
        <Field id="d-code" label="Delivered creation code" hint="0x-prefixed hex from the delivered build."><textarea id="d-code" rows={3} value={code} onChange={(e) => { setCode(e.target.value.trim() as Hex); setPlan(null); }} spellCheck={false} /></Field>
        <Field id="d-args" label="Constructor arguments"><input id="d-args" value={args} onChange={(e) => { setArgs(e.target.value.trim()); setPlan(null); }} spellCheck={false} /></Field>
      </fieldset>
      <GateNotice reason={gate} />
      {error && <Notice tone="error" title="Check stopped">{error}</Notice>}
      {lines.length > 0 && (
        <ul className="checks">
          {lines.map((l) => <li key={l.label} className={l.ok ? "ok" : "bad"}><span aria-hidden="true">{l.ok ? "✓" : "✗"}</span> <span className="sr">{l.ok ? "Passed:" : "Failed:"}</span> {l.label} <Mono>{l.value}</Mono></li>)}
        </ul>
      )}
      {plan && <p>Predicted hook address <Mono>{plan.hook}</Mono>.</p>}
      <TxStatus state={tx.state} />
      <div className="actions">
        <button className="btn" disabled={!!gate || checking || tx.busy} onClick={check}>{checking ? "Checking…" : "Check build"}</button>
        <button className="btn primary" disabled={!plan || !!gate || tx.busy || tx.state.status === "done"} onClick={deploy}>{tx.busy ? "Working…" : tx.state.status === "error" ? "Try deploy again" : "Deploy hook"}</button>
      </div>
    </div>
  );
}
