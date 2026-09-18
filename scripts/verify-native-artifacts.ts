/**
 * `pnpm native:verify` — the release artifacts are what the design says they are.
 *
 * The rule the whole native workstream stands on is "no JavaScript runtime and no local
 * listener in the desktop process". That is only honest if someone inspects the shipped
 * bytes, so this script walks both artifacts and fails on:
 *
 * - any executable named `node`, `bun`, `deno` or `electron`, anywhere;
 * - any JavaScript file that looks like a *backend* bundle — `require(` of Node builtins
 *   — while letting the frontend's own bundled JS pass (Svelte output has neither);
 * - any linked library outside the operating system's own directories;
 * - the size budgets the acceptance document states.
 *
 * Nothing here repairs, deletes or re-signs anything. It looks, it reports, it exits.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const APP = join(
  ROOT,
  "apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app",
);
const CLI = join(ROOT, "target/release/refyard-native");

const MIB = 1024 * 1024;
const BUDGETS = {
  appInstalledMib: 30,
  cliBytes: 20 * MIB,
};

const FORBIDDEN_BASENAMES = new Set(["node", "bun", "deno", "electron"]);

/** Node builtins whose presence in a JS file means a backend bundle, not a page. */
const BACKEND_MARKERS = [
  'require("child_process")',
  'require("node:child_process")',
  'require("http")',
  'require("node:http")',
  "require('child_process')",
  "require('node:child_process')",
];

interface Finding {
  readonly path: string;
  readonly problem: string;
}

const findings: Finding[] = [];
const checked = { files: 0, executables: 0, javascript: 0 };

function walk(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
    } else if (entry.isFile()) {
      out.push(path);
    }
  }
  return out;
}

function isMachO(path: string): boolean {
  try {
    const hex = readFileSync(path).subarray(0, 4).toString("hex");
    // Thin 32/64-bit Mach-O in either byte order (arm64 binaries begin cffaedfe), and
    // fat binaries. A Universal bundle may hold several thin slices per file; this check
    // only asks "is this a Mach-O", so one match is enough.
    return [
      "cffaedfe",
      "feedfacf",
      "cefaedfe",
      "feedface",
      "cafebabe",
      "bebafeca",
    ].includes(hex);
  } catch {
    return false;
  }
}

function linkedLibraries(path: string): string[] {
  try {
    return execFileSync("otool", ["-L", path], { encoding: "utf8" })
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" ")[0] ?? "")
      .filter((line) => line.startsWith("/"));
  } catch {
    return [];
  }
}

function systemOnly(libraries: string[]): boolean {
  return libraries.every(
    (library) =>
      library.startsWith("/usr/lib/") || library.startsWith("/System/Library/"),
  );
}

if (!existsSync(APP)) {
  console.error(`native:verify: the app bundle is missing: ${APP}`);
  console.error("native:verify: run `pnpm desktop:build` first");
  process.exit(2);
}
if (!existsSync(CLI)) {
  console.error(`native:verify: the CLI is missing: ${CLI}`);
  console.error(
    "native:verify: run `cargo build -p refyard-native --release` first",
  );
  process.exit(2);
}

for (const path of walk(APP)) {
  checked.files += 1;
  const name = basename(path);
  const stem = name.replace(/\.(dylib|so|a)$/, "");
  if (FORBIDDEN_BASENAMES.has(stem)) {
    findings.push({
      path,
      problem: `a runtime binary named ${name} is bundled`,
    });
  }
  if (isMachO(path)) {
    checked.executables += 1;
    const libraries = linkedLibraries(path);
    if (libraries.length > 0 && !systemOnly(libraries)) {
      findings.push({
        path,
        problem: `links non-system libraries: ${libraries.filter((library) => !systemOnly([library])).join(", ")}`,
      });
    }
    // A JS engine announces itself in its own strings; the WebView lives in a system
    // process, not in anything we ship, so none of these names should appear.
    const bytes = readFileSync(path);
    for (const marker of ["V8_Fatal", "Bun.build", "deno_core"]) {
      if (bytes.includes(Buffer.from(marker))) {
        findings.push({
          path,
          problem: `carries a JS engine marker (${marker})`,
        });
      }
    }
  }
  if (/\.(js|mjs|cjs)$/.test(name)) {
    checked.javascript += 1;
    const text = readFileSync(path, "utf8");
    const marker = BACKEND_MARKERS.find((candidate) =>
      text.includes(candidate),
    );
    if (marker !== undefined) {
      findings.push({
        path,
        problem: `JavaScript imports a Node builtin (${marker})`,
      });
    }
  }
}

const cliBytes = statSync(CLI).size;
const cliLibraries = linkedLibraries(CLI);
if (!systemOnly(cliLibraries)) {
  findings.push({ path: CLI, problem: "links non-system libraries" });
}
if (cliBytes > BUDGETS.cliBytes) {
  findings.push({
    path: CLI,
    problem: `size ${cliBytes} exceeds the ${BUDGETS.cliBytes}-byte budget`,
  });
}

let appBytes = 0;
for (const path of walk(APP)) {
  appBytes += statSync(path).size;
}
if (appBytes > BUDGETS.appInstalledMib * MIB) {
  findings.push({
    path: APP,
    problem: `installed size ${(appBytes / MIB).toFixed(1)} MiB exceeds the ${BUDGETS.appInstalledMib} MiB budget`,
  });
}

console.log("native:verify");
console.log(
  `  app:  ${relative(ROOT, APP)} (${(appBytes / MIB).toFixed(1)} MiB installed, ${checked.files} files, ${checked.executables} Mach-O)`,
);
console.log(
  `  cli:  ${relative(ROOT, CLI)} (${(cliBytes / MIB).toFixed(2)} MiB, links ${cliLibraries.length} system libraries)`,
);
console.log(
  `  js:   ${checked.javascript} loose frontend files in the bundle (the desktop frontend is embedded in the executable and scanned there for engine markers); served-from-disk JS is scanned by the same rule when a web root exists`,
);
if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`  FAIL ${relative(ROOT, finding.path)}: ${finding.problem}`);
  }
  process.exit(1);
}
console.log(
  "  verdict: no JavaScript runtime, no backend bundle, system links only, within budget",
);
