# Refyard Astro/Svelte Interactive Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dark product showcase and fully local interactive Git sandbox to the existing static Astro + Fumadocs site without changing the production Web App or documentation URLs.

**Architecture:** Add `@astrojs/svelte` to `apps/docs` and mount one real `@refyard/git-ui` workbench island at `/demo/`, backed by deterministic Git-contract DTOs and a pure reducer. Build the marketing page at `/showcase/` with Astro and focused Svelte visual components, retaining all current Fumadocs routes and the GitHub Pages configuration.

**Tech Stack:** Astro 7, Fumadocs/React island, Svelte 5, Tailwind v4, `@refyard/git-ui`, `@refyard/git-contract`, `@refyard/git-graph`, Vitest 4, pnpm 11.25.0.

**Spec:** `docs/superpowers/specs/2026-11-17-astro-svelte-showcase-design.md`

## Global Constraints

- Node 26.8.2 is the pinned repo runtime; pnpm 11.25.0. Do not claim a build verified under Node 26 if another version ran.
- TypeScript only for program files, short file responsibility header, no `any` / unsafe assertions, package imports by name, `tests/**/*.test.ts`.
- The existing docs root belongs to Fumadocs; new pages live at `/showcase/` and `/demo/` to avoid route conflicts.
- Never import `@refyard/git-service`, `@refyard/backend-http`, Tauri or native Git into demo. No local service requests, real Git mutations, auth/session, secrets or persistence.
- Keep `apps/docs/content/**`, `.github/workflows/docs.yml` and root `wrangler.jsonc` unmodified.
- Use exact, validated synthetic DTOs and `layoutGraph`, not fake SVG or a visual clone of the real workbench.
- MVP stage/unstage is whole-file only, with disjoint staged/unstaged paths; no discard, push, checkout or partial-hunk stage.
- No push/publish/deploy in this implementation branch; obtain a separate user decision before release.

## Review Focus

- A file with both `indexStatus` and `worktreeStatus` changed must never be silently moved as if its two Git layers were one. Test reducer rejection/no-op for mixed state.
- An empty or whitespace-only commit message must never create a new commit or clear staged files. Test it in reducer.
- Choosing an unknown OID/path must not throw, point a diff at another commit, or break graph correspondence. Test lookup and selection.
- Reset after stage/commit/filter must restore the original fixture without shared-object mutation. Test deep baseline equality.
- Static output for both new routes must load without Git/session/localhost calls and leave the existing docs root intact. Run build and network/asset checks.

---

### Task 1: Integrate Svelte with existing Astro docs

**Files:**
- Modify: `apps/docs/package.json` — add `@astrojs/svelte`, `svelte`, `@refyard/git-ui`, `@refyard/git-contract`, `@refyard/git-graph` workspace dependencies where appropriate.
- Modify: `pnpm-workspace.yaml` and `pnpm-lock.yaml` — pin integration and resolve packages.
- Modify: `apps/docs/astro.config.ts` — add `svelte()` while preserving React + MDX and site config.
- Modify: `apps/docs/src/styles/global.css` — import Git UI style/scan paths narrowly or create a page-scoped stylesheet to avoid docs collisions.
- Create: `apps/docs/src/pages/showcase/index.astro`, `apps/docs/src/pages/demo/index.astro` — isolated static pages with placeholders, no root route collision.
- Test: `tests/web-host/showcase-static-config.test.ts`.

**Interfaces:**
- Produces stable Astro routes `/showcase/` and `/demo/`, Svelte hydration support, workspace UI/DTO imports available in `apps/docs`.

