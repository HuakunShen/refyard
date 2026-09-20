/**
 * State for one floating context menu that a list of triggers shares.
 *
 * A per-trigger menu component cannot nest (a ref badge sits inside a commit
 * row, and both need their own menu), so instead each list owns one menu state
 * and one `ContextMenuLayer`, and any row or badge opens that layer with its
 * own actions at the pointer. Opening at the pointer — and never at a stale
 * position — is what makes the layer feel like a native context menu.
 */
import type { ContextAction } from "./context-actions.js";

export interface ContextMenuState {
  open: boolean;
  /** Viewport coordinates for the menu's top-left corner. */
  x: number;
  y: number;
  actions: readonly ContextAction[];
  /** Rendered on the menu and each item as `data-testid` prefixes. */
  testId: string | undefined;
}

export function createContextMenuState(): ContextMenuState {
  return { open: false, x: 0, y: 0, actions: [], testId: undefined };
}

export function openContextMenu(
  menu: ContextMenuState,
  actions: readonly ContextAction[],
  position: { readonly x: number; readonly y: number },
  options?: { readonly testId?: string },
): void {
  menu.actions = actions;
  menu.x = position.x;
  menu.y = position.y;
  menu.testId = options?.testId;
  menu.open = true;
}

/** Open a menu anchored to an element (a gear button), below its left edge. */
export function openAnchoredContextMenu(
  menu: ContextMenuState,
  actions: readonly ContextAction[],
  anchor: { readonly left: number; readonly bottom: number },
  options?: { readonly testId?: string },
): void {
  openContextMenu(
    menu,
    actions,
    { x: anchor.left, y: anchor.bottom + 4 },
    options,
  );
}

export function closeContextMenu(menu: ContextMenuState): void {
  menu.open = false;
}
