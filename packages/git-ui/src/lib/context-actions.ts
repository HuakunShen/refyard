export type ContextAction =
  | {
      readonly kind: "action";
      readonly id: string;
      readonly label: string;
      readonly disabled?: boolean;
      readonly destructive?: boolean;
      /**
       * Menu items that reflect a boolean setting render a check instead of a
       * blank gutter; the value is display-only, the action itself toggles.
       */
      readonly checked?: boolean;
      readonly onSelect: () => void;
    }
  | {
      readonly kind: "separator";
      readonly id: string;
    };

/** Keep action order while removing separators that would render as visual noise. */
export function compactContextActions(
  actions: readonly ContextAction[],
): readonly ContextAction[] {
  const compacted: ContextAction[] = [];
  for (const action of actions) {
    if (
      action.kind === "separator" &&
      (compacted.length === 0 || compacted.at(-1)?.kind === "separator")
    ) {
      continue;
    }
    compacted.push(action);
  }
  if (compacted.at(-1)?.kind === "separator") {
    compacted.pop();
  }
  return compacted;
}
