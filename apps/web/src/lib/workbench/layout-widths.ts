/** Width constraints and persistence keys for the desktop workbench columns. */

export const SIDEBAR_WIDTHS = {
  left: { default: 296, min: 176, max: 520 },
  right: { default: 336, min: 208, max: 560 },
} as const;

/**
 * The repository column as an icon rail, and the band it becomes when the workbench stacks.
 *
 * Collapsing is not a very small width — it is a different presentation — so these are fixed
 * rather than clamped: a rail sized by the drag would grow its labels back the moment the
 * reader pulled it. Each is the smallest that still holds a 32px target with its count badge
 * and a 6px inset.
 */
export const RAIL_WIDTH = 48;
export const RAIL_HEIGHT = 56;

/**
 * Height of the repository column when the workbench is too narrow to place it beside the
 * history.
 *
 * A stacked workbench has no columns to size, so the drag moves the one divider there is:
 * the one between the repository list and the history below it. Below the minimum the list
 * is a heading rather than a list; above the maximum the history is.
 */
export const NAV_HEIGHT = { default: 208, min: 88, max: 640 } as const;

/** Share of a stacked workbench the working-copy column keeps for reviewing and committing. */
export const STACKED_COPY_FRACTION = 38;

export function clampSidebarWidth(
  value: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

export function storedSidebarWidth(
  value: string | null,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed, bounds) : fallback;
}
