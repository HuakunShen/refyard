/**
 * Graph geometry behaviour.
 *
 * The layout tests (`layout.test.ts`) prove *where lanes are*; these prove that the
 * pixels drawn for a row agree with the lanes the layout reported, and with the row
 * height the list is laid out with. The failure this file is here to prevent is a
 * graph that looks right in isolation and drifts one pixel per row against real data.
 */
import { describe, expect, it } from "vitest";
import { layoutGraph, type GraphRow, type LaneRef } from "@refyard/git-graph";
import {
  DEFAULT_METRICS,
  edgePath,
  gutterWidth,
  lanePaint,
  laneX,
  rowCenterY,
  rowGeometry,
  type GraphMetrics,
} from "@refyard/git-ui/lib/geometry";

const metrics: GraphMetrics = {
  ...DEFAULT_METRICS,
  rowHeight: 24,
  laneWidth: 10,
};

function ref(id: string, color = "lane-1"): LaneRef {
  return { id, color };
}

/** A hand-built row, so a case can state exactly the lane state it is about. */
function row(input: {
  id: string;
  laneIndex: number;
  laneColor?: string;
  inputLanes: readonly LaneRef[];
  outputLanes: readonly LaneRef[];
}): GraphRow {
  return {
    id: input.id,
    parentIds: [],
    refNames: [],
    laneIndex: input.laneIndex,
    laneColor: input.laneColor ?? "lane-1",
    inputLanes: input.inputLanes,
    outputLanes: input.outputLanes,
    isMerge: false,
    isRoot: false,
  };
}

describe("lane positions", () => {
  it("centres lane 0 inside the left padding and keeps lanes one lane-width apart", () => {
    expect(laneX(0, metrics)).toBe(metrics.lanePadding + metrics.radius);
    expect(laneX(1, metrics) - laneX(0, metrics)).toBe(metrics.laneWidth);
  });

  it("places a row centre at half a row height below its own top edge", () => {
    // If this drifts from the list's row height, every circle moves off its text row —
    // the classic "graph is fine, list is fine, together they are wrong" bug.
    expect(rowCenterY(0, metrics)).toBe(metrics.rowHeight / 2);
    expect(rowCenterY(3, metrics)).toBe(
      3 * metrics.rowHeight + metrics.rowHeight / 2,
    );
  });

  it("widens the gutter as lanes are added, never narrowing it", () => {
    const one = gutterWidth(1, metrics);
    const four = gutterWidth(4, metrics);
    expect(four).toBeGreaterThan(one);
    expect(four - one).toBe(3 * metrics.laneWidth);
    // A single lane still has room for its circle on both sides.
    expect(one).toBeGreaterThanOrEqual(
      2 * (metrics.radius + metrics.lanePadding),
    );
  });
});

describe("edge paths", () => {
  it("draws a straight line when both endpoints share an x position", () => {
    expect(edgePath(10, 0, 10, 24)).toBe("M 10 0 L 10 24");
  });

  it("curves between different lanes with the control points on the midline", () => {
    // Leaving vertically and arriving vertically is what stops a merge curve from
    // overshooting the lane it is joining.
    expect(edgePath(10, 0, 20, 24)).toBe("M 10 0 C 10 12 20 12 20 24");
  });

  it("is byte-identical for the same input, so fixtures and diffs stay stable", () => {
    expect(edgePath(10.33333, 0, 20, 24)).toBe(edgePath(10.33333, 0, 20, 24));
    expect(edgePath(10.33333, 0, 20, 24)).toBe(
      "M 10.33 0 C 10.33 12 20 12 20 24",
    );
  });
});

