/**
 * The published Astro output must serve both new showcase routes without displacing
 * the existing Fumadocs homepage. The test inspects real build artifacts.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docs = join(repository, "apps", "docs");

describe("static Refyard showcase", () => {
  it("builds a landing page, real demo route, and existing docs homepage", async () => {
    execFileSync(process.execPath, [join(docs, "node_modules", "astro", "bin", "astro.mjs"), "build"], {
      cwd: docs,
      stdio: "pipe",
      timeout: 120_000,
    });

    const [root, showcase, demo] = await Promise.all([
      readFile(join(docs, "dist", "index.html"), "utf8"),
      readFile(join(docs, "dist", "showcase", "index.html"), "utf8"),
      readFile(join(docs, "dist", "demo", "index.html"), "utf8"),
    ]);
    expect(root).toContain("Refyard");
    expect(showcase).toMatch(/<main\b/);
    expect(demo).toMatch(/<main\b/);
  }, 150_000);
});
