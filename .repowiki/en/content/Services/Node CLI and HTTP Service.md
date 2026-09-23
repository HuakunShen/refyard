# Node CLI and HTTP Service

**Created: 2026-09-23** — initial wiki bootstrap.

The browser forms' host: `apps/cli` parses argv and drives the lifecycle; `packages/host-node` implements the coordinator, journal, and the authenticated loopback HTTP service.

## CLI surface

```bash
refyard open    # serve + open the workbench in a browser
refyard serve   # serve only
refyard pair    # mint a pairing ticket over the same-user control socket
refyard doctor  # environment diagnostics
```

- Default port **9595**; a taken *default* port falls through to another free one which is then **named**; a busy explicit `--port` is **refused**; tests use `--port 0`.
- Bundled CLI: `bun scripts/bundle-cli.ts` → `.refyard-dev/cli.mjs` + static `web`.

## Pairing and auth

- Pairing tickets are **single-use** and minted only on trusted local channels: the `p` keystroke on the serving terminal, or `refyard pair` over a same-user-only control socket — **never over HTTP**.
- The ticket is exchanged once for an in-memory bearer token. Every route (reads included) requires it, plus exact `Origin`/`Host` checks, JSON 404 for unknown `/api` paths, no CORS wildcard, no fallthrough to the SPA.
- Client side (see `Services/Workbench UI and Sessions.md`): the bearer and `serviceInstanceId` persist in `localStorage` + `sessionStorage` and are re-validated against `/health`.

## Scope, jobs, journal

- Sessions carry **scopes** (e.g. `provider:manage` gates provider connect/disconnect); unauthorized = 403, unconnected provider = 409 — see `Services/Git Provider Integration.md`.
- A job queue enforces **one writer per common Git directory**; updates stream to the UI as authenticated **SSE**.
- A journal records operations for audit — and by rule **never records secret bytes** (tokens are scanned out of responses and journal alike).

## Related pages

- `Architecture/Architecture.md` — the two-interface rule this service sits inside
- `Packages/host-node Package.md` — module-by-module layout
