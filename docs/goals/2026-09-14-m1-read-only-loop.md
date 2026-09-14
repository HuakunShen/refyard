# M1 — the read-only loop: `refyard open` shows a real repository

> Status: **execution goal, revision 0** — written 2026-09-14 at the user's request, to be run
> without being prompted between steps.
> Baseline HEAD: `7263254` (`.gitignore` modified, nothing else touched).
> Platform of record: macOS 26.6 arm64 · Node 26.8.2 (`.nvmrc`, `nvm alias default 26`) ·
> git 2.50.1 (Apple Git-155) · pnpm 11.25.0 · bun 1.4.0 (dev scripts only).
> Runtime major note: the v2 package names Node 24.x because that was current when it was written;
> the user directed Node 26 on 2026-09-14. The reference plan's T13 assertion `engines.node === '>=24 <25'`
> becomes `'>=26 <27'` with a comment recording why.
> Implements: `../plans/0001-refyard-v2-m1-read-only.md`, from
> `references/ai-chat/2026-09-14/IMPLEMENTATION_PLAN.md` T01–T07.
> **Target: T01–T07 complete, each committed separately, each verification command actually run.**

## What this is

Build the foundation and the read-only workbench of Refyard: a TypeScript Git core that produces
every production `git` argv and parses its machine output as bytes; a Node 24 host that owns
processes, files, the registry, auth, the journal and the queue; and a static SvelteKit page that
shows a real repository — status, history graph, diff, worktrees, submodules, stashes — through an
authenticated loopback API. Writes are modelled but not exposed.

## The order, and why

1. **T01 contract + fixtures first.** Nothing else may invent a type. The 35-operation union, DTOs,
   ID naming, and the isolated-repo fixture define what "correct" means for every later task; the
   boundary checker must exist before core code does, or the no-Node rule is aspirational.
2. **T02 parsers/planners before any host.** Bytes in, bytes out, verified against real `git`
   output captured as fixtures. A parser that has never seen a NUL-framed rename is not a parser.
3. **T03 host after core proves it can parse.** The runner's only job is to hand exact bytes to a
   parser boundary that already has tests, and to settle process outcomes exactly once.
4. **T04 registry/reads, then T05 HTTP**, so the service is exercised through real HTTP with real
   auth rather than a mocked transport, and `doctor` can be honest about the machine.
5. **T06 journal/queue on top**, because idempotency and "unknown, never replayed" are only
   meaningful once there is a real execution path to record.
6. **T07 graph and UI last**, against the API that exists; the graph's pure layout is tested
   independently of Svelte so paging and continuation are proven by fixtures, not by looking.

## Tasks

- [ ] **T01** workspace, `@refyard/git-contract` (35 mutations + read DTOs + semantic validation),
      repo fixtures with an isolated HOME/config, boundary + contract scripts, baseline evidence.
- [ ] **T02** `@refyard/git-core`: NUL/ASCII framing, status/worktree/refs/numstat/name-status/
      cat-file/patch/push/fetch parsers, planners for status/history/paths/commit/refs.
- [ ] **T03** `@refyard/host-node` process runner (drain both pipes, one settlement, process-group
      cleanup), path codec, preview/recovery files, `doctor` probing real machine formats.
- [ ] **T04** registry (git-dir/common-dir identity, allowedRoot boundary), read workflows and
      snapshots, bounded paging, preview tokens, neutral-IIFE portability smoke.
- [ ] **T05** authenticated HTTP host + static assets, `@refyard/git-client`, CLI `doctor/open/serve`.
- [ ] **T06** journal with retention and recovery, idempotency, bounded queue, SSE events.
- [ ] **T07** pure-TS graph layout, `@refyard/git-ui`, SvelteKit static SPA with Tailwind v4 and
      shadcn-svelte, Playwright read-only spec.

## Verification per task

T01 `pnpm check && pnpm check:contract && pnpm check:boundaries && pnpm exec vitest run tests/contract`
T02 `pnpm exec vitest run tests/core && pnpm check:boundaries && pnpm check`
T03 `pnpm exec vitest run tests/node && pnpm check:boundaries && pnpm check`
T04 `pnpm exec vitest run tests/integration/reads.test.ts tests/portable && pnpm test:portable && pnpm check:boundaries`
T05 `pnpm exec vitest run tests/integration/auth.test.ts && pnpm build && pnpm check`
T06 `pnpm exec vitest run tests/integration/jobs.test.ts tests/integration/restart.test.ts tests/integration/concurrency.test.ts`
T07 `pnpm exec vitest run tests/graph && pnpm build && pnpm test:portable && pnpm test:e2e --grep read-only`

Each task ends with its own commit, using the message named in the plan. If a command fails, the
failure and its output are reported; the commit waits.

## Deliverable

An M1 report: task IDs, changed paths, exact commands with exit codes, real Node/Git/OS versions,
unverified items, known limitations, and the next task (T08). Plus a runnable
`node apps/cli/dist/main.js open --repo <tmp-repo>` (or `bun apps/cli/src/main.ts`) that opens an
authenticated page showing that repository's real state.

## Standing constraints

Everything in `AGENTS.md` §1–§2 applies, in particular: no `runGit` over HTTP, no `node:*` in core,
no decoding before parsing, temporary repositories for every write, no fabricated measurements, no
push/publish, and `references/` is untracked reference material.
