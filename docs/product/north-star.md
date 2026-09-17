# North star — the forms Refyard is meant to take

> Status: living document, revision 0 — written 2026-09-15, from the user's 2026-09-15 direction.
> Authority: this file decides **product shape**. `AGENTS.md` decides how work is done;
> `docs/plans/0001-refyard-v2-m1-read-only.md` decides what the current task is. When a plan
> contradicts this file, this file is right and the plan is stale — correct the plan in the same
> change that would otherwise conflict with it.
> Evidence discipline: every "works today" claim below names the command that shows it. Anything
> not exercised on this machine is marked **unverified**, not implied.

## 1. One product, four forms

Refyard is a browser-native Git workbench: Git runs on the machine that owns the repository, the
UI is a static Svelte app, and a small Node service is the only thing that talks to `git`. That
sentence stays true in all four forms; what changes is **who reaches the service, from where, and
what they are allowed to ask for**.

| #   | Form                                    | Who runs    | Transport to the host          | Status                                                              |
| --- | --------------------------------------- | ----------- | ------------------------------ | ------------------------------------------------------------------- |
| 1   | Local workbench (default)               | one machine | loopback HTTP, ticket → bearer | **Implemented and packaged** — same-origin UI + Git service, see §3 |
| 2   | Managed workspaces (many repositories)  | one machine | same, plus a registration API  | **Implemented locally** — explicit register/revoke evidence in §4   |
| 3   | Hosted UI against a local host (opt-in) | two origins | cross-origin HTTP + password   | **Implemented locally; live deployment unverified**                 |
| 4   | Embedded core inside a native host      | no Node     | no HTTP at all                 | **Building it as a Rust + Tauri 2 host** — §6, revision 2026-09-18  |

Forms 1 and 2 are implemented locally. Form 3 remains an opt-in product decision. Form 4 was
decided to stay on Node on 2026-09-16; the user reversed that on 2026-09-18 and chose Rust +
Tauri 2 (§6 carries the revision, and the native plan is the authority for it).

## 2. The invariant spine (holds in every form)

These are not preferences; they are what makes the other forms possible at all. Breaking one to
ship a feature is the failure mode this file exists to prevent.

1. **Intentions cross boundaries; argv never does.** Only trusted core turns an intention into
   `git` arguments. No form — local, hosted, MCP, embedded — exposes `runGit(args)`, a shell, a
   `cwd`, or an `env` blob.
2. **Reads are authenticated too.** There is no "read is harmless" mode. A read names a repository
   and returns its history; that is already private data.
3. **Scope is granted, never assumed.** A session can address exactly the repositories a user
   approved for it, and each approval is recorded. No form discovers repositories by scanning.
4. **One writer per common Git directory** inside this service, and the queue never claims to lock
   out an external IDE, terminal, or AI.
5. **Uncertain is a result.** An operation whose outcome cannot be verified is reported as unknown
   and never retried implicitly, in every form.
6. **Core stays host-free.** `packages/git-core`, `packages/git-graph`, and the shapes in
   `packages/git-contract` do not import `node:*`, DOM types, or host globals — enforced by an AST
   check, not by intent (`pnpm check:boundaries`: 3 portable packages, 38 source files).
7. **HTTP is a transport, not the architecture.** `GitService` describes capabilities; today it is
   HTTP + SSE on loopback, later it may be a Kunkun plugin call or an in-process object. A feature
   that only makes sense over HTTP is a warning sign.

## 3. Form 1 — Local workbench (default, implemented and packaged)

```
refyard open ~/code/xross
   │ approves exactly that repository directory
   ├─ Node service on 127.0.0.1:9595 (loopback only, exact Host/Origin checks)
   ├─ single-use bootstrap ticket (60 s) in `?pair=`; legacy fragment accepted → bearer token
   ├─ static SvelteKit app served by the same service (one origin, so no CORS)
   └─ reads plus capability-gated Git mutations through the same closed intention contract
```

The packaged local form ships the static SPA beside the CLI. `refyard open` serves it from the
same loopback origin; `refyard serve` deliberately omits it and remains the API-only integration
form. The hosted PWA uses the same frontend source and GitService contract.

