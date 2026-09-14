# 2026-09-15 — JS runtimes in a native host, and how far Hono travels

> Record of a design conversation. Non-normative: the conclusions that were adopted live in
> `docs/product/north-star.md` (§6, form 4) and in the plan's §6.
> The conversation was in Chinese; this is a summary of its conclusions, with the sources it
> cited.

## The question

If the Git core is kept free of Node APIs so that a native app can run it in JavaScriptCore or
QuickJS, then what renders the UI? Three shapes were on the table:

1. native UI (SwiftUI/WinUI) over an embedded JS engine, in one process;
2. native UI, but no UI bundle shipped — so the native app runs a local HTTP server that a
   public website talks to, and the server is written in the native language (axum/hyper,
   SwiftNIO, Kestrel), not Node;
3. the same split, but the _server logic_ (routing, OpenAPI, MCP) also runs in the embedded JS
   runtime, with the native HTTP server acting as a proxy in front of it.

The last one led to the actual question: **how far does the JavaScript form go** — can Hono run
where there is no Node?

## Corrections and findings

- **Hono is not a Cloudflare project.** It is an independent, Web-Standards-based framework
  whose most typical early runtime happened to be Cloudflare Workers. Its core entry point is
  `Request → app.fetch(request) → Response`.
- **Hono itself is runtime-agnostic; a bare JS engine is not enough.** Hono assumes the Web
  platform: `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`, `ReadableStream`. Bare
  JavaScriptCore gives `JSContext`/`JSValue`/`JSVirtualMachine`; bare QuickJS gives ECMAScript
  plus its own `std`/`os`. Neither provides `fetch` or streams. Running Hono there means
  supplying polyfills for each Web API a middleware touches — which trends towards maintaining a
  mini Worker runtime.
- **A native HTTP server in front of Hono is technically sound.** hyper/axum (or SwiftNIO, or
  Kestrel) receives the request, hands method/url/headers/body across a bridge, JS constructs a
  `Request`, calls `app.fetch`, and the resulting `Response` is handed back. Nothing about this
  is impossible.
- **Hono already has a standardised version of this**: WASM + WASI HTTP, via StarlingMonkey and
  `componentize-js`, exporting `wasi:http/incoming-handler`.
- **But for the second and third shapes the transport is the wrong thing to move into JS.**
  Streamable HTTP, SSE, long-lived connections, cancellation, backpressure and JSON-RPC
  framing — the parts MCP actually needs — would have to cross the native↔JS boundary. That is
  where the complexity lands, and none of it benefits from being written in JavaScript.
- **JavaScriptCore is not IPC.** When it is embedded in the same process it is a library call:
  Swift calls a JS function, gets a structured result, and SwiftUI renders it. JS never says
  "render a button"; it says "there are three modified files".
- **The public-website-to-localhost shape has a growing browser-side cost.** Local Network
  Access rules now gate `fetch`/WebSocket/WebTransport to loopback and private networks from a
  public HTTPS page, and CORS has to be exact. "It is localhost, therefore it is safe" is wrong —
  a malicious page can reach localhost too.

## Conclusions adopted

1. **Keep the layers separate**: pure logic (parse, command construction, validation,
   normalisation) / application-server logic (routing, auth, MCP) / UI. The third is not the
   second's problem, and the second is not the first's.
2. **Pure logic stays portable JavaScript** — ECMAScript and `Uint8Array` only, no `node:fs`,
   no `node:child_process`, no `node:http`, no `Buffer`, no process or streams. This is what
   makes it runnable in Node, a browser, JSC, QuickJS, Deno or Bun. It is also the layer most
   easily ported later.
3. **Native UI over an embedded engine is a good shape** — the engine returns data, the native
   layer decides presentation.
4. **Transport stays native.** HTTP sockets, WebSocket, SSE, MCP transport, file IO, process
   spawning, PTY, Git execution, SSH and streaming all belong to the native language. If a
   native daemon (axum) already exists, HTTP routing is more naturally Rust than a bridged JS
   framework.
5. **The embedded JS engine is a bridge, not the destination.** The recommendation is to treat
   the JS implementation as a _portable reference_ and the test corpus as the durable asset:
   golden fixtures plus differential tests (run both implementations over the same corpus,
   compare normalised output) are what make an AI-assisted port to Rust — or any other language
   — verifiable rather than hopeful.
6. **Two reasons would justify keeping a JS runtime permanently**: a plugin ecosystem where
   users write JavaScript, and cross-platform business rules that must ship without releasing a
   native binary. Fixed Git core logic is not one of them.
7. **If a hosted UI is ever built, do not serve the API with `Access-Control-Allow-Origin: *`.**
   Exact allowed origin, one-time pairing, ephemeral capability. A variant worth preferring
   later: serve the UI _from_ the local service (same origin, no CORS, no LNA prompt) with the
   bundle downloaded from a CDN and **signed and verified like executable code** — because that
   is what it is. (Apple's App Store guideline 2.5.2 restricts downloading and executing code
   that changes app functionality, which matters for that variant on iOS/macOS.)
8. **The goal should be restated**: not "how do we keep running a Node library inside a native
   app", but "how do we write this logic as a portable pure core that runs in JS today and can
   be ported tomorrow".

## What this means for Refyard now

- The rule in `AGENTS.md` §1 (Git Core is host-free, enforced by `pnpm check:boundaries`) is the
  same boundary this discussion asks for; the portability smoke (`pnpm test:portable`, a neutral
  60,542-byte IIFE at the time of writing) is the evidence that it holds.
- The fixture corpus in `tests/fixtures` is the artefact that would make a later port verifiable.
  A future task can turn it into an explicit golden/differential harness; nothing needs to change
  in the core to allow that.
- The M1 plan's form-4 statement stands: no QuickJS/JSC integration should be built to satisfy
  curiosity, and no portability claim may be made without running a real engine.
- For the HTTP layer this changes nothing about M1. The scheduled Hono migration is about the
  Node host's own API surface (OpenAPI + MCP), where Hono runs on a runtime that has the Web
  APIs; it is not a plan to run Hono inside a bare JS engine.

## Sources cited in the conversation

- Hono, Web Standards: <https://hono.dev/docs/concepts/web-standard>
- Hono, WebAssembly/WASI: <https://hono.dev/docs/getting-started/webassembly-wasi>
- Hono repository: <https://github.com/honojs/hono>
- JavaScriptCore: <https://developer.apple.com/documentation/javascriptcore>
- QuickJS: <https://bellard.org/quickjs/quickjs.html>
- MDN, local network access: <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access>
- MDN, CORS configuration: <https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CORS>
- Apple App Review Guidelines (2.5.2): <https://developer.apple.com/app-store/review/guidelines/>
