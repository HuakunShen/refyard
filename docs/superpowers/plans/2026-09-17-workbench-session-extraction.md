# Workbench Session Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move pairing, stored-session, URL-scrubbing, and credential invalidation logic out of `+page.svelte` without changing Refyard's browser behavior.

**Architecture:** A pure TypeScript session state machine owns connection state and transitions. `+page.svelte` wraps its plain state object in Svelte `$state`, injects the real Git client/storage/history ports, and keeps TanStack Query plus Git selection outside this first slice. This avoids an untestable rune/effect module while creating the responsibility boundary described by the product direction.

**Tech Stack:** Svelte 5, TypeScript, `@refyard/git-client`, Vitest, Playwright.

**Spec:** `docs/product/git-client-direction.md` §13 and Phase B

## Global Constraints

- Pairing behavior, sessionStorage/localStorage policy, and query/legacy-fragment compatibility must not change.
- A password-rejected hosted ticket remains reusable in memory until expiry, while the URL is scrubbed immediately.
- Session invalidation clears the bearer and paired service instance but does not own repository/commit/path selection.
- No query, mutation, SSE, or Git contract behavior moves in this slice.
- The page remains the Svelte composition root; the extracted module is browser-independent and unit-testable under Node.

---

### Task 1: Extract the session state machine

**Files:**
- Create: `apps/web/src/lib/workbench/session.ts`
- Create: `tests/unit/workbench-session.test.ts`

**Interfaces:**
- `createWorkbenchSessionState(input)` produces mutable `WorkbenchSessionState`.
- `pairWorkbenchSession(state, ports)` performs ticket exchange, health verification, persistence, and URL scrubbing.
- `consumeInitialPairingUrl(state, ports)` implements open-the-URL auto-pair semantics.
- `clearWorkbenchCredentials(state, ports)` clears token/instance plus browser storage.
- `isDefaultSessionBaseUrl(state)` reports whether the selected service is still the page's default origin.
- `describeClientProblem(error)` centralizes the existing `GitClientError` display formatting.

- [x] Write unit cases for initialization, successful pairing, password failure, already-paired URL scrubbing, and credential clearing.
- [x] Run the focused unit file RED because the module does not exist.
- [x] Implement the minimal state machine and injected ports.
- [x] Run the focused unit file GREEN and `pnpm check`.
- [x] Commit `refactor(web): extract workbench session state`.

### Task 2: Replace route-level session orchestration

**Files:**
- Modify: `apps/web/src/routes/+page.svelte`
- Test: `tests/e2e/read-only.spec.ts`
- Test: `tests/e2e/offline.spec.ts`

**Interfaces:**
- The page owns `const session = $state(createWorkbenchSessionState(...))`.
- Existing query keys continue to consume derived `baseUrl` and `token` aliases from `session`.
- `disconnect()` remains a page wrapper so it can clear selected commit/path and TanStack Query state after `clearWorkbenchCredentials()`.

- [x] Replace local pairing/base-url/token/instance state with the session state machine.
- [x] Replace the page's pairing and auto-pair implementation with `pairWorkbenchSession` / `consumeInitialPairingUrl`.
- [x] Replace different-instance credential clearing with `clearWorkbenchCredentials`.
- [x] Remove the route-local `describeProblem` implementation in favor of `describeClientProblem`.
- [x] Run `pnpm check` and focused unit tests.
- [x] Build the local workbench and run Chromium `read-only.spec.ts` plus `offline.spec.ts`.
- [x] Run `git diff --check` and confirm `+page.svelte` is smaller with no behavior changes.
- [x] Commit `refactor(web): use extracted session controller`.

## Final verification

- [x] `pnpm check`
- [x] `pnpm test:unit`
- [x] `pnpm exec playwright test tests/e2e/read-only.spec.ts tests/e2e/offline.spec.ts --project=chromium`
- [x] `git diff --check`
