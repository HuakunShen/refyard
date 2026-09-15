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
| `pnpm test:e2e`         | 30 Playwright specs in **three engines** (Chromium, Firefox, WebKit) against the built SPA, served by the real host over the packaged static bundle, each on a service with its own state directory                                                     | verified |
| `pnpm build`            | turbo build of every package plus the static SPA                                                                                                                                                                                                        | verified |
| `pnpm pack:smoke`       | 14 steps against the `npm pack` tarball: `npm exec` install, doctor, `serve --json`, packaged UI, authenticated API, SIGTERM, busy port, tarball contents                                                                                               | verified |
| `pnpm bench:runtime`    | the packaged CLI on a 100,000-commit fixture, three repeated lifecycles                                                                                                                                                                                 | verified |

Verification scope, stated plainly: `pnpm test` (unit + integration) is a single run of the suite
on this machine; it is not a soak, not a fuzz campaign, and not a property test over arbitrary
inputs. Where a case covers a race or a crash path, the case constructs it; nothing here proves the
absence of races that were not constructed.

## Platforms

| Platform                   | Status     | Notes                                                                                            |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| macOS arm64 (this machine) | verified   | everything in this file                                                                          |
| macOS x64                  | unverified | not run; no Intel machine was used                                                               |
| Linux arm64, container     | verified   | `node:26-trixie` (Node 26.8.2, Git 2.47.3), all ten gates, as a non-root user — see below        |
| Linux x64, native          | verified   | Ubuntu 24.04, Node 26.8.2, Git 2.43.0: all ten gates, plus the chromium e2e suite (30 of 30) — `linux-and-windows.md` |
| Linux x64 (CI)             | partial    | the same machine ran the gates; Firefox and WebKit are not installed there, so those engines stay unverified on Linux, and `.github/workflows/ci.yml` has not run yet |
| Windows (native)           | partial    | Windows 10.0.26200, Node 26.5.0, Git 2.55.0.windows.3: nine gates and all 15 `pack:smoke` steps pass, one step skipped (Windows has no signals); the e2e suite was **not** run, so the browser rows stay unverified there — `linux-and-windows.md` |
| WSL                        | unverified | not run                                                                                          |
| Container/CI runner        | verified   | `bun scripts/container-gates.ts --image node:26-trixie`, 2026-09-15                              |

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

## Browsers

`pnpm test:e2e`, 2026-09-15, Playwright 1.63.0, one worker: **90 passed, 0 failed (11.9 m)** —
the same 30 specs in each of three engines, against the built bundle and a real service.

| Browser                             | Status     | Notes                                                                                                                                                                                                                                                          |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium 153 (Playwright bundled)   | verified   | 30 cases: reads, staging, stash, branch, merge, worktrees, versions, live updates, offline reload, repository creation                                                                                                                                         |
| Firefox 155 (Playwright bundled)    | verified   | the same 30 cases in this run. A later run of the same 90 came back 89 passed / 1 failed — one Firefox workspace case, service unreachable mid-spec, passing again on re-run in 7.2 s; `browser-support.md` keeps it as an open question, not a browser defect |
| WebKit 26.6 (Playwright bundled)    | verified   | the same 30 cases. Two WebKit-only limits were found in the _tests_; both are recorded in `browser-support.md`                                                                                                                                                 |
| Safari (the installed macOS app)    | unverified | Playwright's WebKit is the engine, not Apple's build; nobody has opened the app in Safari                                                                                                                                                                      |
| Safari on iOS                       | unverified | not run                                                                                                                                                                                                                                                        |
| Chrome on Android                   | unverified | not run                                                                                                                                                                                                                                                        |
| Mobile viewports (any)              | unverified | the e2e projects are desktop-sized only                                                                                                                                                                                                                        |
| Screen readers / accessibility tree | unverified | no assistive-technology run                                                                                                                                                                                                                                    |

What "verified" does not mean: nothing here says the UI looks right on a phone, that Apple's
Safari build behaves like Playwright's WebKit, or that a screen reader can drive the app. Those
are open, and they are named here rather than implied.

## Git and repository shapes

| Shape                                                | Status     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git 2.50.1                                           | verified   | the full suite and the benchmark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Git 2.47.3, Linux                                    | verified   | all ten gates in `node:26-trixie` (see "Linux, in a container")
| Git 2.43.0, native Linux                             | verified   | all ten gates and the chromium e2e suite on Ubuntu 24.04 — `linux-and-windows.md` |
| Git 2.55.0.windows.3, Windows                        | partial    | nine gates and `pack:smoke` (15 steps, one skipped) on Windows 10.0.26200; no e2e — `linux-and-windows.md` |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
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

## Deliberately absent from this release

These are not gaps in testing; they are decisions, and a release page must not present them as
features:

| Not shipped                                                  | Why                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| A hosted/remote origin calling the loopback API              | the host refuses foreign `Origin`, `null`, and cross-site requests, and no flag widens that |
| Built-in terminal, plugin host, native shell                 | out of scope for V1 by design                                                               |
| Any write operation not listed in `GET /api/v1/capabilities` | there is no route, no capability, and no button                                             |

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
