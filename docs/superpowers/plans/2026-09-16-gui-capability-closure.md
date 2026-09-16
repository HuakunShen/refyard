# GUI Capability Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Expose the already implemented `setBranchUpstream` and `updateRemote` operations safely in the Git GUI so the client no longer claims backend capabilities users cannot invoke.

**Architecture:** `BranchPanel` and `RemotePanel` remain presentation-only components that emit closed semantic callbacks. The page translates those callbacks into the existing mutation contract. Upstream choices are restricted to remote-tracking refs already returned by `RefsSnapshot`; remote URL edits never round-trip redacted display URLs back to Git.

**Tech Stack:** Svelte 5, TypeScript, existing GitService mutation contract, Playwright, Vitest.

**Spec:** `docs/product/git-client-direction.md`

## Global Constraints

- No raw Git argv or arbitrary ref string crosses from the browser.
- Upstream selection is built from `refs.remoteBranches`; the browser cannot invent a target outside the observed refs.
- Remote names may be prefilled because they are non-secret. Fetch/push URL inputs start empty; empty means “leave unchanged”.
- Redacted `fetchUrlDisplay` / `pushUrlDisplay` are display-only and must never be submitted as replacement URLs.
- `updateRemote.pushUrl: null` means unchanged in the current implementation; the contract description must say so.
- Existing confirmation and mutation-follow behavior stays unchanged.

---

### Task 1: Branch upstream GUI

**Files:**

- Modify: `packages/git-ui/src/components/BranchPanel.svelte`
- Modify: `apps/web/src/routes/+page.svelte`
- Modify: `tests/e2e/branch.spec.ts`

**Interfaces:**

- `BranchPanel` produces `onSetUpstream(branchName, upstream)` where `upstream` is `{ remoteName, branchName } | null`.
- The page maps it to `setBranchUpstream` on repository target.

- [x] Add an E2E case that seeds `origin/main`, chooses it as `main`'s upstream, verifies Git config on disk, then clears it.
- [x] Run the focused Chromium case and prove it fails because the GUI control is absent.
- [x] Add an upstream editor/select using observed remote branches only.
- [x] Add the page mutation handler and wire the prop.
- [x] Re-run focused E2E, `pnpm check`, and branch Chromium suite.
- [x] Commit `feat(web): expose branch upstream controls`.

### Task 2: Remote edit GUI

**Files:**

- Modify: `packages/git-ui/src/components/RemotePanel.svelte`
- Modify: `apps/web/src/routes/+page.svelte`
- Modify: `packages/git-contract/src/operations.ts`
- Test: `tests/e2e/branch.spec.ts`
- Test: `tests/contract/schema.test.ts`

**Interfaces:**

- `RemotePanel` produces `onUpdate(remoteName, { newName, fetchUrl, pushUrl })` where each change is `string | null`; null means unchanged.
- The page maps it to the existing `updateRemote` mutation.
- Remote URL display props remain presentation-only and are never used as mutation input.

- [x] Add an E2E case that renames `origin` and changes its fetch URL through the panel, then verifies both on disk.
- [x] Run it RED because no edit control exists.
- [x] Add an edit form whose URL fields are blank-by-default and whose placeholders show the redacted current values.
- [x] Add page handler/wiring and fix the incorrect `pushUrl: null` contract description.
- [x] Re-run focused E2E, contract checks, and `pnpm check`.
- [x] Commit `feat(web): expose remote editing`.

## Final verification

- [x] `pnpm check`
- [x] `pnpm check:contract`
- [x] `pnpm test:unit`
- [x] `pnpm test:integration`
- [x] `pnpm exec playwright test tests/e2e/branch.spec.ts --project=chromium`
- [x] `git diff --check`
