# Spec: Refyard VS Code extension (single-repository workbench)

**Date:** 2026-09-19 · **Status:** spec + plan; implementation follows the milestones in
the companion plan · **Owner:** HuakunShen

One ask: inside VS Code, show **the currently opened repository** as a Refyard workbench —
status, history, diffs, stage/unstage/commit. No multi-repository tabs this time. Reuse
what the repo already has; redesign what does not fit.

## 1. The reuse map (what already exists and travels)

| Existing piece                                     | Travels to the extension? | Why                                                                    |
| -------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `@refyard/git-ui` Svelte 5 components              | **Yes, as-is**            | Pure props, no `$app/*`, no host APIs — built for exactly this          |
| `@refyard/git-contract` Zod schemas                | **Yes, as-is**            | Every webview→host answer is validated at the same boundary             |
| `@refyard/git-client` Node HTTP+SSE client         | **Yes** (extension host side) | Node fetch/SSE is the extension host's home turf                   |
| `refyard-native` CLI (`crates/refyard-cli`)        | **Yes, as the backend**   | `serve --json --port 0` is a spawnable supervisor-shaped service        |
| `apps/web` `+page.svelte` composition              | **No**                    | Multi-tab, pairing, PWA concerns; the extension writes a new, smaller composition from the same components |

## 2. Architecture

```text
VS Code extension host (Node.js)
  ├─ spawns: refyard-native serve --json --port 0 <workspace-repo>
  │    └─ readiness JSON on stdout (serviceInstanceId, port, url, pairing URL)
  ├─ exchanges the single-use pairing ticket for an in-memory bearer
  ├─ owns ALL fetch/SSE to http://127.0.0.1:<port> (bearer never crosses to the webview)
  └─ Webview panel (Svelte git-ui bundle, localResourceRoots, no remote code)
       └─ postMessage bridge: requests → extension host → HTTP; SSE frames → webview
```

Decisions this rests on:

- **The CLI is the backend, not a new host.** The Rust CLI already serves the closed
  contract with the same safety rules; the extension is one more supervisor-shaped parent
  process (the desktop app is another). No new Git code anywhere.
- **All HTTP lives in the extension host.** The webview never sees a bearer token, never
  does fetch, and works under VS Code's webview CSP. SSE is held by the host and forwarded
  as postMessage frames (the host owns reconnect/backoff).
- **One repository = the VS Code workspace folder** (resolved through
  `workspace.workspaceFolders`, must contain `.git`; otherwise a guided panel, not an
  error). No launcher, no tabs — the launcher components stay out of this composition.
- **Single panel** (WebviewPanel, retained, one per window), opened from the status bar
  and the command palette (`Refyard: Open Workbench`), plus activation help when a repo
  folder opens.

## 3. The unverified assumption this spec must kill first

The whole design leans on one claim: **a supervisor client without a browser `Origin`
can exchange the CLI's single-use ticket for a bearer and call the API.** The `--json`
readiness + machine protocol was built for parent processes, but nothing in this repo has
measured the exchange over plain Node fetch. The first milestone is a vitest integration
test (real CLI, fixture repo) that spawns `refyard-native serve --json --port 0`, parses
stdout readiness, exchanges the ticket, and performs an authenticated read. If the server
refuses a missing/foreign `Origin`, the fix lands in the CLI's auth layer (an explicit
machine-client rule) — not in a workaround.

CLI acquisition: setting `refyard.cliPath` (default `refyard-native` from `PATH`), with a
documented fallback to the npm CLI (`refyard serve`) — the two readiness contracts are
compared in the spike and reconciled if they differ.

## 4. Composition (what the panel shows)

Same information architecture as the desktop app's single-repo view, minus tabs, launcher,
execution-target picker, and connection chrome: **Working Copy** (staged/unstaged lists,
diff pane, stage/unstage/commit with the uncertain-outcome panel reused verbatim),
**History** (commit list + graph, filters), **Refs**. Components receive the same props
they get today; the bridge is just another `GitService` implementation surface.

Writes keep the house rules: confirmation + preview tokens before destructive ops,
uncertain outcomes block and require the three-act acknowledgement — the panel simply
inherits all of it by reusing the components.

## 5. UX surface

- Status bar item: service state (off / starting / live / degraded), click opens the panel.
- Commands: `Open Workbench`, `Refresh`, `Shutdown Service`.
- Panel lifecycle: service spawn on first open, killed on window close; crash → panel
  banner with a Restart action; port always `--port 0` (never a fixed port).
- Theme: webview inherits VS Code kind (dark/light) via `body.vscode-dark` class mapping
  onto the existing theme classes.

## 6. Packaging

- Location `apps/refyard-vscode/`; extension id `HuakunShen.refyard`; esbuild for the
  extension host bundle, vite for the webview Svelte bundle; `vsce` produces
  `refyard-<version>.vsix`.
- The release workflow attaches the `.vsix` to the same GitHub release as the desktop
  artifacts (one release, one version line; the extension reads the CLI's version over
  the API and refuses a mismatched API major honestly).
- Marketplace publishing is out of scope; the `.vsix` (and later the tap for the CLI) is
  the distribution.
