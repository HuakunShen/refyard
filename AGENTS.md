# Refyard — agent rules

Refyard is a browser-based Git workbench: a Node CLI (`refyard open|serve|pair|doctor`) serves an
authenticated loopback HTTP API plus a static SvelteKit SPA, and runs the machine's own `git`
against approved repositories. Pairing tickets are single-use and are minted only on trusted
local channels — the `p` keystroke on the serving terminal, or `refyard pair` over a
same-user-only control socket — never over HTTP. `refyard` is a working name only — it is **not** a published npm
package, domain, or organization. Never run a remote package that happens to share the name;
integration testing uses locally built tarballs.

**Design baseline (v2, 2026-09-14)** lives in `references/ai-chat/2026-09-14/`:
`START_HERE.md`, `MIGRATION.md`, `DESIGN.md`, `IMPLEMENTATION_PLAN.md`.
That package supersedes every earlier Rust-first plan; do not merge the two architectures.

Missing from the delivered package: `CONTRACT.md`, `ACCEPTANCE.md`, `HOST_PORTABILITY.md`,
`reference/contracts.ts`, `reference/test-harness.ts`. Their content is described inside
`DESIGN.md` and `IMPLEMENTATION_PLAN.md`; where a concrete schema or helper is needed it is
authored in this repository as the single source (`packages/git-contract`), never as a
near-duplicate type in two places.

## 0. Scope revision — 2026-09-18: native desktop and agentless SSH

On 2026-09-18 the user directed this repository to ship a **native desktop app** in addition to
the browser forms: Rust + Tauri 2, reusing the same Svelte components through a `BackendAdapter`,
with Git run by the target machine's own `git` and SSH run by the host machine's own OpenSSH.
The decision is closed — do not re-open the selection (no Wails/Go/Electron/Node-sidecar
comparison). The governing documents are:

- `docs/superpowers/specs/2026-09-18-native-desktop-ssh-design.md`
- `docs/superpowers/specs/2026-09-18-backend-adapter-contract.md`
- `docs/superpowers/plans/2026-09-18-native-desktop-ssh.md`
- `docs/acceptance/2026-09-18-native-desktop-ssh.md`

What this revision changes, exactly — and nothing more:

- §1's "one runtime for V1: Node" stays true **for the shipped browser, localhost and hosted
  forms**: the Node CLI, the loopback HTTP service, the Cloudflare static build and their tests
  must not regress. The clauses forbidding a native host ("no Rust/Axum", "no
  Electron/Tauri/Wails") are historical for those forms and no longer forbid the native desktop
  form. Node remains the only engine _inside_ the Node service; Rust is not a second engine there.
- The native **desktop product does not ship, carry, download, or require Node, Bun, Deno, or any
  other JS runtime**, and does not route its own backend traffic through localhost HTTP. Tauri
  commands/events carry UI↔host traffic; the Rust application service is a library with a native
  CLI, not a sidecar. Build-time JS tooling (pnpm, Vite, Vitest, bun scripts, SvelteKit) stays
  allowed — a build dependency is not a product runtime dependency.
- SSH uses the **host machine's** OpenSSH against the user's own `ssh_config`; the remote machine
  installs nothing, and no key bytes, passphrases, or raw argv cross the browser or plugin
  boundary.
- The plan's layout additions (`packages/git-service`, `packages/backend-http`,
  `packages/backend-tauri`, `apps/desktop`, `crates/refyard-{contract,core,host,http,cli}`) are
  the target layout for this workstream; §4 gains each path as it is created.

Everything else in this file — §2 safety rules, the scope/authorization model, fixture
isolation, capability honesty, the ban on fabricating evidence — is unchanged and still binding
on native code. In particular: the native host is **not** exempt from "one writer per common Git
directory", "unknown is a result", preview-fingerprint preconditions, or the rule that only
trusted code turns intentions into argv. Where the Rust implementation lags the Node one,
`capabilities` reports the gap; it never reports unimplemented work as supported.

## 1. Architecture — non-negotiable

```
Browser (SvelteKit static SPA)
      │  GitService: JSON DTO + HTTP + authenticated SSE
Node coordinator: auth, scope, jobs, journal, lifecycle
      │  trusted TypeScript Git Core: planners / parsers / workflows
      │  GitHostPort: commands, approved I/O, text codec, cancellation
Node adapters: process, filesystem, clock, crypto, private state
      │
system git CLI → the target machine's repo, credentials, hooks
```

