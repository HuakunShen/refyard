# Public release and self-deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline task-by-task with the
> repository's TDD and verification rules. Each task ends with a focused commit before the next
> task begins.

**Goal:** Publish Refyard as an AGPLv3 public project with a tokenless npm release workflow, a
user-owned Cloudflare self-deploy path, and a README that demonstrates the real history UI.

**Architecture:** Keep the existing split intact: `ci.yml` verifies the repository, `publish.yml`
publishes only `packages/npm-dist`, and the Cloudflare Worker serves only the static SPA/PWA. A
root Workers adapter makes the monorepo consumable by Cloudflare's Deploy to Cloudflare button;
it does not add a remote Git API or upload repository contents.

**Tech Stack:** GitHub Actions, npm Trusted Publishing/OIDC, pnpm 11.25.0, Node 26.8.2,
Wrangler 4.132.0, Cloudflare Workers Static Assets, SvelteKit adapter-static, Vitest, and the
existing Refyard CLI/browser harness.

**Spec:** `docs/superpowers/specs/2026-09-16-public-release-and-self-deploy-design.md`

## Global Constraints

- The GitHub repository is `HuakunShen/refyard` and becomes public only after local verification.
- The repository and package use GNU Affero General Public License v3.0, SPDX `AGPL-3.0-only`.
- `.github/workflows/ci.yml` remains test-only; `.github/workflows/publish.yml` is the only npm publisher.
- npm Trusted Publisher is GitHub Actions + workflow filename `publish.yml` + environment `publish`.
- The first CI release is `v0.1.2`; npm `latest` is already `0.1.1` and versions are immutable.
- The publish workflow uses `contents: read` and `id-token: write`; it contains no npm token.
- The Worker contains no Git authority, API proxy, repository path, bearer, password, or upload path.
- Every Git-writing test uses the isolated repository helpers; the VS Code demo is read-only.
- Use `apply_patch` for source/doc edits, stage only named files, and use narrow conventional commits.
- Do not publish, push, change visibility, or create the release tag until all local gates pass.

### Task 1: License and package release identity

**Files:**
- Create: `LICENSE`
- Modify: `package.json`
- Modify: `packages/npm-dist/package.json`
- Modify: `packages/npm-dist/README.md`
- Test: `tests/pack/release-identity.test.ts`

**Interfaces:**
- Consumes: existing package manifest and pack smoke checks.
- Produces: `AGPL-3.0-only` metadata, a repository license file, and package repository metadata
  that points at `https://github.com/HuakunShen/refyard`.

- [ ] Write a failing release-identity test that reads the manifests and asserts the AGPL license,
  public repository URL, non-placeholder version `0.1.2`, and no `private` field in the publishable
  manifest.
- [ ] Run `pnpm exec vitest run tests/pack/release-identity.test.ts`; observe failure on the current
  `UNLICENSED`/`0.1.1` metadata.
- [ ] Add the complete GNU AGPLv3 license text, set both project/package metadata to
  `AGPL-3.0-only`, bump `packages/npm-dist` to `0.1.2`, add the exact GitHub repository metadata,
  and update the package README's license/release text.
- [ ] Run the focused test, `pnpm test:pack`, and `pnpm exec prettier --check` on changed text files.
- [ ] Commit only the task files with `chore(release): identify agpl package`.

### Task 2: Tokenless npm Trusted Publisher workflow

**Files:**
- Create: `.github/workflows/publish.yml`
- Create: `tests/workflow/publish-workflow.test.ts`
- Modify: `docs/releasing.md`

**Interfaces:**
- Consumes: `packages/npm-dist/package.json` from Task 1 and the `publish` GitHub environment.
- Produces: a tag-triggered workflow whose filename and environment exactly match npm Trusted
  Publisher configuration.

- [ ] Write a failing workflow contract test that reads `.github/workflows/publish.yml` and asserts
  `push.tags: v*`, job `environment: publish`, `permissions.contents: read`,
  `permissions.id-token: write`, `npm publish` in `packages/npm-dist`, the tag/version guard,
  and the absence of `NPM_TOKEN`/`NODE_AUTH_TOKEN` publish credentials.
- [ ] Run `pnpm exec vitest run tests/workflow/publish-workflow.test.ts`; observe the missing-file
  failure.
- [ ] Add the workflow with checkout, pnpm 11.25.0, Node from `.nvmrc`, Bun 1.4.0 for repository
  scripts, frozen install, release gates, `pnpm build:release`, `pnpm pack:smoke`, exact tag/version
  validation, and `npm publish` with OIDC permissions. Keep `ci.yml` untouched.
- [ ] Update `docs/releasing.md` from manual-first-release wording to the exact tag/Trusted
  Publisher procedure, including the one-time npm form fields and the no-token rule.
- [ ] Run the focused contract test, `pnpm check`, `pnpm test:pack`, and formatting/YAML syntax
  checks available in the repository.
- [ ] Commit only the workflow, its test, and release documentation with
  `ci(publish): add npm trusted publisher workflow`.

### Task 3: Root Cloudflare self-deploy adapter

**Files:**
- Create: `wrangler.jsonc`
- Create: `tests/web-host/self-deploy-config.test.ts`
- Modify: `package.json`
- Modify: `docs/installation.md`

