/** The built Astro site has a product home, embedded demo, docs and old links. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docs = join(repository, "apps", "docs");

describe("static Refyard showcase", () => {
  it("builds showcase, demo, canonical docs, and backward-compatible deep docs routes", async () => {
    execFileSync(process.execPath, [join(docs, "node_modules", "astro", "bin", "astro.mjs"), "build"], {
      cwd: docs,
      stdio: "pipe",
      timeout: 120_000,
    });

    const [home, showcase, demo, docsIndex, canonicalInstall, legacyInstall] = await Promise.all([
      readFile(join(docs, "dist", "index.html"), "utf8"),
      readFile(join(docs, "dist", "showcase", "index.html"), "utf8"),
      readFile(join(docs, "dist", "demo", "index.html"), "utf8"),
      readFile(join(docs, "dist", "docs", "index.html"), "utf8"),
      readFile(join(docs, "dist", "docs", "install", "index.html"), "utf8"),
      readFile(join(docs, "dist", "install", "index.html"), "utf8"),
    ]);
    expect(home).toContain("Your Git history");
    expect(home).toContain('id="try-it"');
    expect(home).toContain('href="/docs/"');
    expect(home).toContain("FullWorkbenchDemo");
    expect(showcase).toContain('http-equiv="refresh"');
    expect(demo).toMatch(/<main\b/);
    expect(docsIndex).toContain("What Refyard is");
    expect(canonicalInstall).toContain("Install");
    expect(legacyInstall).toContain("Install");
  }, 150_000);
});
