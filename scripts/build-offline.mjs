import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const page = await readFile(new URL("index.html", root));
const output = new URL("dist/", root);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(new URL("index.html", output), page),
  writeFile(new URL("404.html", output), page),
  writeFile(new URL("robots.txt", output), "User-agent: *\nDisallow: /\n"),
]);
