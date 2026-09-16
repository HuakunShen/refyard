# refyard

A backend API for a browser workbench against Git repositories **on this machine**. It runs the
`git` you already have, against repositories you explicitly approve. The static PWA is deployed
separately from `apps/web`; this package never ships or serves the UI.

This release is `0.1.2`. The package is published from the tagged GitHub Actions workflow using
npm Trusted Publishing (OIDC); no npm token is required in the repository.

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
# Start the API and print a pairing URL for a separately served UI.
npx refyard serve --repo /path/to/repo --no-open --ticket-ttl 600

# Multiple repositories are always approved explicitly, one root per path.
npx refyard serve --repo /path/to/one --repo /path/to/two --no-open
```

The API prints a **pairing URL** for a UI host. Each ticket is single use; `serve` can print another
(press `p` then Enter) and `--ticket-ttl` extends how long one lives (60 seconds by default).

For the Cloudflare Worker UI, expose the API through an operator-owned HTTPS tunnel and configure
the exact origins. The tunnel must forward to this loopback listener and preserve the API's
authentication; it must not expose a second unauthenticated route:

```sh
npx refyard serve --repo /path/to/repo --no-open \
  --ui-origin https://ui.example.test \
  --api-origin https://api.example.test \
  --allow-origin https://ui.example.test
```

Installed globally, the command is just `refyard`:

```sh
npm install --global refyard
refyard serve --repo /path/to/repo --no-open
```

Check the installation with:

```sh
refyard doctor --json     # node, git, and one probe per Git feature the service gates on
```

## How it behaves

- **Loopback by default.** The service binds `127.0.0.1` and refuses foreign `Origin`/`Host`
  headers. Hosted browser access is opt-in, requires an exact `--allow-origin`, and still needs
  an HTTPS endpoint such as an operator-owned tunnel; a public Worker cannot reach loopback by
  itself.
- **Everything is authenticated**, reads included. Pairing exchanges a single-use ticket for an
  in-memory bearer token that never touches disk.
- **It runs your `git`, as you.** Hooks, filters, credential helpers and your SSH configuration all
  apply. Destructive operations (discard, worktree removal, stash drop/pop, branch delete) ask for
  confirmation, back up what could be lost first, and refuse to run when a precondition cannot be
  verified.
- **Repositories are approved explicitly.** The service can only reach directories you handed it;
  every `--repo` is its own approved root.
- **Unknown is reported as unknown.** If Git's outcome cannot be determined, the operation is
  reported as needing attention rather than as succeeded, and it is never retried automatically.

## What it does not do

No Git backend in Cloudflare, no built-in terminal, no plugin host, no credential storage. The
complete set of operations this build implements is whatever `GET /api/v1/capabilities` returns
from your installation — anything absent from that list is not implemented, not hidden.

## License

This package is licensed under the GNU Affero General Public License v3.0 only
([AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html)). See the repository's
[LICENSE](https://github.com/HuakunShen/refyard/blob/main/LICENSE) for the complete terms.
