# Refyard Astro + Fumadocs + Svelte Showcase Design

**Status:** Approved direction from HK, 2026-11-17. Development branch only; do not publish or overwrite the production PWA.

## Intent

Give Refyard a compelling, dark developer-oriented product presentation and an authentic, browser-only Git sandbox. Demonstrate the same Svelte components shipped in the actual workbench, with deterministic interactive sample data and without reading visitors' files or contacting a Git service.

## Existing system and constraints

- `apps/docs` is Astro 7 + React-island Fumadocs with static Markdown/MDX, published independently at `docs.refyard.huakun.tech` via the existing GitHub Pages workflow.
- `apps/web` is the production SvelteKit PWA hosted by a Cloudflare Worker on `refyard.huakun.tech`. Its static assets and endpoint routes must remain untouched.
- `packages/git-ui` contains Svelte 5 `CommitList`, `CommitGraph`, `DiffPanel`, `CommitDetailPanel`, `WorkingCopyPanel`, and related components. `packages/git-graph` computes authentic DAG topology. `packages/git-contract` owns DTO validation.
- Existing docs root `/` is provided by `[...slug].astro` / `index.mdx`; a second `src/pages/index.astro` would collide. Preserve all existing docs routes, and add temporary standalone routes `/showcase/` and `/demo/`. A later hosting decision can move marketing to a dedicated domain without redirecting documentation.
- Repo `AGENTS.md` requires Node 26.8.2, pnpm 11.25.0, TypeScript and tests first, no raw JS source, no push/publish/deploy without explicit release authorization.

## Architecture chosen

Extend **the existing `apps/docs` Astro app**, adding the official `@astrojs/svelte` integration in parallel with `@astrojs/react`. Keep the Fumadocs React shell for documentation, but render marketing pages as Astro and the browser-only demo as one Svelte island. No Starlight migration, no second website framework, and no copied/fake workbench components.

`/showcase/` is a bespoke, semantic Astro page. Its hero uses a genuine Svelte graph component and its feature story links to `/demo/`. `/demo/` mounts one stateful `DemoWorkbench.svelte` with real `CommitList`, `CommitDetailPanel`, `DiffPanel`, and `WorkingCopyPanel`. The single composition root owns state and callbacks; no production `BackendSession`, native filesystem access, Tauri, or HTTP Git calls are imported.

## Sandbox data and actions

- Checked-in, synthetic Git history contains a visible merge, 3 branches/tags, believable commit subjects and small diffs. All authors use fictitious names and `example.invalid` emails. No secret, actual user repository, real relative private path, or user-host request is involved.
- Fixture contract follows the exports of `@refyard/git-contract`; history layout uses `@refyard/git-graph`. All SHA-1 example OIDs must be valid hex and parent relationships valid.
- Supported actions: select commit, inspect real diff, stage an entire unstaged file, unstage an entire staged file, write a simulated commit, reset. Staged and unstaged fixture paths are initially disjoint; mixed index+working-tree changes and partial-hunk staging are not simulated.
- Commit validation requires a nonempty message and at least one staged file. Success prepends a synthetic commit with the previous HEAD as parent, updates branch ref and graph, clears only staged changes, and reports explicitly that nothing was written to Git.
- Disable/hide destructive operations (discard, push, hard reset, branch checkout). A visible unsupported control may not silently do nothing.
- Reset restores immutable baseline and selection; reload starts fresh. No localStorage, cookies, or API calls are needed.

## Visual and experience direction

- Product-level color palette: deep graphite, off-white, sparse low-saturation mint-green accents; graph lane colors retain semantic variety. No purple brand gradient.
- Hero shows the *actual commit DAG*, with interactive selection and corresponding code/detail context; separate, genuinely different features demonstrate history, diff review and staged changes, not the same illustration with swapped text.
- Marketing navigation has prominent `Try interactive demo`, Docs, GitHub and Download calls-to-action, and honest sandbox labeling.
- CSS transform/opacity motion only where it adds meaning; pointer effects throttled by RAF and never update the whole Svelte list on `pointermove`.
- Desktop demo uses history + detail/diff + working copy; smaller screens use sequential tabs. It must be keyboard accessible and honor `prefers-reduced-motion`.
- Real `@refyard/git-ui/styles.css` and Tailwind source scans are included on the demo pages; isolate marketing CSS so it does not override Fumadocs semantics.

## Approaches considered

1. **Astro + Fumadocs + Svelte islands — selected.** No documentation migration; genuine components; static build; one existing app.
2. Astro + Starlight + Svelte — works, but replaces an already functioning docs system solely to reduce the React island.
3. Separate SvelteKit showcase — best for full-app interactions but adds another build/deploy surface and site, unnecessary while Astro can mount one cohesive Svelte sandbox.

## Non-goals

- Do not alter existing deployed root PWA or change docs canonical domain and existing paths.
- Do not run actual Git, pair local service, store data across visits, ship advanced Git mutations, or claim simulated work is real.
- Do not rebuild Fumadocs, reimplement Svelte component visuals, or pull a new animation component framework.

## Acceptance and QA

1. Astro static build succeeds; existing docs URLs retain generated HTML; `/showcase/index.html` and `/demo/index.html` are present.
2. Demo fixtures validate against `@refyard/git-contract`; DAG correct including a merge; stage / unstage / commit / reset tests green.
3. Real Svelte components are imported from `@refyard/git-ui` and not copied into `apps/docs`.
4. Browsing demo causes no Git/session/native API requests or external avatar requests; no real repository is touched.
5. Dark desktop and mobile layouts readable; keyboard focus works; reduced-motion works; Chrome/Safari/Firefox and route reload tested when browsers available.
6. Docs GitHub Pages workflow, Cloudflare PWA Worker config, published docs data and existing product code remain unchanged.

## Release decision deferred

This development iteration only creates and tests the static pages in the existing docs build. It does not deploy them. After HK signs off on a preview, decide whether the permanent landing home belongs on `www.refyard.huakun.tech`, `showcase.refyard.huakun.tech`, or a new path/front-door routing plan that preserves the existing app domain.
