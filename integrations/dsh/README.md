# Refyard for the DeepSeek Harness

A Git workbench inside the Harness Web UI: history, diffs, staging, commits, branches,
remotes, stashes, tags, worktrees and submodules for the repository the current session is
working in.

It is not a reimplementation. A real Refyard service is assembled inside the Harness host
process out of `@refyard/host-node` — the same wiring the `refyard` CLI uses — and its own
HTTP application answers behind `/refyard` on the Harness web server. The panel is Refyard's
own SPA in a frame. Everything the product can do to a repository is available here because
it *is* the product.

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

## Two places it lives

- **The main panel** (the `Git` entry in the sidebar) is one workbench for the whole
  window, opened from the global panel rail.
- **The right column** is the per-project one. It is Session-scoped and its layout is
  recorded per Session, so a project that has opened the workbench keeps it and shows
  *that* project's repository. The button in the session header reveals it.

Both render the same SPA; the difference is which repository the host resolves and whether the
workbench offers repository *selection*. That second part is a mode the panel asks for:

| URL | Mode | Behaviour |
|---|---|---|
| `/refyard/?repo=…` | full workbench | A strip of repository tabs, `+ New repository`, and a repository list. Each Session's repository is adopted as the active tab, beside the current one; a tab the reader closed stays closed. |
| `/refyard/?repo=…&single=1&repositoryId=…` | single repository | One repository, named in the header instead of a strip, no tab strip, no launcher. `repositoryId` pins it exactly; without it the workbench matches the path it was given. |

`single=1` is what the side column uses, because a column inside someone else's chrome is a
per-Session view rather than a place to manage repositories. The main panel keeps the full
workbench, because there the reader *is* choosing between repositories.

The mode is applied by the client half, so it is a property of the mount rather than of the host
route: both mounts call the same route, and a host that has not yet learned to name the
repository still gets a working panel.

## What it does with a repository

Nothing, until the panel asks for one. Approving a directory is a durable, journalled act,
so it happens on the first panel load, for the session's own `cwd` only — the same act and
the same journal entry `refyard open <path>` would produce. No parent directory is ever
widened, and nothing is approved because the plugin started.

The workbench keeps Refyard's own authentication. A browser that reaches `/refyard` is
redirected to a single-use pairing ticket minted in trusted host code, exactly as the CLI
mints one for a human at a terminal. Nothing was relaxed to make embedding convenient: the
frame is a normal authenticated Refyard client, and the route is guarded by Refyard's own
origin policy, so a cross-site page cannot use it to reach the workbench.

The plugin keeps its own state root (`<refyard state root>/dsh`) so its journal is never the
file a terminal `refyard run` is concurrently appending to.

## Building

```
pnpm build:dsh          # from the repository root
```

That produces, in order: the embedded SPA (`apps/web/build-dsh`, via
`REFYARD_BUILD_TARGET=dsh`), the host bundle (`dist/host.js`) and the client bundle
(`dist/client.js`), staging the SPA at `dist/web`.

Install it into the current Harness profile:

```
plugin_manager install_bundle  /absolute/path/to/integrations/dsh
```

`install_bundle` adds the package as a profile dependency; it does not always add it to the
profile's bundle list in the same step. Check the list, and enable it explicitly if it is
missing — a bundle that is a dependency but not a bundle is installed, inactive, and silent:

```
plugin_manager set_bundle  enabled=true  target=@refyard/dsh-plugin
```

## Reloading it while developing

**The host half is loaded once per Harness process and is cached by package name.** Rebuilding
`dist/host.js` does not replace the running plugin: toggling the entry, or reinstalling the
bundle, re-activates the plugin but re-imports the *cached* module — even from a different
directory. Only a restarted Harness process loads new host code. Renaming the package is the one
exception, and it is not a workflow worth keeping.

The client half is different: its bundle is served to the browser and a page reload picks up a
rebuild — **unless the Harness has already given up on it.** A bundle that fails to load once is
remembered as failed and skipped for the rest of the process (`skipped after an earlier failure
of this bundle`), so a reload and a bundle toggle both do nothing; a restart is the only way back.

Three consequences worth knowing before a rebuild:

- **The build writes a bundle only when its bytes changed.** Rewriting identical bytes bumps the
  mtime, the Harness re-reads the bundle, and a re-read that lands badly is enough to poison it
  for the process — rebuilding the SPA is the common case, and it must not touch these files at
  all. `scripts/build-dsh-plugin.ts` bundles with `write: false` and stages through a comparison
  for exactly this reason.
- **The build never deletes `dist/host.js` or `dist/client.js`.** It replaces the staged SPA and
  overwrites the two modules in place. A build that removes `client.js` out from under a running
  Harness takes every client registration with it — the sidebar entry and the tab body vanish,
  with no error — until the Harness restarts.
- **Derive slot registrations through `ctx.inject`, never `ctx.get` inside `apply`.** A service
  owned by another plugin is a race against activation order; losing it skips every registration
  after the read, silently and permanently.

So the development loop is: rebuild, then — if either half changed — restart the Harness. Rebuilding
without changing either module is free and safe.

## Layout

```
package.json       bundle manifest: the patch, the client half, display metadata
cordis.patch.yml   the one host entry this bundle inserts
icon.svg           the mark the plugin list draws
locale/{en,zh}.json  display title and description
src/host.ts        host half: route, pairing redirect, repository approval, proxy
src/client.ts      client half: sidebar entry, main panel, right-column tab, header button
src/harness.d.ts   ambient types for the Harness plugin surface
dist/              generated: host.js, client.js, web/ (the embedded SPA)
```
