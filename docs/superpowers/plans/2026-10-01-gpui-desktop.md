# GPUI desktop plan — 2026-10-01

Governing design: `docs/superpowers/specs/2026-10-01-gpui-desktop-design.md`.
Acceptance matrix: `docs/acceptance/2026-10-01-gpui-desktop.md`.
Reference implementation studied: `~/ExtDev/space-lens/apps/gpui` (gpui-kit 0.7 patterns,
verified against its `docs/gpui-research.md` and the extracted crate sources under its
`.cargo-home`).

Conventions: every source file carries a module header; tests are `#[cfg(test)]`; tests for
ported behaviour pin the same properties as their TypeScript originals; conventional commits,
one logical change per commit; verification commands are actually run and their exit status
reported. The graph crate is test-first (the algorithm is the risk); the app crate's UI glue is
verified by build + run + screenshots (named as such, never as unit-test evidence).

## G01 — documents

Spec, this plan, the acceptance matrix, and the AGENTS.md revision (§0 dated note, §4 paths,
§7 active workstream). No code.

## G02 — `crates/refyard-graph`: lane layout

Port `packages/git-graph/src/{types,layout,pages}.ts` to Rust, host-free (no gpui, no host
crates, no IO). Lane positions are `usize` (the TS legacy `position ?? index` fallback does not
exist here; continuation lanes always carry positions). `refColorFor` must reproduce the JS
hash exactly: 32-bit wrapping `(hash * 31 + unit) | 0` over **UTF-16 code units**, then
`abs(hash) % len`.

Tests ported 1:1 from `tests/graph/layout.test.ts`: linear history, root closes lanes, merge
opens/converges, octopus, unknown parent stays a lane, page two continues page one, ref colour
stability and tip recolouring (local/remote tips, not tags, not the remote twin), determinism,
survivor slots never shift, empty page, unrelated branch keeps its slot at merges and roots,
second merge parent joins its existing track, and the `xross-e8e312.json` fixture properties
including `layoutPages` equivalence at splits 100/240/247/260 (fixture included by path
`../../tests/fixtures/graph/xross-e8e312.json`).

Verify: `cargo test -p refyard-graph` (from the root workspace, after adding the crate to
`members`), `cargo clippy -p refyard-graph`.

## G03 — `crates/refyard-graph`: geometry + head segment

Port `packages/git-ui/src/lib/geometry.ts` as **structured geometry**, not SVG strings:
`Metrics { row_height, lane_width, lane_padding, radius, line_width }` (compact/comfortable
presets identical to the TS values), `lane_x`, `row_center_y`, `gutter_width`,
`compressed_metrics` (same floors 6/2.5/1.25/6 and the same overflow-recovery step),
`row_geometry` returning `Segment { shape: Line|Curve, color token, kind: Lane|Merge|Branch }`
where a curve is the same cubic with both control points on the horizontal midline. Port
`head-segment.ts` (`head_segment_for`).

Tests ported from `tests/graph/geometry.test.ts`: lane positions, gutter growth, density
ratios, compression invariants, segment kinds and counts (pass-through, converge, branch,
root, unloaded parent, duplicate-ancestor slots), shifted-lane curves, stable-track geometry.
The byte-identical path-string test does not port (no path strings); the corresponding
assertions are made on curve control points instead.

Verify: `cargo test -p refyard-graph`, `cargo clippy -p refyard-graph`.

## G04 — `apps/desktop-gpui` skeleton

Standalone workspace. `gpui-kit = "0.7"`, path deps on `../crates/refyard-{graph,host,contract}`,
`tokio`, `smol`, `rfd`, `serde`/`serde_json`. Modules: `main.rs` (bootstrap: runtime, then
`application().with_assets(assets::Assets).run` → `init(cx)` → dark theme → `open_window`),
`bridge.rs` (owns the `tokio::runtime::Runtime` in an `Arc`; `call` helper spawning a service
future and delivering `Result` over a bounded `smol::channel`; documented invariants: only
`Send` data crosses, both recv arms reset UI state, `.ok()` on `WeakEntity::update`),
`composition.rs` (mirrors `apps/desktop/src-tauri/src/lib.rs::AppState::build`: `LocalGit::discover`,
`ApplicationServiceConfig{ target_id: "tgt_local", ... }`, `.with_state_root(default_state_root)`,
`.with_writes()`), `theme.rs` (lane colour tokens for dark/light), `app_state.rs` (phase
machine Launcher | Workbench), a first launcher placeholder, and the event pump task.

