# Testing and Safety

**Created: 2026-09-23** — initial wiki bootstrap. Numbers below are **measured** in the 2026-09-22 provider acceptance run, not plan budgets.

## Root script contract (`AGENTS.md` §6.3)

`pnpm check` · `check:boundaries` · `check:contract` · `test:unit` · `test:integration` · `test:e2e` · `test:compat` · `test:portable` · `build` · `pack:smoke` · `bench:runtime`

## Safety rules that outrank convenience

1. **Fixture isolation** — every test that writes Git state uses an isolated temporary repo from `tests/support/repo.ts`: own `HOME`, `GIT_CONFIG_GLOBAL`/`SYSTEM` pointed at scratch files, no network. **Never** run stage/commit/discard/stash/worktree experiments in this (or any real) repository.
2. **Destructive ops** (`discardTrackedPaths`, `removeWorktree`, stash drop/pop, branch delete) require explicit confirmation, **back up first**, fail closed on unverifiable preconditions; a backup failure means the operation does not run.
3. **Discard** restores tracked working-tree files **to the index** — never to HEAD, never untracked/ignored, never `git clean`; refuses symlinks/submodules/special types.
4. **Preview fingerprints** bind a path's content fingerprint to a request; changed bytes → stale → re-confirm. Status markers are not proof.
5. **Bulk actions pre-check all paths** — one unsupported path rejects the batch before any write.
6. **Preserve** user hooks, signing config, filters, SSH host verification; never `--no-verify`, never disable `commit.gpgSign`, never rewrite global config.
7. **Unknown is a result** — never auto-retry a mutation, never label an uncertain result `succeeded`, never continue a dependent write after unresolved cleanup.
8. **Never fabricate evidence.** Unexercised platform/browser/version = unverified and must be named as such.

## Suites and measured results (2026-09-22)

| Gate | Result |
| --- | --- |
| `pnpm check` | PASS — 13/13 projects, svelte-check 0 errors |
| `pnpm check:boundaries` | PASS — 3 portable packages / 68 source files; 171 test/script files |
| `pnpm check:contract` | PASS — 558 named schemas, artifacts match |
| unit + node + contract | PASS — 55 files / 550 tests |
| `pnpm test:integration` | PASS — 48 files / 526 tests |
| `cargo test --workspace` | PASS — 0 failed |
| `pnpm build:web` / CLI bundle | PASS |
| Playwright Chromium | 73/75 — pre-existing `offline.spec.ts:92` failure; `read-only.spec.ts:158` flake (PASS twice isolated) |
| Playwright Firefox | **NOT RUN** — local Firefox cannot start (known limitation) |

## Evidence discipline

Verification records live in `docs/evidence/` (e.g. `native-desktop-ssh/`, `history-search/`, `m1-read-only-loop.md`, `m2-writes.md`, `security.md`); acceptance matrices in `docs/acceptance/`. Cells are PASS / PARTIAL / BLOCKED / NOT RUN — **BLOCKED is never written as PASS**.

## Related pages

- `Architecture/Architecture.md` — the invariants these tests defend
- `Services/Git Provider Integration.md` — the latest full gate run
