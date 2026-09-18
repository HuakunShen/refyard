/**
 * The public README surface.
 *
 * These assertions keep the discoverability and trust claims tied to real project entry
 * points instead of letting a release quietly drift back to an uninformative placeholder.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readme(): Promise<string> {
  return readFile(join(repoRoot, "README.md"), "utf8");
}

describe("public README surface", () => {
  it("shows live package, CI, license, and self-deploy entry points", async () => {
    // Prevents: a public repository whose README sends users to stale package metadata,
    // hides its test status, or omits the one-click self-deploy path.
    const source = await readme();

    expect(source).toContain("https://img.shields.io/npm/v/refyard");
    expect(source).toContain("https://img.shields.io/npm/dm/refyard");
    expect(source).toContain(
      "https://github.com/HuakunShen/refyard/actions/workflows/ci.yml/badge.svg",
    );
    expect(source).toContain(
      "https://img.shields.io/github/license/HuakunShen/refyard",
    );
    expect(source).toContain("https://deploy.workers.cloudflare.com/button");
    expect(source).toContain(
      "https://deploy.workers.cloudflare.com/?url=https://github.com/HuakunShen/refyard",
    );
  });

  it("shows the real history demo and names the AGPLv3 trust boundary", async () => {
    // Prevents: a visual demo that is disconnected from the checked-in asset, or a
    // marketing claim that leaves readers guessing whether Git data goes to a central host.
    const source = await readme();

    // The hero moved to the desktop workbench reading this repository itself; the
    // contract is that a checked-in real-session demo stays the first impression.
    expect(source).toContain("docs/assets/desktop-workbench.png");
    expect(source).toMatch(/AGPL(?:v3|-3\.0-only)/i);
    expect(source).toMatch(/never (?:upload|sends|receives).*Git/i);
    expect(source).toContain("publish.yml");
  });
});
