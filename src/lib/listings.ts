import { createPublicClient, http, type Abi, type Address } from "viem";
import { ARTIFACTS } from "./protocol";
import type { SiteConfig } from "./siteConfig";
import { robinhood } from "../wallet/chain";

export type Listing = {
  id: bigint; chainId: bigint; hook: Address; owner: Address; revision: bigint; active: boolean;
  name: string; sourceRef: string; testRef: string; reviewRef: string; auditRef: string;
  callbackMask: bigint; callbackDisclosure: string; feeDisclosure: string; adminDisclosure: string; labels: string[];
};
export type Placement = { id: bigint; listingId: bigint; revision: bigint; endsAt: bigint; recipient: Address };

const reg = ARTIFACTS.HookListingRegistry.abi as Abi, ads = ARTIFACTS.FeaturedPlacements.abi as Abi;

/** Reads up to `limit` listings and the current #ad placements from the configured contracts. */
export async function readStore(cfg: SiteConfig, limit = 60): Promise<{ listings: Listing[]; placements: Placement[] }> {
  const registry = cfg.contracts.HookListingRegistry as Address, featured = cfg.contracts.FeaturedPlacements as Address;
  const client = createPublicClient({ chain: robinhood, transport: http(cfg.rpcUrl) });
  const count = (await client.readContract({ address: registry, abi: reg, functionName: "listingCount" })) as bigint;
  const listings: Listing[] = [];
  for (let id = 1n; id <= count && listings.length < limit; id++) {
    const l = (await client.readContract({ address: registry, abi: reg, functionName: "getListing", args: [id] })) as Record<string, unknown>;
    const m = (await client.readContract({ address: registry, abi: reg, functionName: "getMetadata", args: [id, l.revision] })) as Record<string, unknown>;
    listings.push({ id, ...(l as object), ...(m as object) } as Listing);
  }
  const page = (await client.readContract({ address: featured, abi: ads, functionName: "featured", args: [0n, 100n] })) as unknown[];
  const ids = (Array.isArray(page[0]) ? page[0] : []) as bigint[];
  const placements: Placement[] = [];
  for (const pid of ids) {
    const p = (await client.readContract({ address: featured, abi: ads, functionName: "getPlacement", args: [pid] })) as Record<string, unknown>;
    placements.push({ id: pid, listingId: p.listingId as bigint, revision: p.revision as bigint, endsAt: p.endsAt as bigint, recipient: p.recipient as Address });
  }
  return { listings, placements };
}
