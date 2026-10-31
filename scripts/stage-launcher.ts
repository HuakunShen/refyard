#!/usr/bin/env bun
/**
 * `scripts/stage-launcher.ts [target-triple]` — build the `refyard` command and put it
 * where Tauri's bundler looks for a sidecar.
 *
 * The desktop bundle ships two executables: the window (`Refyard`) and the command that
 * opens it (`refyard-launcher`, installed into PATH as `refyard`). Tauri's `externalBin`
 * takes an already-built binary named `<path>-<target-triple>`, so this script is the step
 * between `cargo build` and `tauri build` — the same relationship the SPA build has with
 * the frontend directory: the bundler embeds what exists, so what exists must be current.
 *
 * The triple defaults to the host's. A release runner building for another architecture
 * (`--target aarch64-apple-darwin` on an Intel host, or the reverse) passes it, and the
 * launcher is cross-compiled with the rest of the bundle.
 *
 * Nothing here ships: the finished app has no build tooling, and the command inside it is
 * a plain Rust binary with no runtime beyond the OS.
 */
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { displayPath } from "./lib/files.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDirectory = join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "binaries",
);
const executableName =
  process.platform === "win32" ? "refyard-launcher.exe" : "refyard-launcher";

const requestedTriple = process.argv
  .slice(2)
  .find((argument) => !argument.startsWith("-"));

function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly capture?: boolean },
): Promise<string> {
  return new Promise<string>((settle, fail) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio:
        options.capture === true ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", (error) => {
      fail(new Error(`${command} could not be started (${error.message})`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) settle(output);
      else
        fail(
          new Error(
            `${command} ${args.join(" ")} ${signal === null ? `exited with ${code}` : `was killed by ${signal}`}`,
          ),
        );
    });
  });
}

/** The triple `tauri build` will bundle for when the caller names none. */
async function hostTriple(): Promise<string> {
  const version = await run("rustc", ["-vV"], { cwd: repoRoot, capture: true });
  const host = version
    .split("\n")
    .find((line) => line.startsWith("host: "))
    ?.slice("host: ".length)
    .trim();
  if (host === undefined || host.length === 0) {
    throw new Error("rustc -vV did not report a host triple");
  }
  return host;
}

const triple = requestedTriple ?? (await hostTriple());
const targetArguments =
  requestedTriple === undefined ? [] : ["--target", requestedTriple];

console.log(`stage-launcher: building refyard-launcher for ${triple}`);
await run(
  "cargo",
  ["build", "--release", "-p", "refyard-launcher", ...targetArguments],
  {
    cwd: repoRoot,
  },
);

const built = join(
  repoRoot,
  "target",
  ...(requestedTriple === undefined ? [] : [requestedTriple]),
  "release",
  executableName,
);
const staged = join(
  binariesDirectory,
  `${executableName.replace(/\.exe$/, "")}-${triple}${process.platform === "win32" ? ".exe" : ""}`,
);

await mkdir(binariesDirectory, { recursive: true });
await copyFile(built, staged);
// `copyFile` does not promise the executable bit; a sidecar the OS cannot exec is a
// bundling failure that only shows up when somebody runs the installed command.
if (process.platform !== "win32") await chmod(staged, 0o755);

console.log(`stage-launcher: ${displayPath(repoRoot, staged)}`);