- **Two different interfaces, never mixed.** `GitService` is the public, closed-semantic JSON API
  for browsers. `GitHostPort` is the private, scope-bound capability used only by trusted core
  inside the Node host. **Never expose `runGit(args, cwd)`, raw argv, shell, `cwd`, or `env` over
  HTTP, SSE, or any browser bridge.** The browser sends Git _intentions_; only trusted core turns
  intentions into argv.
- **One runtime for the browser forms: Node** (§0 covers the 2026-09-18 native scope revision).
  Development and releases are pinned to 26.8.2; the _published_
  `engines` range is `>=22 <27`, because the packaged CLI completes its real lifecycle on every
  line still supported (22, 24, 26 — measured on 22.11.0, 22.23.2, 24.10.0, 25.2.1, 26.8.2) and
  on 20.19.0 too, which the range excludes only because Node 20 is past its end of life. The Node
  service takes no second engine alongside it: no Bun backend, no QuickJS/JSC/WinUI, no native npm
  platform packages, no Electron/Tauri/Wails shell around the web UI, no built-in terminal.
  (The v2 design package says 24.x because that was the current major when it was written; on
  2026-09-14 the user directed this repository to Node 26 — same principle, one pinned major.
  The native desktop app is a separate binary per §0 that never loads the Node service, so it is
  not a second engine inside this one.)
- **Git Core is host-free.** `packages/git-core` and `packages/git-graph` must not import
  `node:*`, `bun:*`, DOM types, or use `Buffer`, `process`, `fetch`, `URL`, `TextEncoder`/
  `TextDecoder`, `AbortController`, `setTimeout`/`setInterval`, `Intl`, or implicit console output.
  Their tsconfig uses `lib: ["ES2022"]`, `types: []`. Production argv generation lives only in
  core planners; Node code never builds Git command arguments.
- **Status parsing is byte-safe.** Read stdout as bytes and unframe by format (NUL framing,
  `cat-file --batch` length headers). Never decode stdout to a string first, never `split('\n')`,
  never `trim()` protocol paths. OIDs are validated against the repository's detected object
  format (SHA-1 today, SHA-256 supported by parsers) — never hardcode 40 hex chars.
- **SvelteKit is routing only.** `adapter-static`, `fallback: 200.html`, `precompress`, and
  `ssr = false` in the root layout. No Git server routes, no `+page.server.ts`, no remote
  functions, no SSR of repository data.
- **Core UI in `packages/git-ui`** must not import `$app/*`; only `apps/web` owns SvelteKit
  composition, routing, and the connection config (so Kunkun can reuse the same components later).
- **All HTTP is authenticated**, reads included. Loopback only (default port 9595 — taken port,
  another free one is chosen and named; an explicit `--port` that is busy is refused; `--port 0` for
  tests). Exact `Origin`/`Host` checks, single-use bootstrap ticket exchanged for an in-memory
  bearer, JSON 404 for unknown `/api` paths, no CORS wildcard, no fallthrough to the SPA. The
  opted-in hosted-UI form (`docs/product/north-star.md` §5) is the only thing allowed to relax any
  of this, and only as an explicit origin allowlist plus password → session exchange — never by
  widening the default.
- **One writer per common Git directory** inside this service; the queue never claims to lock out
  an external IDE, terminal, or AI. Do not delete Git lock files, force operations, or disable
  hooks/host-key verification to make a test pass.

## 2. Safety rules that outrank convenience

- Every test that writes Git state uses an **isolated temporary repository** created by
  `tests/support/repo.ts` (own `HOME`, `GIT_CONFIG_GLOBAL`/`SYSTEM` pointed at scratch files, no
  network). Never run stage/commit/discard/stash/pop/worktree-remove/push experiments in this
  repository or any other real repository.
- Destructive operations (`discardTrackedPaths`, `removeWorktree`, stash `drop`/`pop`, branch
  delete) require explicit confirmation in the request, back up what can be lost first, and fail
  closed when a precondition cannot be verified. A backup failure means the operation does not run.
- Discard restores _tracked working-tree files to the index_ — never to HEAD, never untracked or
  ignored files, never `git clean`. It refuses symlinks/submodules/special types and paths whose
  bytes cannot be represented.
- Preview tokens bind a path's content fingerprint to a request; if the fingerprint changed the
  operation is stale and must be re-confirmed. `git status` markers alone are not proof of
  unchanged content.
- Preserve user hooks, signing config, filters, and SSH host verification. Never add `--no-verify`,
  never set `commit.gpgSign=false`, never rewrite global Git config.
- Bulk actions pre-check **all** paths: one unsupported/unrepresentable path rejects the whole
  batch before anything is written (no half-applied actions).
- Unknown results are reported as unknown. Git may have side effects even when the outcome is
  uncertain; never auto-retry a mutation, never label an uncertain result `succeeded`, and never
  continue a dependent write after an unresolved cleanup.
