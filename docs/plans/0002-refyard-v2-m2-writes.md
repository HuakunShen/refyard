# Plan 0002 — Refyard v2, M2: the write loop (T08–T12)

M1 (T01–T07, plan 0001) shipped the read-only loop. This plan covers M2: the
mutations from the v2 design's frozen list of 35, grouped by the reference
`IMPLEMENTATION_PLAN.md` into T08–T12. Each task keeps the commandments: failing
test first, minimum implementation, the listed verification actually run, one
commit per task.

`capabilities` is the contract with the browser: an operation appears there
exactly when an effect for it is registered, because both derive from the same
registry in the coordinator.

---

## T08 — Stage, unstage, discard, commit and amend

Files, as delivered:

```
packages/git-core/src/workflows/stage.ts        stage / unstage (born and unborn HEAD)
packages/git-core/src/workflows/discard.ts      discard selection rules + restore
packages/git-core/src/workflows/commit.ts       commit / amend with Head re-read
packages/host-node/src/coordinator/previews.ts  the five effects (createStagingEffects)
packages/git-ui/src/components/{StagingPanel,CommitPanel,ConfirmAction}.svelte
apps/web/src/routes/+page.svelte                mutation client + panels
tests/integration/staging.test.ts               23 cases, real Git, real HTTP
tests/e2e/staging.spec.ts                       4 cases in Chromium
```

Operation semantics implemented (DESIGN §9.1):

- **stage** stages exactly the selected paths; a selected rename stages the origin
  path too, so the index holds a rename rather than a copy plus a stale entry; a
  deleted file stages as a deletion; nothing is staged recursively.
- **unstage** changes the index only, with a separate `rm --cached` planner for an
  unborn HEAD (`restore --staged` needs a HEAD that does not exist yet).
- **discard** restores tracked working-tree files to the index — never to HEAD,
  never untracked, never ignored, never `git clean` — after a verified backup;
  a backup that cannot be written refuses the whole discard.
- **commit** commits the index as it stands (no implicit staging, no empty commit,
  no `--no-verify`, no editor), the message on stdin as bytes.
- **amend** requires `confirmed: true` at the schema, rewrites the tip, and performs
  no follow-up push.

### Deviations and findings, recorded deliberately

- **A substrate defect was found by the first end-to-end write.** The read layer's
  snapshot index key and the submit-time freshness check were computed by two
  functions that encoded the same facts differently (`:` vs NUL between path and
  origin), so every submission was refused `StaleSnapshot`. Both now call one
  derivation, `statusIndexKey` in `coordinator/preconditions.ts`; the duplicate
  `indexKeyOf` in `reads.ts` delegates to it, and `submit.ts`'s `currentIndexKey`
  is a thin wrapper.
- **`POST /api/v1/previews` was implemented but never routed.** The read service has
  had `previews()` since T05 and `tests/integration` exercised it in-process, but
  the HTTP router never registered the path and `UNIMPLEMENTED_PATHS` listed it as
  a 501. T08 routes it; `/api/v1/repositories/register` is the one remaining
  unimplemented path.
- **`POST /api/v1/operations` now answers 202 for a fresh acceptance.** It answered
  200, while the contract's own client (written in T05) requires 202 before it will
  call a response "accepted" — the mismatch surfaced the moment a browser first
  submitted through the real client. The route now declares its success status
  (`successStatus` on `RouteDefinition`); a duplicate replay stays 200 with the
  recorded operation.
- **`MutationClient.get()` parsed a shape no route serves.** It expected a singular
  `{ operation }` envelope; the by-id read is the list read with one entry, which is
  what it now parses. `submit()`'s duplicate branch was already correct.
- **Amend can produce a byte-identical commit.** With the same tree, author,
  committer and timestamps, `git commit --amend --no-edit` exits 0 and the tip does
  not move. That is success, not an uncertain outcome — the classification
  re-reads Head before and after and treats "exit 0, tip unchanged, amend" as a
  rewritten tip. For a plain commit, "exit 0 and the head did not move" stays
  `uncertain`.
- **The exit code alone cannot classify a commit**, so it is not used as one: a
  failing pre-commit hook exits non-zero with nothing written (HEAD unchanged →
  `failed`), and Git exits 0 after a post-commit hook fails even though the commit
  landed (verified empirically in a scratch repository before the test was
  written). A non-zero exit _after_ Head moved is `needsAttention` with the new oid
  in the message, never `succeeded`.
- **Backups were already built in T03** (`createRecoveryStore`: streamed SHA-256,
  copy verified against the original, 256 MiB / 7-day budget that refuses rather
  than evicting a protected backup, original mode recorded). T08 wires it per path
  and refuses the whole discard on the first refusal — the injected failing store in
  `tests/integration/staging.test.ts` is the proof that the destroy step does not
  run after a backup failure.
- **Preview tokens are consumed at effect time, before classification.** A replayed
  discard therefore reports `StalePreview` (the token is spent) rather than
  "nothing to discard"; both are true, and the token is the reason the request
  cannot act. Consumption is all-or-nothing via `PreviewStore.redeem`.
