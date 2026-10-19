import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import type { ConfigState } from "../App";
import { PROTOCOL, ARTIFACTS } from "../lib/protocol";
import {
  Rpc, STEPS, buildTx, constructorArgs, manifest, preflight, progressKey, siteConfigPatch, verifyStep,
  type Check, type Eip1193, type Inputs, type Progress, type Step, type StepId,
} from "../lib/operator";
import { Field, Mono, Notice } from "../components/ui";

const loadProgress = (key: string): Progress => {
  try { const p = JSON.parse(localStorage.getItem(key) ?? "null") as Progress | null; if (p?.key === key) return p; } catch { /* fresh */ }
  return { key, steps: {} };
};
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const download = (name: string, v: unknown) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json(v) + "\n"], { type: "application/json" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
};
const walletError = (e: unknown) => {
  const err = e as { code?: number; message?: string; cause?: { code?: number } };
  if (err?.code === 4001 || err?.cause?.code === 4001) return "You rejected the request in your wallet. Nothing was sent.";
  return (err?.message ?? String(e)).split("\n")[0]!;
};

function Checks({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  return (
    <ul className="checks">
      {checks.map((c, i) => (
        <li key={i} className={c.ok ? "ok" : "bad"}>
          <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> <span className="sr">{c.ok ? "Passed:" : "Failed:"}</span> {c.label}
          {!c.ok && <span className="muted"> expected <Mono>{c.expected}</Mono>, read <Mono>{c.actual}</Mono></span>}
        </li>
      ))}
    </ul>
  );
}

export function Operator({ cfg }: { cfg: ConfigState }) {
  const { connector, address, chainId } = useAccount();
  const [owner, setOwner] = useState("");
  const [recipient, setRecipient] = useState("");
  const [ownerOk, setOwnerOk] = useState(false);
  const [recipientOk, setRecipientOk] = useState(false);
  const [approved, setApproved] = useState(false);
  const [pre, setPre] = useState<Check[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "error" | "ok" | "warn"; text: string } | null>(null);
  const [stepChecks, setStepChecks] = useState<Partial<Record<StepId, Check[]>>>({});
  const [gas, setGas] = useState<Partial<Record<StepId, string>>>({});

  const inputs: Inputs | null = useMemo(() => {
    if (!ownerOk || !recipientOk || !isAddress(owner) || !isAddress(recipient)) return null;
    return {
      chainId: PROTOCOL.chainId, owner: getAddress(owner), adRecipient: getAddress(recipient),
      manager: getAddress(PROTOCOL.poolManager), managerCodeHash: PROTOCOL.poolManagerCodeHash,
      intake: getAddress(PROTOCOL.intake), asset: getAddress(PROTOCOL.asset), oracleSigner: getAddress(PROTOCOL.oracleSigner), maxPrice: PROTOCOL.maxPrice,
    };
  }, [owner, recipient, ownerOk, recipientOk]);
  const key = inputs ? progressKey(inputs) : null;
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => { setProgress(key ? loadProgress(key) : null); setPre([]); setStepChecks({}); }, [key]);
  const save = useCallback((p: Progress) => { localStorage.setItem(p.key, JSON.stringify(p)); setProgress(p); }, []);

  const rpc = useCallback(async () => {
    const p = (await connector?.getProvider()) as Eip1193 | undefined;
    if (!p) throw new Error("Connect the admin/deployer wallet first.");
    return new Rpc(p);
  }, [connector]);
  const addresses = (p: Progress) =>
    Object.fromEntries(STEPS.filter((s) => s.kind === "create" && p.steps[s.id]?.verified).map((s) => [s.id, p.steps[s.id]!.address])) as Partial<Record<StepId, Address>>;
  const preOk = pre.length > 0 && pre.every((c) => c.ok);

  async function runPreflight() {
    if (!inputs) return;
    setBusy("preflight"); setMsg(null);
    try { setPre(await preflight(await rpc(), inputs)); } catch (e) { setMsg({ tone: "error", text: walletError(e) }); } finally { setBusy(null); }
  }

  /** Recheck: receipt, code and state for a stored hash. Never resends. */
  const recheck = useCallback(async (step: Step, p: Progress): Promise<Progress> => {
    const rec = p.steps[step.id];
    if (!rec?.hash || !inputs) return p;
    const r = await rpc();
    const res = await verifyStep(r, step, inputs, addresses(p), rec.hash);
    if (res.pending) { setStepChecks((s) => ({ ...s, [step.id]: [] })); return p; }
    setStepChecks((s) => ({ ...s, [step.id]: res.checks }));
    const verified = res.checks.length > 0 && res.checks.every((c) => c.ok);
    const next: Progress = { ...p, steps: { ...p.steps, [step.id]: { ...rec, address: res.address, block: res.block, verified, checkedAt: new Date().toISOString() } } };
    save(next);
    return next;
  }, [inputs, rpc, save]);

  async function resumeAll() {
    if (!progress) return;
    setBusy("resume"); setMsg(null);
    try {
      let p = progress;
      for (const s of STEPS) if (p.steps[s.id]?.hash) p = await recheck(s, p);
      setMsg({ tone: "info", text: "Rechecked every stored transaction from its receipt, code and state. Nothing was sent." });
    } catch (e) { setMsg({ tone: "error", text: walletError(e) }); } finally { setBusy(null); }
  }

  async function estimate(step: Step) {
    if (!inputs || !progress) return;
    try {
      const r = await rpc();
      const tx = buildTx(step, inputs, addresses(progress));
      const [g, price] = await Promise.all([r.estimate(tx), r.gasPrice()]);
      setGas((x) => ({ ...x, [step.id]: `${g.toString()} gas · about ${(Number(g * price) / 1e18).toFixed(6)} ETH at current price` }));
    } catch (e) { setGas((x) => ({ ...x, [step.id]: `Estimate failed: ${walletError(e)}` })); }
  }

  async function send(step: Step) {
    if (!inputs || !progress) return;
    setBusy(step.id); setMsg(null);
    const before = progress;
    try {
      const r = await rpc();
      // Context guard right before the wallet prompt: same account, same chain, preflight still valid.
      const [acct] = await r.accounts();
      if (acct !== inputs.owner.toLowerCase()) throw new Error("The connected account is not the confirmed admin/deployer. Switch account in Rabby.");
      if ((await r.chainId()) !== inputs.chainId) throw new Error("The wallet is not on Robinhood Chain 4663.");
      const tx = buildTx(step, inputs, addresses(before));
      const gasLimit = await r.estimate(tx);
      const hash = await r.send({ ...tx, gas: "0x" + gasLimit.toString(16) });
      // Record the hash before anything else can fail, so a reload resumes instead of resending.
      const p1: Progress = { ...before, steps: { ...before.steps, [step.id]: { hash } } };
      save(p1);
      setMsg({ tone: "info", text: `Submitted ${hash}. Waiting for the receipt…` });
      const deadline = Date.now() + 180000;
      let p = p1;
      while (Date.now() < deadline) {
        p = await recheck(step, p);
        if (p.steps[step.id]?.checkedAt) break;
        await new Promise((res) => setTimeout(res, 1500));
      }
      const rec = p.steps[step.id];
      if (!rec?.checkedAt) setMsg({ tone: "warn", text: `No receipt yet for ${hash}. It may still be pending. Use “Recheck” later; do not resend.` });
      else if (rec.verified) setMsg({ tone: "ok", text: `${step.title} confirmed and verified.` });
      else setMsg({ tone: "error", text: `${step.title} was mined but failed verification. Its address is not used. Inspect the checks below.` });
    } catch (e) {
      setMsg({ tone: "error", text: walletError(e) });
    } finally { setBusy(null); }
  }

  function forget(step: Step) {
    if (!progress) return;
    const ok = window.confirm(`Forget the stored transaction for “${step.title}”? Only do this after confirming in Rabby or an explorer that it was dropped or replaced. Nothing is sent.`);
    if (!ok) return;
    const steps = { ...progress.steps }; delete steps[step.id];
    save({ ...progress, steps });
  }

  const firstOpen = progress ? STEPS.findIndex((s) => !progress.steps[s.id]?.verified) : 0;
  const done = progress ? STEPS.every((s) => progress.steps[s.id]?.verified) : false;
  const wrongChain = address && chainId !== PROTOCOL.chainId;

  return (
    <div className="operator">
      <h1>Operator setup</h1>
      <p className="lede">Deploy and configure the five store contracts from the pinned build, one approved wallet transaction at a time.</p>
      <Notice tone="warn" title="Operator only">
        This bootstraps production contracts and needs explicit approval before it is run on Robinhood Chain. Customers never use this page. Settings saved here stay in this browser; the public site changes only when the exported site-config.json is reviewed and committed.
      </Notice>
      {cfg.configured && <Notice tone="ok" title="Already configured">The committed site-config.json already names a deployment. Only continue for a reviewed redeployment.</Notice>}

      <section className="block">
        <h2>1. Addresses</h2>
        <Field id="owner" label="Admin / deployer address" hint="Owns every contract and signs every step. Must be the connected Rabby account.">
          <input id="owner" value={owner} spellCheck={false} autoComplete="off" onChange={(e) => { setOwner(e.target.value.trim()); setOwnerOk(false); }} aria-invalid={!!owner && !isAddress(owner)} />
        </Field>
        <label className="check"><input type="checkbox" checked={ownerOk} disabled={!isAddress(owner)} onChange={(e) => setOwnerOk(e.target.checked)} /> I confirm {isAddress(owner) ? <Mono>{getAddress(owner)}</Mono> : "this address"} is the admin/deployer.</label>
        <Field id="recipient" label="Ad proceeds recipient" hint="Receives earned #ad fees through withdrawProceeds(). Snapshotted per purchase.">
          <input id="recipient" value={recipient} spellCheck={false} autoComplete="off" onChange={(e) => { setRecipient(e.target.value.trim()); setRecipientOk(false); }} aria-invalid={!!recipient && !isAddress(recipient)} />
        </Field>
        <label className="check"><input type="checkbox" checked={recipientOk} disabled={!isAddress(recipient)} onChange={(e) => setRecipientOk(e.target.checked)} /> I confirm {isAddress(recipient) ? <Mono>{getAddress(recipient)}</Mono> : "this address"} is the ad recipient.</label>
        <details className="refs">
          <summary>Official dependencies (from the pinned manifest)</summary>
          <ul className="plain">
            <li>Intake v2 <Mono>{PROTOCOL.intake}</Mono></li>
            <li>IMD asset <Mono>{PROTOCOL.asset}</Mono></li>
            <li>Oracle signer <Mono>{PROTOCOL.oracleSigner}</Mono></li>
            <li>PoolManager pin <Mono>{PROTOCOL.poolManager}</Mono>, code hash <Mono>{PROTOCOL.poolManagerCodeHash}</Mono></li>
            <li>maxPrice per action <Mono>{PROTOCOL.maxPrice.toString()}</Mono> (0.5 IMD)</li>
          </ul>
        </details>
      </section>

      <section className="block">
        <h2>2. Preflight</h2>
        {wrongChain && <Notice tone="warn">Your wallet is on chain {chainId}. Switch to Robinhood Chain 4663 from the header.</Notice>}
        <button className="btn primary" disabled={!inputs || !address || busy !== null} onClick={runPreflight}>{busy === "preflight" ? "Checking…" : "Run live preflight"}</button>
        {!inputs && <p className="hint">Enter and confirm both addresses first.</p>}
        <Checks checks={pre} />
        {pre.length > 0 && !preOk && <Notice tone="error">Preflight failed. Every transaction stays disabled until it passes.</Notice>}
      </section>

      {progress && inputs && (
        <section className="block">
          <div className="block-head">
            <h2>3. Transactions</h2>
            <button className="btn" disabled={busy !== null} onClick={resumeAll}>{busy === "resume" ? "Rechecking…" : "Recheck stored progress"}</button>
          </div>
          <label className="check"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> I have explicit approval to bootstrap this deployment.</label>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <ol className="txsteps">
            {STEPS.map((s, i) => {
              const rec = progress.steps[s.id];
              const a = addresses(progress);
              let tx: { data: Hex; to?: Address } | null = null, args: unknown[] = [];
              try { tx = buildTx(s, inputs, a); args = s.kind === "create" ? constructorArgs(s.id, inputs, a) : []; } catch { tx = null; }
              const isNext = i === firstOpen;
              const canSend = isNext && preOk && approved && !rec?.hash && !!tx && busy === null && !wrongChain;
              return (
                <li key={s.id} className={rec?.verified ? "done" : isNext ? "now" : ""}>
                  <div className="tx-head">
                    <h3>{s.title}</h3>
                    <span className="state">{rec?.verified ? "Verified" : rec?.hash ? (rec.checkedAt ? "Failed verification" : "Submitted, no receipt yet") : isNext ? "Next" : "Waiting"}</span>
                  </div>
                  {tx ? (
                    <dl className="kv small">
                      <div><dt>To</dt><dd>{tx.to ? <Mono>{tx.to}</Mono> : "CREATE (no recipient), value 0"}</dd></div>
                      {s.kind === "create" && <div><dt>Initcode</dt><dd>{ARTIFACTS[s.contract].pin.initcodeBytes} bytes, sha256 <Mono>{ARTIFACTS[s.contract].pin.initcodeSha256.slice(0, 16)}…</Mono> (matches current-build.json)</dd></div>}
                      {args.length > 0 && <div><dt>Parameters</dt><dd><Mono>{json(args)}</Mono></dd></div>}
                      <div><dt>Calldata</dt><dd>{(tx.data.length - 2) / 2} bytes, keccak <Mono>{keccak256(tx.data).slice(0, 18)}…</Mono>{s.kind === "call" && <> <Mono>{tx.data}</Mono></>}</dd></div>
                      {gas[s.id] && <div><dt>Gas</dt><dd>{gas[s.id]}</dd></div>}
                      {rec?.hash && <div><dt>Transaction</dt><dd><Mono>{rec.hash}</Mono></dd></div>}
                      {rec?.address && <div><dt>Address</dt><dd><Mono>{rec.address}</Mono></dd></div>}
                    </dl>
                  ) : <p className="muted">Available after the contracts it depends on are verified.</p>}
                  <Checks checks={stepChecks[s.id] ?? []} />
                  <div className="actions">
                    {tx && !rec?.hash && isNext && <button className="btn" disabled={busy !== null || !preOk} onClick={() => estimate(s)}>Estimate gas</button>}
                    {!rec?.hash && isNext && <button className="btn primary" disabled={!canSend} onClick={() => send(s)}>{busy === s.id ? "Waiting for wallet…" : "Approve in wallet"}</button>}
                    {rec?.hash && <button className="btn" disabled={busy !== null} onClick={async () => { setBusy("recheck"); try { await recheck(s, progress); } catch (e) { setMsg({ tone: "error", text: walletError(e) }); } finally { setBusy(null); } }}>Recheck</button>}
                    {rec?.hash && !rec.verified && <button className="btn link" onClick={() => forget(s)}>Forget this transaction</button>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {progress && inputs && (
        <section className="block">
          <h2>4. Manifest and site configuration</h2>
          <p>Download both files, review them, and commit site-config.json to <Mono>public/site-config.json</Mono> in a reviewed change. {done ? "All steps are verified." : "Steps are still open; the files mark the deployment incomplete."}</p>
          <div className="actions">
            <button className="btn" onClick={() => download("hooks-store-deployment.4663.json", manifest(inputs, progress))}>Download deployment manifest</button>
            <button className="btn primary" disabled={!done} onClick={() => download("site-config.json", siteConfigPatch(inputs, progress))}>Download site-config.json</button>
          </div>
        </section>
      )}
    </div>
  );
}