Verify: `cargo build` in `apps/desktop-gpui`; launch and screenshot.

## G05 — Launcher

Registered repositories (`service.repositories()`), open one (`register_repository` via the
browsed path), recent repositories persisted to the state root, empty and error states, "open
workbench" transition. Multiple open repositories switch via the launcher (repository ids are
already multi in the service).

Verify: build; run against a scratch repository; screenshot.

## G06 — Workbench shell

`Entity<RepoStore>` (capabilities, repository, status, refs, per-view generation counters,
`EventEmitter<StoreEvent>`); sidebar with repository header (HEAD branch, ahead/behind) and
capability-gated sections; main-area switch; bottom status line showing the running operation
and the last `Problem`. Events loop dispatches: `Operation` → refresh status/refs/history on
success/failure and surface problems; `RepositoryChanged` → refresh status/refs; `EventGap` →
full refresh.

Verify: build; run; screenshot; make a change in the scratch repo from a terminal and observe
the UI refresh after an operation, and manually triggered refreshes.

## G07 — Changes view

Status lists (staged / unstaged / untracked) from `StatusSnapshot`; per-path and bulk
stage/unstage with the previews flow (`previews` → tokens → `StagePaths`), commit box writing
`Commit` on the worktree target with `expected_snapshot_id = status.snapshot_id`; diff preview
for the selected path (`DiffQuery` unstaged/staged/untracked) rendered as coloured patch lines;
discard offered only if `capabilities` advertises it, behind a confirmation dialog; stale
`Problem`s surface as "re-confirm" states rather than retries.

Verify: build; run against a scratch repository: stage, unstage, commit, observe events refresh
history; screenshot.

## G08 — History view

`uniform_list` at the geometry's `row_height`; per-row graph canvas painted from
`refyard_graph` (`row_geometry` translated into the row's bounds; stroked curves via
`PathBuilder::stroke`; filled circles via a cubic-bezier circle); ref pills column; head-segment
tint; filters (message, author) restarting the query; load-more appending a page laid out with
the previous continuation; commit detail panel (`detail_oid` query + `DiffQuery` commit files).

Verify: `cargo build`; run against the refyard repo itself and against a scratch repo with a
merge; screenshot the graph and compare against the web workbench visually; screenshots named
as evidence, not tests.

## G09 — Branches and stashes

Read lists (`refs`, `stashes`), capability-gated mutations: create/switch/delete branch
(confirmation for delete), create/apply/pop/drop stash (confirmations for pop/drop).

Verify: build; run; exercise each flow on a scratch repository; screenshots.

## G10 — polish + evidence

Theme toggle, keyboard handling, empty/loading/error states for every panel, module headers
review, README section in `apps/desktop-gpui/README.md`, evidence note
`docs/evidence/2026-10-01-gpui-desktop.md` with commands + exit statuses + screenshots, and the
acceptance matrix filled honestly (PASS / PARTIAL / BLOCKED / NOT RUN).

## Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | gpui-kit 0.7 API drift vs docs | API verified against extracted 0.7.0/0.3.7 sources (canvas, `PathBuilder::stroke`, `uniform_list`, `Theme::change`, `open_window`); compile errors resolve against the same sources |
| 2 | Graph rendering fidelity | The geometry crate is pure and tested; the canvas painter is a thin translation of tested segments; visual comparison against the web graph on the same repository |
| 3 | tokio/GPUI executor interplay | The bridge is one shape used everywhere (space-lens verified pattern); panic path surfaces as an error state |
| 4 | Host capability gaps (e.g. `discardTrackedPaths` not registered in the Rust host) | UI renders from `capabilities()` only; a missing operation is absent, never faked |
| 5 | macOS-only verification | Platform support named honestly in the acceptance matrix; Linux/Windows are NOT RUN |
