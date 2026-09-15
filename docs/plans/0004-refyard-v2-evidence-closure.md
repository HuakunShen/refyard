# Plan 0004 — Evidence closure: the rows that say "unverified"

> Status: **active plan, revision 0** — written 2026-09-15.
> Implements: `docs/goals/2026-09-15-evidence-closure.md`.
> Carries no reference task number, for the same reason plan 0003 does not: T01–T15 are delivered
> and T16–T18 stay closed until the standalone V1 ships. The tasks below close gaps the T15 gate
> recorded rather than added features.

Each task ends the same way: the command actually run, its exit status, the evidence file updated
in the same commit, and anything that could not be closed left named as unverified.

## E1 — Three engines, not one

**What:** `playwright.config.ts` gains `firefox` and `webkit` projects beside `chromium`; the suite
runs against all three.

**Why it is first:** the largest unverified area is the UI in browsers nobody has run, and it is one
config entry plus whatever breaks. What breaks is the valuable part — service worker behaviour,
storage, CSS layout and the CSP are exactly where engines differ, and a failure here is a finding,
not a nuisance.

**Rules:** an engine that fails is not skipped. Each failure is either fixed (with the case that
proves it) or recorded in `docs/browser-support.md` with the engine, the case, and the exact error;
the matrix row for that engine stays `unverified` until it passes.

**Acceptance:** `pnpm test:e2e` runs 3× the cases; the per-engine outcome is in the evidence.

## E2 — Linux, in a container, recorded as such

**What:** the gate runs inside a container on this machine (`docker run --rm` with a Node 26 image
plus git), and the outcome is recorded in `release-matrix.md` as `verified in <image> (container)`.

**Scope:** `check`, `check:boundaries`, `check:contract`, `test:unit`, `test:integration`,
`test:pack`, `test:portable`, `pack:smoke`, `bench:runtime`. `test:e2e` only if the image can carry
Chromium and its dependencies; if not, that is stated rather than assumed.

**Rules:** the container gets a scratch directory and its own HOME. It mounts the repository
read-only where possible and writes only to its own scratch. A gate that fails in the container is
a finding: it is reported with its output, and the matrix says which gate failed on Linux.

**Acceptance:** the image tag, the gate list, the exit codes, and the exact rows the matrix gains.

## E3 — The four partial repository shapes

**What:** one case per row, in the suite that already owns the area:

| Row                                      | Case to add                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHA-256 repositories                     | a SHA-256 repository through a **read** (status/history/refs/diff) and a **write** (stage + commit), asserting OIDs at 64 hex characters end to end |
| Shallow clones                           | reads against a shallow clone: history reports `shallow: true`, a read that needs a missing ancestor reports it rather than inventing a root        |
| Bare repositories                        | a bare repository as the _subject_: refs and history readable, and a write refused with Git's own diagnostic instead of a crash                     |
| Non-ASCII, spaces and tabs in file names | stage + commit + diff through the service, asserting the exact path bytes come back identical                                                       |

**Rules:** each case is a real repository from the fixture, with real Git. Where a shape genuinely
cannot be supported, the case asserts the _refusal_ and the row becomes verified-for-refusal — that
is a result, not a gap.

**Acceptance:** four rows moved off `partial`, or four rows re-stated with a reason.

## E4 — A Git older than the baseline

**What:** `refyard doctor` and a read/write subset run against a Git below 2.43 (an older image), to
exercise the gating the doctor claims: features reported per probe, reasons named, nothing
advertised that does not work.

**Rules:** the goal is not "make it pass" — it is to see the gate work. If the container's Git turns
out to be missing a porcelain the contract needs, the doctor must report it and the UI must not
offer that operation.

**Acceptance:** the Git version actually used, the probes it reported, and the matrix row updated
with those version numbers (or the attempt recorded as failed, with its reason).

## E5 — An asset root that changes under a running service

**What:** the asset root is resolved once per process. A rebuild that replaces the web root under a
running service therefore leaves that process answering from a root that no longer exists — the
document headers recover (fixed in `45dcac0`) but the root itself does not.

**Why it is here:** chasing an unexplained single 403 on `/favicon.svg` narrowed it to this class
and could not reproduce it (three attempts, all 200). Making the failure mode either impossible or
self-diagnosing is worth more than the mystery staying open.

**What to do:** re-resolve the root once when a request would be refused or not found because of it,
with a case that retargets a symlinked web root under a running service and asserts recovery; and
record the single unexplained 403 in the evidence as an open question with its log lines.

**Acceptance:** the case passes, and the record says what is known and what is not.

## Not in this plan

- **T16–T18** (Xross, Kunkun adapter, native-host review): closed until the standalone V1 ships.
- **Publishing**: no version is published, and `refyard` is a working name; that decision is the
  user's and gates the row above.
- **Hosted UI (form 3)**: needs an explicit decision about the origin policy, which is currently a
  refusal. Not a test task.
- **The UI/branding round in flight** (`packages/logo`, shadcn primitives, `AppearanceSettings`):
  someone else's working tree; this plan adds no file under `packages/git-ui` or `apps/web`.

## Order and cost

E1 and E3 are the highest value per hour (real coverage in areas with no coverage), E2 and E4 are
mostly waiting for containers, E5 is small and removes a class of confusion. They do not overlap in
files, so the order can follow whatever is running slowest at the time; the default order is
E1 → E3 → E2 → E4 → E5.
