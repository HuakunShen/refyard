# 0001 — Refyard v2, M1: the read-only loop

> Status: **active plan, revision 0** — written 2026-09-14.
> Derived from `references/ai-chat/2026-09-14/IMPLEMENTATION_PLAN.md` v2 (T01–T07) without
> re-choosing architecture. Where the delivered package is incomplete, the gap and this
> repository's resolution are recorded in §2.
> Runtime: **Node 26.8.2** per the user's 2026-09-14 direction. The v2 package pins 24.x because
> that was the current major when it was written; the design principle (exactly one supported,
> pinned major) is unchanged, and the reference T13 `engines` assertion is adapted with a comment.
> Implements: `docs/goals/2026-09-14-m1-read-only-loop.md`
> Product shape: `docs/product/north-star.md` (the four usage forms, written 2026-09-15). This plan
> delivers form 1 for reads only; §6 records where forms 2–4 and the machine-facing surface land.
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
**Deviations from the reference file list, recorded deliberately:** the recovery store lives in
`filesystem/metadata.ts` next to the fingerprints it verifies (splitting them would put the
"backup is verified before the operation may run" rule across two files), and
`process/git-host.ts` was added because the handle registry and the runner need one place that
combines them — that file is the only implementation of `GitHostPort`. Two behaviours are also
narrower than the prose: `encodeExecutionPath` refuses any text in the `\xNN` escape form even
when it could be a real filename (the ambiguous case fails closed), and content that is neither
valid UTF-8 nor NUL-binary is reported as `unrepresentable` rather than guessed as text or binary.
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
**Deviations from the reference file list, recorded deliberately:** the core workflow files are
`engine`, `status`, `history`, `repository` (refs, worktrees, submodules, stashes — they share one
listing→facts shape) and `diff`, plus `parse/meta.ts` and `plan/refs.ts` for the formats those reads
need (remotes, `.gitmodules`, `ls-tree`, `rev-list` topology, `cat-file --batch-check`);
`planRepositoryLayout` gained `omitTopLevel` because Git refuses `--show-toplevel` in a bare
repository; the host adds `coordinator/read-support.ts` (operation markers, per-worktree Git
directory, URL redaction, synthesized untracked patches) and `coordinator/snapshot-types.ts`.
Two behaviours are narrower than the prose and are stated here rather than discovered later:
cursors are random server-resolved ids (the contract caps a `cur_` id at 96 characters, and an
opaque handle the client cannot read is the point), and a diff lists at most 200 files with
`truncated` set, fetching patches only for a named path. The portability smoke lives in
`scripts/lib/portable.ts` so `pnpm test:portable` and the Vitest suite prove the same thing, and
`pnpm-workspace.yaml` allows esbuild's install script because that check needs its binary.
Verification: `pnpm exec vitest run tests/integration/reads.test.ts tests/portable &&
pnpm test:portable && pnpm check:boundaries`.
Commit: `feat: add scoped repository reads and portable core smoke`.
**T05 addendum, recorded deliberately:** the HTTP host is `http/{server,router,auth,origins,json,assets,errors}.ts`;
the tests are `tests/integration/{auth,http,cli}.test.ts` with `tests/support/service.ts` as the
harness, so asset handling and the CLI have their own suites rather than being folded into one file.
Two decisions differ from the prose above and are stated here: (1) **an absent `Origin` is answered,
not refused** — a document request carries no Origin, so refusing it would make opening the workbench
impossible; what protects the data is that every read still requires a bearer, the service never reads
a cookie, and it sends no CORS headers, while an explicit `Sec-Fetch-Site: cross-site` is refused
outright (`null` origins are still refused); (2) **`refyard` runs from generated ESM** because Node 26
strips types but does not rewrite the `.js` specifiers this repository uses — `scripts/bundle-cli.ts`
produces `.refyard-dev/cli.mjs` with esbuild for development, and T13 owns the real packaged `bin`.

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
**Deviations from the reference file list, recorded deliberately:** `cancel.ts` was folded into
`jobs.ts` (cancellation is one transition of the same state machine, and separating it would have put
the "never relabel a running mutation" rule away from the queue it depends on); `coordinator/events`
became `http/events.ts` (the ring and the SSE writer ship together so the bound and its consumer
cannot drift); `packages/git-client/src/mutations.ts` was added because the client needs submit/get/
cancel and the design forbids retrying automatically. The contract gained one schema,
`OperationsListQuery`, because the API exposes operations at one path with an optional `operationId`
rather than at `/operations/{id}`; the generated artifacts were regenerated in this commit.
Index freshness is checked with a fingerprint over the paths Git already reports as changed plus the
Head, recorded with each snapshot — not by hashing the repository, which the design forbids.

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

