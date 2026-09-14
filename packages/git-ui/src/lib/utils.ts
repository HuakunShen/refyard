/**
 * `cn` — conditional class names with conflict resolution.
 *
 * `tailwind-merge` is what lets a caller pass `class="px-4"` to a component that already
 * uses `px-2` and get one padding rather than whichever rule the stylesheet happens to
 * order first. This is the only shared helper the primitives need.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
