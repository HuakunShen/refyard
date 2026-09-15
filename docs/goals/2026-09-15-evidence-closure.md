# Goal — Evidence closure: turn every "unverified" row into a measurement or a reason

> Status: **active goal, revision 0** — written 2026-09-15.
> Implements: nothing in the delivered design package by number (T01–T15 are done; T16–T18 stay
> closed until the standalone V1 ships). Carried by `docs/plans/0004-refyard-v2-evidence-closure.md`.

## Why this round exists

`docs/evidence/release-matrix.md` is honest, which is exactly why it has holes: it says
"unverified" for every operating system except macOS, every browser except the Playwright
Chromium, every Git version except 2.50.1, and "partial" for SHA-256 repositories, shallow
clones, bare repositories and non-ASCII file names. Those words are better than silence, but
they are still gaps, and most of them are closable **on this machine, today**, without shipping
anything and without asking anyone:

- two of the three Playwright engines are one config entry away;
- Linux is one container away (Docker 29.4 is installed here), which is not a desktop Linux but
  is a different kernel, a different glibc and a different filesystem — a real fact to record;
- an older Git is one container image away, and the doctor's own baseline (2.43) can be exercised
  against it;
- SHA-256, shallow, bare and non-ASCII shapes are tested by adding cases to suites that already
  exist and already have fixtures for them.

The rule for the round is the one the evidence already follows: a row moves off "unverified" only
when a command ran and its result is recorded — including the case where the attempt fails, which
is itself a fact worth having ("Firefox fails on X, with this error") rather than a silence.

## Acceptance

Met when, on one revision, ALL of the following hold and are demonstrated by commands that were
actually run:

- `pnpm test:e2e` runs the suite in **three engines** (Chromium, Firefox, WebKit) and either all
  pass, or every failure is recorded in `docs/browser-support.md` with its exact error and the
  affected row stays unverified for that engine.
- A Linux run of the gate is recorded: the container image, which gates ran inside it, and their
  exit codes. The row in the matrix says "verified in `<image>` (container)" and explicitly not
  "Linux desktop".
- The four "partial" repository shapes are either verified by new cases (SHA-256 through a read
  **and** a write workflow, a shallow clone through reads, a bare repository as the subject of
  reads, non-ASCII/space/tab names through stage + commit + diff) or re-stated with the precise
  reason they still are partial.
- The Git-version rows carry real version numbers that were exercised, or the attempt is recorded
  as failed with its reason.
- Nothing in the round changes what the product claims: `capabilities` is read from a running
  service before and after, and the operation list is unchanged by test work.

## Standing constraints

`AGENTS.md` §1–§2 apply unchanged. Specific to this round:

- Every write test uses a temporary repository with its own `HOME`; containers get their own
  scratch directories; **no test touches the developer's repositories or state directory**.
- A failing engine (or an old Git) is never made to pass by weakening a case, ignoring an engine,
  or adding a skip. The outcome is reported as it is.
- The container runs are recorded as what they are: a container, on this machine, on a dated
  image — not as "Linux works".
- No network is used by tests: browser binaries are already installed locally, and remote
  operations use local bare repositories.
