/**
 * The checked-out branch's owned segment.
 *
 * The tint a user reads as "what my branch adds" has to end at exactly the row
 * where another branch's tip took the line over — one row short and the user's own
 * merges look foreign, one row long and absorbed history wears their colour. These
 * cases pin the walk: HEAD's token, first-parent only, stopping at a recoloured row,
 * at a page boundary, and in an empty list.
 */
import { describe, expect, it } from "vitest";
import { layoutGraph, type GraphCommit } from "@refyard/git-graph";
import { headSegmentFor } from "@refyard/git-ui/lib/head-segment";

const commit = (
  id: string,
  parentIds: readonly string[],
  refNames: readonly string[] = [],
): GraphCommit => ({ id, parentIds, refNames });

describe("headSegmentFor", () => {
  it("covers HEAD's segment and stops where another branch's tip recolours the lane", () => {
    // main's tip, then origin/rc5's tip taking the trunk over — the GitKraken
    // boundary the row tint reproduces.
    const result = layoutGraph(
      [
        commit("mine-2", ["mine-1"], ["refs/heads/main"]),
        commit("mine-1", ["rc5-tip"]),
        commit("rc5-tip", ["older"], ["refs/remotes/origin/rc5"]),
        commit("older", ["oldest"]),
        commit("oldest", []),
      ],
      {
        colorForRef: (c) =>
          (c.refNames ?? []).includes("refs/heads/main")
            ? "lane-current"
            : (c.refNames ?? []).includes("refs/remotes/origin/rc5")
              ? "lane-3"
              : undefined,
      },
    );
    const segment = headSegmentFor(result.rows);
    expect(segment?.token).toBe("lane-current");
    expect(segment?.ids.has("mine-2")).toBe(true);
    expect(segment?.ids.has("mine-1")).toBe(true);
    expect(segment?.ids.has("rc5-tip")).toBe(false);
    expect(segment?.ids.has("older")).toBe(false);
  });

  it("continues past a merge that did not change ownership", () => {
    // A merge with no ref on it is still the user's line; the tint must not stop
    // at every merge, only where a branch tip took over.
    const result = layoutGraph(
      [
        commit("tip", ["merge"], ["refs/heads/main"]),
        commit("merge", ["side", "tip"], ["refs/tags/v1"]),
        commit("side", []),
        commit("tip-2", ["older"]),
        commit("older", []),
      ],
      {
        colorForRef: (c) =>
          (c.refNames ?? []).includes("refs/heads/main") ? "lane-current" : undefined,
      },
    );
    const segment = headSegmentFor(result.rows);
    expect(segment?.ids.has("merge")).toBe(true);
  });

  it("stops at a page boundary instead of guessing past it", () => {
    // The parent is not in the loaded rows: nothing is known about ownership
    // below, and a wrong continuation would tint a foreign branch's rows.
    const result = layoutGraph([commit("head", ["not-loaded"], ["refs/heads/main"])], {
      colorForRef: () => "lane-current",
    });
    const segment = headSegmentFor(result.rows);
    expect(segment?.ids.has("head")).toBe(true);
    expect(segment?.ids.size).toBe(1);
  });

  it("answers null for an empty list", () => {
    expect(headSegmentFor([])).toBeNull();
  });
});
