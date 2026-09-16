/**
 * The public root entrypoint for Cloudflare self-deployment.
 *
 * The Deploy to Cloudflare button starts at the repository root. These assertions keep
 * that adapter pointed at the existing asset-only Worker instead of inventing a second API.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function rootWranglerConfig(): Promise<string> {
  return readFile(join(repoRoot, "wrangler.jsonc"), "utf8");
}

async function rootManifest(): Promise<string> {
  return readFile(join(repoRoot, "package.json"), "utf8");
}

describe("root Cloudflare self-deploy entrypoint", () => {
  it("points at the existing static Worker and its built SPA assets", async () => {
    // Prevents: the public Deploy button selecting the nested maintainer config, a missing
    // asset directory, or a generic Worker that accidentally gains backend authority.
    const config = await rootWranglerConfig();

    expect(config).toContain('"main": "./apps/web/src/worker.ts"');
    expect(config).toContain('"directory": "./apps/web/build"');
    expect(config).toContain('"binding": "ASSETS"');
    expect(config).toContain('"run_worker_first": true');
    expect(config).toContain('"not_found_handling": "single-page-application"');
  });

  it("keeps a self-deployed UI fail-closed until its owner configures an API origin", async () => {
    // Prevents: a user's new Worker silently granting the browser network access to an
    // arbitrary service before the user has explicitly configured their own backend.
    const config = await rootWranglerConfig();

    expect(config).toMatch(/"PUBLIC_API_ORIGINS":\s*""/);
  });

  it("exposes a root deploy script for Cloudflare's repository importer", async () => {
    // Prevents: the official button cloning the repository successfully but stopping at a
    // monorepo with no build/deploy command that produces apps/web/build.
    const manifest = await rootManifest();

    expect(manifest).toContain(
      '"deploy": "pnpm build:web && pnpm --dir apps/web exec wrangler deploy --config ../../wrangler.jsonc"',
    );
  });
});
