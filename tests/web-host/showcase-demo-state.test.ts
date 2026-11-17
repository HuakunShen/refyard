/**
 * The public demo models real Git concepts with immutable, contract-valid DTOs,
 * but does not touch a repository or run a service.
 */
import { describe, expect, it } from "vitest";
import {
  commitDetailSchema,
  commitSummarySchema,
  diffResponseSchema,
  statusSnapshotSchema,
} from "@refyard/git-contract";
import {
  makeDemoFixture,
} from "../../apps/docs/src/lib/demo/fixtures.js";
import {
  createDemoState,
  reduceDemoState,
} from "../../apps/docs/src/lib/demo/reducer.js";
import {
  getDemoGraph,
  getSelectedDemoDiff,
  getSelectedWorkingCopyDiff,
} from "../../apps/docs/src/lib/demo/selectors.js";

describe("local Refyard Git sandbox", () => {
  it("contains a believable valid history, merge lanes, diffs and working copy", () => {
    const fixture = makeDemoFixture();
    expect(fixture.commits.length).toBeGreaterThanOrEqual(24);
    for (const commit of fixture.commits) {
      expect(commitSummarySchema.safeParse(commit).success).toBe(true);
      expect(commitDetailSchema.safeParse(fixture.detailsByOid[commit.oid]).success).toBe(true);
      expect(diffResponseSchema.safeParse(fixture.diffsByOid[commit.oid]).success).toBe(true);
    }
    expect(statusSnapshotSchema.safeParse(fixture.status).success).toBe(true);
    expect(fixture.commits.some((commit) => commit.parents.length === 2)).toBe(true);
    expect(getDemoGraph(createDemoState(fixture)).laneCount).toBeGreaterThan(1);
    expect(fixture.status.entries.some((entry) => entry.indexStatus !== ".")).toBe(true);
    expect(fixture.status.entries.some((entry) => entry.worktreeStatus !== ".")).toBe(true);
  });

  it("selects the matching diff without changing anything for an unknown OID", () => {
    const fixture = makeDemoFixture();
    const original = createDemoState(fixture);
    const target = fixture.commits[5];
    expect(target).toBeDefined();
    if (!target) return;
    const selected = reduceDemoState(original, { type: "select-commit", oid: target.oid });
    expect(selected.selectedOid).toBe(target.oid);
    expect(getSelectedDemoDiff(selected)?.request.oid).toBe(target.oid);
    expect(reduceDemoState(selected, { type: "select-commit", oid: "f".repeat(40) })).toEqual(selected);
    expect(original.selectedOid).toBe(fixture.commits[0]?.oid);
  });

  it("stages and unstages a whole-file change without mixing Git layers", () => {
    const initial = createDemoState(makeDemoFixture());
    const unstaged = initial.status.entries.find((entry) => entry.kind === "ordinary" && entry.indexStatus === "." && entry.worktreeStatus === "M");
    expect(unstaged).toBeDefined();
    if (!unstaged) return;
    const staged = reduceDemoState(initial, { type: "stage", pathIds: [unstaged.pathId] });
    expect(staged.status.entries.find((entry) => entry.pathId === unstaged.pathId)?.indexStatus).toBe("M");
    expect(staged.status.entries.find((entry) => entry.pathId === unstaged.pathId)?.worktreeStatus).toBe(".");
    const restored = reduceDemoState(staged, { type: "unstage", pathIds: [unstaged.pathId] });
    expect(restored.status.entries.find((entry) => entry.pathId === unstaged.pathId)).toEqual(unstaged);
    expect(initial.status.entries.find((entry) => entry.pathId === unstaged.pathId)).toEqual(unstaged);
  });

  it("rejects ambiguous mixed-stage and unknown-file operations", () => {
    const initial = createDemoState(makeDemoFixture());
    const mixed = initial.status.entries.find((entry) => entry.kind === "ordinary" && entry.indexStatus !== "." && entry.worktreeStatus !== ".");
    expect(mixed).toBeDefined();
    if (!mixed) return;
    expect(reduceDemoState(initial, { type: "stage", pathIds: [mixed.pathId] })).toEqual(initial);
    expect(reduceDemoState(initial, { type: "unstage", pathIds: [mixed.pathId] })).toEqual(initial);
    expect(reduceDemoState(initial, { type: "stage", pathIds: ["path_missing"] })).toEqual(initial);
  });

  it("supports new files and keeps file previews tied to their selected side", () => {
    const initial = createDemoState(makeDemoFixture());
    const pathId = "path_untracked";
    const selected = reduceDemoState(initial, { type: "select-file", pathId, side: "unstaged" });
    expect(getSelectedWorkingCopyDiff(selected)?.request).toMatchObject({ kind: "unstaged", pathId });
    expect(getSelectedWorkingCopyDiff(selected)?.files[0]?.displayPath).toContain("KeyboardHints.svelte");
    const staged = reduceDemoState(selected, { type: "stage", pathIds: [pathId] });
    expect(staged.status.entries.find((entry) => entry.pathId === pathId)).toMatchObject({ kind: "ordinary", indexStatus: "A", worktreeStatus: "." });
    expect(getSelectedWorkingCopyDiff(staged)?.request.kind).toBe("staged");
    const unstaged = reduceDemoState(staged, { type: "unstage", pathIds: [pathId] });
    expect(unstaged.status.entries.find((entry) => entry.pathId === pathId)).toEqual(initial.status.entries.find((entry) => entry.pathId === pathId));
  });

  it("only commits staged changes with a message, then reset fully restores fixture", () => {
    const fixture = makeDemoFixture();
    const initial = createDemoState(fixture);
    expect(reduceDemoState(initial, { type: "commit", message: "   " })).toEqual(initial);
    expect(reduceDemoState(initial, { type: "commit", message: "x".repeat(4097) })).toEqual(initial);
    const committed = reduceDemoState(initial, { type: "commit", message: "Document the graph renderer" });
    expect(committed.commits).toHaveLength(fixture.commits.length + 1);
    expect(committed.commits[0]?.parents).toEqual([fixture.commits[0]?.oid]);
    expect(committed.commits[0]?.subject).toBe("Document the graph renderer");
    expect(committed.status.head.oid).toBe(committed.commits[0]?.oid);
    expect(committed.status.entries.filter((entry) => entry.indexStatus !== "." && entry.indexStatus !== "?")).toHaveLength(0);
    expect(commitSummarySchema.safeParse(committed.commits[0]).success).toBe(true);
    const reset = reduceDemoState(committed, { type: "reset" });
    expect(reset).toEqual(createDemoState(fixture));
    expect(fixture.commits).toHaveLength(initial.commits.length);
  });
});
