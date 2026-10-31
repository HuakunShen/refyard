# Desktop command line — `refyard <directory>`

Date: 2026-10-31
Status: implemented; macOS arm64 exercised, Windows/Linux install not run (see
`docs/acceptance/2026-10-31-desktop-cli.md`).

## Problem

The desktop app starts with whatever it last remembered. A person standing in a repository at a
prompt expects `code .`-style behaviour: name a directory, get a window on it. Nothing in the
bundle made that possible, and there was no way to put a `refyard` command on `PATH` without the
person writing an alias themselves.

## Shape

Two executables ship inside the bundle:

| File inside the bundle                     | What it is                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `Refyard` (macOS `Contents/MacOS/Refyard`) | the window                                                                       |
| `refyard-launcher` (same directory)        | `refyard [directory…]` — resolves the operand list and starts the window with it |

The command a person types is `refyard`. It is **a symlink** in `~/.local/bin` pointing at the
bundled `refyard-launcher`, installed from Settings → Command line. The link is the only thing
written outside the app bundle, and it is written only when the person clicks the button.

The bundled binary carries the long name for a platform reason, not a preference: macOS volumes
are case-insensitive by default, so `Refyard` (the app) and `refyard` in the same `Contents/MacOS`
would be one file. A first attempt that named the sidecar `refyard` failed exactly that way.

## Flow

```
refyard .                      (link in ~/.local/bin)
  → refyard-launcher           resolves cwd/. to an absolute directory, finds the app beside itself
  → exec Refyard <absolute>    (no `open -a`: `open -a --args` is not forwarded to a running app)
  → Refyard's Rust setup        reads argv, queues a LaunchRequest
  → webview asks refyard_take_launch_paths once
  → page registers each directory through registerRepository
```

A second `refyard <dir>` while the app runs is forwarded by the official
`tauri-plugin-single-instance` plugin, registered first in the builder as its documentation
requires. The callback receives the second process's argv and cwd, turns them into the same
`LaunchRequest`, and both queues it (so a reload during the launch still finds it) and emits
`refyard://launch` for the page that is already listening.

## Trust model

The launch channel is a **local** channel, in the same class as the `p` keystroke that mints a
pairing ticket: argv comes from a process the person started at their own terminal. What can
arrive is an operand list and nothing else — no command, no environment, no shell text. The host
resolves each operand to an absolute directory and _offers_ it to the page; the page registers it
through the same `registerRepository` call the folder picker's answer uses. The channel therefore
cannot reach a repository the person did not name, and it cannot make the page run anything.

The page clears the selected execution target while opening a launched directory, exactly as it
does for a dropped folder: the path was typed on this machine, so opening it "on" a remote host
would answer a different question.

Refusals are part of the answer. `refyard ./typo` produces
`refused: [{ named: "./typo", problem: "no directory at …" }]`, which the window shows in a
banner with the operand quoted. A launch that silently opened nothing would be worse than one
that reports the mistake.

## Why not `tauri-plugin-cli`

The official CLI plugin was evaluated first and rejected for this shape:

- it parses against a clap definition compiled from `plugins.cli` in `tauri.conf.json`, so the
  operand list would live in configuration rather than beside the code that resolves it;
- a positional argument with `multiple: true` is mapped to `ArgAction::Append`, and a mixed
  option/operand vector silently loses entries in that mapping — the exact failure mode this
  command cannot afford;
- the plugin's parser calls `exit` for help/version and owns the usage text, which leaves the
  launcher's own wording untestable.

The official **single-instance** plugin _is_ used: forwarding a second launch is precisely its
job, and its documented callback signature (argv + cwd) is what the launch request needs.

## PATH install

- Writes only `~/.local/bin/refyard` (Unix), a symlink to the bundled launcher; no administrator
  prompt, no system directory.
- An existing regular file at that path is **never** overwritten — it is somebody else's command
  and the answer says so. Only a symlink is replaced, which makes a repeat install a no-op and
  repairs a link left by an app that has since moved.
- The answer reports `installed`, `commandPath`, `onPath`, and a `message`. `onPath` is the host
  process's `PATH`, not the person's login shell's, so a false answer includes the
  `export PATH=…` line rather than asserting what their shell will do.
- Windows would need a registry write to extend the user `PATH`; this build does not do it, so
  `capabilities.cliCommandInstaller` is `false` there and the Settings section is absent.

## Capability and contract

- `HostCapabilities.cliCommandInstaller` — new required boolean; legacy HTTP capability answers
  report `false`.
- `LaunchRequest` — `{ directories: string[], refused: { named, problem }[] }`, validated by the
  adapter before the page sees it.
- `CliCommandInstall` — `{ installed, commandPath, onPath, message }`.
- `HostService.takeLaunchPaths`, `HostService.onLaunchPaths`, `HostService.installCliCommand` are
  optional: a browser adapter has no command line and does not grow one.

## Build

`scripts/stage-launcher.ts <triple>` builds `refyard-launcher` and copies it to
`apps/desktop/src-tauri/binaries/refyard-launcher-<triple>`, which is what Tauri's
`bundle.externalBin` embeds. `scripts/build-desktop.ts` runs it before `tauri build`; the release
workflow runs it with the matrix's `triple` before tauri-action. Building the bundle without it
embeds a stale command or fails.

## Out of scope

- GPUI shell (`apps/desktop-gpui`): no launch channel or settings surface there.
- Windows PATH installation (above).
- Opening a directory from the _hosted_ browser form: there is no local process to have a command
  line, and its capability answer stays `false`.
