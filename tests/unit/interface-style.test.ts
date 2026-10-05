/**
 * Which native interface style the workbench wears.
 *
 * The style is a preference that names a platform look (`macos`, `windows`) or the plain
 * `web` look; `auto` resolves to the platform the reader is actually on. The resolution is
 * pinned here because it reads a user agent — an untamed string — and because the wrong
 * default silently puts every Windows reader in the macOS look.
 */
import { describe, expect, it } from "vitest";
import {
  INTERFACE_STYLES,
  isInterfaceStyle,
  resolveInterfaceStyle,
  type InterfaceStyle,
} from "@refyard/git-ui/lib/interface-style";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("resolving the interface style", () => {
  it("auto follows the platform the reader is on", () => {
    expect(resolveInterfaceStyle("auto", MAC_UA)).toBe("macos");
    expect(resolveInterfaceStyle("auto", WINDOWS_UA)).toBe("windows");
    expect(resolveInterfaceStyle("auto", LINUX_UA)).toBe("linux");
    // A platform without a native look of its own falls back to the web look rather
    // than borrowing one that will not match its conventions. Android reports Linux
    // in its user agent but has no GNOME to borrow.
    expect(resolveInterfaceStyle("auto", ANDROID_UA)).toBe("web");
    expect(resolveInterfaceStyle("auto", "")).toBe("web");
  });

  it("an explicit choice wins over the platform", () => {
    expect(resolveInterfaceStyle("macos", WINDOWS_UA)).toBe("macos");
    expect(resolveInterfaceStyle("windows", MAC_UA)).toBe("windows");
    expect(resolveInterfaceStyle("linux", MAC_UA)).toBe("linux");
    expect(resolveInterfaceStyle("web", MAC_UA)).toBe("web");
  });
});

describe("narrowing a stored style", () => {
  it("accepts exactly the five named styles", () => {
    const styles: readonly InterfaceStyle[] = [
      "auto",
      "web",
      "macos",
      "windows",
      "linux",
    ];
    expect(INTERFACE_STYLES).toEqual(styles);
    for (const style of styles) {
      expect(isInterfaceStyle(style)).toBe(true);
    }
  });

  it("refuses anything else, so a stale stored value means auto", () => {
    // A stored value from a future or past build must not reach the DOM as an
    // attribute the stylesheet has no rules for.
    expect(isInterfaceStyle("gnome")).toBe(false);
    expect(isInterfaceStyle("")).toBe(false);
    expect(isInterfaceStyle(null)).toBe(false);
    expect(isInterfaceStyle(undefined)).toBe(false);
  });
});
