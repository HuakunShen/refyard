# Plan 0005 — The remaining scope: forms 2–4, T16–T18, and the open defects

> Status: **active, revision 1** — written 2026-09-16, after 0.1.1 was published.
> Implements: `docs/goals/2026-09-16-remaining-scope.md`.
> Source tasks: the design package's T16/T17/T18 (`references/ai-chat/2026-09-14/`), the north
> star's decision table, and the defects this repository's own platform runs produced. Tasks are
> numbered **R1…R14** because T01–T15 are delivered and renumbering them would break every
> reference to them.

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

## Outcome, per task

Filled in as each task closes. A row that says "not done" names the reason.

| Task | What it changes | Command actually run | Result | Evidence |
| ---- | --------------- | -------------------- | ------ | -------- |
| R1   | _pending_       |                      |        |          |
| R2   | _pending_       |                      |        |          |
| R3   | _pending_       |                      |        |          |
| R4   | _pending_       |                      |        |          |
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

**What:** `<RepositoryPanel>` is mounted behind `{#if writesAllowed}` and holds its mode
(`init` | `clone`) in component state, so a capabilities read that resolves after the first paint
destroys and recreates it — the mode a user just selected resets to "Create new". This is the defect
that made three long e2e runs fail one case each.

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
one** (measured). It becomes either a refusal or the documented behaviour: every `--repo` is
approved as its own root and registered, exactly as a single one is today — never a widened parent
directory (north star §9). The readiness object and the session grants carry the list.

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

**What:** `tests/compat/` (named in AGENTS §3, absent) with cases for the two directions the protocol
supports: an older page against a newer service (writes are blocked, reads that both understand keep
working) and a page whose API major differs (the page refuses rather than guessing). The negotiation
rules already exist (`apps/web/src/lib/session-negotiation.ts`, `apiMajor`); this suite makes them
end-to-end rather than unit-only.

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

**Acceptance:** the new cases fail if the guard they test is removed; `docs/evidence/security.md` is
rewritten to separate "covered by a case and named" from "still not done"; no claim of an audit is
made anywhere.

**Commit:** `test(security): exercise the hostile paths the evidence named as missing`

## R7 — Windows in CI

**What:** `.github/workflows/ci.yml` gains a `windows-latest` job running the same gate list (e2e
included — 90 of 90 passes there in 4.9 m on one machine).

**Why:** every Windows row in the evidence currently rests on a single manual afternoon. Continuous
runs are how a row stops being anecdotal.

**Rules:** the Windows job runs the same commands, not a reduced set, and a step that must differ
(the SIGTERM step `pack:smoke` skips) says so in its own output rather than being silently absent.

**Acceptance:** a green `windows-latest` run recorded in `docs/evidence/release-matrix.md` with its
run id; the platform row changes from "manual runs" to "CI + manual".

**Commit:** `ci: run the gates on windows-latest`

## R8 — The HTTP layer on Hono, with an OpenAPI document and MCP read tools

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

**What:** `integrations/xross/` — an app definition, the launch policy (`selectLaunchOutcome`, whose
inputs are `nodeMajor`, `gitSupported`, `refyardInstalled`, `actorIsPrivileged` and whose outcomes
are `ready`/`dependencyMissing`/`permissionDenied` with `installAutomatically: false`), and contract
tests. It consumes Xross's **current** authenticated exec/tunnel surface, read from
`~/Dev/xross-dev` at the time of writing the task — never from a snapshot in the design package.

**Why:** it is the reference plan's M4, it is unblocked now that V1 shipped, and it is the first real
test of whether the GitService boundary holds up outside a browser.

**Rules:** a missing Node, Git or refyard is reported as `dependencyMissing` with the missing names —
never installed, never fetched at `latest`, never escalated; the tunnel carries the ticket through an
authorized channel only; establishing a tunnel grants nothing by itself; the integration parses no
Git output and copies no graph; the UI stays the same artifact.

**Acceptance:** the integration's own tests pass; `pnpm check:boundaries` stays clean; a real launch
on this machine is recorded with the Xross revision it was tested against, or the row stays
**unverified** with that named.

**Commit:** `feat(xross): launch the installed service through an authorized tunnel`

## R11 — T17: the Kunkun adapter

**What:** `integrations/kunkun/` (manifest, adapter, README) plus `createPluginGitService`, which
takes the host's existing kkrpc call adapter `(method, input) => Promise<unknown>`, validates every
return value with the public schemas, and keeps a refusal a refusal.

**Why:** the north star's form-4 discussion and the design package both expect the same UI to run
inside Kunkun; the value is proving the `GitService` boundary is host-agnostic, not writing a second
Git implementation.

**Rules:** the plugin talks to an external refyard service by default; the host holds the token and
the grants; the renderer never connects to loopback itself; there is **no second Git domain and no
second permission system**; a `Forbidden` from the host surfaces unchanged, with no fallback path.

**Acceptance:** the adapter's tests pass against a stubbed kkrpc surface that refuses, and against a
real host for the happy path; `pnpm check:boundaries` stays clean; installation and uninstall are
recorded with the Kunkun revision used.

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

**What:** on the Ubuntu machine, `sudo pnpm exec playwright install-deps`, then `pnpm test:e2e` in
three engines; the WebKit-on-Linux row in `docs/evidence/linux-and-windows.md` becomes verified or
stays blocked with the command that would end it.

**Why:** it is the last browser row that is unverified for a reason that is one command long.

**Rules:** the machine's packages are the owner's to change; nothing else on that machine is
modified; a failure found there is fixed with a case or recorded, never skipped.

**Acceptance:** the row in the platform evidence file states the outcome and the engine version.
