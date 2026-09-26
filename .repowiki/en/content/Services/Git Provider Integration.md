# Git Provider Integration

**Updated: 2026-09-23** — page created during wiki bootstrap; covers the P1/P3 work landed 2026-09-22.

The **provider axis** (north-star §8): *opt-in* forge connections, GitHub first, read-only first. Spec: `docs/superpowers/plans/2026-09-22-provider-integration.md`. Acceptance: `docs/acceptance/2026-09-22-provider-integration.md` (matrix in Chinese, PASS/NOT RUN cells with evidence column).

## What shipped (P1: GitHub, read-only)

1. **Contract** — provider axis schemas, problem codes, and `capabilities.providers` in `packages/git-contract` (`1b04193`).
2. **`packages/git-provider`** — remote→forge parser, GitHub REST client with **injected fetch** and classified errors (`5b8a322`, `453b05b`), issue + workflow-run reads with a live API probe (`27a3406`).
3. **Host** — provider connection store, manager, `provider:manage` scope, provider HTTP surface with **cached** pull-request reads (`43bdb9f`, `86d7fc1`).
4. **Client + UI** — `git-client` provider/PR methods; web **pull-requests panel** with gated sidebar view and host-side connect flow (`3585de0`, `efcb10c`).
5. **P3 same day: OAuth device flow** — device-flow client with refresh support (`c17d415`), self-refreshing tokens end-to-end (`fb25775`), acceptance evidence recorded (`2a5d1e8`, `3cd1a02`).
6. **Forge adapter abstraction** (`094fca7`) — `packages/git-provider/src/adapter.ts` + `github/adapter.ts`, so a second forge slots in behind one interface; test stub `tests/support/forge-adapter-stub.ts`.

## Behaviour contract (from the acceptance matrix)

| Case | Behaviour |
| --- | --- |
| PV-A | valid token: host verifies via GET /user, then stores; status reports account + scopes |
| PV-B | rejected token → 502 `ProviderUnauthorized`, **nothing stored** |
| PV-C | PR list: upstream first, later reads served from cache with `cachedAt` |
| PV-D | not connected → 409 `ProviderNotConnected`, **zero upstream requests** |
| PV-E | no GitHub remote → 409 `NoProviderRemote`; PV-F `origin` wins over second GitHub remote |
| PV-G | no `provider:manage` scope → connect/status 403 |
| PV-I | **token never appears in any response** (capabilities/connection/pull-requests all scanned); upstream sees only the Authorization header |
| PV-K | token file 0600 / dir 0700, corrupt file refuses to load, validate-before-store, journal carries no token bytes |

## Verification (2026-09-22 measured, not aspirational)

- `pnpm check` PASS (13/13 projects), `pnpm check:boundaries` PASS, `pnpm check:contract` PASS (558 named schemas).
- unit/node/contract 55 files / 550 tests PASS; integration 48 files / 526 tests PASS; `cargo test --workspace` PASS; `pnpm build:web` PASS; CLI bundle PASS.
- Playwright Chromium 73/75 (known pre-existing `offline.spec.ts:92` failure; `read-only.spec.ts:158` flake passed twice in isolation). **Playwright Firefox: NOT RUN** (local Firefox cannot start — known limitation).

## Known boundaries (this round)

Read-only: no writes to forges. Unconnected/no-remote cases fail closed with 409s. See `docs/acceptance/2026-09-22-provider-integration.md` §4 for the full "not this round" list.

## Related pages

- `Packages/git-provider Package.md` — module layout
- `Services/Node CLI and HTTP Service.md` — scopes and caching host-side
