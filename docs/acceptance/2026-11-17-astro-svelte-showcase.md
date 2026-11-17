# Refyard Astro + Svelte Interactive Showcase — Acceptance Record

**Date:** 2026-11-17  
**Branch:** `feat/astro-svelte-showcase`  
**Scope:** `apps/docs`, shared UI affordance controls and sandbox tests.  
**Release:** Not pushed or deployed. Existing GitHub Pages/Cloudflare settings remain unchanged.

## What was built

- `/showcase/`: static, dark editorial product landing with motion-reduced alternatives, pointer spotlight styling (imperative `requestAnimationFrame`, never frame-driven Svelte updates), keyboard-selectable real `CommitGraph` over an actual `layoutGraph` result, and a real `DiffPanel` over contract-validated synthetic data. Separate features have distinct visuals and links to working docs and the demo.
- `/demo/`: static HTML host and one `client:only="svelte"` workbench island using the production `CommitList`, `CommitDetailPanel`, `DiffPanel` and `WorkingCopyPanel` components.
- 32 topologically ordered synthetic commits with a merge, distinct refs, valid commit details, bounded text patches and status snapshots. All state transitions live in a pure reducer. Stage, unstage, commit, search/select and reset are entirely in-memory.
- `discardAvailable`, `amendAvailable` and `wholeFileOnly` shared UI props default to existing production behavior; the demo hides destructive/unsupported actions. Mixed `MM` status cannot be collapsed into one whole-file stage operation.
- Existing docs homepage `/` and other Fumadocs routes are unchanged. Svelte and React islands coexist in Astro 7; no Starlight rewrite.

## Verification

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Node and package manager | PASS | Node 26.8.2, pnpm 11.25.0 |
| Contract/state tests | PASS | `tests/web-host/showcase-demo-state.test.ts`: valid DTOs, graph merge, selection, staging, untracked files, ambiguous states, simulated commit/reset |
| Shared working-copy policy tests | PASS | `tests/unit/working-copy.test.ts`: whole-file-only guards and existing grouping behavior |
| Static route build test | PASS | `tests/web-host/showcase-static-config.test.ts`: built `/`, `/showcase/`, `/demo/` |
| Combined targeted tests | PASS | 3 files, 10 tests; `vitest run` under Node 26 |
| Astro static build | PASS | 17 pages built including the two routes; `apps/docs/dist` generated |
| Svelte/TypeScript diagnostics | PASS (warnings) | 0 errors; 2 pre-existing accessibility warnings in `CommitList.svelte` |
| Portable package boundary | PASS | 3 packages, 69 source files, 202 test/script files |
| Desktop Chromium Playwright | BLOCKED | Container OS prevents Chromium's process-singleton socket (`Operation not permitted`); browser never launches, no app runtime assertion executed |
| Dia/Chrome/Safari/mobile visual QA | NOT RUN | Must be conducted in an interactive browser environment prior to release |
| Backend/API network isolation in browser | NOT RUN | Code inspection finds no Git client, fetch, credentials or backend import in the sandbox state/controller; runtime network assertion awaits browser QA |
| External deployment | NOT DONE | Existing apps, Pages workflow, custom domains and `wrangler.jsonc` preserved |

## Follow-up browser acceptance

1. In the repository, use pinned Node 26 and pnpm, then `pnpm --filter @refyard/docs dev:site` (or build and serve `apps/docs/dist`). Open `/showcase/` and `/demo/`.
2. On `/showcase/`, click a graph commit and use Arrow Up/Down with a row focused. Open Demo, Docs, Install. Check widths 375px/768px/1440px and `prefers-reduced-motion`.
3. On `/demo/`, select a history row; verify metadata, patch and OID correspond. Search and reset.
4. Switch to Working copy. Stage/unstage an unstaged file. Confirm the mixed `MM` example cannot be whole-file staged/unstaged. Verify Discard/Amend aren't offered.
5. Commit with a nonempty message: new commit appears at HEAD. Reset: all original staged/unstaged files and the 32-commit history return.
6. In DevTools Network, confirm no localhost/API/Git repository requests occur. Verify no rapidly flashing layout in Chrome/Safari while moving the pointer.

## Release decisions

- Site front door: `/` still belongs to existing Fumadocs. `/showcase/` and `/demo/` are additive routes under the docs site's domain. Decide whether the product homepage eventually moves to a separate domain or becomes the root.
- The branch is local and not pushed. Review and obtain explicit authorization before GitHub PR, deployment or DNS/Pages changes.
- The demo is illustrative only, not a claim about the state of any user's repository or the success of a real Git command.
