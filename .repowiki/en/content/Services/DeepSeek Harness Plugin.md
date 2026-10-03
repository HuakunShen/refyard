# DeepSeek Harness Plugin

**Created: 2026-10-03** — `integrations/dsh` (the Refyard Git panel inside the DeepSeek Harness).

Refyard ships as a **DeepSeek Harness plugin**: the same workbench, mounted as a panel inside
someone else's Web UI. It is not a reimplementation and not a second engine — a real Refyard
service is assembled **inside the Harness host process** out of `@refyard/host-node`, exactly the
wiring the `refyard` CLI uses, and answers behind the mount prefix `/refyard` on the Harness web
server. The panel is Refyard's own SPA in a frame.

## Shape

```
Harness Web UI
  ├── sidebar "Git"  ──────────────► main panel  ┐
  └── session-header button ───────► right column ┘
                                                  │  frame: /refyard/
                                                  ▼
                                    Harness web server (127.0.0.1:3080)
                                      └── /refyard/*  →  Refyard service (loopback, port 0)
                                                            ├── assembled from @refyard/host-node
                                                            └── authenticated by its own ticket
```

- **Host half** — `integrations/dsh/src/host.ts`. Injects the Harness `webServer` service and
  registers the `/refyard` prefix route, plus the `/refyard/dsh/context` route.
- **Client half** — `integrations/dsh/src/client.ts`. Registers the sidebar entry, the main
  panel, the right-column tab and the session-header button; the panel body is a plain
  `<iframe>`.
- **The private listener is a port, not a process.** The embedded service listens on loopback
  **port 0** (an implementation detail behind the Harness route) — no extra Refyard process is
  started. Git work still runs through the machine's own `git`.

## Pairing is unchanged

Nothing about authentication was relaxed to make embedding convenient. A document request
without a `pair` parameter is answered by trusted host code that approves the session's
repository and mints a **single-use pairing ticket**, then redirects to the SPA with
`api=/refyard` and `pair=<ticket>`. The frame is a normal authenticated Refyard client and
exchanges that ticket for an in-memory bearer exactly as a human at a terminal would. The route
is guarded by Refyard's own origin policy (`createOriginPolicy`), so a cross-site page cannot
use it to reach the workbench.

`api` is a **root-relative mount**, never an absolute HTTP address. That is what keeps the frame
same-origin with whatever is hosting it:

| Host | Frame origin | API requests go to |
| --- | --- | --- |
| Harness web (browser) | `http://127.0.0.1:<port>` | the same HTTP origin |
| Harness desktop app | `dsh-app://app` | the same custom-scheme origin, relayed by the shell |

An absolute HTTP API would leave the desktop renderer's origin and be refused by its
`connect-src 'self'` policy before any request reached the service. See
`docs/evidence/2026-10-03-dsh-desktop-pairing.md` for the failure that established this and the
fix.

One consequence worth keeping: the desktop shell's forwarder validates the renderer origin and
then **removes** it before relaying to HTTP. Refyard's tickets are bound to an origin, so the
plugin restores a missing `Origin` from the **checked** HTTP authority — and only after the
route's own Origin/Host/Fetch-Site policy has passed. Explicit origins are preserved; foreign,
opaque and origin-less cross-site requests are still refused.

## Approval and state

- No repository is approved because the plugin started. Approving a directory is a durable,
  journalled act, so it happens the first time a panel asks for one, for that session's own
  `cwd` only. No parent directory is ever widened.
- The plugin keeps its **own state root** (`<refyard state root>/dsh`) so its journal is never
  the file a terminal `refyard run` is concurrently appending to.
- The context route resolves the repository from the Session (`session`, or the most recently
  active root Session), not from "whatever was opened last anywhere" — the right column is
  Session-scoped, so a project that opened the workbench keeps *that* project's repository.
- Both mounts call the same route; `single=1` is added by the **client** half, so which mount
  this is stays a property of the client that a not-yet-rebuilt host still gets right.

## Building and loading

`pnpm build:dsh` (`scripts/build-dsh-plugin.ts`) produces, in order: the embedded SPA
(`apps/web/build-dsh`, built by a third SvelteKit flavour with its own base path and its own
intermediate directory), the host bundle (`dist/host.js`) and the client bundle
(`dist/client.js`), staging the SPA at `dist/web`.

Two reload rules bite during development, and `integrations/dsh/README.md` is the authority for
both:

- **The host half is loaded once per Harness process and cached by package name.** Rebuilding
  `dist/host.js` does not replace the running plugin; toggling or reinstalling re-activates the
  plugin but re-imports the *cached* module. Only a restarted Harness process loads new host
  code.
- **A client bundle that fails to load once is remembered as failed** and skipped for the life
  of the process, so a reload and a toggle both do nothing and a restart is the only way back.
  Both bundles are written only when their bytes changed for exactly this reason.

## Related pages

- `Architecture/Architecture.md` — the layering the plugin reuses
- `Services/Node CLI and HTTP Service.md` — the service the plugin assembles in-process
- `Infrastructure/Release and Packaging.md` — the npm publish line for the bundle
