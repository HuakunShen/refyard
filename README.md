# Refyard

A browser-native Git workbench. Git runs on the machine that owns the repository; the UI is a
static Svelte app; a small Node service is the only thing that talks to `git`.

```
Browser (SvelteKit static SPA)
      │  GitService: JSON DTO + HTTP + authenticated SSE
Node coordinator: auth, scope, jobs, journal, lifecycle
      │  trusted TypeScript Git Core: planners / parsers / workflows
      │  GitHostPort: commands, approved I/O, text codec, cancellation
system git CLI → this machine's repository, credentials, hooks
```

> **`refyard` is a working name.** It is not a published npm package, domain, or organization.
> Do not run a remote package that happens to share the name; integration testing uses locally
> built artifacts.

## Status

**V2 — the local API and hosted PWA boundary.** The service starts, authenticates a browser, and
reads a real repository: status, history graph, diff, refs, worktrees, submodules and stashes. It
also exposes explicitly registered mutation effects and managed-workspace approval through the
closed GitService contract, with Hono/OpenAPI/Scalar/read-only MCP, the Cloudflare Worker hosting
the static PWA, and the CLI remaining API-only.

The current round also records the Xross and Kunkun integration seams, and closes the native-host
question with a measured decision to stay on Node. A real Xross peer, out-of-tree Kunkun install,
live Cloudflare deployment, and WebKit-on-Linux dependency install remain separately identified
as unverified.

## Usage forms

Refyard is meant to be used in four ways. Forms 1 and 2 ship locally; form 3 has an opt-in
password-gated path but no live deployment; form 4 is deliberately deferred after the measured
decision to stay on Node. The requirements and evidence boundaries live in `docs/product/north-star.md`.

| #   | Form                                    | Status                                           |
| --- | --------------------------------------- | ------------------------------------------------ |
| 1   | Local workbench (`refyard open <path>`) | Implemented with reads and registered writes   |
| 2   | Managed workspaces (many repositories)  | Implemented — explicit approval, never scanning |
| 3   | Hosted UI against a local host          | Local exact-origin + password path; live deployment unverified |
| 4   | Embedded core inside a native host      | Measured decision: stay on Node; no native shell |

The machine-facing API is discoverable through an OpenAPI document (`hono-openapi`) and Scalar;
`@hono/mcp` exposes only bounded read tools — never `run_git(args)` or a mutation escape hatch.

## Getting started

Requires **Node 26.x** (`nvm use`) and pnpm 11.

```bash
pnpm install
pnpm check            # types across every package
pnpm test             # contract, core, graph, node, integration
pnpm test:portable    # neutral-runtime smoke for the host-free core
pnpm build            # static web bundle + CLI bundle
```

Run the read-only service against a repository:

```bash
pnpm cli open ~/code/your-repo     # starts the service and prints a pairing URL
pnpm cli serve --no-open --repo .  # service only
```

The pairing URL carries a single-use ticket in its query or fragment; the page exchanges it for an
in-memory bearer token and clears the URL. Hosted origins additionally require the environment-only
`REFYARD_HOSTED_PASSWORD` during that one exchange. Reads are authenticated too, and the service
binds to loopback only unless an exact origin and HTTPS/tunnel setup are explicitly configured.

## Repository layout

| Path                    | Responsibility                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `apps/web`              | SvelteKit shell: routes, runtime connection config, static adapter     |
| `apps/cli`              | argv parsing, `doctor`, `open`/`serve` lifecycle                       |
| `packages/git-contract` | public Zod schemas, inferred DTOs, semantic validation (single source) |
| `packages/git-core`     | bytes / parse / plan / workflows — no host APIs                        |
| `packages/git-graph`    | pure DAG lane layout                                                   |
| `packages/host-node`    | process, filesystem, registry, coordinator, journal, HTTP host         |
| `packages/git-client`   | browser and Node HTTP + SSE client for `GitService`                    |
| `packages/git-ui`       | Svelte 5 components behind an injected `GitService`; no `$app/*`       |
| `tests/`                | contract, core, graph, node, integration, portable, e2e, security      |
| `docs/`                 | `product/north-star.md`, `plans/`, `goals/`, `evidence/`, `research/`  |

## Safety rules that outrank convenience

These are enforced in code and reviewed in every task; `AGENTS.md` states them in full.

- Every test that writes Git state uses an isolated temporary repository. No experiment runs in a
  real repository.
- Destructive operations require explicit confirmation, back up what can be lost first, and fail
  closed when a precondition cannot be verified.
- Discard restores tracked working-tree files to the **index** — never to HEAD, never untracked or
  ignored files, never `git clean`.
- User hooks, signing configuration, filters and SSH host verification are preserved. No
  `--no-verify`, no `commit.gpgSign=false`, no rewriting global Git config.
- Unknown results are reported as unknown. An operation that may have had a side effect is never
  retried automatically and never labelled `succeeded`.
- The browser sends intentions; only trusted core turns them into `git` argv. No `runGit`, shell,
  `cwd` or `env` crosses a network boundary, ever.

## Documentation

- `docs/product/north-star.md` — the four forms, the invariant spine, and the decisions that keep
  them compatible.
- `docs/plans/0001-refyard-v2-m1-read-only.md` — the active plan (T01–T07).
- `docs/goals/` — the goal brief for the current round.
- `docs/evidence/` — verification records for completed milestones.
- `docs/discussions/` — raw records of design conversations, kept non-normative.
- `references/ai-chat/2026-09-14/` — the delivered v2 design package (read-only baseline).
