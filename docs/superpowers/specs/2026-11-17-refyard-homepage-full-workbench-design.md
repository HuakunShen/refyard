# Refyard homepage and complete interactive workbench — design

Date: 2026-11-17
Status: **Approved by HK — 2026-11-17**
Decision: **Approach A**, selected by HK; complete visual workbench with meaningful client-side core actions, not a full Git simulator.

## Intent

The public entry point, `https://docs.refyard.huakun.tech/`, currently opens the Fumadocs introduction. The user wants a polished, Monio-style product homepage whose centerpiece is a **large, interactive Refyard workbench directly on that page**. It should resemble the actual Refyard screenshot: repository tabs and toolbar at top, repository navigation at left, history/graph in the middle, and the working-copy/staging composer at right. The current `/showcase/` landing page and `/demo/` two-view sandbox are too disconnected and incomplete.

The public demo remains **fully static** and uses deterministic example data, without credentials, Git access, a running service, or an external API. The actual application's `@refyard/git-ui` Svelte components must remain the functional backbone; the docs site provides only the demo state adapter and marketing shell.

## Goals

1. `/` is the canonical, attractive product homepage, with a recognizable Refyard brand, strong hero message, clear install/docs/GitHub navigation, restrained motion, and a prominently embedded complete workbench. There is no forced page transition before trying it.
2. The embedded workbench visually reads as the real product: **top repository tabs**, action toolbar, **left navigation and sample repositories**, **central graph/history**, and **right working copy** visible together on wide screens.
3. Users can switch between multiple fictional repositories, search and navigate commit history, select commits, read metadata and a real rendered patch, select changed files, stage/unstage, enter a message and create a simulated commit, and reset. Each action has a visible, coherent result.
4. Use real production Svelte components where their existing public props support it: `RepositoryTabs`, `WorkbenchToolbar`, `CommitList`/graph, `CommitDetailPanel`, `DiffPanel`, and `WorkingCopyPanel`. A small presentation-only navigation shell is permissible because the production `RepositorySidebar` requires live host queries/mutations.
5. Existing documentation and deep links continue to work. Canonical docs URLs become `/docs/…` and a docs landing page is accessible at `/docs/`; old non-root docs paths remain accessible during the transition.
6. The same complete demo can be opened full-screen at `/demo/`, using the same state owner/components instead of a divergent implementation.
7. The result statically builds and deploys through the existing GitHub Pages workflow without touching the separate `refyard.huakun.tech` application.

## Non-goals and anti-goals

- No virtual implementation of all Git semantics, remote network operations, clone, GitHub authentication, worktree management, or a local backend. That is the unselected Approach B.
- No fake success for unsupported operations. They are absent or explicitly disabled with an explanation; any enabled action must change the synthetic state truthfully.
- No use of the user's real screenshot paths, repo contents, tokens, identities, or local machine data in public fixtures.
- No replica of the entire application composition root or HTTP session stack inside the marketing site.
- No rerender-on-mousemove, heavy motion on the dense commit rows, or animations that interrupt keyboard or pointer input.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Full shell + core simulated actions** | Accurate product shape; real UI components; local, deterministic reducers. Explicitly bounded interactions. | **Chosen by HK** |
| B. Full Git simulator | Branch/merge/stash/worktree/network simulation could misrepresent real Git and requires a larger virtual backend/state model. | Deferred |
| C. Embed the real hosted workbench through an iframe | Depends on a running/pairing backend or special mock endpoint; conflicts with the static/no-credentials goal. | Rejected |

## Information architecture

```text
/
  Hero, primary CTA, trust markers
  #try-it — full-width embedded Svelte demo
  Why Refyard / product features / install CTA
/demo/                 Full-page version of the same demo
/docs/                 Fumadocs introduction
/docs/install/         Canonical guide pages
/docs/workbench/...    Canonical guide pages
/showcase/             Compatibility redirect or canonicalized alias to /
/install/ etc.         Backward-compatible existing guide pages
```

Implementation direction: keep Astro as the host, `@astrojs/svelte` for the interactive demo, and Fumadocs React islands for the docs. Set the Fumadocs content source base URL to `/docs` and generate canonical `/docs/...` routes. Preserve legacy non-root routes by also emitting their existing static pages, with a canonical URL pointing to `/docs/...` (or static redirects where tested); remove only the documentation claim on `/` so the new `index.astro` can own it. Update global marketing/navigation/docs links accordingly; all routes must remain compatible with GitHub Pages' root custom domain.

## Homepage composition

1. **Navigation:** Refyard wordmark/logo, Features, Live Demo (anchors to `#try-it`), Docs, GitHub, Download.
2. **Hero:** concise product positioning with visually restrained pointer/scroll response and clear local-first/no-upload message. The existing `/showcase/` typography, colors and feature copy are starting assets, not a mandatory exact layout.
3. **Interactive centerpiece:** a wide, framed desktop window, with a visible `DEMO / LOCAL-ONLY` badge and short instruction. Target a generous readable width, not a tiny marketing-card screenshot. Support an optional full-screen link; keep the interaction embedded by default.
4. **Explanations:** graph, diff, working-copy and local-first stories, with distinct visual content rather than repeated placeholder figures.
5. **Close:** install, documentation, source repository, and privacy/security information.