describe("row geometry", () => {
  it("draws a lane waiting for another commit as a straight pass-through with its own colour", () => {
    const geometry = rowGeometry(
      row({
        id: "b",
        laneIndex: 0,
        inputLanes: [ref("c", "lane-2"), ref("b", "lane-3")],
        outputLanes: [ref("c", "lane-2"), ref("x", "lane-3")],
      }),
      0,
      metrics,
    );
    const first = geometry.segments[0];
    expect(first?.kind).toBe("lane");
    // The unrelated lane must not be repainted with the row's colour, which is how a
    // graph ends up showing two branches as one.
    expect(first?.paint).toBe(lanePaint("lane-2"));
    expect(first?.path).toBe(
      `M ${laneX(0, metrics)} 0 L ${laneX(0, metrics)} ${metrics.rowHeight}`,
    );
  });

  it("brings a converging lane into the circle and leaves the first parent straight down", () => {
    const geometry = rowGeometry(
      row({
        id: "m",
        laneIndex: 0,
        inputLanes: [ref("m", "lane-1"), ref("m", "lane-4")],
        outputLanes: [ref("p", "lane-1")],
      }),
      1,
      metrics,
    );
    const cx = laneX(0, metrics);
    const cy = rowCenterY(1, metrics);
    const kinds = geometry.segments.map((segment) => segment.kind);
    expect(kinds).toEqual(["lane", "merge", "lane"]);
    expect(geometry.segments[1]?.path).toBe(
      edgePath(laneX(1, metrics), metrics.rowHeight, cx, cy),
    );
    expect(geometry.segments[2]?.path).toBe(
      `M ${cx} ${cy} L ${cx} ${2 * metrics.rowHeight}`,
    );
  });

  it("starts an extra parent's lane with a branch curve from the circle", () => {
    const geometry = rowGeometry(
      row({
        id: "m",
        laneIndex: 0,
        inputLanes: [ref("m", "lane-1")],
        outputLanes: [ref("p1", "lane-1"), ref("p2", "lane-2")],
      }),
      2,
      metrics,
    );
    const branch = geometry.segments.find(
      (segment) => segment.kind === "branch",
    );
    expect(branch?.path).toBe(
      edgePath(
        laneX(0, metrics),
        rowCenterY(2, metrics),
        laneX(1, metrics),
        3 * metrics.rowHeight,
      ),
    );
  });

  it("draws no outgoing segment for a root commit", () => {
    const geometry = rowGeometry(
      row({ id: "r", laneIndex: 0, inputLanes: [ref("r")], outputLanes: [] }),
      0,
      metrics,
    );
    expect(geometry.segments).toHaveLength(1);
    expect(geometry.segments[0]?.kind).toBe("lane");
  });

  it("keeps a lane alive when its parent was not loaded", () => {
    // The paging case: an unresolved parent stays a lane instead of becoming a root.
    // Dropping the segment here is what makes "load more" visually detach from history.
    const geometry = rowGeometry(
      row({
        id: "page-last",
        laneIndex: 0,
        inputLanes: [ref("page-last")],
        outputLanes: [ref("not-loaded-yet")],
      }),
      0,
      metrics,
    );
    const downward = geometry.segments.filter((segment) =>
      segment.path.endsWith(` ${metrics.rowHeight}`),
    );
    expect(downward).toHaveLength(1);
  });

  it("lays out a real merged history with every lane accounted for once per row", () => {
    const layout = layoutGraph([
      { id: "c", parentIds: ["b1", "b2"] },
      { id: "b1", parentIds: ["a"] },
      { id: "b2", parentIds: ["a"] },
      { id: "a", parentIds: [] },
    ]);
    expect(layout.rows).toHaveLength(4);
    for (const [index, graphRow] of layout.rows.entries()) {
      const geometry = rowGeometry(graphRow, index, metrics);
      const passThrough = graphRow.inputLanes.filter((lane, laneIndex) => {
        const output = graphRow.outputLanes[laneIndex];
        return output !== undefined && output.id === lane.id;
      }).length;
      const expected =
        graphRow.inputLanes.length + graphRow.outputLanes.length - passThrough;
      expect(geometry.segments).toHaveLength(expected);
      expect(geometry.circle.cy).toBe(rowCenterY(index, metrics));
      expect(geometry.circle.paint).toBe(lanePaint(graphRow.laneColor));
    }
  });

  it("falls back to lane 1 for a colour token it does not know", () => {
    // A host that adds palette entries must not blank out the graph.
    expect(lanePaint("lane-99")).toBe(lanePaint("lane-1"));
  });
});

describe("shifted lanes", () => {
  const shiftedRow = row({
    id: "m",
    laneIndex: 0,
    inputLanes: [ref("m", "lane-current"), ref("o", "lane-2")],
    outputLanes: [
      ref("left", "lane-current"),
      ref("side", "lane-5"),
      ref("o", "lane-2"),
    ],
  });

  it("draws a surviving lane that shifted sideways as a pass-through curve, not a merge", () => {
    // The layout opens `side` between the trunk and `o`; `o` keeps its identity but
    // moves one slot right. Matching by index would bend `o` into this row's circle —
    // a merge the repository does not contain.
    const geometry = rowGeometry(shiftedRow, 3, metrics);
    const oIn = laneX(1, metrics);
    const oOut = laneX(2, metrics);
    const oSegments = geometry.segments.filter(
      (segment) => segment.paint === lanePaint("lane-2"),
    );
    expect(oSegments).toHaveLength(1);
    expect(oSegments[0]?.path).toBe(
      edgePath(oIn, 3 * metrics.rowHeight, oOut, 4 * metrics.rowHeight),
    );
  });

  it("draws the branch lane that opened beside the trunk from the circle to the bottom", () => {
    const geometry = rowGeometry(shiftedRow, 3, metrics);
    const branch = geometry.segments.find(
      (segment) => segment.paint === lanePaint("lane-5"),
    );
    expect(branch?.kind).toBe("branch");
    expect(branch?.path).toBe(
      edgePath(
        laneX(0, metrics),
        rowCenterY(3, metrics),
        laneX(1, metrics),
        4 * metrics.rowHeight,
      ),
    );
  });
});
