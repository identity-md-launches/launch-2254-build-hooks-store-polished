import {
  decodeFunctionResult, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, isAddress,
  keccak256, numberToHex, pad, toHex, type Abi, type Address, type Hex,
} from "viem";
import { ARTIFACTS, PROTOCOL, type ContractName } from "./protocol";

/** Minimal EIP-1193 surface: the wizard reads and writes only through the connected wallet. */
export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export type Inputs = {
  chainId: number;
  owner: Address;       // admin/deployer: the connected account that signs every step and owns every contract
  adRecipient: Address; // FeaturedPlacements proceeds recipient
  manager: Address;     // GatedHookDeployer.setManager target: the pinned PoolManager
  managerCodeHash: Hex;
  intake: Address;
  asset: Address;
  oracleSigner: Address;
  maxPrice: bigint;
};

export type StepId =
  | "HookListingRegistry" | "FeaturedPlacements" | "HookRequestCodec" | "AutoHookJobRequester" | "GatedHookDeployer"
  | "configureToken" | "setProceedsRecipient" | "setManager";

export type Step = { id: StepId; kind: "create" | "call"; contract: ContractName; title: string };

export const STEPS: Step[] = [
  { id: "HookListingRegistry", kind: "create", contract: "HookListingRegistry", title: "Deploy HookListingRegistry()" },
  { id: "FeaturedPlacements", kind: "create", contract: "FeaturedPlacements", title: "Deploy FeaturedPlacements(owner, registry)" },
  { id: "HookRequestCodec", kind: "create", contract: "HookRequestCodec", title: "Deploy HookRequestCodec()" },
  { id: "AutoHookJobRequester", kind: "create", contract: "AutoHookJobRequester", title: "Deploy AutoHookJobRequester(owner, Intake, asset, oracleSigner, maxPrice, codec)" },
  { id: "GatedHookDeployer", kind: "create", contract: "GatedHookDeployer", title: "Deploy GatedHookDeployer(owner, requester)" },
  { id: "configureToken", kind: "call", contract: "FeaturedPlacements", title: "FeaturedPlacements.configureToken(asset)" },
  { id: "setProceedsRecipient", kind: "call", contract: "FeaturedPlacements", title: "FeaturedPlacements.setProceedsRecipient(adRecipient)" },
  { id: "setManager", kind: "call", contract: "GatedHookDeployer", title: "GatedHookDeployer.setManager(manager, pinnedCodeHash, true)" },
];

export type StepRecord = { hash?: Hex; address?: Address; block?: Hex; verified?: boolean; checkedAt?: string };
export type Progress = { key: string; steps: Partial<Record<StepId, StepRecord>> };
export type Check = { label: string; expected: string; actual: string; ok: boolean };

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const abi = (c: ContractName) => ARTIFACTS[c].abi as Abi;
const lower = (a: string) => a.toLowerCase();
const show = (v: unknown): string => typeof v === "bigint" ? v.toString() : Array.isArray(v) ? `(${v.map(show).join(", ")})` : String(v);

/** Progress is keyed by the exact inputs, so a changed owner/recipient never reuses old addresses. */
export function progressKey(i: Inputs): string {
  return ["hooks-store-operator/v1", i.chainId, i.owner, i.adRecipient, i.manager, i.managerCodeHash, i.intake, i.asset, i.oracleSigner, i.maxPrice]
    .map((x) => lower(String(x))).join(":");
}

