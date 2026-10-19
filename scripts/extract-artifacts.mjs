// Copies the five pinned infrastructure artifacts from a forge build of
// identity-md-launches/launch-1811-build-technical-foundation-hooks@46e17ea7 into src/artifacts,
// refusing any byte that differs from that commit's deployment/current-build.json.
// Usage: node scripts/extract-artifacts.mjs <path-to-pinned-checkout>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
if (!repo) throw new Error("Pass the pinned checkout path (after `forge build`)");
const build = JSON.parse(readFileSync(join(repo, "deployment/current-build.json"), "utf8"));
// Immutable names in AST declaration order (lowest AST id first). EIP712 contributes seven.
const NAMES = {
  HookListingRegistry: [],
  FeaturedPlacements: ["registry"],
  HookRequestCodec: [],
  AutoHookJobRequester: ["codec", "_cachedDomainSeparator", "_cachedChainId", "_cachedThis", "_hashedName", "_hashedVersion", "_name", "_version"],
  GatedHookDeployer: ["requester"],
};
const sha = (hex) => { const b = Buffer.from(hex.slice(2), "hex"); return [createHash("sha256").update(b).digest("hex"), b.length]; };
const shape = (refs) => JSON.stringify(Object.values(refs).map((v) => v.map((x) => `${x.start}:${x.length}`).join(",")).sort());
const out = {};
for (const [name, names] of Object.entries(NAMES)) {
  const j = JSON.parse(readFileSync(join(repo, `out/${name}.sol/${name}.json`), "utf8"));
  const pin = build.contracts[name];
  const [ih, il] = sha(j.bytecode.object), [rh, rl] = sha(j.deployedBytecode.object);
  if (ih !== pin.bytecode.sha256 || il !== pin.bytecode.bytes) throw new Error(`${name}: initcode differs from current-build.json`);
  if (rh !== pin.deployedBytecode.sha256 || rl !== pin.deployedBytecode.bytes) throw new Error(`${name}: runtime differs from current-build.json`);
  const refs = j.deployedBytecode.immutableReferences || {};
  if (shape(refs) !== shape(pin.immutableReferences)) throw new Error(`${name}: immutable offsets differ`);
  const ids = Object.keys(refs).map(Number).sort((a, b) => a - b);
  if (ids.length !== names.length) throw new Error(`${name}: expected ${names.length} immutables`);
  out[name] = {
    abi: j.abi,
    bytecode: j.bytecode.object,
    deployedBytecode: j.deployedBytecode.object,
    immutables: ids.map((id, i) => ({ name: names[i], refs: refs[id] })),
    pin: { initcodeSha256: ih, initcodeBytes: il, runtimeSha256: rh, runtimeBytes: rl },
  };
}
writeFileSync("src/artifacts/contracts.json", JSON.stringify({ source: {
  repository: "https://github.com/identity-md-launches/launch-1811-build-technical-foundation-hooks",
  commit: "46e17ea70534e8a7ac2c4ff78501a3c183d32da8",
  compiler: "solc 0.8.26, cancun, optimizer 200, bytecode_hash none, cbor_metadata false",
  buildManifest: "deployment/current-build.json",
}, contracts: out }) + "\n");
writeFileSync("src/artifacts/current-build.json", readFileSync(join(repo, "deployment/current-build.json")));
console.log("ok", Object.keys(out).join(", "));
