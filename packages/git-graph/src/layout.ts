/**
 * Host-free commit DAG layout with stable parallel tracks. A live track keeps its
 * horizontal slot until it converges; only a newly opened track can reuse a hole.
 * Continuation carries the slots across pages, so loading history cannot move a
 * surviving branch. Additional parents already on screen join their existing track.
 */
import type { GraphRow, LaneColor, LaneRef } from "./types.js";

export interface GraphCommit {
  /** Opaque commit id; compared for equality only. */
  readonly id: string;
  /** Parents in Git's order: first parent first. */
  readonly parentIds: readonly string[];
  /** Ref names pointing at this commit, for colour selection only. */
  readonly refNames?: readonly string[];
}

export interface LayoutOptions {
  /** Lane colours, in order. At least one; the cursor cycles through them. */
  readonly palette?: readonly LaneColor[];
  /**
   * The colour a commit's own ref implies, when it has one.
   *
   * Returning undefined means "inherit or pick from the palette", which is what
   * keeps a branch's colour stable along its lane: the inheritance path is the
   * common case, and only new lanes draw a fresh colour.
   */
  readonly colorForRef?: (commit: GraphCommit) => LaneColor | undefined;
  /** Colour for a commit with no ref and no lane to inherit from. */
  readonly defaultColor?: LaneColor;
  /**
   * Lanes entering the first row.
   *
   * This is how a second page continues the first: pass the previous page's
   * `outputLanes` and the lanes line up exactly instead of restarting at zero.
   */
  readonly continuation?: readonly LaneRef[];
}

export interface LayoutResult {
  readonly rows: readonly GraphRow[];
  /** The lanes to pass as `continuation` for the next page. */
  readonly continuation: readonly LaneRef[];
  /** Highest lane index used, so a renderer can size its canvas. */
  readonly laneCount: number;
}

export const DEFAULT_PALETTE: readonly LaneColor[] = [
  "lane-1",
  "lane-2",
  "lane-3",
  "lane-4",
  "lane-5",
  "lane-6",
  "lane-7",
  "lane-8",
];

/**
 * Lay out one page of commits.
 *
 * The function is total and deterministic: the same input always produces the same
 * output, and an unknown parent (one that has not been loaded) is kept as a lane
 * rather than dropped, so pagination cannot silently cut a line.
 */
export function layoutGraph(
  commits: readonly GraphCommit[],
  options: LayoutOptions = {},
): LayoutResult {
  const palette = options.palette ?? DEFAULT_PALETTE;
  const defaultColor = options.defaultColor ?? palette[0] ?? "lane-1";
  let previousOut = (options.continuation ?? []).map((lane, index) => ({
    ...lane,
    position: lane.position ?? index,
  }));
  const rows: GraphRow[] = [];
  let laneCount = previousOut.reduce(
    (count, lane) => Math.max(count, lane.position + 1),
    0,
  );

  for (const commit of commits) {
    const inputLanes = previousOut.map((lane) => ({ ...lane }));
    const awaited = inputLanes.find((lane) => lane.id === commit.id);
    const occupied = new Set(inputLanes.map((lane) => lane.position));
    const freeSlot = () => {
      let position = 0;
      while (occupied.has(position)) position += 1;
      occupied.add(position);
      return position;
    };
    const laneIndex = awaited?.position ?? freeSlot();
    const tipColor = commit.refNames?.some(
      (name) =>
        name.startsWith("refs/heads/") || name.startsWith("refs/remotes/"),
    )
      ? options.colorForRef?.(commit)
      : undefined;
    const laneColor =
      tipColor ??
      awaited?.color ??
      options.colorForRef?.(commit) ??
      palette[laneIndex % palette.length] ??
      defaultColor;
    // Removing converging tracks does not compact the surviving slots.
    const outputLanes = inputLanes.filter((lane) => lane.id !== commit.id);
    const firstParent = commit.parentIds[0];
    if (firstParent !== undefined) {
      outputLanes.push({
        id: firstParent,
        color: laneColor,
        position: laneIndex,
      });
    }
    for (const parentId of commit.parentIds.slice(1)) {
      if (outputLanes.some((lane) => lane.id === parentId)) continue;
      const position = freeSlot();
      outputLanes.push({
        id: parentId,
        color: palette[position % palette.length] ?? defaultColor,
        position,
      });
    }
    outputLanes.sort((a, b) => a.position - b.position);
    rows.push({
      id: commit.id,
      parentIds: [...commit.parentIds],
      refNames: [...(commit.refNames ?? [])],
      laneIndex,
      laneColor,
      inputLanes,
      outputLanes,
      isMerge: commit.parentIds.length > 1,
      isRoot: commit.parentIds.length === 0,
    });
    laneCount = Math.max(
      laneCount,
      laneIndex + 1,
      ...outputLanes.map((lane) => lane.position + 1),
    );
    previousOut = outputLanes;
  }
  return {
    rows,
    continuation: previousOut.map((lane) => ({ ...lane })),
    laneCount,
  };
}

/**
 * A simple, stable colour choice based on this service's palette.
 *
 * It colours refs — not lanes and not branches — because that is what a user reads:
 * the same ref keeps the same colour across pages, and a commit with no ref inherits
 * its lane's colour instead of being given a new one on every render.
 */
export function refColorFor(
  refNames: readonly string[],
  palette: readonly LaneColor[] = DEFAULT_PALETTE,
): LaneColor | undefined {
  if (refNames.length === 0 || palette.length === 0) {
    return undefined;
  }
  // Sorted and prefix-stripped so `refs/heads/main` and `main` agree.
  const key = [...refNames].sort()[0] ?? "";
  const normalized = key.replace(/^refs\/(heads|remotes|tags)\//, "");
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}
