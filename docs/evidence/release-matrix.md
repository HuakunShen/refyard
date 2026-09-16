# Release matrix — what was verified, and on what

A row is only as good as its status word. Three are used, and nothing else:

- **verified** — the named gate ran to completion on the named thing, exit status 0, against the
  revision this file belongs to.
- **partial** — a named subset ran and the notes say which; the rest of that row is **unverified**.
- **unverified** — it was not exercised. Nothing here claims it works.

"Unverified" is a statement about this evidence, not a guess about the platform. A row that says
unverified is a row nobody has run yet, and it stays that way until a gate runs there.

## The machine this was produced on

| Thing            | Value                                       | Status   |
| ---------------- | ------------------------------------------- | -------- |
| Operating system | macOS 26.6 (build 25G5065a), arm64          | verified |
| Node             | 26.8.2 (the version in `.nvmrc`)            | verified |
| Git              | 2.50.1 (Apple Git-155)                      | verified |
| pnpm             | 11.25.0                                     | verified |
| bun              | 1.4.2 (dev scripts only; never the product) | verified |
| Date             | 2026-09-15                                  | verified |

Every number in `docs/evidence/performance.json` and every test result below comes from this
machine. It is one machine, and the report says so in its own fields.

## Node versions

The following table is historical evidence for published 0.1.x artifacts, which bundled the UI.
The current R15 artifact is API-only; its replacement evidence is in the section above.

The published `engines` range is **`>=22 <27`**. It is a range rather than one version because
the runtime has no dependency on anything newer: the packaged CLI was run through its real
lifecycle under six Node lines, and every one of them produced the same result.

`refyard serve --json` from the `npm pack` tarball, then pair (`session/exchange`), read
`capabilities`, `status`, `history` and `refs`, verify the API-only root boundary, ask for a preview
token, submit `stagePaths`, and check the file really is staged with `git diff --cached`:

| Node    | Capabilities | UI  | History   | HEAD   | Stage operation | `git diff --cached` | Status   |
| ------- | ------------ | --- | --------- | ------ | --------------- | ------------------- | -------- |
| 20.19.0 | 35 kinds     | 200 | 2 commits | `main` | `succeeded`     | `b.txt`             | verified |
| 22.11.0 | 35 kinds     | 200 | 2 commits | `main` | `succeeded`     | `b.txt`             | verified |
| 22.23.2 | 35 kinds     | 200 | 2 commits | `main` | `succeeded`     | `b.txt`             | verified |
| 24.10.0 | 35 kinds     | 200 | 2 commits | `main` | `succeeded`     | `b.txt`             | verified |
| 25.2.1  | 35 kinds     | 200 | 2 commits | `main` | `succeeded`     | `b.txt`             | verified |
| 26.8.2  | 35 kinds     | 200 | 2 commits | `main` | `succeeded`     | `b.txt`             | verified |

Three things this table is and is not:

- It is the **product** working: a released tarball, the real CLI, a real Git repository, HTTP
  and SSE over loopback, a real write through the queue. It is not the test suite.
- **20.19.0 works but is not in the range.** Node 20 reached end of life on 2026-04-30
  (`nodejs/Release` schedule, read 2026-09-15), so promising it would be a promise to support an
  unsupported line. `>=22 <27` covers every line still supported: 22 (maintenance), 24 (LTS) and
  26 (current — it becomes LTS on 2026-10-28). The `20.19.0` row is the evidence that the range
  is chosen for support policy, not because the code needs a newer engine.
- **32-bit, musl, Alpine and other libc builds are not tested here.** Nothing in the code is
  platform-specific beyond Node's own builtins, but a row that was not run is not in this table.

The suite, as opposed to the product, needs the toolchain's floor: **Vitest 4 declares
`^20.19 || >=22.12`**, so the development and CI path is Node 22.12+ while the published runtime
range is the wider `>=22 <27`. `scripts/lib/node-engines.ts` reads the published range out of
`packages/npm-dist/package.json`; `pack:smoke`, `bench:runtime` and the performance-evidence test
all assert the Node they are looking at satisfies it, so the range cannot drift away from what was
measured.

