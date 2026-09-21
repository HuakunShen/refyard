/** Verifies the history table's column widths/visibility survive storage and clamp. */
import { describe, expect, it } from "vitest";
import {
  HIDEABLE_COLUMN_IDS,
  HISTORY_COLUMN_IDS,
  clampColumnWidth,
  columnLimits,
  defaultColumnState,
  hiddenColumns,
  isVisible,
  parseColumnState,
  resizeColumn,
  serializeColumnState,
  toggleColumn,
  visibleColumns,
} from "@refyard/git-ui/lib/column-layout";

describe("history column layout", () => {
  it("starts with every column visible at its default width", () => {
    const state = defaultColumnState();
    expect(hiddenColumns(state)).toEqual([]);
    for (const id of HISTORY_COLUMN_IDS) {
      expect(isVisible(state, id)).toBe(true);
      expect(state.widths[id]).toBe(defaultColumnState().widths[id]);
    }
  });

  it("clamps resized widths to the per-column limits", () => {
    expect(clampColumnWidth("author", 1)).toBe(columnLimits.author.min);
    expect(clampColumnWidth("author", 100_000)).toBe(columnLimits.author.max);
    // The graph column cannot shrink below the lanes that must be drawn; the
    // caller supplies that floor because lane count is graph state, not layout.
    expect(clampColumnWidth("graph", 10, 120)).toBe(120);
    expect(clampColumnWidth("graph", 10)).toBe(columnLimits.graph.min);
  });

  it("resizeColumn keeps other columns untouched and clamps", () => {
    const state = resizeColumn(defaultColumnState(), "sha", 5000);
    expect(state.widths.sha).toBe(columnLimits.sha.max);
    expect(state.widths.author).toBe(defaultColumnState().widths.author);
  });

  it("toggleColumn hides and re-shows a column, keeping its width", () => {
    const resized = resizeColumn(defaultColumnState(), "author", 200);
    let state = toggleColumn(resized, "author");
    expect(isVisible(state, "author")).toBe(false);
    state = toggleColumn(state, "author");
    expect(isVisible(state, "author")).toBe(true);
    expect(state.widths.author).toBe(200);
  });

  it("visibleColumns lists cells in table order at their stored widths", () => {
    const defaults = defaultColumnState().widths;
    let state = toggleColumn(defaultColumnState(), "author");
    state = toggleColumn(state, "graph");
    expect(visibleColumns(state).map((column) => column.id)).toEqual([
      "refs",
      "message",
      "date",
      "sha",
    ]);
    expect(visibleColumns(state).map((column) => column.width)).toEqual([
      defaults.refs,
      defaults.message,
      defaults.date,
      defaults.sha,
    ]);
    const shown = defaultColumnState();
    // The graph has no lane floor any more: a narrow graph compresses its
    // lanes, so the stored width is used verbatim.
    expect(visibleColumns(resizeColumn(shown, "graph", 90))).toEqual([
      { id: "refs", width: shown.widths.refs },
      { id: "graph", width: 90 },
      { id: "message", width: shown.widths.message },
      { id: "author", width: shown.widths.author },
      { id: "date", width: shown.widths.date },
      { id: "sha", width: shown.widths.sha },
    ]);
  });

  it("the commit message is a real column but never a hideable one", () => {
    // TanStack-style resizing needs a stored width for every column, message
    // included; the settings gear only offers HIDEABLE_COLUMN_IDS, which keeps
    // the message — it is the row's identity and selection target.
    expect(HISTORY_COLUMN_IDS).toContain("message");
    expect(HIDEABLE_COLUMN_IDS).not.toContain("message");
    const hidden = toggleColumn(defaultColumnState(), "message");
    expect(
      visibleColumns(hidden).map((column) => column.id),
    ).not.toContain("message");
  });

  it("serializes and parses a round trip", () => {
    const state = toggleColumn(
      resizeColumn(defaultColumnState(), "date", 260),
      "sha",
    );
    const parsed = parseColumnState(serializeColumnState(state));
    expect(parsed).toEqual(state);
  });

  it("parses corrupt or hostile storage into the default state", () => {
    // Real-world failure prevented: a stale or hand-edited localStorage value
    // must never crash the workbench or smuggle in unknown columns or widths.
    expect(parseColumnState(null)).toEqual(defaultColumnState());
    expect(parseColumnState("not json")).toEqual(defaultColumnState());
    expect(parseColumnState('{"widths":{"keychain":"<script>"}}')).toEqual(
      defaultColumnState(),
    );
    expect(
      parseColumnState('{"widths":{"sha":"wide"},"hidden":["nope"]}'),
    ).toEqual(defaultColumnState());
    const clamped = parseColumnState(
      JSON.stringify({
        widths: { sha: -20, author: 99999 },
        hidden: ["date"],
      }),
    );
    expect(clamped.widths.sha).toBe(columnLimits.sha.min);
    expect(clamped.widths.author).toBe(columnLimits.author.max);
    expect(hiddenColumns(clamped)).toEqual(["date"]);
  });
});
