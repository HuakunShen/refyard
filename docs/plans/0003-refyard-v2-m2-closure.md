# Plan 0003 — Refyard v2, M2 closure: init/clone, and diff-scale evidence

> Status: **active plan, revision 0** — written 2026-09-15.
> Implements: `docs/goals/2026-09-15-m2-closure.md`.
> Carries no reference task number. The delivered package numbers T01–T18, of which T01–T15 are
> done (plans 0001 and 0002) and T16–T18 stay closed until the standalone V1 ships
> (`AGENTS.md` §6). The work below is what plan 0002 left behind, so its tasks are named rather
> than numbered onto something they are not.

## 1. Context

`GET /api/v1/capabilities` is the contract with the browser and it is honest by construction: an
operation appears in `operations` exactly when an effect for it is registered, and everything else
the contract defines is named in `unavailable` with a reason. Today that list holds exactly two
kinds — `initRepository` and `cloneRepository` — and they are the deferred half of T09.

The second item is not a feature but a gap in evidence. The parsing-placement decision recorded on
2026-09-15 rests on bounds written as policy numbers (`patchMaxBytesPerFile`, `patchMaxLinesPerFile`,
`structuredStdoutMaxBytes`) and on the reasoning that one byte-safe parser shared with the write
paths beats two interpretations of the same bytes. It says, in its own words, that the decision is
reopened by a measurement naming a shape the bound cannot serve — and no diff is measured at all,
so that sentence currently has no way to become true.

## 2. Task R1 — `initRepository` and `cloneRepository`

Everything the contract side needs is already frozen and tested; this task is the rest of it.

```
packages/git-core/src/plan/repository.ts        init and clone argv (the reference names this file)
packages/git-core/src/workflows/repository.ts   run-and-classify for both
packages/host-node/src/coordinator/repository-effects.ts  two effects, workspace target
packages/git-ui/src/components/RepositoryPanel.svelte     create/clone through the contract
tests/integration/workspace.test.ts             integration, against a local bare remote
tests/e2e/workspace.spec.ts                     one case through the panel
```

**Contract (already frozen — do not re-open):**

