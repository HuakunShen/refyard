# Plan: VS Code extension (single-repository workbench)

Companion to `specs/2026-09-19-vscode-extension.md`. Every milestone ends runnable and
verified; M1 exists to kill the spec's one load-bearing assumption before anything is
built on it.

## V1 — Supervisor spike (kills the assumption)

Vitest integration test, real CLI on a fixture repo: spawn
`refyard-native serve --json --port 0 <repo>`, parse the stdout readiness JSON, exchange
the ticket over Node fetch (no `Origin` header), perform an authenticated
`GET /api/v1/repositories` + `status`. RED first against the current server; if the auth
layer refuses a machine client, the fix is an explicit machine-client rule in the CLI's
HTTP auth (tested, documented), never a client-side workaround. Deliverable: the
readiness→bearer→read path as a tested library (`apps/refyard-vscode/src/backend/`).

## V2 — Extension shell

`apps/refyard-vscode/`: package.json (activation `onStartupFinished` + folder heuristic),
esbuild host bundle, commands (`Open Workbench`, `Refresh`, `Shutdown Service`), status
bar item, CLI lifecycle (spawn on first panel open, `--port 0`, SIGTERM on teardown,
`refyard.cliPath` setting), webview panel scaffolding with CSP + localResourceRoots.
Verify: `@vscode/test-cli` run opens the panel against a fixture repo and reports live.

## V3 — Read-only workbench panel

Vite-built Svelte entry importing `@refyard/git-ui`: Working Copy lists + diff pane,
History (list + graph + filters), Refs — single repo, no tabs/launcher. Message bridge:
typed requests (git-contract schemas validate every answer) and forwarded SSE frames;
queries cached client-side in the webview. Verify: vitest bridge tests + a manual
screenshot pass against the app fixture repo recorded in `docs/evidence/`.

## V4 — Writes

Stage/unstage/commit through the same mutation path, including preview-confirmed discard
and the uncertain-outcome panel reused verbatim. Verify: e2e-style extension test staging
and committing in a fixture repo; assertion that a refused write shows the service's own
problem, never a generic error.

## V5 — Packaging and release wiring

`vsce package` → `refyard-<version>.vsix`; release.yml gains a job building and attaching
the `.vsix` on `app-v*` tags (extension version tracks the app version line); README
section (install from `.vsix`, CLI requirement, what it shows). Verify: `.vsix` installs
in a clean VS Code, panel works against a brewed CLI.

## V6 — Out of scope, named

Multi-repo tabs, remote/SSH targets in the panel, marketplace publishing, the hosted-UI
origin allowlist — each stays out until asked, per the single-repo ask.
