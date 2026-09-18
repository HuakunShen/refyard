# Plan: Release engineering (build matrix, updater, Homebrew)

Companion to `specs/2026-09-19-release-engineering.md`. Tasks are ordered so every one
lands on a green tree. TDD applies where a test can exist; CI and packaging files are
verified by lint + a real run instead.

## R1 — Platform bundle configs

Add `tauri.macos.conf.json` / `tauri.windows.conf.json` / `tauri.linux.conf.json` beside
`tauri.conf.json` (mac: `["app","dmg"]`, win: `["nsis"]`, linux: `["deb","appimage"]`).
Verify: `pnpm desktop:build` on macOS still produces `Refyard.app` **and** a `.dmg`;
`cargo test -p refyard-desktop` untouched.

## R2 — Release workflow

`.github/workflows/release.yml`: gate job (check + test:unit + cargo test --workspace) →
5-runner matrix (mac aarch64/x86_64, ubuntu-22.04, ubuntu-22.04-arm, windows-latest),
each: pnpm+bun+rust setup, SPA build with `REFYARD_BUILD_TARGET=desktop`,
`tauri-action@v1` (`projectPath: apps/desktop`, tag `app-v__VERSION__`, draft off),
signing env wired to secrets. Verify: actionlint clean; a `workflow_dispatch` branch run
goes green end-to-end before the first tag.

## R3 — README + demo image (user item 0)

Fresh desktop screenshot (new single-strip UI, real repo open) →
`docs/assets/desktop-workbench.png`; README: desktop app promoted to a first-class
section (install path, auto-update note once §4 lands, new screenshot replacing the
stale-first impression). Verify: image committed, alt text meaningful, links resolve.

## R4 — Homebrew cask (user item 4)

`packaging/homebrew/Casks/refyard.rb` per spec §5 + runbook in `docs/installation.md`.
Verify: `brew audit --cask` against the first real release artifacts; sha256 filled from
the release page. Push to `HuakunShen/homebrew-tap` is the owner's action.

## R5 — Updater (user item 2 — STARTS ONLY AFTER OWNER CONFIRMS spec §4.5)

1. Generate signing keys (`pnpm tauri signer generate`), commit pubkey, owner stores
   secrets. **Failing test first:** `tauri.conf.json` schema check asserting
   `createUpdaterArtifacts` + `plugins.updater` + capability rows exist together.
2. Rust: `tauri-plugin-updater` + `tauri-plugin-process`, registered in `lib.rs`;
   capabilities gain `updater:default`, `process:allow-restart` (doc comment updated —
   the capability inventory in `lib.rs` is normative prose now).
3. Web: `@tauri-apps/plugin-updater` in the Settings sheet — "Check for updates" button,
   state machine (idle/checking/up-to-date/available/downloading/ready→restart), opt-in
   startup check (default off, stored in localStorage next to appearance prefs).
4. CI picks up signing automatically (R2 wired the env); `tauri-action` emits
   `latest.json` into the release.
5. Acceptance: installed previous version sees the next version's `latest.json`, verifies
   the signature, installs, relaunches — measured on macOS arm64, named limits elsewhere.

## R6 — First real release runbook

Tag `app-v0.1.0` → workflow run → release page artifacts → cask sha256 → tap push (owner).
Recorded in `docs/evidence/` per the house rule: a release that was not watched end-to-end
is not a verified release.
