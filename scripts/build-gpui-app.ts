/**
 * Build `Refyard.app` — the macOS app bundle around the GPUI shell binary.
 *
 * A bare `refyard-gpui` executable runs fine, but macOS shows a generic exec icon and
 * the process name in the Dock. The bundle fixes both: an `Info.plist` naming the app,
 * an `.icns` rendered from the repository logo, and the appearance-aware `Assets.car`
 * compiled from the checked-in `AppIcon.icon` document — macOS 26+ switches the Dock
 * icon with the system appearance through it, older macOS falls back to the `.icns`
 * (where the dock-icon crate takes over at run time). The steps are plain host tools
 * (`cargo`, `sips`, `iconutil`, `codesign`) so the script only orchestrates them.
 *
 * Usage:
 *   bun scripts/build-gpui-app.ts            # build bundle at apps/desktop-gpui/target/Refyard.app
 *   bun scripts/build-gpui-app.ts --open     # …and `open` it afterwards
 *   bun scripts/build-gpui-app.ts --release  # cargo build --release first
 *
 * The logo source is `packages/logo/refyard-app-icon-v2.svg`, rasterized at 1024px and
 * downscaled into a full iconset, so every size comes from the vector rather than an
 * upscaled bitmap.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(repoRoot, "apps/desktop-gpui");
const logoSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2.svg");
const darkSvg = join(repoRoot, "packages/logo/refyard-app-icon-v2-dark.svg");
const assetsCar = join(repoRoot, "apps/desktop/src-tauri/icons/Assets.car");

const argv = process.argv.slice(2);
const args = new Set(argv);
const profile = args.has("--release") ? "release" : "debug";
// The first positional argument is the repository path handed to the app on launch.
const repoPath = argv.find((arg) => !arg.startsWith("--"));
const target = join(appDir, "target");
const binary = join(target, profile, "refyard-gpui");
const bundle = join(target, "Refyard.app");

function run(command: string, ...arguments_: string[]): void {
  execFileSync(command, arguments_, { stdio: "inherit" });
}

if (args.has("--release")) {
  run("cargo", "build", "--release");
}
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
run("sips", "-s", "format", "png", "-Z", "1024", logoSvg, "--out", rasterized);
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
  run("sips", "-s", "format", "png", "-Z", size, rasterized, "--out", join(iconset, name));
}
const icns = join(scratch, "refyard.icns");
run("iconutil", "-c", "icns", iconset, "-o", icns);

// The two appearance tiles the dock-icon crate swaps at run time: the same SVGs the
// catalog above comes from, rasterized straight to 1024px.
const darkRasterized = join(scratch, "icon-dark-1024.png");
run("sips", "-s", "format", "png", "-Z", "1024", darkSvg, "--out", darkRasterized);

console.log("refyard: assembling Refyard.app");
const contents = join(bundle, "Contents");
rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(contents, "MacOS"), { recursive: true });
mkdirSync(join(contents, "Resources"), { recursive: true });
cpSync(binary, join(contents, "MacOS", "Refyard"));
cpSync(icns, join(contents, "Resources", "refyard.icns"));
// The appearance-aware catalog, precompiled from the checked-in AppIcon.icon
// document (`scripts/build-desktop-app-icon.ts`): macOS 26+ reads `CFBundleIconName`
// out of it and switches the Dock icon with the system appearance on its own.
cpSync(assetsCar, join(contents, "Resources", "Assets.car"));
cpSync(rasterized, join(contents, "Resources", "icon-light.png"));
cpSync(darkRasterized, join(contents, "Resources", "icon-dark.png"));
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
	<key>CFBundleIconName</key>
	<string>AppIcon</string>
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
run("codesign", "--force", "--sign", "-", bundle);

console.log(`refyard: built ${bundle}`);
if (args.has("--open")) {
  const launchArguments = repoPath ? [bundle, "--args", repoPath] : [bundle];
  run("open", ...launchArguments);
  console.log("refyard: launched");
}
