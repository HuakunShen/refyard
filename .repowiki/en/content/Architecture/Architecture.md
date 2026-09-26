# Architecture

**Created: 2026-09-23** — initial wiki bootstrap. Canonical rules live in `AGENTS.md` §1–§2; this page is the orientation summary.

## The layer stack (browser forms)

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

The native desktop form replaces the Node column with the Rust crates (`refyard-core` → `refyard-host`) behind the **same** GitService contract, carried over Tauri IPC instead of HTTP.

## Two interfaces, never mixed

- **`GitService`** — the public, closed-semantic JSON API for browsers. Sent over HTTP/SSE (or Tauri commands/events in the native form).
- **`GitHostPort`** — the private, scope-bound capability used only by trusted core inside the host.
- **Never expose `runGit(args, cwd)`, raw argv, shell, `cwd`, or `env` over any browser bridge.** The browser sends Git *intentions*; only trusted core turns intentions into argv.

## Non-negotiable invariants

1. **Git Core is host-free.** `packages/git-core` / `git-graph` import no `node:*`, no DOM, no Buffer/process/fetch/URL/timers; `lib: ["ES2022"], types: []`. Production argv generation lives only in core planners.
2. **Status parsing is byte-safe.** Bytes in, bytes out — NUL framing, `cat-file --batch` length headers; never decode-then-split. OIDs validated against the detected object format (SHA-1 today, SHA-256 parser-supported) — never hardcode 40 hex chars.
3. **SvelteKit is routing only** — `adapter-static`, `fallback: 200.html`, `ssr = false`; no server routes, no SSR of repository data.
4. **Core UI in `git-ui` imports no `$app/*`** — only `apps/web` owns SvelteKit composition (so Kunkun / VS Code can reuse the components).
5. **All HTTP is authenticated, reads included.** Loopback only (default 9595; busy explicit `--port` refused; `--port 0` for tests), exact Origin/Host checks, single-use bootstrap ticket → in-memory bearer, JSON 404 for unknown `/api` paths, no CORS wildcard, no SPA fallthrough. The hosted-UI form may relax this only as an explicit origin allowlist + password→session exchange.
6. **One writer per common Git directory** inside the service — never claims to lock out an external IDE/terminal/AI. Never delete Git lock files, force operations, or disable hooks/host-key verification to make a test pass.

## Native scope revision (2026-09-18, closed)

Rust + Tauri 2 desktop app is a **separate binary**: it ships no Node/Bun/Deno, routes no traffic through localhost HTTP, and Rust is *not* a second engine inside the Node service. SSH uses the **host's** OpenSSH against the user's own `ssh_config`; no key bytes, passphrases, or raw argv cross the browser/plugin boundary. Governing docs: `docs/superpowers/specs/2026-09-18-native-desktop-ssh-design.md` and the plan/acceptance files beside it. Where Rust lags Node, `capabilities` reports the gap — never report unimplemented work as supported.

## Related pages

- `Services/Node CLI and HTTP Service.md` — the Node column in detail
- `Services/Native Desktop and SSH.md` — the Rust column
- `Infrastructure/Testing and Safety.md` — how the invariants are enforced
