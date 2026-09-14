# Baseline evidence — 2026-09-14, before T01

> Status: **evidence record, revision 0.** Facts below were produced by running the
> commands shown, on this machine, at this commit. Nothing here is a projection.
> Claim ≠ evidence: statements about other platforms, browsers or Git versions are
> explicitly marked as unverified.

## What was inspected

- Repository: `/Volumes/Portable2TB/ExtDev/refyard`, branch `main`, baseline HEAD `7263254`
  (`init`). Tracked files at baseline: `.gitignore` (modified), `.npmrc` (empty), `README.md`
  (empty), `package.json`, `pnpm-workspace.yaml`, `turbo.json`; `apps/`, `packages/`,
  `docs/plans/` were empty directories; `node_modules/` held only `turbo`, `prettier`,
  `typescript`. No `src` code existed, no Cargo files, no lockfile.
- Working tree at baseline had **one modification of the user's**: `.gitignore` (adds
  `references`). It was preserved, not reverted.
- Design package: `references/ai-chat/2026-09-14/` — `START_HERE.md`, `MIGRATION.md`,
  `DESIGN.md`, `IMPLEMENTATION_PLAN.md`, `chatgpt-xross-git-20260914-152724.md`.
  **Missing from the package:** `CONTRACT.md`, `ACCEPTANCE.md`, `HOST_PORTABILITY.md`,
  `reference/contracts.ts`, `reference/test-harness.ts`. See `docs/plans/0001-refyard-v2-m1-read-only.md` §2
  for how each gap was resolved in this repository.

## Measured environment

| Fact                   | Value                              | Command                                                |
| ---------------------- | ---------------------------------- | ------------------------------------------------------ |
| OS                     | macOS 26.6 (build 25G5065a), arm64 | `sw_vers`, `uname -m`                                  |
| Node                   | v26.8.2                            | `node -v`                                              |
| npm                    | 11.19.1                            | `npm -v`                                               |
| pnpm                   | 11.25.0                            | `pnpm -v`                                              |
| bun (dev scripts only) | 1.4.2                              | `bun -v`                                               |
| git                    | 2.50.1 (Apple Git-155)             | `git --version`                                        |
| TypeScript             | 7.0.2                              | `node -e "require('typescript/package.json').version"` |
| Vitest                 | 4.1.11                             | resolved in `pnpm-lock.yaml`                           |
| Zod                    | 4.6.5                              | resolved in `pnpm-lock.yaml`                           |
| oxc-parser             | 0.150.0                            | resolved in `pnpm-lock.yaml`                           |

`nvm alias default 26` now resolves to v26.8.2, and `~/.zshrc` loads nvm (it did not
before: `nvm` appeared nowhere in the shell configuration, so the default alias had no
effect and Homebrew's `node` was found first). `.nvmrc` pins `26.8.2`.

## Decisions recorded at T01

- **Runtime major is Node 26**, not the 24.x named in the v2 design package, by the user's
  direction on 2026-09-14. Same principle (exactly one pinned major); the reference plan's
  T13 `engines` assertion will read `>=26 <27` with a comment.
- **The public contract is authored here** (`packages/git-contract`) because
  `reference/contracts.ts` and `CONTRACT.md` were not delivered. The 35-operation union and its
  target pairing are frozen in `OPERATION_TARGET_LIST`, and `tests/contract/schema.test.ts`
  covers the whole union rather than samples of it.
- **Boundary enforcement uses `oxc-parser`** (AST, TS-aware) rather than text matching, so
  comments, strings and property names cannot produce false positives — a checker that cries
  wolf gets disabled.
- **`bun` runs dev scripts; Node 26 runs the product.** Scripts import with explicit `.ts`
  extensions so both runners work; packages use `.js` specifiers so published ESM resolves.
- **Generated contract artifacts are committed** (`packages/git-contract/generated/`) and
  `pnpm check:contract` fails on drift, so a contract change is always visible in review.

## What T01 verified (with the commands that did it)

```
pnpm check            # turbo package type checks + root tsc over scripts/tests → 1 package, 0 errors
pnpm check:boundaries # 1 portable package, 13 source files, no host dependencies
pnpm check:contract   # artifacts match, 438 named schemas, every $ref resolves
npx vitest run        # 66 tests in 3 files (contract 36, boundary engine 22, fixture 8)
```

Exit statuses were 0 for all four at commit time. The fixture suite creates real temporary
repositories with an isolated `HOME`/config and a local bare remote; no test touches the
developer's own repositories.

## Not verified, and not claimed

- **No browser, no HTTP, no UI exists yet.** M1's read-only loop is T01–T07; at T01 only the
  contract, the boundary checker and the repository fixture exist.
- **Only macOS 26.6 arm64 was exercised.** Windows and Linux behaviour (process groups,
  `taskkill`, `/dev/null` vs `NUL`, non-UTF-8 paths) is unverified in this repository.
- **Only git 2.50.1 was exercised.** The functional baseline of the design package is 2.43.0;
  running the parser fixtures against that version has not happened yet.
- **No performance, memory or size numbers are reported.** The limits in
  `packages/git-contract/src/limits.ts` are policy values, not measurements.
- **Portability is only checked statically so far** (T01's dependency scan). The byte-fixture
  and neutral-IIFE gates are T02 and T04; none of the three proves QuickJS/JSC readiness.
