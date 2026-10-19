import { baseSpec, withLimit, type Draft } from "./hookspec";

/** Starting presets. Every preset is the bounded-swap v1 template with a different limit and brief. */
export type Preset = { id: string; title: string; summary: string; tags: string[]; decimals: number; limitWhole: string; brief: string; guidance: string[] };

export const PRESETS: Preset[] = [
  {
    id: "retail-cap", title: "Retail trade cap", tags: ["swap-limit", "retail", "stablecoin"],
    summary: "Caps every swap in a stablecoin pool at 1,000 tokens.", decimals: 6, limitWhole: "1000",
    brief: "Bounded swap hook for a USDC pool. Reject any swap whose specified amount exceeds 1000 USDC in either direction.",
    guidance: ["This preset fits a stablecoin pool that should only serve small trades.", "USDC has 6 decimals, so 1,000 tokens is 1,000,000,000 base units.", "Change the limit in the blocks if your pool trades larger sizes."],
  },
  {
    id: "launch-guard", title: "Launch-day guard", tags: ["swap-limit", "launch", "eth"],
    summary: "Limits each swap to 5 ETH-sized units while a new pool finds its price.", decimals: 18, limitWhole: "5",
    brief: "Bounded swap hook for a new 18-decimal token pool. Reject any single swap above 5 tokens of the specified currency.",
    guidance: ["A new pool with thin liquidity is easy to move with one large swap.", "A 5-token cap slows that down. It does not stop many small swaps.", "The limit cannot be changed later: a new limit needs a new hook and a new pool."],
  },
  {
    id: "custom", title: "Start from blank", tags: ["swap-limit", "custom"],
    summary: "Choose your own decimals and limit for the bounded-swap template.", decimals: 18, limitWhole: "",
    brief: "",
    guidance: ["Only one template exists today: a swap-size limit with no fees, owner or pause.", "Pick the decimals of the currency your pool specifies and a limit above zero.", "Write a short brief in plain text; it becomes part of the build request."],
  },
];

export function draftFrom(p: Preset): Draft {
  return withLimit({ presetId: p.id, name: p.id === "custom" ? "" : p.title, brief: p.brief, decimals: p.decimals, limitWhole: p.limitWhole, labels: p.tags, spec: baseSpec() });
}
