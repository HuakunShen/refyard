# M2 evidence — the write loop, packaging and the release gate (T08–T15)

> Status: **evidence record, revision 0** — written 2026-09-15 at HEAD `59d5631`
> (`fix: report only the mutations this build does not implement`), on macOS 26.6 arm64 with
> Node 26.8.2 and Git 2.50.1 (Apple Git-155).
>
> Every command below was run on this machine, at this revision, and the results are the ones the
> shell reported. Nothing here is a projection. Where a platform, browser, Git version or suite was
> not exercised, it is named as unverified in §4 rather than left to inference — and the
> machine-readable half of this record lives in `performance.json`, `release-matrix.md` and
> `security.md` beside it.

## 1. What was delivered, by task

| Task | Commit(s)                                                             | What it added                                                                                                                                      |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| T08  | `d371535`, docs `3e6267e`                                             | staging and commit: `stagePaths`/`unstagePaths`/`commit`/`amendCommit`, preview-token binding, backup-before-discard, bulk pre-checks              |
| T09  | `c444c00`, docs `eac17ca`                                             | branches, remotes, and the network verbs: create/switch/rename/delete, upstreams, `addRemote`/`updateRemote`/`removeRemote`, `fetch`/`push`/`pull` |
| T10  | `00b9c9f`, docs `9a64ebc`                                             | stash create/apply/pop/drop with conflict-keeps-the-stash, and tags create/delete/push                                                             |
| T11  | `582fc00`, docs `92b7b62`, chore `c120fea`                            | linked worktrees (create/remove/lock/unlock, primary protected) and submodules (add/update/sync)                                                   |
| T12  | `a7b20f9`, docs `d5d3748`                                             | merge with conflict detection, `continueMerge` and `abortMerge`, `ConflictPanel`, `mayRunDuringOperation`                                          |
| T13  | `763ba90`, docs `86a8882`                                             | the npm/npx artifact: bundled ESM CLI, staged `web/`, `dist/build-info.json`, tarball with no dependencies and no postinstall                      |
| T14  | `fdcd60b`, docs `c923d6e`                                             | offline shell (service worker caches versioned assets only, never `/api`), PWA manifest, `/health` negotiation, browser-support record             |
| T15  | `f2eb018`, `d05c7f4`, `c612cc9`, `59d5631`, docs `57541e0`, `9c7a60a` | the release gate: negative cases, the benchmark and its evidence, the release matrix, and the CI workflow — plus three defects it found (§3)       |

Write surface at this revision, read from `GET /api/v1/capabilities` on the packaged CLI:
**33 of the contract's 35 mutations**, with `initRepository` and `cloneRepository` named in
`unavailable` as not implemented. The 9 read kinds are listed in `reads`.

## 2. Commands run, and what they reported

All commands were run from the repository root, in this order, at this revision.

