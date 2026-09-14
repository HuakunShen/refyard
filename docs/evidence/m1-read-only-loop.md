# M1 evidence — the read-only loop (T01–T07)

> Status: **evidence record, revision 0** — written 2026-09-15.
> Every command below was run on this machine in the order shown, at HEAD `6ea9e6e`
> (`feat: add static Svelte Git workbench and stable graph layout`) unless stated otherwise.
> Exit statuses are the ones the shell reported. Nothing here is a projection: a platform or
> engine that was not exercised is listed as unverified at the end rather than implied.

## 1. What was delivered, by task

| Task | Commit    | What it added                                                                                                                         |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| T01  | `0b82645` | pnpm workspace, `packages/git-contract` (Zod schemas, 35 mutations, DTOs), fixtures, `check:boundaries`, `check:contract`             |
| —    | `c37b801` | `docs/reference-projects.md` and four research passes (command construction, testing, UI/UX)                                          |
| T02  | `6790eb1` | `packages/git-core`: byte parsers (status, numstat, cat-file, patch, refs, worktree, reflog), command planners, `GitHostPort`         |
| T03  | `282f4b2` | `packages/host-node`: process runner and lifecycle, `doctor`, text codec, path/preview handling                                       |
| T04  | `7f62488` | registries (roots, repositories, worktrees, paths), read workflows, snapshot store, portable smoke                                    |
| T05  | `f68b233` | authenticated HTTP host (ticket → bearer, origins, JSON problems, static assets, SSE), `packages/git-client`, minimal CLI, `apps/cli` |
| T06  | `e8f8af5` | journal with ordering and retention, recovery to `unknown`, idempotency, per-repository queue, event ring                             |
| T07  | `a62d5b3` | `docs/product/north-star.md`, `docs/discussions/`, README, AGENTS §6 as the product shape record                                      |
| T07  | `6ea9e6e` | `packages/git-graph`, `packages/git-ui`, `apps/web` (static SPA), Playwright e2e, CSP-by-hash, SSE client fix                         |

Round 1 covers T01–T07 of `docs/plans/0001-refyard-v2-m1-read-only.md`. T08–T18 are **not**
started: no write operation is exposed, packaged, or documented as available.

## 2. Commands run, and what they reported

All commands were run from the repository root with `PATH` pointing at Node 26.8.2.

| Command                 | Result                                                                                  | Exit |
| ----------------------- | --------------------------------------------------------------------------------------- | ---- |
| `pnpm check`            | 8 packages' `check` scripts (`tsc` ×6, `svelte-check` ×2), then the root `tsc --noEmit` | 0    |
| `pnpm check:boundaries` | `3 portable packages, 39 source files — no host dependencies`                           | 0    |
| `pnpm check:contract`   | `artifacts match the schemas, every $ref resolves (438 named schemas)`                  | 0    |
| `pnpm test:portable`    | `neutral IIFE of 60542 bytes … all 11 planner/parser checks passed`                     | 0    |
| `pnpm test`             | 23 files, 397 tests passed (contract, core, graph, node, integration, unit)             | 0    |
| `pnpm build`            | 1 turbo task successful; static site written to `apps/web/build`                        | 0    |
| `pnpm test:e2e`         | 7 Playwright tests passed (Chromium)                                                    | 0    |

Measured environment for the run above:

| Fact       | Value                                         | Command                               |
| ---------- | --------------------------------------------- | ------------------------------------- |
| OS         | macOS 26.6 (build 25G5065a), arm64            | `sw_vers -productVersion`, `uname -m` |
| Node       | v26.8.2                                       | `node -v`                             |
| pnpm       | 11.25.0                                       | `pnpm -v`                             |
| Git        | 2.50.1 (Apple Git-155)                        | `git --version`                       |
| Playwright | 1.63.0, Chromium headless shell 153.0.8010.12 | `pnpm exec playwright --version`      |

## 3. What the browser run actually proved

`pnpm test:e2e` starts the real CLI bundle under Node against a temporary repository (its own
`HOME`, its own Git config, no network), opens the printed pairing URL in Chromium, and
asserts on what the page shows. The seven cases:

1. opening the pairing URL pairs the session and the repository is read (repositories,
   changes, refs, history rows, and drawn graph geometry);
2. the spent ticket is removed from the address bar after pairing;
3. selecting a commit shows its detail and its change set, and selecting a file reads that
   file's patch;
4. selecting a changed path reads the working-tree-vs-index diff;
5. the graph circle and its history row share one row height (alignment within 2 px);
6. no control on screen could change the repository (no stage/unstage/commit/discard/stash/
   push/pull buttons exist);
7. a bad ticket is reported as a pairing failure instead of being accepted.

The suite found four defects that unit tests had not, all fixed at the source and recorded in
the plan's T07 notes: an `app.html` comment that contained SvelteKit's placeholder tokens
(so the built document was never substituted), virtualized rows that were never offset, an
SSE client whose `start()` resolved only when the stream ended, and a host CSP that blocked
the shell's inline bootstrap (now named by hash, not relaxed to `'unsafe-inline'`).

## 4. Not verified

- **Browsers other than Chromium.** Firefox and WebKit were not run. The app is a static SPA
  with no engine-specific code, but "should work" is not evidence.
- **Platforms other than macOS arm64.** Windows and Linux were not exercised, including the
  Windows process-tree cleanup path (`taskkill /T`) already recorded as limited.
- **A second Git version.** Only Apple Git 2.50.1 was used. The parsers are byte-level and
  fixture-driven, but no other Git version was run.
- **SHA-256 repositories end to end.** Parsers and fixtures cover them; no real SHA-256
  repository was read through the service in this round.
- **A large repository.** The virtualized list was exercised with a two-commit fixture.
  Scrolling a 100k-commit history, and the `load more` path across many pages, were not.
- **QuickJS / JavaScriptCore.** The portable smoke is a neutral-runtime smoke, not an engine
  result; no embedded engine was run.
- **The hosted-UI and multi-repository forms** described in `docs/product/north-star.md`.
  Neither is implemented; nothing in this round demonstrates them.
- **Long-running stability.** No soak test: the service was run for seconds at a time, not
  hours, so journal/queue retention behaviour over time is not demonstrated.
