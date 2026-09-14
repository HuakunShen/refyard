/**
 * Portable core, verified the way the plan asks: plan and parse with no host.
 *
 * The first case is the reference plan's own example, written out as an executable
 * contract: `planStatus` takes a handle and produces a spec, and `parseStatus`
 * returns raw path bytes for a NUL-framed record. The second runs the same code as
 * a neutral IIFE inside a VM with no host globals, which is what makes "core has no
 * runtime dependency" a measured fact rather than a claim about the imports.
 */
import { describe, expect, it } from "vitest";
import { parseStatus, planStatus, planRevList } from "@refyard/git-core";
import { runPortableSmoke } from "../../scripts/lib/portable.js";

describe("planner and parser contract", () => {
  it("plans a status read for an approved handle and parses its bytes", () => {
    expect(planStatus({ cwdHandle: "approved-1" }).cwdHandle).toBe(
      "approved-1",
    );
    const status = parseStatus(Uint8Array.from([0x3f, 0x20, 0x61, 0x00]));
    expect(status.records[0]?.path).toEqual(Uint8Array.from([0x61]));
    expect(status.records[0]?.kind).toBe("untracked");
  });

  it("keeps a repository-supplied name out of argv by putting tips on stdin", () => {
    // Prevents: a branch named `--upload-pack=...` (or `-x`) being read as an option
    // because it travelled as an argument instead of as data.
    const spec = planRevList(
      { cwdHandle: "approved-1" },
      { tips: ["--upload-pack=touch /tmp/pwned"], maxCount: 10, skip: 0 },
    );
    expect(spec.argv).not.toContain("--upload-pack=touch /tmp/pwned");
    expect(spec.stdin).toBeDefined();
    expect(spec.argv).toContain("--stdin");
  });
});

describe("portability smoke", () => {
  it("builds a neutral bundle that contains no Node shim", async () => {
    const result = await runPortableSmoke();
    expect(result.forbiddenReferences).toEqual([]);
    expect(result.bundleBytes).toBeGreaterThan(0);
  });

  it("runs the planners and parsers in a context with no host globals", async () => {
    const { evaluated } = await runPortableSmoke();
    expect(evaluated.error).toBeNull();
    expect(evaluated.statusKind).not.toBeNull();
    expect(evaluated.topologyRows).toBeGreaterThan(0);
    expect(evaluated.patchHunks).toBeGreaterThan(0);
    expect(evaluated.planArgv.status).toContain("status");
  });
});