### Workbench composition

```text
┌─────────────────────────────────────────────────────────────────────┐
│  repository tabs …           sample branch / LOCAL DEMO / reset      │
├─────────────────────────────────────────────────────────────────────┤
│  stage all  |  fetch/pull/push (disabled: requires real Git)         │
├───────────────┬───────────────────────────────┬─────────────────────┤
│ Repositories  │ History [search]              │ Working Copy        │
│ Working Copy  │ Branch / graph / commit rows  │ Unstaged files      │
│ Branches      │                               │ Staged files        │
│ Remotes       │                               │ Commit composer     │
│ Worktrees     │                               │                     │
├───────────────┴───────────────────────────────┴─────────────────────┤
│ Inspector drawer/pane (opened by a commit or file selection):      │
│ real CommitDetailPanel / DiffPanel; close to restore main view     │
└─────────────────────────────────────────────────────────────────────┘
```

The inspector must not permanently displace the right-hand working-copy column. The left sidebar's unsupported sections may present clearly read-only fixture summaries, but cannot contain inert action buttons that look enabled. The top `WorkbenchToolbar` should expose `Stage all` and other genuinely supported client-side actions, while remote commands are visibly unavailable in Sandbox mode.

## State and data design

- One Svelte state owner (`FullWorkbenchDemo`) renders the same component in both marketing and full-page contexts. No React state bridge, iframe, external store, request client or session credentials.
- Extend the current typed `makeDemoFixture` / `DemoState` / `reduceDemoState` / selectors with an immutable **multi-repository fixture catalogue**. Each repository has its own commit history, status, branch metadata and selection; switching tabs does not destroy its local working state. Use fictional names/paths such as `atlas-editor`, `sample-api`, `design-system`.
- Fixture content is validated with `@refyard/git-contract`; the graph is derived with the actual `@refyard/git-graph` layout. Keep commit IDs and file IDs stable across rerenders. In-memory state resets on browser reload or explicit Reset.
- Allowed actions: repository switch/open/close (within preset catalogue), commit select, keyboard up/down, text filter, file select, stage, unstage, stage all, commit, reset; optionally a locally simulated stash **only if** implemented as a truthful reducer operation. No promises of network effects.
- Commit creation updates both the selected repository's history and status, with an inspectable synthetic detail/diff. Disabled actions explain the real-app-only dependency.
- A selected commit/file opens the inspector and defaults to a meaningful patch. Closing the inspector returns to the same list scroll and working-copy state.

## Responsive behavior and motion

- Desktop: a proper three-pane frame, large enough to read and click; sticky/contained action areas and independent scrolling for long history and working-copy lists.
- Tablet: collapsible navigation and inspector with center/right priority. Mobile: labelled view switcher or accessible horizontal workbench viewport, plus a clear full-screen demo CTA; never silently clip inaccessible controls.
- Avoid per-commit enter animations and component remounts on selection; keep CSS transitions to short opacity/transform for landing decorations and drawer open/close. Honour `prefers-reduced-motion`.
- Pointer glow is throttled with `requestAnimationFrame` and writes CSS variables directly, without Svelte state updates per frame. Keep dense tables, code and keyboard focus stable (explicit attention to prior Chrome flashing report).
- Keyboard: ArrowUp/ArrowDown on history only; do not steal input keys. Escape closes inspector. Visible focus, ARIA labels and an honest read-only status are required.

## Test and deployment acceptance

1. `/` returns a marketing homepage rather than the Fumadocs article, renders the full workbench in-page, and links to docs/install/source.
2. `/docs/` and canonical nested guides build, and preexisting `/install/`, `/security/`, `/workbench/...` deep links still resolve. `/demo/` and `/showcase/` remain useful/non-broken.
3. A smoke path works: select repo B → select commit → view patch → close inspector → stage a file → commit → new history entry appears → reset restores fixtures; switching back preserves repo A's state.
4. Assertions verify all enabled controls do something meaningful, unsupported controls clearly explain limitations, and no API/fetch requests are made by Sandbox operations.
5. Static production build, Svelte/TypeScript checks, relevant reducer/selector tests, desktop/mobile browser interaction test, and reduced-motion test pass. If container browser execution is restricted, label that unverified and use an available browser plugin or manual QA before claiming it passed.
6. Stage changes in a PR, compare to current `main`, merge only when authorized, watch the existing `docs.yml` GitHub Pages workflow, and verify `/`, `/docs/`, and `/demo/` publicly return 200 with appropriate content.

## Implementation boundaries

Expected additions and changes are confined primarily to `apps/docs` routes, showcase styling, Svelte demo host and fixture/reducer tests. Modify `packages/git-ui` only for small, backward-compatible presentational API improvements with existing app regression tests. Keep root application and backend packages untouched.

## Approval

HK selected Approach A in conversation and subsequently explicitly authorized implementation and deployment. This document describes the route transition, visual layout, functional boundary and verification criteria.
