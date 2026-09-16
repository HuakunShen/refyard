# Repository Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Refyard's permanently expanded stack of Git feature cards with one repository/object navigation sidebar whose active subview contains the existing working-copy, branch, remote, stash, tag, worktree, submodule, refs, or repository-management UI.

**Architecture:** Keep the desktop workbench three-pane: left navigation/subview, center history, right inspector. A small pure navigation state model decides which views are available and reconciles the active view when repository/capability state changes. An app-specific `RepositorySidebar.svelte` composes the existing Git UI panels; available panels stay mounted and inactive panels are hidden so draft/edit/confirmation state survives navigation changes.

**Tech Stack:** Svelte 5, TypeScript, existing `@refyard/git-ui` components, TanStack Query-backed workbench controllers, Vitest, Playwright.

**Spec:** `docs/product/git-client-direction.md` §§5–7 and §19 Phase C

## Global Constraints

- Do not change Git contracts, mutation kinds, auth scopes, service routes, or backend behavior.
- Do not implement history search/filtering, keyboard navigation, command palette, hunk staging, cherry-pick, revert, reset, or rebase in this plan.
- The center pane remains commit history/graph and the right pane remains the contextual inspector.
- Existing context menus remain available inside their corresponding sidebar views.
- Existing visible operation controls remain available; this pass changes organization, not feature discoverability by removal.
- Inactive but available sidebar views remain mounted and are hidden rather than destroyed so local editor/confirmation state survives navigation changes.
- Capability-gated views remain absent when the service cannot perform/read that object family.
- Working Copy is the default view when a repository is selected; Repositories is the default when no repository is selected.
- A now-unavailable active view must reconcile deterministically to Working Copy when possible, otherwise Repositories.

---

### Task 1: Define and test the sidebar navigation model

**Files:**

- Create: `apps/web/src/lib/workbench/sidebar-navigation.ts`
- Test: `tests/unit/workbench-sidebar-navigation.test.ts`

**Interfaces:**

- `SidebarViewId = "repositories" | "working-copy" | "branches" | "remotes" | "stashes" | "tags" | "worktrees" | "submodules" | "refs"`.
- `SidebarView = { id: SidebarViewId; label: string; count?: number; available: boolean }`.
- `SidebarAvailabilityInput` carries repository presence, capability flags and query counts only; it does not carry Svelte/TanStack objects.
- `availableSidebarViews(input)` returns views in fixed product order: Repositories, Working Copy, Branches or fallback Refs, Remotes, Stashes, Tags, Worktrees, Submodules.
- `createSidebarNavigationState()` returns `{ activeView: "repositories" }`.
- `reconcileSidebarNavigation(state, views, hasRepository)` selects Working Copy when possible after a repository appears and only falls back when the current view is unavailable.
- `selectSidebarView(state, viewId, views)` changes active view only when that view is available.

- [x] Write RED unit cases for repo-less default, Working Copy default after first repository selection, stable active view, capability hiding, refs fallback, counts/order, and fallback after the active capability disappears.
- [x] Implement the pure navigation model with no Svelte or DOM dependency.
- [x] Run the focused unit test and `pnpm check` under Node 26.
- [x] Commit `refactor(web): add sidebar navigation model`.

### Task 2: Add the reusable navigation list UI

**Files:**

- Create: `packages/git-ui/src/components/WorkbenchNav.svelte`
- Modify: `packages/git-ui/src/index.ts`
- Test: `tests/unit/workbench-sidebar-boundary.test.ts`

**Interfaces:**

- `WorkbenchNavItem = { id: string; label: string; count?: number; disabled?: boolean }`.
- `WorkbenchNav` takes `items`, `activeId`, `onSelect`, optional icon snippet callback, and `data-testid="workbench-nav"`.
- Each item exposes `data-testid="workbench-nav-${id}"`, `aria-current="page"` when active, and a bounded count badge when provided.
- The component is visual/navigation-only and has no Git knowledge.

- [x] Write a RED structural test that requires `WorkbenchNav.svelte` to exist and forbids the app page from retaining the old sequence of `SectionCard` titles for Branches/Remotes/Stashes/Tags/Worktrees/Submodules.
- [x] Implement `WorkbenchNav` using buttons and existing token classes; do not introduce a new UI dependency.
- [x] Export it from `@refyard/git-ui` and run `pnpm check`.
- [x] Keep the structural ownership test RED until Task 3 migrates the page.
- [x] Commit `feat(git-ui): add workbench navigation list`.

### Task 3: Extract the app-specific repository sidebar and migrate the page

**Files:**

- Create: `apps/web/src/lib/components/workbench/RepositorySidebar.svelte`
- Modify: `apps/web/src/lib/workbench/queries.svelte.ts`
- Modify: `apps/web/src/lib/workbench/mutations.svelte.ts`
- Modify: `apps/web/src/routes/+page.svelte`
- Test: `tests/unit/workbench-sidebar-boundary.test.ts`

