/**
 * Pixel geometry for the commit graph.
 *
 * `@refyard/git-graph` decides *where lanes are* — indices, colours, continuation.
 * This module turns that decision into the segments an SVG draws, and nothing else:
 * no component, no DOM, no store. It lives apart from the layout because it is the
 * part that has to agree with the list's fixed row height, and the only way to keep
 * two things in agreement is to have one number that both are given.
 *
 * A row is drawn from three kinds of segment, and every lane entering or leaving a
 * row is accounted for exactly once:
 *
 * - a lane waiting for a different commit passes straight through from the top edge
 *   to the bottom edge;
 * - a lane waiting for *this* commit comes in from the top edge to the circle;
 * - a lane leaving towards a parent goes from the circle to the bottom edge.
 *
 * Curves are cubic with both control points on the horizontal midline, which makes a
 * line leave a circle vertically and arrive at a lane vertically. That is what keeps
 * a merge from looking like it overshoots its lane.
 */
import type { GraphRow } from "@refyard/git-graph";

export interface GraphMetrics {
  /** Row height in pixels. The virtualized list uses this same value. */
  readonly rowHeight: number;
  /** Horizontal distance between lane centres. */
  readonly laneWidth: number;
  /** Padding before the first lane and after the last. */
  readonly lanePadding: number;
  /** Commit circle radius. */
  readonly radius: number;
}

export const DEFAULT_METRICS: GraphMetrics = {
  rowHeight: 28,
  laneWidth: 14,
  lanePadding: 10,
  radius: 4.5,
};

export type SegmentKind = "lane" | "merge" | "branch";

export interface GraphSegment {
  /** SVG path data in row-local coordinates, already translated by the caller's `<g>`. */
  readonly path: string;
  /** A CSS paint value, e.g. `var(--color-lane-3)`. */
  readonly paint: string;
  readonly kind: SegmentKind;
}

export interface GraphRowGeometry {
  readonly circle: {
    readonly cx: number;
    readonly cy: number;
    readonly paint: string;
  };
  readonly segments: readonly GraphSegment[];
}

/** Centre x of a lane index. */
export function laneX(
  index: number,
  metrics: GraphMetrics = DEFAULT_METRICS,
): number {
  return metrics.lanePadding + metrics.radius + index * metrics.laneWidth;
}

/** Centre y of a row index, using the same row height the list is laid out with. */
export function rowCenterY(
  index: number,
  metrics: GraphMetrics = DEFAULT_METRICS,
): number {
  return index * metrics.rowHeight + metrics.rowHeight / 2;
}

/** Width the graph column needs for `laneCount` lanes. */
export function gutterWidth(
  laneCount: number,
  metrics: GraphMetrics = DEFAULT_METRICS,
): number {
  const last = Math.max(laneCount - 1, 0);
  return laneX(last, metrics) + metrics.radius + metrics.lanePadding;
}

/**
 * One edge between two points.
 *
 * A straight segment when the x positions match (a lane continuing through, or a first
 * parent in the same lane); a cubic curve otherwise. Numbers are rounded to two
 * decimals so a row's path is stable across renders and fixtures do not drift.
 */
export function edgePath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string {
  if (x0 === x1) {
    return `M ${format(x0)} ${format(y0)} L ${format(x1)} ${format(y1)}`;
  }
  const midY = (y0 + y1) / 2;
  return (
    `M ${format(x0)} ${format(y0)} ` +
    `C ${format(x0)} ${format(midY)} ${format(x1)} ${format(midY)} ${format(x1)} ${format(y1)}`
  );
}

/**
 * Everything one row draws, in row-local coordinates (the caller translates by index).
 *
 * Lanes are matched between the row's input and output **by id, not by index**: the
 * layout opens a branch's lane beside its parent's, so a surviving lane can shift one
 * slot sideways across a row. Matching by index would draw that shift as a merge into
 * this row's commit — a line the data does not contain. The id match gives the three
 * segment kinds a row can have:
 *
 * - a lane whose id survives into the output passes through, straight when it keeps
 *   its slot and a shallow curve when it shifted;
 * - a lane waiting for *this* commit (id === row id) ends at the circle;
 * - an output lane no input lane claims opened at this row, drawn from the circle to
 *   the bottom edge.
 */
export function rowGeometry(
  row: GraphRow,
  index: number,
  metrics: GraphMetrics = DEFAULT_METRICS,
): GraphRowGeometry {
  const cx = laneX(row.laneIndex, metrics);
  const cy = rowCenterY(index, metrics);
  const top = index * metrics.rowHeight;
  const bottom = top + metrics.rowHeight;
  const segments: GraphSegment[] = [];

  // One output slot can be claimed by at most one input lane, so a degenerate commit
  // that lists one parent twice still draws both of its lines.
  const claimed = new Set<number>();
  const outputSlotOf = (id: string): number | undefined => {
    for (let slot = 0; slot < row.outputLanes.length; slot += 1) {
      if (row.outputLanes[slot]?.id === id && !claimed.has(slot)) {
        return slot;
      }
    }
    return undefined;
  };

  row.inputLanes.forEach((lane, laneIndex) => {
    const x = laneX(laneIndex, metrics);
    if (lane.id === row.id) {
      // This lane was waiting for the commit: it ends at the circle, whether it is
      // the lane that continues as the first parent or one that converges here.
      segments.push({
        path: edgePath(x, top, cx, cy),
        paint: lanePaint(lane.color),
        kind: x === cx ? "lane" : "merge",
      });
      return;
    }
    const outputSlot = outputSlotOf(lane.id);
    if (outputSlot === undefined) {
      // A live lane always continues; drawing a straight pass-through keeps the line
      // whole even if the layout ever hands over a row that drops one.
      segments.push({
        path: edgePath(x, top, x, bottom),
        paint: lanePaint(lane.color),
        kind: "lane",
      });
      return;
    }
    claimed.add(outputSlot);
    const xOut = laneX(outputSlot, metrics);
    segments.push({
      path: edgePath(x, top, xOut, bottom),
      paint: lanePaint(lane.color),
      kind: xOut === x ? "lane" : "merge",
    });
  });

  row.outputLanes.forEach((lane, laneIndex) => {
    if (claimed.has(laneIndex)) {
      return;
    }
    const x = laneX(laneIndex, metrics);
    segments.push({
      path: edgePath(cx, cy, x, bottom),
      paint: lanePaint(lane.color),
      kind: x === cx ? "lane" : "branch",
    });
  });

  return { circle: { cx, cy, paint: lanePaint(row.laneColor) }, segments };
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const LANE_PAINT: Readonly<Record<string, string>> = {
  "lane-current": "var(--color-lane-current, currentColor)",
  "lane-1": "var(--color-lane-1, currentColor)",
  "lane-2": "var(--color-lane-2, currentColor)",
  "lane-3": "var(--color-lane-3, currentColor)",
  "lane-4": "var(--color-lane-4, currentColor)",
  "lane-5": "var(--color-lane-5, currentColor)",
  "lane-6": "var(--color-lane-6, currentColor)",
  "lane-7": "var(--color-lane-7, currentColor)",
  "lane-8": "var(--color-lane-8, currentColor)",
};

/**
 * Resolve a lane colour token to a CSS paint value.
 *
 * The palette lives in CSS (see `styles.css`) rather than in this module, so a host
 * can restyle lanes — including for a dark theme — without touching the geometry. An
 * unknown token falls back to lane 1 instead of throwing: a graph is not the place to
 * discover that a palette changed.
 */
export function lanePaint(token: string): string {
  return LANE_PAINT[token] ?? "var(--color-lane-1, currentColor)";
}
