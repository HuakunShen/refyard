# git-provider Package

**Updated: 2026-09-23** — page created during wiki bootstrap (package added 2026-09-22).

`packages/git-provider` — the forge-facing half of the opt-in provider axis. Reads only in P1; writes are out of scope this round.

## Module layout

| File | Responsibility |
| --- | --- |
| `src/remotes.ts` | shared **remote→forge parser** — classifies a git remote URL as a forge (GitHub, …) |
| `src/github/rest.ts` | GitHub REST client with **injected `fetch`** (testable, no global fetch) and **classified errors** |
| `src/github/device-flow.ts` | OAuth **device flow** client with token **refresh** support |
| `src/adapter.ts` | `ForgeAdapter` interface — the seam a second forge implements |
| `src/github/adapter.ts` | GitHub implementation of the adapter |
| `src/index.ts` | package exports (consumed as `@refyard/git-provider/…`) |

## Design rules that apply here

- **Token secrecy is a tested invariant**: tokens never enter HTTP responses (capabilities/connection/pull-requests are all scanned) nor the journal; the file on disk is 0600 in a 0700 directory, and a corrupt file refuses to load. Validate **before** store.
- The REST client's fetch is **injected** — unit tests run against a stub upstream, never the live network (the live API probe is a separate, explicit manual step: `27a3406`).
- Errors are **classified** (`ProviderUnauthorized`, `ProviderNotConnected`, `NoProviderRemote`, …) so the HTTP layer can map them to 502/409 without string sniffing.
- Reference-projects rule: any idea borrowed from a yellow-tier forge client is restated in prose first — see `docs/reference-projects.md`.

## Related pages

- `Services/Git Provider Integration.md` — end-to-end behaviour matrix
- `Packages/host-node Package.md` — where connections are stored and served
