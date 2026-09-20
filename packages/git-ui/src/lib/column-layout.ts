/**
 * Layout state for the history table's columns: widths, visibility, persistence.
 *
 * The commit-message column is not in here — it is the flexible remainder of
 * the row, the one column that always exists. Everything else can be resized
 * (within per-column limits) and hidden, and both survive a reload through the
 * browser's localStorage. Parsing is defensive on purpose: a stored value was
 * written by an older build or a curious hand, and the table must render the
 * default layout rather than crash or accept unknown column ids.
 */

export type HistoryColumnId = "refs" | "graph" | "author" | "date" | "sha";

export const HISTORY_COLUMN_IDS: readonly HistoryColumnId[] = [
  "refs",
  "graph",
  "author",
  "date",
  "sha",
];

export interface ColumnLimits {
  readonly min: number;
  readonly max: number;
}

export const columnLimits: Record<HistoryColumnId, ColumnLimits> = {
  refs: { min: 80, max: 400 },
  graph: { min: 56, max: 600 },
  author: { min: 80, max: 320 },
  date: { min: 140, max: 320 },
  sha: { min: 56, max: 120 },
};

const DEFAULT_WIDTHS: Record<HistoryColumnId, number> = {
  refs: 150,
  graph: 120,
  author: 110,
  date: 150,
  sha: 70,
};

export interface HistoryColumnState {
  readonly widths: Readonly<Record<HistoryColumnId, number>>;
  readonly hidden: readonly HistoryColumnId[];
}

export function defaultColumnState(): HistoryColumnState {
  return { widths: { ...DEFAULT_WIDTHS }, hidden: [] };
}

/** Clamp a width to the column's limits, never below a caller-supplied floor. */
export function clampColumnWidth(
  id: HistoryColumnId,
  width: number,
  floor: number = columnLimits[id].min,
): number {
  if (!Number.isFinite(width)) {
    return Math.max(floor, columnLimits[id].min);
  }
  return Math.max(Math.min(Math.round(width), columnLimits[id].max), floor);
}

export function resizeColumn(
  state: HistoryColumnState,
  id: HistoryColumnId,
  width: number,
  floor?: number,
): HistoryColumnState {
  return {
    ...state,
    widths: { ...state.widths, [id]: clampColumnWidth(id, width, floor) },
  };
}

export function toggleColumn(
  state: HistoryColumnState,
  id: HistoryColumnId,
): HistoryColumnState {
  return {
    ...state,
    hidden: state.hidden.includes(id)
      ? state.hidden.filter((entry) => entry !== id)
      : [...state.hidden, id],
  };
}

export function isVisible(
  state: HistoryColumnState,
  id: HistoryColumnId,
): boolean {
  return !state.hidden.includes(id);
}

export function hiddenColumns(
  state: HistoryColumnState,
): readonly HistoryColumnId[] {
  return state.hidden;
}

/**
 * The visible columns in table order. The graph's floor is the lane layout's
 * own minimum width: a user-narrowed graph column still shows every lane.
 */
export function visibleColumns(
  state: HistoryColumnState,
  graphFloor: number,
): readonly { id: HistoryColumnId; width: number }[] {
  const order: HistoryColumnId[] = ["refs", "graph", "author", "date", "sha"];
  const cells: { id: HistoryColumnId; width: number }[] = [];
  for (const id of order) {
    if (!isVisible(state, id)) {
      continue;
    }
    const width =
      id === "graph"
        ? Math.max(state.widths.graph, graphFloor)
        : state.widths[id];
    cells.push({ id, width });
  }
  return cells;
}

export function serializeColumnState(state: HistoryColumnState): string {
  return JSON.stringify({ widths: state.widths, hidden: state.hidden });
}

const STORAGE_KEY = "refyard.layout.history.columns";

/**
 * The stored layout, or the default one. Every access is guarded: a browser
 * without storage (or a test host without a DOM) renders the default table
 * rather than failing, and persistence is best-effort by design — losing a
 * column width is not a state the workbench needs to report.
 */
export function loadStoredColumnState(): HistoryColumnState {
  try {
    return parseColumnState(
      globalThis.localStorage?.getItem(STORAGE_KEY) ?? null,
    );
  } catch {
    return defaultColumnState();
  }
}

export function storeColumnState(state: HistoryColumnState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, serializeColumnState(state));
  } catch {
    // Storage may be full or blocked; the table keeps the in-memory layout.
  }
}

function isHistoryColumnId(value: unknown): value is HistoryColumnId {
  return (
    typeof value === "string" &&
    HISTORY_COLUMN_IDS.includes(value as HistoryColumnId)
  );
}

export function parseColumnState(stored: string | null): HistoryColumnState {
  if (stored === null) {
    return defaultColumnState();
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return defaultColumnState();
  }
  if (typeof value !== "object" || value === null) {
    return defaultColumnState();
  }
  const record = value as { widths?: unknown; hidden?: unknown };
  const widths: Record<HistoryColumnId, number> = {
    ...defaultColumnState().widths,
  };
  if (typeof record.widths === "object" && record.widths !== null) {
    for (const [key, raw] of Object.entries(
      record.widths as Record<string, unknown>,
    )) {
      if (!isHistoryColumnId(key)) {
        continue;
      }
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        continue;
      }
      widths[key] = clampColumnWidth(key, raw);
    }
  }
  const hidden = Array.isArray(record.hidden)
    ? record.hidden.filter(isHistoryColumnId)
    : [];
  return { widths, hidden };
}
