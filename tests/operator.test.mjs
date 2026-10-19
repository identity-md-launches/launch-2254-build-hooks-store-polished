// Operator wizard library (src/lib/operator.ts) against a LOCAL anvil fork of Robinhood Chain 4663.
// Run: ANVIL=/path/to/anvil node --import tsx --test tests/operator.test.mjs
// Real (forked) code: Intake, IMD asset, PoolManager. MOCK: ArbSys at 0x64 is replaced with code that
// returns block.number, because anvil does not implement Arbitrum precompiles. Nothing here touches a live chain:
// every transaction goes to the local fork, signed by anvil's unlocked dev account.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  STEPS, Rpc, buildTx, verifyStep, preflight, progressKey, manifest, siteConfigPatch,
} from "../src/lib/operator.ts";
import { PROTOCOL } from "../src/lib/protocol.ts";

const ANVIL = process.env.ANVIL ?? "anvil";
const FORK = process.env.FORK_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const PORT = 18545 + Math.floor(Math.random() * 1000);
const URL_ = `http://127.0.0.1:${PORT}`;
const have = spawnSync(ANVIL, ["--version"]).status === 0;
let proc, owner, other, adRecipient;

let id = 0;
const raw = async (method, params = []) => {
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j.result;
};
/** EIP-1193 provider over the local node. `sends` counts eth_sendTransaction so resume can prove it never resends. */
function provider({ account, chainId, reject } = {}) {
  const p = { sends: 0, async request({ method, params }) {
    if (method === "eth_accounts") return [account ?? owner];
    if (method === "eth_chainId" && chainId) return "0x" + chainId.toString(16);
    if (method === "eth_sendTransaction") { p.sends++; if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }
    return raw(method, params ?? []);
  } };
  return p;
}
const inputsFor = (o) => ({
  chainId: 4663, owner: o, adRecipient, manager: PROTOCOL.poolManager, managerCodeHash: PROTOCOL.poolManagerCodeHash,
  intake: PROTOCOL.intake, asset: PROTOCOL.asset, oracleSigner: PROTOCOL.oracleSigner, maxPrice: PROTOCOL.maxPrice,
});

/** Exactly what Operator.tsx send() does: guard, build the pinned tx, estimate, send once, then verify by receipt. */
async function runStep(rpc, step, inputs, addrs) {
  const tx = buildTx(step, inputs, addrs);
  const gas = await rpc.estimate(tx);
  const hash = await rpc.send({ ...tx, gas: "0x" + gas.toString(16) });
  return { hash, ...(await verifyStep(rpc, step, inputs, addrs, hash)) };
}

