/** Explicit history intent preserves draft edits, authority and cursor identity. */
import { describe, expect, it } from "vitest";
import {
  applyHistoryFilters,
  clearHistoryFilters,
  createHistoryFilterState,
  historyPageQuery,
  historyTopologyFor,
} from "../../apps/web/src/lib/workbench/history-filters.js";

describe("history filter intent", () => {
  it("keeps typing separate from applied intent and normalizes only on apply", () => {
    const state = createHistoryFilterState("repo_a");
    state.draft.message = "  Release  ";
    state.draft.author = " Fixture ";
    expect(state.applied).toEqual({});
    expect(applyHistoryFilters(state)).toBe(true);
    expect(state.applied).toEqual({ message: "Release", author: "Fixture" });
    state.draft.message = "later";
    expect(state.applied.message).toBe("Release");
  });
  it("rejects invalid combinations without replacing successful applied intent", () => {
    // Prevents an invalid draft silently displaying rows for a different applied search.
    const state = createHistoryFilterState("repo_a");
    state.draft.message = "release";
    applyHistoryFilters(state);
    state.draft.oidPrefix = "abcd";
    state.draft.path = { pathId: "path_a", displayPath: "src/a.ts" };
    expect(applyHistoryFilters(state)).toBe(false);
    expect(state.error).not.toBeNull();
    expect(state.applied).toEqual({ message: "release" });
  });
  it("captures known path identity and label independently from inspector selection", () => {
    const state = createHistoryFilterState("repo_a");
    state.draft.path = { pathId: "path_a", displayPath: "src/a.ts" };
    expect(applyHistoryFilters(state)).toBe(true);
    expect(state.applied.pathId).toBe("path_a");
    expect(state.appliedPath?.displayPath).toBe("src/a.ts");
    clearHistoryFilters(state, "repo_b");
    expect(state.repositoryId).toBe("repo_b");
    expect(state.applied).toEqual({});
    expect(state.draft.path).toBeNull();
  });
  it("sends filters on page one and only identity plus cursor on continuation", () => {
    expect(
      historyPageQuery(
        "repo_a",
        "wt_a",
        { message: "release", refFullName: "refs/heads/main" },
        null,
        100,
      ),
    ).toEqual({
      repositoryId: "repo_a",
      worktreeId: "wt_a",
      message: "release",
      refFullName: "refs/heads/main",
      limit: 100,
    });
    expect(
      historyPageQuery(
        "repo_a",
        "wt_a",
        { message: "release" },
        "cursor_a",
        100,
      ),
    ).toEqual({
      repositoryId: "repo_a",
      worktreeId: "wt_a",
      cursor: "cursor_a",
    });
  });
  it("classifies sparse pages without assuming parents will appear later", () => {
    expect(historyTopologyFor([{ topology: "continuous" }])).toBe("continuous");
    expect(
      historyTopologyFor([{ topology: "continuous" }, { topology: "sparse" }]),
    ).toBe("sparse");
  });
  it("gives repeated applies a fresh execution without changing normalized filters", () => {
    // Prevents an explicit repeat search inheriting the old cursor and previously loaded pages.
    const state = createHistoryFilterState("repo_a");
    state.draft.message = "release";
    const initial = state.revision;
    applyHistoryFilters(state);
    const first = state.revision;
    state.draft.author = "draft";
    expect(state.revision).toBe(first);
    state.draft.author = "";
    applyHistoryFilters(state);
    expect(first).toBeGreaterThan(initial);
    expect(state.revision).toBeGreaterThan(first);
    expect(state.applied).toEqual({ message: "release" });
  });
  it("converts displayed UTC bounds and rejects reversed instants", () => {
    // Prevents local browser timezone silently altering requested committer dates.
    const state = createHistoryFilterState("repo_a");
    state.draft.committedAfter = "2026-02-01T12:00";
    state.draft.committedBefore = "2026-02-02T00:00";
    expect(applyHistoryFilters(state)).toBe(true);
    expect(state.applied.committedAfter).toBe("2026-02-01T12:00:00Z");
    state.draft.committedBefore = "2026-01-01T00:00";
    expect(applyHistoryFilters(state)).toBe(false);
    expect(state.applied.committedBefore).toBe("2026-02-02T00:00:00Z");
  });
});