The ten gates were also run end to end on the floor line, **Node 22.23.2**: `check` (8 tasks),
`check:boundaries`, `check:contract`, `test:unit` (236), `test:integration` (352), `test:pack` (15),
`test:portable` (4), `build:release`, `pack:smoke` (14 steps) and `test:e2e` all pass there, and
`bench:runtime` completes. On the release runtime, **Node 26.8.2**, the same ten gates pass and
`pnpm test:e2e` reports **90 passed in 10.6 m**. Two runs of the e2e suite were needed on the floor
line: the first came back with one failure — the identity of which was lost because the runner
printed a summary line instead of the log — and the immediate re-run on the same revision passed
**90 of 90 in 10.6 m**, on the harness this revision ships. That unknown failure is the third
sighting of one flaky case per long run (see `browser-support.md`), not a Node-22 finding.

## Gates

Each row is a root script from the project's command contract, run from a clean checkout of the
revision this file belongs to.

| Gate                    | What it covered                                                                                                                                                                                                                                         | Status   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `pnpm check`            | TypeScript across 8 workspace tasks, `strict` with `noUncheckedIndexedAccess`                                                                                                                                                                           | verified |
| `pnpm check:boundaries` | 3 portable packages (54 source files) free of host APIs; 71 test/script files reach into packages by name only                                                                                                                                          | verified |
| `pnpm check:contract`   | committed JSON Schema artifacts match the Zod schemas; 438 named schemas, every `$ref` resolves                                                                                                                                                         | verified |
| `pnpm test:unit`        | unit suites (contract, core planners/parsers, graph, client, ui, fixtures) — 236 cases, 16 files                                                                                                                                                        | verified |
| `pnpm test:integration` | real Git in temporary repositories: reads, writes, merge, worktrees, submodules, jobs, restart, auth, concurrency, network, repository creation, the four repository shapes; plus the negative security cases in `tests/security` — 352 cases, 23 files | verified |
| `pnpm test:portable`    | 4 portability cases in vitest, plus a neutral IIFE build (60,542 bytes) run with no host globals and no Node shims — 11 planner/parser checks                                                                                                           | verified |
| `pnpm test:e2e`         | 30 Playwright specs in **three engines** (Chromium, Firefox, WebKit) against the built SPA, served by a separate static asset host while the API-only CLI owns the service, each on a service with its own state directory                              | verified |
| `pnpm build`            | turbo build of every package plus the static SPA                                                                                                                                                                                                        | verified |
| `pnpm pack:smoke`       | 14 steps against the `npm pack` tarball: `npm exec` install, doctor, `serve --json`, API-only 404 boundary, authenticated API, SIGTERM, busy port, tarball contents                                                                                     | verified |
| `pnpm bench:runtime`    | the packaged CLI on a 100,000-commit fixture, three repeated lifecycles — macOS, Ubuntu, a container, CI (2,000 commits) and, from round two, Windows                                                                                                   | verified |

Verification scope, stated plainly: `pnpm test` (unit + integration) is a single run of the suite
on this machine; it is not a soak, not a fuzz campaign, and not a property test over arbitrary
inputs. Where a case covers a race or a crash path, the case constructs it; nothing here proves the
absence of races that were not constructed.

## Platforms

