# Git Context Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one reusable right-click action system to Refyard and expose context menus for commits, branches, working-copy paths, and remotes without bypassing existing confirmations or Git intention contracts.

**Architecture:** `@refyard/git-ui` owns a Bits UI `ContextMenu` primitive plus a small descriptor-driven `ContextActionMenu`. Existing panels build semantic action descriptors from their existing callbacks; the app continues to own Git mutations. Destructive menu items open explicit confirmation UI, while commit branch/tag actions open a bounded name dialog and submit the already-supported `startOid` / `targetOid` fields.

**Tech Stack:** Svelte 5, bits-ui 2.19.2, shadcn-svelte-compatible primitives, TypeScript, TanStack Query, Playwright, Vitest.

**Spec:** `docs/product/git-client-direction.md` §§11, 18 Phase C

## Global Constraints

- Do not add raw Git argv or a generic command surface.
- Do not add a new backend mutation kind; reuse the existing 35-operation contract.
- `Delete branch`, `Remove remote`, and `Discard path` remain explicitly confirmed before submission.
- Existing visible buttons remain during this pass; context menus are an additional daily-driver path, not a layout rewrite.
- Menu availability must reflect the same capability and state gates as the visible controls.
- `@refyard/git-ui` remains host-neutral: browser clipboard access is injected by the app rather than reached through globals in the package.
- Preserve current local/hosted workbench behavior and all existing E2E workflows.

---

### Task 1: Add the reusable context-menu action layer

**Files:**

- Create: `packages/git-ui/src/components/ui/context-menu/context-menu.svelte`
- Create: `packages/git-ui/src/components/ui/context-menu/context-menu-trigger.svelte`
- Create: `packages/git-ui/src/components/ui/context-menu/context-menu-content.svelte`
- Create: `packages/git-ui/src/components/ui/context-menu/context-menu-item.svelte`
- Create: `packages/git-ui/src/components/ui/context-menu/context-menu-separator.svelte`
- Create: `packages/git-ui/src/components/ui/context-menu/context-menu-portal.svelte`
- Create: `packages/git-ui/src/components/ui/context-menu/index.ts`
- Create: `packages/git-ui/src/components/ContextActionMenu.svelte`
- Create: `packages/git-ui/src/components/ConfirmDialog.svelte`
- Create: `packages/git-ui/src/lib/context-actions.ts`
- Modify: `packages/git-ui/src/index.ts`
- Test: `tests/unit/context-actions.test.ts`

**Interfaces:**

- `ContextAction = { kind: "action"; id: string; label: string; disabled?: boolean; destructive?: boolean; onSelect: () => void } | { kind: "separator"; id: string }`.
- `compactContextActions(actions)` removes leading/trailing/duplicate separators without changing action order.
- `ContextActionMenu` takes `actions`, a trigger `children` snippet, optional `triggerClass`, and optional `data-testid` prefix.
- `ConfirmDialog` takes `open`, title, description, confirm label, busy/disabled state, and `onConfirm`.

- [x] Write a RED unit test proving `compactContextActions` removes invalid separators but preserves disabled/destructive actions and callback identity.
- [x] Implement the action type and compaction helper.
- [x] Adapt the existing generated dropdown-menu wrappers to Bits UI `ContextMenu`, reusing the same visual tokens and portal behavior.
- [x] Implement `ContextActionMenu` and `ConfirmDialog` without Git-specific knowledge.
- [x] Export the new primitive and components from `@refyard/git-ui`.
- [x] Run `pnpm check` and the focused unit test.
- [x] Commit `feat(git-ui): add context action menu primitives`.

### Task 2: Add commit context actions

**Files:**

- Modify: `apps/web/src/lib/workbench/mutations.svelte.ts`
- Modify: `apps/web/src/routes/+page.svelte`
- Modify: `packages/git-ui/src/components/CommitList.svelte`
- Create: `packages/git-ui/src/components/CommitRefDialog.svelte`
- Test: `tests/unit/workbench-mutation-model.test.ts`
- Test: `tests/e2e/context-menu.spec.ts`

**Interfaces:**

- Extend branch creation to `onBranchCreate(branchName: string, startOid?: string | null)` while preserving the old one-argument call.
- Extend tag creation to `onTagCreate(tagName: string, annotation: string | null, targetOid?: string | null)` while preserving current callers.
- `CommitList` accepts optional `onCreateBranchAt(commit, branchName)`, `onCreateTagAt(commit, tagName, annotation)`, and `onCopyOid(commit)` callbacks plus `contextDisabled`.
- Commit menu actions are `Create Branch Here…`, `Create Tag Here…`, separator, `Copy SHA`.