- Never fabricate evidence. Do not write plan budgets, expected numbers, or "should be" values as
  measured results. If a platform/browser/version was not exercised, it is unverified — say so.

## 3. Reference projects — what may be borrowed

Other Git clients are cloned under `references/open-source/` (symlinks into
`~/Dev/others`). `docs/reference-projects.md` records what is there, which licence
each carries, and which project to read for which question.

- **Green tier (MIT):** SourceGit, Lazygit, VS Code's SCM code, simple-git, GitUI,
  isomorphic-git. Read them freely; anything adapted must keep a header comment
  naming the source file and licence.
- **Yellow tier:** Gitron (PolyForm Noncommercial), GitButler (Fair Source), GitUp
  (GPLv3). **Read for ideas only — never copy code from these**, and restate any
  borrowed idea in prose first.
- Reading a reference is evidence of what works elsewhere, never evidence that this
  repository is correct. Cite the file you consulted; a test against real Git is
  still required.
- **Cheaper than reading everything:** for orientation use DeepWiki over `WebFetch`
  (`https://deepwiki.com/<owner>/<repo>`) and Context7 through the `find-docs`
  skill (`npx -y ctx7@latest library …` then `… docs …`) for library APIs such as
  Svelte 5, SvelteKit, Tailwind v4 and Vitest. Read local source only for the
  specific thing that must be exact.

## 4. Repository layout

```
apps/web/                  SvelteKit shell: routes, connection config, service worker (T07/T14)
apps/cli/                  argv parsing, doctor, open/serve lifecycle
apps/docs/                 the published documentation site: static Fumadocs-on-Astro build,
                           GitHub Pages via .github/workflows/docs.yml, served on the custom
                           domain docs.refyard.huakun.tech (CNAME file + Pages settings).
                           Build-time only — never a product runtime, and never a release gate.
packages/git-contract/     public Zod schemas, inferred DTOs, semantic validation (single source)
packages/git-core/         bytes/ parse/ plan/ workflows/ ports.ts — no host APIs
packages/git-graph/        pure-TS DAG lane layout + fixtures
packages/host-node/        process/ filesystem/ registry/ coordinator/ journal/ http/ + adapters
packages/git-client/       browser/Node HTTP + SSE client for GitService
packages/git-ui/           Svelte 5 components; injected GitService; no $app/*
packages/git-provider/     opt-in forge axis: remote->forge parser, GitHub REST client, device flow, ForgeAdapter
packages/npm-dist/         publication staging (T13)
scripts/                   TypeScript dev scripts (boundaries, contract, portable, pack, bench)
tests/{support,contract,core,node,integration,portable,graph,e2e,pack,security,compat,fixtures}
integrations/              hosts that embed Refyard rather than being Refyard: `kunkun/` and
                           `xross/`. Each is transport glue over the same packages and must not
                           grow a second Git engine.
docs/                      product/north-star.md, discussions/, plans/, goals/, evidence/, installation.md, browser-support.md
.repowiki/                 agent-maintained wiki and generated artifacts: en/content/ wiki pages,
                           en/meta/repowiki-metadata.json, en/diagrams/ diagram specs + HTML +
                           visual-check receipts. Wiki syncs and rendered diagrams (archify etc.)
                           go here — never new files loose at the repository root.
references/                the delivered v2 design package (read-only)
```

Native workstream paths (§0) — added as they are created:

```
packages/git-service/      transport-neutral TS service interfaces + BackendSession/BackendAdapter
packages/backend-http/     HTTP+SSE adapter over the existing git-client
packages/backend-tauri/    the only package allowed to import @tauri-apps/api
apps/desktop/              Tauri package; reuses apps/web's Svelte build, no forked pages
crates/refyard-contract/   Rust DTO projection of the checked-in JSON Schema
crates/refyard-core/       pure bytes/parsers/planners — no host APIs
crates/refyard-host/       Local/SSH execution providers, registry, jobs, journal, GitService
crates/refyard-http/       optional Axum adapter; never a dependency of the desktop crate
crates/refyard-cli/        native `refyard-native` doctor/open/serve
```

## 5. Toolchain

- **Node 26.8.2** (`.nvmrc`) for development and CI; `engines: { node: ">=22 <27" }` in the published
  package (measured, not aspirational).
- **pnpm 11.25.0** workspace (`pnpm-workspace.yaml`, `packages/*` + `apps/*`), `workspace:*` for
  internal deps, turborepo task orchestration.
