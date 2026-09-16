# Local Workbench Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore `refyard open .` / `npx refyard .` as a one-command same-origin local Git GUI while retaining `refyard serve` as API-only and preserving the separately deployed hosted PWA.

**Architecture:** The built Svelte SPA is packaged beside the CLI bundle under `dist/web`. `open` resolves that packaged directory and passes it to the existing Node asset server; `serve` passes no web root unless an embedding caller explicitly supplies one. Both local and hosted forms continue to use the same `GitService`, pairing, repository grants, and static Svelte artifact.

**Tech Stack:** Node 26 development / Node >=22 <27 package target, TypeScript 7, SvelteKit static adapter, Hono-backed Node host, Vitest, Playwright, esbuild, pnpm.

**Spec:** `docs/product/git-client-direction.md`

## Global Constraints

- `packages/git-core` and `packages/git-graph` remain host-free; no new Node/DOM dependency crosses into core.
- Browsers send closed Git intentions; no raw argv, shell, cwd, or env crosses the public boundary.
- Local workbench binds loopback and keeps authenticated reads/writes.
- `serve` stays API-only by default and never silently opens a browser.
- Hosted PWA stays independently deployable from `apps/web` with exact-origin/password requirements unchanged.
- The same generated `apps/web/build` artifact is used for packaged local UI and Cloudflare deployment.
- Write a failing test and prove the intended failure before every production behavior change.

---

### Task 1: Make `open` select the packaged local web build

**Files:**

- Create: `apps/cli/src/web-root.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/serve.ts`
- Test: `tests/integration/cli.test.ts`

**Interfaces:**

- Produces: `localWebRoot(cliDirectory: string): Promise<string | null>`.
- `main()` passes that result as `webRoot` only for `command.kind === "open"`.
- `runService()` treats a non-null `webRoot` as local-workbench mode; `serve` remains API-only when it receives `null`.

- [x] **Step 1: Write failing CLI integration tests**
  - Add a temporary fake packaged CLI directory containing `web/200.html`.
  - Assert `main(["open", repo])` serves that shell at `/` and its printed status calls the UI local.
  - Assert `main(["serve", "--repo", repo, "--no-open"])` still returns JSON 404 at `/` and reports API-only.

- [x] **Step 2: Run the focused tests and verify RED**

```sh
pnpm exec vitest run tests/integration/cli.test.ts
```

Expected: the new `open` case fails because `main()` never passes `webRoot`; the existing/updated `serve` case stays green.

- [x] **Step 3: Implement packaged-web-root resolution**

```ts
export async function localWebRoot(
  cliDirectory: string,
): Promise<string | null> {
  const candidate = join(cliDirectory, "web");
  const info = await stat(candidate).catch(() => null);
  return info?.isDirectory() === true ? candidate : null;
}
```

`main()` resolves the directory for `open`; if missing, it fails with an actionable package-corruption message rather than silently degrading to API-only. `serve` does not resolve or require the UI.

- [x] **Step 4: Make runtime messaging distinguish local and API-only forms**
  - Local form prints that the bundled workbench is being served and uses the same-origin pairing URL.
  - API-only form keeps the current machine-readable semantics and hosted `--ui-origin` flow.

- [x] **Step 5: Run focused tests and `pnpm check`**

```sh
pnpm exec vitest run tests/integration/cli.test.ts
pnpm check
```

- [x] **Step 6: Commit**

```sh
git add apps/cli/src tests/integration/cli.test.ts
git commit -m "feat(cli): restore local workbench mode"
```

### Task 2: Package one copy of the static SPA beside the CLI

**Files:**

- Modify: `scripts/build-release.ts`
- Modify: `scripts/bundle-cli.ts`
- Modify: `tests/pack/installed.test.ts`
- Modify: `scripts/pack-smoke.ts`
- Test: `tests/pack/installed.test.ts`

**Interfaces:**

- Generated layout: `dist/cli.mjs`, `dist/build-info.json`, `dist/web/**`.
- `cliDirectory` for the bundled executable is `dist`, so Task 1 resolves `dist/web` identically in development and installed packages.

- [x] **Step 1: Write failing package-shape tests**
  - Require staged `dist/web/200.html` and the Svelte `_app` assets after `build:release`.
  - Replace the API-only package assertion with “ships one CLI plus its local SPA, no source tree/fixtures”.

