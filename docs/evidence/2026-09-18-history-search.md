# History search and filters — local verification

Date: 2026-09-18. Runtime: Node 26.8.2; macOS 26.6 arm64; Apple Git 2.50.1.
Branch: `codex/history-search-filters`, based on merge `2510af0`.
Production implementation: `b9637fe`, `94c2496`, `bde35cc`, `8e7a924`, `4425306`.

All required local gates passed. Full Chromium exercised the rebuilt production code at `4425306`; later commits only strengthened tests or updated this documentation. The final105-OID browser proof is at `47b7b9d`.

## Implemented behavior and proof

| Requirement / original tasks           | Implementation                                                                                                                                                                                       | Evidence                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Typed public filters and topology (1)  | One HistoryQuery, exported pure semantic validator, required continuous/sparse topology, contract 1.1.0                                                                                              | `tests/contract/history-filters.test.ts`, generated-schema check                             |
| Snapshot-owned intent and cursor (2,5) | Copied/frozen normalized filters/path, pinned walk tips, authoritative page size and first-parent mode; exact repeated legacy options accepted                                                       | `tests/node/history-snapshots.test.ts`, `tests/integration/reads.test.ts`                    |
| Literal bounded Git search (3)         | Git performs message/author AND filtering, literal pathspecs, inclusive date limits across nonmonotonic timestamps                                                                                   | `tests/core/history-search.test.ts`, real isolated Git fixtures                              |
| SHA lookup (4,5)                       | SHA-1/SHA-256 commit-only disambiguation, no-match/noncommit/ambiguity, one-object no-walk predicates, optional ref ancestry                                                                         | Core and read integration fixtures include actual prefix collisions                          |
| Authority and paging (5,6)             | Observed refs, worktree-bound exact paths, foreign cursor/path rejection, path eviction and ref movement across pages, complete-ref fingerprint                                                      | Read/HTTP/scope integration tests; unchanged repository:read/grant checks                    |
| Client encoding (6)                    | Explicit typed URL fields, no raw argv/revspec/environment or display-path authority                                                                                                                 | `tests/unit/git-client.test.ts`, `tests/integration/http.test.ts`                            |
| Draft/applied model (7)                | Typing never changes query; successful Apply/Clear starts a fresh page chain; repository change clears state with a synchronous identity guard                                                       | `tests/unit/workbench-history-filters.test.ts`, query composition and real Chromium requests |
| UI and sparse graph (8)                | Reusable compact HistoryFilterBar, expandable controls, clear applied labels/errors, exact known-file identity retained after inspector selection clears; sparse pages bypass graph layout and edges | New History Chromium cases, query-model tests, desktop/narrow screenshots                    |
| Responsive/accessibility/paging (8,9)  | Wrapped header, bounded mobile History virtualizer, no overlap/overflow at390px, linked human-readable validation alert, cursor-only continuation and same-filter restart                            | `tests/e2e/history-search.spec.ts`; final full Chromium gate below                           |
| Existing behavior (10)                 | Unfiltered/ref-scoped graph, context actions, inspector, staging, merge, stashes, worktrees and hosted/instance flows remain present                                                                 | Full Chromium regression; full unit/integration/security gates                               |

## Fresh root verification

All commands use Node26 PATH, `CI=1`, the existing offline pnpm store, and `pnpm_config_verify_deps_before_run=error` so verification cannot silently reinstall dependencies. Listener/browser tests ran outside the default listener-restricted sandbox. All Git writes use the existing isolated fixture helper, never a developer repository.