Evidence: `pnpm test:integration` (host, auth, reads), `pnpm test:portable`, and a curl smoke
against a Node-26-hosted service recorded in `docs/evidence/`.

**What must not change to make forms 2–4 easier:** the loopback default, the ticket → bearer
handshake, and the "one origin serves UI + API" property. Everything else is negotiable.

## 4. Form 2 — Managed workspaces (many repositories, GitKraken-like)

Goal: the CLI's directory is not the only repository. From the UI a user adds another directory on
the same machine, sees it in the repository list, and works with it in the same session — without
restarting the service or re-running the CLI.

Today the CLI approves **the repository directory itself** as the allowed root and grants the
session exactly that repository, deliberately: running the workbench in `~/projects/app` must not
hand over `~/projects`. Form 2 keeps that instinct and changes only the mechanism:

- **Registration is an explicit, user-initiated act.** A candidate path is checked to be inside an
  already-approved root, or the user approves a new root for it. There is no directory walk, no
  "recent repositories" scan of `$HOME`, no implicit widening.
- **The grant grows by approval, not by code path.** The session's scope becomes a list; each
  addition is journaled with the path, the root it was approved under, and when. Revocation must be
  possible for the same reason.
- **The UI never invents a repository.** A registration that fails validation (not a repository,
  inside a Git dir, unreadable, unsupported encoding, already registered) returns a problem the UI
  shows as itself, and the list stays as it was.
- **One writer per common directory still holds** across every registered repository; the queue
  keys on the common Git dir, not on the session.
- **A live worktree elsewhere stays listed but unreadable** until its own root is approved — that
  behaviour already exists in the CLI's startup message and must survive into the UI.

The management surface is now part of the contract and is exposed only through explicit host
capabilities. Its evidence covers nested registration, a new approved root, duplicate and invalid
paths, revocation, restart durability, and the CLI's multi-repository form. A build without the
management capability keeps showing its current repository list rather than inventing an "Add
repository" action.

## 5. Form 3 — Hosted UI against a local host (opt-in, later)

Goal: `app.refyard.dev` (or any static host) serves the same Svelte artifact, and a user who is
already running `refyard serve` locally can connect that UI to their machine after entering a
password. The current implementation accepts the password from the CLI process environment and
keeps it only in the page's live form state for the one ticket exchange; it is not persisted.

This form is genuinely useful and genuinely dangerous, so the requirements are stated up front:

**Requirements (all of them, not a subset):**

1. **Opt-in on the host side.** The service refuses cross-origin use unless it was started with an
   explicit allowance naming the origin(s) (e.g. `--allow-origin https://app.refyard.dev`). Default
   installs keep the loopback-only behaviour of form 1, byte for byte.
2. **An exact origin allowlist, never a wildcard.** No `Access-Control-Allow-Origin: *`, no
   reflecting the request's `Origin`, no credentials mode that assumes cookies. The bearer stays in
   an `Authorization` header; cookies are not part of this design.
3. **Password → session, not password per request.** The user sets `REFYARD_HOSTED_PASSWORD` in the
   CLI environment; the client sends it once, the host compares it against a memory-only scrypt
   hash, rate-limits attempts, and issues the same kind of session token form 1 uses. The password
   itself is not what every request carries and is never accepted as a CLI argument.
4. **Writes stay closed until form 1 has them.** A hosted UI in a read-only build can read a
   repository and nothing else. Hosted UI must never be the first place a mutation becomes
   reachable.
5. **The pairing facts are visible.** The host logs the origin, the time, and the actor of every
   hosted session; the UI shows which machine it is talking to (service instance id + repository),
   so "connected to the wrong Mac" is visible rather than plausible.

**Honest risks, recorded rather than argued away:**