| Operation         | Fields                                                       | Target                                               |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `initRepository`  | `initialBranch: branchName \| null` (`null` = Git's default) | `workspace` (`allowedRootId`, `relativeDestination`) |
| `cloneRepository` | `remoteUrl`, `relativeDestination`, `initializeSubmodules`   | `workspace`                                          |

`OPERATION_TARGET_LIST` already pairs both with `workspace` only, `validateOperationSemantics`
already refuses a transport-helper URL on `addRemote`, and `relativeDestinationSchema` already
rejects absolute paths, `..` segments and `.git` components.

**What to build, in this order:**

1. **Planners, test first.** `init` at an absolute destination (the destination is resolved from the
   workspace target, never sent by a client); `clone` with `--recurse-submodules` only when
   `initializeSubmodules` is true, and `--` before the destination as the other planners do. Clone
   has no `--porcelain`: the classification is by exit status and by what the destination contains
   afterwards, and a partial clone is `unknown`/`needsAttention` rather than "cleaned up".
2. **Effects.** Resolve the workspace destination through the root registry (the same containment
   rules the worktree destination uses), run the command, and only then approve the new root and
   register the repository — a failed command registers nothing. A destination that is not empty is
   refused before the command runs, with Git's own diagnostic as the reason.
3. **Capabilities.** `unavailable` must become empty. The set-difference code added in `59d5631`
   does that automatically; add a case that asserts the **empty** list, so the arithmetic is checked
   at both ends (non-empty and empty) rather than assumed.
4. **UI.** A panel that takes a workspace root, a relative destination, and (for clone) a URL and
   the submodule switch, and renders the failure Git reported. `packages/git-ui` only: no `$app/*`.
5. **Tests.** Contract-level semantics already exist; add integration cases for the happy paths
   against a **local bare remote**, and refusals for the four destinations named in the goal.
   Security: a clone whose URL is `ext::…` is refused at the boundary (mirror the `addRemote` case
   in `tests/security/negative.test.ts`).
6. **Evidence.** A row in `release-matrix.md` for each mutation, and an addendum to
   `docs/evidence/m2-writes.md` recording the delivery and its verification.

## 3. Task R2 — diff-scale measurements

Extend `scripts/bench-runtime.ts`; do not write a second benchmark. The fixture is built with
`git fast-import` the way the existing 100,000-commit fixture is, and counted before anything is
measured (the existing guard applies to the new shapes too).

**Shapes, all in one repository plus a second for switching:**

- one large file (target: several MB of text) changed in a single commit;
- one very long single line (a minified-file shape), which is where a line-oriented parser pays;
- many small changed files (hundreds), which is where per-file overhead shows;
- a second repository, so the run can measure the cost of switching between two of them.

**Recorded per measurement, in the existing report shape** (`value`, `unit`, `processScope`,
`memoryMetric`, `durationSeconds`, notes with the observed range over repeated runs):

- diff latency for the large file and for the many-small-files case;
- **response payload bytes** — the number nobody has today, and the one a streaming design would
  move;
- resident memory before and after the diff batch, so growth is visible rather than asserted;
- how often the `oversize` path is hit, and the limit it hit;
- the same large-file diff a second time, to show what is cached and what is not.

**Rule for the report:** these are measurements of one machine, one runtime (the Node on `PATH`,
checked against the published major) and one Git. The methodology fields already say so; the new
measurements carry their scale in the same fields. No number from this task is a claim about other
hardware, and none of them reopens the parsing decision by itself — reopening needs a shape the
bound cannot serve, which is a different statement from "a diff took a while".

## 4. Out of scope

- **T16–T18** (Xross, Kunkun adapter, native-host review): closed until the standalone V1 ships.
- **The UI/branding round in flight** (`packages/logo`, the shadcn primitives, `AppearanceSettings`):
  a separate round with its own goal and plan, so that its acceptance is written down by whoever
  intends it rather than inferred from a working tree.
- **Hosted UI (form 3)**: the origin policy still refuses a foreign origin, and changing that is its
  own decision with its own evidence (`docs/product/north-star.md`, decision log).

## 5. Verification, per task

Every task follows the standing order: failing test first, minimum implementation, then the gates.

| Command                 | Why it is in the list for this round                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `pnpm check`            | the new planners and effects are typed, no `as`                             |
| `pnpm check:boundaries` | `packages/git-core` gains a file and stays host-free                        |
| `pnpm check:contract`   | the two operations were already in the schema; the artifacts must not drift |
| `pnpm test`             | unit + integration + security + pack                                        |
| `pnpm test:e2e`         | the new panel works in a real browser, on a service with its own state      |
| `pnpm test:portable`    | the neutral IIFE still runs the core after new planners                     |
| `pnpm pack:smoke`       | the packaged CLI still installs, serves and stops                           |
| `pnpm bench:runtime`    | produces the evidence R2 is for                                             |

## 6. Risks and unknowns, named before they are hit

- **A clone is not bounded by stdout.** The output ceilings that bound reads do not bound a clone,
  which writes to disk: the bound is the destination and the network deadline, and a slow or huge
  remote is a real failure mode. This task does not add partial-clone or filter flags — recording
  what a full clone costs is the honest first step.
- **Windows path handling for `relativeDestination`** is unverified on this machine and stays
  unverified until someone runs the suite there; the matrix says so rather than implying otherwise.
- **`git init` into a directory that already contains files** is allowed by Git. The behaviour must
  be decided and tested rather than inherited by accident: the choice here is to allow it (Git's own
  semantics, nothing overwritten) and to say so in the operation's result.
- **A private remote without a credential helper** fails under `GIT_TERMINAL_PROMPT=0`. That is the
  intended behaviour; the failure is surfaced with Git's diagnostic, and no credential handling is
  added to make a test pass.
