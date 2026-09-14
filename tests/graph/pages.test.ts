/**
 * Paging a commit graph.
 *
 * History arrives in pages; the graph must not notice. These cases exist because the
 * failure mode is subtle — a page boundary that restarts the lanes still renders *a*
 * graph, just one that lies about which line is which branch.
 */
import { describe, expect, it } from "vitest";
import { layoutGraph, layoutPages, type GraphCommit } from "@refyard/git-graph";

function commit(id: string, parentIds: readonly string[]): GraphCommit {
  return { id, parentIds };
}

const LINEAR: readonly GraphCommit[] = [
  commit("f", ["e"]),
  commit("e", ["d"]),
  commit("d", ["c"]),
  commit("c", []),
];

/** A merge whose parents straddle a page boundary, so both pages have live lanes. */
const BRANCHED: readonly GraphCommit[] = [
  commit("m", ["l1", "r1"]),
  commit("l1", ["l2"]),
  commit("r1", ["r2"]),
  commit("l2", ["base"]),
  commit("r2", ["base"]),
  commit("base", []),
];

describe("layoutPages", () => {
  it("produces exactly the rows a single layout of the whole history would", () => {
    const pages = [LINEAR.slice(0, 2), LINEAR.slice(2)];
    const folded = layoutPages(pages);
    const whole = layoutGraph(LINEAR);
    expect(folded.rows).toStrictEqual(whole.rows);
    expect(folded.laneCount).toBe(whole.laneCount);
  });

  it("keeps a live lane alive across a page boundary", () => {
    // Splitting between the merge and its parents is the case where a naive restart shows
    // two unrelated lines instead of one branch waiting for a commit on the next page.
    const pages = [BRANCHED.slice(0, 3), BRANCHED.slice(3)];
    const folded = layoutPages(pages);
    expect(folded.rows).toStrictEqual(layoutGraph(BRANCHED).rows);

    const lastOfFirstPage = folded.rows[2];
    const firstOfSecondPage = folded.rows[3];
    expect(lastOfFirstPage?.outputLanes.map((lane) => lane.id)).toEqual(
      firstOfSecondPage?.inputLanes.map((lane) => lane.id),
    );
    expect(folded.laneCount).toBeGreaterThan(1);
  });

  it("reports the widest page, so one column can be sized for all of them", () => {
    const wide = [
      commit("c", ["b1", "b2", "b3"]),
      commit("b1", []),
      commit("b2", []),
      commit("b3", []),
    ];
    const folded = layoutPages([wide]);
    expect(folded.laneCount).toBe(layoutGraph(wide).laneCount);
    expect(folded.laneCount).toBeGreaterThanOrEqual(3);
  });

  it("starts from an explicit continuation when a page is loaded out of order", () => {
    const first = layoutGraph(BRANCHED.slice(0, 3));
    const continued = layoutPages([BRANCHED.slice(3)], {
      continuation: first.continuation,
    });
    expect(continued.rows).toStrictEqual(layoutGraph(BRANCHED).rows.slice(3));
  });

  it("treats an empty page as a no-op rather than resetting the lanes", () => {
    // A UI that renders a spinner page must not lose the continuation it already had.
    const first = layoutGraph(BRANCHED.slice(0, 3));
    const folded = layoutPages([BRANCHED.slice(0, 3), []], {});
    expect(folded.rows).toStrictEqual(first.rows);
  });
});
