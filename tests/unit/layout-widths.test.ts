/** Sidebar width constraints stay bounded and ignore invalid persisted values. */
import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  NAV_HEIGHT,
  RAIL_HEIGHT,
  RAIL_WIDTH,
  SIDEBAR_WIDTHS,
  storedSidebarWidth,
} from "../../apps/web/src/lib/workbench/layout-widths.js";

const bounds = { min: 220, max: 520 };

describe("layout widths", () => {
  it("clamps pointer deltas to the desktop sidebar bounds", () => {
    expect(clampSidebarWidth(180, bounds)).toBe(220);
    expect(clampSidebarWidth(640, bounds)).toBe(520);
    expect(clampSidebarWidth(333.7, bounds)).toBe(334);
  });

  it("falls back when persisted width is missing or invalid", () => {
    expect(storedSidebarWidth(null, 296, bounds)).toBe(296);
    expect(storedSidebarWidth("not-a-width", 296, bounds)).toBe(296);
    expect(storedSidebarWidth("480", 296, bounds)).toBe(480);
  });

  it("keeps the rail narrower than any column the reader can drag to", () => {
    // Prevents: collapsing a column that was already squeezed past the rail's width, which
    // would make the column *wider* — the opposite of what the reader asked for, and a state
    // with no way out except dragging back out of it.
    expect(RAIL_WIDTH).toBeLessThan(SIDEBAR_WIDTHS.left.min);
    expect(RAIL_HEIGHT).toBeLessThan(NAV_HEIGHT.min);
  });
});
