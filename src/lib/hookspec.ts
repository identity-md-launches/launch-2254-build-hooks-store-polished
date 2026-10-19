import { PROTOCOL } from "./protocol";

/** HookSpec v1 for the one supported template, hooks-store/bounded-swap/v1 (schemas/hook-spec.v1.schema.json). */
export type HookSpec = {
  schemaVersion: 1;
  templateId: "hooks-store/bounded-swap/v1";
  chainId: string;
  poolManager: string;
  poolManagerCodeHash: string;
  permissions: ["afterInitialize", "beforeSwap", "afterSwap"];
  maxSpecifiedAmount: string;
};

export type Draft = {
  presetId: string;
  name: string;
  brief: string;
  decimals: number;
  limitWhole: string;
  labels: string[];
  spec: HookSpec;
};

export const PERMISSIONS: HookSpec["permissions"] = ["afterInitialize", "beforeSwap", "afterSwap"];
export const UINT128_MAX = (1n << 128n) - 1n;

export function baseSpec(): HookSpec {
  return {
    schemaVersion: 1,
    templateId: "hooks-store/bounded-swap/v1",
    chainId: String(PROTOCOL.chainId),
    poolManager: PROTOCOL.poolManager,
    poolManagerCodeHash: PROTOCOL.poolManagerCodeHash,
    permissions: [...PERMISSIONS] as HookSpec["permissions"],
    maxSpecifiedAmount: "0",
  };
}

/** Whole-token limit plus decimals to raw base units, without floating point. */
export function toRaw(limitWhole: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(limitWhole.trim());
  if (!m || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export type Issue = { field: string; message: string };

/** The same rules the site's openJob encoder and HookRequestCodec.validateBrief enforce. */
export function validateDraft(d: Draft): Issue[] {
  const issues: Issue[] = [];
  if (!d.name.trim() || d.name.length > 64) issues.push({ field: "name", message: "Give the hook a name of 1 to 64 characters." });
  const bytes = new TextEncoder().encode(d.brief).length;
  if (!bytes || bytes > 2000) issues.push({ field: "brief", message: "The brief needs 1 to 2000 bytes of text." });
  else if (/["\\<>\u0000-\u001f\u007f]/u.test(d.brief)) issues.push({ field: "brief", message: "Remove quotes, backslashes, angle brackets and line breaks from the brief." });
  const raw = toRaw(d.limitWhole, d.decimals);
  if (raw === null) issues.push({ field: "limitWhole", message: `Enter a plain number with at most ${d.decimals} decimal places.` });
  else if (raw === 0n) issues.push({ field: "limitWhole", message: "The swap limit must be above zero." });
  else if (raw > UINT128_MAX) issues.push({ field: "limitWhole", message: "The limit is larger than uint128 allows." });
  if (d.labels.length > 16 || d.labels.some((l) => !/^[a-z0-9-]{1,32}$/.test(l))) issues.push({ field: "labels", message: "Labels are up to 16 lowercase words, digits or dashes." });
  const s = d.spec;
  if (s.schemaVersion !== 1 || s.templateId !== "hooks-store/bounded-swap/v1" || JSON.stringify(s.permissions) !== JSON.stringify(PERMISSIONS)) issues.push({ field: "spec", message: "Only the bounded-swap v1 template is supported." });
  if (s.chainId !== String(PROTOCOL.chainId) || s.poolManager !== PROTOCOL.poolManager || s.poolManagerCodeHash !== PROTOCOL.poolManagerCodeHash) issues.push({ field: "spec", message: "The spec must target the pinned Robinhood Chain PoolManager." });
  return issues;
}

export function withLimit(d: Draft): Draft {
  const raw = toRaw(d.limitWhole, d.decimals);
  return { ...d, spec: { ...d.spec, maxSpecifiedAmount: raw === null ? "0" : raw.toString() } };
}
