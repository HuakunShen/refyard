#!/usr/bin/env bun
/**
 * (Re)generate the desktop shell's appearance-aware app icon assets.
 *
 * From the repository's two logo sources — `packages/logo/refyard-app-icon-v2.svg`
 * (light variant) and `refyard-app-icon-v2-dark.svg` (dark variant) — this writes,
 * into `apps/desktop/src-tauri/icons/`:
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
 * The logo SVGs are full-bleed tiles, but a macOS 26 icon is the system's squircle
 * painted from the document's background fill plus composited foreground layers — a
 * baked-in tile arrives as a layer and ends up framed inside the system background.
 * So the document carries the tile gradients as `fill-specializations` and the
 * layers are the glyphs alone, stripped of their rect (and of the gradient/shadow
 * defs that only served that rect). Each appearance's glyph swaps like the tile
 * used to. Run this after changing the logo SVGs, on a Mac with Xcode 26+ (the host
 * `actool` compiles the document); commit both outputs. Non-macOS hosts never read
 * them.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * The logo SVGs draw a tile (a rounded rect with its own gradient and drop shadow)
 * behind the mark. For the composited icon the system paints the background, so
 * everything that served that rect goes: the tile rect itself and the outer defs
 * holding its gradient and shadow filter. The glyph's own defs live inside its
 * group and survive.
 */
function glyphOnly(svg: string): string {
  return svg
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    .replace(/\s*<rect[^>]*\/>/, "")
    .trim();
}
writeFileSync(join(assets, "light.svg"), glyphOnly(readFileSync(lightSvg, "utf8")));
writeFileSync(join(assets, "dark.svg"), glyphOnly(readFileSync(darkSvg, "utf8")));

// The layers swap by appearance exactly as the tiles used to. The specialization
// arrays carry the base value as their first entry — the shape Icon Composer itself
// writes; entries without it are ignored. Scale 3.3 lands the mark at ~65% of the
// squircle, matching its proportion inside the original tile. The background is the
// original tile gradient per appearance: light `#FFFFFF → #F2F6FB`, dark
// `#262B33 → #101318`, both along the SVG's diagonal. `squares: shared` covers the
// square macOS/iOS slot; this design has no watchOS circle.
const manifest = {
  groups: [
    {
      name: "Refyard",
      layers: [
        {
          "image-name": "light.svg",
          name: "light glyph",
          position: { scale: 3.3, "translation-in-points": [0, 0] },
          "hidden-specializations": [
            { value: false },
            { appearance: "dark", value: true },
          ],
        },
        {
          "image-name": "dark.svg",
          name: "dark glyph",
          position: { scale: 3.3, "translation-in-points": [0, 0] },
          "hidden-specializations": [
            { value: true },
            { appearance: "dark", value: false },
          ],
        },
      ],
    },
  ],
  "fill-specializations": [
    {
      value: {
        "linear-gradient": [
          "srgb:1.00000,1.00000,1.00000,1.00000",
          "srgb:0.94902,0.96471,0.98431,1.00000",
        ],
        orientation: { start: { x: 0, y: 0 }, stop: { x: 1, y: 1 } },
      },
    },
    {
      appearance: "dark",
      value: {
        "linear-gradient": [
          "srgb:0.14902,0.16863,0.20000,1.00000",
          "srgb:0.06275,0.07451,0.09412,1.00000",
        ],
        orientation: { start: { x: 0, y: 0 }, stop: { x: 1, y: 1 } },
      },
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
