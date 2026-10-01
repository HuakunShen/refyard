/** Finds visible, enabled workbench controls in their declared tab order. */
export function tabStopsWithin(root: Document | HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]",
    ),
  )
    .filter(
      (candidate) =>
        candidate.tabIndex >= 0 &&
        !candidate.matches(":disabled") &&
        candidate.closest("[inert]") === null &&
        candidate.getClientRects().length > 0 &&
        window.getComputedStyle(candidate).visibility === "visible",
    )
    .sort((first, second) => {
      if (first.tabIndex === second.tabIndex) return 0;
      if (first.tabIndex === 0) return 1;
      if (second.tabIndex === 0) return -1;
      return first.tabIndex - second.tabIndex;
    });
}