export class Rpc {
  constructor(readonly p: Eip1193) {}
  async chainId() { return Number(BigInt((await this.p.request({ method: "eth_chainId" })) as string)); }
  async accounts() { return ((await this.p.request({ method: "eth_accounts" })) as string[]).map(lower); }
  async code(a: Address, block: Hex | "latest" = "latest") { return lower((await this.p.request({ method: "eth_getCode", params: [a, block] })) as string) as Hex; }
  async raw(to: Address, data: Hex, block: Hex | "latest" = "latest") { return (await this.p.request({ method: "eth_call", params: [{ to, data }, block] })) as Hex; }
  async read(c: ContractName, to: Address, fn: string, args: unknown[] = [], block: Hex | "latest" = "latest") {
    const data = encodeFunctionData({ abi: abi(c), functionName: fn, args } as never);
    return decodeFunctionResult({ abi: abi(c), functionName: fn, data: await this.raw(to, data, block) } as never) as unknown;
  }
  async receipt(hash: Hex) { return (await this.p.request({ method: "eth_getTransactionReceipt", params: [hash] })) as Receipt | null; }
  async tx(hash: Hex) { return (await this.p.request({ method: "eth_getTransactionByHash", params: [hash] })) as { from: string; to: string | null; input: string; value: string } | null; }
  async estimate(tx: object) { return BigInt((await this.p.request({ method: "eth_estimateGas", params: [tx] })) as string); }
  async gasPrice() { return BigInt((await this.p.request({ method: "eth_gasPrice" })) as string); }
  async send(tx: object) { return (await this.p.request({ method: "eth_sendTransaction", params: [tx] })) as Hex; }
}
export type Receipt = { status: Hex; contractAddress: Address | null; from: Address; to: Address | null; blockNumber: Hex; transactionHash: Hex; logs: unknown[] };

// ------------------------------------------------------------------ transactions

export function constructorArgs(id: StepId, i: Inputs, a: Partial<Record<StepId, Address>>): unknown[] {
  switch (id) {
    case "FeaturedPlacements": return [i.owner, need(a, "HookListingRegistry")];
    case "AutoHookJobRequester": return [i.owner, i.intake, i.asset, i.oracleSigner, i.maxPrice, need(a, "HookRequestCodec")];
    case "GatedHookDeployer": return [i.owner, need(a, "AutoHookJobRequester")];
    default: return [];
  }
}

function need(a: Partial<Record<StepId, Address>>, id: StepId): Address {
  const v = a[id];
  if (!v) throw new Error(`${id} must be deployed and verified first`);
  return v;
}

/** The exact zero-value transaction for a step. CREATE has no `to`. */
export function buildTx(step: Step, i: Inputs, a: Partial<Record<StepId, Address>>): { from: Address; to?: Address; data: Hex; value: "0x0" } {
  if (step.kind === "create") {
    const art = ARTIFACTS[step.contract];
    const data = encodeDeployData({ abi: art.abi as Abi, bytecode: art.bytecode, args: constructorArgs(step.id, i, a) } as never);
    return { from: i.owner, data, value: "0x0" };
  }
  const to = need(a, step.contract as StepId);
  const data =
    step.id === "configureToken" ? encodeFunctionData({ abi: abi("FeaturedPlacements"), functionName: "configureToken", args: [i.asset] }) :
    step.id === "setProceedsRecipient" ? encodeFunctionData({ abi: abi("FeaturedPlacements"), functionName: "setProceedsRecipient", args: [i.adRecipient] }) :
    encodeFunctionData({ abi: abi("GatedHookDeployer"), functionName: "setManager", args: [i.manager, i.managerCodeHash, true] });
  return { from: i.owner, to, data, value: "0x0" };
}

// ------------------------------------------------------------------ runtime reconstruction

const shortString = (s: string): Hex => {
  const b = new TextEncoder().encode(s);
  if (b.length > 31) throw new Error("ShortString overflow");
  const out = new Uint8Array(32); out.set(b); out[31] = b.length;
  return toHex(out);
};

/** Values of every immutable, reconstructed from constructor inputs, chain id and address. */
export function immutableValues(c: ContractName, at: Address, i: Inputs, a: Partial<Record<StepId, Address>>): Record<string, Hex> {
  if (c === "FeaturedPlacements") return { registry: pad(need(a, "HookListingRegistry")) };
  if (c === "GatedHookDeployer") return { requester: pad(need(a, "AutoHookJobRequester")) };
  if (c === "AutoHookJobRequester") {
    const hashedName = keccak256(toHex("IdentityMD Oracle")), hashedVersion = keccak256(toHex("2"));
    const typeHash = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
    const sep = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [typeHash, hashedName, hashedVersion, BigInt(i.chainId), at]));
    return {
      codec: pad(need(a, "HookRequestCodec")), _cachedDomainSeparator: sep, _cachedChainId: numberToHex(i.chainId, { size: 32 }),
      _cachedThis: pad(at), _hashedName: hashedName, _hashedVersion: hashedVersion,
      _name: shortString("IdentityMD Oracle"), _version: shortString("2"),
    };
  }
  return {};
}

