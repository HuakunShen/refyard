/** Verifies context-menu separator cleanup preserves the original actions. */
import { describe, expect, it, vi } from "vitest";
import {
  compactContextActions,
  type ContextAction,
} from "@refyard/git-ui/lib/context-actions";

describe("context action model", () => {
  it("removes leading, trailing and duplicate separators without changing actions", () => {
    const first = vi.fn();
    const second = vi.fn();
    const actions: readonly ContextAction[] = [
      { kind: "separator", id: "leading" },
      {
        kind: "action",
        id: "first",
        label: "First",
        disabled: true,
        onSelect: first,
      },
      { kind: "separator", id: "one" },
      { kind: "separator", id: "two" },
      {
        kind: "action",
        id: "second",
        label: "Second",
        destructive: true,
        onSelect: second,
      },
      { kind: "separator", id: "trailing" },
    ];

    const compacted = compactContextActions(actions);
    expect(compacted.map((entry) => entry.id)).toEqual(["first", "one", "second"]);
    expect(compacted[0]).toMatchObject({ disabled: true });
    expect(compacted[2]).toMatchObject({ destructive: true });
    expect(compacted[0]?.kind === "action" ? compacted[0].onSelect : null).toBe(first);
    expect(compacted[2]?.kind === "action" ? compacted[2].onSelect : null).toBe(second);
  });
});
