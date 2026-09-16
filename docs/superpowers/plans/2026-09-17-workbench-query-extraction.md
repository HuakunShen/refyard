# Workbench Query Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move TanStack read-query composition and read-derived workbench models out of `+page.svelte` while preserving polling, pagination, diff selection, and cache semantics.

**Architecture:** Pure query-model helpers calculate workspace roots, diff intent, and history notices. `queries.svelte.ts` owns TanStack query creation, polling timers, stash retention, repository reconciliation, history graph derivation, identity query, and session-expiry detection. The page supplies reactive getters for client/baseUrl/token/visibility plus the existing selection proxy, and continues to own mutations and DOM visibility events.

**Tech Stack:** Svelte 5 runes, TanStack Svelte Query, TypeScript, Vitest, Playwright.

**Spec:** `docs/product/git-client-direction.md` §13 and Phase B

## Global Constraints

- Query keys, enabled conditions, polling cadence, history page size (100), and pagination cursors remain unchanged.
- Hidden-tab polling and visible-tab invalidation behavior remain unchanged.
- Stash rows remain mounted across transient background failures.
- Diff requests remain bounded: change-set first, selected-path patch second.
- Repository reconciliation continues to use the extracted selection controller.
- Mutations, session negotiation, SSE, and UI layout do not move in this slice.

### Task 1: Lock read-model semantics and ownership

**Files:**
- Create: `apps/web/src/lib/workbench/query-model.ts`
- Create: `tests/unit/workbench-query-model.test.ts`
- Create: `tests/unit/workbench-query-boundary.test.ts`

- [ ] Write RED helper tests for workspace-root dedupe, status/commit diff intent, ignored paths, and history notices.
- [ ] Write a RED structural test requiring `+page.svelte` to stop owning TanStack query constructors and polling helpers.
- [ ] Implement pure query-model helpers and make only the helper tests GREEN; keep the ownership test RED until Task 2.
- [ ] Commit `refactor(web): extract workbench query model`.

### Task 2: Extract TanStack query composition

**Files:**
- Create: `apps/web/src/lib/workbench/queries.svelte.ts`
- Modify: `apps/web/src/routes/+page.svelte`

- [ ] Move capabilities, repositories, status, refs, stashes, worktrees, submodules, history, commit detail, diff, diff patch, and identity query composition into `createWorkbenchQueries`.
- [ ] Move read-derived repository list/root/current repository/stash retention/history graph/notices/selected commit/detail/diff request/session-expired state behind reactive getters.
- [ ] Export `invalidateWorkbenchBackgroundQueries(queryClient)` and keep the page's DOM visibility listener as a thin adapter.
- [ ] Replace page-local read composition with stable query-object aliases and `$derived` getter aliases.
- [ ] Run ownership/helper units and `pnpm check`.
- [ ] Build and run Chromium read-only, live-updates, offline, workspace, and versions specs.
- [ ] Run full unit suite and `git diff --check`.
- [ ] Commit `refactor(web): extract workbench read queries`.

## Final verification

- [ ] `pnpm check`
- [ ] `pnpm test:unit`
- [ ] `pnpm exec playwright test tests/e2e/read-only.spec.ts tests/e2e/live-updates.spec.ts tests/e2e/offline.spec.ts tests/e2e/workspace.spec.ts tests/e2e/versions.spec.ts --project=chromium`
- [ ] `git diff --check`