| Platform                       | Status     | Notes                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64 (this machine)     | verified   | everything in this file                                                                                                                                                                                                                                               |
| macOS x64                      | unverified | not run; no Intel machine was used                                                                                                                                                                                                                                    |
| Linux arm64, container         | verified   | `node:26-trixie` (Node 26.8.2, Git 2.47.3), all ten gates, as a non-root user — see below                                                                                                                                                                             |
| Linux x64, native              | verified   | Ubuntu 24.04, Node 26.8.2, Git 2.43.0: all ten gates, plus chromium **and Firefox** e2e (30 of 30 each; WebKit is blocked there on one apt package) — `linux-and-windows.md`                                                                                          |
| Linux x64 (CI, ubuntu-latest)  | verified   | `ci` run 35009027364, 2026-09-15, revision `180f515`: all ten gates, 90 of 90 e2e cases (three engines) in 11.7m, `pack:smoke` 14 steps — see "Continuous integration" below                                                                                          |
| macOS arm64 (CI, macos-latest) | verified   | the same run: all ten gates, 90 of 90 e2e cases in 10.7m, `pack:smoke` 14 steps                                                                                                                                                                                       |
| Windows (native)               | verified   | Windows 10.0.26200, Node 26.5.0, Git 2.55.0.windows.3: nine gates, `pack:smoke` (15 steps, one skipped — Windows has no signals) and, from round two, the **e2e suite 90 of 90 in three engines in 4.9 m** plus `bench:runtime` at full size — `linux-and-windows.md` |
| Windows (GitHub Actions)       | unverified | `.github/workflows/ci.yml` now runs the same matrix on `windows-latest`; no hosted green run id exists yet for this revision.                                                                                                                                         |
| WSL                            | unverified | not run                                                                                                                                                                                                                                                               |
| Container/CI runner            | verified   | `bun scripts/container-gates.ts --image node:26-trixie`, 2026-09-15                                                                                                                                                                                                   |

### Linux, in a container

`bun scripts/container-gates.ts --image node:26-trixie`, 2026-09-15, Linux arm64, container
`node:26-trixie` (Node 26.8.2, Git 2.47.3), running as the image's non-root `node` user, on a copy
of the working tree with `node_modules` and every build artifact excluded: **10 of 10 gates
passed** — `check`, `check:boundaries`, `check:contract`, `test:unit` (236), `test:integration`
(352), `test:pack`, `test:portable`, `build:release`, `pack:smoke` (14 steps), `bench:runtime`
(100,000 commits, three lifecycles). The script mounts the repository read-only, gives the
container its own HOME, and reports every gate's exit status; `test:e2e` is **not** part of it —
the image carries no browser, and installing Chromium's dependencies there is a decision this
round did not make, so that row stays unverified on Linux rather than assumed.

Three findings came out of it, all now fixed:

- **Running as root is refused, correctly.** The first run failed five `cli.test.ts` cases with
  "refyard refuses to run as root: Git hooks and filters would run with root privileges" — the
  safety check working, in the wrong place. The script now runs as the image's `node` user.
- **`bench:runtime` refused a stale artifact** (a source file was newer than the staged CLI).
  That is the refusal working; the gate list now runs `build:release` instead of `build`, so the
  artifact the numbers describe was built in the same container run.
- **Two races in the harness, not in the product**: `pack:smoke` read stderr for the pairing URL
  once, immediately after the ready object (the URL is written a moment later), and it signalled
  only the `npm exec` wrapper. Both are fixed — the URL is waited for, and the signal goes to the
  process group, which is what a terminal's Ctrl+C sends.

One behaviour is worth naming for anyone installing through `npx`/`npm exec`, because it is not the
product's and cannot be fixed in it: **signalling the wrapper alone does not stop the service on
Linux.** `kill -TERM <npm exec pid>` kills npm, and refyard keeps running and keeps answering on
its port; on macOS the same command stopped it. Measured both ways in the container: the wrapper
exits `null`/`SIGTERM` on both platforms, and the address still answered 15 s later on Linux only.
Ctrl+C in a terminal is unaffected — that signals the whole foreground group, which is what
`pack:smoke` now does — but a supervisor that signals only the process it started should run
`refyard serve` directly, or signal the process group.

## Continuous integration

`.github/workflows/ci.yml` runs the same gate list on `ubuntu-latest` and `macos-latest`. The first
green run was **34984950591** on 2026-09-15, revision `f7be568` — both jobs succeeded:

|                                 | ubuntu-latest                         | macos-latest                          |
| ------------------------------- | ------------------------------------- | ------------------------------------- |
| Static gates                    | 8 of 8 tasks                          | 8 of 8 tasks                          |
| Portability smoke               | neutral IIFE, 60,550 bytes, 11 checks | the same                              |
| End-to-end                      | **90 passed (11.9 m)**, three engines | **90 passed (10.3 m)**, three engines |
| `pack:smoke`                    | 14 steps                              | 14 steps                              |
| `bench:runtime` (2,000 commits) | 204.1 status reads/second             | 322.6 status reads/second             |

