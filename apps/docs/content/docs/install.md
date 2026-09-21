---
title: Install
description: The desktop app from GitHub Releases or Homebrew, and the CLI through npx.
---

## Desktop app

The native app is a single binary per platform: a Tauri window around a Rust host that runs
your machine's `git`. No JavaScript runtime is bundled and no local HTTP listener is opened.

| Platform              | Artifact                        |
| --------------------- | ------------------------------- |
| macOS (Apple Silicon) | `Refyard_<version>_aarch64.dmg` |
| macOS (Intel)         | `Refyard_<version>_x64.dmg`     |
| Linux x64 and arm64   | `.deb` and `.AppImage`          |
| Windows x64           | NSIS installer (`.exe`)         |

Download from [GitHub Releases](https://github.com/HuakunShen/refyard/releases/latest), or
install with Homebrew on macOS:

```sh
brew install --cask HuakunShen/tap/refyard
```

<Callout type="warn" title="macOS without Apple code signing">
The builds are ad-hoc signed, so Gatekeeper blocks the first launch of a copy downloaded
through a browser. Clear the quarantine flag once and it opens normally afterwards:

```sh
xattr -cr /Applications/Refyard.app
```

Right-clicking the app and choosing **Open** once, or approving it under **System Settings →
Privacy & Security**, does the same thing. A Homebrew install is not affected — Homebrew does
not quarantine casks.
</Callout>

The app updates itself from the release feed. Settings → Check for updates offers a new
version, downloads it, verifies the minisign signature and restarts into it; nothing is
installed without you asking.

## Command line

The CLI is published to npm as `refyard` and is self-contained — it bundles the Git service
and the workbench UI, and declares no dependencies:

```sh
npx refyard@latest open /path/to/repository
```

Or install it once:

```sh
npm install -g refyard
refyard doctor --json     # what this machine can do
```

The CLI needs Node 22 or newer; development and CI are pinned to Node 26. See
[the command reference](/refyard/cli/) for every flag.

## From source

Development uses Node 26.x and pnpm 11:

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

The native desktop app and CLI build with Cargo (Rust 1.98):

```sh
pnpm desktop:build                        # Refyard.app under apps/desktop/src-tauri/target/release/bundle/macos
cargo build --release -p refyard-native   # native CLI at target/release/refyard-native
```

<Callout type="info" title="Node, pnpm and Rust are build tools, not runtime requirements">
The published desktop app carries no JS runtime, and the published CLI carries no
dependencies beyond Node itself. Neither ships a second engine: the Rust host does not embed
Node, and the Node service does not embed Rust.
</Callout>
