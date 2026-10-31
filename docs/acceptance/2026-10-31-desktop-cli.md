# Acceptance — desktop command line (2026-10-31)

Status legend: PASS / PARTIAL / BLOCKED / NOT RUN. Everything below was measured on
2026-11-01 on macOS (darwin, arm64, rustc 1.98, Node 26.8.2) in this working tree. A row is
never marked PASS for a platform or a click that was not actually performed; PARTIAL names
exactly what is missing.

Spec: `docs/superpowers/specs/2026-10-31-desktop-cli.md`
Plan: `docs/superpowers/plans/2026-10-31-desktop-cli.md`

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| A01 | `refyard [directory…]` parses operands, `--`, `-h`, `-V`; an unknown option is a usage error, not a directory | PASS | `cargo test -p refyard-launcher` → 13 passed, including `--deep` as exit-2 usage and `-- -odd-name` as a directory |
| A02 | No operand opens `.`; operands keep their order and are not deduplicated | PASS | same suite (`args::tests`) |
| A03 | The launcher finds the app inside the bundle, and refuses to answer with itself | PASS | same suite (`launch::tests`), including the case-insensitive-volume guard |
| A04 | A launcher reached through a `PATH` symlink still finds its bundle | PASS | regression test `a_command_installed_on_path_reaches_its_bundle_through_the_link`; the bug was real — macOS `current_exe` returns the link, so the search looked beside `~/.local/bin`. Verified end to end via a temp-dir symlink to the built launcher: `--version` → `refyard 0.1.0`, exit 0 |
| A05 | A missing or non-directory operand is refused at the prompt, naming the operand | PASS | same build through the symlink: `refyard /definitely/not/here` → `refyard: cannot open /definitely/not/here (No such file or directory (os error 2)); pass a directory that exists`, exit 1 |
| A06 | The launcher starts the window and returns to the prompt without waiting | PASS (unit) / NOT RUN (GUI) | `main.rs` spawns and returns; no test waits on a window. A real window was not opened from the launcher this round (A12) |
| A07 | The host queues a cold-start launch and answers the page's single ask | PASS | `cargo test --test launch_channel` → 2 passed: both operands drained once, refusals travel, a second ask returns empty |
| A08 | A window that does not own the session cannot drain the queue | PASS | same suite, second case |
| A09 | A second `refyard <dir>` reaches the running window | PARTIAL | the official `tauri-plugin-single-instance` is registered first in the builder and its callback builds the same `LaunchRequest` + emits `refyard://launch`; the adapter's listener, its unsubscribe, and its refusal of an unreadable frame are pinned by `tests/adapters/tauri.test.ts` (18 passed). Two real processes forwarding a launch was not observed (an older `/Applications/Refyard.app` instance, pid 78304, is running and would receive it instead of the new build) |
| A10 | The page opens a launched directory through `registerRepository`, with the execution target temporarily local | PASS (code + type check) / NOT RUN (click-through) | `apps/web/src/routes/+page.svelte` (`handleLaunchRequest`) routes every directory through `handleOpenRepository`; `pnpm check` exit 0. Not exercised against a live window |
| A11 | A refusal is shown to the person instead of being dropped | PASS (contract + adapter) / NOT RUN (visual) | `launchRequestSchema` refuses a refusal without `problem` and refuses an answer carrying `argv`; `tests/contract/native-backend.test.ts` (43 passed). The banner itself was not seen in a window |
| A12 | Settings → Command line installs `~/.local/bin/refyard` and reports where it went | PARTIAL | install logic is covered by crate tests (writes only `~/.local/bin`, never overwrites a regular file, replaces its own symlink, answers `installed`/`commandPath`/`onPath`/`message`, refuses when no bundled launcher exists). The Settings button was **not** clicked in a real window — doing so would write into this machine's real `PATH` |
| A13 | The installer is advertised only where it exists | PASS | `HostCapabilities.cliCommandInstaller` is required by `hostCapabilitiesSchema` (a missing flag fails validation) and is `false` on Windows (`cfg!(unix)`), in legacy HTTP answers, and in every e2e fake host; `pnpm check:contract` exit 0 (593 named schemas) |
| A14 | The bundle carries both executables | PASS | `pnpm desktop:build` → `Refyard.app/Contents/MacOS/{refyard-desktop, refyard-launcher}` (18632768 / 484176 bytes) |
| A15 | Both build entries stage the launcher before bundling | PASS | `scripts/build-desktop.ts` runs `scripts/stage-launcher.ts` before `tauri build`; `.github/workflows/release.yml` runs it per matrix `triple` before tauri-action. The local build is the evidence that the staging path is the one Tauri embeds |
| A16 | `pnpm desktop:build` completes locally | PARTIAL | the `.app` is produced; the command then exits 1 at the DMG/updater step — no `TAURI_SIGNING_PRIVATE_KEY` on this machine, and one run failed inside `bundle_dmg.sh`. Pre-existing local limitation, unrelated to this change |
| A17 | Type checks, unit tests, and Rust suites stay green | PASS | `pnpm check` exit 0 (0 errors, 2 pre-existing a11y warnings in `CommitList`); `pnpm check:boundaries` exit 0; `pnpm test:unit` 638 passed / 62 files; `cargo test --workspace` exit 0; `cargo test` in `apps/desktop/src-tauri` exit 0 (lib 13, launch_channel 2, session_owner 25, terminal 3, 1 pre-existing ignored) |
| A18 | Windows and Linux launch + install | NOT RUN | neither platform was built or run in this round; Windows install is `false` by construction, so only the launcher's own parsing applies there |
| A19 | The hosted browser form gains no command line | PASS (by construction) | `HostService.takeLaunchPaths`/`onLaunchPaths`/`installCliCommand` are optional and the HTTP adapter implements none of them; `cliCommandInstaller` is `false` in `packages/backend-http/src/legacy-capabilities.ts` |

## What a reader should click through

The three rows marked NOT RUN for the interactive half are ordinary desktop interactions that
this round had no automation for, and one of them mutates the person's `PATH`:

1. quit the running `/Applications/Refyard.app`, run the built bundle, and use Settings →
   Command line to install the command;
2. from a repository at a prompt, `refyard .` — the tab should appear in the already open window;
3. `refyard ./typo` — a banner should quote `./typo` and the missing-directory reason.

## Defects found and fixed

- `std::env::current_exe()` on macOS reports the `~/.local/bin/refyard` symlink, not the binary
  inside the bundle, so the launcher searched for the app beside the link and reported
  "no Refyard application beside this command" for every PATH install. The launcher now
  canonicalises its own path first; the regression test uses a real symlink layout.
- `ExternalBin` naming: the sidecar is `refyard-launcher` because macOS volumes are
  case-insensitive and `Refyard`/`refyard` in one `Contents/MacOS` are the same file. The first
  attempt named it `refyard` and the app and command collided.

## Unverified platforms

Windows, Linux (any architecture), and every non-macOS-arm64 bundle. `node`-side suites and the
Rust suites were run only on macOS arm64.
