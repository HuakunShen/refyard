# Refyard Homepage Full Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Refyard's documentation-root page with a polished product landing page containing a full, real-component, static interactive Git workbench.

**Architecture:** Astro owns the SEO-first landing page and Fumadocs routes. One Svelte 5 sandbox controller owns immutable multi-repository fixture state and renders `@refyard/git-ui` components in a full three-pane workbench both in-page and at `/demo/`. The static GitHub Pages deployment and separate actual web application remain unchanged.

**Tech Stack:** Astro 7, Svelte 5, TypeScript, Fumadocs React islands, Tailwind 4, `@refyard/git-ui`, `@refyard/git-contract`, `@refyard/git-graph`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-refyard-homepage-full-workbench-design.md`

## Global Constraints

- The embedded demo is entirely client-side, isolated, deterministic and unauthenticated; no Git/backend/API operations.
- Reuse real Git UI Svelte components for tabs, toolbar, history graph, working-copy, details and diff.
- Enabled controls must cause a meaningful local change; unsupported Git network or repository mutations must explain that they are unavailable.
- New canonical docs path is `/docs/`; previous deep URLs must keep working.
- Preserve the existing separate `refyard.huakun.tech` application and `docs.yml` GitHub Pages workflow.
- Respect reduced motion and keyboard focus; do not update component state per pointer frame.

## Review Focus

1. Switching repository after staging edits must retain that repository's state when returning (Task 2 test).
2. Filtering to an empty commit result must not leave an invalid selection or throw in graph layout (Task 2 test).
3. Stage-all must handle mixed index/worktree entries without silently pretending mixed paths were fully staged (Task 2 test).
4. Keyboard navigation must not steal arrows from focused inputs or textareas (Task 3 browser test).
5. Legacy docs links must still render after canonical prefixing; `/` must not collide with the index MDX route (Task 1 build test).

---

### Task 1: Move docs under `/docs/` without breaking deep links

**Files:**
- Modify: `apps/docs/src/lib/source.ts`
- Modify: `apps/docs/src/pages/[...slug].astro`
- Modify: `apps/docs/src/components/docs.tsx`
- Test: `tests/web-host/showcase-static-config.test.ts`

**Interfaces:**
- Produces canonical `source.getPageTree()` URLs prefixed with `/docs/`.
- Produces `/docs/`, `/docs/install/`, etc., plus preexisting `/install/`, `/workbench/history/`, etc.
- Consumes Fumadocs `source.getPages()` slugs without changing original documentation content IDs.

- [ ] **Step 1: Add failing route-source assertions** verifying source `baseUrl` and catch-all `getStaticPaths` produce docs and legacy paths; add a smoke assertion for old `/install/`.
- [ ] **Step 2: Run the focused Vitest**: `pnpm exec vitest run tests/web-host/showcase-static-config.test.ts`; expect the new assertions to fail.
- [ ] **Step 3: Implement canonical and legacy routes**: set `loader({baseUrl:'/docs'})`; `getStaticPaths` maps one index `/docs` and each non-index docs page to canonical and legacy paths. Strip `docs/` for `source.getPage(slugs)`. Add canonical link for legacy pages; docs brand navigation points to `/` and sidebar points to canonical `/docs/`.
- [ ] **Step 4: Build static docs**: `pnpm --dir apps/docs build:site`; verify `dist/docs/index.html`, `dist/docs/install/index.html`, `dist/install/index.html` exist and no `/` collision.
- [ ] **Step 5: Commit route changes**: `feat(docs): mount documentation at /docs`.

### Task 2: Add isolated multiple-repository sandbox state

**Files:**
- Modify: `apps/docs/src/lib/demo/fixtures.ts`
- Modify: `apps/docs/src/lib/demo/reducer.ts`
- Modify: `apps/docs/src/lib/demo/selectors.ts`
- Create: `apps/docs/src/lib/demo/workspace.ts`
- Test: `tests/web-host/showcase-demo-state.test.ts`

**Interfaces:**
- `makeDemoRepositories(): readonly DemoRepositoryFixture[]` creates three distinct, synthetic catalogue entries.
- `createDemoWorkspace(): DemoWorkspaceState` owns `activeRepositoryId`, open tab IDs and `{ [repositoryId]: DemoState }` snapshots.
- `reduceDemoWorkspace(state: DemoWorkspaceState, action: DemoWorkspaceAction): DemoWorkspaceState` dispatches select/open/close/reset/stage-all and wraps current `reduceDemoState` per repo.
- `getActiveDemoState(workspace: DemoWorkspaceState): DemoState` is the source for existing selectors and UI props.

- [ ] **Step 1: Add failing fixture/state tests** for three sample repositories, switched repository state retention, tab close/open, reset, empty search graph, stage-all, mixed status handling, commit reflected in active repository only.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/web-host/showcase-demo-state.test.ts`; expect failures for missing exports.
- [ ] **Step 3: Add typed immutable workspace reducer** without mutating real service state. Keep existing `DemoState` actions compatible with current `/demo/`; derive counts from the selected repository's status.
- [ ] **Step 4: Repeat focused tests**; inspect output for all PASS.
- [ ] **Step 5: Commit**: `feat(docs): add multi-repository demo sandbox state`.

