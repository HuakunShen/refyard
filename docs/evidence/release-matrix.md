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

| Gate                    | What it covered                                                                                                                                                                               | Status   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `pnpm check`            | TypeScript across 8 workspace tasks, `strict` with `noUncheckedIndexedAccess`                                                                                                                 | verified |
| `pnpm check:boundaries` | 3 portable packages (53 source files) free of host APIs; 63 test/script files reach into packages by name only                                                                                | verified |
| `pnpm check:contract`   | committed JSON Schema artifacts match the Zod schemas; 438 named schemas, every `$ref` resolves                                                                                               | verified |
| `pnpm test:unit`        | unit suites (contract, core planners/parsers, graph, client, ui, fixtures)                                                                                                                    | verified |
| `pnpm test:integration` | real Git in temporary repositories: reads, writes, merge, worktrees, submodules, jobs, restart, auth, concurrency; plus the negative security cases in `tests/security` — 313 cases, 20 files | verified |
| `pnpm test:portable`    | 4 portability cases in vitest, plus a neutral IIFE build (60,542 bytes) run with no host globals and no Node shims — 11 planner/parser checks                                                 | verified |
| `pnpm test:e2e`         | 27 Playwright cases against the built SPA, served by the real host over the packaged static bundle, each on a service with its own state directory                                            | verified |
| `pnpm build`            | turbo build of every package plus the static SPA                                                                                                                                              | verified |
| `pnpm pack:smoke`       | 14 steps against the `npm pack` tarball: `npm exec` install, doctor, `serve --json`, packaged UI, authenticated API, SIGTERM, busy port, tarball contents                                     | verified |
| `pnpm bench:runtime`    | the packaged CLI on a 100,000-commit fixture, three repeated lifecycles                                                                                                                       | verified |

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

The e2e suite runs against the Chromium that Playwright manages, not a system browser.

| Browser                                               | Status     | Notes                                                                                                       |
| ----------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| Chromium (Playwright bundled; Desktop Chrome profile) | verified   | 27 cases: reads, staging, stash, branch, merge, worktrees, versions, offline reload with the service worker |
| Firefox                                               | unverified | no Playwright project for it                                                                                |
| WebKit / Safari (macOS)                               | unverified | not run                                                                                                     |
| Safari on iOS                                         | unverified | not run                                                                                                     |
| Chrome on Android                                     | unverified | not run                                                                                                     |
| Mobile viewports (any)                                | unverified | the e2e project is desktop-sized only                                                                       |
| Screen readers / accessibility tree                   | unverified | no assistive-technology run                                                                                 |

What "verified" does not mean: nothing here says the UI looks right on a phone, that Safari's
service-worker behavior matches Chromium's, or that a screen reader can drive the app. Those are
open, and they are named here rather than implied.

## Git and repository shapes

| Shape                                                | Status     | Notes                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git 2.50.1                                           | verified   | the full suite and the benchmark                                                                                                                                                                                                 |
| Git 2.43 – 2.49                                      | unverified | not installed here; 2.43.0 is the functional baseline the doctor checks                                                                                                                                                          |
| Git below 2.43                                       | partial    | the version comparison is unit-tested (`versionAtLeast`), and the doctor reports `supported: false` with a reason when Git cannot run at all; the per-probe gating has never been run against a real or simulated Git below 2.43 |
| SHA-256 repositories                                 | partial    | a SHA-256 repository is created and OIDs checked at 64 hex characters; no read or write workflow has run against one                                                                                                             |
| Shallow clones                                       | partial    | history reports `shallow: true` rather than drawing a fake root; other workflows were not run against a shallow clone                                                                                                            |
| Bare repositories                                    | unverified | no test opens a bare repository as the _subject_; bare repositories appear only as push/fetch remotes for fixtures                                                                                                               |
| Linked worktrees                                     | verified   | create/remove with confirmation, and the primary worktree offers no remove control                                                                                                                                               |
| Submodules                                           | verified   | status, out-of-sync reporting, and URL validation in the e2e and integration suites                                                                                                                                              |
| File names with spaces, tabs or non-ASCII characters | partial    | a name with all three round-trips through status in the integration suite (`displayPath`, `pathEncoding: "utf8"`), and the fixture can create them; no write workflow and no e2e run has used such a path                        |

## Deliberately absent from this release

These are not gaps in testing; they are decisions, and a release page must not present them as
features:

| Not shipped                                                  | Why                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `initRepository`, `cloneRepository`                          | not implemented; `capabilities` omits them so no UI offers them                             |
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
