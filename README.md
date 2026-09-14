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

**M1 — the read-only loop.** The service starts, authenticates a browser, and reads a real
repository: status, history graph, diff, refs, worktrees, submodules, stashes. The journal, queue,
idempotency and precondition machinery for writes exists and is tested, but **no mutation is
exposed**: the capability list omits it, there is no route, and the UI has no button for it.

Round 1 covers T01–T07 of `docs/plans/0001-refyard-v2-m1-read-only.md`. Writes (T08+), packaging
(T13), the PWA shell (T14), release gates (T15), and the Xross/Kunkun/native-host integrations are
later rounds.

## Usage forms

Refyard is meant to be used in four ways. Only the first ships today; the other three are recorded
in `docs/product/north-star.md` with their requirements, so a later change cannot quietly make them
impossible.

| #   | Form                                    | Status                                           |
| --- | --------------------------------------- | ------------------------------------------------ |
| 1   | Local workbench (`refyard open <path>`) | Implemented for reads                            |
| 2   | Managed workspaces (many repositories)  | Planned — explicit approval, never disk scanning |
| 3   | Hosted UI against a local host          | Planned — opt-in, origin allowlist, password     |
| 4   | Embedded core inside a native host      | Core is already host-free; no native shell yet   |

A separate axis, also decided but not built: an OpenAPI document (`hono-openapi`) with a Scalar API
reference, and an MCP endpoint (`@hono/mcp`) exposing read tools only — never `run_git(args)`.

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

The pairing URL carries a single-use ticket in its fragment; the page exchanges it for an
in-memory bearer token and clears the fragment. Reads are authenticated too, and the service binds
to loopback only.

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
