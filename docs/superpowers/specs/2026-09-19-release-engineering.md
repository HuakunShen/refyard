# Spec: Release engineering for the native desktop app

**Date:** 2026-09-19 · **Status:** approved direction; item 2 (updater) implementation is
gated on the owner confirming two choices (see §4.5) · **Owner:** HuakunShen

This spec covers three user asks that share one artifact pipeline:

1. A GitHub Actions workflow that builds the desktop app for **Windows, macOS and Linux,
   x86_64 and arm64**, and publishes a release automatically.
2. **Automatic updates** for the installed desktop app (Tauri updater plugin, static-JSON
   endpoint). Implementation starts only after the owner confirms §4.5.
3. A **Homebrew cask** in the owner's existing personal tap (`HuakunShen/homebrew-tap`),
   prepared so it works the moment the first release exists.

Everything here was written against the Tauri v2 documentation (via Context7,
`/tauri-apps/tauri-docs`: `distribute/pipelines/github`, `plugin/updater`,
`distribute/sign/macos`), not from memory.

## 1. Facts this design stands on

- The app is `apps/desktop/src-tauri` (crate `refyard-desktop`), `productName: Refyard`,
  version `0.1.0`. It has **no JavaScript runtime** in the bundle; the frontend is the SPA
  built into `apps/web/build-desktop` by `scripts/build-desktop.ts` (`REFYARD_BUILD_TARGET=desktop
  pnpm --dir apps/web exec vite build`), and the two-step order (web first, then cargo) is
  load-bearing — a stale frontend would be embedded silently.
- The GitHub remote is `HuakunShen/refyard` (public repo — `ubuntu-22.04-arm` runners are
  available to it).
- The repo already has two tag-triggered npm workflows; the npm line owns the `v*` tag
  namespace (`publish.yml`). Desktop release tags must not collide with it.
- The repo builds with pnpm 11.25.0 + Node 26 + bun (dev scripts); `ci.yml` already
  installs bun on CI runners.
- `tauri-action` (v1) builds, bundles, creates the GitHub release, uploads per-platform
  artifacts, and — when updater artifacts are enabled — generates and uploads the
  `latest.json` that the updater plugin consumes. The owner's recollection ("one JSON file
  with each platform's binary path") is exactly this file:
  `{version, notes, pub_date, platforms: {"<os>-<arch>": {signature, url}}}` where
  `signature` is the **contents** of the generated `.sig` file (minisign), not a path.

## 2. Artifacts per platform

| OS      | Arch    | Runner             | Bundle targets    | Notes                                  |
| ------- | ------- | ------------------ | ----------------- | -------------------------------------- |
| macOS   | aarch64 | `macos-latest`     | `app`, `dmg`      | `--target aarch64-apple-darwin`        |
| macOS   | x86_64  | `macos-latest`     | `app`, `dmg`      | `--target x86_64-apple-darwin`         |
| Linux   | x86_64  | `ubuntu-22.04`     | `deb`, `appimage` | older-glibc runner for compatibility   |
| Linux   | arm64   | `ubuntu-22.04-arm` | `deb`, `appimage` | public-repo runners only               |
| Windows | x86_64  | `windows-latest`   | `nsis`            | the modern Tauri Windows installer     |
| Windows | aarch64 | —                  | `nsis`            | **not shipped**; kept as a commented matrix row. The Tauri docs' own sample omits it; WebView2-on-ARM64 bootstrapping is the flaky part. The row is written and ready to uncomment. |

Bundle targets are set through Tauri's platform-specific config files
(`tauri.macos.conf.json`, `tauri.windows.conf.json`, `tauri.linux.conf.json`) so the shared
`tauri.conf.json` stays platform-neutral. `appimage` is kept because the updater's
Linux story prefers it.

## 3. Workflow shape (`.github/workflows/release.yml`)

- **Trigger:** `push` on tags `app-v*` plus `workflow_dispatch` (manual smoke run from any
  branch; the tag namespace `app-v*` never collides with the npm `v*` line).
- **Gate job** (`ubuntu-latest`) runs the headless contract before any artifact is built:
  `pnpm install`, `pnpm check`, `pnpm test:unit`, `cargo test --workspace`. The matrix
  `needs: gate` — a red gate never produces a release.
