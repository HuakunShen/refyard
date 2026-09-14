/**
 * `cn` and the element-ref helper types the generated shadcn-svelte components import.
 *
 * `cn` is the only shared behaviour: `tailwind-merge` is what lets a caller pass
 * `class="px-4"` to a component that already uses `px-2` and get one padding rather than
 * whichever rule the stylesheet happens to order first. The four `*Child*`/`WithElementRef`
 * types are shadcn-svelte's own prop-shaping helpers, kept verbatim so a future
 * `shadcn-svelte add` generates code that compiles against this file unchanged.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: unknown }
  ? Omit<T, "child">
  : T;
export type WithoutChildren<T> = T extends { children?: unknown }
  ? Omit<T, "children">
  : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};
