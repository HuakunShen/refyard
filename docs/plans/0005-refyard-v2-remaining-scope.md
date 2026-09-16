# Plan 0005 — The remaining scope: forms 2–4, T16–T18, and the open defects

> Status: **active, revision 2** — written 2026-09-16, after 0.1.1 was published; revised after
> the owner required Cloudflare Worker PWA hosting and a backend-only CLI.
> Implements: `docs/goals/2026-09-16-remaining-scope.md`.
> Source tasks: the design package's T16/T17/T18 (`references/ai-chat/2026-09-14/`), the north
> star's decision table, and the defects this repository's own platform runs produced. Tasks are
> numbered **R1…R15** because T01–T15 are delivered and renumbering them would break every
> reference to them.

## Where the round starts

Published: **refyard 0.1.1** (`UNLICENSED`, `engines: >=22 <27`), verified against the registry.
Green at revision `e78fbc7`: `check`, `check:boundaries`, `check:contract`, `test:unit`,
`test:integration`, `test:pack`, `test:portable`, `build:release`, `pack:smoke`, `bench:runtime`;
`test:e2e` passes 90 of 90 in three engines on macOS, on Linux (chromium and Firefox) and on
Windows — but the three-engine run has **not** been re-run since R1, which is the first thing to do.

## Order, and why it is this order

1. **R1–R2** are small and one of them is a rule violation the design package forbids outright
   ("long-lived localStorage token"). Cheap, and they stop the product from being wrong while the
   larger work happens.
2. **R3–R4** are form 2, the north star's first-class goal and the question the owner actually
   asked. Everything else in the round is worth more once a session can hold more than one
   repository.
3. **R5–R7** are the work form 2 makes more valuable: a compatibility suite (two versions of a page
   against one service), the security cases the security evidence itself names as missing, and
   Windows in CI so the platform rows stop resting on one afternoon.
4. **R8** is the adopted HTTP-layer decision (Hono + OpenAPI + Scalar, MCP read tools). It is a
   refactor with a guard: the whole existing suite, which asserts every auth and origin rule.
5. **R9** is a documentation-truth pass; it exists because drift was found, and it is last among the
   code-adjacent tasks so it describes the finished state.
6. **R10–R11** are T16 and T17 (Xross, Kunkun). Both need the *current* external APIs read from
   their checkouts (`~/Dev/xross-dev`, `~/Dev/kunkun`), never from an old snapshot.
7. **R12–R14** are the gated and verification-only items: form 3 needs the owner's go-ahead, T18
   produces a decision rather than a runtime, and the WebKit-on-Linux row needs one `sudo` command
   on another machine.
8. **R15** binds the deployment shape: the Cloudflare Worker owns only the static PWA, the CLI
   owns only the authenticated backend API, and hosted API calls require an explicit secure origin.

## How to execute this plan

This document is written to be executed by someone who was not in the session that produced
it. Everything it needs is in the repository; nothing depends on memory.

**The loop, per task.** Write the failing case first and *prove it fails for the right reason*
(temporarily undo the fix, or assert against the current behaviour, and paste the failure into
the commit message). Implement the minimum. Run the verification named in the task, and the
gate commands below. Update the outcome table at the top of this file and the evidence file the
task names, in the same commit. Commit only that task's files, with the message the task gives.

**Where things live** (the parts a task will need):

| You are changing | Put the code here | Put the case here | Run it with |
| --- | --- | --- | --- |
| the public JSON contract | `packages/git-contract/src/` (Zod; `z.toJSONSchema` exports it) | `tests/contract/` | `pnpm test:unit` |
| Git argv, parsers, plans | `packages/git-core/src/` (host-free: no `node:*`, no DOM, no `Buffer`) | `tests/core/`, `tests/portable/` | `pnpm test:unit` |
| the Node host (process, filesystem, registry, coordinator, journal, http) | `packages/host-node/src/` | `tests/node/` for adapters, `tests/integration/` for real Git over the real service | `pnpm test:integration` |
| the CLI | `apps/cli/src/` | `tests/integration/cli.test.ts` | `pnpm test:integration` |
| the page | `apps/web/src/` (routes and connection only) | `tests/e2e/*.spec.ts` | `pnpm test:e2e` |
| the components | `packages/git-ui/src/` (never `$app/*`) | `tests/e2e/` for behaviour, `tests/unit/` for pure logic | both |
| a fixture every writer test needs | `tests/support/repo.ts` (isolated HOME/config, no network) | — | — |
| a fact about what was measured | `docs/evidence/` | — | — |

**Gate commands** (all must pass on a revision before it is called done):

```sh
pnpm check && pnpm check:boundaries && pnpm check:contract
pnpm test:unit && pnpm test:integration && pnpm test:pack && pnpm test:portable
pnpm test:e2e          # builds the SPA and the CLI bundle first; ~11 min, three engines
pnpm build:release && pnpm pack:smoke
pnpm bench:runtime     # rewrites docs/evidence/performance.json — commit it or `git checkout` it
```

**Revision this plan starts from:** `e78fbc7` (R1 committed; see the table).

**Traps already paid for — do not rediscover them:**

