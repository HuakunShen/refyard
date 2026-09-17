# Refyard

**A local-first Git workbench for people who want a beautiful graph without giving a hosted
service their repository.**

[![npm version](https://img.shields.io/npm/v/refyard?logo=npm&label=npm)](https://www.npmjs.com/package/refyard)
[![npm downloads](https://img.shields.io/npm/dm/refyard?logo=npm&label=downloads)](https://www.npmjs.com/package/refyard)
[![CI](https://github.com/HuakunShen/refyard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HuakunShen/refyard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/HuakunShen/refyard)](LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/HuakunShen/refyard)

![Refyard showing the VS Code history graph](docs/assets/vscode-history.png)

_A real read-only session against the public Microsoft VS Code checkout: merge lanes, refs,
authors, and the selected repository all remain visible. The image is a demo fixture, not bundled
Git data._

## The idea

Refyard keeps the privileged part on the machine that owns the repository. Git runs as you, with
your hooks, filters, credential helpers, and SSH configuration; the browser receives a closed JSON
contract and authenticated SSE updates.

```text
your repository + your git + your Node host
                    │ authenticated JSON/SSE
                    ▼
       bundled local UI / hosted Cloudflare UI
```

By default the npm package serves the same static Svelte UI from the loopback Git service, so
`refyard open` is a one-command local workbench. The Cloudflare Worker is an optional asset-only
remote UI host: it has no Git binding, repository path, shell, credential store, bearer token, or
API proxy, and it never receives Git contents.

## What ships

| Surface               | Where it runs                             | What it owns                                    |
| --------------------- | ----------------------------------------- | ----------------------------------------------- |
| `refyard` npm package | Your Node machine                         | Git service plus bundled local workbench        |
| Refyard PWA           | Local loopback or your Cloudflare account | UI, session negotiation, presentation           |
| Git Core              | Trusted TypeScript runtime                | Git intentions, parsers, planners, safety rules |
| Cloudflare Worker     | Cloudflare edge                           | Static assets and secure response headers only  |

The current release line is `0.1.x`. The next package release prepared in this repository is
`0.1.2`; it is published only by the tag-triggered `publish.yml` workflow after its gates pass.

## Run it locally

Development uses Node 26.x and pnpm 11:

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

Start the complete local workbench for one explicitly chosen repository. It serves the bundled UI
and opens the pairing URL in your browser:

```sh
pnpm cli open /absolute/path/to/repository
```

For a machine-readable supervisor, Xross/Kunkun integration, or separately hosted UI, use the
explicit API-only command:

```sh
pnpm cli serve --repo /absolute/path/to/repository --no-open --json
```

The terminal prints a single-use pairing URL. Reads are authenticated too; the token stays in the
browser session and is never placed in `localStorage`. Multiple repositories require repeated,
explicit `--repo` arguments—Refyard never scans a parent directory.

After the npm release, the installed form is:

```sh
npx refyard /absolute/path/to/repository
# or, after a global install:
refyard open /absolute/path/to/repository
```

For local development, run `pnpm dev` to start an empty authenticated launcher. Open a local
repository from the UI, use Browse to choose a folder through the local coordinator, reopen
explicit Recent entries, or use New Tab to switch between multiple approved repositories. Clone
and Create are available under an approved workspace root.

## Deploy the UI to your own Cloudflare account

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/HuakunShen/refyard)

The button creates a Worker deployment in your Cloudflare account from this public repository.
It deploys the static PWA only; it does not move a repository or install the Node API. The same
flow is available from a checkout:

```sh
pnpm deploy
```

The initial `PUBLIC_API_ORIGINS` value is empty by design. If you connect the UI to a remote
machine, expose that machine's loopback API through your own HTTPS tunnel, configure that exact
origin in the Worker, and start the CLI with matching `--allow-origin`, `--ui-origin`, and
`--api-origin` values plus the environment-only `REFYARD_HOSTED_PASSWORD`. There is no central
Refyard relay.

## Release and trust

`ci.yml` is the test workflow. `publish.yml` is the only npm publisher and runs on `v*` tags after
the package build and smoke tests. It uses npm Trusted Publishing through GitHub OIDC with
`environment: publish`; no `NPM_TOKEN` or `NODE_AUTH_TOKEN` is needed.

The package and repository are licensed under the [GNU Affero General Public License v3.0 only](LICENSE).
If you run a modified Refyard service for users over a network, AGPLv3's corresponding-source
requirements apply to that deployment.

## Safety boundary

- Repository roots are approved explicitly and kept separate.
- Destructive actions require confirmation, a backup where possible, and a verified precondition.
- Unknown Git outcomes are reported as unknown and are never retried automatically.
- The browser sends Git intentions; only trusted core creates Git arguments.
- No raw `runGit(args, cwd)`, shell, `cwd`, or `env` crosses the HTTP or browser boundary.
- The complete operation set is the one reported by `GET /api/v1/capabilities`.

## Repository map

| Path                    | Responsibility                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `apps/web`              | SvelteKit shell, static adapter, PWA, asset-only Worker                  |
| `apps/cli`              | CLI grammar, `doctor`, `open`/`serve` lifecycle                          |
| `packages/git-contract` | Public Zod schemas and JSON Schema                                       |
| `packages/git-core`     | Host-free bytes, parsers, planners, workflows                            |
| `packages/host-node`    | Processes, filesystem, registries, coordinator, HTTP host                |
| `packages/git-client`   | Browser/Node HTTP and SSE client                                         |
| `packages/git-ui`       | Reusable Svelte 5 components                                             |
| `packages/npm-dist`     | Self-contained CLI + local-workbench publication staging                 |
| `tests`                 | Contract, core, integration, security, browser, compatibility, packaging |
| `docs`                  | Product decisions, plans, goals, evidence, release instructions          |

More detail lives in [`docs/installation.md`](docs/installation.md), [`docs/releasing.md`](docs/releasing.md),
and [`docs/evidence/release-matrix.md`](docs/evidence/release-matrix.md).
