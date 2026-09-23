# host-node Package

**Created: 2026-09-23** — initial wiki bootstrap.

`packages/host-node` — the Node host: everything that touches processes, files, and the network on the user's behalf.

## Layout (`src/`)

| Area | Responsibility |
| --- | --- |
| `coordinator/` | auth, **scopes**, jobs (**one writer per common Git directory**), lifecycle |
| `journal/` | append-only audit of operations — **never records token bytes** |
| `http/` | the authenticated loopback API + SSE stream (all reads authenticated) |
| `provider/` | **new 2026-09-22**: `service.ts` (HTTP surface + cached PR reads), `manager.ts` (connection lifecycle), connection store on disk |
| `process/ filesystem/ registry/` | adapters: the machine's own `git`, approved I/O, repository registry |
| `capabilities` | honest feature report — **omits** anything unimplemented, never reports it as supported |

## Provider additions (2026-09-22)

- `provider:manage` scope gates connect/status/disconnect → 403 without it.
- Connection store: validate token upstream (`GET /user`) **before** persisting; 401 → 502 `ProviderUnauthorized` and nothing stored.
- PR reads: upstream first, then cache with `cachedAt`; not connected → 409 with **zero** upstream calls.
- `tokenOf` accessor added because the provider service depends on it (`03a165b`).
- Tests: `tests/node/provider-connections.test.ts`, `tests/node/provider-device-flow.test.ts`, integration cases PV-A…PV-K.

## Invariants this package enforces

- Single-use pairing tickets minted only on trusted local channels; exact Origin/Host checks; JSON 404 for unknown `/api`.
- Destructive operations require explicit confirmation, back up first, and **fail closed** when a precondition can't be verified — a backup failure means the operation does not run.
- Unknown results are reported as **unknown**; never auto-retry a mutation; never label an uncertain result `succeeded`.

## Related pages

- `Services/Git Provider Integration.md`
- `Infrastructure/Testing and Safety.md`
