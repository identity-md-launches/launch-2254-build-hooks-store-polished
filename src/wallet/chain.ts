import { defineChain } from "viem";

export const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";

/** Robinhood Chain mainnet, chain id 4663 (the only chain this store targets). */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC] } },
});
