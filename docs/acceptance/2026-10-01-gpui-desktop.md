# Acceptance — GPUI desktop (2026-10-01)

Status legend: PASS / PARTIAL / BLOCKED / NOT RUN. Every cell is reported as measured on
2026-10-01/02 on macOS (darwin 27, arm64, rustc 1.98.1). Nothing is marked PASS without the
command or observation named in `docs/evidence/2026-10-01-gpui-desktop.md`.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| A01 | `refyard-gpui` binary builds and launches a window with no terminal interaction | NOT RUN | |
| A02 | Lane layout port pinned by the TypeScript test properties, including the `xross-e8e312` fixture and page-continuation equivalence | NOT RUN | |
| A03 | Geometry port pinned (metrics, compression floors, segment kinds, shifted lanes) | NOT RUN | |
| A04 | History graph renders per-row from the ported geometry: dots on their lanes, merge curves leave/enter vertically, surviving lanes do not wobble | NOT RUN | |
| A05 | Pagination continues lanes across pages; a page boundary does not restart the graph | NOT RUN | |
| A06 | Launcher: registered repositories listed, folder browsable via rfd, recent persisted | NOT RUN | |
| A07 | Changes: stage/unstage per path and bulk with previews flow; commit writes with snapshot binding | NOT RUN | |
| A08 | Destructive operations only when advertised by `capabilities()`, behind explicit confirmation; no discard UI if the host does not register the effect | NOT RUN | |
| A09 | Events drive refresh: an operation performed in-app updates status/history/refs without manual reload; problems surface as messages | NOT RUN | |
| A10 | History filters (message/author) and commit detail (body + changed files) work | NOT RUN | |
| A11 | Branches and stashes read + capability-gated mutations with confirmations | NOT RUN | |
| A12 | No Node/JS runtime, no HTTP listener, no sidecar in the GPUI binary's dependency tree | NOT RUN | |
| A13 | Dark and light themes; lane colours legible on both | NOT RUN | |
| A14 | Headless crates never depend on gpui (`crates/refyard-graph` builds in the root workspace without the GUI graph) | NOT RUN | |
| A15 | Linux / Windows behaviour | NOT RUN | not exercised this round |
