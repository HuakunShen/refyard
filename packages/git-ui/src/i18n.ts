/**
 * The workbench's translated strings, and the runtime that picks the locale.
 *
 * The catalogues live beside this package because its components own the workbench's
 * strings; apps compose the page and choose *which* locale, which is why the locale is
 * resolved by the app and set through the runtime here rather than read from a URL —
 * the workbench is a static SPA with no server to read one from.
 */
export { m } from "./i18n/paraglide/messages.js";
export { getLocale, setLocale } from "./i18n/paraglide/runtime.js";

/** The reader's language preference: `auto` follows the browser, the rest are explicit. */
export type UiLanguage = "auto" | "en" | "zh";

/** The locales the workbench actually ships translations for. */
export const UI_LOCALES = ["en", "zh"] as const;

/**
 * Resolve a preference to a concrete locale. `auto` follows the browser, and anything the
 * browser names that we do not ship falls back to English rather than to nothing.
 */
export function resolveUiLocale(
  preference: UiLanguage,
  browserLanguage: string,
): (typeof UI_LOCALES)[number] {
  if (preference !== "auto") {
    return preference;
  }
  return UI_LOCALES.find((locale) => browserLanguage.startsWith(locale)) ?? "en";
}
