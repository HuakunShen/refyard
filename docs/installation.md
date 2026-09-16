# Installing refyard

`refyard` runs on the machine that holds the repository and exposes an authenticated backend API
for **that machine's own `git`**. The browser UI is a separately deployed static PWA (Cloudflare
Workers Static Assets in the supported deployment shape); the CLI package never hosts it. The
published API package and the separately deployed UI are released independently.

## Requirements

| Requirement | Version           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node        | >=22 <27          | The published `engines` range. The packaged CLI serves, pairs, reads, previews and stages under 22.11.0, 22.23.2, 24.10.0, 25.2.1 and 26.8.2 — and under 20.19.0, which the range leaves out because Node 20 is past end of life. Development and releases run 26.8.2 (`.nvmrc`). The product imports only long-stable builtins (`node:path`, `node:fs`, `node:http`, `node:crypto`, `node:net`, `node:os`, `node:url`, `node:readline`, `node:stream/promises`). |
| Git         | 2.43.0 or newer   | That is the functional baseline `refyard doctor` reports against. Below it, doctor still probes the features refyard uses (`status --porcelain=v2`, `worktree list -z`, `cat-file --batch`, `push --porcelain`) and names any that are missing instead of failing later.                                                                                                                                                                                          |
| A browser   | any current build | Needed only when using the separately deployed PWA; the CLI itself is API-only.                                                                                                                                                                                                                                                                                                                                                                                   |

Nothing installs a system service, touches your global Git configuration, or adds a
`postinstall` script. The tarball has no dependencies at all: the CLI bundle contains
the workspace packages it needs.

## Build the tarball

```sh
pnpm install
pnpm build            # builds the static UI (apps/web/build)
pnpm build:release    # bundles the API-only CLI and stages packages/npm-dist
pnpm pack:smoke       # packs it, installs it into a temporary HOME, and uses it
```

`pnpm build:release` refuses to ship a manifest that declares dependencies or install scripts. The
staging directory keeps only `package.json` as source; `bin/` and `dist/` are generated and ignored
by Git. The UI is not copied into the npm artifact.

To produce the tarball yourself without the smoke test:

```sh
npm pack ./packages/npm-dist --pack-destination /tmp
# /tmp/refyard-0.0.0.tgz
```

## Install and run

From a tarball — no registry involved, and `--offline` proves it:

```sh
mkdir -p /tmp/refyard-install && cd /tmp/refyard-install
npm exec --yes --offline --package=/tmp/refyard-0.0.0.tgz -- refyard --version
```

Or install it into a project and use the bin:

```sh
npm install --no-save /tmp/refyard-0.0.0.tgz
npx refyard doctor
```

### Commands

```sh
refyard [path]                              # start the API for a repository
refyard open [path] [options]               # the same, spelled out
refyard serve --repo <path>... [options]     # serve one or more approved repositories
refyard doctor [--json]                     # report what this machine can do
```

| Option                    | Meaning                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--repo <path>...`        | Repository to serve. Repeat for multiple explicit roots; required by `serve`; a bare path also works.                 |
| `--port <n>`              | Loopback port. Default `9595`; if that is busy another free port is taken and named; `0` asks the OS for one.         |
| `--ticket-ttl <s>`        | Pairing-ticket lifetime in seconds. Default 60, maximum 86400.                                                        |
| `--allow-origin <origin>` | Exact hosted UI origin allowed to call the API; repeatable, never `*`.                                                |
| `--ui-origin <origin>`    | Origin where the separately deployed UI receives the pairing URL.                                                     |
| `--api-origin <origin>`   | Browser-visible API origin, normally the HTTPS tunnel URL used by the UI.                                             |
| `REFYARD_HOSTED_PASSWORD` | Environment-only secret, required for every non-loopback allowed origin; minimum 12 characters, never an argv option. |
| `--no-open`               | Do not launch a browser.                                                                                              |
| `--json`                  | Machine output: one JSON object on stdout, pairing URL on stderr.                                                     |
| `--allow-root`            | Permit running as root. Off by default, because Git hooks would run with root privileges.                             |

### Pairing

The default service binds to `127.0.0.1` only and every HTTP call is authenticated, reads included.
The first browser is paired by the URL printed at startup when a UI origin is configured:

```
  open this URL in your browser to pair this session:
    https://ui.example.test/?api=https%3A%2F%2Fapi.example.test&pair=<ticket>