- **The root TypeScript program has no DOM lib.** `tsconfig.json` covers `scripts/` and `tests/`
  only, and web modules imported by unit tests are pulled into it. A module that names `window`
  will not type-check there. Adding `"DOM"` to that program is *not* the fix: it also replaces
  Node's `setInterval`/`setTimeout` return types with the browser's and breaks
  `packages/host-node/src/process/runner.ts`. The working answer is the one R1 used — keep the
  DOM lookup in a thin module and the rules in one that takes the stores as arguments.
- **The e2e harness prints a failing test's service output** (`tests/support/e2e-service.ts`).
  A failure that says "NetworkError" in the browser now comes with the service's own words.
- **`pnpm test:e2e` needs `pnpm build` and `bun scripts/bundle-cli.ts` first**; the harness
  refuses to run against the placeholder page rather than failing thirty specs on a missing panel.
- **Windows:** `pkill`-style signals do not exist; the service is stopped with `TerminateProcess`,
  and `pack:smoke` records its SIGTERM step as skipped there. A directory cannot be removed while
  a handle inside it is open, which is why fixture teardown retries.
- **`npm exec`** can answer `ETARGET` for a version the registry already serves; the local cache
  needs `npm_config_prefer_online=true` until it revalidates.
- **Fixtures:** anything that writes Git state uses `tests/support/repo.ts` (own HOME, own config,
  no network). Never run a write experiment in a real repository.

## Outcome, per task

Filled in as each task closes. A row that says "not done" names the reason.

| Task | What it changes | Command actually run | Result | Evidence |
| ---- | --------------- | -------------------- | ------ | -------- |
| R1   | the token and the instance id leave `localStorage`; a legacy copy is deleted on read | `pnpm check`, `vitest tests/unit/web-storage.test.ts`, the new e2e case in chromium | **7 unit cases and the browser case pass; both fail against the old behaviour.** Commit `e78fbc7`. The full three-engine `pnpm test:e2e` did *not* run on that revision — it was interrupted by the handover. Run it before trusting the row | the case comments; `storage-policy.ts` |
| R2   | the repository panel stays mounted for a paired session and disables writes while offline | `pnpm build`; `bun scripts/bundle-cli.ts`; `pnpm exec playwright test tests/e2e/workspace.spec.ts --project=chromium` | **3 passed, including the new offline/reconnect clone-form regression; the new case failed against the old implementation with `aria-pressed=false`.** | `tests/e2e/workspace.spec.ts`; `docs/browser-support.md` |
| R3   | `serve --repo A --repo B` explicitly approves and serves both repositories with separate roots and grants | `pnpm exec vitest run tests/integration/cli.test.ts` | **32 passed, including the new multi-repository CLI integration case; the case first failed against the old assembly with an undefined singular path, then exposed and was corrected for canonical real paths.** | `apps/cli/src/{args,main,serve}.ts`; `tests/integration/cli.test.ts` |
| R4   | runtime registration and revocation through the authenticated API, with explicit roots and a durable access audit | `pnpm exec vitest run tests/integration/managed-workspaces.test.ts`; `pnpm exec vitest run tests/integration/auth.test.ts tests/integration/managed-workspaces.test.ts tests/integration/cli.test.ts`; `pnpm exec playwright test tests/e2e/workspace.spec.ts --project=chromium`; `pnpm check`; `pnpm check:contract` | **60 integration cases passed across auth, managed workspaces and CLI; Chromium workspace 4/4; check 8/8; contract 441 schemas. The former `/register` 501 assertion was updated to the correct wrong-method 404.** | `docs/evidence/form2-managed-workspaces.md`; `docs/evidence/security.md`; `docs/evidence/release-matrix.md` |
| R5   | _pending_       |                      |        |          |
| R6   | _pending_       |                      |        |          |
| R7   | _pending_       |                      |        |          |
| R8   | _pending_       |                      |        |          |
| R9   | _pending_       |                      |        |          |
| R10  | _pending_       |                      |        |          |
| R11  | _pending_       |                      |        |          |
| R12  | _pending_       |                      |        |          |
| R13  | _pending_       |                      |        |          |
| R14  | _pending_       |                      |        |          |
| R15  | Worker static PWA, API-only CLI, exact hosted API origin | `pnpm check`; `pnpm test:web-host`; `wrangler deploy --dry-run`; `pnpm test:e2e`; `pnpm pack:smoke` | **Implemented locally. Check 8/8; unit 248; Worker dry-run read 75 files; Worker tests 4/4; full e2e 99/99 across Chromium, Firefox and WebKit; package smoke 14 steps. No live account/domain/tunnel was used.** | `docs/evidence/release-matrix.md`; `docs/evidence/security.md` |

## R1 — The session token leaves `localStorage`

**What:** `apps/web/src/lib/storage.ts` writes the bearer to `sessionStorage` *and* `localStorage`
(`storeToken`, `storeInstance`), while its own module header says the token "is never in
`localStorage`, where it would outlive the service process" — and the design package lists a
long-lived localStorage token among the things this product must not have. The write to
`localStorage` goes; the read keeps a fallback so a token stored by an earlier build is *cleared*
rather than used.

