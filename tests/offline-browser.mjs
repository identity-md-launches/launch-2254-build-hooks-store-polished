import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Pass an installed Playwright module explicitly; no machine configuration is read.
if (!process.argv[2]) throw new Error("Usage: node tests/offline-browser.mjs /path/to/playwright/index.mjs");
const { chromium, webkit } = await import(pathToFileURL(resolve(process.argv[2])).href);
const root = new URL("../", import.meta.url);
const files = new Map(await Promise.all(["index.html", "404.html", "robots.txt"].map(async (name) => [name, await readFile(new URL(`dist/${name}`, root))])));
const report = { browsers: [], missingPaths: [], result: "pending" };
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const name = path.startsWith("/preview/") ? path.slice("/preview/".length) || "index.html" : path === "/" ? "index.html" : path.slice(1);
  const body = files.get(name) ?? files.get("404.html");
  response.writeHead(files.has(name) ? 200 : 404, { "content-type": name === "robots.txt" ? "text/plain; charset=utf-8" : "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(request.method === "HEAD" ? undefined : body);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const shots = new URL("test/scratch/offline-shots/", root);
await mkdir(shots, { recursive: true });

try {
  for (const path of ["/site-config.json", "/assets/index-BsPD1zII.js", "/assets/index-B2JBHBgT.css", "/assets/old-app.js.map", "/favicon.svg", "/og.png", "/deployment/current-build.json", "/src/main.tsx", "/site/automatic.html", "/public/site-config.json", "/missing", "/missing/deep/path"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), files.get("404.html").toString());
    report.missingPaths.push({ path, status: response.status, offline: true });
  }
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    let browser;
    const entry = { name, pages: 0, requests: 0, errors: [], widths: [], passed: false };
    report.browsers.push(entry);
    try {
      browser = await engine.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => {
        window.__offlineWalletCalls = 0;
        window.__offlineDiscovery = 0;
        Object.defineProperty(window, "ethereum", { value: { request() { window.__offlineWalletCalls++; throw new Error("Unexpected wallet request"); } } });
        addEventListener("eip6963:requestProvider", () => { window.__offlineDiscovery++; });
      });
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on("request", (request) => requests.push(request.resourceType()));
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      for (const path of ["/", "/#/browse", "/#/create", "/#/workspace", "/#/operator", "/#arbitrary", "/#/<arbitrary>", "/#/hook/example", "/preview/#/browse", "/404.html"]) {
        await page.goto(origin + path, { waitUntil: "networkidle" });
        assert.equal(await page.locator("body").innerText(), "This site is offline.");
        assert.equal(await page.locator("script, a, button, nav, form, input, img, iframe, link").count(), 0);
        assert.equal(await page.locator("main h1").innerText(), "This site is offline.");
        assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex,nofollow,noarchive");
        assert.equal(await page.evaluate(() => window.__offlineWalletCalls + window.__offlineDiscovery), 0);
        entry.pages++;
      }
      // Real in-document hash transitions also remain inert.
      const beforeHash = requests.length;
      for (const hash of ["/browse", "/create", "/workspace", "/operator", "arbitrary"]) {
        await page.evaluate((value) => { location.hash = value; }, hash);
        assert.equal(await page.locator("body").innerText(), "This site is offline.");
      }
      assert.equal(requests.length, beforeHash);
      await page.goto(origin + "/", { waitUntil: "networkidle" });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const measured = await page.evaluate(() => {
          const text = document.querySelector("h1"), box = text.getBoundingClientRect(), css = getComputedStyle(text);
          return { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, top: box.top, bottom: box.bottom, right: box.right, color: css.color, background: getComputedStyle(document.documentElement).backgroundColor, size: css.fontSize, lineHeight: css.lineHeight, weight: css.fontWeight };
        });
        assert.equal(measured.scroll, width);
        assert.ok(measured.top >= 0 && measured.bottom <= 900 && measured.right <= width);
        entry.widths.push({ width, ...measured });
        if ([390, 1440].includes(width)) await page.screenshot({ path: new URL(`${name}-${width}.png`, shots).pathname });
      }
      await page.setViewportSize({ width: 320, height: 700 });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
      assert.equal(await page.locator("body").innerText(), "This site is offline.");
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.tagName), "BODY");
      await context.setOffline(true);
      await page.evaluate(() => { location.hash = "/operator"; });
      assert.equal(await page.locator("body").innerText(), "This site is offline.");
      assert.ok(requests.every((type) => type === "document"), `Unexpected requests: ${requests.join(", ")}`);
      assert.deepEqual(errors, []);
      entry.requests = requests.length;
      entry.passed = true;
      await context.close();
    } catch (error) {
      entry.errors.push(/missing dependencies|Missing libraries|error while loading shared libraries/i.test(error.message)
        ? "Browser runtime dependencies unavailable; this engine was not tested."
        : error.message.split("\n")[0]);
    } finally { await browser?.close(); }
  }
  report.result = report.browsers.every((browser) => browser.passed) ? "passed" : "failed";
} finally {
  await new Promise((done) => server.close(done));
  await writeFile(new URL("test/scratch/offline-browser.json", root), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
if (report.result !== "passed") process.exitCode = 1;