/** The full expected runtime: the pinned deployedBytecode with every immutable slot filled. */
export function expectedRuntime(c: ContractName, at: Address, i: Inputs, a: Partial<Record<StepId, Address>>): Hex {
  const art = ARTIFACTS[c], values = immutableValues(c, at, i, a);
  const code = art.deployedBytecode.slice(2).split("");
  for (const imm of art.immutables) {
    const v = values[imm.name];
    if (!v) throw new Error(`No reconstruction for ${c}.${imm.name}`);
    for (const r of imm.refs) code.splice(r.start * 2, r.length * 2, ...v.slice(2).toLowerCase().split(""));
  }
  return ("0x" + code.join("")) as Hex;
}

// ------------------------------------------------------------------ verification

const eq = (label: string, expected: unknown, actual: unknown): Check => {
  const e = show(expected), x = show(actual);
  return { label, expected: e, actual: x, ok: lower(e) === lower(x) };
};

/** State readbacks that must hold before an address is used by a later step. */
export async function readbacks(rpc: Rpc, id: StepId, i: Inputs, a: Partial<Record<StepId, Address>>, block: Hex | "latest" = "latest"): Promise<Check[]> {
  const r = (c: ContractName, fn: string, args: unknown[] = []) => rpc.read(c, need(a, c as StepId), fn, args, block);
  switch (id) {
    case "HookListingRegistry":
      return [eq("listingCount()", 0n, await r("HookListingRegistry", "listingCount"))];
    case "FeaturedPlacements":
      return [
        eq("owner()", i.owner, await r("FeaturedPlacements", "owner")),
        eq("pendingOwner()", ZERO, await r("FeaturedPlacements", "pendingOwner")),
        eq("registry()", need(a, "HookListingRegistry"), await r("FeaturedPlacements", "registry")),
        eq("PRICE()", 100000000000000000n, await r("FeaturedPlacements", "PRICE")),
        eq("DURATION()", 604800n, await r("FeaturedPlacements", "DURATION")),
        eq("AD_LABEL() = bytes3(\"#ad\")", toHex("#ad"), await r("FeaturedPlacements", "AD_LABEL")),
      ];
    case "HookRequestCodec":
      return [eq("minimumWindowAgeBlocks()", PROTOCOL.minimumWindowAgeBlocks, await r("HookRequestCodec", "minimumWindowAgeBlocks"))];
    case "AutoHookJobRequester": {
      const head = await r("AutoHookJobRequester", "head") as bigint;
      const arb = BigInt(await rpc.raw(PROTOCOL.arbSys, "0xa3b1b31d", block)); // ArbSys.arbBlockNumber()
      return [
        eq("owner()", i.owner, await r("AutoHookJobRequester", "owner")),
        eq("intake()", i.intake, await r("AutoHookJobRequester", "intake")),
        eq("asset()", i.asset, await r("AutoHookJobRequester", "asset")),
        eq("oracleSigner()", i.oracleSigner, await r("AutoHookJobRequester", "oracleSigner")),
        eq("codec()", need(a, "HookRequestCodec"), await r("AutoHookJobRequester", "codec")),
        eq("maxPrice()", i.maxPrice, await r("AutoHookJobRequester", "maxPrice")),
        eq("maxPriceOf(asset)", i.maxPrice, await r("AutoHookJobRequester", "maxPriceOf", [i.asset])),
        eq("automaticBindingSupported()", true, await r("AutoHookJobRequester", "automaticBindingSupported")),
        eq("WINDOW_DEPTH()", PROTOCOL.windowDepth, await r("AutoHookJobRequester", "WINDOW_DEPTH")),
        eq("maxWindowAgeBlocks() (constructor default)", PROTOCOL.minimumWindowAgeBlocks, await r("AutoHookJobRequester", "maxWindowAgeBlocks")),
        eq("minPanelSize() (constructor default)", PROTOCOL.panelSize, await r("AutoHookJobRequester", "minPanelSize")),
        eq("minAgreed() (constructor default)", PROTOCOL.quorum, await r("AutoHookJobRequester", "minAgreed")),
        eq("head() equals ArbSys.arbBlockNumber() (native clock)", arb, head),
        eq("jobAction()", PROTOCOL.actions.job, await r("AutoHookJobRequester", "jobAction")),
        eq("reviewAction()", PROTOCOL.actions.oracle, await r("AutoHookJobRequester", "reviewAction")),
      ];
    }
    case "GatedHookDeployer":
      return [
        eq("owner()", i.owner, await r("GatedHookDeployer", "owner")),
        eq("requester()", need(a, "AutoHookJobRequester"), await r("GatedHookDeployer", "requester")),
        eq("automaticBindingSupported()", true, await r("GatedHookDeployer", "automaticBindingSupported")),
        eq("pinnedManager(4663)", [PROTOCOL.poolManager, PROTOCOL.poolManagerCodeHash, true], await r("GatedHookDeployer", "pinnedManager", [BigInt(i.chainId)])),
      ];
    case "configureToken":
      return [eq("FeaturedPlacements.imd()", i.asset, await r("FeaturedPlacements", "imd"))];
    case "setProceedsRecipient":
      return [eq("FeaturedPlacements.proceedsRecipient()", i.adRecipient, await r("FeaturedPlacements", "proceedsRecipient"))];
    case "setManager":
      return [eq("GatedHookDeployer.managers(manager)", [true, i.managerCodeHash], await r("GatedHookDeployer", "managers", [i.manager]))];
  }
}