| Command                 | Reported                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`            | 8 workspace tasks, 0 errors (`tsc --noEmit` plus `svelte-check` for the two Svelte packages)                                          |
| `pnpm check:boundaries` | 3 portable packages / 53 source files with no host dependencies; 63 test/script files import packages by name                         |
| `pnpm check:contract`   | committed JSON Schema matches the Zod schemas; 438 named schemas, every `$ref` resolves                                               |
| `pnpm test:unit`        | 207 passed (12 files)                                                                                                                 |
| `pnpm test:integration` | 314 passed (20 files), including `tests/security`                                                                                     |
| `pnpm test:pack`        | 13 passed (2 files): installed-package checks and the evidence-shape checks                                                           |
| `pnpm test`             | 538 passed (35 files) — the union of the three above                                                                                  |
| `pnpm test:portable`    | neutral IIFE of 60,542 bytes ran with no host globals and no Node shims; 11 planner/parser checks                                     |
| `pnpm build:release`    | staged `packages/npm-dist/dist` (bundle 1,228,295 bytes) and `packages/npm-dist/web`                                                  |
| `pnpm test:e2e`         | 27 passed in 3.0m, Chromium                                                                                                           |
| `pnpm pack:smoke`       | 14 steps passed against the `npm pack` tarball (98 entries)                                                                           |
| `pnpm bench:runtime`    | 100,000-commit fixture built in 2.6s, 3 lifecycles measured; every value, its scope and its range in `docs/evidence/performance.json` |

Numbers a reader should not carry away as general: the bench figures describe one machine (this
one), one runtime (Node 26.8.2), one Git (2.50.1), and three repetitions — the report says so in
its own `methodology` fields instead of in a footnote.

## 3. What the gate found

The release gate is not a formality in this round: three defects surfaced only because these
commands ran against the packaged artifact.

1. **The doctor's connectivity probes made Git resolve an identity from the system account
   database.** With no `user.*` configured, `git push --porcelain` and `git fetch --porcelain` took
   5.06s each, which put ~10s in front of every `refyard serve` on a machine (or CI runner) without
   a configured identity. The probes now pass an identity per invocation
   (`PROBE_IDENTITY_ARGS`), never to a config file.
2. **The host's Git child environment dropped the caller's identity.** `GIT_AUTHOR_*` and
   `GIT_COMMITTER_*` are not on the inherit list, so a service started with them committed as
   somebody else, and `git worktree add` — which needs an identity — took **15.05s** with none
   available versus 0.03s with one. The variables are now inherited; they set a name, an address and
   a date, and cannot redirect Git or make it run anything, which is why they belong on the inherit
   list rather than the blocked one.
3. **`capabilities` contradicted itself.** The packaged CLI reported 33 available mutations and an
   `unavailable` entry saying "this build implements reads only; no Git mutation is enabled, and
   none is reported as available". The list is now the set difference between the contract and
   `implementedKinds()`, and the test asserts that arithmetic rather than the wording.

Finding 2 was itself exposed by a test-isolation defect found while running the e2e suite: every
spec had been starting its service on the developer's real state directory, so
`/api/v1/operations` — the list the offline specs read to prove that nothing was written — was
shared across runs and saturated its page limit, at which point "the count did not move" stopped
being evidence. Each spec now runs on its own state directory, and a case asserts that a freshly
started service reports no operations at all.

## 4. Not verified

Stated as facts about this evidence, not as guesses about the platforms:

- **Operating systems**: macOS arm64 only. Linux, Windows, WSL, macOS x64 and any CI runner are
  unverified. `.github/workflows/ci.yml` is written to run the gate on Linux and macOS, but **it has
  not run in this repository**; a green badge from it would be evidence, and there is none yet.
- **Browsers**: the Playwright Chromium build only, at a desktop viewport. Firefox, WebKit/Safari,
  iOS Safari, Android Chrome, mobile viewports, and any screen reader are unverified.
- **Git**: 2.50.1 only. The 2.43.0 functional baseline is asserted by unit tests of the comparison,
  not by a run against an older Git, and neither is anything below it.
- **Repository shapes**: SHA-256 repositories, bare repositories and shallow clones have only the
  partial coverage listed in `release-matrix.md`; nothing was measured against a repository on a
  network filesystem, a sparse checkout, or a partial clone.
- **Security**: no external audit, no fuzzing, no hostile-remote testing, no credential or
  SSH-agent testing, no adversarial run outside macOS. `security.md` lists this work as not done
  rather than as satisfied.
- **Scale**: the largest fixture measured is 100,000 commits, one file, linear history. No soak run,
  no long-lived session, no multi-repository workload.

## 5. Known limitations, by design

- `initRepository` and `cloneRepository` are not implemented; `capabilities` names them in
  `unavailable` and no route, capability or button exists for them.
- A hosted static site calling the loopback API from another origin is not supported: the host
  refuses foreign `Origin`, `null`, and `Sec-Fetch-Site: cross-site`, and no flag widens it.
- The service holds one writer per common Git directory _inside itself_; it does not claim to lock
  out an external terminal, IDE or AI, and the concurrency tests say so.
- Destructive operations require an explicit confirmation in the request and a backup that must
  succeed first; a backup failure means the operation does not run.
- Unknown outcomes stay unknown: no mutation is auto-retried, and a repository blocked by an
  unfinished operation stays blocked until a human clears it.

## 6. Next

T16–T18 (Xross, Kunkun and native-host review) are out of scope until the standalone V1 ships. The
next concrete work is whatever the first real use of the packaged CLI turns up — this record exists
so that the next round can be compared against it rather than against memory.
