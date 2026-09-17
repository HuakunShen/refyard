/** History filter validation keeps literal queries bounded and cursor-owned. */
import { describe, expect, it } from "vitest";
import {
  historyQuerySchema,
  validateHistoryQuery,
} from "@refyard/git-contract";

const identity = { repositoryId: "repo_test" };

describe("history filter contract", () => {
  it("accepts all typed filters and normalizes literal text", () => {
    const result = validateHistoryQuery({
      ...identity,
      message: "  fix [auth].* + spaces  ",
      author: " Alice (Dev) ",
      oidPrefix: "abcd",
      refFullName: "refs/heads/main",
      committedAfter: "2026-01-01T00:00:00Z",
      committedBefore: "2026-02-01T00:00:00Z",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { message: "fix [auth].* + spaces", author: "Alice (Dev)" },
    });
    expect(
      historyQuerySchema.safeParse({ ...identity, pathId: "path_known" })
        .success,
    ).toBe(true);
  });
  it("counts Unicode scalars after trimming", () => {
    expect(
      validateHistoryQuery({ ...identity, message: ` ${"😀".repeat(512)} ` })
        .ok,
    ).toBe(true);
    // Prevents a large literal search from escaping the documented work bound.
    expect(
      validateHistoryQuery({ ...identity, message: "😀".repeat(513) }).ok,
    ).toBe(false);
  });
  it.each(["", " ", "x\0y", "x\ny", "x\ry", "\ud800", "\udfff"])(
    "rejects invalid single-line text %j",
    (message) => {
      // Prevents Git treating one browser string as multiple grep patterns.
      expect(validateHistoryQuery({ ...identity, message }).ok).toBe(false);
    },
  );
  it("bounds semantic findings for repeated malformed Unicode", () => {
    // Prevents one bounded input generating an oversized public problem envelope.
    const result = validateHistoryQuery({
      ...identity,
      message: "\ud800".repeat(512),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected malformed Unicode to fail");
    expect(result.problems).toHaveLength(1);
  });

  it("rejects invalid dates, reversed bounds, and incompatible locators", () => {
    // Prevents calendar normalization silently changing the requested instant.
    expect(
      validateHistoryQuery({
        ...identity,
        committedAfter: "2026-02-30T00:00:00Z",
      }).ok,
    ).toBe(false);
    expect(
      validateHistoryQuery({
        ...identity,
        committedAfter: "2026-02-01T00:00:00Z",
        committedBefore: "2026-01-01T00:00:00Z",
      }).ok,
    ).toBe(false);
    expect(
      validateHistoryQuery({
        ...identity,
        oidPrefix: "abcd",
        pathId: "path_known",
      }).ok,
    ).toBe(false);
    expect(validateHistoryQuery({ ...identity, oidPrefix: "ABCD" }).ok).toBe(
      false,
    );
    expect(
      validateHistoryQuery({ ...identity, refFullName: "refs/heads/a..b" }).ok,
    ).toBe(false);
  });
  it.each([
    "message",
    "author",
    "oidPrefix",
    "refFullName",
    "committedAfter",
    "committedBefore",
    "pathId",
  ])("rejects %s on cursor continuation", (field) => {
    // Prevents a continuation redefining the pinned walk.
    expect(
      validateHistoryQuery({
        ...identity,
        cursor: "cur_known",
        [field]: "abcd",
      }).ok,
    ).toBe(false);
  });
  it("leaves redundant legacy page options for snapshot comparison", () => {
    expect(
      validateHistoryQuery({
        ...identity,
        cursor: "cur_known",
        limit: 3,
        firstParentOnly: true,
      }).ok,
    ).toBe(true);
    expect(validateHistoryQuery({ ...identity, argv: ["log"] }).ok).toBe(false);
  });
});