**Why first:** it is a rule, not a preference, and the fix is a few lines with a test that proves the
outcome rather than the intent.

**Rules:** the token still survives a reload (that is what `sessionStorage` is for, and the pairing
ticket is single-use); `disconnect()` and the instance-change path still clear everything; the
service address and the three appearance preferences stay in `localStorage`, because they are
preferences and not credentials.

**Acceptance:** a unit case over the storage module fails before the change (a token written and
then observed in `localStorage`) and passes after; a case asserts a legacy `localStorage` token is
removed on read and never returned; `pnpm test:unit` and `pnpm test:e2e` pass.

**Commit:** `fix(web): keep the session token out of localStorage`

## R2 — The repository panel keeps the choice the user made

**What:** `<RepositoryPanel>` holds its mode (`init` | `clone`) in component state
(`packages/git-ui/src/components/RepositoryPanel.svelte:83`) and is mounted behind
`{#if writesAllowed}` (`apps/web/src/routes/+page.svelte:1776`). `writesAllowed` is
`token !== null && !blocksWrites(negotiation) && browserOnline` — so it includes a **transient**
signal. Whenever the browser reports offline and back (a laptop lid, a tunnel, dropped Wi-Fi), the
panel is destroyed and created again and the mode resets to "Create new", taking anything typed
into the destination or remote fields with it. The panel is the **only** one gated that way: every
other panel is gated by its capability flag (`stagingAvailable`, `commitAvailable`, …), which is why
this defect is unique to it and why the fix is "follow the neighbours' convention" — mount on the
session, refuse the write with a message when it cannot go, exactly as `staging-message` already
does while offline.

**The failing case to write first** (in `tests/e2e/workspace.spec.ts`, which already starts a
service and a repository): pair, click `repository-mode-clone`, assert `repository-remote-url` is
visible; `await context.setOffline(true)`, wait briefly, `await context.setOffline(false)`; then
assert the clone form is **still** there and `repository-mode-clone` still reports `aria-pressed`.
Against the current code the panel is gone and has come back in `init` mode, so the case fails for
the right reason.

**Why:** it is the only defect known to be in the shipped product, and it is invisible in a fast
local run (which is why it survived this long).

**Rules:** the fix keeps the panel a dumb component (state belongs to the page, or the mount
condition stops flipping once capabilities have arrived). No behaviour is added beyond "the choice
survives"; capability gating stays exactly as strict.

**Acceptance:** an e2e case fails before the fix — open the workbench, choose "Clone", let the
capabilities read land late, and assert the clone form is still there. `pnpm test:e2e` passes in all
three engines; `docs/browser-support.md`'s flake section is updated to say the cause is fixed.

**Commit:** `fix(web): do not reset the repository panel when capabilities arrive late`

## R3 — Form 2, part 1: the CLI can open more than one repository

**What:** `refyard serve --repo A --repo B` is accepted today and **silently serves only the last
one** — measured against the published 0.1.1 tarball: with two repositories named, `/api/v1/repositories`
listed one (`…/two`) and nothing said the other had been ignored. `--repo` is declared once in
`apps/cli/src/args.ts` (`repo: { type: "string" }`), and `apps/cli/src/serve.ts:180` approves exactly
one root (`roots.approve({ path: repositoryPath })`) and registers exactly one repository. It becomes
either a refusal or the documented behaviour: every `--repo` is approved as its own root and
registered, exactly as a single one is today — never a widened parent directory (north star §9). The
readiness object and the session grants carry the list; both are already arrays in the contract
(`sessionExchangeResponse.grants.allowedRootIds[]`, `.repositoryIds[]`).

**Why:** this is the smallest honest step of form 2, it fixes a silent-last-wins surprise, and it is
what the owner asked for ("打开设备上多个 repo").

**Rules:** one root per repository, each approved explicitly; no parent-directory grant, ever; the
session's scope is a list and nothing else changes about how a scope is enforced; a repository that
cannot be approved fails startup with the reason named rather than being dropped.

**Acceptance:** an integration case asserts two repositories are both listed and both readable, and
that a third repository on the same disk is still refused; a case asserts the *silent* last-wins is
gone (either an error naming the rule, or two entries — whichever the implementation chooses, the
test pins it); `pnpm test:integration` and `test:e2e` pass.

**Commit:** `feat(cli): approve and serve every repository named on the command line`

## R4 — Form 2, part 2: approval at runtime, journaled, revocable

**The endpoint already has a name and a deliberate 501:** `POST /api/v1/repositories/register` is
the single entry in `UNIMPLEMENTED_PATHS` (`packages/host-node/src/http/router.ts`), answered
`UnsupportedOperation` after authentication and asserted by `tests/integration/auth.test.ts`. This
task is where that entry disappears, and the comment that explains it should move into the task's
commit message rather than being deleted silently. The response shape (`repositoriesResponseSchema`
in `packages/git-contract/src/reads.ts`) already carries `repositories[]` and `allowedRoots[]` with
each root's `repositoryIds[]`, so the UI has something to read before anything new is written.

