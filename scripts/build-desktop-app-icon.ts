#!/usr/bin/env bun
/**
 * (Re)generate the desktop shell's appearance-aware app icon assets.
 *
 * From the repository's two logo sources — `packages/logo/refyard-app-icon-v2.svg`
 * (white tile, light appearance) and `refyard-app-icon-v2-dark.svg` (black tile,
 * dark appearance) — this writes, into `apps/desktop/src-tauri/icons/`:
 *
 * - `AppIcon.icon/`, the Icon Composer document (a folder: manifest + layer SVGs).
 *   It is the human-inspectable source of the catalog.
 * - `Assets.car`, the compiled catalog. `tauri.conf.json` names it in `bundle.icon`;
 *   Tauri's bundler copies a `.car` verbatim into `Contents/Resources` and reads the
 *   icon name out of it for `CFBundleIconName`, so no build machine ever needs
 *   `actool` — macOS 26+ switches the Dock icon with the system appearance whether
 *   the app runs or not, older macOS ignores the catalog and falls back to
 *   `icons/icon.icns`.
 *
 * Run this after changing the logo SVGs, on a Mac with Xcode 26+ (the host `actool`
 * compiles the document); commit both outputs. Non-macOS hosts never read them.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileAppIconDocument } from "./lib/app-icon.ts";

if (process.platform !== "darwin") {
  console.error("build-desktop-app-icon: compiling the catalog needs macOS (actool)");
  process.exit(1);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lightSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2.svg");
const darkSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2-dark.svg");
const iconsDir = join(repoRoot, "apps/desktop/src-tauri/icons");
const document = join(iconsDir, "AppIcon.icon");

rmSync(document, { recursive: true, force: true });
const assets = join(document, "Assets");
mkdirSync(assets, { recursive: true });
cpSync(lightSvg, join(assets, "light.svg"));
cpSync(darkSvg, join(assets, "dark.svg"));

// Each tile is the whole icon, so the layers swap by appearance instead of
// compositing. The specialization arrays carry the base value as their first entry —
// that is the shape Icon Composer itself writes, and the renderer skips entries that
// lack it. `position.scale` blows the full-bleed tile up to the squircle: macOS 26
// owns the icon canvas and composites layers at ~45% by default, which would shrink
// the tile into a badge. `squares: shared` covers the square macOS/iOS slot; this
// design has no watchOS circle.
const manifest = {
  groups: [
    {
      name: "Refyard",
      layers: [
        {
          "image-name": "light.svg",
          name: "light tile",
          position: { scale: 3, "translation-in-points": [0, 0] },
          "hidden-specializations": [
            { value: false },
            { appearance: "dark", value: true },
          ],
        },
        {
          "image-name": "dark.svg",
          name: "dark tile",
          position: { scale: 3, "translation-in-points": [0, 0] },
          "hidden-specializations": [
            { value: true },
            { appearance: "dark", value: false },
          ],
        },
      ],
    },
  ],
  "supported-platforms": { squares: "shared" },
};
writeFileSync(join(document, "icon.json"), JSON.stringify(manifest, null, 2));

// The catalog is compiled at a scratch location and the car copied out, so the
// actool side products (partial plists, a flattened icns) never land in the repo.
const scratch = join(iconsDir, ".icon-build");
const { assetsCar } = compileAppIconDocument(document, scratch);
cpSync(assetsCar, join(iconsDir, "Assets.car"));
rmSync(scratch, { recursive: true, force: true });

console.log(`build-desktop-app-icon: ${document}`);
console.log(`build-desktop-app-icon: ${join(iconsDir, "Assets.car")}`);
