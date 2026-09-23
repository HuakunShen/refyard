# git-ui Package

**Updated: 2026-09-23** — page created; recent delta noted.

`packages/git-ui` — the Svelte 5 component library that renders the closed contract for **every** form: browser PWA, native desktop, and the VS Code extension.

## Rules

- **Must not import `$app/*`.** Only `apps/web` owns SvelteKit composition, routing, and the connection config — that is what lets Kunkun and the VS Code extension reuse the components unchanged.
- Components take an **injected `GitService`** — they never know whether transport is HTTP+SSE or Tauri IPC.
- Styling: shadcn-svelte on the Neutral/Zinc token set (see `Services/Workbench UI and Sessions.md` for the exact light/dark values).

## Recent activity

- `SettingsDialog.svelte` modified alongside the provider connect flow (host-side connect UI behind the `provider:manage` gate); had an untracked working-tree edit at bootstrap time (2026-09-23).
- Pull-requests panel with gated sidebar view (`efcb10c`).
- Context-menu actions: drop commit (`1aa3cd0`), squash tip (`9b86fc3`) — both with Playwright e2e replay coverage.

## Related pages

- `Architecture/Architecture.md` — why injection, not imports
- `Services/Workbench UI and Sessions.md` — theme and session decisions
