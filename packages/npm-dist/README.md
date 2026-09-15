# refyard

A browser workbench for a Git repository **on this machine**. It starts a local service that
serves a web UI and talks to the `git` you already have, against repositories you explicitly
approve. Nothing is uploaded, and there is no hosted component.

## Requirements

- **Node 22 or newer** (`engines`: `>=22 <27`). Development and releases run on 26.8.2. The
  packaged CLI serves, pairs, reads, previews and stages correctly under 22.11.0, 22.23.2,
  24.10.0, 25.2.1 and 26.8.2 — and under 20.19.0 as well, which the range leaves out only
  because Node 20 is past end of life.
- **git 2.43 or newer** for the full operation set. Older Git still works for most of it:
  `refyard doctor --json` reports `featureVersionSupported` and lists which probes your Git
  supports, and the service then omits the operations it cannot run instead of failing later.
- macOS, Linux or Windows.

## Run it

```sh
# Open a repository in the browser (picks the default port, opens the page for you).
npx refyard open /path/to/repo

# Or start it without opening a browser and print a pairing URL yourself.
npx refyard serve --repo /path/to/repo --no-open --ticket-ttl 600
```

The first run prints a **pairing URL** — open it to connect the page to the service. Each ticket is
single use; `serve` can print another (press `p` then Enter) and `--ticket-ttl` extends how long one
lives (60 seconds by default).

Installed globally, the command is just `refyard`:

```sh
npm install --global refyard
refyard open /path/to/repo
```

Check the installation with:

```sh
refyard doctor --json     # node, git, and one probe per Git feature the service gates on
```

## How it behaves

- **Loopback only.** The service binds `127.0.0.1` and refuses foreign `Origin`/`Host` headers.
  There is no flag that widens this.
- **Everything is authenticated**, reads included. Pairing exchanges a single-use ticket for an
  in-memory bearer token that never touches disk.
- **It runs your `git`, as you.** Hooks, filters, credential helpers and your SSH configuration all
  apply. Destructive operations (discard, worktree removal, stash drop/pop, branch delete) ask for
  confirmation, back up what could be lost first, and refuse to run when a precondition cannot be
  verified.
- **Repositories are approved explicitly.** The service can only reach directories you handed it.
- **Unknown is reported as unknown.** If Git's outcome cannot be determined, the operation is
  reported as needing attention rather than as succeeded, and it is never retried automatically.

## What it does not do

No hosted or remote service, no built-in terminal, no plugin host, no credential storage. The
complete set of operations this build implements is whatever `GET /api/v1/capabilities` returns
from your installation — anything absent from that list is not implemented, not hidden.

## License

`UNLICENSED` — this package is proprietary. Publishing it here makes it **installable**, not
usable: no license is granted to use, copy, modify or redistribute it. See the package metadata.