**Interfaces:**
- Consumes: `apps/web/src/worker.ts`, `apps/web/build`, and the existing `apps/web` Wrangler
  configuration.
- Produces: root `wrangler.jsonc` with `main: ./apps/web/src/worker.ts`, assets directory
  `./apps/web/build`, binding `ASSETS`, SPA fallback, empty fail-closed `PUBLIC_API_ORIGINS`, and
  a root `deploy` script that builds the web app then runs root Wrangler.

- [ ] Write a failing config test that reads the root configuration and asserts its Worker entry,
  asset directory, SPA fallback, `ASSETS` binding, empty `PUBLIC_API_ORIGINS`, and root `deploy`
  script; the missing root file makes this fail before implementation.
- [ ] Run the focused test and observe the missing-file failure.
- [ ] Add the root configuration and scripts without changing the Worker security implementation;
  keep the existing direct `apps/web` deploy path working.
- [ ] Run the focused test, `pnpm --dir apps/web build`, and
  `pnpm exec wrangler deploy --dry-run --config wrangler.jsonc`.
- [ ] Document that the button deploys UI only and that the user owns the API/tunnel and
  `PUBLIC_API_ORIGINS` configuration.
- [ ] Commit only the root adapter, config test, and installation documentation with
  `feat(deploy): add cloudflare self deploy entrypoint`.

### Task 4: Read-only VS Code history demo capture

**Files:**
- Create: `docs/assets/vscode-history.png`
- Create: `tests/web-host/demo-asset.test.ts`

**Interfaces:**
- Consumes: the read-only local checkout `/Users/hk/Dev/others/vscode` and the real Refyard
  browser UI.
- Produces: a screenshot with a readable history graph and no repository mutation.

- [ ] Write a failing asset test asserting the README demo image exists and is non-empty.
- [ ] Run the focused test and observe the missing-asset failure.
- [ ] Start `pnpm cli serve --no-open --repo /Users/hk/Dev/others/vscode --json`, pair a real
  browser tab with the printed one-time ticket, open the history/graph view, and capture the
  visible page to `docs/assets/vscode-history.png`. Do not click mutation controls.
- [ ] Inspect the image dimensions and visually confirm that the graph, repository identity, and
  Refyard chrome are readable; stop the temporary service and verify it exits.
- [ ] Run the focused asset test and commit only the image/test with
  `docs(readme): capture complex history demo`.

### Task 5: README trust surface and badges

**Files:**
- Modify: `README.md`
- Modify: `docs/evidence/release-matrix.md` if its publication/deployment status wording is stale
- Test: `tests/web-host/readme-surface.test.ts`

**Interfaces:**
- Consumes: Task 1 package identity, Task 2 workflow, Task 3 deploy entry, and Task 4 image.
- Produces: a README with npm version/download badges, CI/license/deploy badges, the VS Code
  screenshot, AGPLv3 link, public release instructions, and an explicit no-upload trust model.

- [ ] Write a failing README-surface test for the exact badge URLs, official Cloudflare Deploy
  button URL, screenshot reference, AGPLv3 wording, and no-upload statement.
- [ ] Run the focused test and observe the missing-content failure.
- [ ] Rewrite the README's opening/status/usage/documentation sections around the product's visual
  hierarchy while preserving the architecture and safety rules. Add badges for `refyard`, npm
  monthly downloads, `ci.yml`, GitHub license, and Cloudflare deployment. Link the official
  `deploy.workers.cloudflare.com` button to the public repository. Label the screenshot as a
  public VS Code demo and explain that the Worker never receives Git data.
- [ ] Run the focused test, `pnpm exec prettier --check README.md`, `rtk rg` for the image reference,
  and `view_image` on `docs/assets/vscode-history.png` for visual inspection.
- [ ] Commit only the README and evidence text/test with `docs(readme): explain public self deploy`.

### Task 6: Full local release verification and external release

**Files:**
- Modify: `docs/plans/0005-refyard-v2-remaining-scope.md`
- Modify: `docs/goals/2026-09-16-remaining-scope.md`
- Modify: `docs/evidence/release-matrix.md`

**Interfaces:**
- Consumes: Tasks 1–5 and the user's authenticated GitHub/npm accounts.
- Produces: fresh local gate evidence, a public GitHub repository, and an npm `0.1.2` package
  published from the tagged GitHub Actions workflow.

- [ ] Run the complete local gate set: `pnpm check`, `pnpm check:boundaries`,
  `pnpm check:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:pack`,
  `pnpm test:portable`, `pnpm build:release`, `pnpm pack:smoke`, `pnpm test:e2e`,
  `pnpm test:compat`, and `pnpm --dir apps/web exec wrangler deploy --dry-run`.
- [ ] Inspect the final diff/status and update plan/goal/evidence with actual outputs only.
- [ ] Verify GitHub authentication, push the reviewed commits, and make `HuakunShen/refyard`
  public only at the user-authorized action point.
- [ ] Verify npm Trusted Publisher has GitHub Actions / `HuakunShen` / `refyard` / `publish.yml` /
  `publish`, with direct publish allowed.
- [ ] Create and push the exact annotated tag `v0.1.2`; wait for `publish.yml` to finish, inspect
  the GitHub run, and verify `npm view refyard version dist.integrity` plus provenance.
- [ ] Record final external evidence and leave unresolved platform gaps named honestly.
