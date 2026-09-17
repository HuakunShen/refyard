# Workbench Connectivity Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move browser online/offline observation and SSE live-update lifecycle out of `+page.svelte` without changing cache invalidation or write gating.

**Architecture:** A pure TypeScript connectivity controller owns `browserOnline` and `streamState`. DOM event subscription, event-stream creation, and query invalidation are ports supplied by the page, so the state transitions can be tested under Node while the page remains the Svelte/TanStack composition root.

**Tech Stack:** TypeScript, Svelte 5, `@refyard/git-client`, TanStack Query, Vitest, Playwright.

**Spec:** `docs/product/git-client-direction.md` §13 and Phase B

## Global Constraints

- Browser `navigator.onLine` remains the only offline write gate; SSE silence must never mean offline.
- SSE events remain hints, never sources of truth.
- `repositoryChanged` invalidates only status, refs, and history for that repository.
- `eventGap` or the stream gap callback invalidates all cached queries.
- A missing token leaves the stream offline and creates no connection.
- Cleanup stops the stream and returns the visible stream state to offline.

### Task 1: Extract connectivity state and event routing

**Files:**
- Create: `apps/web/src/lib/workbench/connectivity.ts`
- Create: `tests/unit/workbench-connectivity.test.ts`

- [x] Write RED cases for browser online observation, no-token behavior, stream readiness/error/cleanup, repository invalidations, and gap invalidation.
- [x] Implement the pure controller with injected event-stream and DOM ports.
- [x] Run focused unit tests and `pnpm check`.
- [x] Commit `refactor(web): extract workbench connectivity state`.

### Task 2: Replace page-level online/SSE effects

**Files:**
- Modify: `apps/web/src/routes/+page.svelte`
- Test: `tests/e2e/live-updates.spec.ts`
- Test: `tests/e2e/offline.spec.ts`

- [x] Wrap `createWorkbenchConnectivityState()` in page `$state` and expose derived aliases.
- [x] Replace raw window online/offline listeners with `observeBrowserConnectivity`.
- [x] Replace page-owned `createEventStream` logic with `startWorkbenchEventStream`.
- [x] Run `pnpm check`, focused units, Chromium live-updates and offline specs.
- [x] Run full unit suite and `git diff --check`.
- [x] Commit `refactor(web): use extracted connectivity controller`.

## Final verification

- [x] `pnpm check`
- [x] `pnpm test:unit`
- [x] `pnpm exec playwright test tests/e2e/live-updates.spec.ts tests/e2e/offline.spec.ts --project=chromium`
- [x] `git diff --check`
