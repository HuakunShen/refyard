/** Width constraints and persistence keys for the desktop workbench columns. */

export const SIDEBAR_WIDTHS = {
  left: { default: 296, min: 220, max: 520 },
  right: { default: 336, min: 260, max: 560 },
} as const;

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
