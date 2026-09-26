/**
 * Build the DeepSeek Harness plugin bundle for Refyard.
 *
 * Three artifacts, and each exists for a reason the others do not cover:
 *
 * 1. **The embedded SPA** (`apps/web/build-dsh`) — the same Svelte app, built with a mount
 *    prefix and without a service worker. It has to be a separate build because both
 *    differences are baked into the document the browser receives; patching the served
 *    bytes afterwards would be a rewrite of the product's own HTML rather than a build of
 *    it.
 * 2. **The host half** (`dist/host.js`) — one ESM file the Harness host process loads.
 *    Its name is fixed and its URL is therefore stable, which matters: the host process
 *    imports it once and Node caches modules by URL, so a rebuild is picked up only in a
 *    fresh process. See the plugin's README.
 *    Refyard's packages are TypeScript sources consumed directly, so they are bundled here
 *    exactly as `scripts/bundle-cli.ts` bundles them for the CLI; nothing workspace-local
 *    may remain an import at run time.
 * 3. **The client half** (`dist/client.js`) — a classic script that registers itself with
 *    the Web shell's module table. It is *not* ESM: the shell loads bundle scripts, and a
 *    top-level `import` would never run.
 *
 * The staged output lands in `integrations/dsh/dist`, which is what the plugin manifest
 * points at and what the plugin manager installs from.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repositoryRoot, "integrations", "dsh");
const distRoot = join(pluginRoot, "dist");
const webApp = join(repositoryRoot, "apps", "web");
const webSource = join(webApp, "build-dsh");

/** The mount prefix the SPA is built for. The host half mounts the workbench here. */
const EMBED_BASE = "/refyard";

function run(argv: readonly string[], cwd: string): void {
  const [command, ...args] = argv;
  if (command === undefined) {
    throw new Error("run() needs a command");
  }
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${argv.join(" ")} exited with ${String(result.status)}`);
  }
}

/**
 * esbuild transpiles without checking, so the plugin's own types are verified here.
 *
 * Two projects, because the halves do not share a global environment: the host half is a
 * Node program and the client half is a browser script, and type-checking them together
 * would let one half's globals leak into the other.
 */
function checkTypes(): void {
  for (const project of ["tsconfig.json", "tsconfig.client.json"]) {
    run(
      [
        join(repositoryRoot, "node_modules", ".bin", "tsc"),
        "--noEmit",
        "-p",
        join(pluginRoot, project),
      ],
      repositoryRoot,
    );
  }
}

async function buildSpa(): Promise<void> {
  // `REFYARD_BUILD_TARGET=dsh` selects the embedded flavour; `REFYARD_EMBED_BASE` is what
  // `apps/web/svelte.config.js` reads for `paths.base`, so the mount point is named once.
  process.env["REFYARD_BUILD_TARGET"] = "dsh";
  process.env["REFYARD_EMBED_BASE"] = EMBED_BASE;
  run(
    [join(webApp, "node_modules", ".bin", "vite"), "build"],
    webApp,
  );
}


/**
 * Write a bundle only when its bytes actually changed.
 *
 * The Harness watches these two files: a new mtime makes it re-read the bundle, and a
 * bundle that comes back wrong is remembered as failed and **skipped for the life of the
 * process** — so a rebuild that rewrites identical bytes can take the client half of the
 * panel down until the Harness restarts. Rebuilding the SPA is the common case, and it
 * must not touch these files at all.
 *
 * @returns whether the file was written.
 */
async function writeIfChanged(path: string, contents: string): Promise<boolean> {
  const previous = await readFile(path, "utf8").catch(() => null);
  if (previous === contents) {
    return false;
  }
  await writeFile(path, contents, "utf8");
  return true;
}

/**
 * Run one esbuild bundle without letting it write, then stage it through
 * {@link writeIfChanged}. `write: false` keeps the decision about the file's bytes here
 * rather than inside the bundler.
 */
async function emit(options: Parameters<typeof build>[0], outfile: string): Promise<void> {
  const result = await build({ ...options, outfile, write: false });
  if (result.errors.length > 0) {
    throw new Error(`${outfile}: ${result.errors.length} error(s)`);
  }
  const written = result.outputFiles?.[0];
  if (written === undefined) {
    throw new Error(`${outfile}: the bundler produced no output`);
  }
  const changed = await writeIfChanged(outfile, written.text);
  console.log(
    `build-dsh-plugin: ${outfile} ${changed ? "written" : "unchanged"}`,
  );
}

async function buildHost(): Promise<void> {
  await emit({
    entryPoints: [join(pluginRoot, "src", "host.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Workspace packages are bundled: the installed plugin must not depend on
    // `workspace:*` specifiers resolving inside the Harness profile.
    external: [],
    banner: {
      js: "// Generated by `bun scripts/build-dsh-plugin.ts`; not source. Rebuild rather than edit.",
    },
    logLevel: "info",
  }, join(distRoot, "host.js"));
}

async function buildClient(): Promise<void> {
  await emit({
    entryPoints: [join(pluginRoot, "src", "client.ts")],
    bundle: true,
    // The browser module table supplies React; bundling a second copy would give the panel
    // a different React instance than the shell rendering it.
    external: ["react", "react/jsx-runtime"],
    platform: "browser",
    format: "iife",
    target: "es2022",
    banner: {
      js: "// Generated by `bun scripts/build-dsh-plugin.ts`; not source. Rebuild rather than edit.",
    },
    logLevel: "info",
  }, join(distRoot, "client.js"));
}

checkTypes();
await buildSpa();

const spaInfo = await stat(join(webSource, "200.html")).catch(() => null);
if (spaInfo?.isFile() !== true) {
  throw new Error(
    "apps/web/build-dsh/200.html is missing; the embedded SPA build produced nothing",
  );
}

// Only the staged SPA is replaced wholesale: its asset names are content-hashed, so a stale
// copy would grow without bound. The two module files are overwritten **in place** and never
// removed — a running Harness serves `client.js` from this directory, and a rebuild that
// deletes it out from under that process takes the panel's registrations with it, silently
// and until the next graph rebuild.
await rm(join(distRoot, "web"), { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });
await cp(webSource, join(distRoot, "web"), { recursive: true });
await buildHost();
await buildClient();

// A packaged artifact should say what it is without being executed.
await writeFile(
  join(distRoot, "BUILD.txt"),
  [
    "Generated by `bun scripts/build-dsh-plugin.ts`.",
    `mount prefix: ${EMBED_BASE}`,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`build-dsh-plugin: staged ${distRoot} and ${join(distRoot, "web")}`);