- **TypeScript 7.0.2** (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `moduleResolution: bundler` for packages, `.js` extensions on relative imports). No `any`, no
  `as`/`as unknown as`, no `@ts-ignore`/`@ts-expect-error`; validate external input at the
  boundary (Zod) instead of casting.
- **Zod 4** is the single source of the public contract: `z.infer` for TS DTOs, `z.toJSONSchema`
  for JSON Schema. Schemas stay JSON-Schema-exportable (no `transform`/`custom`/`Date`/`Map`);
  cross-field rules live in `validate*.ts` with their own tests.
- **Vitest 4** for unit/integration; **Playwright** for e2e (added in T07/T14).
- **tsdown** (rolldown) for production bundles; a neutral IIFE build proves core portability.
  `esbuild` may be used where a plain neutral bundle is simpler.
- **bun 1.4.0** runs TypeScript dev scripts (`bun scripts/check-boundaries.ts`), never the product.
- **Rust 1.98.0** (edition 2021, `rust-version = "1.98"`) for the native workstream. One root Cargo
  workspace with `resolver = "2"`; default members are the headless crates so a CLI build never
  needs a WebView. Rust code follows the same discipline as the TypeScript: bytes in, bytes out,
  no `serde_json::Value` shortcuts around domain types, `deny_unknown_fields` on request payloads,
  and every response validated against the checked-in JSON Schema. The crate that a native host
  links must not depend on the HTTP adapter.
- **No raw JavaScript files.** Sources, scripts, and build configs are `.ts`/`.svelte`/`.json`/
  `.css`/`.md`. Generated build output is exempt; scripts are TypeScript run by bun or Node 24.
- **Formatting**: prettier (root, single `pnpm format`). Import order: node builtins, external,
  workspace, relative — type-only imports first in their group.
- **Workspace code is imported by package name.** Each package's `exports` maps `./*` to
  `./src/*.ts`, so a test or a script writes `@refyard/host-node/coordinator/jobs` instead of a
  path into `packages/host-node/src` — TypeScript sources are consumed directly, with no build
  step in between. `pnpm check:boundaries` fails on a relative reach-in.

## 6. Commandments for every task

1. Work task by task (T01…T15). For each: write the failing test first, prove it fails for the
   right reason, implement the minimum, run the listed verification, then commit only that task's
   files with the message the plan specifies.
2. Never weaken an assertion, delete a test, or flip a result to make a suite pass. If a check
   cannot pass, report the evidence and stop that thread.
3. Root script contract (implemented in T01, kept true afterwards):
   `pnpm check`, `pnpm check:boundaries`, `pnpm check:contract`, `pnpm test:unit`,
   `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:compat`, `pnpm test:portable`, `pnpm build`, `pnpm pack:smoke`,
   `pnpm bench:runtime`.
4. Every source file starts with a short module header saying what it is responsible for (JSON
   config and lockfiles exempt). Comments explain constraints the code cannot show — never narrate
   the next line, never record task IDs as justification.
5. Tests: `tests/**/*.test.ts`, behaviour-named cases, each failure case carrying a comment that
   states the real-world failure it prevents. Fixtures are typed factories, not shared magic.
6. Conventional Commits, scope = package or app. One logical change per commit. Do not push,
   publish, or deploy; do not commit unrelated work; `references/` stays untracked.
7. Definition of done for a task: its verification commands were actually run, the exit status is
   reported, and any unverified platform/version is named. "Code written" is not "tested".

## 7. Current execution scope

The active workstream is the native desktop and agentless SSH plan
(`docs/superpowers/plans/2026-09-18-native-desktop-ssh.md`), executed task by task — D00…D14 for
the first four deliverables (local App, SSH reads, stage/unstage/commit, native CLI + acceptance),
then P01…P05 for full parity. Its acceptance matrix is
`docs/acceptance/2026-09-18-native-desktop-ssh.md`; every cell is reported as PASS, PARTIAL,
BLOCKED, or NOT RUN, and BLOCKED is never written as PASS.

The earlier T01–T15 rounds (`docs/goals/`) remain historical: T01–T07 shipped the read-only M1
loop, and their behaviour is a regression target, not a scope limit. T16–T18 (Xross, Kunkun) stay
out of scope except for the reserved interfaces the native plan names. `capabilities` must simply
omit anything unimplemented — never report it as supported, never fake a `202`.

Product shape lives in `docs/product/north-star.md`: four usage forms (local workbench, managed
workspaces, opt-in hosted UI, embedded core) and the decisions that keep them compatible, plus the
scheduled direction for Hono/`hono-openapi`/Scalar and `@hono/mcp`. Read it before proposing a
change to who may reach the service, what core may import, or how repositories get approved; the
capability-honesty rule above applies to every form.