/**
 * Verifies one submitted step from its receipt: success, sender, target, exact calldata, full
 * runtime with reconstructed immutables (CREATE), then state readbacks. Never sends anything.
 */
export async function verifyStep(rpc: Rpc, step: Step, i: Inputs, a: Partial<Record<StepId, Address>>, hash: Hex): Promise<{ checks: Check[]; address?: Address; block?: Hex; pending?: boolean }> {
  const receipt = await rpc.receipt(hash);
  if (!receipt) return { checks: [], pending: true };
  const checks: Check[] = [eq("receipt status", "0x1", receipt.status), eq("receipt from (configured owner)", i.owner, receipt.from)];
  const tx = await rpc.tx(hash);
  const want = buildTx(step, i, a);
  checks.push(eq("submitted calldata matches the pinned plan", keccak256(want.data), tx ? keccak256(tx.input as Hex) : "missing"));
  checks.push(eq("value", "0", tx ? BigInt(tx.value).toString() : "missing"));
  if (step.kind === "create") {
    checks.push(eq("receipt to (CREATE)", "null", String(receipt.to)));
    const at = receipt.contractAddress;
    if (!at || !isAddress(at)) { checks.push(eq("contractAddress", "present", "missing")); return { checks, block: receipt.blockNumber }; }
    const address = getAddress(at);
    const expected = expectedRuntime(step.contract, address, i, { ...a });
    const atBlock = await rpc.code(address, receipt.blockNumber), latest = await rpc.code(address);
    checks.push(eq("runtime at receipt block = pinned runtime + reconstructed immutables", keccak256(expected), keccak256(atBlock)));
    checks.push(eq("runtime now = same", keccak256(expected), keccak256(latest)));
    if (checks.every((c) => c.ok)) checks.push(...await readbacks(rpc, step.id, i, { ...a, [step.id]: address }));
    return { checks, address, block: receipt.blockNumber };
  }
  checks.push(eq("receipt to", want.to, receipt.to));
  if (checks.every((c) => c.ok)) checks.push(...await readbacks(rpc, step.id, i, a));
  return { checks, block: receipt.blockNumber };
}

// ------------------------------------------------------------------ preflight

const PRICE_OF = "0x51102885"; // priceOf(bytes32,address)

