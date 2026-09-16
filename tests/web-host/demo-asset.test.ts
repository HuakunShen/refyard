/**
 * The README's visual demo asset.
 *
 * A broken or empty image makes the public project look unverified even when the UI works;
 * the test keeps the committed README evidence tied to a real PNG file.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const demoPath = join(repoRoot, "docs", "assets", "vscode-history.png");

describe("README history demo asset", () => {
  it("is a real, non-empty PNG with a usable screenshot size", async () => {
    // Prevents: a README image link resolving to a zero-byte placeholder or an accidental
    // text file, which would hide the fact that the public visual demo was never captured.
    const info = await stat(demoPath);
    const bytes = await readFile(demoPath);

    expect(info.isFile()).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect([...bytes.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(640);
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(360);
  });
});
