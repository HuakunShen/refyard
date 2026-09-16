# Workbench Selection Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Centralize repository/commit/status-path/diff-file selection transitions so every UI entry point applies the same reset rules.

**Architecture:** A pure TypeScript selection state machine owns only identifiers and the selected `StatusEntry`. The page wraps it in `$state` and keeps queries/rendering outside the module. Repository reconciliation consumes only currently visible repository ids, so it has no dependency on TanStack Query.

**Tech Stack:** TypeScript, Svelte 5, Vitest, Playwright.

**Spec:** `docs/product/git-client-direction.md` §13 and Phase B

## Global Constraints

- Selecting a repository clears commit and status-path selection.
- Selecting a commit clears status-path and diff-file selection.
- Selecting a status path clears commit and diff-file selection.
- Selecting a diff file changes only the diff-file selection.
- Disconnect/session invalidation clears inspectable commit/path state but does not silently change the selected repository.
- Repository reconciliation selects the first visible repository only when the current id is missing and the list is non-empty.

### Task 1: Extract and test selection transitions

**Files:**
- Create: `apps/web/src/lib/workbench/selection.ts`
- Create: `tests/unit/workbench-selection.test.ts`

- [x] Write RED unit cases for repository, commit, status-path, diff-file, disconnect, reconciliation, and revocation transitions.
- [x] Implement the pure state machine.
- [x] Run focused unit tests and `pnpm check`.
- [x] Commit `refactor(web): extract workbench selection state`.

### Task 2: Replace page-local selection assignments

**Files:**
- Modify: `apps/web/src/routes/+page.svelte`

- [x] Wrap the selection state in `$state` and keep derived aliases for query/render call sites.
- [x] Replace repository reconciliation, create/register/revoke handlers, list selection, status selection, commit selection, and diff-file selection with transition helpers.
- [x] Run `pnpm check`, focused unit tests, Chromium read-only/workspace specs, full unit suite, and `git diff --check`.
- [x] Commit `refactor(web): use extracted selection controller`.

## Final verification

- [x] `pnpm check`
- [x] `pnpm test:unit`
- [x] `pnpm exec playwright test tests/e2e/read-only.spec.ts tests/e2e/workspace.spec.ts --project=chromium`
- [x] `git diff --check`
