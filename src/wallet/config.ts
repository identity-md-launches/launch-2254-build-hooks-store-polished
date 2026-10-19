import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { robinhood, ROBINHOOD_RPC } from "./chain";

export const SITE_NAME = "The Hooks Store";
export const SITE_DESCRIPTION = "Browse, build and publish reviewed Uniswap v4 hooks on Robinhood Chain.";

export const walletConnectProjectId = ""; // only when a brief supplies one

export const config = createConfig({
  chains: [robinhood],
  // EIP-6963 discovery lists every installed extension (Rabby, MetaMask, ...) under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: { [robinhood.id]: http(ROBINHOOD_RPC) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
