#!/usr/bin/env bun
/**
 * `pnpm desktop:build` — the local desktop application, built from the same SPA the browser gets.
 *
 * Two steps in this order: the web app is built into `apps/web/build-desktop`, then Tauri
 * compiles the Rust host and bundles it around those assets. The order is the point — Tauri
 * embeds the frontend directory at compile time, so building the app first would embed the
 * previous frontend, which is the "worked on my machine" failure this script exists to make
 * impossible.
 *
 * `--web-only` runs just the first step, for a change that only touches the frontend.
 *
 * Nothing here is needed at run time and no Node backend is started: the bundle carries the
 * compiled host and the static assets, and the only process the finished app spawns is the
 * machine's own `git`.
 */
import { spawn } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { displayPath, pathExists } from "./lib/files.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(repoRoot, "apps", "web");
const desktopDir = join(repoRoot, "apps", "desktop");
const desktopDist = join(webDir, "build-desktop");
const bundleRoot = join(desktopDir, "src-tauri", "target", "release", "bundle", "macos");
const appBundle = join(bundleRoot, "Refyard.app");

const webOnly = process.argv.includes("--web-only");

async function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: Record<string, string | undefined> },
): Promise<void> {
  await new Promise<void>((settle, fail) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      fail(
        new Error(
          `${command} could not be started (${error.message}); run \`pnpm install\` first`,
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) settle();
      else
        fail(
          new Error(
            `${command} ${args.join(" ")} ${signal === null ? `exited with ${code}` : `was killed by ${signal}`}`,
          ),
        );
    });
  });
}

/** Builds the SPA for the desktop shell. Separate output and working directory from the served build. */
async function buildFrontend(): Promise<void> {
  console.log(
    `build-desktop: building the SPA into ${displayPath(repoRoot, desktopDist)}`,
  );
  // A removed directory rather than an overwritten one: a stale asset from an earlier build
  // would be embedded into the app and served as if it were current.
  await rm(desktopDist, { recursive: true, force: true });
  await run("pnpm", ["--dir", "apps/web", "exec", "vite", "build"], {
    cwd: repoRoot,
    env: { ...process.env, REFYARD_BUILD_TARGET: "desktop" },
  });

  const index = join(desktopDist, "index.html");
  if (!(await pathExists(index))) {
    throw new Error(
      `the frontend build produced no ${displayPath(repoRoot, index)}; the app would launch without a page`,
    );
  }
}

async function buildApp(): Promise<void> {
  console.log("build-desktop: compiling the host and bundling the application");
  await run("pnpm", ["exec", "tauri", "build"], { cwd: desktopDir });

  if (!(await pathExists(appBundle))) {
    throw new Error(
      `the bundle was not produced at ${displayPath(repoRoot, appBundle)}`,
    );
  }
  const installed = await bytesUnder(appBundle);
  console.log(
    `build-desktop: ${displayPath(repoRoot, appBundle)} (${mib(installed)} MiB installed)`,
  );
}

/**
 * The bytes a person would find on disk after copying this bundle.
 *
 * `stat` on a directory reports its inode, not its contents, so walking it is the only way
 * to report an installed size that means anything — and the budget in the acceptance
 * document is on installed bytes, not on a compressed archive.
 */
async function bytesUnder(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await bytesUnder(child);
    } else if (entry.isFile()) {
      total += (await stat(child)).size;
    }
  }
  return total;
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

await buildFrontend();
if (!webOnly) await buildApp();
