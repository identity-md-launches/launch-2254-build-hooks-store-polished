import artifacts from "../artifacts/contracts.json";
import currentBuild from "../artifacts/current-build.json";

/**
 * Robinhood Chain (4663) protocol references copied from the pinned repository's
 * deployment/manifest.json and docs/DEPLOYMENT_PREPARATION.md (observed 2026-10-17).
 * They are inputs the operator wizard re-verifies live before any transaction.
 */
export const PROTOCOL = {
  chainId: 4663,
  intake: "0xa43e6f75ee006411f79ac1c84120606c2330de82",
  asset: "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127",
  oracleSigner: "0x5598aa9146215bc13eb26f2c692ad1461fd32982",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  poolManagerCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  arbSys: "0x0000000000000000000000000000000000000064",
  actions: {
    job: "0x6a6f622e6f70656e406a6f622d31000000000000000000000000000000000000",
    oracle: "0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000",
  },
  maxPrice: 500000000000000000n,
  minimumWindowAgeBlocks: 3462008n,
  panelSize: 7n,
  quorum: 5n,
  windowDepth: 8n,
} as const;

/** Fees as published; the wizard and the request flow re-read live quotes before any payment. */
export const FEES = {
  build: 500000000000000000n,
  review: 500000000000000000n,
  ad: 100000000000000000n,
  adDays: 7,
} as const;

export const SOURCE = {
  repo: "https://github.com/identity-md-launches/launch-1811-build-technical-foundation-hooks",
  commit: "46e17ea70534e8a7ac2c4ff78501a3c183d32da8",
  file: (path: string) => `${SOURCE.repo}/blob/${SOURCE.commit}/${path}`,
};

export type ContractName = "HookListingRegistry" | "FeaturedPlacements" | "HookRequestCodec" | "AutoHookJobRequester" | "GatedHookDeployer";
type Artifact = {
  abi: readonly unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  immutables: { name: string; refs: { start: number; length: number }[] }[];
  pin: { initcodeSha256: string; initcodeBytes: number; runtimeSha256: string; runtimeBytes: number };
};
export const ARTIFACTS = (artifacts as unknown as { contracts: Record<ContractName, Artifact> }).contracts;
export const BUILD = currentBuild as unknown as {
  baseCommit: string;
  description: string;
  contracts: Record<string, { bytecode: { sha256: string; bytes: number }; deployedBytecode: { sha256: string; bytes: number } }>;
};

export const formatImd = (wei: bigint) => {
  const whole = wei / 10n ** 18n, frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""} IMD`;
};
