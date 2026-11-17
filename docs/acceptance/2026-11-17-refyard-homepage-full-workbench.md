# Refyard Homepage · Full Svelte Workbench Acceptance

**Date:** 2026-11-17
**Scope:** Static Astro product home, Fumadocs canonical routes, production Svelte components running entirely on synthetic browser data.

## Delivered

- `/` is now the actual product landing page. Its `#try-it` section embeds the same full workbench used at `/demo/`.
- `/docs/` is the canonical docs index. Existing `/install/`, `/architecture/`, `/security/` and other deep URLs still render. `/showcase/` keeps an explicit static redirect to `/`.
- The demo renders real shared `RepositoryTabs`, `WorkbenchToolbar`, `CommitList`, `WorkingCopyPanel`, `CommitDetailPanel` and `DiffPanel` Svelte components.
- Three independent fictional repositories hold their own commit history, staged/unstaged state and branch context. Selecting a commit or file opens a diff/metadata inspector. Stage/unstage, stage eligible files, create a simulated commit, filter, reset, open/close tabs all stay within memory.
- The example has no Git host, auth credential, backend client or network request path. Unsupported Fetch/Pull/Push/Terminal controls are visibly disabled.
- Pointer animation is bounded by requestAnimationFrame and CSS; no React or Svelte state is updated per pointer frame. Focus-visible and reduced-motion styles exist.

## Verification

| Test | Observed outcome |
| --- | --- |
| `pnpm exec vitest run tests/web-host/showcase-demo-state.test.ts` | 12 passed; includes per-repository state isolation, `develop` branch simulated commits, mixed-index stage policy and empty search |
| `pnpm exec vitest run tests/web-host/showcase-static-config.test.ts tests/web-host/showcase-demo-state.test.ts` | Original run 12 passed; rerun with the new develop-branch regression adds one test |
| `pnpm --dir apps/docs check` | 0 errors; 2 existing warnings |
| `pnpm --dir apps/docs build:site` | Static build completed; 32 pages, including `/`, `/demo/`, `/showcase/`, `/docs/`, `/docs/install/` and legacy `/install/` |
| `pnpm exec playwright test -c playwright.showcase.config.ts` | Browser tests authored but NOT executed: the local Chromium headless executable was missing. Browser visual/runtime QA remains unverified. |

## Manual browser checks still required

1. Test the root `#try-it` and `/demo/` with Chrome/Dia and Safari. Switch repository tabs, stage one file, switch back, and verify the state is retained.
2. Click a commit and a working-copy file. Inspector should show real shared components and be dismissible via `Escape`.
3. Type into commit search and press arrow keys: text focus must remain in the input. Search with no results must not throw.
4. Compare wide 1440px, medium 900px and narrow 390px viewports. Narrow layout intentionally horizontally scrolls a complete workbench rather than hiding panes.
5. Confirm no real Git API or network requests and no rapid Chromium flicker; the local missing-browser result is not evidence for these checks.

## Release notes

Refyard's local browser app (`refyard.huakun.tech`), native clients and Git service are unaffected. The published docs URL is expected to remain `https://docs.refyard.huakun.tech/` through the existing `docs.yml` GitHub Pages workflow. Deployment verification is recorded separately after GitHub Actions has run.