```

The ticket is single-use and expires (`--ticket-ttl`). For a second browser — or after
the first one lost its session — press `p` and Enter in the serving terminal to print
a fresh URL. Each printed URL is single use; the terminal is the channel, so a pairing
URL never appears in the machine-readable output.

When `--allow-origin` or `--ui-origin` names a non-loopback origin, the CLI refuses to start
unless `REFYARD_HOSTED_PASSWORD` is set. The hosted page submits that password only with the
single ticket exchange; the service stores only a memory-only scrypt hash, rate-limits attempts,
and returns the normal in-memory bearer for later requests. The password is not put in argv, the
pairing URL, logs, `localStorage`, or a Cloudflare Worker binding.

`--json` keeps stdout parseable and ticket-free. Readiness identifies the process as API-only:

```sh
refyard serve --repo /path/to/repo --no-open --json
# stdout: {"serviceInstanceId":"srvc_…","port":9595,"url":"http://127.0.0.1:9595",…,"apiOnly":true}
# stderr: pairing URL (single use): http://127.0.0.1:9595/?pair=…
```

### Cloudflare Worker deployment

The public repository includes a root-level adapter for Cloudflare's Deploy to Cloudflare button.
It builds `apps/web` and deploys the existing asset-only Worker; it never deploys the Node Git API:

```sh
pnpm deploy
```

Maintainers can still deploy directly from `apps/web`, and should dry-run before a real deploy:

```sh
pnpm build
pnpm --dir apps/web exec wrangler deploy --dry-run
# Set PUBLIC_API_ORIGINS in the selected Wrangler config to the exact HTTPS tunnel origin first.
pnpm --dir apps/web exec wrangler deploy
```

For a fresh self-deploy, use the README's **Deploy to Cloudflare** button. The deployed Worker
belongs to the user's Cloudflare account and starts with an empty `PUBLIC_API_ORIGINS` value, so
the browser cannot call an arbitrary backend until the owner explicitly configures an HTTPS API
origin.

The Worker serves only `apps/web/build`, has no Git or API binding, refuses `/api/*` with JSON
404, and publishes security headers from `apps/web/static/_headers`. A Worker cannot call a
user's loopback address. For a remote browser, the operator must separately provide an HTTPS
tunnel to the CLI and pass the same exact UI origin to `--allow-origin` and `--ui-origin`, plus
the browser-visible tunnel origin to `--api-origin`. Set the Worker `PUBLIC_API_ORIGINS` value to
that exact HTTPS API origin so its CSP permits only the configured endpoint. The tunnel
configuration is operator-owned; do not bypass the CLI's Host, Origin, bearer, or ticket checks.

Example backend invocation (the secret is supplied by the environment, not copied into the
command arguments):

```sh
REFYARD_HOSTED_PASSWORD='use-a-long-random-value' \
  refyard serve --repo /path/to/repo --no-open --json \
  --allow-origin https://app.refyard.example \
  --ui-origin https://app.refyard.example \
  --api-origin https://api.refyard.example
```

## Stopping

`refyard serve` and `refyard open` run in the foreground. Ctrl+C (SIGINT) or SIGTERM
stops accepting new requests, closes the listener and exits 0. Closing the browser tab
does not stop the server: a commit in flight is never cancelled by a page going away.

## When something is wrong

| Symptom                                             | What to do                                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refyard: git was not found`                        | Install Git, or point `REFYARD_GIT` at the executable. `refyard doctor` prints which check failed.                                                                                     |
| `port 9595 is already in use`                       | You asked for that port with `--port` and another program holds it — refyard never reuses an unknown listener. Without `--port`, the service takes a free port instead and says which. |
| The UI shows "Not connected" after the port changed | The session was paired with the old API origin. Open a fresh pairing URL printed by the terminal.                                                                                      |
| A hosted HTTPS page cannot call `http://127.0.0.1`  | A public page cannot reach another machine's loopback, and browsers block mixed content/PNA. Configure an HTTPS tunnel and pass `--api-origin`; never widen CORS to `*`.               |
| `doctor` reports a feature as unsupported           | That Git build lacks something refyard needs (a very old Git, or a limited bundled build). Upgrade Git.                                                                                |
| The service exits immediately under `--json`        | It prints the reason to stderr; stdout is JSON only, so a supervisor should read stderr for diagnostics.                                                                               |

## Uninstalling

Remove the package directory (or `npm uninstall refyard`) and delete the state
directory refyard keeps for its journal and backups:

- macOS: `~/Library/Application Support/refyard`
- Linux and other Unix: `$XDG_STATE_HOME/refyard`, or `~/.local/state/refyard`
- Windows: `%LOCALAPPDATA%\refyard`

The location can be pinned with `REFYARD_STATE_DIR`. It holds the operation journal,
the recovery backups taken before destructive operations, and the session state; the
fallback to the temporary directory only happens in an environment with no home
directory at all, where something is better than a service that cannot start.

Nothing else is written outside the repositories you opened.
