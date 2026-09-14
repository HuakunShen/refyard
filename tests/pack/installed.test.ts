/**
 * The published manifest and the staged artifact.
 *
 * These are the promises a tarball makes before it is installed, so they are checked
 * against the manifest itself rather than against the build script's intentions:
 *
 * - `bin.refyard` exists and the staged shim starts with a shebang, because a bin
 *   without one is only runnable through `node`;
 * - `engines.node` pins the major this build is tested on;
 * - there are no `dependencies` and no install scripts: the bundle carries its
 *   workspace packages, so a broken `postinstall` cannot exist and nothing resolves
 *   `workspace:*` at install time;
 * - the `files` whitelist ships the CLI, the UI and nothing else — no sources, no
 *   fixtures, no references;
 * - `private: true` and an `UNLICENSED` license, because this package is not for the
 *   public registry and no license has been granted. A test asserts that nobody has
 *   quietly invented one.
 *
 * The staged-tree checks run only when a build exists, since `packages/npm-dist/dist`
 * is generated output; the manifest checks always run.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const staging = join(repoRoot, "packages", "npm-dist");

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly bin?: Record<string, string>;
  readonly engines?: Record<string, string>;
  readonly files?: readonly string[];
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(join(staging, "package.json"), "utf8"),
  ) as PackageManifest;
}

async function stagedExists(relativePath: string): Promise<boolean> {
  try {
    await stat(join(staging, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe("the published manifest", () => {
  it("exposes one bin named refyard, pointing at a .mjs shim", async () => {
    const manifest = await readManifest();
    expect(manifest.name).toEqual("refyard");
    expect(manifest.bin).toEqual({ refyard: "bin/refyard.mjs" });
  });

  it("pins the Node major this build is verified on", async () => {
    const manifest = await readManifest();
    // The v2 design package says 24 because that was current when it was written; this
    // repository is pinned to Node 26, and the range here is the one the CI gate runs.
    expect(manifest.engines?.["node"]).toEqual(">=26 <27");
  });

  it("carries no dependencies and no install scripts", async () => {
    const manifest = await readManifest();
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    expect(Object.keys(dependencies)).toEqual([]);
    expect(
      Object.values(dependencies).some((value) =>
        String(value).startsWith("workspace:"),
      ),
    ).toBe(false);
    expect(manifest.scripts?.["postinstall"]).toBeUndefined();
    expect(Object.keys(manifest.scripts ?? {})).toEqual([]);
  });

  it("ships the CLI, the UI, and nothing else", async () => {
    const manifest = await readManifest();
    expect(manifest.files).toEqual(["bin", "dist", "web"]);
  });

  it("is not publishable and claims no license", async () => {
    const manifest = await readManifest();
    // An accidental `npm publish` is refused by npm itself, and no license text is
    // invented on the project's behalf.
    expect(manifest.private).toBe(true);
    expect(manifest.license).toEqual("UNLICENSED");
  });
});

describe("the staged artifact", () => {
  it("has a bin shim with a shebang, when a build has been staged", async () => {
    if (!(await stagedExists("bin/refyard.mjs"))) {
      // Generated output: `pnpm build:release` stages it. The manifest checks above
      // are the invariant; this one guards the shape that is only meaningful built.
      expect(await stagedExists("package.json")).toBe(true);
      return;
    }
    const shim = await readFile(join(staging, "bin", "refyard.mjs"), "utf8");
    expect(shim.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(shim).toContain("../dist/cli.mjs");
  });

  it("keeps the build machine's paths out of the bundle", async () => {
    if (!(await stagedExists("dist/cli.mjs"))) {
      return;
    }
    const bundle = await readFile(join(staging, "dist", "cli.mjs"), "utf8");
    // A published artifact that names the builder's checkout breaks the day someone
    // installs it somewhere else.
    expect(bundle).not.toContain(repoRoot);
    expect(bundle).not.toContain("fixture-");
  });

  it("records what was built, when a build has been staged", async () => {
    if (!(await stagedExists("dist/build-info.json"))) {
      return;
    }
    const info = JSON.parse(
      await readFile(join(staging, "dist", "build-info.json"), "utf8"),
    ) as { version: string; gitCommit: string; bundleBytes: number };
    const manifest = await readManifest();
    expect(info.version).toEqual(manifest.version);
    expect(info.bundleBytes).toBeGreaterThan(0);
    expect(typeof info.gitCommit).toBe("string");
  });
});
