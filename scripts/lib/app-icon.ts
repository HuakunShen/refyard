/**
 * Compile an Icon Composer `.icon` document into an appearance-aware `Assets.car`.
 *
 * Tauri's bundler compiles the checked-in `AppIcon.icon` itself, so the Tauri shell
 * has no business here; this is for bundles assembled without a bundler — the GPUI
 * shell's `scripts/build-gpui-app.ts`. The flags mirror what the bundler passes:
 * the document rides the macOS 26 icon runtime, so older systems ignore the
 * catalog and fall back to the bundle's `.icns`. `actool` is a host tool — Xcode's
 * command line tools carry it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface AppIconCatalog {
  /** The compiled catalog, with the light and dark tiles inside. */
  readonly assetsCar: string;
}

/**
 * Compile `document` (a `.icon` directory) into `Assets.car` under `outDir`,
 * replacing any previous output there. The app icon inside is named `AppIcon`;
 * `CFBundleIconName` must name it in the bundle's `Info.plist`.
 */
export function compileAppIconDocument(document: string, outDir: string): AppIconCatalog {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const assetsCar = join(outDir, "Assets.car");
  execFileSync(
    "actool",
    [
      document,
      "--compile",
      outDir,
      "--output-partial-info-plist",
      join(outDir, "icon-info.plist"),
      "--app-icon",
      "AppIcon",
      "--include-all-app-icons",
      "--enable-on-demand-resources",
      "NO",
      "--development-region",
      "en",
      "--target-device",
      "mac",
      // The .icon document format rides the macOS 26 icon runtime; older systems
      // never read this catalog and use the bundle's .icns instead.
      "--minimum-deployment-target",
      "26.0",
      "--platform",
      "macosx",
      "--output-format",
      "human-readable-text",
    ],
    { stdio: "pipe" },
  );
  return { assetsCar };
}
