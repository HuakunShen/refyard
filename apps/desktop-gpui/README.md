# refyard-gpui — the GPUI desktop shell

A native macOS desktop front-end for Refyard, built with [gpui-kit] 0.7 (GPUI itself is
the crates.io `gpui-pre =0.3.7` snapshot of zed-industries/zed). It drives the same
`ApplicationService` the Tauri shell drives — in-process, over an owned tokio runtime.
No IPC, no HTTP listener, no sidecar, no JavaScript runtime in the product.

## Run

```sh
cd apps/desktop-gpui
cargo run --release            # launcher
cargo run --release -- /path/to/repo   # straight into a workbench
```

macOS 15+ with Xcode Command Line Tools; Rust 1.92+ (the repository pins 1.98). First
build compiles the whole GPUI stack — minutes are normal.

The shell is its own cargo workspace on purpose, like `apps/desktop/src-tauri`: the
Metal/winit dependency graph must never sit in the headless crates' build, and the root
release profile is not this binary's profile.

## What it does today

- **Launcher** — registered repositories, the OS folder picker (`rfd`), recent paths
  persisted under the host's state root (`gpui-ui.json`).
- **Workbench** — sidebar (capability-gated: a panel is only listed when the host
  advertises its read), status line, event-driven refresh (the host's event stream
  invalidates exactly what changed).
- **Changes** — staged / unstaged / untracked lists, per-path and bulk stage/unstage
  through the host's preview fingerprints, commit box (Enter commits), diff preview per
  selected path. Destructive discard renders only if the host advertises it — this host
  build registers no discard effect, so no discard control appears.
- **History** — the commit graph. Lane layout and pixel geometry are ported to the
  headless crate `crates/refyard-graph` and pinned by the same test properties (and the
  `xross-e8e312` fixture) as the web renderer's `packages/git-graph`; the shell paints
  the tested segments on a per-row GPUI canvas. Message/author filters, lane-continuous
  pagination, auto-fetch near the end of the list, commit detail with message and
  changed files.
- **Branches** — list with upstream tracking, create (with optional switch), switch,
  delete behind an explicit confirmation.

## Layout

```
src/main.rs          entry point: host → application → theme → window
src/composition.rs   the one place a host is built (mirrors the Tauri composition root)
src/bridge.rs        the tokio ↔ GPUI executor bridge and its invariants
src/store.rs         one repository's data store: reads, mutations, event pump
src/theme.rs         the macOS-flavoured palette, lane colours, owned Palette copies
src/app_state.rs     the window's phase machine: launcher ⇄ workbench
src/views/           launcher, workbench, changes, history, branches, diff renderer
```

## Conventions this shell follows

- Only `Send` data crosses the tokio bridge; results land on the UI thread through
  `smol` channels polled in `cx.spawn`, both `Ok` and closed-channel arms reset UI
  state, stale generations are discarded.
- Every state change ends in `cx.notify()` — emit alone does not repaint.
- Capability honesty: the UI renders what `capabilities()` advertises, never a
  requested-but-unregistered operation.
- `crates/refyard-graph` is host-free and GPUI-free; `cargo test -p refyard-graph`
  (repository root) pins the graph.

[gpui-kit]: https://gpui-kit.com
