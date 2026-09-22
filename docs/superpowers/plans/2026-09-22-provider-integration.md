# Provider integration implementation (P1: GitHub, read-only)

**Goal:** opt-in GitHub PAT connection, host-side REST reads, open-PR panel.
**Spec:** ../specs/2026-09-22-provider-integration-design.md
**Execution:** task-by-task with failing tests first; capability honesty throughout.

- [x] PV01 Docs: this plan, the spec, north-star §8 (provider axis) + decision-log row +
      forbid line. Commit `docs(provider)`.
- [x] PV02 Contract: `packages/git-contract/src/provider.ts` — provider connection
      status, connect/disconnect request schemas, pull-request DTO; register every public
      schema in `CONTRACT_SCHEMAS`; additive `providers: string[]` on
      `capabilitiesResponseSchema`; regenerate artifacts. Tests: schema round-trips,
      count/lockstep, JSON Schema export. Commit `feat(git-contract)`.
- [x] PV03 git-provider package (new): `src/remotes.ts` — pure remote-URL →
      `{provider, owner, repo}` (https + scp-like; github.com only in P1), ported out of
      `git-ui/lib/avatars.ts` so there is one source; avatars.ts re-uses it. Wire the new
      package into the workspace + boundaries + tsconfig. Tests: parse matrix
      (positives, hostiles, non-GitHub). Commit `feat(git-provider)`.
- [x] PV04 GitHub REST client: `packages/git-provider/src/github/rest.ts` —
      fetch-injected, base-URL injectable, User-Agent + api-version headers, GET /user
      and GET /repos/{owner}/{repo}/pulls, responses Zod-validated, errors classified
      (`unauthorized`, `forbidden`, `rateLimited`, `refused`, `malformed`, `network`).
      Tests: local `node:http` stub covering each class + pagination cap + header
      redaction on any error text. Commit `feat(git-provider)`.
- [x] PV05 Host store + manager: `packages/host-node/src/provider/store.ts` (token file
      `provider/github.json`, mode 0600 in the 0700 state root, in-memory cache, parse-
      and-validate on load) and `manager.ts` (connect validates the token via the client
      before storing; disconnect deletes; journal records connect/disconnect without
      token bytes; status hides the token). `provider:manage` scope added to auth.ts and
      granted in the CLI's local session mint + test-service defaults.
      Tests: file mode assertions, round-trip, journal content excludes token.
      Commit `feat(host-node)`.
- [x] PV06 HTTP surface: routes per spec §4 in `readRoutes()`/`actionRoute()` +
      `RESPONSE_SCHEMAS`; scope enforcement (`provider:manage` refused without grant);
      unknown `/api` paths still 404 JSON. Integration tests: connect→status→PRs happy
      path against stubbed upstream, connect with a bad token fails closed and stores
      nothing, disconnect removes, PRs without connection is a problem, no-GitHub-remote
      is `noProviderRemote`, session without `provider:manage` gets 403, token substring
      absent from every response body. Commit `feat(host-node)`.
- [x] PV07 PR read service: host resolves the repository's remotes, picks the GitHub
      one (origin first) via `git-provider/remotes`, lists open PRs with a ~60 s TTL
      cache and age labeling; `capabilities.providers` assembled in `apps/cli/serve.ts`
      and `tests/support/service.ts`. Tests: origin preferred over a second GitHub
      remote; non-GitHub-only repo reports the problem; cache serves the second call
      without a second upstream hit. Commit `feat(host-node)`.
- [x] PV08 Client + adapter: git-client provider methods (schema-validated like every
      read); `ProviderService` on `BackendSession` in git-service, implemented by
      backend-http only; Tauri adapter and Rust untouched. Tests: client unit tests with
      a stub fetch. Commit `feat(git-client)`.
- [x] PV09 UI: `PullRequestsPanel.svelte` in git-ui (PR number/title/author avatar/
      head branch/updated, link-out, refresh, age of cached data); connect flow (token
      input never persisted browser-side, type=password) and a Connections section in
      SettingsDialog; capability-gated rendering in RepositorySidebar via
      `capabilities.providers`; workbench query with no background polling.
      Tests: component/e2e-level — panel absent without capability; connect dialog
      flow; PR rows render from stubbed upstream; no token in localStorage.
      Commit `feat(git-ui)` + `feat(web)`.
- [x] PV10 Proof: full gates (`pnpm check`, `check:boundaries`, `check:contract`,
      `test:unit`, `test:integration`), rebuild web + CLI bundle, Playwright
      (Chromium; Firefox remains NOT RUN locally), acceptance matrix in
      `docs/acceptance/2026-09-22-provider-integration.md` with stub-vs-live labeling,
      manual live-GitHub check left to the owner as NOT RUN. Commit `docs(acceptance)`.

## Verification notes

- `pnpm check`: exit 0 — 13/13 projects, svelte-check 0 errors (the web project counts
  once; the new git-provider project added one).
- `pnpm check:boundaries`: exit 0 — 3 portable packages / 68 source files (git-provider
  is deliberately NOT portable: it carries the fetch-based REST client).
- `pnpm check:contract`: exit 0 — artifacts match, 558 named schemas.
- `pnpm test:unit` (+ node + contract suites): 55 files / 550 tests, exit 0. Adds
  provider-remotes (11), provider-github-rest (13), provider-connections (8),
  provider contract (17), git-client provider transport (2), sidebar view gating (1).
- `pnpm test:integration`: 48 files / 526 tests, exit 0. Adds tests/integration/provider.test.ts
  (10 cases, stub upstream via tests/support/github-stub.ts).
- `cargo test --workspace`: 0 failed (no Rust changes this round — regression only).
- `pnpm build:web` + `bun scripts/bundle-cli.ts`: exit 0.
- Playwright Chromium: 73/75. New tests/e2e/provider.spec.ts 2/2. `offline.spec.ts:92`
  is the known pre-existing failure on clean main; `read-only.spec.ts:158` flaked under
  full-suite load and passed twice in isolation.
- Firefox: NOT RUN (cannot launch locally, known limitation).
- Live api.github.com from the product path: NOT RUN — owner manual step, recorded in
  the acceptance matrix (PV-Q).

## Findings

- The first e2e run failed with a blank page: the provider queries block referenced
  `selectedRepositoryId` above its declaration in queries.svelte.ts — a TDZ crash that
  only manifests at runtime in the bundle. Fixed by moving the block below the selection
  derivations; this is why PV-N/PV-O were verified only after the rebuild.
- `main()` in apps/cli builds runService options by explicit field picking, so the
  `REFYARD_PROVIDER_GITHUB_BASE_URL` env read in bin.ts was silently dropped until the
  field was added to MainIO and forwarded — the annotated-objects rule caught it only
  once the field existed on the interface. The seam is now exercised by the provider
  e2e, which drives the packaged CLI through it.
- Connections section inside SettingsDialog was deferred: the panel's own
  connect/disconnect covers P1, noted in the acceptance document.

## Manual use

`refyard open <repo>` → create a fine-grained GitHub PAT with **Read access to
metadata and pull requests** for the repository → Workbench → Pull requests section →
paste token → the panel lists open PRs after the host validates it. Disconnect in
Settings → Connections.
