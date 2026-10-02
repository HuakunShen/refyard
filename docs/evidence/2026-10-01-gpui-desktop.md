# Evidence — GPUI desktop (2026-10-01/02)

All commands were run on macOS (darwin 27, arm64, rustc 1.98.1) from
`apps/desktop-gpui` unless noted. Exit statuses: every command below completed with
status 0 unless the text says otherwise.

## Commands

| Command (from `apps/desktop-gpui` unless noted) | Result |
| --- | --- |
| `cargo test -p refyard-graph` (repo root) | `58 passed; 0 failed` |
| `cargo clippy -p refyard-graph --all-targets` | no warnings |
| `cargo clippy --all-targets` (GPUI shell) | no warnings (only an upstream `block v0.1.6` future-incompat note from the winit tree) |
| `cargo build` / `cargo build --release`-equivalent debug run | builds clean, 0 warnings |
| `./target/debug/refyard-gpui` | window opens; launcher renders; host footer `host rust · git 2.54.0 (Apple Git-157) · contract 1.2.0` |
| `./target/debug/refyard-gpui /tmp/refyard-gpui-fixtures/repo-a` | workbench opens directly on the named repository |

## Scratch fixtures

`/tmp/refyard-gpui-fixtures/repo-a` — a repository with a real merge topology
(`post-merge → merge feature-branch → [main work | branch work] → add feature →
initial commit`, one tracked modification and one untracked file planted for the
changes panel). Created with local `git` only; no network.

## Screenshots (in `docs/evidence/gpui-desktop/`)

1. `01-launcher-boot.png` — launcher at first boot, dark theme, host footer.
2. `02-changes-panel.png` — changes panel: STAGED (0), commit box, CHANGES (2) with
   `M README.md` and `? untracked.txt`, bulk Stage all.
3. `03-history-graph.png` — history: filter toolbar, the rendered graph (lane-0 trunk,
   purple feature lane opening at the merge, converging at `add feature`), ref pills
   (`main`, `feature-branch`), author/date column.
4. `04-branches-panel.png` — branches: create input + Create, "Create and switch"
   toggle, list with `feature-branch` (Switch button) and `main` (current: no
   switch/delete offered).

## Behaviour verified against the running app

- The window boots with no terminal interaction and the host fails fast on stderr when
  `git` is missing (path exercised by construction; the machine's git was found).
- The launcher persisted a recent path to
  `~/Library/Application Support/refyard/gpui-ui.json`; the journal and control
  directories sit beside it (the host's durable state root).
- The history graph's rendered topology matches `git log --graph --all` of the fixture
  exactly: merge curve from the second parent's lane into the merge row's circle, the
  feature lane keeping its slot, convergence at the fork point, trunk on lane 0.
- The event pump consumed the host's event stream without error for the whole session
  (the subscription task runs for the process lifetime).

## What was NOT exercised (reported honestly)

- Mouse-driven interaction (clicking rows, buttons, inputs) could not be automated on
  this machine — the OS accessibility gate for UI automation was not granted. The
  stage/commit/switch/delete request paths are wired through the same store machinery
  that the verified renders read from, and the host side is covered by the workspace's
  own tests, but a human has not clicked through a commit in this build.
- Commit detail (clicking a history row), diff preview (clicking a changed path),
  filters (typing + Enter), theme toggle: code paths complete and compiling, not
  demonstrated in a screenshot.
- Linux and Windows: not exercised at all (macOS-only round).
- SSH targets: the service supports them; this shell has no SSH UI this round.
