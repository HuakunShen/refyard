/**
 * Laying out several pages of history as one continuous graph.
 *
 * The host serves history in pages bound to the tips they started with, so a client that
 * follows a repository's history receives *pages*, not one list. The layout therefore has
 * to be a fold across pages: page two is laid out with page one's final lanes as its
 * starting state, which is what stops a merge line from restarting at lane 0 halfway down
 * the list.
 *
 * A page boundary is invisible in the result: `layoutPages([a, b])` and `layoutGraph(a ++ b)`
 * produce identical rows, which is the property the tests pin down. Keeping this here — in
 * the host-free package — means the browser, a native host and a test all continue a graph
 * the same way.
 */
import { layoutGraph, type GraphCommit, type LayoutOptions } from "./layout.js";
import type { GraphRow, LaneRef } from "./types.js";

export interface PagesLayoutResult {
  readonly rows: readonly GraphRow[];
  /** Highest lane index used across all pages, for sizing one column. */
  readonly laneCount: number;
}

export function layoutPages(
  pages: readonly (readonly GraphCommit[])[],
  options: LayoutOptions = {},
): PagesLayoutResult {
  const rows: GraphRow[] = [];
  let continuation: readonly LaneRef[] = options.continuation ?? [];
  let laneCount = 0;

  for (const page of pages) {
    const layout = layoutGraph(page, { ...options, continuation });
    rows.push(...layout.rows);
    laneCount = Math.max(laneCount, layout.laneCount);
    continuation = layout.continuation;
  }

  return { rows, laneCount };
}
