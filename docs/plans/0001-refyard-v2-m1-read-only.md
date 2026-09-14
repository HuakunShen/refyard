# 0001 — Refyard v2, M1: the read-only loop

> Status: **active plan, revision 0** — written 2026-09-14.
> Derived from `references/ai-chat/2026-09-14/IMPLEMENTATION_PLAN.md` v2 (T01–T07) without
> re-choosing architecture. Where the delivered package is incomplete, the gap and this
> repository's resolution are recorded in §2.
> Runtime: **Node 26.8.2** per the user's 2026-09-14 direction. The v2 package pins 24.x because
> that was the current major when it was written; the design principle (exactly one supported,
> pinned major) is unchanged, and the reference T13 `engines` assertion is adapted with a comment.
> Implements: `docs/goals/2026-09-14-m1-read-only-loop.md`
> Baseline: HEAD `7263254` (`init`), clean tree except `.gitignore`.

## 1. Scope

M1 is a working read-only workbench: `refyard open` starts an authenticated loopback service plus a
static SvelteKit page; the page reads a real repository's status, history graph, diff, worktrees,
submodules, and stashes; errors, encoding limits, and disconnected states are visible. Write
operations are _modelled_ (journal, queue, idempotency, preconditions) but **not exposed**: no
capability, no route, no button. T08+ add the writes.

Out of scope here, by the reference plan: Xross (T16), Kunkun (T17), native-host evaluation (T18),
npm packaging (T13), PWA (T14), release gates (T15).

## 2. Delivered-package gaps and how they are resolved

`START_HERE.md` names four documents the ZIP does not contain: `CONTRACT.md`,
`ACCEPTANCE.md`, `HOST_PORTABILITY.md`, and `reference/{contracts.ts,test-harness.ts}`.
`DESIGN.md` §5/§7/§8/§9 and `IMPLEMENTATION_PLAN.md` §2/§3 carry their intent. Resolution:

- The public contract is authored here as the single source, in `packages/git-contract`, following
  DESIGN §8 (DTOS, IDs, sealed mutation union, JSON-Schema-exportable Zod).
- The **35 operations** count is from the reference plan; the delivered package never lists them.
  The frozen list (§3) is derived from DESIGN §4 (feature scope table), §9 (operation semantics),
  and the task files of T08–T12, and is the contract every later task maps onto.
- `ACCEPTANCE.md`'s gates are tracked as `docs/evidence/` records per milestone instead of a
  separate normative file.
- `test-harness.ts`'s helpers are realised as `tests/support/*.ts` with the described behaviour.

## 3. The 35 mutations (frozen in T01)

Targets: `workspace` = `{ kind, allowedRootId, relativeDestination }`;
`repository` = `{ kind, repositoryId, expectedSnapshotId }`;
`worktree` = `{ kind, repositoryId, worktreeId, expectedSnapshotId }`.

| #   | Operation             | Target     | Milestone |
| --- | --------------------- | ---------- | --------- |
| 1   | `initRepository`      | workspace  | T09       |
| 2   | `cloneRepository`     | workspace  | T09       |
| 3   | `stagePaths`          | worktree   | T08       |
| 4   | `unstagePaths`        | worktree   | T08       |
| 5   | `discardTrackedPaths` | worktree   | T08       |
| 6   | `commit`              | worktree   | T08       |
| 7   | `amendCommit`         | worktree   | T08       |
| 8   | `createBranch`        | repository | T09       |
| 9   | `switchBranch`        | worktree   | T09       |
| 10  | `renameBranch`        | repository | T09       |
| 11  | `deleteBranch`        | repository | T09       |
| 12  | `setBranchUpstream`   | repository | T09       |
| 13  | `addRemote`           | repository | T09       |
| 14  | `updateRemote`        | repository | T09       |
| 15  | `removeRemote`        | repository | T09       |
| 16  | `fetch`               | repository | T09       |
| 17  | `push`                | repository | T09       |
| 18  | `pull`                | worktree   | T09       |
| 19  | `createStash`         | worktree   | T10       |
| 20  | `applyStash`          | worktree   | T10       |
| 21  | `popStash`            | worktree   | T10       |
| 22  | `dropStash`           | repository | T10       |
| 23  | `createTag`           | repository | T10       |
| 24  | `deleteTag`           | repository | T10       |
| 25  | `pushTag`             | repository | T10       |
| 26  | `createWorktree`      | repository | T11       |
| 27  | `removeWorktree`      | repository | T11       |
| 28  | `lockWorktree`        | repository | T11       |
| 29  | `unlockWorktree`      | repository | T11       |
| 30  | `addSubmodule`        | repository | T11       |
| 31  | `updateSubmodule`     | repository | T11       |
| 32  | `syncSubmodule`       | repository | T11       |
| 33  | `merge`               | worktree   | T12       |
| 34  | `continueMerge`       | worktree   | T12       |
| 35  | `abortMerge`          | worktree   | T12       |

