/**
 * The native interface styles the workbench can wear, and how `auto` picks one.
 *
 * A style names a platform's look — macOS's system type and soft controls, Windows'
 * Segoe type and crisper edges — or the plain `web` look this workbench ships by
 * default. The reader may pin any style on any device; `auto` follows the platform the
 * page is actually running on, detected from the user agent the host hands the app.
 * The stylesheet turns the resolved name into the look via `[data-interface]` rules;
 * nothing here touches the DOM.
 */

/** The style preferences a reader can hold; `auto` is the stored default. */
export type InterfaceStyle = "auto" | "web" | "macos" | "windows" | "linux";

/** The styles the stylesheet has rules for — everything `auto` can resolve to. */
export type ResolvedInterfaceStyle = Exclude<InterfaceStyle, "auto">;

export const INTERFACE_STYLES: readonly InterfaceStyle[] = [
  "auto",
  "web",
  "macos",
  "windows",
  "linux",
];

/** Narrow a stored or incoming value to a style; anything unknown means `auto`. */
export function isInterfaceStyle(
  value: string | null | undefined,
): value is InterfaceStyle {
  return value !== null && value !== undefined && (INTERFACE_STYLES as readonly string[]).includes(value);
}

/** Detect the platform a user agent describes, as far as the styles care. */
function platformOf(userAgent: string): ResolvedInterfaceStyle {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X|iPhone|iPad/i.test(userAgent)) return "macos";
  // Android reports Linux in its user agent, but its native look is not GNOME's.
  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) return "linux";
  return "web";
}

/**
 * Resolve a preference to the style to wear. An explicit choice always wins — the point
 * of offering every style on every device is previewing and preference, not policing —
 * and `auto` falls back to the web look on platforms without a style of their own.
 */
export function resolveInterfaceStyle(
  style: InterfaceStyle,
  userAgent: string,
): ResolvedInterfaceStyle {
  if (style !== "auto") return style;
  return platformOf(userAgent);
}