- **Per-matrix steps:** checkout → Linux system deps (the Tauri docs list) → pnpm/Node 26 +
  bun → `pnpm install --frozen-lockfile` → Rust stable with the macOS cross-targets →
  `swatinem/rust-cache` scoped to `apps/desktop/src-tauri -> target` → build the SPA
  (`REFYARD_BUILD_TARGET=desktop vite build`, reproducing `build-desktop.ts`'s first half
  exactly) → `tauri-apps/tauri-action@v1` with `projectPath: apps/desktop`.
- **Release:** `tagName: app-v__VERSION__`, `releaseName: Refyard v__VERSION__`,
  `releaseDraft: false`, `prerelease: false` — a tag push is a release, per the owner's ask.
  `__VERSION__` is substituted by the action from `tauri.conf.json`.
- **Secrets referenced from day one** (harmless until the updater config flips them
  load-bearing): `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
  optional Apple notarization secrets documented, not required — updates are signed with
  the Tauri minisign key regardless of Apple codesign state.

## 4. Automatic updates (implementation gated on §4.5)

4.1 **Mechanism:** `tauri-plugin-updater` v2 (+ `tauri-plugin-process` for relaunch).
The WebView-initiated flow is user-acted: check → show → downloadAndInstall → relaunch.
4.2 **Config:** `bundle.createUpdaterArtifacts: true`; `plugins.updater.pubkey` (committed);
`plugins.updater.endpoints: ["https://github.com/HuakunShen/refyard/releases/latest/download/latest.json"]`
— TLS enforced, hosted by the release the workflow already creates; **no extra server**.
4.3 **Signing:** `pnpm tauri signer generate` once on the owner's machine; private key +
password go to GitHub secrets, the public key is committed. Release artifacts are signed in
CI; `latest.json` carries each platform's signature inline.
4.4 **Capabilities:** the window gains `updater:default` and `process:allow-restart` — the
first new WebView permissions since the dialog decision, each named because the update
action is a real user affordance in the Settings sheet, not an ambient one.
4.5 **Owner choices this implementation waits on**:
   - Endpoint confirmed as GitHub-Releases-hosted `latest.json` (the owner's "one JSON
     file" recollection matches; no separate release server).
   - Interaction: a **Check for updates** section in the app's Settings sheet (manual,
     user-initiated) plus an **opt-in** "check automatically on startup" toggle, default
     off. Silence is the default; no auto-download.
4.6 **Honest limits:** v2 updater does not downgrade; version comparisons are SemVer; a
Gatekeeper-unsigned macOS build still auto-updates (the minisign signature is what the
plugin verifies), but unsigned builds prompt Finder-right-click-open on first install —
Apple Developer ID signing/notarization remains an optional owner-provisioned step.

## 5. Homebrew cask (item 4)

The macOS app is a GUI app, so the tap needs a **cask**, not a formula. Deliverables:

- `packaging/homebrew/Casks/refyard.rb` in this repo — versioned-URL cask:
  `.../releases/download/app-v#{version}/Refyard_#{version}_aarch64.dmg` (and the
  `on_intel` x64 variant), `auto_updates true` (the cask must not fight the app's own
  updater), `name`/`desc`/`homepage` aligned with the repo, sha256 filled per release.
- A runbook (`docs/installation.md` + cask header comment): after each release, bump
  `version` + the two `sha256` lines and push the cask to `HuakunShen/homebrew-tap`
  (`Casks/refyard.rb`). Per repo rules this repository never pushes; the push is the
  owner's (or an explicitly approved) action.
- The Windows/Linux artifacts are unaffected; Linux packaging via a tap is out of scope.

## 6. Verification

- Local: `actionlint` (or `yamllint`) on the workflow; every CI step reproduces a command
  already proven locally (`pnpm desktop:build` == the CI step sequence on macOS arm64).
- CI: a `workflow_dispatch` run of `release.yml` on the branch before the first real tag;
  then a real `app-v0.1.0` tag run producing a release with all six artifact groups +
  `latest.json`.
- Updater: after the first release exists, bump version, tag again, and verify the
  installed previous version sees the update (this is item 2's own acceptance test).
- Cask: `brew audit --cask` locally against the formula with a real release URL + sha256.