`pull`'s default is ff-only; `push`/`pushTag` require explicit source and destination refs;
`discardTrackedPaths` and every destructive variant carry a `confirmed: true` field, so an
unconfirmed request fails schema validation rather than reaching the coordinator.

Reads (all authenticated, all `GET` except previews):
`capabilities`, `repositories`, `status`, `history`, `refs`, `diff`, `worktrees`, `submodules`,
`stashes`, `operations/{id}`, `events` (SSE); plus `POST previews` for content-fingerprint
pre-checks and `POST session/exchange` for the bootstrap ticket.

## 4. Task breakdown

Each task: failing test first → minimum implementation → the listed verification commands →
one commit with the reference plan's message.

### T01 — workspace, contract, fixtures

`pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `packages/git-contract/src/{schemas,types,
validate,index}.ts`, `tests/support/{repo,service,host}.ts` (repo + bare remote now; service/host
arrive with T03/T05), `scripts/{check-boundaries,generate-schema,check-contract}.ts`,
`tests/contract/schema.test.ts`, `docs/evidence/baseline.md`.
Scripts: `check`, `check:boundaries` (AST/import graph over core+graph production sources, both
forbidden specifiers and forbidden globals), `check:contract` (JSON Schema generation + drift
check), `test:unit`, `test:integration`, `build`.
Verification: `pnpm check && pnpm check:contract && pnpm check:boundaries &&
pnpm exec vitest run tests/contract`.
Commit: `chore: establish portable TypeScript contracts and test fixtures`.

### T02 — byte parsers and command planners

`packages/git-core/src/{ports.ts,bytes/*,parse/*,plan/*}`,
`tests/core/{formats,plans,limits}.test.ts`, `tests/fixtures/bytes.ts` (generated by
`scripts/capture-fixtures.ts`).
Parsers: status (porcelain v2 `-z`, renames with two NUL paths), worktree list, refs, reflog/stash,
index (`ls-files --stage`), numstat, name-status, `cat-file --batch` framing with commit/tag objects,
patch grammar, push/fetch porcelain. Planners return `GitCommandSpec { argv, stdin?, cwdHandle }` —
never a shell string; `stagePaths` uses `--literal-pathspecs` with NUL stdin; `commit` passes the
message via `-F -`.
**Deviations from the reference file list, recorded deliberately:** push and fetch share one
`parse/network.ts` (same decoder, two parsers), `parse/ls-files.ts` was added because submodule state
needs the three object names, and `tests/core/limits.test.ts` exists because core cannot import the
contract's runtime and therefore duplicates its numeric bounds — the test is what keeps the two in
step.
Verification: `pnpm exec vitest run tests/core && pnpm check:boundaries && pnpm check`.
Commit: `feat: add byte-safe Git parsers and portable command plans`.

### T03 — Node host ports, process lifecycle, doctor

`packages/host-node/src/process/*`, `filesystem/*` (handles, text codec, metadata, preview,
recovery), `tests/node/*`, `tests/support/{host,fake-process}.ts`.
Async `spawn` with `shell:false`, `windowsHide:true`; both pipes drained concurrently; single
settlement for close/spawn-error/timeout/output-limit; POSIX process groups, Windows `taskkill /T`
with a recorded limitation; doctor probes machine formats in a scratch repo. Path codec keeps
`displayPath` (escaped, read-only) separate from execution paths and returns
`UnsupportedPathEncoding` instead of lossy decoding.
Verification: `pnpm exec vitest run tests/node && pnpm check:boundaries && pnpm check`.
Commit: `feat: implement Node host ports and safe Git process lifecycle`.

### T04 — registry, read workflows, portability smoke

`packages/host-node/src/registry/*`, `coordinator/{snapshots,reads}.ts`,
`packages/git-core/src/workflows/*`, `scripts/check-portable.ts`, `tests/integration/reads.test.ts`,
`tests/portable/core.test.ts`. Canonical git-dir/common-dir identity, allowedRoot + symlink
boundary checks, history snapshots with fixed tips and bounded paging, diff metadata + text patch,
worktree/submodule three-OID status, stash locator+OID pairing, preview tokens (5 min).
Portability smoke builds a neutral IIFE and executes planner/parser fixtures with no Node/Web
globals injected; recorded as a smoke check, not a QuickJS result.
Verification: `pnpm exec vitest run tests/integration/reads.test.ts tests/portable &&
pnpm test:portable && pnpm check:boundaries`.
Commit: `feat: add scoped repository reads and portable core smoke`.

### T05 — authenticated HTTP, static host, client, minimal CLI

`packages/host-node/src/http/*`, `packages/git-client/src/*`,
`apps/cli/src/{main,args,doctor,open,serve}.ts`, `tests/integration/auth.test.ts`.
Ticket → bearer exchange (single use, 60 s, bound to instance/origin/actor/resources), exact
Origin/Host validation, JSON 404 for unknown API paths, body limits, redacted logs, static assets
only from the packaged web directory with traversal/symlink rejection. CLI `doctor --json`,
`open`, `serve --repo --no-open --port`; loopback only.
Verification: `pnpm exec vitest run tests/integration/auth.test.ts && pnpm build && pnpm check`.
Commit: `feat: expose authenticated local Git service and browser entry`.

### T06 — journal, dedupe, queue, events

`packages/host-node/src/coordinator/{jobs,queue,preconditions,submit,cancel}.ts`,
`journal/*`, `http/events.ts`, `packages/git-client/src/events.ts`,
`tests/integration/{jobs,restart,concurrency}.test.ts`.
`clientRequestId` dedupe on actor+target+payload with `IdempotencyConflict` on a payload mismatch;
accepted/running persisted before execution; restart marks unfinished entries `unknown` and never
replays; 4 global Git processes / 2 readers per repo / 1 writer per common git dir / 32 queued per
actor; bounded SSE ring with `sequence` + `eventGap`. A test-only effect stub drives the state
machine — production capabilities stay gated.
Verification: `pnpm exec vitest run tests/integration/jobs.test.ts tests/integration/restart.test.ts
tests/integration/concurrency.test.ts`.
Commit: `feat: journal and coordinate Git operations without replay`.

### T07 — graph and the SvelteKit UI

`packages/git-graph/src/{layout,types}.ts`, `tests/graph/layout.test.ts`,
`packages/git-ui/src/*.svelte`, `apps/web/**` (SvelteKit 2, adapter-static, Tailwind v4,
shadcn-svelte components, TanStack Query + Virtual), `tests/e2e/read-only.spec.ts`.
Deterministic lane layout with continuation across pages; fixed row height shared by SVG lines and
the virtualized list; graph lane identity is not branch identity. UI states: loading, stale,
truncated, error, empty, disconnected. Mutations remain disabled in M1.
Verification: `pnpm exec vitest run tests/graph && pnpm build && pnpm test:portable &&
pnpm test:e2e --grep read-only`.
Commit: `feat: add static Svelte Git workbench and stable graph layout`.

## 5. Risks and standing decisions

- **Byte-safe paths on Node V1.** Git argv is a Unicode string. Valid-UTF-8 paths (spaces,
  CJK, TAB, LF, leading `-`, pathspec magic) work; anything else is _read-only metadata_ and the
  related write returns `UnsupportedPathEncoding`. Batch actions reject the whole batch.
- **Windows cleanup** is `taskkill /T` with a recorded limitation, not a Job Object. Uncertain
  cleanup blocks new writers for that repository instead of pretending success.
- **`cat-file --batch` and stream framing** are implemented in T02 because history, diff, and
  commit detail all depend on correct length-based framing; a `--format`-as-JSON shortcut is
  explicitly forbidden.
- **Portability claims stay graded**: T01 static dependency check, T02 byte fixtures, T04 IIFE
  smoke. None of these prove QuickJS/JSC readiness.
