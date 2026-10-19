import { useEffect, useMemo, useState } from "react";
import type { ConfigState } from "../App";
import { PRESETS, draftFrom } from "../lib/presets";
import { toRaw, validateDraft, withLimit, type Draft } from "../lib/hookspec";
import { FEES, formatImd } from "../lib/protocol";
import { Field, KV, Mono, Notice } from "../components/ui";
import { DeployHook } from "../components/DeployHook";
import { ListingForm, emptyListing } from "../components/ListingForm";

const STEPS = ["Preset", "Customize", "Review", "Build", "Signed review", "Deploy", "Publish"] as const;
const KEY = "hooks-store:draft:v1";
type Saved = { step: number; draft: Draft; mode: "guide" | "blocks" };
type Msg = { from: "guide" | "you"; text: string };

function load(): Saved | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null; return s && s.draft ? s : null; } catch { return null; }
}

export function Create({ cfg }: { cfg: ConfigState }) {
  const initial = useMemo(() => {
    const want = sessionStorage.getItem("hooks-store:preset");
    sessionStorage.removeItem("hooks-store:preset");
    const p = PRESETS.find((x) => x.id === want);
    return p ? { step: 1, draft: draftFrom(p), mode: "blocks" as const } : load();
  }, []);
  const [step, setStep] = useState(initial?.step ?? 0);
  const [draft, setDraft] = useState<Draft | null>(initial?.draft ?? null);
  const [mode, setMode] = useState<"guide" | "blocks">(initial?.mode ?? "blocks");
  const [chat, setChat] = useState<Msg[]>([]);
  const [say, setSay] = useState("");
  const [touched, setTouched] = useState(false);
  const [deployed, setDeployed] = useState<{ hook: string; mask: string } | null>(null);

  useEffect(() => { if (draft) localStorage.setItem(KEY, JSON.stringify({ step, draft, mode })); }, [step, draft, mode]);
  useEffect(() => {
    const p = PRESETS.find((x) => x.id === draft?.presetId);
    if (p && chat.length === 0) setChat(p.guidance.map((text) => ({ from: "guide", text })));
  }, [draft?.presetId, chat.length]);

  const issues = draft ? validateDraft(draft) : [];
  const err = (f: string) => (touched ? issues.find((i) => i.field === f)?.message : undefined);
  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? withLimit({ ...d, ...patch }) : d));

  function pick(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    setDraft(draftFrom(p)); setChat(p.guidance.map((text) => ({ from: "guide", text }))); setTouched(false); setStep(1);
  }

  // Scripted guide: recognises a few phrasings and edits the same draft the blocks edit.
  function reply(text: string) {
    if (!draft || !text.trim()) return;
    const t = text.trim(), out: Msg[] = [{ from: "you", text: t }];
    const dec = /(\d+)\s*decimals?/i.exec(t), lim = /(?:limit|cap|max)\D*([\d.]+)/i.exec(t) ?? /^([\d.]+)$/.exec(t), nm = /^name\s+(.+)/i.exec(t);
    if (dec) { update({ decimals: Number(dec[1]) }); out.push({ from: "guide", text: `Decimals set to ${dec[1]}.` }); }
    if (lim && !dec) { update({ limitWhole: lim[1]! }); out.push({ from: "guide", text: `Swap limit set to ${lim[1]} tokens. Check it in the blocks view.` }); }
    if (nm) { update({ name: nm[1]!.slice(0, 64) }); out.push({ from: "guide", text: `Name set to “${nm[1]}”.` }); }
    if (out.length === 1) out.push({ from: "guide", text: "I only understand “limit 500”, “6 decimals” or “name My hook”. Everything else is in the blocks view." });
    setChat((c) => [...c, ...out]); setSay("");
  }

  const raw = draft ? toRaw(draft.limitWhole, draft.decimals) : null;
  const next = (n: number) => { if (n >= 2 && issues.length) { setTouched(true); setStep(1); return; } setStep(n); };

  return (
    <div className="create">
      <h1>Create a hook</h1>
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "now" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
            <button disabled={!draft && i > 0} onClick={() => next(i)} aria-label={`Step ${i + 1}: ${s}`}><span className="num">{i + 1}</span><span className="lbl">{s}</span></button>
          </li>
        ))}
      </ol>
      <p className="next-action" role="status">
        Step {step + 1} of {STEPS.length}: <strong>{STEPS[step]}</strong>. {[
          "Pick a starting preset.", "Set the name, limit and brief. The guide and the blocks edit the same spec.",
          "Check the spec and the fees.", "Pay for the build.", "Request the signed oracle review.", "Deploy through GatedHookDeployer.", "List the hook for free.",
        ][step]}
      </p>

      {step === 0 && (
        <div className="grid">
          {PRESETS.map((p) => (
            <button key={p.id} className={`card pick${draft?.presetId === p.id ? " on" : ""}`} onClick={() => pick(p.id)}>
              <h3>{p.title}</h3><p>{p.summary}</p>
            </button>
          ))}
        </div>
      )}

      {step === 1 && draft && (
        <section className="block">
          <div className="seg" role="group" aria-label="Editing mode">
            <button aria-pressed={mode === "guide"} className={mode === "guide" ? "on" : ""} onClick={() => setMode("guide")}>Guide</button>
            <button aria-pressed={mode === "blocks"} className={mode === "blocks" ? "on" : ""} onClick={() => setMode("blocks")}>Blocks</button>
          </div>
          {mode === "guide" ? (
            <div className="chat">
              <p className="muted">A scripted preset guide, not live AI. It cannot judge whether a custom hook is safe.</p>
              <ul className="msgs" aria-live="polite">{chat.map((m, i) => <li key={i} className={m.from}>{m.text}</li>)}</ul>
              <form className="say" onSubmit={(e) => { e.preventDefault(); reply(say); }}>
                <label htmlFor="say" className="sr">Message the guide</label>
                <input id="say" value={say} onChange={(e) => setSay(e.target.value)} placeholder="Try: limit 500" autoComplete="off" />
                <button className="btn" type="submit">Send</button>
              </form>
            </div>
          ) : (
            <div className="blocks">
              <div className="blk"><span className="blk-k">Template</span><span>Bounded swap v1 · afterInitialize, beforeSwap, afterSwap</span></div>
              <div className="blk"><span className="blk-k">Pool manager</span><Mono>Robinhood Chain v4 PoolManager (pinned)</Mono></div>
              <Field id="name" label="Hook name" error={err("name")}>
                <input id="name" value={draft.name} maxLength={64} onChange={(e) => update({ name: e.target.value })} aria-invalid={!!err("name")} />
              </Field>
              <div className="row2">
                <Field id="limit" label="Swap limit (tokens)" hint={raw !== null && raw > 0n ? `${raw.toString()} base units` : "A positive number"} error={err("limitWhole")}>
                  <input id="limit" inputMode="decimal" value={draft.limitWhole} onChange={(e) => update({ limitWhole: e.target.value })} aria-invalid={!!err("limitWhole")} />
                </Field>
                <Field id="decimals" label="Token decimals">
                  <select id="decimals" value={draft.decimals} onChange={(e) => update({ decimals: Number(e.target.value) })}>
                    {[6, 8, 18].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </div>
              <Field id="brief" label="Build brief" hint="Plain text, up to 2000 bytes, no quotes or line breaks." error={err("brief")}>
                <textarea id="brief" rows={3} value={draft.brief} onChange={(e) => update({ brief: e.target.value })} aria-invalid={!!err("brief")} />
              </Field>
              <Field id="labels" label="Labels" hint="Comma separated, lowercase." error={err("labels")}>
                <input id="labels" value={draft.labels.join(", ")} onChange={(e) => update({ labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              </Field>
            </div>
          )}
          {touched && issues.length > 0 && <Notice tone="error" title="Fix before review">{issues.map((i) => i.message).join(" ")}</Notice>}
          <div className="actions"><button className="btn" onClick={() => setStep(0)}>Change preset</button><button className="btn primary" onClick={() => next(2)}>Review spec and fees</button></div>
        </section>
      )}

      {step === 2 && draft && (
        <section className="block">
          <h2>Specification</h2>
          <pre className="code" tabIndex={0}>{JSON.stringify(draft.spec, null, 2)}</pre>
          <h2>Fees</h2>
          <table className="fees">
            <tbody>
              <tr><th scope="row">Build (job.open@job-1)</th><td>{formatImd(FEES.build)}</td></tr>
              <tr><th scope="row">Signed oracle review (oracle.request@oracle-1)</th><td>{formatImd(FEES.review)}</td></tr>
              <tr><th scope="row">Listing</th><td>Free</td></tr>
              <tr><th scope="row">Network gas</th><td>Shown by your wallet per transaction</td></tr>
              <tr className="total"><th scope="row">Total before gas</th><td>{formatImd(FEES.build + FEES.review)}</td></tr>
            </tbody>
          </table>
          <p className="muted">Prices are the current Intake quotes and are read again before you pay. Each is capped at 0.5 IMD. An unused review reserve can be withdrawn.</p>
          <div className="actions"><button className="btn" onClick={() => setStep(1)}>Edit</button><button className="btn primary" onClick={() => setStep(3)}>Continue to build</button></div>
        </section>
      )}

      {step >= 3 && draft && (
        <section className="block">
          <h2>{STEPS[step]}</h2>
          {step <= 4 && (
            <>
              <KV rows={step === 3 ? [
                ["Build", "Approve exactly the build price plus the review reserve, then open the job. Two wallet prompts."],
                ["Price", `${formatImd(FEES.build)} build + ${formatImd(FEES.review)} review reserve, plus gas`],
              ] : [
                ["Signed review", "After delivery, commit the artifact and request the oracle verdict once eight native blocks pass."],
                ["Price", `${formatImd(FEES.review)} from the reserve, plus gas. An unused reserve can be withdrawn.`],
              ]} />
              <Notice tone="warn" title="Payments are off">
                {cfg.configured ? "Customer payments stay disabled until an approved live pilot." : "The store contracts are not configured yet, so nothing can be paid or signed."} Your draft is saved in this browser and resumes here. If you already have a delivered, reviewed job, go on to Deploy.
              </Notice>
            </>
          )}
          {step === 5 && (
            <>
              <p>GatedHookDeployer deploys only the exact artifact the signed oracle review passed. Deploying costs gas only.</p>
              <DeployHook cfg={cfg} onDeployed={(hook, permissions) => setDeployed({ hook, mask: `0x${permissions.toString(16)}` })} />
            </>
          )}
          {step === 6 && (
            <>
              <p>Listing is free. Disclose what the hook does, its fees and its admin powers.</p>
              <ListingForm cfg={cfg} initial={emptyListing({
                hook: deployed?.hook ?? "", name: draft.name, labels: draft.labels.join(", "), callbackMask: deployed?.mask ?? "0x10c0",
                callbackDisclosure: `afterInitialize, beforeSwap and afterSwap. Swaps above ${draft.limitWhole} tokens (${draft.decimals} decimals) revert.`,
              })} />
            </>
          )}
          <div className="actions">
            <button className="btn" onClick={() => setStep(step - 1)}>Back</button>
            {step <= 4 && <button className="btn primary" disabled aria-describedby="paid-off">{step === 3 ? "Approve and open job" : "Request signed review"}</button>}
            {step < 6 && <button className="btn" onClick={() => setStep(step + 1)}>{step <= 4 ? "Skip to next step" : "Go to Publish"}</button>}
          </div>
          {step <= 4 && <p className="hint" id="paid-off">Paid steps stay off in this release.</p>}
        </section>
      )}
    </div>
  );
}
