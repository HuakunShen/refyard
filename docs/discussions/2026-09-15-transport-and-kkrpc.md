# Discussion — the browser↔host transport, and whether kkrpc should replace it

> **Status: open question, non-binding.** Written 2026-09-15 at the user's request, after they
> asked what the current frontend↔backend protocol is, whether anything watches the repository and
> pushes to the UI, and whether [kkrpc](https://github.com/kunkunsh/kkrpc) (`~/Dev/kkrpc`) should be
> used. Recorded so the answer is reviewable and so a later decision does not have to re-derive the
> facts. Nothing here changes the architecture; the settled form of any decision made from it
> belongs in `docs/product/north-star.md` and, if it changes rules, in `AGENTS.md`.
>
> See also: `2026-09-15-frontend-parsing-boundary.md` (where parsing lives, and what the diff bound
> already measured) and `2026-09-15-native-runtime-and-hono.md` (how far Hono travels without Node).

## 1. What the transport is today, precisely

Measured from the code, not from memory (`packages/host-node/src/http/`, `packages/git-client/src/`):

- **HTTP/1.1 with JSON bodies, loopback only** — a small hand-written surface of `/api/v1/*` paths on
  `node:http` (`router.ts`). No framework: Hono, Express and Fastify are not dependencies. The only
  third-party runtime deps anywhere in the workspace are `zod`, Svelte, TanStack Query/Virtual, and
  `lucide`. Reads are `GET` with a Zod-validated query; writes are `POST` that answer with an accepted
  operation and settle through the journal — never a bare "done". (North-star §8 already settles that
  the *server* layer moves to Hono with `hono-openapi` + Scalar and MCP via `@hono/mcp`. That is a
  choice of framework inside the host: it does not change the wire contract, the auth model, the SSE
  stream, or the client, which is what this record is about.)
- **Push already exists, and it is SSE, not polling.** `/api/v1/events` (`http/events.ts`) streams
  `text/event-stream` with a bounded ring (1,024 events or 1 MiB), replay via `?since=`, an explicit
  `eventGap` when the ring no longer holds the caller's cursor, and heartbeat comments. A `diff`, a
  file list or a source excerpt is never put in the stream.
- **The stream is fetched over `fetch`, not `EventSource`**, for one reason: `EventSource` cannot send
  an `Authorization` header, and this service keeps the bearer in a header rather than a URL.
- **Events are hints that invalidate cached reads, never the source of truth.** The client
  (`packages/git-client/src/events.ts`, consumed in `apps/web/src/routes/+page.svelte`) turns
  `repositoryChanged` into TanStack Query invalidations and `eventGap` into "invalidate everything".
  A consumer that receives no event at all is still correct on its next read.
- **Only two call sites publish**: `coordinator/submit.ts`, when an operation is accepted and when it
  settles. Operation status, therefore, is push-based for work this service accepted.
- **Nothing watches the repository.** There is no `fs.watch`, no `chokidar`, and no polling loop: a
  commit made in your own terminal or IDE does not reach the browser until something else triggers a
  read. `DESIGN.md` explicitly scopes a watcher out of V1 and prescribes polling instead (2 s visible,
  15 s hidden, backoff to 30 s, stop when no subscriber) — **that cadence is not implemented today**;
  the only interval in the app is a 30 s clock driving relative timestamps.
- **Type safety is end-to-end but by contract, not by framework inference.** `packages/git-contract`
  is the single source: Zod schemas → `z.infer` DTOs → `z.toJSONSchema`. The client
  (`git-client/src/client.ts`) parses **every response with the same schema the server built it from**,
  so drift fails at the boundary, and failures carry a closed problem code plus HTTP status
  (`GitClientError`). There is no `hc`-style route↔handler inference because there is no framework;
  the route table and the schemas are kept in step by `pnpm check:contract` (438 schemas) and by tests.

So, answering the question directly: it is a REST-shaped, authenticated JSON API **with** a
server→client push channel already (SSE), and **no** WebSocket anywhere in the product.

## 2. What kkrpc is, and what it would bring

From a survey of `~/Dev/kkrpc` and its usages (`~/Dev/kunkun` is the heaviest consumer):

- Published as `@kunkun/kkrpc` v2.1.0 (npm and JSR), MIT, ~186 commits, active through 2026-07.
  Runtime dependency: `superjson` only; every transport runtime (`ws`, `hono`, `elysia`, …) is an
  optional peer. No native addons.
- Transports include WebSocket, Hono/Elysia adapters, worker, iframe, stdio, Electron, Tauri, plus
  pub/sub backends. **Bidirectional on persistent transports**: server→client calls, callback
  arguments, and `AsyncIterable` streaming with pull backpressure. Its HTTP transport is unary POST
  only — no callbacks, no server-initiated calls.
- Types-only by default (`wrap<RemoteAPI>`, `RPCChannel<Local, Remote>`); no codegen. Validation is an
  opt-in plugin (Standard Schema), not something on the message path. A compact JSON protocol is
  documented, and non-TS implementations exist (`interop/{python,go,rust,swift}`).
- **It supplies no auth and no sessions.** You hand it an accepted socket. In kunkun, the app
  implements its own Origin-guarded upgrade plus a challenge/`auth_request`/`auth_success` handshake
  before the channel exists.
- Proxy semantics to be aware of: any path-reachable property is remotely invocable, including
  `op:"new"`; `remote.x = v` is fire-and-forget and **silent on failure** unless `onUncaughtError` is
  set; a call timeout or abort rejects on the client only — it does **not** cancel work on the server.

Where it genuinely earns its place in kunkun: the host calls *into* the UI (`BrowserClientAPI.onEvent`,
`showNotification`, `getActiveTab`), and plugins run in their own processes/workers — cases where the
host must invoke client-side functions, not merely push at them.

## 3. Assessment for Refyard

**Keep HTTP + SSE as the browser boundary.** The reasons are the architecture's own, not inertia:

1. **The contract is the portability artifact.** GitService is pinned as a *closed-semantic* JSON API,
   and the Zod schemas export to JSON Schema. Any language can implement that surface, and the tests
   that keep client and server honest are schema tests. An RPC channel would make the boundary a
   TypeScript proxy, and the durable equivalent (kkrpc's wire protocol) would need a maintained
   non-TS implementation forever — the exact cost the current design avoids. kkrpc's existing
   interop ports make this a smaller worry than it looks, but they are not this contract.
2. **Auth is implemented and tested on the HTTP path** — single-use ticket, in-memory bearer, exact
   `Origin`/`Host` checks, reads included, loopback only. A WebSocket channel needs its own copy of
   that gate (upgrade-time `Origin` check, credential that cannot be a header on the first frame).
   Two auth gates mean two places for a slip, in the one area where a slip is a security regression.
3. **Exposure discipline is weaker than the contract.** Refyard's rule is that the browser sends
   *intentions* and only trusted core turns them into argv. A proxy that makes every reachable
   property invocable, with silent fire-and-forget writes, inverts that: safety would depend on what
   happens to be exposed rather than on the schema.
4. **Its failure semantics collide with the rules.** A timed-out mutation must be reported as *unknown*
   and never auto-retried. kkrpc's timeout is client-local and its `set` failures are silent, so a
   mutation over RPC would still need the operation + journal semantics underneath to be safe — at
   which point it is the same design with an extra transport.

**Where kkrpc plausibly belongs: the host↔companion-process boundary, not the browser API.** T16–T18
(Kunkun adapter, Xross, native host) will need exactly what kkrpc is good at — typed calls in both
directions between processes, over stdio/worker/relay, with no browser auth surface to duplicate and
the user's own precedent (kunkun) already built on it. That is a decision for a T16 plan, made with
its own evidence, not a reason to change the V1 browser boundary.

**About `hc`/Hono.** With the host moving to Hono (north-star §8), an `hc`-style client becomes
available, so the question is whether `packages/git-client` should become one. The appeal is
route→client inference; the cost is that inference comes from the server's own route definitions, so
the drift check moves from the boundary into the type system alone, and the client stops being
something that only depends on the contract. Today `git-client` is used by the browser *and* by
Node-side tests, and `git-ui` sits on top of it without importing anything server-side — that reuse is
what a later non-TS host or a second UI would be built on. A middle path, if we want the OpenAPI/Scalar
and MCP benefits without giving that up: keep one client (Zod-parsed, DTO-returning) and let Hono's
generated OpenAPI be a derived artifact that `check:contract` verifies against `packages/git-contract`,
so the contract stays the source and the framework stays an implementation detail.

## 4. The gap the question actually exposed

Not the transport — **nothing observes the repository**. Push exists for work this service performed;
external changes (a commit in your terminal, a rebase in an IDE, a `git stash` from a script) reach the
UI only when the UI itself reads again. The design prescribes the cadence (2 s visible / 15 s hidden /
30 s backoff / stop when no subscriber) and V1 deliberately has no watcher. Implementing the
prescribed polling is small, needs no new transport, and closes the visible gap; a watcher can follow
if polling proves too slow on real repositories, with `fsmonitor` left alone.

## 5. What would change the answer

- If the host must **invoke** UI capabilities (ask the user something mid-operation, drive a panel),
  that is the case SSE cannot serve, and it is the point to reconsider a persistent bidirectional
  channel — for that channel, not for GitService.
- If a second browser client (extension, hosted UI form 3) has to share one session, the auth model
  needs a decision anyway, and that decision should consider both transports together.