- Public HTTPS page → `http://127.0.0.1` is a cross-origin request that browsers increasingly gate
  (Chrome's Local Network Access prompt; Safari and Firefox differ). The user may have to grant
  permission, and some browser/version combinations may refuse it outright. **Unverified**: no
  browser was exercised for this on 2026-09-15.
- A password in `localStorage` is readable by any script on the hosted origin. That origin is then
  a client with the user's Git access — so the hosted UI's own supply chain (analytics, a bad
  dependency) becomes part of the threat model. Mitigations that would change this design (per-
  session device approval, short-lived tokens bound to a visible host confirmation) must be decided
  before this form ships, not after.
- A reachable port with a password is brutable. Rate limiting and a lockout that the CLI can clear
  are part of the feature, not polish.
- This form does not change §2.7: the hosted UI is another client of the same `GitService`.

## 6. Form 4 — Embedded core in a native host

> **Revision 2026-09-18 — the decision flipped.** Form 4 is being built now, and the user chose
> **Rust + Tauri 2** rather than an embedded JS engine: the desktop app carries no Node/Bun/Deno
> and does not route its own backend through localhost HTTP. The authority for that workstream is
> `docs/superpowers/specs/2026-09-18-native-desktop-ssh-design.md` plus its adapter contract,
> implementation plan, and acceptance document; where this section and that design disagree about
> form 4, the design wins. The reasoning below is kept because it is what makes the Rust host
> checkable rather than trusted: the portable core and its fixture corpus are the oracle, and no
> port may be claimed correct without running both implementations over the same fixtures. One
> rule is added for the port: the Rust core must not become a second home for Git semantics —
> planners and parsers are ported module by module against those fixtures, and `capabilities`
> reports only what is actually implemented.

Goal: a native app (Xross, Kunkun, a future Swift/Rust shell) runs the _same_ command construction
and parsing logic in a small embedded JS runtime (JavaScriptCore, QuickJS, or another small engine)
without dragging Node or a framework in. Bundle size is the constraint that keeps this honest.

This is already true and must stay true:

- `git-core` has **no runtime dependencies**; it imports the contract with `import type` only, so
  Zod is erased from a core-only bundle.
- The portability smoke builds a neutral IIFE of **60,550 bytes** and runs 11 planner/parser checks
  with no host globals and no Node shims (`pnpm test:portable`, run 2026-09-16).
- `packages/git-graph` is equally host-free, so a native host can lay out the commit graph itself.

Rules that keep the door open:

- A new capability belongs in core only if it can be written with bytes, plain objects and
  functions. If it needs a timer, a socket, a filesystem, or a `Buffer`, it is an adapter — it goes
  behind `GitHostPort`, where the host can supply its own implementation.
- `git-contract` (Zod) is the **boundary** schema set, not a core dependency. A native host may
  skip it entirely and validate with its own runtime (Kunkun's plugin boundary, Rust's serde).
- Any change that raises the core-only bundle materially (a new runtime dependency, a polyfill, a
  decorator runtime) is a design decision, and it has to be argued in the task that makes it.
- The smoke is a smoke: it proves the bundle runs without host globals. It does **not** prove
  QuickJS or JSC compatibility. That claim needs a real engine run and nothing here may imply it.

**Form 4 may end without any JavaScript at all.** The 2026-09-15 discussion
(`docs/discussions/2026-09-15-native-runtime-and-hono.md`) concluded that the embedded engine is
a _bridge_: the durable asset is the portable core plus its fixture corpus, which together make
a port to a native language (or any other runtime) verifiable by differential testing rather than
by reading code. Two things follow, and both are already satisfied by the rules above: transport,
streaming, process spawning and MCP stay in the host language, and no port may be claimed correct
without running both implementations over the same fixtures.

## 7. Separate axis — the machine-facing surface (OpenAPI, Scalar, MCP)

Forms 1–4 are about _people_. A second surface matters to _agents and tools_, and it is decided
here so it does not get improvised later:

- **Hono is the HTTP layer** for the versioned API's API and discovery routes. `@hono/node-server`
  runs it on Node; the Git domain and application layers do not import Hono, so core stays portable
  (§2.6). The static asset boundary remains separate.
- **OpenAPI generation uses `hono-openapi`** (preferred over `@hono/zod-openapi`), and the API
  reference UI is **Scalar** (`@scalar/hono-api-reference`), not Swagger UI. Exact wiring proven in
  `~/Dev/kunkun/packages/local-api-server/src/openapi.ts`: `openAPIRouteHandler(app, {…})` for
  `/openapi.json`, `Scalar({ url: "/openapi.json", … })` for `/scalar`.
- **MCP uses `@hono/mcp` + `@modelcontextprotocol/sdk`** — Kunkun already runs `StreamableHTTPTransport`
  this way (`packages/local-api-server/src/{browser,listenflow,workspace}-mcp.ts`). Refyard exposes
  the bounded read tools currently backed by `ReadService` (`repo_status`, `list_branches`,
  `list_worktrees`, `get_diff`, `get_commit`), with an explicit policy principal bound to the
  bearer session, and it never exposes `run_git(args)` or a shell. Search/history tools remain
  absent until the contract has bounded queries for them.
- The OpenAPI document describes the _same_ `GitService` contract that the UI uses — generated from
  the Zod schemas in `packages/git-contract` (`z.toJSONSchema` already produces them,
  `pnpm check:contract`).

Status: **implemented locally; externally deployed MCP remains unverified.** The Hono adapter,
OpenAPI document, Scalar reference page and read-only MCP protocol cases pass while the existing
auth/origin/SSE/static boundaries remain covered.

## 8. Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-18 | Form 4 is a Rust + Tauri 2 native host (no JS runtime, no localhost HTTP bridge) that reuses the same Svelte UI through a BackendAdapter, reads local repos directly and reaches remote repos through the host machine's system OpenSSH; the Node service stays the runtime for forms 1–3.                                                                   |
| 2026-09-14 | One runtime for V1: Node 26.x. No Rust/Bun/second engine in the shipped service.                                                                                                                                                                                                                                                                             |
| 2026-09-14 | Public contract is Zod-first (`packages/git-contract`), exported as JSON Schema.                                                                                                                                                                                                                                                                             |
| 2026-09-15 | Four usage forms are supported targets; form 1 is the default and form 2 grows access only by explicit approval.                                                                                                                                                                                                                                             |
| 2026-09-15 | Multi-repository management (form 2) is a first-class goal, by explicit approval — never scanning.                                                                                                                                                                                                                                                           |
| 2026-09-15 | Hosted UI (form 3) is opt-in, password-gated, origin-allowlisted, and never the first place a mutation appears.                                                                                                                                                                                                                                              |
| 2026-09-15 | Core stays dependency-free so a native host can embed it (form 4); bundle growth is a decision.                                                                                                                                                                                                                                                              |
| 2026-09-15 | HTTP layer moves to Hono with `hono-openapi` + Scalar; MCP via `@hono/mcp` (read tools first).                                                                                                                                                                                                                                                               |
| 2026-09-16 | Form 2 and the password-gated form 3 path are implemented locally; form 4's measured decision is to stay on Node, and live hosted deployment remains unverified.                                                                                                                                                                                             |
| 2026-09-16 | Restore the bundled same-origin local workbench as the default `open` product form; keep `serve` API-only and the Cloudflare PWA as an optional hosted client.                                                                                                                                                                                               |
| 2026-09-15 | Parsing placement: argv, state truth and write permission stay in core; display parsing stays server-side **because it is bounded**, with typed degradation; no browser parsing Worker until the UI parses something heavy. Reopening needs measurements naming a shape the bound cannot serve (`docs/discussions/2026-09-15-frontend-parsing-boundary.md`). |

## 9. What this file forbids

- Widening origin checks, adding a CORS wildcard, or exposing reads unauthenticated "just for the
  hosted UI". Form 3 needs an allowlist and a password, or it does not ship.
- Widening an approved root because a repository was inconvenient to approve. Form 2 is an
  approval flow, not a broader default.
- Moving Git logic into a Node-only module for convenience. If it cannot run in a neutral runtime,
  it belongs behind `GitHostPort`.
- Turning a form into two implementations of the same thing. Form 4 uses the _same_ core; form 3
  uses the _same_ API; form 2 uses the _same_ registries with a bigger scope list. The 2026-09-18
  Rust host is a **port, not a fork**: it may not drift from the TypeScript core on DTOs, error
  classification, or safety semantics. What keeps that honest is the differential oracle — the
  same fixtures run through both implementations and compared — not a promise in a document.
- Claiming a form works because the code exists. Each form needs its own evidence, and forms 3 and
  4 carry platform claims that only a real browser, a real native window, and a real SSH server can
  settle.
