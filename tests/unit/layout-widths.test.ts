/** Sidebar width constraints stay bounded and ignore invalid persisted values. */
import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
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
});
