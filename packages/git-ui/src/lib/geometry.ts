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
  radius: 4,
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

/** Everything one row draws, in row-local coordinates (the caller translates by index). */
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

  // A lane that is present at the same index on both sides is waiting for somebody
  // else: it passes through untouched and keeps its own colour.
  const passesThrough = (laneIndex: number): boolean => {
    const input = row.inputLanes[laneIndex];
    const output = row.outputLanes[laneIndex];
    return (
      input !== undefined && output !== undefined && input.id === output.id
    );
  };

  row.inputLanes.forEach((lane, laneIndex) => {
    const x = laneX(laneIndex, metrics);
    if (passesThrough(laneIndex)) {
      segments.push({
        path: edgePath(x, top, x, bottom),
        paint: lanePaint(lane.color),
        kind: "lane",
      });
      return;
    }
    // Otherwise this lane reaches this row's commit — including a lane that converges
    // here from the side, which is why the circle is the endpoint either way.
    segments.push({
      path: edgePath(x, top, cx, cy),
      paint: lanePaint(lane.color),
      kind: x === cx ? "lane" : "merge",
    });
  });

  row.outputLanes.forEach((lane, laneIndex) => {
    if (passesThrough(laneIndex)) {
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
