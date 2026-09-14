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