| Command                                                                                           | Result                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                      | exit0; eight workspace checks, zero cached; both Svelte packages had zero errors/warnings                                                                                  |
| `pnpm check:boundaries`                                                                           | exit0; three portable packages/55 sources,109 test/script files                                                                                                            |
| `pnpm check:contract`                                                                             | exit0;453 named schemas, artifacts match and references resolve                                                                                                            |
| `pnpm test:unit`                                                                                  | exit0;346 tests,38 files                                                                                                                                                   |
| `pnpm test:integration`                                                                           | exit0;411 tests,30 files including security                                                                                                                                |
| `pnpm test:portable`                                                                              | exit0;4 tests plus11 neutral-IIFE assertions;61,975 bytes, no host globals/shims                                                                                           |
| `pnpm build` and `bun scripts/bundle-cli.ts`                                                      | exit0; rebuilt static SPA and Node CLI                                                                                                                                     |
| Full `pnpm exec playwright test --project=chromium`                                               | exit0;47/47 tests,5.7minutes, after fresh SPA/CLI rebuild                                                                                                                  |
| `pnpm exec playwright test --config tests/compat/playwright.config.ts --output <isolated-output>` | exit0;9/9 across Chromium,Firefox,WebKit;59.4s                                                                                                                             |
| Final exact105-OID browser pagination proof                                                       | exit0; focused current-build Chromium case,18.1s; every rendered window unique/in order, complete observed105-OID sequence equals fixture; alert association also verified |

The build emits its existing large-chunk warning (roughly560kB minified route) and plugin timing diagnostics. No thresholds, assertions or tests were weakened to hide them. Test runner color-environment warnings are informational.

## Review and corrections

Portable core, service, and UI received separate independent spec/quality reviews, followed by a whole-branch review. No Critical/Important findings remain in the reviewed implementation. The final browser pagination proof separately closes the whole-branch review's exact105-row evidence gap. Review caught Git's approximate parsing of `@0`/negative/large timestamps; complete raw date syntax (`@SECONDS +0000`) and numeric upper bounds now have real epoch, leap/century and year9999 regressions. Unicode searches were separately proved under an inherited C locale. A missing validation-description ID was corrected with a real accessible-description assertion. Stale version fixtures now derive the current contract, and the existing compatibility workflow explicitly opens Branches before its unchanged write-refusal assertions.

## Decisions and limits

| Decision                                                                         | Reason / cost                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated branch/worktree; no automatic integration                               | Preserves main's restored, staged plan. The completed feature still needs a separate integration action.                                                                            |
| Group original tasks into portable/core, service contract boundary and UI slices | Required response fields and their producers move coherently; review diffs are larger than the initial ten-commit sketch.                                                           |
| Permit only exactly matching repeated legacy cursor limit/first-parent values    | Keeps existing typed pagination callers without allowing query reinterpretation; adds a small equality check.                                                                       |
| Reject NUL, multiline input and unpaired surrogates                              | Prevents one literal becoming multiple Git grep patterns; multiline search is outside this release. Text remains bounded to512 Unicode scalar values after trim.                    |
| Required topology, contract1.1.0, coordinated page/service update                | Missing topology never fabricates continuous ancestry. Older strict History clients or services can fail schema checks; full mixed-version History interoperability is not claimed. |
| Closed private Unicode search hint mapped to C.UTF-8 for one read                | Fixes locale-dependent accent case matching; extends the private host port, never the public environment surface. Ordinary commands/hooks retain their environment.                 |
| Hash complete observed refs/HEAD separately from scoped walk tips                | Detects movement beyond the16-tip walk limit without retaining5000 ref strings in each of4096 snapshots; costs bounded host hashing.                                                |
| Separate execution revision for explicit Apply/Clear                             | Repeating the same filter starts page1; creates separate short-lived query-cache entries.                                                                                           |

Current evidence covers macOS/Apple Git/Node26 and Chromium History. Linux/Windows, other Git/locale combinations, and full Firefox/WebKit History are unverified. The nine compatibility cases do not establish full History feature support in those other engines. The portability smoke is not a QuickJS/JSC runtime proof.

Known-path history uses only host-issued IDs and does not follow renames. SHA and path filters cannot combine in this first release. The current one-toolbar workbench is verified; multiple embedded toolbars would need instance-specific control IDs. Repository-switch reset has pure-model and source evidence, not a dedicated two-repository History browser scenario. No package publication, deployment, push or merge into main occurred.

## Screenshots

- [Desktop expanded filters](history-search/desktop-expanded.png)
- [Narrow viewport, friendly validation and sparse rows](history-search/narrow-expanded.png)

These are real Chromium renders of generated scratch fixture repositories. They contain no credentials. Subsequent E2E runs write screenshots to their own test output, not these committed artifacts.
