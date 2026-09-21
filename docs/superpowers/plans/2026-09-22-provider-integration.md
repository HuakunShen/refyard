# Provider integration implementation (P1: GitHub, read-only)

**Goal:** opt-in GitHub PAT connection, host-side REST reads, open-PR panel.
**Spec:** ../specs/2026-09-22-provider-integration-design.md
**Execution:** task-by-task with failing tests first; capability honesty throughout.

- [ ] PV01 Docs: this plan, the spec, north-star §8 (provider axis) + decision-log row +
      forbid line. Commit `docs(provider)`.
- [ ] PV02 Contract: `packages/git-contract/src/provider.ts` — provider connection
      status, connect/disconnect request schemas, pull-request DTO; register every public
      schema in `CONTRACT_SCHEMAS`; additive `providers: string[]` on
      `capabilitiesResponseSchema`; regenerate artifacts. Tests: schema round-trips,
      count/lockstep, JSON Schema export. Commit `feat(git-contract)`.
- [ ] PV03 git-provider package (new): `src/remotes.ts` — pure remote-URL →
      `{provider, owner, repo}` (https + scp-like; github.com only in P1), ported out of
      `git-ui/lib/avatars.ts` so there is one source; avatars.ts re-uses it. Wire the new
      package into the workspace + boundaries + tsconfig. Tests: parse matrix
      (positives, hostiles, non-GitHub). Commit `feat(git-provider)`.
- [ ] PV04 GitHub REST client: `packages/git-provider/src/github/rest.ts` —
      fetch-injected, base-URL injectable, User-Agent + api-version headers, GET /user
      and GET /repos/{owner}/{repo}/pulls, responses Zod-validated, errors classified
      (`unauthorized`, `forbidden`, `rateLimited`, `refused`, `malformed`, `network`).
      Tests: local `node:http` stub covering each class + pagination cap + header
      redaction on any error text. Commit `feat(git-provider)`.
- [ ] PV05 Host store + manager: `packages/host-node/src/provider/store.ts` (token file
      `provider/github.json`, mode 0600 in the 0700 state root, in-memory cache, parse-
      and-validate on load) and `manager.ts` (connect validates the token via the client
      before storing; disconnect deletes; journal records connect/disconnect without
      token bytes; status hides the token). `provider:manage` scope added to auth.ts and
      granted in the CLI's local session mint + test-service defaults.
      Tests: file mode assertions, round-trip, journal content excludes token.
      Commit `feat(host-node)`.
- [ ] PV06 HTTP surface: routes per spec §4 in `readRoutes()`/`actionRoute()` +
      `RESPONSE_SCHEMAS`; scope enforcement (`provider:manage` refused without grant);
      unknown `/api` paths still 404 JSON. Integration tests: connect→status→PRs happy
      path against stubbed upstream, connect with a bad token fails closed and stores
      nothing, disconnect removes, PRs without connection is a problem, no-GitHub-remote
      is `noProviderRemote`, session without `provider:manage` gets 403, token substring
      absent from every response body. Commit `feat(host-node)`.
- [ ] PV07 PR read service: host resolves the repository's remotes, picks the GitHub
      one (origin first) via `git-provider/remotes`, lists open PRs with a ~60 s TTL
      cache and age labeling; `capabilities.providers` assembled in `apps/cli/serve.ts`
      and `tests/support/service.ts`. Tests: origin preferred over a second GitHub
      remote; non-GitHub-only repo reports the problem; cache serves the second call
      without a second upstream hit. Commit `feat(host-node)`.
- [ ] PV08 Client + adapter: git-client provider methods (schema-validated like every
      read); `ProviderService` on `BackendSession` in git-service, implemented by
      backend-http only; Tauri adapter and Rust untouched. Tests: client unit tests with
      a stub fetch. Commit `feat(git-client)`.
- [ ] PV09 UI: `PullRequestsPanel.svelte` in git-ui (PR number/title/author avatar/
      head branch/updated, link-out, refresh, age of cached data); connect flow (token
      input never persisted browser-side, type=password) and a Connections section in
      SettingsDialog; capability-gated rendering in RepositorySidebar via
      `capabilities.providers`; workbench query with no background polling.
      Tests: component/e2e-level — panel absent without capability; connect dialog
      flow; PR rows render from stubbed upstream; no token in localStorage.
      Commit `feat(git-ui)` + `feat(web)`.
- [ ] PV10 Proof: full gates (`pnpm check`, `check:boundaries`, `check:contract`,
      `test:unit`, `test:integration`), rebuild web + CLI bundle, Playwright
      (Chromium; Firefox remains NOT RUN locally), acceptance matrix in
      `docs/acceptance/2026-09-22-provider-integration.md` with stub-vs-live labeling,
      manual live-GitHub check left to the owner as NOT RUN. Commit `docs(acceptance)`.

## Verification notes

(filled in as tasks complete — actual commands and exit statuses only, never planned
numbers; anything not exercised is named NOT RUN)

## Manual use

`refyard open <repo>` → create a fine-grained GitHub PAT with **Read access to
metadata and pull requests** for the repository → Workbench → Pull requests section →
paste token → the panel lists open PRs after the host validates it. Disconnect in
Settings → Connections.
