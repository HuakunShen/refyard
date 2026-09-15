# Installing refyard

`refyard` runs on the machine that holds the repository, serves a browser UI on
loopback, and runs **that machine's own `git`**. It is not a service, not a hosted
product, and not published to a registry: you build a tarball from this repository and
install that.

## Requirements

| Requirement | Version           | Why                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node        | >=22 <27          | The published `engines` range. The packaged CLI serves, pairs, reads, previews and stages under 22.11.0, 22.23.2, 24.10.0, 25.2.1 and 26.8.2 — and under 20.19.0, which the range leaves out because Node 20 is past end of life. Development and releases run 26.8.2 (`.nvmrc`). The product imports only long-stable builtins (`node:path`, `node:fs`, `node:http`, `node:crypto`, `node:net`, `node:os`, `node:url`, `node:readline`, `node:stream/promises`). |
| Git         | 2.43.0 or newer   | That is the functional baseline `refyard doctor` reports against. Below it, doctor still probes the features refyard uses (`status --porcelain=v2`, `worktree list -z`, `cat-file --batch`, `push --porcelain`) and names any that are missing instead of failing later.                                                                        |
| A browser   | any current build | The UI is a static SPA served over loopback; `--no-open` skips launching it.                                                                                                                                                                                                                                                                    |

Nothing installs a system service, touches your global Git configuration, or adds a
`postinstall` script. The tarball has no dependencies at all: the CLI bundle contains
the workspace packages it needs.

## Build the tarball

```sh
pnpm install
pnpm build            # builds the static UI (apps/web/build)
pnpm build:release    # bundles the CLI and stages packages/npm-dist
pnpm pack:smoke       # packs it, installs it into a temporary HOME, and uses it
```

`pnpm build:release` refuses to stage a package when the UI build is missing, and
refuses to ship a manifest that declares dependencies or install scripts. The staging
directory keeps only `package.json` as source; `bin/`, `dist/` and `web/` are
generated and ignored by Git.

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
refyard [path]                              # open the workbench for a repository
refyard open [path] [options]               # the same, spelled out
refyard serve --repo <path> [options]       # serve without opening a browser
refyard doctor [--json]                     # report what this machine can do
```

| Option             | Meaning                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--repo <path>`    | Repository to serve. Required by `serve`; for `open` a bare path argument does the same.                      |
| `--port <n>`       | Loopback port. Default `9595`; if that is busy another free port is taken and named; `0` asks the OS for one. |
| `--ticket-ttl <s>` | Pairing-ticket lifetime in seconds. Default 60, maximum 86400.                                                |
| `--no-open`        | Do not launch a browser.                                                                                      |
| `--json`           | Machine output: one JSON object on stdout, pairing URL on stderr.                                             |
| `--allow-root`     | Permit running as root. Off by default, because Git hooks would run with root privileges.                     |

### Pairing

The service binds to `127.0.0.1` only and every HTTP call is authenticated, reads
included. The first browser is paired by the URL printed at startup:

```
  open this URL in your browser to pair this session:
    http://127.0.0.1:9595/?pair=<ticket>
```

The ticket is single-use and expires (`--ticket-ttl`). For a second browser — or after
the first one lost its session — press `p` and Enter in the serving terminal to print
a fresh URL. Each printed URL is single use; the terminal is the channel, so a pairing
URL never appears in the machine-readable output.

`--json` keeps stdout parseable and ticket-free:

```sh
refyard serve --repo /path/to/repo --no-open --json
# stdout: {"serviceInstanceId":"srvc_…","port":9595,"url":"http://127.0.0.1:9595",…}
# stderr: pairing URL (single use): http://127.0.0.1:9595/?pair=…
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
| The UI shows "Not connected" after the port changed | The session was paired with the old origin. Open the new pairing URL printed by the terminal.                                                                                          |
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