- [ ] Write RED mutation-model/controller coverage proving a supplied commit OID reaches `createBranch.startOid` and `createTag.targetOid` rather than `null`.
- [ ] Write a RED Chromium case that right-clicks a commit row and expects the four commit actions.
- [ ] Implement optional OID parameters in the mutation controller with no contract change.
- [ ] Implement `CommitRefDialog` for a required name and optional tag annotation.
- [ ] Wrap each virtualized commit row in `ContextActionMenu`; add stable commit-row test ids.
- [ ] Wire the app callbacks, injecting clipboard write from the browser composition root.
- [ ] Extend the Chromium case to create a branch and tag at the selected historical commit and verify refs on disk/API; verify `Copy SHA` through Playwright clipboard permission when available.
- [ ] Run `pnpm check`, focused units, and the context-menu Chromium spec.
- [ ] Commit `feat(web): add commit context actions`.

### Task 3: Add branch context actions

**Files:**

- Modify: `packages/git-ui/src/components/BranchPanel.svelte`
- Test: `tests/e2e/context-menu.spec.ts`

**Interfaces:**

- Non-current branch menu: `Switch`, `Merge into Current`, separator, `Upstream…`, `Rename…`, separator, `Delete…`.
- Current branch menu omits Switch/Merge/Delete but keeps Upstream/Rename.
- `Rename…` and `Upstream…` reuse the panel's existing inline editors.
- `Delete…` opens `ConfirmDialog` and only `onConfirm` calls `onDelete`.

- [ ] Add RED Chromium expectations for current vs non-current branch menu availability.
- [ ] Build branch action descriptors from the existing branch state and callbacks.
- [ ] Add context triggers to branch rows without removing existing buttons.
- [ ] Add confirmed deletion through `ConfirmDialog`.
- [ ] Extend E2E to rename from the context menu and delete only after confirmation.
- [ ] Run `pnpm check` and Chromium branch/context-menu specs.
- [ ] Commit `feat(git-ui): add branch context actions`.

### Task 4: Add working-copy path context actions

**Files:**

- Modify: `packages/git-ui/src/components/StatusList.svelte`
- Modify: `apps/web/src/routes/+page.svelte`
- Test: `tests/e2e/context-menu.spec.ts`
- Test: `tests/e2e/staging.spec.ts`

**Interfaces:**

- `StatusList` gains optional `disabled`, `busy`, `onStage`, `onUnstage`, and `onDiscard` callbacks.
- Stage is enabled only for representable, non-ignored paths with working-tree content to stage (including untracked/conflicted paths).
- Unstage is enabled only for representable tracked paths whose index status is not `.`.
- Discard is enabled only for representable tracked paths with a working-tree change; it opens `ConfirmDialog` before calling `onDiscard([pathId])`.
- Selecting a context action must not silently change the multi-select state in `StagingPanel`.

- [ ] Add RED Chromium coverage for a modified path's Stage/Discard actions and a staged path's Unstage action.
- [ ] Add the optional action props and pure per-entry availability derivation in `StatusList`.
- [ ] Render the path context menu and confirmed discard flow.
- [ ] Wire existing mutation callbacks from the workbench page.
- [ ] Verify stage, unstage, and discard on real fixture files, including that discard requires the confirmation click.
- [ ] Run `pnpm check`, context-menu Chromium, and staging Chromium specs.
- [ ] Commit `feat(git-ui): add working-copy context actions`.

### Task 5: Add remote context actions and run the release-quality gate

**Files:**

- Modify: `packages/git-ui/src/components/RemotePanel.svelte`
- Test: `tests/e2e/context-menu.spec.ts`
- Modify: `docs/product/git-client-direction.md`

**Interfaces:**

- Remote menu: `Edit…`, separator, `Fetch`, `Pull (ff-only)` when a current branch exists, `Push <branch>` when a current branch exists, separator, `Remove…`.
- Actions always target the row's remote directly; they do not depend on the radio-selected remote.
- `Edit…` reuses the existing inline editor.
- `Remove…` opens `ConfirmDialog` and only confirms into `onRemove`.

- [ ] Add RED Chromium coverage for remote row actions and confirmed removal.
- [ ] Add the remote context menu using existing callbacks and current-branch state.
- [ ] Verify Edit opens the existing form, Fetch targets the clicked remote, and Remove does not run before confirmation.
- [ ] Update the product-direction Phase C status to record context menus as implemented while leaving sidebar/search/history work pending.
- [ ] Run `pnpm check`, `pnpm check:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm exec playwright test --project=chromium`, and `git diff --check`.
- [ ] Commit `feat(git-ui): add remote context actions`.

## Completion Criteria

- Right-click works on commit rows, branch rows, changed paths, and remote rows.
- All four surfaces use the same `ContextActionMenu` descriptor/rendering layer.
- Commit branch/tag creation can target an explicit commit without a new backend operation.
- Destructive context actions never skip a human confirmation step.
- Existing visible controls and all prior workflows remain available.
- Full Chromium E2E, unit, integration/security, type/Svelte checks, contract check, and diff check are green.