**What:** the full form 2 shape from the north star: a user adds a repository from the UI (a path
inside an already-approved root, or a newly approved root); the grant grows **by approval**, each
addition is journaled with the path, the root and the moment; revocation exists; the UI never invents
a repository; a registration that fails validation returns a problem the UI shows as itself and the
list stays as it was. This is where `/api/v1/repositories/register` — today a deliberate 501 — stops
being unimplemented.

**Why:** it is the form's actual promise: "from the UI a user adds another directory on the same
machine … without restarting the service or re-running the CLI".

**Rules:** approval is a user act, never a scan (no `$HOME` walk, no "recent repositories"); the
registration request carries a path the *user* chose, and the host checks containment and
repository-ness before granting; every grant and revocation is a journal entry (so it survives a
restart as a record even though the grant itself is per-process); widening an approved root because
a path was inconvenient is not a thing this task may do; the one-writer-per-common-Git-directory
queue is unaffected, because it keys on the common Git dir and not on the session.

**Acceptance:** integration and e2e cases for: a repository added inside an approved root; a new root
approved; a path that is not a repository refused with its own problem; a path inside `.git`
refused; an already-registered path refused; revocation removing read access; and a restart showing
the journaled record. `docs/evidence/security.md` gains the new refusals; the release matrix's
"deliberately absent" row for `/register` is corrected.

**Commit:** `feat(host): approve repositories at runtime, journaled and revocable`

## R5 — A page and a service that disagree: the compatibility suite

**What:** `tests/compat/` (named in AGENTS §3, absent — confirm with
`ls tests`; the only compatibility logic today is `apps/web/src/lib/session-negotiation.ts` plus its
unit test) with cases for the directions the protocol supports: a page whose `apiMajor` differs from
the service's (it refuses rather than guessing), a page from an older build against a newer service
(reads both understand keep working; writes are blocked), and a *service* field the page does not
know (it ignores what it does not need rather than failing). The service already reports
`apiMajor` and `contractVersion` in its readiness object and in `session/exchange`, so a case can
drive the mismatch by pairing against a service whose answer is rewritten in flight — a small proxy
in the test, or a fixture service built with a different major, whichever is less machinery.

**The suite needs a root script.** Add `pnpm test:compat` to `package.json` and to the gate list in
AGENTS §5, and to `.github/workflows/ci.yml`, in the same commit — a suite nobody runs is a suite
that rots.

**Why:** the product ships two artifacts separately — a page in a browser's service-worker cache and
a service in a terminal — so "which pair is running" is a real user state, not a hypothetical.

**Rules:** the cases use the real built SPA and the real host; the incompatible case must show the
refusal *and* that nothing was written; no test may weaken the refusal to make an older page work.

**Acceptance:** `pnpm test:integration` covers the service side; a new root script runs the suite
(`pnpm test:compat`, wired into the gate list and CI) and its cases fail if the negotiation check is
removed.

**Commit:** `test(compat): pin what a page and a service do when they disagree`

## R6 — The security cases the security evidence names as missing