before(async () => {
  if (!have) return;
  proc = spawn(ANVIL, ["--fork-url", FORK, "--port", String(PORT), "--chain-id", "4663", "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { await raw("eth_chainId"); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  [owner, other, adRecipient] = (await raw("eth_accounts")).map((a) => a.toLowerCase());
  await raw("anvil_setCode", [PROTOCOL.arbSys, "0x435f5260205ff3"]); // MOCK ArbSys: NUMBER PUSH0 MSTORE PUSH1 32 PUSH0 RETURN
});
after(() => proc?.kill());

const state = { addrs: {}, hashes: {} };

test("preflight on the fork: live Intake/asset code, positive quotes, frozen PoolManager pin", { skip: !have && "anvil not installed" }, async () => {
  const checks = await preflight(new Rpc(provider()), inputsFor(owner));
  for (const c of checks) assert.ok(c.ok, `${c.label}: expected ${c.expected}, read ${c.actual}`);
});

test("wrong chain and wrong wallet fail preflight before any transaction", { skip: !have && "anvil not installed" }, async () => {
  const wrongChain = await preflight(new Rpc(provider({ chainId: 1 })), inputsFor(owner));
  assert.equal(wrongChain.find((c) => c.label === "wallet chain").ok, false);
  const wrongWallet = await preflight(new Rpc(provider({ account: other })), inputsFor(owner));
  assert.equal(wrongWallet.find((c) => c.label.startsWith("connected account")).ok, false);
});

test("rejected signature sends nothing and records nothing", { skip: !have && "anvil not installed" }, async () => {
  const nonce = await raw("eth_getTransactionCount", [owner, "latest"]);
  const p = provider({ reject: true });
  await assert.rejects(runStep(new Rpc(p), STEPS[0], inputsFor(owner), {}), (e) => e.code === 4001);
  assert.equal(await raw("eth_getTransactionCount", [owner, "latest"]), nonce);
});

test("bootstrap all eight steps in order; each verified (full runtime + immutables + readbacks) before its address is used", { skip: !have && "anvil not installed" }, async () => {
  const rpc = new Rpc(provider()), inputs = inputsFor(owner);
  for (const step of STEPS) {
    const r = await runStep(rpc, step, inputs, state.addrs);
    const bad = r.checks.filter((c) => !c.ok);
    assert.deepEqual(bad, [], `${step.id}: ${JSON.stringify(bad)}`);
    assert.ok(r.checks.length >= 4, `${step.id} ran readbacks`);
    state.hashes[step.id] = r.hash;
    if (r.address) state.addrs[step.id] = r.address;
  }
  const cfg = siteConfigPatch(inputs, { key: progressKey(inputs), steps: Object.fromEntries(STEPS.map((s) => [s.id, { verified: true, address: state.addrs[s.id], hash: state.hashes[s.id] }])) });
  assert.equal(cfg.status, "configured");
  assert.equal(cfg.customerPaymentsEnabled, false);
  assert.equal(manifest(inputs, { key: "", steps: {} }).steps.length, 8);
});

test("resume rechecks every stored receipt, code and state without sending anything", { skip: !have && "anvil not installed" }, async () => {
  const p = provider(), rpc = new Rpc(p), inputs = inputsFor(owner), addrs = {};
  for (const step of STEPS) {
    const r = await verifyStep(rpc, step, inputs, addrs, state.hashes[step.id]);
    assert.ok(r.checks.every((c) => c.ok), step.id);
    if (r.address) addrs[step.id] = r.address;
  }
  assert.equal(p.sends, 0);
  assert.deepEqual(addrs, state.addrs);
});

test("context drift: a changed ad recipient changes the progress key and fails the stored setter's verification", { skip: !have && "anvil not installed" }, async () => {
  const drifted = { ...inputsFor(owner), adRecipient: other };
  assert.notEqual(progressKey(drifted), progressKey(inputsFor(owner)));
  const step = STEPS.find((s) => s.id === "setProceedsRecipient");
  const r = await verifyStep(new Rpc(provider()), step, drifted, state.addrs, state.hashes[step.id]);
  assert.ok(r.checks.some((c) => !c.ok && /calldata/.test(c.label)));
});

test("receipt from another wallet is rejected", { skip: !have && "anvil not installed" }, async () => {
  const step = STEPS[0], inputs = inputsFor(other);
  const hash = await new Rpc(provider({ account: other })).send(buildTx(step, inputs, {}));
  const r = await verifyStep(new Rpc(provider()), step, inputsFor(owner), {}, hash);
  assert.equal(r.checks.find((c) => c.label.startsWith("receipt from")).ok, false);
});

test("bytecode mismatch: a CREATE of altered initcode fails runtime verification and never reaches readbacks", { skip: !have && "anvil not installed" }, async () => {
  const step = STEPS.find((s) => s.id === "HookRequestCodec"), inputs = inputsFor(owner);
  const tx = buildTx(step, inputs, {});
  // Same initcode except the last runtime byte is flipped, so the deployed runtime differs from the pin.
  const data = tx.data.slice(0, -2) + (tx.data.slice(-2) === "00" ? "01" : "00");
  const gas = await raw("eth_estimateGas", [{ ...tx, data }]);
  const hash = await raw("eth_sendTransaction", [{ ...tx, data, gas }]);
  const r = await verifyStep(new Rpc(provider()), step, inputs, {}, hash);
  assert.ok(r.checks.some((c) => !c.ok && /runtime|calldata/.test(c.label)), JSON.stringify(r.checks));
  assert.ok(!r.checks.some((c) => /minimumWindowAgeBlocks/.test(c.label)), "readbacks must not run on a mismatched runtime");
});

test("a missing receipt reports pending instead of resending", { skip: !have && "anvil not installed" }, async () => {
  await raw("evm_setAutomine", [false]);
  try {
    const p = provider(), rpc = new Rpc(p);
    const hash = await rpc.send(buildTx(STEPS[0], inputsFor(owner), {}));
    const r = await verifyStep(rpc, STEPS[0], inputsFor(owner), {}, hash);
    assert.equal(r.pending, true);
    assert.equal(p.sends, 1);
  } finally { await raw("evm_setAutomine", [true]); }
});
