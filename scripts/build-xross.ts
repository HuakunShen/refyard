#!/usr/bin/env bun
/** Build the two distinct Xross view artifacts without a runtime transport fallback. */
import { spawn } from "node:child_process";
import { access, copyFile, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");
const mode = process.argv[2];
if (mode !== "local" && mode !== "hosted") throw new Error("usage: build-xross.ts local|hosted");
const target = mode === "local" ? "xross-local" : "xross-hosted";
const output = join(web, `build-${target}`);
await new Promise<void>((resolve, reject) => {
  const child = spawn("pnpm", ["exec", "vite", "build", "--config", "vite.xross.config.ts"], {
    cwd: web,
    env: { ...process.env, REFYARD_BUILD_TARGET: target, VITE_REFYARD_BUILD_TARGET: target },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Xross ${mode} build exited ${code}`)));
});
const entry = join(output, "xross", "index.html");
await access(entry);
await copyFile(join(web, "static", "favicon.svg"), join(output, "favicon.svg"));

async function emittedFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...await emittedFiles(path));
    else if (item.isFile()) files.push(path);
    else throw new Error(`unexpected Xross output entry: ${path}`);
  }
  return files;
}

if (mode === "local") {
  const files = await emittedFiles(output);
  const relativeFiles = files.map((file) => file.slice(output.length + 1).replaceAll("\\", "/"));
  if (!relativeFiles.includes("xross/index.html") || !relativeFiles.includes("favicon.svg")) {
    throw new Error("Xross local document or favicon is absent");
  }
  for (const [index, name] of relativeFiles.entries()) {
    if (name !== "xross/index.html" && name !== "favicon.svg" &&
      !/^_app\/immutable\/[^/]+\.(?:js|css|woff2?|png|svg)$/.test(name)) {
      throw new Error(`unexpected Xross local asset: ${name}`);
    }
    if (!/\.(?:html|js|css|svg)$/.test(name)) continue;
    const contents = await readFile(files[index]!, "utf8");
    for (const forbidden of [
      "manifest.webmanifest", "service-worker", "createHttpBackendAdapter",
      "createTauriBackendAdapter", "__TAURI_INTERNALS__", "/api/v1/",
      "kunkun-ext",
    ]) {
      if (contents.includes(forbidden)) throw new Error(`forbidden ${forbidden} in Xross local asset ${name}`);
    }
  }
  console.log(`Xross local asset scan passed: ${relativeFiles.length} emitted files (${relativeFiles.join(", ")})`);
}
console.log(`Xross ${mode} entry: ${entry}`);
