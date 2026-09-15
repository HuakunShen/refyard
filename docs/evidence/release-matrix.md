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

| Gate                    | What it covered                                                                                                                                                                                                             | Status   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `pnpm check`            | TypeScript across 8 workspace tasks, `strict` with `noUncheckedIndexedAccess`                                                                                                                                               | verified |
| `pnpm check:boundaries` | 3 portable packages (54 source files) free of host APIs; 68 test/script files reach into packages by name only                                                                                                              | verified |
| `pnpm check:contract`   | committed JSON Schema artifacts match the Zod schemas; 438 named schemas, every `$ref` resolves                                                                                                                             | verified |
| `pnpm test:unit`        | unit suites (contract, core planners/parsers, graph, client, ui, fixtures) — 225 cases, 14 files                                                                                                                            | verified |
| `pnpm test:integration` | real Git in temporary repositories: reads, writes, merge, worktrees, submodules, jobs, restart, auth, concurrency, network, repository creation; plus the negative security cases in `tests/security` — 331 cases, 22 files | verified |
| `pnpm test:portable`    | 4 portability cases in vitest, plus a neutral IIFE build (60,542 bytes) run with no host globals and no Node shims — 11 planner/parser checks                                                                               | verified |
| `pnpm test:e2e`         | 29 Playwright cases against the built SPA, served by the real host over the packaged static bundle, each on a service with its own state directory                                                                          | verified |
| `pnpm build`            | turbo build of every package plus the static SPA                                                                                                                                                                            | verified |
| `pnpm pack:smoke`       | 14 steps against the `npm pack` tarball: `npm exec` install, doctor, `serve --json`, packaged UI, authenticated API, SIGTERM, busy port, tarball contents                                                                   | verified |
| `pnpm bench:runtime`    | the packaged CLI on a 100,000-commit fixture, three repeated lifecycles                                                                                                                                                     | verified |

Verification scope, stated plainly: `pnpm test` (unit + integration) is a single run of the suite
on this machine; it is not a soak, not a fuzz campaign, and not a property test over arbitrary
inputs. Where a case covers a race or a crash path, the case constructs it; nothing here proves the
absence of races that were not constructed.

## Platforms

| Platform                   | Status     | Notes                                                                                            |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| macOS arm64 (this machine) | verified   | everything in this file                                                                          |
| macOS x64                  | unverified | not run; no Intel machine was used                                                               |
| Linux x64                  | unverified | `.github/workflows/ci.yml` is written for it, but has not run in this repository                 |
| Linux arm64                | unverified | not run                                                                                          |
| Windows (native)           | unverified | not run; the code paths exist (`%LOCALAPPDATA%` state root, path handling) but are not exercised |
| WSL                        | unverified | not run                                                                                          |
| Container/CI runner        | unverified | not run                                                                                          |

## Browsers

`pnpm test:e2e`, 2026-09-15, Playwright 1.63.0, one worker: **90 passed, 0 failed (11.9 m)** —
the same 30 specs in each of three engines, against the built bundle and a real service.

| Browser                                          | Status     | Notes                                                                                                                  |
| ------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chromium 153 (Playwright bundled)                 | verified   | 30 cases: reads, staging, stash, branch, merge, worktrees, versions, live updates, offline reload, repository creation |
| Firefox 155 (Playwright bundled)                  | verified   | the same 30 cases                                                                                                      |
| WebKit 26.6 (Playwright bundled)                  | verified   | the same 30 cases. Two WebKit-only limits were found in the *tests*; both are recorded in `browser-support.md`           |
| Safari (the installed macOS app)                  | unverified | Playwright's WebKit is the engine, not Apple's build; nobody has opened the app in Safari                               |
| Safari on iOS                                     | unverified | not run                                                                                                                |
| Chrome on Android                                 | unverified | not run                                                                                                                |
| Mobile viewports (any)                            | unverified | the e2e projects are desktop-sized only                                                                                |
| Screen readers / accessibility tree               | unverified | no assistive-technology run                                                                                            |

What "verified" does not mean: nothing here says the UI looks right on a phone, that Apple's
Safari build behaves like Playwright's WebKit, or that a screen reader can drive the app. Those
are open, and they are named here rather than implied.

## Git and repository shapes

| Shape                                                | Status     | Notes                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git 2.50.1                                           | verified   | the full suite and the benchmark                                                                                                                                                                                                                                                                                |
| Git 2.43 – 2.49                                      | unverified | not installed here; 2.43.0 is the functional baseline the doctor checks                                                                                                                                                                                                                                         |
| Git below 2.43                                       | partial    | the version comparison is unit-tested (`versionAtLeast`), and the doctor reports `supported: false` with a reason when Git cannot run at all; the per-probe gating has never been run against a real or simulated Git below 2.43                                                                                |
| SHA-256 repositories                                 | verified   | read (status, history, refs, diff) and write (stage + commit) against a `--object-format=sha256` repository, with every object id asserted at 64 hex characters end to end and the committed head compared against Git's own (`tests/integration/reads.test.ts`, `tests/integration/staging.test.ts`)          |
| Shallow clones                                       | verified   | history reports `shallow: true`, marks the grafted commit `boundary: true` with its parent named in `missingParents` and absent from the page, and refuses to describe that ancestor (`tests/integration/reads.test.ts`). The clone is made with `file://` because Git ignores `--depth` for a local path        |
| Bare repositories                                    | verified   | as the _subject_: the repository list, its head, refs and history all read (`tests/integration/reads.test.ts`); a status read is refused with `GitCommandFailed` carrying Git's own `fatal: this operation must be run in a work tree`; **every** write is refused with `UnsupportedOperation` naming the real reason, nothing is accepted, and the repository is untouched (`tests/integration/staging.test.ts`). Writes that Git itself could do in a bare repository (`fetch`, `push`, `tag`, `branch`, `remote`) are refused too — a per-operation "needs a working tree" classification is future work, not a claim made here |
| `initRepository`                                     | verified   | creates at a workspace destination inside an approved root, through the panel and the API; refusals: a destination that leaves the root, one naming `.git`, one in a root the session was not granted (`tests/integration/workspace.test.ts`, `tests/security/negative.test.ts`, `tests/e2e/workspace.spec.ts`) |
| `cloneRepository`                                    | verified   | clones a **local bare remote** into a destination and reads it back; refuses a transport-helper URL and a destination that is not empty without deleting anything. Never run against an `https://`/`ssh://` remote, a credential helper, or a clone that recurses into submodules — those stay unverified       |
| Linked worktrees                                     | verified   | create/remove with confirmation, and the primary worktree offers no remove control                                                                                                                                                                                                                              |
| Submodules                                           | verified   | status, out-of-sync reporting, and URL validation in the e2e and integration suites                                                                                                                                                                                                                             |
| File names with spaces, tabs or non-ASCII characters | verified   | three such names (`moved 新\tname.txt`, `plain space.txt`, `mix 混合\tx.txt`) are staged, committed and read back byte for byte against `git ls-tree -z` (`tests/integration/staging.test.ts`). No **e2e** case clicks such a path in the browser; that part stays unverified                                       |

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
