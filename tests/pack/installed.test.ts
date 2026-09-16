/**
 * The published manifest and the staged artifact.
 *
 * These are the promises a tarball makes before it is installed, so they are checked
 * against the manifest itself rather than against the build script's intentions:
 *
 * - `bin.refyard` exists and the staged shim starts with a shebang, because a bin
 *   without one is only runnable through `node`;
 * - `engines.node` is the range this build is tested on, and the smoke test checks the
 *   Node it runs under against that same range rather than against its own opinion;
 * - there are no `dependencies` and no install scripts: the bundle carries its
 *   workspace packages, so a broken `postinstall` cannot exist and nothing resolves
 *   `workspace:*` at install time;
 * - the `files` whitelist ships the backend CLI and nothing else — no UI, sources, no
 *   fixtures, no references;
 * - the package is publishable and `UNLICENSED`: publishing makes it installable and
 *   grants nobody a licence, and no licence text is invented on the project's behalf.
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

  it("declares the oldest Node line the suite has been run on", async () => {
    const manifest = await readManifest();
    // `>=22 <27`: the packaged CLI completes its lifecycle on 22.11.0 and up, and the
    // range starts at 22 because Node 20 is past end of life — not because the code needs
    // it (see docs/evidence/release-matrix.md, "Node versions"). Development stays pinned
    // to 26.8.2 through `.nvmrc`, which is a different promise from this one: this is what
    // a user installing the tarball is told they need.
    expect(manifest.engines?.["node"]).toEqual(">=22 <27");
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

  it("ships the API-only CLI and nothing else", async () => {
    const manifest = await readManifest();
    expect(manifest.files).toEqual(["bin", "dist"]);
  });

  it("is publishable, and grants no licence by publishing", async () => {
    const manifest = await readManifest();
    // The manifest is the thing that reaches the registry, so the release identity is
    // asserted here: `private` would make `npm publish` refuse, and `UNLICENSED` is the
    // deliberate choice that publishing makes the package *installable*, not usable.
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toEqual("UNLICENSED");
    expect(manifest.version).not.toEqual("0.0.0");
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