Deviations and findings, recorded deliberately:

- **The style stack is Tailwind v4 + a small local kit, not shadcn-svelte's generated
  components.** The primitives (`Button`, `Input`, `Badge`, `StateBanner`) are hand-written with
  `tailwind-variants`/`clsx`/`tailwind-merge`, and `components.json` records the shadcn-svelte
  layout so `npx shadcn-svelte add` still works for components added later. Nothing in the kit is
  copied from a reference project.
- **`@tanstack/svelte-virtual` needed one non-obvious treatment.** Auto-subscribing the store
  inside the effect that calls `setOptions` makes the effect its own dependency, and Svelte
  reports `effect_update_depth_exceeded`; the component subscribes through `store.subscribe`
  instead and keeps the update path one-way. This was found by the Playwright run, not by a test.
- **Two real defects were found by the end-to-end run and fixed rather than worked around.**
  (1) `app.html` spelled out SvelteKit's placeholder tokens inside an HTML comment, and the
  substitution replaces the _first_ occurrence — the built document served the comment and left
  the real placeholders unsubstituted, so the app never booted. (2) The virtualized rows were
  never offset (`transform: translateY(item.start)` was missing), so every row painted at the top
  of the list.
- **The SSE client had a contract bug and no tests.** `createEventStream.start()` was documented
  as resolving when the first connection is established but awaited the whole read loop, so it
  resolved only when the stream _ended_; the UI showed "connecting…" forever. Fixed in
  `packages/git-client`, with `tests/node/event-stream.test.ts` covering readiness, framing,
  `eventGap`, authentication refusal and resume-after-drop.
