# Plan — desktop command line

Date: 2026-10-31
Spec: `docs/superpowers/specs/2026-10-31-desktop-cli.md`
Acceptance: `docs/acceptance/2026-10-31-desktop-cli.md`

Order matters: the bundled command and the host channel exist and are tested before the page can
ask for them, and the page wiring exists before the bundle is built.

## L01 — the bundled `refyard` command

`crates/refyard-launcher` (`bin refyard-launcher`, lib `refyard_launcher`):

- `args.rs` — `refyard [directory…]`, `--`, `-h`, `-V`; an unknown option is a usage error with
  exit 2, never a directory named `--deep`; no operand means `.`.
- `launch.rs` — `program_for` finds the app inside the bundle or beside a flat install, and
  refuses to answer with the launcher itself (case-insensitive volumes make `Refyard` and
  `refyard` one file); `resolve_directories` resolves against the caller's cwd and requires an
  existing directory.
- `main.rs` — parse, plan, spawn, return to the prompt. It never waits for the window.

Verification: `cargo test -p refyard-launcher` → 12 passed.

## L02 — the host launch channel

`apps/desktop/src-tauri/src/launch.rs`:

- `LaunchRequest { directories, refused }` and `LaunchQueue` (answered once per launch).
- `request_from(arguments, cwd)` resolves operands against the caller's directory, classifies
  `-psn_*` as a platform artefact (ignored, not reported) and any other option as a refusal.
- `deliver` queues and emits `refyard://launch`, and shows/focuses the window.
- `lib.rs` registers `tauri-plugin-single-instance` first, queues `std::env::args()` in `setup`,
  and registers `refyard_take_launch_paths`.

Verification: `cargo test --lib` in `apps/desktop/src-tauri` → 13 passed, including the queue
and classification cases.

## L03 — the installed `refyard` command

`apps/desktop/src-tauri/src/cli_command.rs`:

- `bundled_launcher(current_exe)` finds the sidecar beside the app.
- `install` writes `~/.local/bin/refyard` as a symlink to it; never overwrites a regular file;
  replaces only a symlink (its own artefact).
- `install` answers `{ installed, commandPath, onPath, message }`, with the `export PATH=…` line
  when `~/.local/bin` is not on the host process's PATH.
- Windows: no registry write, so `install` refuses and `capabilities.cliCommandInstaller` is
  `false`.

Wired as `HostRequest::InstallCliCommand` in `dispatch.rs`.

Verification: `cargo test --lib` cases for install/again/foreign file/no bundle/launcher lookup —
all passed.

## L04 — contract and adapters

- `HostCapabilities.cliCommandInstaller` (TS + Rust), `LaunchRequest`, `CliCommandInstall`.
- `HostService.takeLaunchPaths?`, `onLaunchPaths?`, `installCliCommand?` — optional, so the browser
  adapters do not grow a command line.
- `@refyard/backend-tauri`: `refyard_take_launch_paths` in `NATIVE_COMMANDS`, host response
  schema, the three methods, and `LAUNCH_EVENT`.
- Legacy HTTP capability answers report `cliCommandInstaller: false`.

Verification: `pnpm check`, `pnpm check:contract`; `tests/adapters/tauri.test.ts` (5 new cases)
and `tests/contract/native-backend.test.ts` (6 new cases).

## L05 — page and settings

- `apps/web/src/routes/+page.svelte`: cold-start ask, warm-start listener, opening through
  `handleOpenRepository` with the target temporarily local, a refusal banner with a close action,
  host capability probe, and the install action.
- `SettingsDialog.svelte`: a **Command line** section rendered only when
  `cliCommandInstaller` is true; the host's message is shown verbatim.
- `messages/{en,zh}.json`: four keys, then paraglide regenerated.

Verification: `pnpm check` (svelte-check), `pnpm test:unit`.

## L06 — packaging and release

- `scripts/stage-launcher.ts <triple>` builds and stages
  `apps/desktop/src-tauri/binaries/refyard-launcher-<triple>`.
- `bundle.externalBin: ["binaries/refyard-launcher"]`.
- `scripts/build-desktop.ts` runs the stage step before `tauri build`.
- `.github/workflows/release.yml` gains a `triple` per matrix entry and runs the stage step before
  tauri-action.

Verification: `pnpm desktop:build` produced the app bundle containing both executables (the run
then failed at updater signing, which needs a private key that a local build does not have).

## L07 — documentation

Spec (this package), installation section, and the acceptance matrix. Every unexercised platform
is named there instead of being implied to work.
