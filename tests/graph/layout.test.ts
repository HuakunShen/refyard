/**
 * Lane layout, tested against the shapes a real repository produces.
 *
 * The cases are chosen from the reference implementation's own walk-through and from
 * the states this service actually renders: a linear history, a merge, an octopus,
 * a root, a history that arrives in pages, and a lane whose commit has not been
 * loaded yet. Each one asserts the property a renderer depends on, not an incidental
 * index:
 *
 * - a merge draws three lanes at the merge row and two afterwards;
 * - a lane keeps its index across rows until the commit it waits for arrives;
 * - a parent that is not in the page stays as a lane (pagination must not cut a line);
 * - page two continues page one's lanes rather than restarting at lane zero;
 * - the layout is deterministic: the same input always produces the same rows.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE,
  layoutGraph,
  refColorFor,
  type GraphCommit,
} from "@refyard/git-graph";

function commit(
  id: string,
  parents: readonly string[] = [],
  refNames: readonly string[] = [],
): GraphCommit {
  return { id, parentIds: parents, refNames };
}

describe("linear history", () => {
  it("keeps one lane and one colour from top to bottom", () => {
    const result = layoutGraph([
      commit("c", ["b"]),
      commit("b", ["a"]),
      commit("a"),
    ]);
    expect(result.rows.map((row) => row.laneIndex)).toEqual([0, 0, 0]);
    expect(new Set(result.rows.map((row) => row.laneColor)).size).toBe(1);
    expect(result.continuation).toEqual([]);
    expect(result.laneCount).toBe(1);
  });

  it("closes every lane on a root commit", () => {
    const result = layoutGraph([commit("root")]);
    expect(result.rows[0]?.outputLanes).toEqual([]);
    expect(result.rows[0]?.isRoot).toBe(true);
    expect(result.continuation).toEqual([]);
  });
});

describe("merges", () => {
  const merge: GraphCommit[] = [
    commit("m", ["left", "right"]),
    commit("left", ["base"]),
    commit("right", ["base"]),
    commit("base"),
  ];

  it("opens a lane for the second parent at the merge row", () => {
    const result = layoutGraph(merge);
    expect(result.rows[0]?.isMerge).toBe(true);
    expect(result.rows[0]?.outputLanes.map((lane) => lane.id)).toEqual([
      "left",
      "right",
    ]);
    // The merge's own circle sits in the lane that was waiting for it.
    expect(result.rows[0]?.laneIndex).toBe(0);
  });

  it("converges both parents back into one lane at their common ancestor", () => {
    const result = layoutGraph(merge);
    const baseRow = result.rows[3];
    // Two lanes waited for `base`, so two lanes enter that row…
    expect(baseRow?.inputLanes.map((lane) => lane.id)).toEqual([
      "base",
      "base",
    ]);
    // …and the second one closes into the first rather than being drawn twice.
    expect(baseRow?.outputLanes).toEqual([]);
  });

  it("keeps the left lane's index stable across a merge", () => {
    const result = layoutGraph(merge);
    expect(result.rows[1]?.laneIndex).toBe(0);
    expect(result.rows[2]?.laneIndex).toBe(1);
  });

  it("draws an octopus merge as three lanes", () => {
    const result = layoutGraph([
      commit("m", ["a", "b", "c"]),
      commit("a", ["base"]),
      commit("b", ["base"]),
      commit("c", ["base"]),
      commit("base"),
    ]);
    expect(result.rows[0]?.outputLanes.map((lane) => lane.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.rows[0]?.parentIds).toHaveLength(3);
    expect(result.laneCount).toBe(3);
  });
});

describe("unknown parents", () => {
  it("keeps a parent that is not in this page as a lane", () => {
    // Prevents: a page boundary rendering as the end of a branch, which would draw a
    // fake root in the middle of history.
    const result = layoutGraph([commit("recent", ["not-loaded"])]);
    expect(result.continuation.map((lane) => lane.id)).toEqual(["not-loaded"]);
    expect(result.rows[0]?.outputLanes).toHaveLength(1);
  });

  it("continues the lanes it is given, rather than restarting at lane zero", () => {
    const first = layoutGraph([commit("b", ["a"])]);
    const second = layoutGraph([commit("a")], {
      continuation: first.continuation,
    });
    expect(second.rows[0]?.laneIndex).toBe(0);
    expect(second.rows[0]?.inputLanes.map((lane) => lane.id)).toEqual(["a"]);
    expect(second.rows[0]?.outputLanes).toEqual([]);
  });

  it("keeps a second page's lanes at the index the first page left them", () => {
    const first = layoutGraph([
      commit("m", ["left", "right"]),
      commit("left", ["base"]),
      commit("right", ["base"]),
    ]);
    const second = layoutGraph([commit("base")], {
      continuation: first.continuation,
    });
    expect(second.rows[0]?.inputLanes.map((lane) => lane.id)).toEqual([
      "base",
      "base",
    ]);
    expect(second.rows[0]?.laneIndex).toBe(0);
  });
});

describe("colours", () => {
  it("gives a new lane the next palette colour and inherits along a lane", () => {
    const result = layoutGraph([
      commit("m", ["left", "right"]),
      commit("left", ["base"]),
    ]);
    const mergeRow = result.rows[0];
    const left = mergeRow?.outputLanes[0];
    const right = mergeRow?.outputLanes[1];
    expect(left?.color).not.toBe(right?.color);
    // The inherited lane keeps its colour when its commit appears.
    expect(result.rows[1]?.laneColor).toBe(left?.color);
  });

  it("keeps a ref's colour stable for the same ref name", () => {
    expect(refColorFor(["refs/heads/main"])).toBe(refColorFor(["main"]));
    expect(refColorFor([])).toBeUndefined();
    const palette = DEFAULT_PALETTE;
    const color = refColorFor(["refs/heads/main"], palette);
    expect(palette).toContain(color);
  });

  it("uses the ref colour for the lane a ref points at", () => {
    const result = layoutGraph([commit("a", ["b"], ["refs/heads/main"])], {
      colorForRef: (entry) => refColorFor(entry.refNames ?? []),
    });
    expect(result.rows[0]?.laneColor).toBeDefined();
    expect(result.rows[0]?.outputLanes[0]?.color).toBe(
      result.rows[0]?.laneColor,
    );
  });
});

describe("determinism and bounds", () => {
  it("produces the same layout for the same input", () => {
    const commits = [
      commit("c", ["b"], ["refs/heads/main"]),
      commit("b", ["a"]),
      commit("a"),
    ];
    expect(layoutGraph(commits)).toEqual(layoutGraph(commits));
  });

  it("keeps every lane that is not this row's commit in its own slot", () => {
    // Prevents: a renderer that aligns rows by index drawing a crossing line the data
    // does not contain. A lane may close, but a surviving lane never shifts sideways.
    const result = layoutGraph([
      commit("m", ["a", "b", "c"]),
      commit("a", ["base"]),
      commit("c", ["base"]),
      commit("b", ["base"]),
      commit("base"),
    ]);
    for (const row of result.rows) {
      for (const [index, lane] of row.inputLanes.entries()) {
        if (lane.id === row.id) {
          // This row's own lane is the one that becomes its first parent in place.
          continue;
        }
        const survivor = row.outputLanes[index];
        if (survivor === undefined) {
          continue;
        }
        expect(survivor.id).toBe(lane.id);
      }
    }
  });

  it("handles an empty page without inventing lanes", () => {
    const result = layoutGraph([]);
    expect(result.rows).toEqual([]);
    expect(result.continuation).toEqual([]);
    expect(result.laneCount).toBe(0);
  });

  it("returns a copy of the continuation, so a caller cannot mutate its state", () => {
    const continuation = [{ id: "x", color: "lane-1" }];
    const result = layoutGraph([], { continuation });
    result.continuation[0]?.id;
    expect(result.continuation).not.toBe(continuation);
  });
});

describe("adjacent branch lanes", () => {
  const history: GraphCommit[] = [
    commit("t", ["m"]),
    commit("u", ["o"]),
    commit("m", ["left", "side"]),
    commit("left", ["base"]),
    commit("side", ["base"]),
    commit("o", ["base"]),
    commit("base"),
  ];

  it("opens a branch lane beside the lane it branches from, not at the right edge", () => {
    // GitKraken keeps a branch's lane next to its parent's, so the branch curve into
    // the trunk is one lane wide and unrelated lanes keep their distance.
    const result = layoutGraph(history);
    const mergeRow = result.rows[2];
    expect(mergeRow?.outputLanes.map((lane) => lane.id)).toEqual([
      "left",
      "side",
      "o",
    ]);
  });

  it("shifts a surviving unrelated lane sideways by the lanes opened left of it", () => {
    // Prevents: a renderer matching lanes by index drawing the unrelated lane as a
    // merge into this row's commit. The lane keeps its identity (id) across the shift;
    // `rowGeometry` matches by id, and this pins the data it matches on.
    const result = layoutGraph(history);
    const mergeRow = result.rows[2];
    expect(mergeRow?.inputLanes.map((lane) => lane.id)).toEqual(["m", "o"]);
    const outputSlotOfO = mergeRow?.outputLanes.findIndex(
      (lane) => lane.id === "o",
    );
    expect(outputSlotOfO).toBe(2);
  });

  it("keeps each branch's circle in the lane that waited for it", () => {
    const result = layoutGraph(history);
    expect(result.rows[3]?.laneIndex).toBe(0); // left
    expect(result.rows[4]?.laneIndex).toBe(1); // side — opened beside the trunk
    expect(result.rows[5]?.laneIndex).toBe(2); // o — pushed right by `side`
  });
});
