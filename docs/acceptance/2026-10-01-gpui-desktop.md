# Acceptance — GPUI desktop (2026-10-01)

Status legend: PASS / PARTIAL / BLOCKED / NOT RUN. Every cell reports what was actually
measured on 2026-10-01/02 on macOS (darwin 27, arm64, rustc 1.98.1); the commands and
observations are named in `docs/evidence/2026-10-01-gpui-desktop.md`. Nothing is marked
PASS without evidence; PARTIAL names exactly what is missing.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| A01 | `refyard-gpui` binary builds and launches a window with no terminal interaction | PASS | build + launch screenshots `01-launcher-boot.png`; missing-git start fails on stderr by construction (same composition as the Tauri shell) |
| A02 | Lane layout port pinned by the TypeScript test properties, including the `xross-e8e312` fixture and page-continuation equivalence | PASS | `cargo test -p refyard-graph`: 58 passed, including the fixture splits 100/240/247/260 |
| A03 | Geometry port pinned (metrics, compression floors, segment kinds, shifted lanes) | PASS | same suite (geometry + head modules) |
| A04 | History graph renders per-row from the ported geometry: dots on their lanes, merge curves leave/enter vertically, surviving lanes do not wobble | PASS | screenshot `03-history-graph.png`; rendered topology matches the fixture repo's `git log --graph` (merge curve, stable side lane, convergence) |
| A05 | Pagination continues lanes across pages; a page boundary does not restart the graph | PASS (logic) / NOT RUN (visual) | continuation folding is pinned by tests (A02); a >1-page repository was not scrolled in the UI this round |
| A06 | Launcher: registered repositories listed, folder browsable via rfd, recent persisted | PASS (list + recents) / PARTIAL (picker) | recents file verified on disk and rendered; the rfd picker opens the OS panel but could not be clicked through without UI automation |
| A07 | Changes: stage/unstage per path and bulk with previews flow; commit writes with snapshot binding | PARTIAL | panel verified rendering with correct sections (`02-changes-panel.png`); the submit path is the store machinery shared with the verified reads, but no mouse click-through of a real stage/commit happened (no UI automation) |
| A08 | Destructive operations only when advertised by `capabilities()`, behind explicit confirmation; no discard UI if the host does not register the effect | PASS | this host build advertises no `discardTrackedPaths`; the changes panel offers no discard control (module-documented, visible in `02`); branch delete renders its confirmation only from an explicit trash click (code path; not clicked) |
| A09 | Events drive refresh: an operation performed in-app updates status/history/refs without manual reload; problems surface as messages | PASS (mechanism) / PARTIAL (end-to-end) | the pump consumes `subscribe_events()` live for the whole session; the store's handle_event re-reads status/refs/history on terminal operations — the refresh-after-mutation loop was not triggered end-to-end because no mutation was clicked through |
| A10 | History filters (message/author) and commit detail (body + changed files) work | NOT RUN | toolbar renders (`03`); typing requires keyboard automation that was unavailable |
| A11 | Branches: list + capability-gated mutations with confirmations | PARTIAL | list, upstream badges, Switch on non-current, no switch/delete on current — all verified in `04-branches-panel.png`; actual switch/create/delete not clicked through |
| A12 | No Node/JS runtime, no HTTP listener, no sidecar in the GPUI binary's dependency tree | PASS | `Cargo.lock` of the shell contains no JS engine, no axum/hyper server, no node; traffic is in-process function calls + channels |
| A13 | Dark and light themes; lane colours legible on both | PARTIAL | dark verified in every screenshot (custom palette + lane colours); light theme palette is defined but not screenshotted |
| A14 | Headless crates never depend on gpui (`crates/refyard-graph` builds in the root workspace without the GUI graph) | PASS | `crates/refyard-graph` is a root-workspace member with zero dependencies outside dev-deps serde/serde_json; the shell is a separate workspace consuming it by path |
| A15 | Linux / Windows behaviour | NOT RUN | macOS-only round; gpui's platform story for those platforms is upstream's |