### Task 3: Compose the complete real-component three-pane workbench

**Files:**
- Create: `apps/docs/src/components/demo/FullWorkbenchDemo.svelte`
- Create: `apps/docs/src/components/demo/DemoNavigation.svelte`
- Modify: `apps/docs/src/components/demo/DemoToolbar.svelte` (if needed to share a reset/display-only header)
- Modify: `apps/docs/src/pages/demo/index.astro`
- Modify: `apps/docs/src/styles/showcase.css`
- Test: `tests/site/showcase.spec.ts`

**Interfaces:**
- `FullWorkbenchDemo` accepts `mode?: 'embedded' | 'full'`; both modes own a separate fresh `DemoWorkspaceState`.
- Uses production `RepositoryTabs`, `WorkbenchToolbar`, `CommitList`, `WorkingCopyPanel`, `CommitDetailPanel`, `DiffPanel` directly.
- `DemoNavigation` accepts active ID, repo summaries, counts, select handlers; sections not supported by A are read-only or visibly disabled.
- Svelte inspector toggles selected `commit` or `file`, Escape closes, without dropping staged state or remounting history.

- [ ] **Step 1: Add browser acceptance cases** for three visible panes, tabs, simulated staging, file/commit detail, reset, and disabled remote toolbar. Add keyboard-input guard assertion.
- [ ] **Step 2: Run** `pnpm exec playwright test -c playwright.showcase.config.ts` and record baseline (or container browser restriction).
- [ ] **Step 3: Implement state wiring and three-pane layout** with existing component prop contracts; show a safety disclosure and independent scrolling; put inspector in dismissible drawer or bounded detail pane, not permanently in place of Working Copy.
- [ ] **Step 4: Run** `pnpm --dir apps/docs check`, `pnpm --dir apps/docs build:site`, and focused Playwright if browser starts.
- [ ] **Step 5: Commit**: `feat(docs): embed full Refyard Git workbench in sandbox`.

### Task 4: Promote showcase to the homepage and embed the workbench

**Files:**
- Create: `apps/docs/src/pages/index.astro`
- Modify: `apps/docs/src/pages/showcase/index.astro`
- Modify: `apps/docs/src/styles/showcase.css`
- Modify: `apps/docs/src/components/demo/DemoToolbar.svelte` for homepage/docs paths (if not in Task 3)
- Test: `tests/site/showcase.spec.ts`

**Interfaces:**
- The canonical home `/` has `#try-it` containing `FullWorkbenchDemo client:visible mode="embedded"` in a responsive full-width frame.
- `/demo/` uses `FullWorkbenchDemo client:only="svelte" mode="full"`.
- `/showcase/` remains a valid compat route/canonical alias; links for docs, install and source point to real destinations.

- [ ] **Step 1: Add failing static homepage tests** for title/canonical, `/docs/` CTA, `#try-it`, and Astro Svelte mount.
- [ ] **Step 2: Run relevant focused Vitest**; expect failures before the new root route.
- [ ] **Step 3: Reuse existing showcase content as root**; replace small isolated hero/feature mockups' demo CTA with anchor into a prominent interactive workbench section, while keeping distinct feature illustrations. Build compact responsive styles and reduced-motion fallback.
- [ ] **Step 4: Run static build and inspect generated home HTML** for SEO, interaction hydration bundle, canonical and navigation; test narrow/wide layouts where browser is available.
- [ ] **Step 5: Commit**: `feat(docs): make interactive workbench the homepage hero`.

### Task 5: End-to-end QA and GitHub Pages rollout

**Files:**
- Update: `docs/acceptance/2026-11-17-astro-svelte-showcase.md` or create a new dated acceptance report.
- Modify: tests above only as needed to close discovered coverage gaps.

**Interfaces:**
- Verified public `/`, `/docs/`, `/demo/`, and older deep links after GitHub Actions deployment.

- [ ] **Step 1: Run** targeted Vitest, `pnpm --dir apps/docs check`, `pnpm --dir apps/docs build:site`, boundary checker, and browser QA if permitted; document exact results.
- [ ] **Step 2: Review diff and preserve unrelated changes**: compare current `origin/main`; no force push, no unrelated workflow changes.
- [ ] **Step 3: Publish a feature branch/PR via authenticated GitHub connector**, merge when allowed (HK explicitly requested deployment), and monitor `docs.yml` build/deploy jobs.
- [ ] **Step 4: HTTP-check** `/`, `/docs/`, `/demo/`, and `/install/`; if Playwright cannot run due local sandbox restrictions, say so honestly.
- [ ] **Step 5: Report deployed URLs, PR, commit, workflow and remaining verification caveats**.
