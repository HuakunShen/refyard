# System Overview

**Created: 2026-09-23** — initial wiki bootstrap.

Refyard is a local-first Git workbench: the whole history of a repository in a beautiful graph, without handing a hosted service the repository. It drives **the machine's own `git`** — run as the user, with their hooks, filters, credential helpers, and SSH configuration — and the UI receives a closed JSON contract plus authenticated SSE updates.

## One product, two runtimes (then four forms)

- **Native desktop app + CLI (Rust / Tauri 2)** — the headline form. Git engine is Rust (`crates/`), UI compiled in, talks over Tauri IPC, bundles **no JavaScript runtime** (`pnpm native:verify` fails the build if one appears). Opens local repos and remote repos over SSH using the machine's own `~/.ssh/config`; nothing is installed on the remote.
- **Node CLI (`refyard open|serve|doctor`)** — serves an authenticated loopback HTTP API plus the static SvelteKit workbench from one local origin; the same UI also deploys as a static PWA to Cloudflare.
- Two further forms — managed workspaces and an opt-in hosted UI — plus an embedded-core form are specified in `docs/product/north-star.md` (§4–§6). A separate **provider axis** (opt-in forge connections, GitHub first, read-only first) is north-star §8.

Both runtimes speak **one closed contract** rendered by one Svelte component library (`packages/git-ui`), which the VS Code extension (`apps/refyard-vscode`) also embeds.

## Repository map (top level)

| Path | Role |
| --- | --- |
| `apps/web` | SvelteKit static shell: routes, connection config, service worker |
| `apps/cli` | argv parsing, doctor, open/serve lifecycle |
| `apps/desktop` | Tauri 2 package; reuses apps/web's Svelte build |
| `apps/docs` | published docs site (Fumadocs on Astro → docs.refyard.huakun.tech) |
| `packages/git-contract` | Zod schemas → DTOs → JSON Schema (single source) |
| `packages/git-core`, `git-graph` | host-free planners/parsers, pure-TS DAG layout |
| `packages/host-node` | coordinator, journal, HTTP service, adapters |
| `packages/git-provider` | opt-in forge integration (GitHub REST, device flow) |
| `packages/git-client`, `git-ui` | browser/HTTP+SSE client; Svelte 5 components |
| `crates/refyard-*` | Rust contract/core/host/http/cli for the native form |

## Toolchain

Node 26.8.2 (dev/CI), pnpm 11.25.0 workspace + turborepo, TypeScript 7.0.2 strict, Zod 4, Vitest 4, Playwright, tsdown/esbuild, bun 1.4.0 for dev scripts only, Rust 1.98.0 (edition 2021).

## Where to go next

- Architecture and safety invariants → `Architecture/Architecture.md`
- Recent provider work → `Services/Git Provider Integration.md`
- Recent docs-site / packaging work → `Services/Documentation Site.md`, `Infrastructure/Release and Packaging.md`
