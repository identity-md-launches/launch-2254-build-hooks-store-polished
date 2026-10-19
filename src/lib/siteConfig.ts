import { isAddress } from "viem";
import type { ContractName } from "./protocol";

export type SiteConfig = {
  status: string;
  chainId: number;
  rpcUrl: string;
  explorer: string | null;
  admin: string | null;
  adRecipient: string | null;
  contracts: Record<ContractName, string | null>;
  customerPaymentsEnabled: boolean;
};

/**
 * The public site is configured only by the committed, reviewed site-config.json served beside
 * index.html. Nothing in browser storage can change it.
 */
export async function loadSiteConfig(): Promise<SiteConfig> {
  const res = await fetch("./site-config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`site-config.json returned ${res.status}`);
  return (await res.json()) as SiteConfig;
}

/** Production writes need every contract, the admin and the ad recipient configured. */
export function writesConfigured(c: SiteConfig | null): boolean {
  if (!c || c.chainId !== 4663) return false;
  return [c.admin, c.adRecipient, ...Object.values(c.contracts)].every((a) => typeof a === "string" && isAddress(a));
}