**Interfaces:**

- Export `WorkbenchQueries = ReturnType<typeof createWorkbenchQueries>` and `WorkbenchMutations = ReturnType<typeof createWorkbenchMutations>` so the sidebar consumes stable controller contracts rather than duplicating prop types.
- `RepositorySidebar` receives `{ queries, mutations, selection, token, describeProblem }` plus the repository-selection transition callback where needed.
- It owns one `$state(createSidebarNavigationState())` and derives availability/counts from the supplied controllers.
- It renders the repository switcher/workspace management view and, when a repository exists, the Working Copy / Branches / Remotes / Stashes / Tags / Worktrees / Submodules / Refs views.
- The nav list stays visible above the subview body. Available subviews are all mounted; inactive ones receive `hidden`/`aria-hidden` rather than being conditionally destroyed by active-view selection.
- Capability `#if`s may still prevent mounting a view that the service does not support at all.
- Working Copy contains the current Changes, conflict, Stage & Commit UI in the same order and with the same callbacks/disabled rules.
- Repositories contains `RepositoryList`, `RepositoryPanel`, and `RepositoryAccessPanel` with the existing loading/error/empty states.

- [ ] Export the query/mutation controller return types.
- [ ] Move the current left-sidebar markup into `RepositorySidebar.svelte` without changing behavior or callbacks.
- [ ] Add navigation state/reconciliation and hide inactive available subviews without unmounting them.
- [ ] Replace the route's large `<aside>` body with `<RepositorySidebar ... />`; leave center and right panes unchanged.
- [ ] Make the structural ownership test GREEN: route-level code no longer owns the stacked Git feature cards.
- [ ] Run `pnpm check`, sidebar unit tests and `git diff --check`.
- [ ] Commit `refactor(web): add repository object sidebar`.

### Task 4: Verify navigation behavior and state preservation in Chromium

**Files:**

- Create: `tests/e2e/sidebar-navigation.spec.ts`

**Interfaces / scenarios:**

- A normal repository opens with Working Copy active and History still visible in the center.
- Repository navigation is always reachable and returns to the repository/workspace controls.
- Branches, Remotes, Stashes, Tags, Worktrees and Submodules appear only when their backing capability/read surface is available.
- Switching to Branches, starting a rename, leaving the view, and returning preserves the rename draft because BranchPanel remained mounted.
- Selecting a changed file in Working Copy still updates the right-side diff while center history remains present.
- Branch context menu remains functional after entering Branches through navigation.
- Navigation counts track the loaded repository state without becoming a second source of truth.

- [ ] Write the Chromium E2E file and prove at least the default-active test fails before the migrated sidebar bundle is used.
- [ ] Build/bundle and run the navigation spec against local same-origin mode.
- [ ] Fix only navigation/sidebar integration issues surfaced by the spec; do not redesign existing panels.
- [ ] Run the navigation spec plus `read-only.spec.ts`, `branch.spec.ts`, `staging.spec.ts`, `stash.spec.ts`, `workspace.spec.ts`, and `worktree.spec.ts` on Chromium.
- [ ] Commit `test(e2e): cover repository sidebar navigation`.

### Task 5: Update product status and run the full release-quality gate

**Files:**

- Modify: `docs/product/git-client-direction.md`
- Modify: `docs/superpowers/plans/2026-09-17-repository-sidebar-navigation.md`

- [ ] Mark Phase C item 1 as implemented and describe the mounted-but-hidden subview model; leave history search, keyboard/command palette and feedback work pending.
- [ ] Run Node 26 `pnpm check`.
- [ ] Run `pnpm check:contract` and confirm schema artifacts remain unchanged.
- [ ] Run `pnpm test:unit` and `pnpm test:integration`.
- [ ] Run a fresh `pnpm build`, `bun scripts/bundle-cli.ts`, and full `pnpm exec playwright test --project=chromium`.
- [ ] Run `git diff --check`, inspect `git status`, and confirm only intended files remain.
- [ ] Commit `docs(product): record repository sidebar navigation`.

## Completion Criteria

- The left pane is no longer a permanently expanded stack of feature cards.
- Repositories/Working Copy/Branches/Remotes/Stashes/Tags/Worktrees/Submodules (and Refs fallback) are explicit navigation destinations.
- Working Copy is the default for a selected repository; Repositories is the safe fallback without one.
- Switching sidebar destinations preserves mounted panel-local drafts and confirmations.
- Center history and right inspector behavior are unchanged.
- Context menus remain usable from the new object views.
- No Git/backend/security contract changes are introduced.
- Node 26 type/Svelte checks, contract check, unit, integration/security, full Chromium and diff check are all green.
