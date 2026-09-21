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
  avatarRadiusFor,
  DEFAULT_METRICS,
  compressedMetrics,
  densityMetrics,
  edgePath,
  gutterWidth,
  isRowDensity,
  lanePaint,
  laneX,
  refConnectorPath,
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

describe("row density", () => {
  it("scales the row, the lanes, the dots and the strokes together", () => {
    // The failure this prevents: raising the row height alone, which leaves a roomy
    // list drawn with compact-width lanes and hairline strokes — the graph stops
    // matching the rows it is drawn against.
    const compact = densityMetrics("compact");
    const comfortable = densityMetrics("comfortable");
    const roomy = densityMetrics("roomy");
    for (const [small, large] of [
      [compact, comfortable],
      [comfortable, roomy],
    ] as const) {
      expect(large.rowHeight).toBeGreaterThan(small.rowHeight);
      expect(large.laneWidth).toBeGreaterThan(small.laneWidth);
      expect(large.radius).toBeGreaterThan(small.radius);
      expect(large.lineWidth).toBeGreaterThan(small.lineWidth);
      // The stroke stays around 7% of the row at every density: that ratio is what
      // keeps a roomy graph from looking like a compact one that was stretched.
      expect(large.lineWidth / large.rowHeight).toBeCloseTo(0.07, 1);
    }
  });

  it("draws an avatar at GitKraken's 30% of the row, within floors", () => {
    expect(avatarRadiusFor(densityMetrics("comfortable"))).toBeCloseTo(10.8, 5);
    expect(avatarRadiusFor(densityMetrics("roomy"))).toBeCloseTo(13.2, 5);
    // A compact row still shows a face; a row too short for one keeps the floor.
    expect(avatarRadiusFor({ ...densityMetrics("compact"), rowHeight: 8 })).toBe(
      6,
    );
  });

  it("recognises only the densities it defines", () => {
    expect(isRowDensity("roomy")).toBe(true);
    expect(isRowDensity("spacious")).toBe(false);
    expect(isRowDensity(null)).toBe(false);
  });

  it("ships the roomy default GitKraken's spacing asks for", () => {
    expect(DEFAULT_METRICS).toEqual(densityMetrics("roomy"));
    expect(DEFAULT_METRICS.rowHeight).toBe(44);
  });
});

describe("compressed metrics", () => {
  it("keeps the base metrics once the column fits the lanes", () => {
    const lanes = 4;
    expect(compressedMetrics(lanes, gutterWidth(lanes, metrics), metrics)).toBe(
      metrics,
    );
    expect(compressedMetrics(lanes, 10_000, metrics)).toBe(metrics);
    // A single lane never needs squeezing: the padding alone surrounds it.
    expect(compressedMetrics(1, 0, metrics)).toBe(metrics);
  });

  it("squeezes the lane spacing so every lane fits a narrow column", () => {
    // Real-world failure prevented: a user-narrowed graph column that either
    // forced the table wide again or silently dropped lanes would undo the
    // resize; GitKraken compresses the lanes instead, and so must we.
    const lanes = 6;
    const width = 60;
    const squeezed = compressedMetrics(lanes, width, metrics);
    expect(gutterWidth(lanes, squeezed)).toBeLessThanOrEqual(width);
    // Squeezing is proportionate: lanes stay evenly spaced and dots stay round.
    expect(squeezed.laneWidth).toBeLessThan(metrics.laneWidth);
    expect(squeezed.radius).toBeLessThan(metrics.radius);
    // The padding is part of the span, so it shrinks too — held fixed it would be
    // the pixels that overflow.
    expect(squeezed.lanePadding).toBeLessThan(metrics.lanePadding);
    // Evenly spaced: compared with a tolerance, because a lane centre is a sum of
    // floats and the difference of two sums is not exactly the addend.
    expect(laneX(3, squeezed) - laneX(2, squeezed)).toBeCloseTo(
      squeezed.laneWidth,
      9,
    );
    expect(laneX(2, squeezed) - laneX(1, squeezed)).toBeCloseTo(
      squeezed.laneWidth,
      9,
    );
    // The row height is the list's layout and must never move.
    expect(squeezed.rowHeight).toBe(metrics.rowHeight);
  });

  it("scales the padding with the span, with a floor of its own", () => {
    // At the lane-width floor the padding has already scaled by the same factor, so
    // it is the base padding times that factor, not the base padding.
    const floorScale = 6 / metrics.laneWidth;
    const squeezed = compressedMetrics(20, 40, metrics);
    expect(squeezed.lanePadding).toBeCloseTo(metrics.lanePadding * floorScale, 9);
    // A roomy base scales further down than its own floor allows: 14px insets at the
    // lane floor would be 3.2px, which is not an inset any more.
    const roomy = compressedMetrics(
      20,
      40,
      densityMetrics("roomy"),
    );
    expect(roomy.lanePadding).toBe(6);
  });

  it("stops shrinking at a legible floor and lets the column clip past it", () => {
    const squeezed = compressedMetrics(20, 40, metrics);
    // The lane-width floor sets the scale; the radius rides it unless it would
    // dip under its own floor.
    const floorScale = 6 / metrics.laneWidth;
    expect(squeezed.laneWidth).toBe(6);
    expect(squeezed.radius).toBe(
      Math.max(2.5, metrics.radius * floorScale),
    );
    // Past the floor the gutter may exceed the column; the SVG clips, which is
    // exactly what a hard-squeezed GitKraken graph does.
    expect(gutterWidth(20, squeezed)).toBeGreaterThan(40);
  });
});

describe("ref connectors", () => {
  it("runs from the column's left edge to the node's centre on the node's row", () => {
    // The failure this prevents: a branch pill in the BRANCH/TAG column and its lane in
    // the graph column reading as two unrelated things. GitKraken draws the join.
    expect(refConnectorPath(2, 3, metrics)).toBe(
      `M 0 ${rowCenterY(3, metrics)} L ${laneX(2, metrics)} ${rowCenterY(3, metrics)}`,
    );
  });

  it("is horizontal, so it never looks like an edge of the graph", () => {
    const path = refConnectorPath(1, 5, metrics);
    const [, startY] = path.split(" ").slice(1, 3);
    const endY = path.split(" ").at(-1);
    expect(endY).toBe(startY);
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
