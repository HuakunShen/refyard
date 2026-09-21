/**
 * The stretch of history where the checked-out branch still owns its line.
 *
 * GitKraken tints these rows and paints the trunk in the branch's colour from HEAD
 * down, stopping where another branch's tip took the line over — the segment a user
 * reads as "what my branch adds". The layout (see `@refyard/git-graph`) recolours a
 * lane at every branch tip, so ownership here is exactly "the lane colour is still
 * the one HEAD's tip chose": walking first-parent links until the token changes
 * reproduces GitKraken's boundary without a second reachability read.
 *
 * Pure rows in, one answer out — no DOM, no store, so it tests without a browser.
 */
import type { GraphRow } from "@refyard/git-graph";

export interface HeadSegment {
  /** The lane colour token HEAD's tip chose, e.g. `lane-current`. */
  readonly token: string;
  /** The oids of the rows the segment covers, HEAD's own included. */
  readonly ids: ReadonlySet<string>;
}

/**
 * Walk first parents from `rows[0]` while the lane colour is unchanged.
 *
 * `rows[0]` must be HEAD — the caller passes the unfiltered page list, which starts
 * there. A parent outside the loaded rows ends the walk (a page boundary is not an
 * ownership change), and a recoloured row ends it (that is the boundary itself).
 */
export function headSegmentFor(rows: readonly GraphRow[]): HeadSegment | null {
  const head = rows[0];
  if (head === undefined) {
    return null;
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const token = head.laneColor;
  const ids = new Set<string>();
  let current: GraphRow | undefined = head;
  while (current !== undefined && current.laneColor === token) {
    ids.add(current.id);
    const parent: string | undefined = current.parentIds[0];
    current = parent === undefined ? undefined : byId.get(parent);
  }
  return { token, ids };
}
