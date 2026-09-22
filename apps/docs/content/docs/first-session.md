---
title: First session
description: Open a repository, pair a browser, and understand what the workbench is showing you.
---

## Open a repository

From a terminal, in or above the repository:

```sh
npx refyard open /path/to/repository
```

`refyard open` starts a service on loopback, prints a pairing URL, and opens it in your
browser. The URL carries a single-use ticket: the browser spends it once and keeps an
in-memory session token for that service process.

Nothing is copied or indexed ahead of time. Refyard reads the repository with the machine's
own `git`, in place.

<Callout title="Several repositories at once">
`refyard serve --repo a --repo b` approves more than one root; each becomes a tab in the
workbench and a row in the Repositories panel.
</Callout>

## Pair another browser without restarting

A pairing ticket is single-use by design, and the service only mints new ones on trusted
local channels — never over HTTP. To hand a fresh URL to another browser, ask the running
service from a terminal on the same machine:

```sh
refyard pair              # prints a fresh pairing URL for the service on this machine
refyard pair --port 9595  # when more than one service is running
refyard pair --json       # machine-readable
```

`refyard pair` talks to the service over a same-user-only control socket, so it needs no
terminal interaction and no restart. The `p` keystroke on the serving terminal does the same
thing for whoever is sitting in front of it.

## What you are looking at

| Area            | What it does                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Repository tabs | One tab per approved repository, restored on reload.                                                |
| History         | The commit graph, refs, search and filters — see [History](/workbench/history/).             |
| Working copy    | Staged, unstaged and untracked paths, with per-file diffs — see [Working copy](/workbench/working-copy/). |
| Panel rail      | Branches, Remotes, Stashes, Tags, Worktrees, Submodules — see [Panels](/workbench/panels/).  |
| Right panel     | The selected commit's details and diff, or the working copy's commit box.                            |
| Status badge    | Live-update state: `live updates`, `connecting…`, or `no live updates`.                              |

Live updates arrive over an authenticated event stream, so the graph, the status and the
panels follow the repository while it changes — including changes made in a terminal or an
IDE next to you.

## If something looks wrong

The workbench never guesses. When a read has no answer it says which read failed; when a
write's outcome is unknown it says so and refuses to continue with dependent writes. See
[Troubleshooting](/troubleshooting/).
