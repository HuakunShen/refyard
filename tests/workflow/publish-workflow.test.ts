/**
 * The npm publication workflow contract.
 *
 * npm Trusted Publishing binds to the exact workflow filename and environment. This test
 * keeps a future cleanup from silently replacing tokenless publication with a broad token.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function workflow(): Promise<string> {
  return readFile(
    join(repoRoot, ".github", "workflows", "publish.yml"),
    "utf8",
  );
}

describe("npm publication workflow", () => {
  it("matches the Trusted Publisher identity and only runs for release tags", async () => {
    // Prevents: npm's trusted-publisher form pointing at a workflow that can publish from
    // arbitrary branch pushes, or at a renamed environment that npm cannot authenticate.
    const source = await workflow();

    expect(source).toMatch(/^name:\s*publish\s*$/m);
    expect(source).toMatch(
      /on:\s*\n\s+push:\s*\n\s+tags:\s*\n\s+-\s+["']?v\*["']?/m,
    );
    expect(source).toMatch(/environment:\s*\n\s+name:\s*publish/m);
    expect(source).toMatch(
      /permissions:\s*\n\s+contents:\s*read\s*\n\s+id-token:\s*write/m,
    );
  });

  it("publishes the tagged npm package after its release checks", async () => {
    // Prevents: a workflow publishing a different directory, a version not represented by
    // the Git tag, or an unverified artifact assembled after the tag was created.
    const source = await workflow();

    expect(source).toContain("pnpm build:release");
    expect(source).toContain("pnpm pack:smoke");
    expect(source).toContain("GITHUB_REF_NAME");
    expect(source).toContain("packages/npm-dist/package.json");
    expect(source).toMatch(/working-directory:\s*packages\/npm-dist/);
    expect(source).toMatch(/run:\s*npm publish\s*$/m);
  });

  it("contains no long-lived npm publish credential", async () => {
    // Prevents: a token secret becoming the real authority even though the npm package is
    // configured for OIDC Trusted Publishing.
    const source = await workflow();

    expect(source).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });
});