- [ ] **Step 1: Write a failing integration test** that builds the Astro site in a disposable output directory and asserts URLs `/showcase/` and `/demo/` have usable static HTML, while the existing `/` docs HTML still exists. Treat the build process and output as the behavior under test, not source-text grep.
- [ ] **Step 2: Verify RED.** Run `pnpm exec vitest run tests/web-host/showcase-static-config.test.ts`; expected a failure because the new routes do not exist.
- [ ] **Step 3: Add the minimal Astro integration, dependencies and two semantic placeholder routes** using page-specific CSS rather than modifying the Fumadocs React shell. Do not create `src/pages/index.astro`.
- [ ] **Step 4: Verify GREEN** with the targeted Vitest test; run `pnpm --dir apps/docs build:site` and check generated `dist/showcase/index.html` and `dist/demo/index.html` as well as existing root.
- [ ] **Step 5: Commit** `feat(docs): enable Svelte sandbox routes`.

### Task 2: Deterministic demo fixtures and pure state machine

**Files:**
- Create: `apps/docs/src/lib/demo/fixtures.ts` — typed fixture factory and schema validation.
- Create: `apps/docs/src/lib/demo/reducer.ts` — pure `createDemoState`, `reduceDemoState`, typed `DemoAction`.
- Create: `apps/docs/src/lib/demo/selectors.ts` — selected commit, diff, status, layout and filtering.
- Test: `tests/web-host/showcase-demo-state.test.ts`.

**Interfaces:**
- `makeDemoFixture(): DemoFixture` contains `commits: readonly CommitSummary[]`, `status: StatusSnapshot`, `detailsByOid`, `diffsByOid` and refs.
- `createDemoState(fixture: DemoFixture): DemoState` returns a fresh state; `reduceDemoState(state: DemoState, action: DemoAction): DemoState` handles select, stage, unstage, commit and reset.
- `getDemoGraph(state: DemoState): LayoutResult` uses `layoutGraph` on `CommitSummary` converted via `oid -> id`, `parents -> parentIds`.
- `getSelectedDemoDiff(state: DemoState): DiffResponse | null` never mixes selected commit and patch data.

- [ ] **Step 1: Write failing Vitest cases** for contract-valid fixture, merge lane presence, staged/unstaged disjointness, select/unknown OID, stage→unstage, mixed-state non-operation, whitespace commit rejection, successful simulated commit (parent/HEAD/status), and full reset after changes.
- [ ] **Step 2: Verify RED** with `pnpm exec vitest run tests/web-host/showcase-demo-state.test.ts` due missing exports.
- [ ] **Step 3: Implement synthetic fixture factory** with 24–48 believable commits, at least two branch tips and one merge, bounded two-file patch examples and safely fictitious identity/path strings. Validate with exported `git-contract` schemas.
- [ ] **Step 4: Implement pure reducer and derived selectors**, stage only whole-file disjoint entries, construct synthetic commit/refs in memory, never import networking. Reset clones baseline rather than sharing mutated references.
- [ ] **Step 5: Verify GREEN** with targeted tests and `pnpm check:boundaries`.
- [ ] **Step 6: Commit** `feat(docs): model isolated Git sandbox state`.

### Task 3: Real Svelte Git Workbench island

**Files:**
- Create: `apps/docs/src/components/demo/DemoWorkbench.svelte` — composition root driven by Svelte 5 `$state`.
- Create: `apps/docs/src/components/demo/DemoToolbar.svelte` — sandbox label, reset, guided actions and docs/download links.
- Modify: `apps/docs/src/pages/demo/index.astro` — mount `<DemoWorkbench client:load />`.
- Modify (only if necessary): `packages/git-ui/src/components/WorkingCopyPanel.svelte` — optional `discardAvailable` default true to hide/disable unsafe demo action without affecting production.
- Test: `tests/web-host/showcase-demo-state.test.ts` plus `tests/unit/*` if shared UI behavior changes.

**Interfaces:**
- `DemoWorkbench` imports the **real** `CommitList`, `CommitDetailPanel`, `DiffPanel`, `WorkingCopyPanel`, uses `@refyard/git-graph` for rows.
- Browser callbacks call `reduceDemoState`; no production backend or fetch. Any additional change to `git-ui` is optional, backward-compatible and separately tested.