- **The host's CSP needed the document's own inline script by hash.** `script-src 'self'` is
  correct as a default and blocks a static SPA's inline bootstrap; `packages/host-node/src/http/csp.ts`
  computes the hash of the inline scripts in the document being served and names them, so
  `'unsafe-inline'` is never introduced. Covered by `tests/node/csp.test.ts` and by the e2e run.
  One accepted consequence: dependencies that probe `Function` availability (Zod's runtime
  check, tailwind-variants' class compiler) trip a CSP eval block and fall back to their
  non-eval paths — visible as a console message in Firefox, harmless by design, and the
  response to it is never `unsafe-eval`.
- **One read is two requests, by design.** A diff without `pathId` lists the change set and
  fetches no patches; the pane therefore asks for one file's patch when that file is selected.
  The e2e spec follows the same two steps.
- **Known read gap, found while demoing:** `kind: "commit"` against a _merge_ commit returns an
  empty change set, where `git show <merge> --stat` reports the diff against the first parent.
  Ordinary commits are unaffected (the e2e covers one). To fix in the reads round (T08+), with
  a fixture repository whose merge is exercised by the integration suite — deciding then
  whether a merge reads against its first parent (what `git show --stat` does) or is reported
  as "merge: no single diff" so the pane can say so.
- **The session token is kept in `sessionStorage`, not only in memory.** The pairing ticket is
  single use, so an in-memory-only token makes a reload a dead end. `sessionStorage` survives a
  reload and dies with the tab; it is never in `localStorage`. Recorded here because the design
  package says "in-memory bearer".
- **Pairing URLs carry the ticket in the query string too** (user direction, 2026-09-15, after a
  real browser flow was observed dropping the `#pair=` fragment and landing on the connect
  panel). The CLI now prints `/?pair=…`; the app reads `pair`/`ticket` from the fragment _or_
  the query — the fragment wins if both are present — and clears both from the address bar once
  the ticket is spent. The query form's exposure is bounded and each bound is deliberate: the
  host never logs a query string (`server.ts` splits the path at `?` before logging), documents
  are served with `Referrer-Policy: no-referrer`, and the ticket is single-use with a
  sixty-second life. The design package's fragment rationale ("never sent to a server") is
  relaxed here on purpose, not by accident.
- **Two TypeScript majors coexist for one tool.** `svelte-check` works through the TypeScript
  compiler API (peer range `^5 || ^6`), which TypeScript 7 — the native port this repository
  compiles with — does not expose. `packages/git-ui` and `apps/web` resolve TypeScript 6 through
  the named `svelte` catalog in `pnpm-workspace.yaml`; everything else stays on 7.0.2.
- **Playwright is a new devDependency** (`@playwright/test`, root) with `playwright.config.ts`;
  `pnpm test:e2e` builds the web bundle and the CLI bundle first, so a stale asset cannot produce
  a confusing failure. The browser is Playwright's own Chromium — one platform, one engine.
- **The UI primitives are shadcn-svelte components, generated into this package** (user
  direction, 2026-09-15: prefer generated components over hand-written ones).
  `packages/git-ui/components.json` drives the CLI; `scripts/fix-shadcn-imports.ts` rewrites the
  generated `$lib/…` imports to relative ones after every add, because this package is
  deliberately not a SvelteKit app and must not depend on that alias. Generated so far: button,
  badge, input, card, separator, dropdown-menu, scroll-area. One deliberate edit to a generated
  file: the badge gained a Git-domain `tone` dimension (`branch`/`head`/`tag`/…), because a badge
  here means something and callers should never pick colours by hand. The hand-written
  Button/Input/Badge from the first T07 pass were removed in favour of the generated ones.
- **Dark mode follows shadcn-svelte's Svelte recipe**: `mode-watcher` owns the `.dark` class on
  `<html>` (`ModeWatcher` in the app's root layout), the theme tokens and the lane palette have
  dark values under that class, Tailwind's `dark:` variant is wired to it via `@custom-variant`,
  and a `ModeToggle` (generated `dropdown-menu` + `buttonVariants`) offers light/dark/system.
  Verified in Chromium by driving the real dropdown and asserting the class flips; the dark and
  light renders are recorded in the demo screenshots. WebKit and Firefox were not exercised for
  the toggle.
- **The e2e suite was run and passed** (7 tests, Chromium 153.0.8010.12 via Playwright 1.63.0, on
  macOS 25.6.0 arm64, git 2.50.1 Apple Git-155). Firefox, WebKit and Windows are **not**
  verified.

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

## 6. Product forms beyond M1

`docs/product/north-star.md` (2026-09-15) fixes four usage forms. M1 delivers form 1 for reads
only; the rest are targets, and this section decides where each one lands so a later task does not
re-decide architecture under time pressure.

- **Form 2 — managed workspaces (many repositories).** Needs a registration/approval surface beyond
  the CLI's single path: `allowedRoot` approval for a new directory, the registry accepting it, the
  session grant becoming a _list_ whose additions are journaled (and revocable), and a UI
  affordance that renders only when the host publishes the capability. Candidate task: immediately
  after the M1 report, **before** T08–T12, because the write tasks otherwise bake in a
  single-repository session scope.
- **Form 3 — hosted UI (opt-in).** Belongs to the T14 compatibility slice, together with Local
  Network Access, CORS, an exact origin allowlist, password → session exchange, rate limiting and
  lockout. North-star §5 lists the requirements and the risks; no second implementation of the API
  is created for it, and the loopback default of form 1 is not weakened to make it work.
- **Form 4 — embedded core.** Already enforced (`check:boundaries`, portable smoke). A real
  embedded-engine run belongs to the native-host evaluation (T18); the current smoke result must
  never be reported as a QuickJS/JSC result.
- **Machine-facing surface (OpenAPI + Scalar + MCP) — decided 2026-09-15.** Hono (`hono` +
  `@hono/node-server`) replaces the hand-written router when this lands; `hono-openapi`
  (preferred over `@hono/zod-openapi`) generates `/openapi.json`; `@scalar/hono-api-reference`
  serves the reference UI; `@hono/mcp` + `@modelcontextprotocol/sdk` expose **read tools only**
  (`run_git(args)` is never a tool). Working wiring to copy from:
  `~/Dev/kunkun/packages/local-api-server/src/openapi.ts` and `…/src/*-mcp.ts`. Candidate tasks:
  **T19** (Hono migration; acceptance = the existing auth, origin, SSE and static-asset tests pass
  unchanged) and **T20** (read-only MCP surface with its own policy principal). M1 deliberately
  does not start this rewrite — the raw `node:http` host is verified, and the contract/router split
  keeps the migration mechanical.
- Until form 2 is a task, the CLI's single-root default stands: the approved root is the repository
  directory itself, and a linked worktree elsewhere stays listed but unreadable.
