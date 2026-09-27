/**
 * The public release identity: repository license, package metadata, and first CI version.
 *
 * This is a manifest-level gate because npm publishes the package metadata alongside the
 * bundle; a correct workflow cannot repair a wrong license or a version that already exists.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PackageManifest {
  readonly version?: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly repository?: { readonly type?: string; readonly url?: string };
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

describe("public release identity", () => {
  it("declares AGPLv3 and the next publishable version", async () => {
    // Prevents: a public source repository and npm artifact silently carrying the old
    // proprietary metadata, or a stale tag that publishes a different version.
    const root = await readManifest(join(repoRoot, "package.json"));
    const published = await readManifest(
      join(repoRoot, "packages", "npm-dist", "package.json"),
    );

    expect(root.license).toBe("AGPL-3.0-only");
    expect(published.license).toBe("AGPL-3.0-only");
    expect(published.version).toBe("0.2.0");
    expect(published.private).toBeUndefined();
    expect(published.repository).toEqual({
      type: "git",
      url: "https://github.com/HuakunShen/refyard",
    });
  });

  it("ships the complete GNU Affero General Public License notice", async () => {
    // Prevents: SPDX metadata claiming AGPLv3 while the public checkout omits the license
    // text users need to understand their rights and obligations.
    const license = await readFile(join(repoRoot, "LICENSE"), "utf8");

    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3, 19 November 2007");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
  });
});
