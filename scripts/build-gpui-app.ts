/**
 * Build `Refyard.app` — the macOS app bundle around the GPUI shell binary.
 *
 * A bare `refyard-gpui` executable runs fine, but macOS shows a generic exec icon and
 * the process name in the Dock. The bundle fixes both: an `Info.plist` naming the app
 * and an `.icns` rendered from the repository logo. The steps are plain host tools
 * (`cargo`, `sips`, `iconutil`, `codesign`) so the script only orchestrates them.
 *
 * Usage:
 *   bun scripts/build-gpui-app.ts            # build bundle at apps/desktop-gpui/target/Refyard.app
 *   bun scripts/build-gpui-app.ts --open     # …and `open` it afterwards
 *   bun scripts/build-gpui-app.ts --release  # cargo build --release
 *
 * The logo source is `packages/logo/refyard-app-icon-v2.svg`, rasterized at 1024px and
 * downscaled into a full iconset, so every size comes from the vector rather than an
 * upscaled bitmap.
 */

import { $ } from "bun";
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const appDir = join(repoRoot, "apps/desktop-gpui");
const logoSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2.svg");

const argv = process.argv.slice(2);
const args = new Set(argv);
const profile = args.has("--release") ? "release" : "debug";
// The first positional argument is the repository path handed to the app on launch.
const repoPath = argv.find((arg) => !arg.startsWith("--"));
const target = join(appDir, "target");
const binary = join(target, profile, "refyard-gpui");
const bundle = join(target, "Refyard.app");

if (!existsSync(binary)) {
  console.error(`refyard: ${binary} not found — run 'cargo build' in apps/desktop-gpui first`);
  process.exit(1);
}

console.log("refyard: rendering the app icon from the repository SVG");
const scratch = join(target, "icon-build");
rmSync(scratch, { recursive: true, force: true });
const iconset = join(scratch, "refyard.iconset");
mkdirSync(iconset, { recursive: true });
const rasterized = join(scratch, "icon-1024.png");
await $`sips -s format png -Z 1024 ${logoSvg} --out ${rasterized}`.quiet();
const sizes: Array<[string, string]> = [
  ["16", "icon_16x16.png"],
  ["32", "icon_16x16@2x.png"],
  ["32", "icon_32x32.png"],
  ["64", "icon_32x32@2x.png"],
  ["128", "icon_128x128.png"],
  ["256", "icon_128x128@2x.png"],
  ["256", "icon_256x256.png"],
  ["512", "icon_256x256@2x.png"],
  ["512", "icon_512x512.png"],
  ["1024", "icon_512x512@2x.png"],
];
for (const [size, name] of sizes) {
  await $`sips -s format png -Z ${size} ${rasterized} --out ${join(iconset, name)}`.quiet();
}
const icns = join(scratch, "refyard.icns");
await $`iconutil -c icns ${iconset} -o ${icns}`;

console.log("refyard: assembling Refyard.app");
const contents = join(bundle, "Contents");
rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(contents, "MacOS"), { recursive: true });
mkdirSync(join(contents, "Resources"), { recursive: true });
cpSync(binary, join(contents, "MacOS", "Refyard"));
cpSync(icns, join(contents, "Resources", "refyard.icns"));
// The identifier is a placeholder: `refyard` is a working name and no domain is owned.
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Refyard</string>
	<key>CFBundleDisplayName</key>
	<string>Refyard</string>
	<key>CFBundleIdentifier</key>
	<string>dev.refyard.gpui</string>
	<key>CFBundleVersion</key>
	<string>0.1.0</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleExecutable</key>
	<string>Refyard</string>
	<key>CFBundleIconFile</key>
	<string>refyard</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSSupportsAutomaticGraphicsSwitching</key>
	<true/>
</dict>
</plist>
`;
writeFileSync(join(contents, "Info.plist"), infoPlist);
// Ad-hoc signature: without one, Gatekeeper re-checks the bundle on every launch and
// the Dock icon lags a build behind.
await $`codesign --force --sign - ${bundle}`;

console.log(`refyard: built ${bundle}`);
if (args.has("--open")) {
  const launchArgs = repoPath ? [bundle, "--args", repoPath] : [bundle];
  await $`open ${launchArgs}`;
  console.log("refyard: launched");
}