/** Official live dependencies, positive quotes within maxPrice, and the frozen PoolManager pin. */
export async function preflight(rpc: Rpc, i: Inputs): Promise<Check[]> {
  const checks: Check[] = [];
  const chain = await rpc.chainId();
  checks.push(eq("wallet chain", i.chainId, chain));
  const [account] = await rpc.accounts();
  checks.push(eq("connected account = confirmed admin/deployer", lower(i.owner), account ?? "none"));
  if (chain !== i.chainId) return checks;
  checks.push(eq("maxPrice per action", PROTOCOL.maxPrice, i.maxPrice));
  for (const [label, a] of [["Intake", i.intake], ["IMD asset", i.asset]] as const) {
    const code = await rpc.code(a);
    checks.push({ label: `${label} has code`, expected: "non-empty", actual: `${(code.length - 2) / 2} bytes`, ok: code.length > 2 });
  }
  const dec = await rpc.raw(i.asset, "0x313ce567").catch(() => "0x");
  checks.push(eq("IMD decimals()", 18n, dec === "0x" ? "unreadable" : BigInt(dec)));
  for (const [label, action] of [["job.open@job-1", PROTOCOL.actions.job], ["oracle.request@oracle-1", PROTOCOL.actions.oracle]] as const) {
    let price: bigint | null = null;
    try { price = BigInt(await rpc.raw(i.intake, (PRICE_OF + action.slice(2) + pad(i.asset).slice(2)) as Hex)); } catch { price = null; }
    checks.push({ label: `Intake quote ${label}`, expected: `> 0 and <= ${i.maxPrice}`, actual: price === null ? "unavailable" : price.toString(), ok: price !== null && price > 0n && price <= i.maxPrice });
  }
  const mcode = await rpc.code(i.manager);
  checks.push(eq("PoolManager = frozen pin", PROTOCOL.poolManager, i.manager));
  checks.push(eq("keccak256(PoolManager code) = pinned hash", PROTOCOL.poolManagerCodeHash, mcode.length > 2 ? keccak256(mcode) : "no code"));
  checks.push(eq("managerCodeHash input = pinned hash", PROTOCOL.poolManagerCodeHash, i.managerCodeHash));
  const arb = await rpc.raw(PROTOCOL.arbSys, "0xa3b1b31d").then((x) => BigInt(x) > 0n).catch(() => false);
  checks.push({ label: "ArbSys native clock answers", expected: "arbBlockNumber() > 0", actual: arb ? "yes" : "no", ok: arb });
  const distinct = new Set([i.owner, i.adRecipient].map(lower)).size === 2 && ![i.owner, i.adRecipient].some((x) => lower(x) === ZERO);
  checks.push({ label: "admin and ad recipient are nonzero", expected: "nonzero", actual: distinct ? "nonzero" : "check inputs", ok: ![i.owner, i.adRecipient].some((x) => lower(x) === ZERO) });
  return checks;
}

/** The deployment manifest the operator reviews and commits. */
export function manifest(i: Inputs, p: Progress) {
  return {
    format: "hooks-store-deployment/v1",
    source: { repository: "https://github.com/identity-md-launches/launch-1811-build-technical-foundation-hooks", commit: "46e17ea70534e8a7ac2c4ff78501a3c183d32da8", buildManifest: "deployment/current-build.json" },
    chainId: i.chainId,
    inputs: { owner: i.owner, adRecipient: i.adRecipient, intake: i.intake, asset: i.asset, oracleSigner: i.oracleSigner, maxPrice: i.maxPrice.toString(), manager: i.manager, managerCodeHash: i.managerCodeHash },
    steps: STEPS.map((s) => ({ step: s.id, title: s.title, ...p.steps[s.id], runtimeSha256: s.kind === "create" ? ARTIFACTS[s.contract].pin.runtimeSha256 : undefined })),
  };
}

export function siteConfigPatch(i: Inputs, p: Progress) {
  const addr = (id: StepId) => p.steps[id]?.verified ? p.steps[id]!.address ?? null : null;
  return {
    format: "hooks-store-site-config/v1",
    status: STEPS.every((s) => p.steps[s.id]?.verified) ? "configured" : "incomplete",
    chainId: i.chainId,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: null,
    admin: i.owner,
    adRecipient: i.adRecipient,
    contracts: {
      HookListingRegistry: addr("HookListingRegistry"), FeaturedPlacements: addr("FeaturedPlacements"),
      HookRequestCodec: addr("HookRequestCodec"), AutoHookJobRequester: addr("AutoHookJobRequester"), GatedHookDeployer: addr("GatedHookDeployer"),
    },
    customerPaymentsEnabled: false,
    customerPaymentsNote: "Customer build/review payments stay disabled until an approved live pilot. Changing this flag needs that approval.",
  };
}
