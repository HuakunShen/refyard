/**
 * Commit-graph lane layout, as a pure fold over an ordered commit list.
 *
 * The algorithm is the one described in `docs/research/2026-09-14-vscode-graph-findings.md`,
 * reimplemented in TypeScript with no framework and no DOM. It is a single pass in
 * topological order, and it produces, for every row, the lanes entering it and the
 * lanes leaving it — which is what makes each row renderable on its own, without a
 * shared canvas or a second pass.
 *
 * Three properties are worth stating because the renderer depends on them:
 *
 * - **Lane index is a position, not an identity.** A branch is a *ref name*; a lane
 *   is just a slot in one row. Two rows may draw different branches in the same lane,
 *   and the UI must never label a lane with a branch name.
 * - **A lane's identity survives index changes.** Lanes close when they converge and
 *   new lanes open directly beside the lane they branch from, so a surviving lane can
 *   shift sideways across one row. Renderers must therefore match lanes by *id*
 *   between a row's input and output, never by index — `rowGeometry` in the UI
 *   package does exactly that.
 * - **Continuation is explicit.** The last row's `outputLanes` is the state to draw
 *   under a "load more" row, and an unresolved parent stays in the array as a
 *   placeholder until it appears — a page boundary therefore never breaks a line.
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
  // The cursor is function-scoped, exactly like the reference implementation: it
  // advances across the whole run so consecutive new lanes get different colours.
  let paletteCursor = -1;
  let previousOut: LaneRef[] = (options.continuation ?? []).map((lane) => ({
    ...lane,
  }));
  const rows: GraphRow[] = [];
  let laneCount = previousOut.length;

  for (const commit of commits) {
    // 1. Copy the incoming lanes; never mutate the previous row's array.
    const inputLanes: LaneRef[] = previousOut.map((lane) => ({ ...lane }));
    const outputLanes: LaneRef[] = [];
    let firstParentPlaced = false;
    /** Where the commit's own lane sits in `outputLanes` (-1 until placed). */
    let ownLaneOutputIndex = -1;

    // 2. The lane waiting for this commit becomes its first parent, in place, so the
    //    lane keeps its index, colour and identity down the row. The colour is kept
    //    unconditionally: a branch's line is coloured once, when the lane opens at
    //    that branch's tip, and a ref met along the way — a remote-tracking twin, a
    //    tag — must not recolor the rest of the line. Any other lane waiting for the
    //    same commit is a convergence: it closes here rather than being duplicated.
    if (commit.parentIds.length > 0) {
      for (const lane of inputLanes) {
        if (lane.id === commit.id) {
          if (!firstParentPlaced) {
            outputLanes.push({
              id: commit.parentIds[0] ?? "",
              color: lane.color,
            });
            ownLaneOutputIndex = outputLanes.length - 1;
            firstParentPlaced = true;
          }
          continue;
        }
        outputLanes.push({ ...lane });
      }
    }

    // 3. Additional parents (a merge or an octopus) open their lanes directly next to
    //    the lane they branch from — GitKraken-style adjacency, which keeps a branch's
    //    line short and its curve into the trunk tight instead of sweeping across every
    //    lane to the right edge. When this commit opened its own new lane (it was not
    //    awaited), there is no adjacent slot, so the parents append at the right edge.
    let inserted = 0;
    const start = firstParentPlaced ? 1 : 0;
    for (let index = start; index < commit.parentIds.length; index += 1) {
      const parentId = commit.parentIds[index];
      if (parentId === undefined) {
        continue;
      }
      let color: LaneColor | undefined;
      if (index === 0) {
        color = options.colorForRef?.(commit);
      } else {
        const parent = commits.find((candidate) => candidate.id === parentId);
        color =
          parent === undefined ? undefined : options.colorForRef?.(parent);
      }
      if (color === undefined) {
        paletteCursor = (paletteCursor + 1) % palette.length;
        color = palette[paletteCursor] ?? defaultColor;
      }
      const lane: LaneRef = { id: parentId, color };
      if (ownLaneOutputIndex !== -1) {
        outputLanes.splice(ownLaneOutputIndex + 1 + inserted, 0, lane);
        inserted += 1;
      } else {
        outputLanes.push(lane);
      }
    }

    // 4. The circle: this commit's own lane, or a new one to the right of everything
    //    currently drawn.
    const inputIndex = inputLanes.findIndex((lane) => lane.id === commit.id);
    const laneIndex = inputIndex !== -1 ? inputIndex : inputLanes.length;
    const laneColor =
      laneIndex < outputLanes.length
        ? (outputLanes[laneIndex]?.color ?? defaultColor)
        : laneIndex < inputLanes.length
          ? (inputLanes[laneIndex]?.color ?? defaultColor)
          : defaultColor;

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
      inputLanes.length,
      outputLanes.length,
      laneIndex + 1,
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