- **`ConfirmAction` is a two-step button, not a generated dialog.** The shadcn-svelte
  CLI (1.6.1) refuses this package layout with "This CLI requires Tailwind CSS and
  Svelte to be installed", so `alert-dialog` could not be generated; the confirm is
  built on the generated `Button` and the armed state names the action it will take.
  The rest of the panels are props-only and perform no requests — the page owns the
  client, as it does for reads.
- **The e2e premise changed with the capability list.** The read-only spec's "offers
  no control that could change the repository" became "offers a control only for an
  operation this build implements": the staging surface must exist, and no control
  for an unimplemented kind (stash, push, pull, merge) may appear. The header badge
  is now the paired-signal (`data-testid="build-badge"`) and states the write
  operation count.

### Verification, actually run

| Command                                                  | Result                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm exec vitest run tests/integration/staging.test.ts` | 23 passed                                                  |
| `pnpm test:e2e --grep staging`                           | 4 passed (Chromium 153.0.8010.12, Playwright 1.63.0)       |
| `pnpm test:e2e`                                          | 11 passed                                                  |
| `pnpm test`                                              | 430 passed (25 files)                                      |
| `pnpm check`                                             | 8 packages, 0 errors                                       |
| `pnpm check:boundaries`                                  | 3 portable packages, 42 source files, no host dependencies |
| `pnpm check:contract`                                    | artifacts match, 438 named schemas                         |
| `pnpm test:portable`                                     | neutral IIFE ran with no host globals (60,542 bytes)       |
| `pnpm build`                                             | web build + CLI bundle written                             |

Environment: macOS 25.6.0 arm64, Node 26.8.2, git 2.50.1 (Apple Git-155).

**Unverified, named:** the write loop is exercised in Chromium only — WebKit,
Firefox and Windows are not verified for T08; discard backups were exercised on
APFS only; no test drives a merge conflict or a submodule discard (those operations
are refused by selection, and the refusals are covered).

---

## T09 — Branch, remote, init/clone and fetch/push/pull

Delivered in this round (11 of the plan's operations):

```
packages/git-core/src/plan/branches.ts         branch create/switch/rename/delete/upstream
packages/git-core/src/plan/remotes.ts          remote config + fetch/push/upstream-ref/ff-merge
packages/git-core/src/workflows/branches.ts    run-and-classify for the five branch commands
packages/git-core/src/workflows/network.ts     per-ref porcelain outcomes; pull as fetch+merge
packages/host-node/src/coordinator/effects-support.ts   shared target resolution (T08+T09)
packages/host-node/src/coordinator/repository-effects.ts  the 11 effects
packages/git-ui/src/components/{BranchPanel,RemotePanel}.svelte
tests/integration/network.test.ts              16 cases over local bare remotes
tests/e2e/branch.spec.ts                       3 cases in Chromium
```

Deliberately **not** delivered, and still absent from `capabilities`:
`initRepository` and `cloneRepository`. A workspace target needs the approved-root
flow (destination inside an approved root, relative destination, no absolute paths
from a client) and `CloneDialog.svelte`; registering that flow is its own step, and
announcing the operations without it is exactly what the capability rule forbids.

### Deviations and findings, recorded deliberately

- **Semantic validation was written in T01 and never called.** `validate.ts` had
  `validateBranchName` (leading dash, `..`, `@{`, trailing `.`/`.lock`) and
  `validateRemoteUrl` (transport helpers like `ext::` refused, https/ssh/scp-like/
  absolute-local allowlist) with their own tests, but no live path invoked them. The
  operations route now runs `validateOperationSemantics` after the schema and before
  the engine, so `ext::sh -c …` and `-D` are 400s at the boundary rather than
  refusals after acceptance.
- **`git pull` has no `--porcelain`.** The reference design asks pull to report
  "tracking refs updated" separately from "the branch did not move", and a single
  `git pull` exit code cannot. Pull is implemented as its two real halves:
  `git fetch --porcelain <remote>` (the same planner the fetch operation uses) then
  `git merge --ff-only <upstream>` after resolving `<branch>@{upstream}` with
  `git rev-parse`. A pull naming a different remote than the branch tracks is
  refused before either half runs.
- **Push publishes one ref, always.** `--porcelain` plus an explicit
  `<src>:<dst>`, `--no-follow-tags` (a user's `push.followTags` must not turn one
  ref into a tag sweep), no `--force`, no `--mirror`. A rejected push reports Git's
  own per-ref reason; a timeout is `unknown` because the remote may have received
  the objects.
- **A partial pull is `failed`, with both facts in the message.** The fetch half may
  have moved remote-tracking refs while the branch half refused; the message says
  so, and the branch is untouched — no merge, no rebase, no autostash.
- **`updateRemote` can be partial** (rename applied, URL change failed). That is
  reported as `needsAttention` with a message that tells the reader the remote may
  have been renamed — never as a clean failure.
- **A branch-name test found the gap the design predicted**: the plan's own
  "reject leading options" requirement is enforced by `validate.ts`, not by the
  schema regex, and the test drives it through HTTP.

### Verification, actually run

| Command                                                  | Result                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm exec vitest run tests/integration/network.test.ts` | 16 passed                                                  |
| `pnpm test:e2e --grep branch`                            | 3 passed (Chromium)                                        |
| `pnpm test:e2e`                                          | 14 passed                                                  |
| `pnpm test`                                              | 446 passed (26 files)                                      |
| `pnpm check`                                             | 8 packages, 0 errors                                       |
| `pnpm check:boundaries`                                  | 3 portable packages, 46 source files, no host dependencies |
| `pnpm check:contract`                                    | artifacts match, 438 named schemas                         |
| `pnpm test:portable`                                     | neutral IIFE, no host globals                              |

Environment: macOS 25.6.0 arm64, Node 26.8.2, git 2.50.1 (Apple Git-155). Remotes in
every test are local bare repositories — **no network, no credentials, no hosting
dependency** — so real HTTPS/SSH behaviour (helpers, SSH agent, host-key
verification, credential prompts) is **unverified** by this round.

---

## T10 — Stash/pop and tags

Delivered (7 operations):

```
packages/git-core/src/plan/tags.ts               tag create (light/annotated)/delete/exists
packages/git-core/src/workflows/stash.ts         stash create/apply/pop/drop, tag create/delete
packages/host-node/src/coordinator/stash-tag-effects.ts  the 7 effects
packages/git-ui/src/components/{StashPanel,TagPanel}.svelte
tests/integration/stash-tags.test.ts             12 cases
tests/e2e/stash.spec.ts                          4 cases in Chromium
```

### Deviations and findings, recorded deliberately

- **A locator is re-resolved before every stash write.** `stash@{n}` is a position in
  a reflog; the workflow runs `rev-parse <locator>^{commit}` and compares the object
  name to the one the request carried. A mismatch is a `Conflict` that says the list
  moved, not a different stash to act on — the case
  `refuses to apply when the locator now points at a different stash` drives an
  external `git stash` between selection and submit.
- **A conflicted pop is `needsAttention`, and that is checked, not assumed.** After a
  non-zero `stash pop` the workflow re-resolves the entry by object name: Git's rule
  is that a conflicted pop does not drop, and the re-check turns that rule into
  evidence the record carries. The e2e case asserts the entry is still on screen.
- **A timeout during a pop is `unknown`**, never a conflict: whether the stash was
  applied (or dropped) is genuinely not known, and nothing continues after it.
- **`createTag` pre-checks the name** (`rev-parse --verify --quiet`, exit 1 = absent)
  so "already exists" is a `Conflict` with a clear message rather than Git's message
  after the object was prepared. No `--force` exists anywhere; an annotated message
  travels on stdin via `--file=- --cleanup=verbatim`, so signing configuration stays
  in force and the message is byte-exact.
- **`deleteTag` is local only** (the test pushes a tag, deletes it locally, and
  asserts the remote still has it); **`pushTag`** publishes one tag through the same
  explicit-ref push planner T09 built, with `--no-follow-tags` and no force.
- **`git tag --delete` never touches a remote** and no `--force`/`--overwrite` path
  exists in the planners, so the acceptance gate ("tag 无默认 overwrite/force") is a
  property of the argv, not of a check that could be bypassed.

### Verification, actually run

| Command                                                     | Result                               |
| ----------------------------------------------------------- | ------------------------------------ |
| `pnpm exec vitest run tests/integration/stash-tags.test.ts` | 12 passed                            |
| `pnpm test:e2e --grep stash`                                | 4 passed                             |
| `pnpm test:e2e`                                             | 17 passed                            |
| `pnpm test`                                                 | 458 passed (27 files)                |
| `pnpm check`                                                | 8 packages, 0 errors                 |
| `pnpm check:boundaries`                                     | 3 portable packages, 48 source files |
| `pnpm check:contract`                                       | artifacts match, 438 named schemas   |
| `pnpm test:portable`                                        | neutral IIFE, no host globals        |

Unverified: stash behaviour with submodules (never recursed by this build, and no
test drives one), and stash/pop under a real editor-driven conflict resolution.

---

## T11 — Worktrees and submodules

Delivered (7 operations):

```
packages/git-core/src/plan/worktrees.ts          add/remove/lock/unlock argv
packages/git-core/src/plan/submodules.ts         add/update --checkout/sync argv
packages/git-core/src/workflows/worktrees.ts     the 7 workflows
packages/host-node/src/coordinator/worktree-effects.ts  the 7 effects
packages/git-ui/src/components/{WorktreePanel,SubmodulePanel}.svelte
tests/integration/worktree-submodule.test.ts     11 cases
tests/e2e/worktree.spec.ts                       2 cases in Chromium
```

### Deviations and findings, recorded deliberately

- **The reference lists `core/workflows/submodules.ts` and
  `coordinator/composite-queue.ts`; neither exists.** The three submodule workflows
  live beside the worktree workflows in `workflows/worktrees.ts` (one file, one
  subject: nested checkouts), and the composite queue is the coordinator's existing
  single-writer queue — the operations are one repository's writes, so a second queue
  would be a second writer. What the reference asked for from a composite queue
  (report partial effects, never claim a rollback) is what `NetworkOutcome`-style
  partial results already do for multi-ref operations.
- **The destination is a path inside an approved root, re-checked at effect time.**
  `relativeDestination` is resolved against the root the repository was registered
  under and compared again with containment _after_ resolution, so a symlinked root or
  a `..` that survives validation cannot land outside it. The case
  `refuses a destination that escapes the approved root` drives it through the API.
- **The primary worktree is refused before Git runs**, and the panel offers no remove
  control for it: a button whose only outcome is Git's refusal teaches the wrong
  thing. The test asserts both — the API refuses, and the checkout is still there
  (`git status --porcelain=v2` exits 0 afterwards).
- **Removal is never forced.** No `--force` exists in the planner; a dirty or locked
  worktree is refused by Git and reported as that refusal, and the integration case
  asserts a dirty worktree survives the attempt. Nothing falls back to `rm -rf`.
- **`update` is `--checkout` only.** `--remote`, `--force`, `--merge` and `--rebase`
  are not spelled anywhere, which is also the defense against a configured
  `submodule.<name>.update` shell command: no switch that would consult it is passed.
  The case `updates a submodule to exactly the recorded commit` moves the submodule's
  remote ahead and proves the checkout lands on the recorded commit, not the newer one.
- **Submodule state is three object names, never a flag.** `recordedOid` (the parent
  commit), `indexOid` (the parent index) and `actualOid` (the checkout) are separate
  fields, and the read has its own tests for the states that disagree. `unknown` is
  its own state for a gitlink this build could not read — never folded into clean.
- **The fixture had to play the user for file transport, and the product does not.**
  `git submodule add` clones through a transport, and a clone from a local path is
  refused by Git's own `protocol.file.allow` policy. A repository-local setting does
  **not** apply to that child clone (verified with `git config --show-origin` plus a
  failing add), so the fixture appends the setting to the isolated scratch `HOME`'s
  global config — the fixture acting as the machine's user. Nothing in the product
  sets `protocol.file.allow`, and no test asserts that it does.
- **The bare-remote fixture was on the wrong branch, and the failure looked like a
  product bug.** `createBareRemote` ran `git init --bare` without
  `--initial-branch`, so with the isolated (empty) global config its HEAD named
  `master` while fixtures push `main`; the submodule clone then landed on an unborn
  branch and failed with `You are on a branch yet to be born`. The fixture now pins
  `--initial-branch=main`, matching `createRepo`.
- **Unimplemented kinds moved on.** `http.test.ts` and `auth.test.ts` pinned
  `lockWorktree` as "a kind with no effect"; T11 gave it one, so those premises now
  use `initRepository`, which this build still does not implement (and does not
  advertise).

### Verification, actually run

| Command                                                             | Result                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm exec vitest run tests/integration/worktree-submodule.test.ts` | 11 passed                                                  |
| `pnpm test:e2e --grep worktree`                                     | 2 passed                                                   |
| `pnpm test:e2e`                                                     | 20 passed                                                  |
| `pnpm test`                                                         | 477 passed (28 files)                                      |
| `pnpm check`                                                        | 8 packages, 0 errors                                       |
| `pnpm check:boundaries`                                             | 3 portable packages, 51 source files; 49 test/script files |
| `pnpm check:contract`                                               | artifacts match, 438 named schemas                         |
| `pnpm test:portable`                                                | neutral IIFE 60,542 bytes, no host globals                 |

Unverified: a submodule that is itself a repository with submodules (`--recursive` is
plumbed and exercised only against a flat fixture), worktrees on a filesystem without
`stat`-able links (no Windows run), and `removeWorktree` against a worktree whose
directory was deleted by hand (Git's `prune` path, which this build does not offer).

`initRepository` and `cloneRepository` remain deliberately absent from
`capabilities`: they address a workspace root rather than a repository, and the
approved-root flow they need is not built. A request for either is answered with the
closed `UnsupportedOperation` code, never a `202`.

---

## T12 — Merge, continue, abort

Delivered (3 operations):

```
packages/git-core/src/plan/merge.ts                 merge / continue / abort / MERGE_HEAD argv
packages/git-core/src/workflows/merge.ts            the 3 workflows and the stop classification
packages/host-node/src/coordinator/merge-effects.ts the 3 effects
packages/git-ui/src/components/ConflictPanel.svelte unfinished-operation panel
apps/web/src/lib/operation-follow.ts                polling that never resubmits
tests/integration/merge.test.ts                     14 cases
tests/unit/operation-follow.test.ts                 6 cases
tests/e2e/workflows.spec.ts                         2 cases in Chromium
```

### Deviations and findings, recorded deliberately

- **`continueMerge` is `git commit`, not a merge command.** After a conflict the
  resolved index already holds the merge; continuing is committing it. The planner
  spells no path that stages, resolves or edits anything, and the effect classifies a
  refusal with the merge state re-read afterwards — a refused continue leaves the
  merge exactly where it was, which one case asserts.
- **`abortMerge` never falls back to `reset --hard`.** `git merge --abort` is the
  whole command; a refusal is reported with Git's diagnostic and the merge state is
  left as it is. The plan's requirement ("don't paper over a failed restore") is a
  property of the argv, not of a check that could be bypassed later.
- **Staging had to be unblocked during a merge, and that was a real gap.** The
  precondition "no operation in progress" blocked _every_ write, `stagePaths`
  included — so the resolve → stage → continue flow the panel instructs the user to
  perform was impossible through this API. The first end-to-end attempt is what
  surfaced it: the browser flow could resolve the file and then nothing else. The
  exemption list is now `stagePaths`, `unstagePaths`, `continueMerge`, `abortMerge`
  for `merge` only; `commit` and `discardTrackedPaths` stay blocked, and one case
  asserts both halves.
- **A record is not a file list.** The conflict count travels as
  `problem.details.conflictedPaths` and the _names_, with their three index stages,
  come from the status read — which already had `stages` per path. `needsAttention`
  with a result would have duplicated the read and, worse, frozen it.
- **The status read already knew about in-progress operations.** `MERGE_HEAD`,
  `CHERRY_PICK_HEAD`, `revert`, `rebase-merge`, `rebase-apply` and `BISECT_LOG` were
  mapped in T04, so the merge work only had to add the write side and the UI. The
  panel shows a foreign operation (rebase, cherry-pick, revert, bisect, mailbox) and
  offers nothing for it, which is what "restrict conflict operations to ours" means
  in practice.
- **The follower moved out of the component.** "A dropped connection keeps the
  operationId and recovery only queries" was previously an implicit property: the
  page polled and, on a transport error, threw the id away with the message. It is now
  `apps/web/src/lib/operation-follow.ts`, where a fake reader can prove that only
  `get` is ever called (no resubmit path exists), that transport failures are retried
  as reads, and that giving up names the operation id.
- **Detached, unborn, missing-object and empty-remote states are handled by refusal,
  not by repair.** Merging onto a detached HEAD works (Git allows it, and the case
  asserts the checkout stays detached); an unborn HEAD, a source that is a blob, and a
  source this repository does not have are all refused with a message, and nothing
  fetches, configures or repairs the repository to make the merge possible. The last
  case asserts the repository still has no remote afterwards.

### Verification, actually run

| Command                                                    | Result                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm exec vitest run tests/integration/merge.test.ts`     | 14 passed                                                  |
| `pnpm exec vitest run tests/unit/operation-follow.test.ts` | 6 passed                                                   |
| `pnpm test:e2e --grep "merge workbench"`                   | 2 passed                                                   |
| `pnpm test:e2e`                                            | 22 passed                                                  |
| `pnpm test`                                                | 497 passed (30 files)                                      |
| `pnpm check`                                               | 8 packages, 0 errors                                       |
| `pnpm check:boundaries`                                    | 3 portable packages, 53 source files; 52 test/script files |
| `pnpm check:contract`                                      | artifacts match, 438 named schemas                         |
| `pnpm test:portable`                                       | neutral IIFE 60,542 bytes, no host globals                 |

Unverified: a merge that conflicts inside a submodule path (`submodule` conflicts get
Git's own resolution requirements, which this build does not model), a merge driven
while the service restarts mid-operation (the restart block covers the _next_ request,
and no test kills the service between acceptance and completion), and conflict
resolution through a tool that leaves the index in a partly-staged state between polls.

The reference's `git-ui/OperationCenter.svelte` was not written as a separate
component: the conflict panel plus the existing panels already cover what it was for
(one place that shows an unfinished operation and the ways to end it), and a second
surface listing the same records would be a second place to keep correct.

---

## T13 — Packaging for npm and npx

Delivered:

```
packages/npm-dist/package.json   the published manifest (source; everything else is staged)
scripts/build-release.ts         bundles the CLI, stages the UI, writes build-info
scripts/pack-smoke.ts            packs the tarball and uses it from a clean HOME
apps/cli/src/{args,serve,main}.ts --json machine mode; installation version report
tests/pack/installed.test.ts     8 cases on the manifest and the staged artifact
tests/node/state-root.test.ts    5 cases on where private state lives
docs/installation.md             install, run, pair, stop, uninstall
```

### Deviations and findings, recorded deliberately

- **The staged `.mjs` and the bundle are generated, not committed.** The reference
  lists `packages/npm-dist/bin/refyard.mjs` as a source file; this repository's rule
  is that no raw JavaScript is source, so only `package.json` is tracked and
  `build-release.ts` writes `bin/refyard.mjs` (with a shebang), `dist/cli.mjs`,
  `dist/build-info.json` and `web/`. `.gitignore` records the split.
- **`engines` is `>=26 <27`, not `>=24 <25`.** The reference's example test predates
  the user's 2026-09-14 direction pinning this repository to Node 26; the test asserts
  the pinned range and the smoke run refuses to report success on another major.
- **No license is invented.** The manifest is `private: true` with
  `license: "UNLICENSED"`, so `npm publish` is refused by npm itself and no text is
  attributed to a project that has not chosen one. A test asserts both fields, because
  the tempting "fix" for a missing LICENSE is to paste someone else's.
- **`--json` is a new output mode, and it is the reason pairing material moved.** The
  banner used to go to stdout unconditionally, which meant a supervisor parsing stdout
  would find a ticket. Now `--json` prints exactly one JSON object (no ticket) and every
  note — pairing URL, service logs, browser-open failure — goes to stderr. The terminal
  keeps the human banner, because a terminal is a private channel.
- **The banner reported the contract version as the program version.** It printed
  `refyard 1.0.0 (api 1)` while the CLI's own version is `0.0.0-dev`; the packaged
  copy now reads `dist/build-info.json` beside the bundle and reports _that_ version,
  falling back to the source constant when there is no build.
- **Private state moved out of the temp directory.** The journal and the recovery
  backups used to default to `$TMPDIR/refyard-state`. A backup exists so a discard can
  be undone _later_, and macOS is free to clear `TMPDIR` in between — so the default is
  now `~/Library/Application Support/refyard`, `$XDG_STATE_HOME/refyard` (or
  `~/.local/state/refyard`), or `%LOCALAPPDATA%\refyard`, overridable with
  `REFYARD_STATE_DIR`. This is a safety change, not a tidiness one.
- **Shutdown drained nothing before this task.** `close()` called `server.close()`
  _and_ `closeAllConnections()` immediately, which cut in-flight requests in half. The
  order is now: stop accepting, wait for in-flight requests (bounded, default 5 s),
  drop idle keep-alive sockets, then force-close what is left. The test drives it with a
  real event stream, because a stream is unambiguously in flight, and asserts both that
  the wait happens and that an idle server does not pay for it.
- **`pnpm pack:smoke` is a script, not a vitest file.** It needs a clean `HOME`, an
  isolated npm cache and `--offline`, and it runs the real `npm exec --package=<tgz>`
  path — the same thing a user runs. Running that inside vitest would have meant faking
  exactly the isolation that makes it meaningful. `tests/pack/installed.test.ts` covers
  the manifest invariants in the normal suite.
- **A bun-run script cannot trust `process.execPath` or `process.version`.** The first
  smoke run compared bun's reported Node version against the Node that `npm exec`
  actually spawned and failed. The script now asks `node --version` from `PATH` and
  asserts the supported major, which is a better check than the one it replaced.

### Verification, actually run

| Command                                              | Result                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm build:release`                                 | staged, bundle 1,224,517 bytes, commit d5d3748             |
| `pnpm pack:smoke`                                    | 14 steps passed (tarball 744,895 bytes, 73 entries)        |
| `pnpm exec vitest run tests/pack`                    | 8 passed                                                   |
| `pnpm exec vitest run tests/node/state-root.test.ts` | 5 passed                                                   |
| `pnpm exec vitest run tests/integration/cli.test.ts` | 27 passed                                                  |
| `pnpm test`                                          | 512 passed (32 files)                                      |
| `pnpm check`                                         | 8 packages, 0 errors                                       |
| `pnpm check:boundaries`                              | 3 portable packages, 53 source files; 56 test/script files |
| `pnpm check:contract`                                | artifacts match, 438 named schemas                         |

Unverified: the tarball on Windows and on a machine without Node 26 (the manifest
refuses the install there, but the refusal itself was not exercised), an `npm exec`
run against a _registry_ copy of this package (there is none, by design), and a
packaged install on a filesystem without `chmod` support (the bin shebang is set at
build time and not re-checked at install).

Nothing here publishes. The tarball is only ever installed from a local path, and
`--offline` in the smoke run is what proves no registry was consulted.

---

## T14 — Offline shell, hosted UI, protocol negotiation

Delivered:

```
apps/web/src/service-worker.ts            shell-only cache, /api never cached
apps/web/src/lib/session-negotiation.ts   instance + API-major rules (pure)
apps/web/src/lib/storage.ts               the instance beside the token; clear-on-change
apps/web/static/manifest.webmanifest      installable shell
packages/git-client/src/client.ts         health() uses the contract schema, not a loose object
tests/unit/session-negotiation.test.ts    6 cases
tests/e2e/{offline,versions}.spec.ts      4 cases in Chromium
docs/browser-support.md                   what was run, what is unverified, what to do
```

### Deviations and findings, recorded deliberately

- **Negotiation had to move to `/health`, and that is the finding of this task.** The
  first implementation compared the service instance from `capabilities` — which is
  authenticated. With a token from a _different_ instance the call answered 401, the
  page showed "the session is no longer valid", and the instance change was invisible:
  the user was told to re-pair, but nothing had noticed that the address now belonged to
  another service, and no test could tell the two apart. `/health` is the one endpoint
  that answers without a token, so it is the only one that can answer "who are you?"
  before the page decides whether its session is meaningful.
- **`health()` in the client was a hand-rolled loose object.** It declared `alive` and
  `apiMajor` and silently dropped `serviceInstanceId`, which the contract schema
  carries. It now returns the contract type, because that is exactly the kind of field
  a hand-rolled shape loses when the host adds one.
- **The offline spec needed the service worker to exist, and the first attempt proved
  it.** `page.reload()` with the network off failed with `net::ERR_INTERNET_DISCONNECTED`
  before the worker existed and `net::ERR_FAILED` after the first version of it — because
  `$service-worker`'s `build` and `files` lists contain assets, not the prerendered
  document. The shell now precaches `/index.html` and `/200.html` explicitly, each
  individually so a missing document cannot fail the whole install.
- **"Offline" is the browser's signal, not a quiet event stream.** Writing the gate as
  "the SSE stream is down" would refuse writes against a perfectly reachable service
  whose stream a proxy is buffering. The page reads `navigator.onLine`, keeps the stream
  for what it actually is (live hints), and refuses with a message that says nothing was
  sent and nothing will be retried.
- **Nothing queues a write.** The refusal is not a deferred request: a page cannot know
  whether the request it would send is still right after an outage, so the rule is
  refuse-say-forget. Two e2e cases read the host's own operation list to prove the count
  did not move during the outage or after it.
- **A write control is absent, not disabled, when there is no data.** One case asserts
  `stage-selected` has a count of zero after an offline reload: with every read failing
  there is no list to select from, and an inert button would suggest otherwise.
- **The instance is recorded at pairing time.** A token without its instance is a
  credential for a service that may be gone; storing them together is what lets a later
  load tell "expired session" from "different service", which are different sentences to
  a user.

### Not implemented, and named rather than implied

The **hosted static site talking to a loopback API from another origin** is not built.
The host's origin policy refuses a foreign `Origin`, a `null` origin and
`Sec-Fetch-Site: cross-site`, and no CLI flag widens that list; a browser will also block
a public `https://` page from calling loopback HTTP (Private Network Access). The
supported shape is the same-origin one the service already serves, and
`docs/browser-support.md` says so instead of documenting a workaround.

### Verification, actually run

| Command                                                           | Result                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm exec vitest run tests/unit/session-negotiation.test.ts`     | 6 passed                                                   |
| `pnpm test:e2e --grep "offline workbench\|not the one we paired"` | 4 passed                                                   |
| `pnpm test:e2e`                                                   | 26 passed                                                  |
| `pnpm test`                                                       | 519 passed (33 files)                                      |
| `pnpm check`                                                      | 8 packages, 0 errors                                       |
| `pnpm check:boundaries`                                           | 3 portable packages, 53 source files; 59 test/script files |
| `pnpm check:contract`                                             | artifacts match, 438 named schemas                         |
| `pnpm pack:smoke`                                                 | 14 steps passed                                            |

Unverified: every browser other than the Playwright Chromium build (Firefox, WebKit,
Safari and installed Chrome are all untested — `docs/browser-support.md` lists them as
such), `localStorage`/`sessionStorage` being unavailable (the code is written to degrade,
but no run exercises it), and the API-major mismatch path end to end (the unit tests
pin the rule; producing a real major mismatch would need a second contract version).

## T15 — Release gate: negative cases, measured evidence, CI

Delivered:

```
tests/security/negative.test.ts            11 negative cases: ten payload/repository cases plus one for the wire
scripts/bench-runtime.ts                   repeated lifecycle against a fast-import fixture
docs/evidence/performance.json             the measured report: 100,000 commits, 3 runs
docs/evidence/release-matrix.md            verified / partial / unverified per platform, browser, gate
docs/evidence/security.md                  the attacks tested, and the work deliberately not done
tests/pack/evidence.test.ts                5 cases that keep the report from turning into decoration
.github/workflows/ci.yml                   the gate on Linux and macOS (written, not yet run)
packages/host-node/src/process/doctor.ts   probes carry an identity instead of resolving one
```

### Deviations and findings, recorded deliberately

- **The benchmark's 10.5-second cold start was a measurement artifact, and chasing it changed
  the product.** The packaged CLI starts in ~0.45s; the bench reported 10.45s, reproducibly, while
  a direct `time` of the same binary in the same environment reported 0.42s. Tracing every `spawn`,
  DNS call and filesystem call inside the run found it: the doctor's connectivity probe pays
  `git push --porcelain` and `git fetch --porcelain`, and on a machine with **no configured Git
  identity** each of those makes Git resolve a default identity from the system account database.
  Measured here at 5.06s per command (the same push with `-c user.name=… -c user.email=…` takes
  0.06s). The probe now passes an identity per invocation, exactly as the fixture commit already
  did, which is also what removes the dependency: `refyard serve` no longer blocks startup on the
  machine's identity lookup, and the probe measures porcelain output rather than the account
  database. The fix is `PROBE_IDENTITY_ARGS` in `doctor.ts`; the case that pins it is
  "gives each probe an identity instead of resolving the machine's own".
- **The same identity fallback was costing the product, not just the probe.** While isolating the
  e2e services (below) the worktree case started failing on its ten-second wait: `createWorktree`
  succeeded, but 15 seconds late. `git worktree add` was the whole of it — 15.05s with no identity
  available, 0.03s with one — and the service was dropping the identity its own environment carried,
  because the host's child-environment allow-list did not include `GIT_AUTHOR_*`/`GIT_COMMITTER_*`.
  Two failures, one cause: a CI job that exports `GIT_COMMITTER_*` got commits attributed to
  somebody else, and anyone without a configured identity waited a quarter of a minute per
  identity-needing command. The variables are now inherited; they set a name, an address and a date,
  and cannot redirect Git or make it run anything, which is why they belong on the inherit list
  rather than the blocked one.
- **Every e2e spec was writing into the developer's real refyard state directory.** The specs
  started the CLI with the inherited environment, so the journal — and the operation list the specs
  read to prove nothing was written — was the developer's, shared across runs. `/api/v1/operations`
  is bounded by a page limit; once the journal held more than that, "the count did not move" reported
  the same number before and after a click and stopped being evidence. `tests/support/e2e-service.ts`
  starts each spec's service on the fixture's environment with `REFYARD_STATE_DIR` inside the
  fixture's own scratch directory, and a new case asserts the invariant: a freshly started service
  reports no operations. The isolation is what exposed the identity bug above.

- **`process.execPath` under bun is bun, not Node — again.** The first report named
  `node 26.3.0` while the service was actually being run by bun, whose `process.versions.node`
  reports the version it emulates. The bench now resolves `node` from `PATH`, refuses to run when
  that Node is not the published major (`>=26 <27`), and records the runtime it actually spawned
  plus the artifact it launched (`node packages/npm-dist/dist/cli.mjs`). Same class of defect as
  the one found in `pack-smoke`; the rule is that `process.execPath` describes the script runner.
- **The fixture had to move to `git fast-import` for the scale to be real.** Three processes per
  commit put 10k and 100k histories out of reach of a run anyone repeats. fast-import writes the
  same objects in one process: 100,000 commits and a `repack -adq` in 2.6s. The fixture is then
  _counted_ (`git rev-list --count HEAD` must equal the requested size, the working tree must be
  clean) before anything is measured, because a silently smaller history would make every read
  number a fact about a different repository.
- **Evidence is checked as evidence.** `tests/pack/evidence.test.ts` reads the committed report and
  fails when it stops naming its runtime (kind, version against the pinned major, git version), its
  scale, its scope per measurement (`processScope`, `memoryMetric`, unit, notes, window), or whether
  the numbers are one run or a median of several. `release-matrix.md` is checked the same way: it
  must contain an `unverified` row and at least one `verified` row, so "not run" cannot be read as
  "passed".
- **A negative case was added for the wire itself.** The request schemas are strict objects, so
  `argv`, `cwd` and `env` have no path from a page to Git; the new case sends them next to a valid
  `unstagePaths`, asserts the 400, asserts nothing ran, and then submits the same body without them
  and asserts it is accepted — proving the refusal came from those fields and not from a malformed
  request. Two rows in `release-matrix.md` were corrected downwards while writing it (bare
  repositories: unverified; Git below the baseline: partial), because the tests that were assumed to
  cover them do not exist.

### Verification, actually run

| Command                 | Result                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm check`            | 8 tasks, 0 errors                                                                                               |
| `pnpm check:boundaries` | 3 portable packages / 53 source files; 63 test/script files imported by name                                    |
| `pnpm check:contract`   | artifacts match the schemas, 438 named schemas                                                                  |
| `pnpm test`             | 537 passed (35 files)                                                                                           |
| `pnpm test:integration` | 313 passed (20 files), including `tests/security`                                                               |
| `pnpm test:pack`        | 13 passed (installed package + evidence shape)                                                                  |
| `pnpm test:portable`    | 4 vitest portability cases + neutral IIFE 60,542 bytes, 11 planner/parser checks                                |
| `pnpm test:e2e`         | 27 passed (Chromium), each spec on its own isolated state directory                                             |
| `pnpm pack:smoke`       | 14 steps passed                                                                                                 |
| `pnpm bench:runtime`    | 100,000-commit fixture, 3 lifecycles; every value in `docs/evidence/performance.json`, with its scope and range |

Unverified, and named as such rather than hidden: **every platform other than this macOS arm64
machine** (Linux, Windows, WSL, macOS x64 — the CI workflow written for Linux and macOS has not run
in this repository yet, so it is not evidence); **every browser other than the Playwright Chromium
build**; **Git versions other than 2.50.1** (including anything below the 2.43 baseline); **SHA-256
repositories, bare repositories and shallow clones** beyond the partial coverage listed in
`release-matrix.md`; and the whole "not done" list in `docs/evidence/security.md` — no external
audit, no fuzzing, no hostile-remote testing, no credential or SSH-agent testing.
