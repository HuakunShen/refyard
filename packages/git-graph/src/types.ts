/**
 * Graph layout types.
 *
 * They are deliberately free of any rendering concern: no pixel, no SVG path, no
 * colour value beyond an opaque token. The renderer decides what a lane looks like;
 * this module only decides where lanes are, which is what makes the layout testable
 * without a DOM and reusable by another host.
 */

/** An opaque lane colour token. The meaning of `lane-3` belongs to the renderer. */
export type LaneColor = string;

/** One live track entering or leaving a row. Closed tracks leave reusable slots. */
export interface LaneRef {
  /** The commit this lane is waiting for. */
  readonly id: string;
  readonly color: LaneColor;
  /** Stable horizontal slot; omitted by legacy callers that use array indices. */
  readonly position?: number;
}

export interface GraphRow {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly refNames: readonly string[];
  /** Where this commit's circle is drawn. */
  readonly laneIndex: number;
  readonly laneColor: LaneColor;
  /** Lanes entering this row, from the row above. */
  readonly inputLanes: readonly LaneRef[];
  /** Lanes leaving this row, towards the row below. */
  readonly outputLanes: readonly LaneRef[];
  readonly isMerge: boolean;
  readonly isRoot: boolean;
}
