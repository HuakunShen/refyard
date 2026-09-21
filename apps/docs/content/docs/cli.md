---
title: "refyard open | serve | pair | doctor"
description: The CLI reference — what each command does, its flags, and the exit codes.
---

## `refyard open [path]`

Starts the service for a repository (or several), prints a pairing URL and opens the
workbench in your browser. The same as `refyard [path]`.

```sh
refyard open ~/code/my-project
refyard serve --repo a --repo b --port 9595 --no-open
```

| Flag               | Meaning                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `--repo <path>`    | A repository to serve. Repeat for several; each becomes a tab.                                                    |
| `--port <n>`       | Loopback port. Default 9595; a busy default takes another free port and says which; an explicitly requested busy port is refused. `0` asks the OS. |
| `--ticket-ttl <s>` | Pairing ticket lifetime in seconds. Default 60, maximum 86400.                                                     |
| `--no-open`        | Do not open a browser.                                                                                            |
| `--json`           | One JSON object on stdout (no ticket); the pairing URL goes to stderr, so a log scraper never captures it.          |
| `--allow-origin`   | Exact hosted browser origin allowed to call the API (opt-in hosted form).                                          |
| `--ui-origin`      | A separately deployed UI origin that should receive the pairing URL.                                               |
| `--api-origin`     | The browser-visible API origin, required for a remote UI.                                                          |
| `--allow-root`     | Permit running as root; off by default.                                                                            |

`REFYARD_HOSTED_PASSWORD` is the environment-only secret required for non-loopback origins.
It is never accepted as an argument, never placed in a URL and never logged.

## `refyard serve`

Serves the API without opening a browser. `--repo` is required. Everything else matches
`open`.

## `refyard pair`

Mints a fresh pairing URL for a service that is already running, over a control socket only
the same user can reach:

```sh
refyard pair                 # the single running service
refyard pair --port 9595     # when several are running
refyard pair --json
```

This is the answer to a spent ticket: pairing tickets are single-use, and the service only
mints new ones on trusted local channels — the `p` keystroke on the serving terminal, or
this command. **No HTTP route mints a ticket**, which is why a browser cannot ask for one.

## `refyard doctor`

Reports what this machine can do: the `git` it finds and its version, the platform, the
service's capabilities, and whether anything required is missing. `--json` prints the same
as an object. Exit code `2` means the environment is unusable.

```sh
refyard doctor --json
```

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | The command completed.                                                 |
| 1    | The command failed (bad flags, a port it was told to use is busy, …).  |
| 2    | `doctor` found an environment that cannot run the product.             |