The three runs before it failed, and each failure was worth having:

1. **`sh: 1: bun: not found`** on both platforms. `pnpm check` passed and the next command in the
   same step — `check:boundaries`, a bun script — could not start. The workflow never installed
   bun. (The toolchain rule is that dev scripts are TypeScript run by bun and never the product.)
2. **All 30 e2e specs failed on a missing panel**: the service was serving its placeholder page
   because the dev CLI found no web build. On the development machine `.refyard-dev/web` was a
   symlink somebody had created by hand; nothing in the repository created it. The bundle script
   stages the built SPA there now.
3. **60 specs failed**: the workflow installed chromium only while `pnpm test:e2e` runs three
   engines. Chromium had passed 30 of 30 first.

None of the three could have been found locally, which is the point of running CI at all.

The run for revision **`180f515`** — the measured engines change — was **35009027364**, and both
jobs succeeded again. It is the run that matters for the range: neither runner is inside the
`ci.yml` on a hand-picked Node, and both `pack:smoke` steps reported

```
  ok   the Node on PATH is inside the published engines range  [node --version]
```

against the manifest's new `>=22 <27`. End-to-end: **90 passed (11.7 m)** on ubuntu-latest and
**90 passed (10.7 m)** on macos-latest, three engines each; `pack:smoke` 14 steps on both; the
2,000-commit benchmark smoke completed on both (`bench:runtime: wrote … performance.json`, on the
runner's own checkout — it is not committed from there).

## Browsers

`pnpm test:e2e`, 2026-09-15, Playwright 1.63.0, one worker: **90 passed, 0 failed (11.9 m)** —
the same 30 specs in each of three engines, against the built bundle and a real service.

| Browser                             | Status     | Notes                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium 153 (Playwright bundled)   | verified   | 30 cases: reads, staging, stash, branch, merge, worktrees, versions, live updates, offline reload, repository creation                                                                                                                                                |
| Firefox 155 (Playwright bundled)    | verified   | the same 30 cases in this run. Later runs of the same 90 came back 89 passed / 1 failed twice — one Firefox workspace case and one WebKit one, passing again on re-run in 7.2 s and 14.4 s; `browser-support.md` keeps them as an open question, not a browser defect |
| WebKit 26.6 (Playwright bundled)    | verified   | the same 30 cases; 90 of 90 on Node 22.23.2 in 10.6 m, and 90 of 90 on Windows 10.0.26200 in 4.9 m. Two WebKit-only limits were found in the _tests_; both are in `browser-support.md`. On Linux the engine is blocked by a missing `libavif16`                       |     |
| Safari (the installed macOS app)    | unverified | Playwright's WebKit is the engine, not Apple's build; nobody has opened the app in Safari                                                                                                                                                                             |
| Safari on iOS                       | unverified | not run                                                                                                                                                                                                                                                               |
| Chrome on Android                   | unverified | not run                                                                                                                                                                                                                                                               |
| Mobile viewports (any)              | unverified | the e2e projects are desktop-sized only                                                                                                                                                                                                                               |
| Screen readers / accessibility tree | unverified | no assistive-technology run                                                                                                                                                                                                                                           |

What "verified" does not mean: nothing here says the UI looks right on a phone, that Apple's
Safari build behaves like Playwright's WebKit, or that a screen reader can drive the app. Those
are open, and they are named here rather than implied.

## Git and repository shapes

| Shape                                                | Status     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git 2.50.1                                           | verified   | the full suite and the benchmark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Git 2.47.3, Linux                                    | verified   | all ten gates in `node:26-trixie` (see "Linux, in a container")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Git 2.43.0, native Linux                             | verified   | all ten gates and the chromium e2e suite on Ubuntu 24.04 — `linux-and-windows.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Git 2.55.0.windows.3, Windows                        | partial    | nine gates and `pack:smoke` (15 steps, one skipped) on Windows 10.0.26200; no e2e — `linux-and-windows.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |     |
| Git 2.43 – 2.49                                      | unverified | not installed here; 2.43.0 is the functional baseline the doctor checks, and 2.47.3 was exercised in the container                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Git below 2.43                                       | verified   | Git 2.39.5 (`node:26-bookworm`, Linux arm64, 2026-09-15). `refyard doctor --json`: `featureVersionSupported: false`, reason "git 2.39.5 is below the functional baseline 2.43.0; features are reported per probe"; probes `status-porcelain-v2`, `worktree-list-z`, `cat-file-batch`, `push-porcelain`, `repository-layout` all `supported: true`, and **`fetch-porcelain` `supported: false` — "Git rejected the porcelain option"** (`git fetch --porcelain` arrived in 2.41). The gating then holds: `fetch` and `pull` are absent from `operations` and named in `unavailable` with code `git-too-old`, and the not-implemented reason no longer claims them (`tests/integration/http.test.ts`). Reads and worktree writes still work there: `reads.test.ts` (38) and `staging.test.ts` (28) pass on 2.39.5, including the SHA-256, shallow, bare and non-ASCII-path rows. Never run below 2.39 |
| SHA-256 repositories                                 | verified   | read (status, history, refs, diff) and write (stage + commit) against a `--object-format=sha256` repository, with every object id asserted at 64 hex characters end to end and the committed head compared against Git's own (`tests/integration/reads.test.ts`, `tests/integration/staging.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Shallow clones                                       | verified   | history reports `shallow: true`, marks the grafted commit `boundary: true` with its parent named in `missingParents` and absent from the page, and refuses to describe that ancestor (`tests/integration/reads.test.ts`). The clone is made with `file://` because Git ignores `--depth` for a local path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Bare repositories                                    | verified   | as the _subject_: the repository list, its head, refs and history all read (`tests/integration/reads.test.ts`); a status read is refused with `GitCommandFailed` carrying Git's own `fatal: this operation must be run in a work tree`; **every** write is refused with `UnsupportedOperation` naming the real reason, nothing is accepted, and the repository is untouched (`tests/integration/staging.test.ts`). Writes that Git itself could do in a bare repository (`fetch`, `push`, `tag`, `branch`, `remote`) are refused too — a per-operation "needs a working tree" classification is future work, not a claim made here                                                                                                                                                                                                                                                                  |
| `initRepository`                                     | verified   | creates at a workspace destination inside an approved root, through the panel and the API; refusals: a destination that leaves the root, one naming `.git`, one in a root the session was not granted (`tests/integration/workspace.test.ts`, `tests/security/negative.test.ts`, `tests/e2e/workspace.spec.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `cloneRepository`                                    | verified   | clones a **local bare remote** into a destination and reads it back; refuses a transport-helper URL and a destination that is not empty without deleting anything. Never run against an `https://`/`ssh://` remote, a credential helper, or a clone that recurses into submodules — those stay unverified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Linked worktrees                                     | verified   | create/remove with confirmation, and the primary worktree offers no remove control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Submodules                                           | verified   | status, out-of-sync reporting, and URL validation in the e2e and integration suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| File names with spaces, tabs or non-ASCII characters | verified   | three such names (`moved 新\tname.txt`, `plain space.txt`, `mix 混合\tx.txt`) are staged, committed and read back byte for byte against `git ls-tree -z` (`tests/integration/staging.test.ts`). No **e2e** case clicks such a path in the browser; that part stays unverified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## An asset root that changes under a running service

The asset root is resolved once per process, through `realpath`. A rebuild that replaces the
web root — or retargets a symlink at the new build, which is how a deploy usually publishes
one — therefore used to leave the running service answering `404` for its own shell until
someone restarted it. The service now re-resolves the root once when a request would miss
because of it, so the next request lands in the new build (`tests/integration/http.test.ts`,
"finds the shell again when the web root is replaced under it").

That fix closes the _class_ the plan attached this task to. The observation that led there is
still open, and this is what is known about it:

- **Observed, once:** a single `403` on `GET /favicon.svg`, during the session that wrote the
  release gates, with three attempts to reproduce it afterwards all answering `200`.
- **What can produce a 403 there:** exactly two checks in `packages/host-node/src/http/assets.ts`
  answer `403`, and both mean "outside the web assets" — a lexical containment check and a
  `realpath` check. A root that moved under the process is the shape that makes the second one
  fire, which is why it was chased as a member of this class.
- **Not preserved:** the original log lines. They were in a terminal, not in this repository;
  a search of `docs/` and of the session artifacts finds only the log-format unit test's own
  `GET /favicon.svg 403` example, which is not an observation. Nothing is reconstructed here.
- **What is true now:** a refusal is logged with its reason (`tests/integration/http.test.ts`,
  "records why a refusal happened, not only its status"), and a stale root self-heals on the
  next request. If it recurs, the log line names which check refused and the path it resolved.

## Managed workspace form

Runtime repository approval and revocation are verified in the isolated CLI/HTTP fixture and in
the Chromium UI flow. The current service grants every named path explicitly, records changes in
`access.jsonl`, and removes a revoked repository from the live session. The detailed case table is
in `docs/evidence/form2-managed-workspaces.md`. No multi-user or deployed hosted evidence is
implied by this row.

| Surface                                            | Status   | Evidence                                                                                  |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `POST /api/v1/repositories/register` and `/revoke` | verified | R4 integration and Chromium UI cases; exact paths, refusals, revocation and restart audit |

## Cloudflare Worker and API-only current revision

The 2026-09-16 R15 work changes the packaging boundary from the historical 0.1.x artifact. This
revision has not been published or deployed. Local evidence is:

| Surface                  | Result                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Static PWA build         | `pnpm build` passed; `apps/web/build` contains the SPA, service worker and manifest.                                              |
| Cloudflare configuration | `pnpm --dir apps/web exec wrangler deploy --dry-run` passed with Wrangler 4.132.0, reading 75 asset files; no publish occurred.   |
| Worker boundary          | `pnpm test:web-host` passed 4/4: asset delegation/security headers, JSON `/api/*` 404, and non-GET refusal.                       |
| Backend-only package     | `pnpm build:release`, `pnpm test:pack`, and external `pnpm pack:smoke` passed; the tarball had 5 entries and no `web/` directory. |
| Browser topology         | `pnpm test:e2e` passed 99/99 across Chromium, Firefox and WebKit against the separate static host and API-only CLI.               |
| Hosted API path          | Exact-origin CORS, password-gated ticket exchange and bearer read passed in local isolated services; no public tunnel was exercised. |
| Live deployment          | **Unverified.** No Cloudflare account, domain, Worker deployment, or tunnel credentials were used.                                |

The pairing URL has two explicit addresses in hosted mode: `--ui-origin` is the Worker page origin,
and `--api-origin` is the HTTPS API/tunnel origin visible to the browser. The CLI still binds its
listener to loopback; the operator-owned tunnel must preserve the service's Host/Origin/auth
checks.

## Compatibility suite

`pnpm test:compat` uses the built SPA, the API-only CLI and a separate static asset host. The
real host response is rewritten only at the browser test boundary to model a page/service pair
from different revisions. The three engines passed 9/9: a major mismatch refused writes, a newer
same-major contract kept history reads working while disabling writes, and additive health and
capabilities fields were ignored. The full e2e gate separately passed 99/99.

## Hono, OpenAPI, Scalar and MCP

The Node listener now adapts API and discovery requests into Hono. The static asset server remains
the separate trusted bundle boundary; it is not exposed as an MCP capability. `hono-openapi`
describes the route table and contract response schemas, Scalar serves `/scalar`, and the MCP
endpoint uses `@hono/mcp` with stateful in-memory sessions bound to the same Refyard bearer session.

Local evidence on the isolated macOS fixtures:

| Surface                        | Result                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI                        | `/openapi.json` returns an OpenAPI 3.1 document with the GitService paths, contract-derived response schemas and exact BearerAuth scheme.                                 |
| Scalar                         | `/scalar` returns the reference UI and contains no repository id or snapshot.                                                                                             |
| MCP                            | 4 protocol cases pass: initialize, `tools/list`, `repo_status`, and missing-bearer refusal; all 373 Node/integration/security cases pass after the adapter was installed. |
| MCP tools intentionally absent | `search_commits` and `get_file_history` are not advertised because the current ReadService has no corresponding bounded query; no mutation tool is registered.            |
| Security                       | Existing exact Host/Origin, bearer, repository scope, request-limit, JSON 404 and no-SPA-fallthrough cases remain green; MCP sessions reject a different Refyard bearer.  |
| Live external MCP client       | **Unverified.** The protocol case uses a real HTTP JSON-RPC client against the real service; no third-party MCP client or deployed endpoint was exercised.                |

## Hosted password form

R13's hosted form is now an explicit opt-in at the CLI boundary. A non-loopback origin is refused
at startup unless `REFYARD_HOSTED_PASSWORD` is supplied by the environment; the secret is never an
argv value, URL field, log value, `localStorage` entry, or Worker binding. The password is scrypt-
hashed in memory, is accepted only with the single ticket exchange, and is replaced by the normal
in-memory bearer for subsequent requests. The exchange route limits each exact origin to 10
attempts per minute.

The local isolated integration evidence covers missing and wrong passwords, successful exchange,
retrying the same ticket after a password failure, the 429 limit, no password in logs, and CLI
refusal when the hosted secret is absent. The browser UI exposes a password input only when the API
address is separate from the page and does not persist it. A real public HTTPS tunnel, browser
Local Network Access prompt, and live Cloudflare deployment remain **unverified**.

## Documentation truth

R9 re-verified the source comments and evidence index after the write and hosted-PWA rounds. The
performance report is [performance.json](/Volumes/Portable2TB/ExtDev/refyard/docs/evidence/performance.json),
with [performance.md](/Volumes/Portable2TB/ExtDev/refyard/docs/evidence/performance.md) as its human
entry point. The SVGs under `packages/logo/` are explicitly non-runtime design assets; the SPA's
versioned copies under `apps/web/static/` are the ones the build ships. The former generated
`packages/npm-dist/web/web-hidden/` directory is absent and the current release script has no writer
for it.

## Xross integration

R10's adapter targets the Xross APIs present at revision
`97925a3f74cf2b95b21389cd7db1c2dcca94d2e7`: an authorized `xross.exec.v1` stream held open for
the session and an authorized `OpenForward` to the peer's loopback port. The fixed command, policy
classification, readiness parsing, API-origin rewrite and cleanup order pass in
`tests/integration/xross-launch.test.ts`.

The real launch is **unverified**. This session had no peer with the Refyard executable in
`shell-allow`, no peer `egress-allow` for the service port, and no two-daemon Xross testbed. The
adapter makes no install attempt and does not weaken Refyard's Host/Origin checks; the raw-forward
authority caveat and the missing app/dependency registry are recorded in
`integrations/xross/README.md`.

## Kunkun integration

R11 targets Kunkun revision `a12620cc709d06bda6cecc15fa35cadbf243cd94` and fixed kkrpc `2.0.0`.
`integrations/kunkun/package.json` declares one `custom-view` command, a backend permission scoped
to `dist/backend.js`, and loopback-only network access. The backend holds the Refyard GitClient and
bearer; the view receives only a kkrpc proxy, with AsyncIterable events replacing browser SSE.

The manifest, real Refyard status call over a real kkrpc memory transport, event streaming, and
unchanged `Permission denied` propagation pass in `tests/integration/kunkun-adapter.test.ts`.
Out-of-tree installation, backend packaging, and a real Electron Kunkun custom-view launch are
**unverified** because this session did not install or modify the Kunkun checkout.

## Native-host evaluation

R12 closes T18 as an evidence-backed **stay on Node** decision. The current measurement is
[native-host-evaluation.md](/Volumes/Portable2TB/ExtDev/refyard/docs/research/native-host-evaluation.md),
and its machine-readable input is the current
[performance.json](/Volumes/Portable2TB/ExtDev/refyard/docs/evidence/performance.json).

The approved local benchmark completed three lifecycles on macOS arm64 with Node 26.8.2, Git
2.50.1, a 100,000-commit fixture and no network: cold start 0.469 s, service RSS 96 MiB before
reads and 104 MiB after 100 status reads, 193.4 status reads/s, first history page 388 ms, and
diff-service RSS 204 MiB after the large/bounded/long-line/many-file batch. The current API-only
CLI bundle is 2,205,421 bytes; `npm pack` reported 393,309 bytes compressed and 2.2 MB unpacked.
These are Node/process measurements, not a native-runtime comparison.

| Native-host question | Status | Evidence |
| --- | --- | --- |
| QuickJS/JSC/WASI/native VM version | **unverified** | No native VM was built, installed, or run. |
| Async, cancellation, bytes and cleanup inside that VM | **unverified** | The 60,550-byte neutral IIFE and 11 planner/parser checks are a portability smoke only. |
| Same-workload native memory and complete engine/bridge/process cost | **unverified** | No native comparator or long-time/idle measurement exists. |
| Xross native size and permission delta | **unverified** | The current adapter's real peer launch is still unverified; 512 KiB / 5 MiB are review rules only. |
| Release decision | **verified** | No explicit native implementation approval; continue with the Node sidecar. |

## Published releases

Both releases were published by the project's owner and then checked against the registry — a
distinct step from the gates above, because it is the only one that looks at what a user actually
installs.

| Version | First available (UTC)         | `dist.integrity` (sha512)       | Verified after publishing                                                                                                                                                                                                                                               |
| ------- | ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0   | 2026-09-15T19:40:39Z          | `8IbSWpd921gnt…K0+zO18aqUPyA==` | `refyard doctor --json` from the registry install; the full lifecycle probe (serve, pair, capabilities, status, history, refs, the packaged UI, a preview token, `stagePaths`, `git diff --cached`) on Node 26.8.2 and 22.23.2 — identical to the locally built tarball |
| 0.1.1   | 2026-09-15T21:24Z (`PUT 202`) | `zMNGWNvozu9Nk…QVVc+gPIGeH4Q==` | the same lifecycle probe on the same two Node lines, and the check this release exists for: with `core.autocrlf=true` in the session's global config the discard operation writes `base\r\n`, with an empty config it writes `base\n`                                   |

Each `dist.integrity` was compared against the dry run made before publishing, byte for byte, and
the tarball's own `dist/build-info.json` was read back (`0.1.1`: version 0.1.1, engines `>=22 <27`,
`gitCommit 3327119`) — so the artifact on the registry is the one that was measured, not simply one
with the same version number.

Two things worth knowing before publishing the next one. npm returns `PUT 401`, opens a browser
for re-authentication and then succeeds; the exit code is still 0, so the publish worked. And the
version can take a few minutes to become installable: right after the `202`, `npm view` and
`npm exec --package refyard@0.1.1` can both report "no matching version" from a stale local
cache — `npm_config_prefer_online=true npm exec …` revalidates it and works.

## Deliberately absent from the current scope

These are not gaps in testing; they are decisions, and a release page must not present them as
features:

| Not shipped                                                  | Why                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| A live hosted API/tunnel deployment                          | the exact-origin path is implemented and locally tested, but no Cloudflare account, domain, or tunnel was exercised |
| A Cloudflare Worker Git backend or API proxy                 | the Worker is static/PWA-only; it has no Git binding, bearer secret, or API route                                   |
| Built-in terminal, plugin host, native shell                 | out of scope for V1 by design                                                                                       |
| Any write operation not listed in `GET /api/v1/capabilities` | there is no route, no capability, and no button                                                                     |
| QuickJS/JSC/native-host runtime                              | T18 measured Node needs and deferred the native implementation; no native VM result exists                        |

## Reproducing this matrix

```sh
pnpm install --frozen-lockfile
pnpm check && pnpm check:boundaries && pnpm check:contract
pnpm test:unit && pnpm test:integration && pnpm test:pack && pnpm test:portable
pnpm build && pnpm test:e2e && pnpm pack:smoke
pnpm bench:runtime
```

`pnpm bench:runtime` rewrites `docs/evidence/performance.json` for the machine it runs on. Committing
that file from another machine replaces these numbers with that machine's numbers, which is why the
report names its runtime, platform, and architecture.
