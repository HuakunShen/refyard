# GPUI desktop design — 2026-10-01

## Status

Directed by the user on 2026-10-01: build a **GPUI-native desktop front-end** for Refyard, the
way `~/ExtDev/space-lens` (not ListenFlow — that repository is a mobile monorepo) built its GPUI
shell. This design does not re-open the 2026-09-18 decision that closed Wails/Go/Electron/Node
sidecar; GPUI is an **additional native form** that reuses the same Rust service the Tauri shell
uses. The Tauri app remains shipped and supported; nothing in it regresses.

## Decision record

| Decision | Choice | Why |
| --- | --- | --- |
| UI framework | `gpui-kit = "0.7"` (meta crate: `gpui-pre =0.3.7` GPUI snapshot, `gpui-component 0.7`, `gpui-base 0.7`, default assets) | One dependency, crates.io-published, verified API surface; the Zed-official `gpui` 0.2.2 crate is older and must never be mixed into the same graph |
| Composition root | `refyard_host::service::ApplicationService` in-process | Same service the Tauri shell drives; no IPC, no HTTP, no sidecar. The GPUI app is a host, not a second implementation |
| Async bridge | One `tokio` multi-thread runtime owned by the app; service futures spawn on it; results cross to the UI thread over `smol::channel`; UI polls in `cx.spawn` with generation counters | `ApplicationService` is tokio-native (`tokio::process`, `tokio::sync::broadcast`); GPUI's executor cannot drive tokio reactors. The pattern is the space-lens verified pattern (generation discard, both `recv` arms reset UI state) |
| Events | `service.subscribe_events()` polled inside one tokio task, forwarded over an unbounded `smol::channel`, consumed by a `cx.spawn` loop on the root view | Mirrors the Tauri relay (`apps/desktop/src-tauri/src/relay.rs`) minus IPC |
| Lane layout | Port `packages/git-graph` (`layout.ts`, `pages.ts`, `refColorFor`) to a new headless crate `crates/refyard-graph`, pinned by the same properties and the `xross-e8e312.json` fixture | The graph is the product's hardest surface; it must stay host-free, testable without a window, and identical in behaviour to the web graph |
| Graph rendering | GPUI `canvas` element per history row + `PathBuilder::stroke` / `PathBuilder::fill` (`gpui-pre 0.3.7` supports stroked paths) | Row-local geometry ported from `packages/git-ui/src/lib/geometry.ts`; the row height is one number shared by the list and the geometry, as in the web app |
| Folder picking | `rfd::AsyncFileDialog` via `cx.spawn_in` (main thread) | Replaces the Tauri dialog plugin; the OS picker is a host capability, never a request field |
| Theme | Dark by default (`Theme::change(ThemeMode::Dark, None, cx)` after `gpui_kit::init`), light toggle in the toolbar | Matches the workbench's dark-first aesthetic; `toggle_mode` does not exist in 0.7 |
| App crate | `apps/desktop-gpui` — its own cargo workspace (empty `[workspace]` table), binary `refyard-gpui` | Same precedent as `apps/desktop/src-tauri`: the Metal/winit dependency graph must never sit in the headless crates' build |
| Scope for this round | Local repositories: launcher, changes (stage/unstage/commit, capability-gated discard), history + graph + detail, branches, stashes, events-driven refresh, theme | The SSH provider keeps working through the same service but no SSH UI this round; recorded honestly in the acceptance matrix |

## Non-goals / untouched

- The Node service, SvelteKit SPA, HTTP adapter, Tauri shell and their tests do not change.
- `packages/git-graph` (TypeScript) stays the web renderer's source; the Rust crate is a port
  with its own tests, not a shared build artifact.
- No new HTTP surface, no pairing, no browser bridge. The GPUI binary contains no JS runtime,
  no HTTP listener, and never builds argv outside `refyard-core` planners (via the host).

## Safety rules carried over unchanged

Capability honesty (render only what `capabilities()` advertises), one writer per common Git
directory (inside the host queue), destructive operations behind explicit `confirmed: true`
requests surfaced by a dialog, previews/snapshot binding honored (`expected_snapshot_id` from the
live status snapshot), unknown results surface as unknown and block further writes until
acknowledged, no fabricated verification.

## UI shape

Single window (1360×900, min 960×600), phases:

1. **Launcher** — registered repositories, browse for a folder (`rfd`), recent-repository
   persistence under the host's state root (`gpui-ui.json`).
2. **Workbench** — left sidebar (repository header: branch, ahead/behind; sections Changes,
   History, Branches, Stashes rendered only when the host advertises them), main area, bottom
   status line (operation progress, last problem).

- **Changes**: staged / unstaged / untracked lists, click to preview diff, stage/unstage per
  path and in bulk, commit box (message, Cmd+Enter), discard offered only when the host
  advertises `discardTrackedPaths`.
- **History**: virtualized rows; per-row graph canvas painted from the ported geometry; ref
  pills; message/author filters; load-more continues the lanes; commit detail panel with body
  and changed files.
- **Branches / Stashes**: read lists plus the mutations the host advertises (switch, create,
  delete with confirmation; apply/pop/drop with confirmation).

## Repository layout additions (§4)

```
crates/refyard-graph/      pure-TS lane layout ported to Rust: layout, pages, geometry,
                           head segment — no host APIs, no gpui
apps/desktop-gpui/         GPUI shell: binary refyard-gpui, own cargo workspace
```
