#!/usr/bin/env bun
/** Build the two distinct Xross view artifacts without a runtime transport fallback. */
import { spawn } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");
const mode = process.argv[2];
if (mode !== "local" && mode !== "hosted") throw new Error("usage: build-xross.ts local|hosted");
const target = mode === "local" ? "xross-local" : "xross-hosted";
const output = join(web, `build-${target}`);
await rm(output, { recursive: true, force: true });
await new Promise<void>((resolve, reject) => {
  const child = spawn("pnpm", ["exec", "vite", "build"], {
    cwd: web,
    env: { ...process.env, REFYARD_BUILD_TARGET: target, VITE_REFYARD_BUILD_TARGET: target },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Xross ${mode} build exited ${code}`)));
});
const entry = join(output, "xross", "index.html");
await access(entry);
if (mode === "local") {
  // This artifact is mounted by a native host, not installed as a browser PWA.
  const document = await readFile(entry, "utf8");
  const manifestLink = '<link rel="manifest" href="/manifest.webmanifest" />';
  if (!document.includes(manifestLink)) throw new Error("Xross local entry manifest link changed");
  const faviconLink = 'href="/favicon.svg"';
  if (!document.includes(faviconLink)) throw new Error("Xross local entry favicon link changed");
  await access(join(output, "favicon.svg"));
  await writeFile(entry, document.replace(manifestLink, "").replace(faviconLink, 'href="../favicon.svg"'));
  await rm(join(output, "service-worker.js"), { force: true });
  await rm(join(output, "manifest.webmanifest"), { force: true });
}
console.log(`Xross ${mode} entry: ${entry}`);