- [ ] **Step 1: Add a failing browser interaction test** that opens the built `/demo/`, clicks real UI rows and stage/unstage/commit/reset controls, and checks displayed commit and status changes; reject a demo that only looks interactive.
- [ ] **Step 2: Verify RED** with the targeted Playwright test (new page absent).
- [ ] **Step 3: Mount real components and bind state**; make history/detail/diff selected states coherent, stage/unstage update real status, simulate commit and reset. Label all mutations simulated.
- [ ] **Step 4: Exclude fake/destructive controls**; add `discardAvailable` only if inspection proves the existing component otherwise exposes active Discard in the sandbox.
- [ ] **Step 5: Verify GREEN** with targeted state and browser tests, Svelte/Astro type checking and static build. Confirm no Git network calls; if browser runtime is unavailable, report the browser test as blocked instead of inventing a pass.
- [ ] **Step 6: Commit** `feat(docs): mount real Git workbench sandbox`.

### Task 4: Distinctive animated marketing page

**Files:**
- Create: `apps/docs/src/components/showcase/HeroGraph.svelte` — true Git graph selection in an outer SVG.
- Create: `apps/docs/src/styles/showcase.css` — landing-only tokens, grid, responsiveness and reduced motion.
- Modify: `apps/docs/src/pages/showcase/index.astro` — semantic hero, capability stories, live preview, CTA, footer and metadata.
- Test: `tests/web-host/showcase-static-config.test.ts` and browser QA.

**Interfaces:**
- Landing reuses `@refyard/git-graph` and `@refyard/git-ui` for a hero view, never a decorative fake graph. Features use different true sections: history, diff and working copy. `/demo/` remains the full interactive experience.

- [ ] **Step 1: Add a failing Playwright content/interaction test** for heading, functional demo/docs/download navigation, keyboard interaction and reduced-motion behavior in the rendered landing page.
- [ ] **Step 2: Verify RED** with `pnpm exec vitest run tests/web-host/showcase-static-config.test.ts`.
- [ ] **Step 3: Build a distinctive dark Astro landing** with expressive hero graph, keyboard hints, refined technical typography, functional Demo CTA, three differentiated capability chapters, responsive layout, compact footer.
- [ ] **Step 4: Verify GREEN** targeted tests, static build, and visual browser QA if preview surface is available. Verify no Chrome flicker and no high-frequency Svelte re-render from pointer moves.
- [ ] **Step 5: Commit** `feat(docs): add animated Refyard project showcase`.

### Task 5: QA, documentation and preview readiness

**Files:**
- Modify: `apps/docs/content/docs/index.mdx` only if adding a *non-breaking link* to `/demo/` is appropriate; otherwise leave untouched.
- Create: `docs/acceptance/2026-11-17-astro-svelte-showcase.md` — explicit test matrix and pending deployment choices.

**Interfaces:**
- Source stays in the monorepo, build artifact remains `apps/docs/dist`, existing docs Pages workflow unchanged.

- [ ] **Step 1: Run targeted Vitest tests and `pnpm check:boundaries`**, record actual successes/failures.
- [ ] **Step 2: Run `pnpm --dir apps/docs build:site`**, inspect static root, `/showcase/`, `/demo/`, asset sizes and route links.
- [ ] **Step 3: Browser QA** desktop/mobile, keyboard, reduced motion and Chrome/Safari/Firefox if available; record `NOT RUN` otherwise, not `PASS`.
- [ ] **Step 4: Run broader repo checks/tests as practical**, record any environmental blockers and unaffected docs behavior.
- [ ] **Step 5: Write acceptance report**, no push/publish/deploy.
- [ ] **Step 6: Commit** `docs(docs): record interactive showcase acceptance`.

## Handoff / release boundary

The implementation remains on an isolated development branch. A real Site preview, GitHub push/PR, replacement of the docs root or Cloudflare deployment is a separate release decision, not part of this plan. Changes should be reviewed against this spec and verified before any public-facing update.
