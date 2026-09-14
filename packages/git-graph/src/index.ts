/**
 * `@refyard/git-graph` — pure lane layout for the commit graph.
 *
 * No host, no DOM, no framework: the layout is a fold over an ordered commit list,
 * which is why it can be tested against fixtures, reused by another host, and
 * rendered by either SVG or a canvas without changing this code.
 */
export {
  layoutGraph,
  refColorFor,
  DEFAULT_PALETTE,
  type GraphCommit,
  type LayoutOptions,
  type LayoutResult,
} from "./layout.js";
export type { GraphRow, LaneColor, LaneRef } from "./types.js";
export { layoutPages, type PagesLayoutResult } from "./pages.js";
