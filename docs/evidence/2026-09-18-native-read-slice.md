# Native desktop read slice — evidence, 2026-09-18 (D01–D05 in progress)

What has actually been run, on which platform, with which exit status. Anything not
listed here is **not yet verified**; in particular there is no `.app` yet, so no cell of
the acceptance matrix that needs a running desktop window is PASS.

Baseline for comparison: `docs/evidence/2026-09-18-native-baseline.md` (commit `ba70321`).

## Commits in this workstream

| Commit    | What it landed                                                                                |
| --------- | --------------------------------------------------------------------------------------------- |
| `980ee8d` | `docs(architecture)`: AGENTS §0 + north-star §6 authorize the native scope; baseline evidence |
| `4743b61` | `fix(kunkun)`: a pre-existing `pnpm check` failure (see below)                                |
| `501b1fb` | `feat(contract)`: contract 1.2.0, HostService schemas, `@refyard/git-service`                 |
| `560ea0b` | `refactor(client)`: `@refyard/backend-http`, the adapter conformance harness                  |
| `8c2cd1b` | `feat(native)`: Cargo workspace, typed contract, bounded process runner                       |
| `5c7140f` | `feat(native)`: byte parsers, plans, host foundations                                         |
| `7941981` | `feat(desktop)`: `@refyard/backend-tauri`, the native command table                           |

## A pre-existing failure, fixed rather than worked around

`pnpm check` was **already failing at `ba70321`**: `integrations/kunkun/backend.ts`
(TS2741) did not forward `filesystemEntries`, which `GitClient` gained in the path-picker
work, so the Kunkun backend adapter did not satisfy its own type. Reproduced in the main
worktree at the baseline commit before touching anything:

```
cd /Volumes/Portable2TB/ExtDev/refyard && pnpm check   # at ba70321
integrations/kunkun/backend.ts(44,9): error TS2741: Property 'filesystemEntries' is missing …
[ELIFECYCLE] Command failed with exit code 1.
```

Fixed in `4743b61` as its own commit. This is the only change in this workstream that
touches Node-side product code outside the plan's file lists.

## Verified commands

| Command                                                 | Result | Notes                                                       |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `pnpm check`                                            | exit 0 | 11 turbo tasks + root `tsc`; was red before `4743b61`       |
| `pnpm check:boundaries`                                 | exit 0 | 3 portable packages, 56 source files; 121 test/script files |
| `pnpm check:contract`                                   | exit 0 | artifacts match; 500 named schemas (was 462)                |
| `pnpm test:unit`                                        | exit 0 | 42 files / 398 tests                                        |
| `pnpm test:integration`                                 | exit 0 | 32 files / 418 tests                                        |
| `pnpm exec vitest run tests/adapters`                   | exit 0 | 3 files / 30 tests (17 http+conformance, 13 native)         |
| `pnpm build:web`                                        | exit 0 | `apps/web/build/200.html` still the static SPA              |
| `cargo fmt --all --check`                               | exit 0 |                                                             |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |                                                             |
| `cargo test --workspace`                                | exit 0 | 202 tests: contract 22, core 129, host 41, plus doctests    |

Test counts moved from 353 unit / 413 integration at baseline to 398 / 418. No existing
test was weakened, deleted, or skipped.

## What is implemented

- **Contract 1.2.0** (API major 1, so a 1.1.0 host is still readable): `host.kind` may be
  `rust`; the capability query may name a target or repository; `targetId` is optional on
  repository shapes; HostService schemas exist for host capabilities, ssh host candidates,
  execution targets, target creation, disconnect and uncertain acknowledgement. A target
  creation request cannot carry a credential (unknown fields are rejected) and a manual ssh
  alias must be a concrete token that cannot be read as an option, split into two argv
  words, or expanded as a wildcard.
- **`@refyard/git-service`**: the transport-neutral interfaces the UI is written against —
  `GitReadService`, `MutationService`, `HostService`, `EventService`, `BackendSession`,
  `BackendAdapter`, and one `BackendError`.
- **`@refyard/backend-http`**: the HTTP/SSE adapter over the existing client. A 404 on
  `/api/v1/host/capabilities` downgrades to legacy capabilities; a 403 or 500 does not.
- **`@refyard/backend-tauri`**: the native adapter with a closed command table, per-response
  schema validation, and the listen-before-subscribe handshake with sequence-merged replay.
- **Rust `refyard-core`**: status, refs, numstat/name-status, patch, `cat-file --batch` and
  rev-list parsers, plus the planners that produce the argument vectors, all ported from
  `packages/git-core` with byte-level fidelity.
- **Rust `refyard-host`**: the bounded process runner (concurrent stream drain, bounded
  output with an explicit `output_complete`, kill-and-reap on deadline or cancellation), the
  environment allow-list, the path codec and `pathId` binding, the repository registry keyed
  by common Git directory, the snapshot store with a sorted-fact index fingerprint, and an
  ISO-8601 clock.

## Intentional divergences from the TypeScript reference

Recorded rather than normalised away. The differential test is expected to be run with
these in mind.

1. **Status entry bound covers every record type.** The TypeScript parser bounds tracked
   entries but let untracked and ignored records through unbounded; a build-output directory
   is exactly where an unbounded list comes from, so the Rust parser bounds all of them.
2. **A patch truncated mid-hunk drops the partial hunk.** The TypeScript _documentation_
   says to drop it, but its code flushes it, so a cut hunk is reported as a complete one.
   The Rust parser follows the documented contract; the divergence is documented in
   `crates/refyard-core/src/parse/patch.rs`.
3. **`SessionMetadata.sessionId` is nullable.** A bearer restored from storage identifies a
   session the client cannot name, and inventing an id there would be a fabricated
   identifier. The native adapter always has a real one.

## Not verified — do not read as done

- **No `.app` exists yet.** D06 has not started, so acceptance A01–A08 are NOT RUN. The
  desktop crate (`apps/desktop`) and its Rust command layer do not exist yet.
- **The Rust read workflows are incomplete**: `reads/`, `service.rs`, the fixture driver and
  the Node-vs-Rust differential test are still being written (D04's remaining half). No
  claim is made here that a Rust `status` read matches the Node one — that is exactly what
  the differential test must prove.
- **SSH is untouched**: no config catalogue, no OpenSSH provider, no fixture (D07–D09).
- **Writes are untouched**: no previews, journal, queue, or stage/unstage/commit (D10–D11).
- **Platforms**: everything above ran on macOS 26.6 arm64 with Node 26.8.2, pnpm 11.25.0,
  Rust 1.98.0, git 2.50.1, OpenSSH 10.3p1. Linux and Windows were not exercised.
- The Tauri toolchain was **not** installed or run yet; `@tauri-apps/cli` is not a dependency
  of any package at the time of writing.
