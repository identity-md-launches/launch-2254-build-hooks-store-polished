import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("dist/", root);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("two offline builds remove stale content and emit only the offline documents", async () => {
  const original = await readFile(new URL("index.html", root));
  let previous;
  for (const round of [1, 2]) {
    for (const path of ["assets/old-app.js", "assets/old-app.js.map", "site-config.json", "deployment/current-build.json", "favicon.svg", "og.png", ".stale/nested/cache.js"]) {
      const target = new URL(path, output);
      await mkdir(new URL("./", target), { recursive: true });
      await writeFile(target, `stale export, round ${round}`);
    }
    // The builder resolves paths from its own location, independent of the caller.
    const built = spawnSync(process.execPath, [fileURLToPath(new URL("scripts/build-offline.mjs", root))], {
      cwd: fileURLToPath(round === 1 ? root : new URL("tests/", root)),
      encoding: "utf8",
    });
    assert.equal(built.status, 0, built.stderr);
    assert.deepEqual((await readdir(output)).sort(), ["404.html", "index.html", "robots.txt"]);
    const index = await readFile(new URL("index.html", output));
    assert.deepEqual(index, original);
    assert.deepEqual(await readFile(new URL("404.html", output)), original);
    assert.equal(await readFile(new URL("robots.txt", output), "utf8"), "User-agent: *\nDisallow: /\n");
    const current = digest(index);
    if (previous) assert.equal(current, previous);
    previous = current;
  }
});

test("the source is a single inert offline message with indexing and CSP restrictions", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1];
  assert.equal(body?.replace(/<[^>]*>/g, "").trim(), "This site is offline.");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
  assert.doesNotMatch(html, /<(?:script|link|a|button|nav|form|input|iframe|img|video|audio|object|embed)\b/i);
  assert.doesNotMatch(html, /\b(?:src|href|action|on\w+)\s*=|url\s*\(|@import|https?:\/\/|0x[a-f\d]{40}/i);
});
