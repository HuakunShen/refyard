/**
 * The macOS app icon, with automatic light/dark switching.
 *
 * macOS picks an app icon per system appearance only when the bundle carries an
 * **asset catalog** (`Assets.car`) named by `CFBundleIconInfo`/`CFBundleIconName` — a
 * plain `.icns` has no light/dark concept, which is why a bare bundle wears one icon
 * everywhere. This module compiles the repository's two logo sources into that
 * catalog with the platform `actool`:
 *
 * - `packages/logo/refyard-app-icon-v2.svg` — white-tile, for light appearance
 * - `packages/logo/refyard-app-icon-v2-dark.svg` — black-tile, for dark appearance
 *
 * Both are rasterized at 1024px (the single-size macOS icon) and compiled into one
 * `Assets.car`, written next to a partial Info.plist whose `CFBundleIconName` the
 * bundling scripts merge into their `Info.plist`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lightSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2.svg");
const darkSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2-dark.svg");

export interface IconCatalogResult {
  /** The compiled catalog, with the light and dark icons inside. */
  readonly assetsCar: string;
  /**
   * A partial Info.plist `actool` writes alongside the catalog; it names the icon
   * set (`CFBundleIconName`), which the bundling script must merge into its own
   * `Info.plist`.
   */
  readonly partialInfoPlist: string;
}

/**
 * Compile the light/dark app icons into `Assets.car` under `outDir`.
 * `sips` and `actool` are host tools — Xcode's command line tools carry both.
 */
export function buildAppIconCatalog(outDir: string): IconCatalogResult {
  rmSync(outDir, { recursive: true, force: true });
  const xcassets = join(outDir, "RefyardIcon.xcassets", "AppIcon.appiconset");
  mkdirSync(xcassets, { recursive: true });

  const light = join(xcassets, "icon-light.png");
  const dark = join(xcassets, "icon-dark.png");
  execFileSync("sips", ["-s", "format", "png", "-Z", "1024", lightSvg, "--out", light], {
    stdio: "pipe",
  });
  execFileSync("sips", ["-s", "format", "png", "-Z", "1024", darkSvg, "--out", dark], {
    stdio: "pipe",
  });

  // One 1024px image per appearance — the single-size macOS icon Xcode 14 and the
  // current actool accept, with the dark appearance naming its own file.
  const contents = {
    images: [
      {
        filename: "icon-light.png",
        idiom: "universal",
        platform: "macos",
        size: "1024x1024",
      },
      {
        appearances: [{ appearance: "luminosity", value: "dark" }],
        filename: "icon-dark.png",
        idiom: "universal",
        platform: "macos",
        size: "1024x1024",
      },
    ],
    info: { author: "xcode", version: 1 },
  };
  writeFileSync(join(xcassets, "Contents.json"), JSON.stringify(contents, null, 2));

  const assetsCar = join(outDir, "Assets.car");
  const partialInfoPlist = join(outDir, "icon-plist.plist");
  execFileSync(
    "actool",
    [
      "--compile",
      outDir,
      "--output-partial-info-plist",
      partialInfoPlist,
      "--app-icon",
      "AppIcon",
      "--output-format",
      "human-readable-text",
      join(outDir, "RefyardIcon.xcassets"),
    ],
    { stdio: "pipe" },
  );
  return { assetsCar, partialInfoPlist };
}
