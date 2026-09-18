# Refyard

**A local-first Git workbench for people who want a beautiful graph without giving a hosted
service their repository.**

[![npm version](https://img.shields.io/npm/v/refyard?logo=npm&label=npm)](https://www.npmjs.com/package/refyard)
[![npm downloads](https://img.shields.io/npm/dm/refyard?logo=npm&label=downloads)](https://www.npmjs.com/package/refyard)
[![CI](https://github.com/HuakunShen/refyard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HuakunShen/refyard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/HuakunShen/refyard)](LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/HuakunShen/refyard)

![The Refyard workbench running against its own repository](docs/assets/desktop-workbench.png)

_Refyard reading this repository itself: one tab strip along the top, the signed history with
its branch lane, the working copy with staged and unstaged files, and the commit box — a real
local session, nothing mocked. The desktop app embeds this exact UI without a web server._

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

| Surface               | Where it runs                             | What it owns                                                       |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `refyard` npm package | Your Node machine                         | Git service plus bundled local workbench                           |
| Native desktop app    | Your machine — release download or source | The same workbench over Tauri IPC; no JS runtime, no localhost hop |
| `refyard-native` CLI  | Your machine, built from source           | Native `doctor`/`serve`/`open` with the same closed contract       |
| Refyard PWA           | Local loopback or your Cloudflare account | UI, session negotiation, presentation                              |
| Git Core              | Trusted TypeScript runtime                | Git intentions, parsers, planners, safety rules                    |
| Cloudflare Worker     | Cloudflare edge                           | Static assets and secure response headers only                     |

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

## The native desktop app and CLI

Alongside the Node runtime, this repository carries a **native** desktop app and a native CLI
(`crates/`, Rust): the same application service and the same closed JSON contract, with the UI
compiled into the app and every Git call driven by the machine's own `git` and OpenSSH. The app
carries no JavaScript runtime, no backend bundle, and no localhost detour — the workbench talks
to the host process over Tauri's IPC, and `pnpm native:verify` fails the build if a JavaScript
engine ever shows up in the bundle. SSH targets are chosen from the machine's own SSH config and
run the system `ssh`; nothing is installed on the remote.

Build from source (macOS arm64 is what the tests cover):

```sh
pnpm desktop:build      # Refyard.app under apps/desktop/src-tauri/target/release/bundle/macos
cargo build --release -p refyard-native   # native CLI at target/release/refyard-native
```

The native CLI mirrors the Node commands and the supervisor contract:

```sh
refyard-native doctor                          # what this machine can do, exit 2 when unusable
refyard-native serve <path> --json --no-open   # API-only; readiness JSON on stdout, pairing URL on stderr
refyard-native open <path>                     # the same plus the static workbench from apps/web/build
```

`--port` (an explicitly requested busy port is refused), `--no-open`, `--json` and
`--ticket-ttl` behave as in the Node CLI. A killed process records its in-flight operation as
`unknown` in the journal (under the platform state directory) and the repository's next write
stays blocked until a person confirms the state in the app. Runtime measurements and budgets
live in `pnpm native:bench` and [`docs/evidence/native-runtime.json`](docs/evidence/native-runtime.json).

### What the native form adds

- **One strip, browser-style.** The repository tabs are the window's topmost layer under an
  overlay title bar; appearance — light/dark, accent, background, glass — lives in the in-app
  Settings sheet instead of spending header space.
- **Native open flows.** A folder opens through the system folder picker or a drag-and-drop
  from Finder; the browser keeps its in-app path picker.
- **SSH without installing anything remotely.** Hosts come from the machine's own SSH
  configuration (parsed, never executed); Git runs through the system `ssh`, and reads work
  against a remote repository with nothing on the far side but OpenSSH and Git.
- **Offline by construction.** Local repositories keep working with the network gone — the app
  holds no network sockets at all, measured under a process-scoped no-network sandbox
  ([acceptance §9.15](docs/acceptance/2026-09-18-native-desktop-ssh.md)).
- **Crash honesty.** A process killed mid-write records that operation as `unknown`, blocks the
  repository's next write, and lifts the block only after an explicit acknowledgement in the UI.

### Releases and install

Pushing an `app-v<version>` tag runs [`release.yml`](.github/workflows/release.yml): the test
contract gates first, then five runners build the app — macOS for Apple Silicon and Intel (DMG),
Linux x86_64 and arm64 (deb, AppImage), Windows x64 (NSIS installer) — and publish the artifacts
to a GitHub release automatically. A Homebrew cask tracks those DMGs
([`packaging/homebrew/Casks/refyard.rb`](packaging/homebrew/Casks/refyard.rb)); once the first
release is published, filling in its sha256 and pushing the cask to
[`HuakunShen/homebrew-tap`](https://github.com/HuakunShen/homebrew-tap) makes it:

```sh
brew install --cask HuakunShen/refyard/refyard
```

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
the package build and smoke tests; `release.yml` is the only desktop publisher and runs on
`app-v*` tags after the same gate, so the two release lines can never be confused. It uses npm Trusted Publishing through GitHub OIDC with
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
| `crates/refyard-core`   | Host-free Git planners, parsers, safety rules (Rust)                     |
| `crates/refyard-host`   | Service, journal, queue, local and SSH providers (Rust)                  |
| `crates/refyard-http`   | Native loopback HTTP entry with the same closed contract (Rust)          |
| `crates/refyard-cli`    | Native CLI: `doctor`, `serve`, `open` (Rust)                             |
| `apps/desktop`          | Tauri desktop shell over the same service; no JS runtime in the bundle   |
| `packages/git-contract` | Public Zod schemas and JSON Schema                                       |
| `packages/git-core`     | Host-free bytes, parsers, planners, workflows (TypeScript)               |
| `packages/host-node`    | Processes, filesystem, registries, coordinator, HTTP host                |
| `packages/git-client`   | Browser/Node HTTP and SSE client                                         |
| `packages/git-ui`       | Reusable Svelte 5 components                                             |
| `packages/npm-dist`     | Self-contained CLI + local-workbench publication staging                 |
| `tests`                 | Contract, core, integration, security, browser, compatibility, packaging |
| `docs`                  | Product decisions, plans, goals, evidence, release instructions          |

More detail lives in [`docs/installation.md`](docs/installation.md), [`docs/releasing.md`](docs/releasing.md),
and [`docs/evidence/release-matrix.md`](docs/evidence/release-matrix.md).
