# Repository Launcher and Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitKraken-style local repository launcher, Recent list, and multi-repository tabs to the `pnpm dev` workbench.

**Architecture:** Start the development coordinator without a required repository, expose explicit repository registration/opening through the existing authenticated management boundary, and keep launcher/tabs as pure web state around one active repository query set.

**Tech Stack:** TypeScript, Zod, Hono, Svelte 5, TanStack Query, Vitest, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-09-18-repository-launcher-tabs-design.md`

## Global Constraints

- Never scan a parent directory or infer repository authority from display paths.
- Every repository is explicitly opened, cloned, created, registered, or revoked.
- The browser sends typed intentions; trusted Node code resolves filesystem and Git authority.
- One active repository renders Git panels at a time; tabs are session selection state.
- Existing `refyard open <path>` and `refyard serve --repo <path>...` behavior remains compatible.
- Repository credentials and bearer tokens remain in session-scoped storage only.

---

### Task 1: Dev coordinator with zero initial repositories

**Files:** `apps/cli/src/args.ts`, `apps/cli/src/main.ts`, `apps/cli/src/serve.ts`, `package.json`, `tests/integration/cli.test.ts`

- [x] Add a failing integration test for `pnpm dev`/dev service readiness with no repository and a JSON repository list.
- [x] Run the focused test and verify it fails because `assembleService` requires at least one path.
- [x] Add an explicit development-only zero-repository assembly mode; keep `open <path>` and `serve --repo` validation unchanged.
- [x] Add the `pnpm dev` coordinator/proxy lifecycle without changing production package entry behavior.
- [x] Run the focused CLI tests and `pnpm check`.
- [x] Commit `feat(cli): start repository launcher service`.

### Task 2: Typed launcher/recent contract and host actions

**Files:** `packages/git-contract/src/reads.ts`, `packages/git-contract/src/registry.ts`, `packages/host-node/src/http/router.ts`, `apps/web/src/lib/workbench/launcher-model.ts`, tests under `tests/contract`, `tests/integration`, `tests/unit`

- [x] Reuse the existing strict `registerRepository` contract for explicit Open/Recent reopen; no new browser authority or raw Git route is introduced.
- [x] Keep Recent records bounded in browser storage and create them only after a successful explicit registration; unavailable entries remain visible for explicit retry.
- [x] Reuse the existing authenticated repository-management route and scope checks for Open; Clone/Create continue through the existing typed mutation routes.
- [x] Run contract, host, and integration tests; existing schema artifacts remain unchanged because no new wire DTO was added.
- [x] Keep the host boundary narrow; no directory scan or implicit parent-root widening was added.

### Task 3: Pure launcher and tab state

**Files:** `apps/web/src/lib/workbench/launcher-model.ts`, `apps/web/src/lib/workbench/tabs-model.ts`, `apps/web/src/lib/workbench/queries.svelte.ts`, `apps/web/src/routes/+page.svelte`, `tests/unit/workbench-launcher.test.ts`, `tests/unit/workbench-tabs.test.ts`

- [x] Add failing tests for duplicate tab suppression, close-active selection, recent filtering, and active tab transitions.
- [x] Implement serializable launcher and tab models with one active repository and explicit revision changes.
- [x] Reset repository-specific History filters and inspectable selection when the active tab changes; query keys continue to include the active repository ID.
- [x] Run focused web unit tests and package checks.

### Task 4: GitKraken-style launcher and tabs UI

**Files:** `packages/git-ui/src/components/RepositoryLauncher.svelte`, `packages/git-ui/src/components/RepositoryTabs.svelte`, `apps/web/src/lib/components/workbench/RepositorySidebar.svelte`, `apps/web/src/routes/+page.svelte`, `tests/unit`, `tests/e2e/repository-launcher.spec.ts`

- [x] Build accessible Open/Clone/Create panels using existing design tokens and controlled callbacks.
- [x] Add searchable Recent list with unavailable-state copy and explicit retry/reopen action.
- [x] Add top-level tabs that retain the existing center History and right Inspector composition.
- [x] Run real Chromium validation against two local repositories: launcher, Open, Recent, New Tab, tab switching, and Clone/Create entry action.
- [x] Fix the existing `SectionCard` icon snippet rendering error exposed when the workbench sidebar mounts.

### Task 5: End-to-end gates and product evidence

**Files:** `docs/product/north-star.md`, `docs/installation.md`, `README.md`, `docs/evidence/2026-09-18-repository-launcher-tabs.md`

- [x] Update README and installation docs with `pnpm dev`, Open/Clone/Create, Recent, and multi-tab behavior.
- [x] Run `pnpm check`, `pnpm check:boundaries`, `pnpm check:contract`, `pnpm test:unit`, and `pnpm test:integration`.
- [x] Run `git diff --check`, inspect `git status`, and record unverified platforms explicitly in the final report.

## Completion Criteria

- `pnpm dev` opens a repository launcher without a preselected path.
- Open, Clone, Create, Recent, and explicit multi-repository tabs work in real Chromium.
- Switching tabs changes the active repository without leaking filters, cursors, selection, or authority.
- Existing local open, API-only serve, mutations, History, and security boundaries remain green.