- [x] **Step 2: Run RED against the current staged build**

```sh
pnpm exec vitest run tests/pack/installed.test.ts
```

Expected: fails because `dist/web` is absent.

- [x] **Step 3: Copy the already-built SPA in both bundlers**
  - `build-release.ts`: remove stale `dist/web`, then recursively copy `apps/web/build` to `packages/npm-dist/dist/web` after confirming `200.html` exists.
  - `bundle-cli.ts`: copy the same `apps/web/build` to `.refyard-dev/web` beside `.refyard-dev/cli.mjs`.
  - Do not produce a second web build; consume the one created by the root build pipeline.

- [x] **Step 4: Update pack smoke to verify local and API-only installed forms**
  - Start installed `refyard open <repo> --no-open --port 0 --json`; pair and assert GET `/` returns the SPA shell.
  - Separately start installed `refyard serve --repo <repo> --no-open --port 0 --json`; assert GET `/` remains JSON 404 and readiness says API-only.
  - Keep the unauthenticated API rejection check.

- [x] **Step 5: Build and verify**

```sh
pnpm build:release
pnpm exec vitest run tests/pack/installed.test.ts
pnpm pack:smoke
```

- [x] **Step 6: Commit**

```sh
git add scripts/build-release.ts scripts/bundle-cli.ts scripts/pack-smoke.ts tests/pack/installed.test.ts
git commit -m "feat(release): ship the local workbench"
```

### Task 3: Exercise local, API-only, and hosted UI as distinct product forms

**Files:**

- Modify: `tests/support/e2e-service.ts`
- Modify: `tests/e2e/read-only.spec.ts`
- Modify: `docs/installation.md`
- Modify: `docs/releasing.md`
- Modify: `README.md`
- Modify: `docs/product/north-star.md`
- Modify: `docs/evidence/release-matrix.md`

**Interfaces:**

- `startE2eService({ mode: "local" | "hosted", ... })` returns a browser-ready pairing URL.
- `local`: browser loads the CLI's own origin.
- `hosted`: current separate static UI authority + explicit `--allow-origin`/`--ui-origin` path.

- [x] **Step 1: Add an e2e local-mode case that fails with the old harness**
  - The case must launch `open` from the bundled CLI, open its same-origin pairing URL, and reach the repository workbench without a separate UI server.
  - Keep at least one existing hosted-mode case to prove Cloudflare-style separation still works.

- [x] **Step 2: Run the focused Chromium case and verify RED**

```sh
pnpm build
bun scripts/bundle-cli.ts
pnpm exec playwright test tests/e2e/read-only.spec.ts --project=chromium
```

- [x] **Step 3: Refactor the e2e service helper around explicit modes**
  - Local mode starts no auxiliary web server.
  - Hosted mode retains the current auxiliary static server and exact-origin pairing setup.
  - Both modes preserve isolated fixture HOME/config/state.

- [x] **Step 4: Update user and release documentation**
  - Default quick start: `npx refyard .` / installed `refyard open .`.
  - `refyard serve` documented as headless/API-only.
  - Hosted PWA documented as optional remote UI, not the only production UI.
  - Update the north-star Form 1 status and remove the contradictory Cloudflare-only wording.

- [x] **Step 5: Verify the three forms**

```sh
pnpm check
pnpm test:unit
pnpm test:integration
pnpm build:release
pnpm pack:smoke
pnpm exec playwright test tests/e2e/read-only.spec.ts --project=chromium
pnpm test:web-host
```

- [x] **Step 6: Commit**

```sh
git add tests/support/e2e-service.ts tests/e2e/read-only.spec.ts README.md docs/installation.md docs/releasing.md docs/product/north-star.md docs/evidence/release-matrix.md
git commit -m "docs(product): restore local workbench as default"
```

## Final verification for Phase A

- [x] `pnpm check`
- [x] `pnpm check:boundaries`
- [x] `pnpm check:contract`
- [x] `pnpm test:unit`
- [x] `pnpm test:integration`
- [x] `pnpm test:pack`
- [x] `pnpm test:portable`
- [x] `pnpm build:release`
- [x] `pnpm pack:smoke`
- [x] `pnpm test:e2e`
- [x] `pnpm test:compat`
- [x] Confirm `git status --short` contains only intended Phase A documentation/plan changes.
