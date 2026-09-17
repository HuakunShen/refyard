# Native desktop host — what runs, what was measured, what is still open

Worktree `refyard-native-desktop-ssh`, branch `feat/native-desktop-ssh`. This record covers the
Tauri host (D05) and the local picker read. The launched application is a milestone of its own and
is recorded separately; anything not measured here is named as unverified rather than assumed.

## What exists now

| Piece | Where |
|---|---|
| Rust application service (status, history, refs, diff, repositories, filesystem) | `crates/refyard-host/src/service.rs` |
| Tauri host: ten commands, session ownership, event registry | `apps/desktop/src-tauri/src/{lib,commands,dispatch,session,events}.rs` |
| Native backend adapter (transport-neutral, injected ports) | `packages/backend-tauri/src/` |
| Desktop build: separate SPA output, then the bundle | `scripts/build-desktop.ts` |

## The application bundle

Built with `pnpm desktop:build` (which is `bun scripts/build-desktop.ts`). The frontend is built
into `apps/web/build-desktop` first — a directory of its own, with SvelteKit's own
`.sveltekit-desktop` working directory — and then Tauri compiles the host around it. The order is
deliberate: Tauri embeds that directory at compile time, so building the app first would embed the
previous frontend.

| Fact | Value |
|---|---|
| Bundle | `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app` |
| Installed bytes | 12 MiB (measured by walking the bundle, not by `stat` on the directory) |
| Executable | `Contents/MacOS/refyard-desktop`, 11.7 MB |
| Bundle identifier | `dev.refyard.desktop` (a placeholder: `refyard` is a working name and no domain is owned) |
| Bundle contents | the executable, `Info.plist`, `Resources/icon.icns` — no `Frameworks/`, no sidecar, no asset directory |
| Linked libraries | WebKit, AppKit, ApplicationServices, CoreGraphics, CoreVideo, Carbon, CoreFoundation, Foundation, libSystem, libiconv, libobjc — all system frameworks |

The frontend is compiled into the executable, which is why there is no asset directory and why the
app needs nothing installed beside it. This is also the mechanical reason there is no Node here:
the dependency list of `apps/desktop/src-tauri/Cargo.toml` contains no JavaScript engine, no HTTP
server and no sidecar.

## Properties that are structural of a build, not configured

- **No general-purpose plugin.** No shell, filesystem, dialog, http or opener plugin is a
  dependency, so there is no command from one to grant. The window's only Tauri capability is
  `core:event:default`, whose contents are exactly `allow-listen` and `allow-unlisten` — the pair
  the adapter subscribes with.
- **Remote content cannot reach the commands.** Tauri refuses custom commands from a non-local
  origin on its own; the app also sets `withGlobalTauri: false`, loads only the embedded assets,
  and ships a CSP with `object-src 'none'`, no remote script, and `connect-src` limited to the IPC.
- **The WebView is untrusted about scope.** Every command takes the caller's window label and
  checks it against the session registry before doing anything; the write commands are refused
  *after* that check, not before it, so a refusal never teaches a caller that the gate is
  optional.

## Verification, as actually run

| Command | Result |
|---|---|
| `cargo test --workspace` | 291 passed (23 contract, 140 core, 90 host lib, 6 environment, 10 process, 11 reads, 11 filesystem) |
| `cargo test -p refyard-desktop` | 16 passed — the production command bodies against a real fixture repository |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo fmt --all --check` | clean |
| `pnpm exec vitest run tests/adapters` | 30 passed (13 native + 17 http/conformance) |
| `pnpm exec vitest run tests/native/differential.test.ts` | 28 passed |
| `pnpm desktop:build` | bundle produced at the path above |

The 16 desktop tests drive the same `pub` functions the `#[tauri::command]` wrappers call, with a
label in place of a window: the owner gate (a second window cannot read through, end or unsubscribe
another window's session), an unknown method, an unknown field, a foreign target, an unimplemented
read, every write refusal, and the event frame's four filter fields. Tauri's argument extraction is
the one part those tests do not exercise, and it decides nothing.

The picker read is not in the differential oracle, and cannot be: its answer *is* a set of absolute
paths, and the two implementations run against different temporary directories, so no normalisation
that still compares paths honestly could make them equal. It is covered by the eleven Rust tests
above and by the adapter's schema validation at the boundary.

## Not verified — do not read this as done

- **No window has been opened yet at this point in the record.** The bundle exists and its
  structure is measured; a screenshot, a process tree, a launch from Finder and the UI script from
  the acceptance document are all still open.
- **The picker's Browse flow inside the window** has not been driven end to end; its read is tested
  at the service and command level only.
- **SSH targets, writes, previews and the write journal** are not implemented in the native host at
  all. Capabilities omit them and the commands refuse them by name.
- **Only macOS arm64** has been exercised. The icons are macOS-shaped (`.icns`, PNGs); no `.ico`
  exists and no Windows or Linux bundle has been produced or run.
- **Git version.** The differential recordings were made with this machine's Git 2.50.1 (Apple
  Git-155). A different Git can change a fixture object name; the comparison fails loudly with both
  sides printed and re-running the export re-records it.