**What:** `docs/evidence/security.md` already lists what it does **not** cover. This task closes the
part of that list which can be closed with the existing harness: a hostile remote (a
`transport-helper`/`ext::` URL is already refused — extend to the credential paths), a credential
prompt that must never hang a request (`GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, an ssh askpass that
would block), a repository whose `.gitmodules` points somewhere hostile, hooks that must be
*preserved and run* rather than bypassed, and limit abuse (an oversized `pathIds` set, an oversized
body, a path id from another service).

**Why:** these are the failure modes that matter for a tool that runs the user's Git with the user's
credentials, and the evidence file says out loud that nobody has exercised them.

**Rules:** every case asserts the *effect on the repository*, not only the status code; a case that
cannot be written honestly (because the environment cannot host it) is named as still-missing in the
same file rather than approximated.

**The cases, named so the work is bounded** (all in `tests/security/negative.test.ts`, which has 15
cases today, or a second file beside it if it grows past reading size):

1. a remote whose URL is a transport helper (`ext::…`) or a bare option — one case exists for the
   clone path; add the `addRemote` + `fetch` pair, and assert nothing was fetched;
2. a repository configured to need credentials: `GIT_TERMINAL_PROMPT=0` and `GIT_ASKPASS` are set by
   the host, so the case asserts the operation **returns** with a credential problem instead of
   hanging — with a deadline, so a regression shows up as a failure rather than a timeout;
3. a `.gitmodules` whose URL is hostile (transport helper, absolute path outside the root) — the
   submodule read must refuse it, and a submodule operation must not act on it;
4. a hook the user has installed must **run** (the product never adds `--no-verify`): install a
   pre-commit hook that fails, attempt a commit, assert the commit was refused *by the hook* and
   that the hook file is untouched afterwards;
5. limit abuse: a `pathIds` array past the contract's maximum, a body past the request bound, and a
   `pathId` minted by a different service — each refused, each asserted to change nothing on disk;
6. a `.git` directory the service does not own (a foreign `index.lock`) — one case exists; extend it
   to assert the lock is still there after the refusal and that the repository is writable again
   once the lock is removed by hand.

Cases that cannot be written honestly (no such environment here — for example a real SSH host, a
real credential helper, a hostile server over the network) stay in the "still not done" list with
the environment that would be needed, rather than being approximated.

**Acceptance:** the new cases fail if the guard they test is removed; `docs/evidence/security.md` is
rewritten to separate "covered by a case and named" from "still not done"; no claim of an audit is
made anywhere.

**Commit:** `test(security): exercise the hostile paths the evidence named as missing`

## R7 — Windows in CI

**What:** `.github/workflows/ci.yml` (two jobs today: `verify (ubuntu-latest)` and
`verify (macos-latest)`, each installing bun with `oven-sh/setup-bun@v2`, all three Playwright
browsers, then running the gate list) gains `verify (windows-latest)`. The suite already passes
there — 90 of 90 in three engines in 4.9 m, measured on a real Windows 10 machine with Node 26.5.0
and Git 2.55.0.windows.3 (`docs/evidence/linux-and-windows.md`, "Round two") — so this is a
workflow change, not a port.

**What to expect on that runner, from the same measurement:** `pack:smoke` records its SIGTERM step
as skipped (Windows has no signals), `test:e2e` needs no extra system packages (the browsers ship
their own DLLs), and the paths are longer than the POSIX ones, which the fixtures already tolerate.

**Why:** every Windows row in the evidence currently rests on a single manual afternoon. Continuous
runs are how a row stops being anecdotal.

**Rules:** the Windows job runs the same commands, not a reduced set, and a step that must differ
(the SIGTERM step `pack:smoke` skips) says so in its own output rather than being silently absent.

**Acceptance:** a green `windows-latest` run recorded in `docs/evidence/release-matrix.md` with its
run id; the platform row changes from "manual runs" to "CI + manual".

**Commit:** `ci: run the gates on windows-latest`

## R8 — The HTTP layer on Hono, with an OpenAPI document and MCP read tools

**Where the surface is today** (so the migration is bounded): `packages/host-node/src/http/` holds
`server.ts` (listen, TLS-free loopback, routing table), `router.ts` (`readRoutes()`,
`mutationRoutes()`, `UNIMPLEMENTED_PATHS`, the body/query validation and the problem shapes),
`auth.ts` (tickets, sessions, the exact `Origin`/`Host` checks), `assets.ts` (the SPA), and
`json.ts`. Every route is declared with a contract schema, which is what makes the OpenAPI document
a *derivation* rather than a second description.

**What:** the north star's decision: the HTTP layer moves to **Hono** with `hono-openapi` and
**Scalar** for the reference UI, and **MCP read tools** are published via `@hono/mcp` — read tools
first, and only reads. The contract stays where it is: `packages/git-contract` is still the single
source, `z.toJSONSchema` still produces the document, and the OpenAPI artifact is generated from it
rather than hand-written.

**Why:** it is an adopted decision, and it is the difference between "a private JSON API" and "an API
another tool can discover" — which is exactly what forms 3 and 4 and the MCP surface need.

**Rules:** every existing auth and origin rule survives byte for byte — authenticated reads
included, exact `Origin`/`Host`, single-use ticket, no CORS wildcard, JSON 404 for unknown `/api`,
no SPA fallthrough; the existing suite is the guard and must pass unchanged; **no MCP tool may
mutate** in this task; the static SPA keeps being served by the same origin.

**Acceptance:** the generated OpenAPI document matches the Zod schemas (a contract test, like the
existing `check:contract`); an MCP client can list and call the read tools against a real service;
the full gate list passes; `docs/evidence/release-matrix.md` records the migration and what is
deliberately absent from the MCP surface.

**Commit:** `feat(host): serve the API through Hono with an OpenAPI document and read-only MCP tools`

## R9 — Documentation truth pass

**The list, with the evidence that found it** (re-verify each before editing — some may have been
fixed by another task in this plan):

- `packages/host-node/src/http/router.ts` — the header comment still says `previews`/`operations`/`events`
  are names that "answer 501". All three are implemented routes; `UNIMPLEMENTED_PATHS` has one entry.
- `packages/host-node/src/coordinator/jobs.ts` — header says the effect registry "is empty outside
  tests, so `submit` refuses every real mutation". False since T08–T12: `serve.ts` registers five
  effect factories, and `implementedKinds()` is what `capabilities` reports.
- `apps/web/src/routes/+page.svelte` — header says "Everything here is a read. There is no submit, no
  stage, no discard". The same file imports the mutation client and submits operations.
- `docs/evidence/performance.md` — the reference plan names this file; what exists is
  `performance.json` (the machine-written report) plus the release matrix's summary of it. Decide and
  write the decision down: either a short `.md` that reads the JSON, or a note in the matrix saying
  the JSON *is* the report.
- `packages/logo/` — three SVGs, no `package.json`, not a workspace member, and nothing references
  them; the app ships its own copies in `apps/web/static/`. Decide: wire it, delete it, or leave it
  with a README saying what it is for.
- `packages/npm-dist/web/web-hidden/` — a second complete copy of the staged web build, produced by
  the release build with no source reference to the name. Find out what writes it and why (start at
  `scripts/build-release.ts`); either it is deliberate (and gets a comment and a test) or it is a
  leftover (and goes).

**What:** the drift the inventory found, fixed at the source: `packages/host-node/src/http/router.ts`
still calls `previews`/`operations`/`events` unimplemented 501 names;
`packages/host-node/src/coordinator/jobs.ts` says the effect registry is empty outside tests;
`apps/web/src/routes/+page.svelte` says "Everything here is a read. There is no submit, no stage, no
discard"; `docs/evidence/performance.md` is named by the reference plan and does not exist while the
JSON report does; `packages/logo` is not a workspace package and nothing references it; and
`packages/npm-dist/web/web-hidden/` holds a second copy of the staged web build with no source
reference to the name.

**Why:** a comment that contradicts the code is worse than no comment — it is a statement this
repository's rules would have a reader believe.

**Rules:** no behaviour changes in this task. Where the right answer is a decision rather than a
sentence (the logo package, the `web-hidden` directory), the decision is written down in the same
commit.

**Acceptance:** `pnpm check` clean; a grep for the stale sentences returns nothing; the evidence
index in `release-matrix.md` points at files that exist.

**Commit:** `docs: correct what the code says about itself`

## R10 — T16: Xross launches the installed service

**Read this before writing anything.** Xross was read at revision `97925a3f` (2026-09-16,
`~/Dev/xross-dev`) to answer one question: is what the reference plan describes buildable today?
The answer is **partially**, and the difference decides what this task may claim:

| The plan assumes | What Xross has today |
| --- | --- |
| Remote exec | **Exists and is e2e-proven.** Service `xross.exec.v1`, contract `crates/contract/xross-exec-contract/src/lib.rs`, operation `xross.exec.v1.run`. Authorization has three layers: the action-class map (`crates/contract/xross-authorization/src/lib.rs` maps that operation to `ActionClass::Shell`), the per-device peer ceiling (`AllowPeerActions`; the pairwise base ceiling is `TransferSend` alone — "there is no default, no `--full`"), and the receiver's program allow-list (`shell-allow`, default deny, typed refusal `ExecRejection::CommandNotPermitted`). Proven by `packages/e2e/tests/exec.test.ts` — 7 rows through two real `xrossd` processes. |
| Port forwarding (the plan says "CrossTunnel") | **Exists and is e2e-proven.** Service `xross.tunnel.v1`, operation `xross.tunnel.v1.forward`, target `TunnelTarget::Tcp { host, port }`; local control API `OpenForward`/`CloseForward` in `proto/xross/control/v1/control.proto`; capability `xross.control.v1:forward.open`, class `NetworkEgress`, receiver-side `egress-allow` ("absent means forward nothing"). `xs ssh` is the precedent: forward to the peer's `127.0.0.1:22`, then point the real client at the forwarded port. |
| An app definition to declare "refyard, version X, needs Node and Git" | **Does not exist.** There is no app registry or launcher; `ServiceRegistry` registers typed *services*, not programs. The only "remote apps" text is CrossCopy's legacy inventory, marked design-only and non-normative. |
| `dependencyMissing` with the missing names | **Nothing to read it from.** A missing binary surfaces as an untyped spawn error, and there is no version check anywhere. |
| "One-click launch, then browse" | **No ownership story for the launched program.** One exec call is one process and it does not outlive the call (`Run::Drop` ends the process group; "no second lane, no attach"). The tunnel, by contrast, is daemon-owned and outlives the CLI. |

**What is buildable today, and what this task should build:** launch `refyard serve --json` on a
paired device through an exec call **held open for the session** (so the service is not killed when
the call returns), read the pairing URL off that exec stream — an already-authorized channel, which
is exactly where a ticket belongs — and `OpenForward` the service's loopback port so the caller's
browser can reach it. The prerequisites are the device's `shell-allow` entry for the refyard binary
and its `egress-allow` entry for the port. Both are the *peer's* decisions; the integration presents
them, never writes them.

**What this task must not claim:** a version check, an implicit install, or a dependency report it
cannot produce. `dependencyMissing` means "the program is not in the peer's `shell-allow`, or the
exec call was refused" and says so in those words. The README states plainly that declaring
"refyard, version X, needs Node and Git" needs a concept Xross does not have yet.

**Rules:** nothing is installed implicitly; no `latest` fetch; no privilege escalation; a tunnel
grants nothing by itself; no Git output is parsed and no graph is copied; the UI stays the same
artifact; the exec stream and the forward are closed when the session ends.

**Acceptance:** the launch policy is a pure function with cases (`selectLaunchOutcome`:
`ready`/`dependencyMissing`/`permissionDenied`, `installAutomatically: false`); the integration's
tests pass; `pnpm check:boundaries` stays clean; and a real launch on this machine is recorded **with
the Xross revision it was tested against** — or the row stays `unverified` with that named. A test
against a stub is not evidence that a device launched anything.

**Commit:** `feat(xross): launch the installed service through an authorized tunnel`

## R11 — T17: the Kunkun adapter

**Read this before writing anything.** Kunkun was read at the revision checked out in
`~/Dev/kunkun` (2026-09-16) to answer the same question, and the answer is again **partially**:

| The plan assumes | What Kunkun has today |
| --- | --- |
| A manifest that declares the extension | **Exists.** `package.json` under a `kunkun` key (`packages/sdk/src/manifest/schema.ts`), requiring `kunkun.identifier` and `kunkun.commands[]`; a real minimal example is `extensions/sample-headless-node/package.json`. There is no published `@kunkunsh/sdk` version to pin — the monorepo is `0.0.0` with `workspace:*` consumers. |
| A privileged side that runs outside the webview | **Exists.** Command modes `node-headless`/`worker-headless`, and `kunkun.services[]` whose handler is a default-exported `ServiceDefinition`, dispatched by `callServiceMethod`. The runtime is chosen per command: **Deno > external Node > Electron utilityProcess** (`apps/desktop/electron/headless-worker-manager.ts`). |
| kkrpc as the transport | **Exists, but it is not `call(method, input)`.** kkrpc exposes nested proxies (`await remote.backend.spawn(...)`) over `{t:"q"|"r", id, op, p: string[], a?}` records. It has **no authentication of its own**; Kunkun's boundary is the preload bridge, which injects only the channels issued to that window, each behind a one-time token. |
| "The host holds the token and the authorization" | **No credential broker exists.** The host holds channel identity and backend tokens; its only host-minted credential for a local service is the AI proxy's `createSession()`. **Token custody must live in the extension's own backend process.** |
| "The renderer never connects to localhost directly" | **Not something Kunkun enforces.** Permissions gate the *host API* (`network.fetch` needs `network` + `domains`), not a webview's own `fetch`. What makes the direct path useless is refyard itself: the page's origin would be `kunkun-ext://<pluginId>`, and the service refuses a foreign or null `Origin`. So the property holds, and it holds **because of the product's own rule** — the adapter must not weaken that, and the README should say so. |
| "The UI stays the same artifact" | **Half true.** A `custom-view` command serves a static bundle from `kunkun-ext://` (the window is `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`). Reusing the SPA means swapping its connection seam for the kkrpc channel — never an arbitrary external URL, which does not exist in production — and replacing SSE with kkrpc streaming, because `EventSource` is not a Kunkun transport. This is what `packages/git-ui` was kept host-injected for. |
| "A refusal stays a refusal" | **By string, not by code.** A denial is a rejected promise carrying an `Error` named/messaged `Permission denied: …` (from `packages/plugin-runtime/src/permissions.ts` through kkrpc's error serializer). There is no machine-readable deny code, so the adapter must match on the error's name/message and must not invent a code path that treats an unknown failure as permission. |

**What this task should build**, following the one pattern that exists in-tree (the `kkterminal`
extension: a `custom-view` command plus a `backend` permission entry, then a second kkrpc channel to
the spawned backend process): `integrations/kunkun/` with a manifest (`kunkun.identifier`,
`kunkun.commands[0]` as `custom-view`, `kunkun.permissions[]` naming `backend` with the script and
runtime it needs), a backend process that owns the refyard session — spawning or attaching to the
service, holding the token, and exposing GitService calls over kkrpc — and a thin view that mounts
the existing components against that channel.

**Rules:** the adapter speaks the public `GitService` and nothing else; it never re-implements Git;
it holds no second permission model; a `Permission denied` refusal surfaces unchanged; there is no
fallback to a direct loopback call, and no code path that turns an unknown error into an allowance;
the Kunkun revision it was built against is recorded.

**Acceptance:** the adapter's tests pass against a stubbed kkrpc surface that refuses **and**
against a real host for the happy path; a case asserts a refusal is surfaced as a refusal;
`pnpm check:boundaries` stays clean; installation and uninstall are recorded with the Kunkun revision
used, or the row stays `unverified` with that named. Two things this task does **not** assume and
should state as unknown until measured: the packaging/install flow for an out-of-tree
`integrations/kunkun`, and whether a custom view can target an out-of-tree extension path.

**Commit:** `feat(kunkun): adapt the workbench to the Kunkun host without a second Git domain`


## R12 — T18: the native-host question, answered with measurements

**What:** `docs/research/native-host-evaluation.md`: the measured Node bottleneck (from
`docs/evidence/performance.json` and the platform runs), the candidate VM/platform, what a real
measurement on it would require, and a **decision** — adopt, defer, or stay on Node.

**Why:** the reference plan makes this a review gate, not an implementation task, and the north star
says form 4 uses the same core. The honest output is a decision with evidence, and this task exists
so the question stops being open by default.

**Rules:** no implementation, no spike that lands in the product, no QuickJS hello-world presented as
a cost measurement; a budget in the reference plan (512 KiB / 5 MiB) is a review rule, not a result;
without explicit approval the conclusion is "continue on Node", written down.

**Acceptance:** the document contains the sections the design package names and every number in it is
from a command that was run here or is labelled as unverified.

**Commit:** `docs: answer the native-host question against measured needs`

## R13 — Form 3: the hosted UI, if the owner says ship it

**What:** the opt-in hosted form: a password-gated, origin-allowlisted mode in which the same SPA and
the same API are reachable from another machine.

**Why it is last among the features:** it is the one change that widens the product's threat model
by design, so it needs the security work (R6) and the compatibility suite (R5) in place first, and
the north star requires that it never be the first place a mutation appears.

**Rules:** opt-in and off by default; a password (not a ticket alone) for the first pairing; an
origin allowlist, no wildcard; TLS is the operator's, and the documentation says so; the loopback
default and the one-origin property are unchanged (north star §3).

**Acceptance:** integration cases for a foreign origin without an allowlist entry (refused), with
one (allowed), and for a wrong password (refused); the release matrix's "deliberately absent" row is
updated to say what shipped and what did not.

**Commit:** `feat(host): an opt-in, password-gated, origin-allowlisted hosted form`

## R14 — WebKit on Linux, once the machine has the library

**The machine:** Ubuntu 24.04 at `ssh ufo`, the checkout at `~/Dev/refyard` (see
`docs/evidence/linux-and-windows.md` for how the earlier rounds were driven: copy, `git pull`,
`pnpm install --frozen-lockfile`, `PATH` needs `~/.nvm/versions/node/v26.8.2/bin` **and**
`~/.bun/bin` — a non-interactive shell has neither, which is how the first attempt died on
`sh: 1: bun: not found`).

**The blocker, exactly:** WebKit fails to launch with `Host system is missing dependencies to run
browsers … sudo apt-get install libavif16`. Chromium and Firefox both pass there (30 of 30 each).
A no-root workaround was tried and abandoned deliberately: `libavif.so.16` itself needs
`libgav1.so.1` and `libyuv.so.0`, and Playwright checks a longer list than that — hand-assembling a
library path to dodge one `install-deps` would not be evidence anyone should trust.

**What:** on that machine, `sudo pnpm exec playwright install-deps`, then `pnpm test:e2e` in three
engines; the WebKit-on-Linux row becomes verified or stays blocked with the command that would end it.

**Why:** it is the last browser row that is unverified for a reason that is one command long.

**Rules:** the machine's packages are the owner's to change; nothing else on that machine is
modified; a failure found there is fixed with a case or recorded, never skipped.

**Acceptance:** the row in the platform evidence file states the outcome and the engine version.

## R15 — Cloudflare Worker PWA and backend-only CLI

**What:** deploy `apps/web/build` as a Cloudflare Workers Static Assets site with the existing
SvelteKit SPA and service worker; the npm/CLI artifact owns only the Node Git backend and never
ships or serves the web bundle. The browser may call a CLI service only through an explicitly
configured HTTPS endpoint (for example a user-owned Cloudflare Tunnel) whose exact UI origin is
allowed by the CLI. `--api-origin` names the browser-visible HTTPS endpoint; the local listener
remains loopback and the tunnel must forward to it.

**Files:** `apps/web/wrangler.jsonc`, `apps/web/static/_headers`, `apps/web/package.json`,
`package.json`, `apps/web/src/lib/connection.ts`, `apps/cli/src/{args,main,serve}.ts`,
`packages/host-node/src/http/{server,origins}.ts`, `tests/{web-host,security,compat}/*`,
`docs/{installation,browser-support,evidence/release-matrix}.md`.

**Interfaces:** the Worker is an asset-only deployment; it has no Git binding, secret, API proxy,
or server route. Its `assets.directory` is `./build` and its SPA fallback is
`single-page-application`; `_headers` supplies exact security headers because Wrangler has no
`headers` config field. The CLI accepts an exact allowlisted UI origin, emits a pairing URL that
carries the API origin and one-use ticket, and adds exact CORS response headers only for that
allowlisted origin. No wildcard origin, credential cookie, token in `localStorage`, or token in a
Cloudflare binding is permitted.

**Rules:** HTTPS termination/tunnel ownership is explicit and documented; a public Worker cannot
reach a user's loopback by itself. The Worker caches only its own bounded static assets; its service
worker never intercepts or caches `/api/*` or cross-origin API requests. Secrets use Wrangler's
secret mechanism or the local CLI environment, never source, `vars`, query strings, or process
arguments. The backend retains bearer auth, ticket TTL/replay protection, repository scope and
hostile-origin refusal. The CLI's legacy static asset path is removed from the production package;
local browser tests use a separate static asset server and the same public API client path.

**Acceptance:**

- `pnpm build` produces the static SPA and PWA files; `pnpm --dir apps/web exec wrangler deploy --dry-run`
  validates the Worker configuration and asset upload without publishing;
- a test serves the built assets through the Worker-compatible configuration and asserts SPA routes
  fall back, `/api/*` does not fall back to HTML, security headers are present, and non-GET asset
  requests are refused;
- backend tests assert same-origin behavior remains unchanged, an unlisted hosted origin is refused,
  an exact allowlisted origin can preflight and exchange a one-use ticket, and a tunnel/API URL is
  still bearer-authenticated; browser tests pair against the separate static host and leave the CLI
  process responsible for API only;
- package tests assert the npm artifact has no `web/` files and the CLI readiness output identifies
  an API-only service; docs state the Cloudflare Worker revision, HTTPS/tunnel prerequisite, and
  unverified deployment account/domain separately from local dry-run evidence.

**Commit:** `feat(deploy): host the PWA on Cloudflare and keep the CLI API-only`
