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
  /** Lane stroke width, scaled with the row so a roomy graph is not drawn with hairlines. */
  readonly lineWidth: number;
}

/**
 * How much room a row gets.
 *
 * GitKraken's default sits at the roomy end of this scale — roughly 43px rows, 26px
 * avatar nodes and 3px lanes — which is what makes its graph read as calm instead of
 * dense. The proportions are held constant here (lane stroke ≈ 7% of the row, avatar
 * ≈ 30%); only the absolute size changes.
 */
export type RowDensity = "compact" | "comfortable" | "roomy";

export const ROW_DENSITIES: readonly RowDensity[] = [
  "compact",
  "comfortable",
  "roomy",
];

const DENSITY_METRICS: Record<RowDensity, GraphMetrics> = {
  compact: {
    rowHeight: 28,
    laneWidth: 14,
    lanePadding: 10,
    radius: 4.5,
    lineWidth: 2,
  },
  comfortable: {
    rowHeight: 36,
    laneWidth: 20,
    lanePadding: 12,
    radius: 6,
    lineWidth: 2.5,
  },
  roomy: {
    rowHeight: 44,
    laneWidth: 26,
    lanePadding: 14,
    radius: 7.5,
    lineWidth: 3,
  },
};

export function isRowDensity(value: string | null): value is RowDensity {
  return value !== null && (ROW_DENSITIES as readonly string[]).includes(value);
}

export function densityMetrics(density: RowDensity): GraphMetrics {
  return DENSITY_METRICS[density];
}

export const DEFAULT_METRICS: GraphMetrics = DENSITY_METRICS.roomy;

/**
 * Avatar radius for a row: GitKraken's 26px photo in a 43px row is a 0.30 ratio, with
 * floors and ceilings so a compact graph still shows a face and a roomy one does not
 * turn the photo into the row.
 */
export function avatarRadiusFor(metrics: GraphMetrics): number {
  return Math.max(6, Math.min(14, metrics.rowHeight * 0.3));
}

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

/** Below these a squeezed graph stops shrinking and lets the column clip it. */
const MIN_LANE_WIDTH = 6;
const MIN_RADIUS = 2.5;
const MIN_LINE_WIDTH = 1.25;
const MIN_LANE_PADDING = 6;

/**
 * Metrics that squeeze `laneCount` lanes into `availableWidth`, GitKraken-style.
 *
 * At or above the natural gutter the base metrics hold unchanged. Below it the whole
 * span scales together — padding, lane spacing, dots and strokes — until the lanes fit,
 * so a narrow Graph column compresses its graph instead of forcing the column wide or
 * dropping lanes. Padding is part of the span rather than a fixed inset: two 12px
 * insets are a quarter of a 100px column, and holding them fixed is what made a narrow
 * column overflow by the very pixels it was trying to save.
 *
 * The floors keep a maximally squeezed graph legible; past them the column simply
 * clips, which is what GitKraken does too.
 */
export function compressedMetrics(
  laneCount: number,
  availableWidth: number,
  base: GraphMetrics = DEFAULT_METRICS,
): GraphMetrics {
  if (laneCount <= 1 || availableWidth >= gutterWidth(laneCount, base)) {
    return base;
  }
  const last = laneCount - 1;
  const span = 2 * base.lanePadding + 2 * base.radius + last * base.laneWidth;
  const scale = Math.min(
    Math.max(
      availableWidth / span,
      MIN_LANE_WIDTH / base.laneWidth,
    ),
    1,
  );
  return {
    ...base,
    lanePadding: Math.max(MIN_LANE_PADDING, base.lanePadding * scale),
    laneWidth: Math.max(MIN_LANE_WIDTH, base.laneWidth * scale),
    radius: Math.max(MIN_RADIUS, base.radius * scale),
    lineWidth: Math.max(MIN_LINE_WIDTH, base.lineWidth * scale),
  };
}

/**
 * The short horizontal line from a ref label into the graph, GitKraken-style.
 *
 * A branch or tag label lives in the column to the left of the graph, so without this
 * the pill and the lane it names are two things a reader has to join up themselves.
 * GitKraken draws the join, and it is what makes a branch tip read as "this line starts
 * here". It runs from the column's left edge to the node's centre at the node's own y.
 */
export function refConnectorPath(
  laneIndex: number,
  index: number,
  metrics: GraphMetrics = DEFAULT_METRICS,
): string {
  const cx = laneX(laneIndex, metrics);
  const cy = rowCenterY(index, metrics);
  return `M 0 ${format(cy)} L ${format(cx)} ${format(cy)}`;
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
