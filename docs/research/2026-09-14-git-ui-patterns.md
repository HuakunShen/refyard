# Git UI patterns for Refyard — Gitron and GitButler

Research note for `packages/git-ui` (Svelte 5 components, Tailwind v4, shadcn-svelte conventions),
`packages/git-graph` (pure lane layout) and the `apps/web` SvelteKit static SPA.

Two reference projects were studied for **UI/UX and architecture patterns only**. Both are
reference-only: neither may be copied, in whole or in part, into Refyard. Findings below are
descriptions of shape and behaviour, with file paths so each idea is traceable to its origin.

DeepWiki was attempted first per the coordinator's direction
(`https://deepwiki.com/trun222/gitron`, `https://deepwiki.com/gitbutlerapp/gitbutler`). The HTML
pages are client-rendered and returned a loading shell to `WebFetch`; `trun222/gitron` is not indexed
at all ("Repository not found"). The `mcp.deepwiki.com` `ask_question` tool did work for GitButler
and is cited where used. Everything else is read directly from the checked-out sources, which is the
authoritative evidence.

## Status block

| Item                           | Gitron (Repo A)                                                                                                                                                                               | GitButler (Repo B)                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Local path                     | `/Volumes/Portable2TB/ExtDev/others/gitron` (symlink `references/open-source/gitron`)                                                                                                         | `/Volumes/Portable2TB/ExtDev/others/gitbutler` (symlink `references/open-source/gitbutler`)                                                  |
| `git -C <repo> rev-parse HEAD` | `c6f468a678aa90b09053d6872131aa14511222f8`                                                                                                                                                    | `d9c45b3b5e3c11218aa2306331847c4c43469074`                                                                                                   |
| HEAD date / subject            | 2026-09-04 — `chore(release): Bump version to 0.6.6`                                                                                                                                          | 2026-09-14 — `Merge pull request #15954 … archive-unarchive-worktrees`                                                                       |
| License                        | PolyForm Noncommercial 1.0.0 (`LICENSE`, `package.json` `"license"`)                                                                                                                          | Functional Source License 1.1, MIT Future License (`LICENSE.md`)                                                                             |
| Stack                          | SvelteKit 2.9 + `adapter-static` (fallback `index.html`), Svelte 5, Tailwind v4, `bits-ui`, `tailwind-variants`, `shiki`, `xterm`; Tauri 2 shell; Rust `gitron-core` + `gitron-server` (axum) | SvelteKit + `adapter-static` (fallback `index.html`), Svelte 5, PostCSS/Sass, RTK Query; Tauri 2 shell; Rust `but-api` / `but-server` (axum) |
| Size seen                      | 49 `.svelte` files, ~15.9k lines under `src/`                                                                                                                                                 | 385 `.svelte` files across `apps/*`; `packages/ui` is a real internal component library                                                      |

### Paths read — Gitron

- Transport / API: `src/lib/api/transport.ts`, `transport-http.ts`, `transport-tauri.ts`, `index.ts`,
  `src/lib/api/repo.ts`, `src/lib/api/types.ts`
- State: `src/lib/stores/repo.ts` (1391 lines), `watcher.ts`, `toast.ts`, `output.ts`, `settings.ts`
- Layout: `src/lib/components/layout/AppShell.svelte`, `Toolbar.svelte`, `Sidebar.svelte`,
  `StatusBar.svelte`, `BottomPanel.svelte`, `WorktreeSection.svelte`, `ConflictBanner.svelte`,
  `changes-tree.ts`
- Graph: `src/lib/components/graph/CommitGraph.svelte` (1694 lines), `CommitDetail.svelte`
- Diff: `src/lib/components/diff/FilePreview.svelte` (1162 lines), `src/lib/highlight.ts`
- Routes / config: `src/routes/+page.svelte`, `+layout.svelte`, `+layout.ts`, `src/app.css`,
  `src/app.html`, `svelte.config.js`, `vite.config.js`, `package.json`, `components.json`
- Rust: `crates/gitron-server/src/main.rs`, `auth.rs`, `sse.rs`, `routes/*`,
  `crates/gitron-core/src/git/graph.rs`, `event.rs`, `watcher/*`

### Paths read — GitButler

- Routes / config: `apps/desktop/src/routes/+layout.svelte`, `+layout.ts`,
  `apps/desktop/src/routes/[projectId]/+layout.svelte`, `apps/desktop/svelte.config.js`,
  `apps/desktop/package.json`, root `package.json`
- Layout: `apps/desktop/src/components/views/AppLayout.svelte`, `AppSidebar.svelte`,
  `MainViewport.svelte`, `WorkspaceView.svelte`, `StackView.svelte`
- Data layer: `apps/desktop/src/lib/backend/{backend,index,web,url}.ts`,
  `apps/desktop/src/lib/state/{backendQuery,backendApi,uiState.svelte}.ts`,
  `apps/desktop/src/lib/notifications/toasts.ts`,
  `apps/desktop/src/lib/shortcuts/{hotkeys,shortcutService}.ts`
- Selection / files: `apps/desktop/src/lib/files/filetreeV3.ts`,
  `apps/desktop/src/lib/selection/*`, `apps/desktop/src/components/files/FileListItemContainer.svelte`,
  `ChangedFilesPanel.svelte`
- Diff: `apps/desktop/src/components/diff/MultiDiffView.svelte`, `UnifiedDiffView.svelte`,
  `HunkContextMenu.svelte`, `ImageDiff.svelte`
- Commits: `apps/desktop/src/components/commit/{CommitListItem,CommitTimelineNode,CommitMessageEditor}.svelte`,
  `apps/desktop/src/components/editor/MessageEditor.svelte`
- Shared: `apps/desktop/src/components/shared/{ReduxResult,ToastController,ProjectShortcutHandler}.svelte`
- UI library: `packages/ui/src/lib/components/VirtualList.svelte`,
  `packages/ui/src/lib/components/file/{FileListItem,FileStatusBadge,FileViewHeader}.svelte`,
  `packages/ui/src/lib/components/hunkDiff/{HunkDiff,HunkDiffBody,HunkDiffRow}.svelte`,
  `packages/ui/src/styles/{main.css,core/variables.css,sharable/syntax-highlighting.css}`
- Rust: `crates/but-server/src/lib.rs` (loopback/Origin/Host middleware, CORS)

---

## 1. Repository state UI

### Gitron

**Pane hierarchy.** `src/lib/components/layout/AppShell.svelte` is one flex column:

```
Toolbar                     (repo actions, push/pull, command bar trigger)
ConflictBanner              (only during rebase/merge/cherry-pick/revert)
ErrorBanner                 (only when the global error store is non-empty)
┌─ Sidebar ──┬─ <main> ──────────────────────────────────────┐
│ branch /   │  CommitGraph  (or FilePreview when a file is  │
│ refs /     │                selected; CommitDetail when a   │
│ tags /     │                commit is selected)            │
│ stashes /  │                                               │
│ worktrees /│                                               │
│ Changes    │                                               │
│ + commit   │                                               │
│ box        │                                               │
└────────────┴───────────────────────────────────────────────┘
BottomPanel                 (tabs: Output | Terminal)
StatusBar                   (h-6: repo name, branch, ahead/behind, staged/changed counts, panel toggles)
<Toast/> + 11 global dialog components
```

There is exactly **one route** (`src/routes/+page.svelte`). "Navigation" is selection-driven
switching inside `<main>`: `isFileSelected → FilePreview`, `isCommitFileSelected → FilePreview`,
otherwise `CommitGraph` with an optional `CommitDetail` footer. This is the cheapest possible
structure for a workbench and it transfers directly to a static SPA with one `+page.svelte`; the
trade-off is that nothing is deep-linkable (only `?repo=` for worktrees).

**Changed-files list.** `Sidebar.svelte` renders four collapsible sections in a fixed order —
Conflicted, Staged, Unstaged, Untracked — each with a live count and a persisted expanded flag
(`conflictedExpanded`, `stagedExpanded`, … in `stores/settings.ts`). A two-state toggle
(`changesViewMode: 'file' | 'tree'`, also persisted) switches between a flat list and a tree built
entirely client-side by `changes-tree.ts`: `buildTree` (split on `/`, insert dir nodes) →
`sortTree` (directories before files, `localeCompare`) → `computeFileCounts` (per-directory file
count shown next to the folder name) → `flattenTree(nodes, expandedDirs)` producing
`FlatEntry { name, path, type, depth, fileStatus, section, expanded, fileCount }`. Flattening is a
pure derivation from `expandedDirs`; expansion state itself is a `$state(new Set<string>())` and the
full tree can be default-expanded via `collectDirPaths`.

Rows are `role="option"` inside a `role="listbox"`, `aria-selected` on the active row. Section
headers carry bulk affordances (Stage all / Unstage all / Discard all) and a collapse chevron that
only appears on `group-hover/section`. Directory rows carry their own context menu whose actions are
expanded to the file list by `collectFilesUnderDir` (prefix match by section) before being sent —
i.e. **bulk actions are always expressed as a path list**, which matches Refyard's "pre-check all
paths, reject the whole batch" rule.

The **commit box lives in the sidebar footer**, not in a modal: a title `<input>` + body
`<textarea>`, disabled while committing / generating / in a rebase-merge state with the placeholder
`"Commit disabled during rebase/merge"`, `Cmd+Enter` to commit, and an inline `commitError` string
rendered next to the button (`"Commit failed. Check your git config (user.name / user.email)."`) —
distinct from the global error banner.

**Interactions.** Global shortcuts are registered by a single `document.addEventListener('keydown')`
in `AppShell.svelte` that bails out when the target is an `INPUT`/`TEXTAREA` and when no repo is
open: `Cmd+Shift+P/L/F` push/pull/fetch, `Cmd+Shift+A/U` stage-all/unstage-all, `Cmd+Shift+D`
discard-all, `Cmd+R` refresh, `Cmd+\`` output panel, `Ctrl+\``terminal.`FilePreview`adds`s`/`u`for stage/unstage of the selected file.`/`focuses commit search,`?` opens the shortcuts modal
(`ui/shortcuts/ShortcutsModal.svelte`, which is a plain data table of `{keys, description}`grouped
into Global / Navigation / Staging / Commits).`Cmd+K`opens a command bar. Every overlay closes on`Escape`and on list scroll. Selection is **single-select only** — there is no multi-select,
no shift-range, no marquee, and no drag-to-stage. Staging is a per-row hover button plus a
per-directory context menu;`stage_files(paths[])` exists in the API but nothing in the UI sends
more than one path.

**`ConflictBanner.svelte`** is worth copying in shape: it reads `repoStatus.state`
(`Rebasing | RebasingInteractive | Merging | CherryPicking | Reverting`) and renders an
operation label, an optional `operation_step / operation_total` progress percentage, `Continue`
(disabled while `conflicted.length > 0`) and `Abort`. State-specific capability gating in one
component, driven purely by the status DTO.

### GitButler

**Pane hierarchy.** `AppLayout.svelte` = `AppHeader` + `chrome-body` = `AppSidebar` + an
`ErrorBoundary`-wrapped content area. The content area is a route (`/[projectId]/workspace`).
`MainViewport.svelte` is the reusable split: it takes `left`, optional `preview`, `middle`,
optional `right` snippets plus `{default, min}` widths for each, persists widths only when resized
manually, and hands `leftWidth/previewWidth/rightWidth` to `WorkspaceView.svelte` as
`leftWidth={280,min:260}`, `previewWidth={480,min:220}`, `rightWidth={320,min:220}`.

So the workspace is a **three-to-four column layout**: Unassigned changes (file list) │ diff preview
(only when something is selected) │ stacks of commits │ details. The selection model drives whether
the preview column exists at all — `previewOpen = !!worktreeSelection.lastAdded`.

**Selection is a first-class subsystem**, not local component state:
`apps/desktop/src/lib/selection/fileSelectionManager.svelte.ts` with a structured key
(`selection/key.ts`: `{type:'worktree'|'commit'|…, path}`) and operations `set`, `has`, `retain`,
`clear`, `collectionSize`, `treeChanges(id)`, `getById(id)`. Two behaviours matter:

- `retain(affectedPaths)` runs on every worktree-data update, so a selection pointing at a file that
  no longer exists is dropped rather than shown stale.
- `ScrollSelectionLock` (`selection/scrollSelectionLock.svelte.ts`) exists specifically to stop
  virtual-list scroll events from overwriting a selection the user clicked. Scroll-follow only
  applies while the selection size is ≤ 1.

Multi-select is real: `idSelection.treeChanges()` returns the whole selected set and the file
context menu opens against that set when the right-clicked row is part of it, otherwise against the
single row (`FileListItemContainer.svelte`'s `onContextMenu`). **Bulk actions therefore inherit the
selection, and the menu always states the set it will act on** — the pattern Refyard needs for
"one unsupported path rejects the batch", because the batch is already materialised before the
dialog opens.

`FileListItem` (in `packages/ui/src/lib/components/file/`) takes `listMode: 'list' | 'tree'`,
`depth`, `pathFirst` (filename-first vs path-first ordering, a user setting), an indeterminate-capable
checkbox, a drag handle, `conflicted`, `executable`, `locked` + `lockText`, `indeterminate`, and a
rename tooltip rendered as `previousPath → path`. The tree itself
(`apps/desktop/src/lib/files/filetreeV3.ts`) is the same shape as Gitron's but with a
`kind: 'dir' | 'file'` discriminated union, `parent` back-pointers, an `index` back to the flat
array so a tree row can address the flat virtual list, and sorting with
`new Intl.Collator('en', {numeric: true, caseFirst: 'lower', sensitivity: 'base'})` —
numeric-aware, which is what makes `file10` sort after `file9`.

---

## 2. Commit graph / history UI

### Gitron — a real lane graph, laid out in Rust, drawn per row

The layout is computed in `crates/gitron-core/src/git/graph.rs` and delivered inside the graph DTO:
`CommitGraph { commits, layout: { nodes[], max_lanes, branch_colors[] }, branches, tags, stashes, head_oid }`.
Node i corresponds to `commits[i]`; each node carries `lane`, `color_index`, and `edges[]` of
`{ from_lane, to_lane, to_row, color_index }`. Lane assignment is a reuse-first fit over an
`active_lanes: Vec<Option<BranchName>>` — take the first free slot, else push a new lane — and lanes
are freed once a branch's last row is passed. **This confirms Refyard's plan: lane geometry belongs
in `packages/git-graph` as a pure function, and the UI must never compute it.**

Rendering (`CommitGraph.svelte`, constants `ROW_HEIGHT = 30`, `LANE_WIDTH = 24`, `LANE_PADDING = 10`,
`CIRCLE_RADIUS = 5`, `LINE_WIDTH = 2`, `GRAPH_COLOR_COUNT = 14`):

- **No virtualization.** `{#each $commitGraph.commits as commit, i}` renders every row as a
  `<button role="option">` with `height: {ROW_HEIGHT}px`. The default fetch is capped at 500 commits
  (`getCommitGraph(path, maxCommits ?? 500, …)`) and there is no `loadMore`; scrollback beyond the
  first page simply does not exist.
- **One `<svg>` per row**, not one big canvas. Before rendering, a derived
  `laneActivities: Map<number, LaneActivity>[]` is precomputed per row from the edges, so row _i_
  knows which lanes have a line above, below, or both. The row draws straight vertical `<line>`s for
  every crossing lane plus, for the edge leaving the row, a cubic Bézier
  (`M x1 y1 C x1 cy1, x2 cy2, x2 y2` with control points at 0.6/0.4 of the vertical span) for
  cross-lane moves. Fixed row height means all geometry is row-relative and no measurement is needed.
- **Colour comes from CSS custom properties** `--color-graph-0 … --color-graph-13`, read once into a
  `$state` array via `getComputedStyle(document.documentElement)` inside a `$effect` keyed on the
  theme store, and re-read on theme change. `branch_colors` maps branch name → colour index, so a
  branch keeps its colour down the whole graph. The 14-colour palette is redeclared per theme
  (light, dark, `tron`, `synthwave`) — colours are theme data, not component constants.
- **Columns** are a CSS grid whose template is published as a `--grid-cols` custom property:
  `graph | 1fr message | author | date | sha`, with `0px` substituted for hidden columns. The graph
  column width is `max(setting, max_lanes * LANE_WIDTH + LANE_PADDING * 2)`, so a wide graph widens
  the column instead of clipping. Column widths are drag-resizable with per-column minimums, both
  single-column and paired (growing one shrinks its neighbour) modes, persisted on mouse-up; column
  visibility is a header context menu with `{key,label}` entries; both widths and visibility live in
  the settings store.
- **Ref labels** are absolutely-positioned "pills" overlaid on the row after the graph cell
  (`.search-labels`, `.branch-tag`, `.tag-pill`, `.worktree-pill`), each with `pill-text` truncation
  and a `title`. Branch pills are _grouped_: `groupBranches()` pairs each local branch with its
  remote counterpart using the configured upstream first, then falling back to stripping a
  **configured remote name prefix** (with a comment explaining that `git push origin <branch>`
  without `-u` leaves `upstream` unset). Styling by role: HEAD filled with the branch colour, remote
  dashed and 0.7 opacity, local tinted `color + "1a"`. Remote-only tags render as dimmed "ghost"
  pills at the remote's commit when the local tag is missing or points elsewhere. All of these are
  built as `Map<oid, T[]>` derivations (`branchesByOid`, `tagsByOid`, `worktreesByOid`,
  `stashMap`, `remoteTagGhostsByOid`) so a row is O(1) rather than a filter over every ref.
- **Keyboard**: the scroll container is `tabindex="0" role="listbox" aria-label="Commit list"`;
  `ArrowDown`/`ArrowUp` move the selection to `commits[i±1]` and call
  `scrollToIndex` → `children[index].scrollIntoView({ block: 'nearest' })`. No Home/End/PageUp/PageDown.
- Filters that re-scope the list rather than the data: commit-search filtering by OID set, and an
  author exclusion filter with its own "Hiding commits by: [chip ×]" banner and a "Clear all"
  button — a good pattern for keeping a filtered list non-destructive and legible.
- `scrollToCommitOid` is a one-shot store used by the tag list to jump the graph to a commit; the
  effect consumes it (resets to `null`) after use. A tiny, cheap cross-pane navigation channel that
  does not require lifting refs or a router.

`CommitDetail.svelte` is a _collapsible footer_, not a pane: a one-line collapsed header
(summary, author, relative date, short OID) that expands to show the full message, Author/Date/SHA/
Parents rows, and a "Files changed (n)" list of rows with a status badge. Selecting a file there
switches `<main>` to `FilePreview` for that commit's file diff. This "selected commit → detail strip →
click file → diff replaces the graph" is the simplest possible file-list → diff path.

### GitButler — a timeline rail, deliberately not a DAG

GitButler has **no lane/swimlane graph at all** — a `grep` for lane/graph rendering over
`apps/desktop/src` and `packages/ui/src` finds only branch/stack UI. History is organised as stacks
of commits on "virtual branches", and the visual is a vertical timeline:

- `components/commit/CommitTimelineNode.svelte` renders one node: a `top` segment, a dot (or a
  `<svg>` rhombus when `commitStatus === "LocalAndRemote"`, i.e. the commit exists both locally and
  remotely), an optional diverged "shadow dot", a `single-line` variant for `hideDot`, and
  `dotOnTop`. Height is a prop so callers can stretch it.
- The colour is derived from `getColorFromCommitState(commitStatus, diverged)` over
  `CommitStatusType = LocalOnly | LocalAndRemote | Integrated | Remote`, except that conflicts
  override to `var(--fill-danger-bg)`. `packages/ui/src/styles/components/commit-lines.css` holds
  the rail styling, and `commit-lines` is one of the six component stylesheets in the UI package.
- `CommitListItem.svelte` composes node + title + metadata + an expandable changed-files snippet,
  taking `first`, `lastCommit`, `lastBranch`, `selected`, `active`, `busy`, `disabled`, `editable`,
  `hasConflicts`, `opacity` and a `menu` snippet. `ShouldExpandFiles = expandChangedFiles ?? selected`
  — the changed-files list follows selection unless overridden.

That is the whole of their "graph". For Refyard this is a useful negative result: **a lane graph is
not required to make history legible, but if you ship one it must be a column beside the message,
and the per-row rail is the only part that has to be drawn.** Where GitButler needed a bigger
structure it built stacks, not lanes — a model Refyard explicitly does not have.

**Virtualization / paging.** Neither project virtualizes the commit list in the way a graph needs:
Gitron caps at 500 and renders all rows; GitButler renders commit rows inside stack views with a
`ResizeObserver`-based `VirtualList` available but no lane column. For Refyard the graph is the one
place where fixed-height row virtualization plus `pageOnScroll` continuation is genuinely needed,
because lanes must stay continuous across a page boundary — a layout state that has to be carried
forward, not recomputed.

---

## 3. Data layer

### Gitron — one `Transport` interface, two implementations

`src/lib/api/transport.ts` declares:

```ts
export interface Transport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  openUrl(url: string): Promise<void>;
  pickDirectory(title?: string): Promise<string | null>;
}
```

`isTauri()` checks `'__TAURI_INTERNALS__' in window`; `src/lib/api/index.ts` picks
`TauriTransport` or `HttpTransport` once and caches it. `transport-http.ts` holds a `COMMAND_MAP`
from snake_case Tauri command names to kebab-case HTTP paths (`stage_file → /api/staging/stage`,
`get_commit_graph → /api/graph`, …) plus a `GET_COMMANDS` set, posts JSON, sends
`Authorization: Bearer <token>` when a token exists, and throws `new Error(text || 'HTTP ' + status)`
on failure. `src/lib/api/repo.ts` is a flat module of typed wrappers — one exported function per
command, all `getTransport().invoke<…>()`. There are **no generated types**: `src/lib/api/types.ts`
is hand-written and mirrors the Rust structs.

The value of this shape for Refyard is the _inversion_: because both a desktop shell and an HTTP
server implement the same four-method port, all UI code is transport-agnostic. Refyard only needs the
HTTP half, but keeping `GitService` behind a small port interface in `packages/git-client` costs
nothing and makes the UI testable against a fake.

**Errors.** There is exactly one global error store (`error: writable<string | null>`) and every
catch in the store layer does `error.set(String(e))`. `AppShell` renders it as a dismissable banner:
the first line by default, with the `CLI error (N): \`cmd\``prefix stripped when a`verboseGitErrors`setting is off, a "Details" toggle for multiline, a`<pre>`for the full text, and a Dismiss button.
Separately there is a`Toast`store for success/info, a`commitError`local for the commit box, and
an **Output panel** that records`{ timestamp, operation, stdout, stderr, success }`per invocation
of an operation, auto-opening when`autoShowOutput` is set. The three-tier split — _banner for state
that blocks the workbench, inline for the control that failed, raw output for the curious_ — is the
right shape and is easy to keep honest.

**Loading / staleness.** One global `loading` boolean plus per-dialog `*Loading` flags plus a
`networkOperation: string | null` that names the in-flight push/pull and disables the buttons. The
freshness model is push-from-backend:

- Rust runs a configurable-interval watcher and emits `repo:status-changed` and `repo:refs-changed`
  with the **full payload attached**.
- The status event sets `repoStatus` straight from the payload.
- The refs event sets status from the payload immediately and then re-fetches _everything_
  (`refreshAll`, tracking status, remote tags, worktrees) — **except** while
  `isConflictState`, where it deliberately refreshes status only, with a comment stating that
  rebuilding the graph during rebase/merge races the `git` CLI's ref updates. The explicit
  `refreshAll()` after `rebaseContinue`/`mergeAbort` covers the full refresh instead.

That last point is exactly the class of bug Refyard must avoid: the service does not re-read state
while a sequenced operation is mid-flight. The trigger belongs in the host, not in the browser.

**Optimistic updates: none.** Every mutation (`stageFile`, `unstageFile`, `stageAllFiles`,
`discardFiles`, `createCommit`, `saveStash`, …) returns the new `RepoStatus` and the store
`set`s it. Failures never roll anything back because nothing was rolled forward. Given that Refyard's
rules forbid auto-retry and require "unknown" to be reported as unknown, this is the correct default.

**Caveat to avoid.** `HttpTransport.listen` constructs `new EventSource(url)` with **no
credentials**, and `EventSource` cannot send an `Authorization` header. `auth.rs` guards every
`/api` route including `/api/events` with a bearer middleware, so with `--token` set the event
stream cannot authenticate. Refyard's rule is that reads — including SSE — are authenticated, so the
ticket must travel in the URL (single-use, short-lived) or the stream must be fetched, not
`EventSource`-ed.

### GitButler — RTK Query over one `IBackend` port

`lib/backend/backend.ts` declares `IBackend` with `invoke`, `listen`, `platformName`, `systemTheme`,
`readFile`, `filePicker`, `homeDirectory`, `joinPath`, `openExternalUrl`, `loadDiskStore`, …;
`lib/backend/index.ts` returns `Web` when `import.meta.env.VITE_BUILD_TARGET === 'web'`, else
`Tauri`. The `Web` implementation (`lib/backend/web.ts`):

- `webInvoke` POSTs JSON to `${getApiBaseUrl()}/${command}` and expects a discriminated envelope
  `{type:'success', subject} | {type:'error', subject}`, wrapping a normalised error in an
  `IpcError` carrying the command name.
- `WebListener` is a singleton that opens **one** `ReconnectingWebSocket` to `${base}/ws` on the
  first subscriber, multiplexes `{name, payload}` frames to registered handlers, and closes the
  socket when the last handler unsubscribes. Reconnection is entirely delegated to the
  `reconnecting-websocket` package.
- `getApiBaseUrl()` resolves in a documented order: `VITE_BUTLER_API_BASE_URL` → `butlerHost` /
  `butlerPort` cookies (for parallel e2e workers) → `VITE_BUTLER_HOST` + `VITE_BUTLER_PORT` → `''`
  (same origin). `getWsUrl()` derives ws(s) from it and appends `/ws`.

State is Redux Toolkit Query. `lib/state/backendQuery.ts` defines `tauriBaseQuery`, which wraps
`backend.invoke(command, args)` and converts **every** failure into a normalised error object:

```ts
{ origin: "ipc", name: `API error: (${command})`, message, code, fingerprint }
```

`lib/state/backendApi.ts` composes endpoints from per-domain builders
(`buildStackEndpoints`, `buildBranchEndpoints`, `buildWorktreeEndpoints`, `buildGitEndpoints`,
`buildModeEndpoints`, `buildProjectEndpoints`, `buildUserEndpoints`) with `ReduxTag` tag types,
`invalidationBehavior: "immediately"` and `keepUnusedDataFor: 0`. Service classes
(`StackService`, `BaseBranchService`, `WorktreeService`, `DiffService`, `FileSelectionManager`,
`UncommittedService`, …) are constructed once and reached through
`InjectionToken` + `inject()` from `@gitbutler/core/context`; they wrap query results in reactive
`.response` / `.result` objects that Svelte reads directly.

**Staleness is tag invalidation driven by backend events**
(`apps/desktop/src/routes/[projectId]/+layout.svelte`):

| Event                                   | Invalidates                                                            |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `project://{id}/hunk-assignment-update` | Stacks, StackDetails                                                   |
| `project://{id}/git/head`               | Stacks, StackDetails                                                   |
| `project://{id}/worktree_changes`       | Diff                                                                   |
| `project://{id}/workspace-activity`     | Stacks, StackDetails, WorktreeChanges, IntegrationSteps, BranchListing |

plus: a `head` change also invalidates stacks (guarded by a `previousHead` comparison to avoid a
loop); remote-branch and base-branch refreshes are debounced 500 ms; auto-fetch runs on a
user-configured interval (default 15 minutes, negative disables); and `resetApiState()` runs whenever
`projectId` changes. Cross-process safety is surfaced, not silent: if `setActiveProject` reports
`is_exclusive === false`, the user gets an info toast that the project is already open in another
window. Refyard's "one writer per common Git directory" rule needs an equivalent statement, but it
must be a _statement_, not a lock claim.

**Loading and error presentation.** `components/shared/ReduxResult.svelte` is the pattern worth
adapting. It takes `result: Result<A>` plus `children(data)`, `loading(data)`, `error(err)`, `empty()`
snippets and renders exactly one of them — but with a `cache` holding the last non-`undefined` data,
so a refetch keeps the previous content on screen instead of flashing a spinner. It tests
`data !== undefined` specifically so `null` remains a valid payload; a separate `hideLoading` /
`hideError` pair lets a caller suppress either; and an `onerror` callback fires from an `$effect`
whenever the current result is an error, which is how callers hook toasts without duplicating them in
the template. The default error renders `InfoMessage style="danger"` with `error.name` as the title
and the fixed sentence "An asynchronous operation failed." as the content.

Above it: `FullviewLoading` for whole-view loading, `AppErrorFallback` for layout-level failure,
`ProblemLoadingRepo` for a repository that cannot be opened, and an `ErrorBoundary` around the page
content. Toasts (`lib/notifications/toasts.ts`) are a `writable` list with
`showToast / showInfo / showWarning / showError`, an optional `extraAction` button, a stable `id`
(republished with the same id replaces the existing toast — so a progress toast becomes a result
toast in place), Markdown content, and telemetry attached at the _semantic_ call site rather than in
the primitive, rate-limited to 60 per hour.

**Optimistic updates: none for Git state**, and the failure model is unusually honest in one place
worth studying: a failed commit produces a `CommitFailedModalState` carrying
`pathsToRejectedChanges: Record<string, RejectionReason>` where `RejectionReason` is a closed enum
(`workspaceMergeConflict`, `workspaceMergeConflictOfUnrelatedFile`, `cherryPickMergeConflict`,
`noEffectiveChanges`, `worktreeFileMissingForObjectConversion`, `fileToLargeOrBinary`,
`pathNotFoundInBaseTree`, `unsupportedDirectoryEntry`, `unsupportedTreeEntry`,
`missingDiffSpecAssociation`, `pathNotFoundInBaseTree`). A partial commit failure is reported
**per path with a typed reason**, not as one string. That is precisely the reporting shape Refyard's
"one unsupported path rejects the whole batch" rule needs, and it is worth adopting the idea (with
Refyard's own reason set) rather than inventing one later.

---

## 4. Svelte 5 / SvelteKit specifics

### Gitron

- **Stores, not runes, for shared state.** `stores/repo.ts` is 1391 lines of `writable`/`derived`
  with `get()`/`set()` in exported functions; components read `$store` and use `$state`/`$derived`/
  `$effect` only for local UI (dropdown open, error expanded, column widths, drag mode). So Svelte 5
  runes _are_ used, but the rune/store boundary is "module-level shared = store, component-local =
  rune". The result is one very large store module that mixes server data, selection, dialog
  visibility (`discardConfirmOpen`, `forcePushConfirmOpen`, `cleanupBranchesOpen`, …) and network
  flags. It works, and it is the thing Refyard should _not_ do: `packages/git-ui` needs the state
  divided by concern so the pieces are testable without a browser.
- **Long-lived connection.** `stores/watcher.ts` starts listeners after `openRepo` and stops them on
  `closeRepo`; `startWatcherListeners` always calls `stopWatcherListeners` first so a reopen cannot
  double-subscribe. There is no reconnect logic and no session-expiry handling: an expired bearer
  surfaces as a generic thrown error in the banner. Gitron also has a separately configurable
  _file-watcher interval_ setting pushed to the backend (`set_watcher_interval`), i.e. polling is a
  user-visible knob rather than a hidden constant.
- **SPA specifics.** `svelte.config.js` uses `adapter({ fallback: 'index.html' })` with no
  `precompress`; `routes/+layout.ts` is a one-liner `export const ssr = false;`; `app.html` sets
  `class="dark"` on `<html>` and disables autocorrect/spellcheck on `<body>`. `vite.config.js`
  proxies `/api` to `http://localhost:9417` in dev, and the production build supports being served
  under a path prefix via `VITE_BASE` (the `Transport` reads the `/t/:id/p/:id` prefix out of
  `window.location.pathname`). `components.json` shows plain shadcn-svelte conventions
  (`style: default`, `baseColor: zinc`, aliases under `$lib/components/ui`) with `bits-ui` and
  `tailwind-variants` as the primitives layer — the closest match to Refyard's intended stack.

### GitButler

- **Runes live in `.svelte.ts` classes.** `lib/state/uiState.svelte.ts` defines the UI state slice
  and exports `UiState`; components read `uiState.global.allInOneDiff.current`,
  `uiState.project(projectId).exclusiveAction.current`, `uiState.lane(stackId).selection`, and
  `uiState.pick("diffLigatures", "tabSize", "wrapText", …)` to grab a bundle of settings in one
  call. Scoping is explicit and three-level: **global / project / lane**. This is a directly
  transferable idea for Refyard (`uiState.global`, `uiState.repo(repoId)`,
  `uiState.selection(...)`), and the `pick(...)` bundle helper keeps prop drilling in the diff
  components to one line instead of nine.
- **Services as injected classes.** `@gitbutler/core/context` provides `InjectionToken` +
  `inject()`; services are created in `routes/+layout.ts`'s `load` (which awaits `appSettings` before
  first render) and re-read in `[projectId]/+layout.svelte`. Components never import a singleton
  store from a deep path; they `inject(SERVICE)`. Refyard's `packages/git-ui` must not import
  `$app/*`, so a token/inject layer inside `git-ui` with the concrete `GitService` supplied by
  `apps/web` is the right analogue — and it is what makes the components reusable by Kunkun later.
- **Compound-component convention.** Their own `apps/desktop/src/components/README.md` (referenced by
  the DeepWiki answer) documents a three-tier split — `shared/`, domain folders, `views/` — and a
  "Compound Components" pattern of Controller (`.svelte.ts`) + Provider (`.svelte`) + Consumers
  (`.svelte`). `FileListProvider.svelte` + `FileListItems.svelte` +
  `FileListItemContainer.svelte` is an instance of it.
- **Deep-link / focus cursor.** `FocusCursor.svelte` at the root and `use:focusable` on containers
  implement a keyboard focus ring that is independent of DOM focus order; `mergeUnlisten(...)` in an
  `$effect` composes several backend listeners into one cleanup function — an idiomatic pattern for
  Refyard's SSE subscriptions, since it makes "one effect owns all listeners, and tearing down the
  effect tears down all of them" the default rather than something to remember.
- **Shortcuts.** `lib/shortcuts/hotkeys.ts` uses `tinykeys`' `createKeybindingsHandler`, with
  `$mod` combos, a guard that ignores `event.repeat`, and a guard that ignores events from
  `HTMLInputElement` / `HTMLTextAreaElement` — plus `_lexicalHandled`, because the rich-text commit
  editor is a `contenteditable` that a naive handler would steal keys from. `ShortcutService` also
  listens to a backend `menu://shortcut` event so native menu items drive the same handlers. Hotkeys
  are displayed on the control itself (`<Button hotkey="⌘1">`), which is a cheap discoverability win.
- **SPA specifics.** `apps/desktop/svelte.config.js`: `staticAdapter({ pages: 'build', assets: 'build',
fallback: 'index.html', precompress: false, strict: false })` and `compilerOptions: { css: 'external' }`.
  `routes/+layout.ts`: `ssr = false`, `prerender = false`, `csr = true`, plus a `load` that
  constructs the backend, reads the home directory, builds the settings service and awaits
  `fetchAppSettings()` — deliberately blocking the first render so the theme/telemetry decision is
  correct from frame one. Persisted UI state uses `lscache` (localStorage with expiry) and the
  helpers `persistWithExpiration(value, key, ttlMinutes)`; layout widths, expanded/collapsed state
  and fold states all go through it.

---

## 5. Diff rendering

### Gitron — line list with hand-rolled virtualization above a threshold

`FilePreview.svelte` (1162 lines). The backend hands the UI **structured** diff data, not patch text:
`FileDiff { path, status, is_binary, hunks: [{ header, lines: [{ origin, content, new_lineno }] }] }`.
The comment in `crates/gitron-core/src/git/diff.rs` region is corroborated by the component, which
never parses `@@` itself and never re-derives line numbers.

- **Unified only.** There is no side-by-side mode anywhere in the component or the settings.
- **Flatten then virtualize, conditionally.** `flatItems` is a `$derived` linear list of
  `{kind:'line'}` and `{kind:'separator'}` items; a separator between hunks is computed from the gap
  between `prevLast.new_lineno` and `currFirst.new_lineno` in `skippedLines()` and displayed as
  "`N` lines" or "···". Virtualization turns on only above `VIRTUAL_THRESHOLD = 200` items
  (`useVirtual = flatItems.length > VIRTUAL_THRESHOLD`) — small diffs render all lines with no
  scroller overhead. When on: `LINE_HEIGHT = 20`, `SEPARATOR_HEIGHT = 36`, `OVERSCAN = 20`,
  a precomputed cumulative `itemOffsets` array, a **binary search** (`findFirstVisible`) for the
  first visible item, a forward scan for the last, and rendering of `flatItems.slice(start, end)`
  inside a container of `totalHeight`. No library.
- **Syntax highlighting** via Shiki (`src/lib/highlight.ts`): a module-level cached
  `createHighlighter({ themes: ['catppuccin-mocha'], langs: [...14 preloaded] })` promise;
  `detectLanguage(path)` from a hand-written extension map with `'text'` fallback; `tokenizeLine`
  highlights **one line at a time** (`highlighter.codeToTokens(...).tokens[0] ?? [raw]`, everything
  wrapped in `try/catch` returning the raw line). In the component, `tokenizeLineCached` memoizes by
  line _content_ into a `Map` cleared when the file path changes and hard-cleared at 5000 entries.
  Per-line tokenization is the only approach compatible with line virtualization — worth noting
  because a whole-file token pass cannot be sliced.
- **Rendering a line**: `flex {lineBackground(origin)} min-w-fit` with `height: {LINE_HEIGHT}px`, a
  right-aligned new-line-number gutter, then `<span class="whitespace-pre pl-2 pr-4">` containing one
  `<span style:color>` per token. `min-w-fit` inside a horizontally scrolling container is what makes
  long lines scroll rather than wrap.
- **Binary and degenerate states**: `is_binary` → a placeholder; `hunks.length === 0` → a "no textual
  changes" message. Mode-only changes are not specially rendered (they surface only as the
  `--color-git-modified` status chip); renames appear as status `R` with delete+add hunks.
- **Conflict view** is a separate mode inside the same component: `ConflictSection[]` with per-line
  ours/theirs toggle state (`toggleOursLine` / `toggleTheirsLine`), a live "resolved file" preview
  rebuilt from the toggles, contiguous-change regions grouped so the user can step through them, and
  `stage`/`unstage` shortcuts disabled in that mode. A conflict is not a diff, and treating it as its
  own view with its own keyboard handling is the right call.

### GitButler — per-hunk `<table>` with lazy bodies and progressive streaming

Component chain: `MultiDiffView` (one virtualized item **per file**) → per-file `Drawer` with a
sticky, collapsible `FileViewHeader` → `UnifiedDiffView` (per file, from
`apps/desktop/src/components/diff/`) → `HunkDiff` → `HunkDiffBody` → `HunkDiffRow` (all in
`packages/ui/src/lib/components/hunkDiff/`). The DeepWiki answer confirms this chain; the source
confirms the details below.

- **File-level virtualization.** `MultiDiffView.svelte` uses `<VirtualList items={changes}
defaultHeight={173} renderDistance={100} initSettleMs={500} getId={(c) => c.path}
visibility="scroll">` with a `{#snippet template(change, index)}` per file. `VirtualList`
  (`packages/ui/src/lib/components/VirtualList.svelte`) measures real heights with a
  `ResizeObserver`, keeps a `heightMap` + `lockedHeights`, estimates with `defaultHeight` until
  measured, supports `jumpToIndex`, and reports the visible range via `onVisibleChange` — which
  `MultiDiffView` uses to move the highlighted file, gated by `ScrollSelectionLock` and by
  `collectionSize <= 1` so a multi-selection is never clobbered by scrolling.
- **`allInOneDiff` is a real product decision**: a global toggle switches between "one file at a
  time" (`single-diff-view`, one `<Drawer>` filling the pane, with a "pop out diff view" button that
  opens a `FloatingDiffModal`) and "all files in one scrolling virtualized list" with sticky headers
  (`stickyHeader={allInOneDiff}`) and a `HunkDiffSkeleton` per unloaded file. Refyard should keep
  this a setting from the start; the two modes share every child component.
- **Per-file expanded state survives virtualization**: `const diffExpandedState = new
Map<string, boolean>()` deliberately declared **not reactive** ("Persists across VirtualList
  recycles") and read only as `defaultCollapsed` when an item is constructed. A recycling virtual
  list destroys component state, so any per-row state that must outlive a recycle has to live
  outside the row.
- **Hunk rendering.** `HunkDiff.svelte` receives the raw hunk string (`hunkStr`), parses it in the
  browser with `parseHunk` from `packages/ui/src/lib/utils/diffParsing.ts` into
  `{oldStart, oldLines, newStart, newLines, comment, contentSections[]}`, and renders a `<table>`:
  a `<thead>` row containing a checkbox `<th>` (`colspan` 2 or 3 depending on whether lock warnings
  exist) that stages/unstages the whole hunk, and a title `<th>` showing the reconstructed header
  `@@ -oldStart,oldLines +newStart,newLines @@`. `HunkDiffBody` renders the `contentSections` (runs
  of same-kind lines, so a section can be styled as a block) into `HunkDiffRow` per line: before/after
  line numbers, a delta marker, and the text.
- **Lazy hunk bodies.** Each `HunkDiff` wraps its table in an element observed by an
  `IntersectionObserver` with `rootMargin: '300px 0px'`; until it intersects, the `<tbody>` contains a
  single `<tr>` whose height is `estimatedBodyHeight = max(lines - 1, 1) * ceil(diffFontSize * 1.25)`
  — i.e. the placeholder height is derived from the same `diffFontSize` setting the body uses, so it
  scales with the user's font choice instead of being a magic constant. Observer disconnects after
  the first intersection.
- **Progressive hunk streaming inside a file.** `UnifiedDiffView` renders only
  `INITIAL_HUNKS = 5` hunks at first and adds `HUNKS_PER_FRAME = 10` on each
  `requestAnimationFrame`, cancelling the rAF in the effect's cleanup and resetting the counter
  whenever the file, the diff, or `showAnyways` changes. This keeps the main thread responsive on a
  file with hundreds of hunks without any measurement machinery.
- **Degenerate states are exhaustive and each has its own component:**
  `diff === null` → "Was not able to load the diff"; `type === 'TooLarge'` → "Too large to display";
  `type === 'Binary'` → `ImageDiff` when `isImageFile(path)` (and when the user opted into
  `uiState.global.svgAsImage` for `.svg`), else "Binary! Not for human eyes"; `hunks.length === 0` →
  "It's empty"; otherwise, if `linesAdded + linesRemoved > LARGE_DIFF_THRESHOLD (1000)` and the user
  has not opted in, `HiddenDiffNotice` with an explicit "show anyway" that sets `showAnyways = true`.
  Each uses `EmptyStatePlaceholder` with an illustration and a caption.
- **Word-level highlighting** is a CSS concern: `packages/ui/src/styles/sharable/syntax-highlighting.css`
  defines `.token-inserted`, `.token-deleted` and `.token-strikethrough` against
  `--diff-addition-line-highlight` / `--diff-deletion-line-highlight`, so intra-line diff emphasis
  composes with the syntax theme instead of fighting it.
- **Presentation settings are threaded, not baked in.** `HunkDiff` accepts `tabSize` (default 4),
  `wrapText` (default true), `diffFont` (default `var(--font-mono)`), `diffFontSize` (default 12),
  `diffLigatures`, `strongContrast`, `colorBlindFriendly`, `inlineUnifiedDiffs`, and the parent
  supplies them via a single `{...uiState.pick("diffLigatures", "tabSize", "wrapText", "diffFont",
"diffFontSize", "strongContrast", "colorBlindFriendly", "inlineUnifiedDiffs")}`. They land as CSS
  custom properties and a `font-variant-ligatures` style on the wrapper, so the diff is themed by
  CSS rather than by prop branches. Line width is handled with a `ScrollableContainer` with
  `horz whenToShow="always"`.
- **Copy behaviour is handled deliberately**: `oncopy` on the `<table>` replaces the clipboard
  content with `document.getSelection().toString()` so copying a selection out of a table with
  gutters does not drag along line numbers and gutters.
- **Line-level staging** uses `checkbox`-gated selection: checkboxes are shown only while a commit
  is in progress (`hideCheckboxes={!isCommitting}`), `onLineClick` toggles a line unless
  `canBePartiallySelected(diff)` is false (in which case the whole hunk is toggled), and
  `invertHunkSelection` computes the complement from `parseHunk(...).contentSections`. The
  selection state itself lives in `UncommittedService`, keyed by `(stackId, path, hunkHeader)` and
  `(newLine, oldLine)` — not in the component.

---

## 6. Design system

### Gitron

`src/app.css` is Tailwind v4 with `@import "tailwindcss"` + `@import "tw-animate-css"` and a
`@custom-variant dark (&:is(.dark *))`. Tokens are shadcn-svelte's names
(`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--muted`, `--accent`,
`--destructive`, `--border`, `--input`, `--ring`, plus a full `--sidebar-*` set) in **`oklch()`**,
with a `.dark` block, plus four extra themes layered on dark: `.tron` and `.synthwave` (and
`tron-enhanced` as a component-level variant). Beyond shadcn:

- **Git status semantics get their own tokens**, paired as a colour and a background:
  `--color-git-added(-bg)`, `--color-git-modified(-bg)`, `--color-git-deleted(-bg)`,
  `--color-git-conflict(-bg)`, `--color-git-conflict-ours`, `--color-git-conflict-theirs`, and
  `--color-git-{added,modified}-foreground` for text on a filled chip. Values are Catppuccin-derived
  in dark (`#a6e3a1`, `#f9e2af`, `#f38ba8`) and a matching lighter set in light.
- **A 14-entry graph lane palette per theme**: `--color-graph-0 … --color-graph-13`, redefined in
  light, dark, tron and synthwave. Components never hard-code a lane colour; they index into the
  palette by `color_index % 14`. Because the component re-reads these from `getComputedStyle` on
  theme change, adding a theme adds lane colours for free.
- `--radius`, `--editor-font-size`, and utility classes with `[11px]`/`[13px]` step sizes — the UI
  is **dense**: 30 px commit rows, 20 px diff lines, `text-xs`/`text-[11px]` for metadata, `h-6`
  status bar, 10 px uppercase `tracking-wide` section headers.

Density and the two token families (shadcn chrome + git semantics + lane palette) are the transferable
parts; the neon themes are not.

### GitButler

The design system is a real package, not a folder: `packages/ui` published internally as
`@gitbutler/ui` with Storybook, plus a separate **published** token package
`@gitbutler/design-core` (v2.2.2) imported in the root layout as
`import "@gitbutler/design-core/utility"` followed by `import "@gitbutler/design-core/core"`.

- Component inventory worth noting as a checklist: `Badge`, `InfoMessage`, `Button`
  (`kind` / `size` / `icon` / `tooltip` / `hotkey` / `activated`), `Modal` + `ModalHeader` +
  `ModalFooter`, `Drawer`, `ContextMenu` (+ item/section/submenu), `DropdownButton`, `KebabButton`,
  `Checkbox`, `Toggle`, `RadioButton`, `Textbox`, `Textarea`, `TagInput`, `Tooltip`, `Avatar`,
  `TimeAgo`, `Timestamp`, `LineStats`, `SkeletonBone`, `LoadingSpinner`, `EmptyStatePlaceholder`,
  `VirtualList`, `ScrollableContainer`, `ChipToastContainer`, `AsyncButton`, `TestId` (test ids as a
  typed enum, used as `data-testid` throughout).
- File-specific: `FileIcon`, `FileName`, `FileIndent`, `FileStatusBadge`, `FileViewHeader`,
  `FileListItem`, `FolderListItem`, `ExecutableLabel`.
- **`FileStatusBadge` is the exact component Refyard needs**, and it has three styles from one
  status: `style="dot"` renders a status-specific glyph (`change-addition`,
  `change-modification`, `change-deletion`, `change-rename`) in a coloured wrapper with a tooltip;
  `style="full"` renders a soft `Badge` with the words "Added / Modified / Deleted / Renamed";
  `style="full-large"` is the same at `size="tag"`. The status→colour mapping is **semantic**:
  `addition→safe`, `modification→warning`, `deletion→danger`, `rename→purple`, default `gray`. Status
  is a named union (`addition | modification | deletion | rename`), and the palette has named slots
  (`safe`, `warning`, `danger`, `purple`, `gray`), so a theme cannot desynchronise the two.
- Token naming is compact and component-agnostic: `--bg-1 … --bg-3`, `--bg-mute`, `--text-1 …`,
  `--border-1 …`, `--fill-*`, `--clr-*-{0,40,60,100}` scales; `--radius-s/m/ml`;
  `--font-mono`; `--transition-fast/medium/slow` (0.05/0.15/0.2 s); a fixed z-index scale
  `--z-ground(1) / lifted(2) / floating(3) / modal(4) / tooltip(5) / blocker(9999)`. Hover states are
  **derived**, not enumerated: `--hover-bg-1: color-mix(in srgb, var(--bg-1), var(--clr-gray-0) 4%)`
  with a `:root.dark` override that swaps the mix colour and percentage. That single idea removes
  roughly a dozen hand-maintained hover tokens per theme.
- Dark mode is `:root.dark` driven by `AppTheme = "system" | "light" | "dark"` in `UiState`, toggled
  by a dedicated `ThemeShortcutHandler`; syntax highlighting has its own pair of theme names
  (`syntaxThemeDark: "github-dark"`) so the code theme is chosen independently of the chrome theme.
- Tone: the UI is **airy compared to Gitron** — larger default spacing, rem-based layout widths
  (`pxToRem(width, zoom)` so the whole layout scales with a zoom setting rather than only the text),
  rounded cards with 1 px borders and a `--fx-shadow-s` token for elevation.

### What transfers to Tailwind v4 + shadcn-svelte

Keep shadcn's neutral chrome tokens as the base and add **two Refyard-owned token families** on top,
declared in `@theme` so Tailwind v4 generates the utilities:

1. **Change semantics**: `--color-change-added|modified|deleted|renamed|conflict|untracked`,
   each with a `-bg` companion and a paired `-foreground` for filled chips. Do not reuse
   `--color-git-*`-style names — Refyard's status model is a typed union, so name the tokens after
   the union members.
2. **Graph lanes**: `--color-lane-0 … --color-lane-N` in every theme file, indexed by the
   `color_index` that `packages/git-graph` puts on each node. The UI must never choose a lane colour.

Then: derive hover/active states with `color-mix()`, fix a z-index scale, keep a `--radius-*` scale,
and make the diff font size/tab size/line height CSS custom properties set on the diff container
(not props) so the reading pane is skinnable.

---

## 7. What NOT to take

**GitButler — architecture that Refyard cannot carry:**

- **Virtual branches, stacks, and the hunk-assignment model.** This is GitButler's whole product
  thesis: the repo has no ordinary branch checkout, changes are assigned to stacks, and
  `virtual_branches.toml` is a side database that `but` and the app both mutate. Refyard runs the
  machine's own `git` against an ordinary working tree. There is no mapping between these models, and
  copying the vocabulary (lanes/stacks/absorb/land) would imply capabilities Refyard does not have.
- **Hunk/line/filedrag between commits and stacks.** `draggableChips`, `HunkDropDataV3`,
  `FileChangeDropData`, `DROPZONE_REGISTRY`, commit drop indicators — this is drag-to-rewrite,
  which requires their commit-rewriting engine. Refyard V1 must not expose any of it.
- **`but-server` as a product surface.** It serves their own embedded state (a SQLite DB, gitoxide
  rather than the system `git`) and exposes hundreds of commands including mutating ones. Refyard's
  host is a scope-bound capability around the local `git` CLI; only the _security middleware_ around
  the server transfers.
- **Redux Toolkit + RTK Query + `redux-persist` + `rxjs` + `reconnecting-websocket`.** The value
  RTKQ provides here is tag invalidation and result caching; Refyard gets the same shape from a small
  typed client plus rune-backed stores with a fraction of the dependency surface and none of the
  global-store coupling.
- **AI/agent surfaces**: commit-message generation and the prompt/`AIMacros`/`DiffInputContext`
  plumbing, the `but-mcp-app` package, the runtime rule engine, `@anthropic-ai/sdk` usage, and the
  background/polling agents (forge review polling with backoff, CI check badges, PR state).
  `ProjectSettingsModalContent`-scale settings trees are also out of scope.
- **The Lexical rich-text commit editor** (`MessageEditor.svelte` + `MessageEditorInput` +
  file-upload plugin + emoji picker + hard-wrap plugin), including its
  `_lexicalHandled` shortcut-suppression coupling.
- **Native-shell affordances**: `crates/gitbutler-tauri` native menus and the `menu://shortcut`
  event channel, deep links, `getWindowTitle`/`setWindowTitle`, auto-updater, Sentry/PostHog wiring,
  zoom-as-layout-scaling (`pxToRem`), and multi-window "project already open" exclusivity.
  Interesting read; nothing to build.
- **`apps/web` and `apps/lite`** entirely — the marketing/Cloud SvelteKit app and the Electron+React
  TUI/lite client are different products, and `apps/lite` is not even the same framework.
- **`@gitbutler/design-core`** is a published npm package under their license: study the token
  _names and structure_, never the file.

**Gitron — architecture that Refyard cannot carry:**

- **The single god-store.** `stores/repo.ts` mixing server data, selection, dialog visibility and
  network flags into ~1400 lines of module-level writables is the main thing to avoid; it is why
  Gitron's components cannot be tested or reused outside the app.
- **A single global `error` string.** Every catch does `error.set(String(e))`, and the banner renders
  the raw text (optionally with the `CLI error (N): \`cmd\`` prefix stripped by a regex). Refyard's
  contract needs typed, per-operation failures with a distinguishable _unknown_ outcome; a string is
  not enough and raw CLI output is not a user-facing message.
- **`EventSource` for the event stream.** It cannot carry a bearer, and Gitron's own auth middleware
  guards `/api/events`. Refyard requires authenticated reads, so the stream needs a single-use ticket
  in the URL or a fetched/streamed response.
- **Doing Git twice.** Gitron ships both a Rust implementation (via `git2`, with `gitron-core/src/git/*`
  including its own `diff.rs`, `graph.rs`, `repository.rs`) and a `cli.rs`. Refyard runs exactly the
  machine's `git`; there is no second engine to keep in agreement.
- **The built-in terminal** (xterm.js + a PTY route + a bottom panel tab), the AI/GitHub/Bitbucket
  integrations, and the release-notes dialog. AGENTS.md rules these out explicitly.
- **Non-virtualized 500-row commit lists** with no paging. Refyard's graph must page.
- **Unbounded refresh-on-every-event.** The `refreshAll()`-on-every-refs-change path is what they
  themselves had to special-case during rebase/merge; Refyard should drive refresh from explicit
  host events and never re-read mid-operation.
- **Worktree creation/removal/prune UI, branch cleanup dialogs, reset/force-push flows.** Not in M1;
  several of them are destructive operations Refyard deliberately gates behind preview tokens.

---

## Refyard UI plan input

Ordered by what the T01–T07 read-only loop (M1) actually needs. Nothing below requires a write
capability to exist; every component is designed so that staging/commit can be added later without
reshaping it (the hook is noted where it matters).

### M1 — required (T07)

**Shell and layout**

1. `AppShell` — one flex column, exactly as Gitron's: `AppHeader` (repo identity, branch, sync state,
   command palette trigger) → `AppBannerSlot` (conflict/error/notice) → `flex-1` row of
   `Sidebar | Main` → `StatusBar`. Full-height, `overflow-hidden` on the column, `overflow-y-auto`
   only inside panes. `apps/web` owns the route; `packages/git-ui` owns the shell.
2. `AppHeader` — repo name + path tooltip, current branch or detached-HEAD label, ahead/behind
   counts, **`ConnectionBadge`** (see below), and a refresh action. No push/pull/fetch in M1.
3. `StatusBar` — a 24 px strip: repo basename, branch, `n staged / n changed / n untracked /
n conflicted`, the HEAD object format, and the pane toggles. Cheap, and it is the only place
   several counts can be seen at once.
4. `ResizableSplit` — a two/three-pane splitter with `{default, min}` widths, drag handles, and
   persisted widths (GitButler's `MainViewport` is the model; keep it a `packages/git-ui` component
   with `left`/`preview`/`main` snippets and injected UI state, not a copy of their file).

**Connection and health (Refyard-specific, must exist in M1)**

5. `ConnectionBadge` + `ConnectionBanner` — three states, always visible:
   `connected` / `reconnecting` / `authentication-failed`. A loopback bearer can expire, the
   service can be restarted by `refyard serve`, and the SPA can outlive both. Neither reference app
   models this (Gitron shows a generic error; GitButler has no session to expire), so Refyard has to
   own it: the badge is a status-bar item, the banner appears only for a failed state, and the
   reconnect path must never silently retry a mutation.
6. `ErrorBanner` — dismissable, with the shape Gitron got right: one-line summary by default,
   expandable detail, and a raw-output affordance for the operator. Backed by a typed
   `GitServiceError` discriminated union, **not** a string.
7. `UnknownOutcomeNotice` — a distinct, non-dismissable-until-acknowledged strip for results the host
   could not determine. Refyard's rule is "never label an uncertain result succeeded", so the UI
   needs a rendering for "unknown" that is visually different from both success and failure. Neither
   reference has this.

**Repository state**

8. `FileTree` + `FileList` with a persisted `list | tree` toggle, sections in the order
   **Conflicted, Staged, Unstaged, Untracked** (Gitron's order is the natural reading order for a
   workbench), each with a count and a persisted expanded flag. Build the tree with a pure module in
   `git-ui` (Gitron's `changes-tree.ts` / GitButler's `filetreeV3.ts` shape): split on `/`, dirs
   before files, `Intl.Collator('en', {numeric: true, sensitivity: 'base'})`, per-dir file counts,
   then flatten with an expanded-path `Set`. Keep an `index` on each file node pointing at its
   position in the flat array — that is what lets a tree row address a flat virtual list.
9. `StatusChip` — the M/A/D/R/U/?/! indicator. Adopt GitButler's `FileStatusBadge` idea with three
   styles (`dot` for dense rows, `letter` for list rows, `full` for headers) driven by one typed
   status, with semantic token names rather than fixed colours.
10. `RefBadge` — one component, four roles: local branch (tinted), HEAD (`is_head`, filled),
    remote branch (dashed, dimmed), tag, plus a worktree marker. Truncating pill with a `title`,
    and a size variant for graph rows vs the sidebar. Adopt Gitron's remote/local **pairing** rule
    (configured upstream first, then configured-remote-prefix stripping) — it prevents the duplicate
    pill that a naive `origin/` strip produces.
11. `ObjectIdChip` — a monospace short OID with click-to-copy and a full-OID tooltip. Must take the
    repository's detected object format as an argument and never assume 40 hex characters.
12. `AuthorCell` — name + relative time with `TimeAgo`/`Timestamp` split (relative in the row, exact
    on hover/expand).

**History**

13. `CommitGraphList` — the M1 centrepiece, and the one thing to build carefully:
    - fixed `ROW_HEIGHT` via `--commit-row-height`, one virtualized list with overscan;
    - a graph column whose width is `max(min, maxLanes * LANE_WIDTH + padding)` so a wide graph
      widens the column rather than clipping (Gitron's derivation is correct);
    - one `<svg>` per row drawing only the lanes crossing that row, with lane-activity precomputed
      per row from the edges — no full-graph SVG, no canvas, no measurement;
    - lane colours from `--color-lane-N` indexed by `color_index`, re-read on theme change;
    - ref pills overlaid after the graph cell, resolved through `Map<oid, Ref[]>` derivations so a
      row is O(1);
    - columns `graph | message | author | date | oid` with drag-resize, per-column minimums, and a
      header context menu for visibility, persisted;
    - `role="listbox"`, `ArrowUp`/`ArrowDown` + `scrollIntoView({block:'nearest'})`, plus
      `Home`/`End`/`PageUp`/`PageDown` (Gitron omits the last three; they are cheap);
    - **paging**: a sentinel row that requests the next page as it enters the viewport, with an
      explicit "loading more" row and a hard stop when the host reports no continuation. The lane
      state must be carried forward from the previous page — this is why `packages/git-graph` takes
      and returns lane state, and why "layout is pure, paging is stateful" is the right split.
14. `CommitDetail` — a collapsible strip under the graph (Gitron's model) rather than a third pane:
    summary line always visible; expanded shows full message, author/committer with dates, parents as
    clickable OIDs, refs, and a "Files changed (n)" list with status chips. Selecting a file swaps
    the main pane to the diff.
15. `CommitSearch` — `/` focuses a query input, matching OIDs highlight in place and the list can be
    filtered to matches with a visible "filtered" banner and a clear action (Gitron's
    author-exclusion banner is the pattern: never filter silently).

**Diff**

16. `DiffView` — unified, line-virtualized above a threshold, fed by **structured** diff data from
    `git-contract` (never by re-parsing `@@` in the browser):
    - flatten hunks into `{kind:'line'} | {kind:'gap'}` items, compute cumulative offsets, binary
      search the first visible item, overscan both ends;
    - a `GapRow` rendered as "`N` unchanged lines";
    - per-line Shiki tokenization with a content-keyed memo cache cleared on file change;
    - `min-w-fit` line rows inside a horizontally scrolling container;
    - CSS custom properties on the container for `--diff-font-size`, `--diff-tab-size`,
      `--diff-line-height`, driven by settings;
    - line numbers for the new side in M1, with the old side shown for deletions.
17. `DiffStates` — one component per degenerate case, each with a clear sentence:
    binary ("Binary file — not shown"), too large ("Too large to display"), empty ("No textual
    changes"), mode-only change ("File mode changed from 100644 to 100755"), rename ("Renamed from
    `<path>`"), submodule/gitlink change, unavailable/unknown ("Could not read this diff — the
    result is unknown"). GitButler's exhaustive state set is the model; the "unknown" case is
    Refyard's addition.
18. `DiffHeader` — file path, status chip, added/removed counts, whitespace-ignoring toggle, wrap
    toggle, and (later) stage/unstage. Keep the controls as settings, not per-file local state.
19. `HunkHeader` — a sticky `@@ -a,b +c,d @@` row with the hunk's line counts; the anchor a future
    "stage this hunk" checkbox attaches to. Do not render it in M1 as more than a header.

**Repository inventory (read-only sections)**

20. `RefList` — branches (local/remote), tags, each row with the ref badge, target OID, and a
    click that jumps the graph to that commit. Use a one-shot `scrollToCommit` store (Gitron's
    `scrollToCommitOid` consumed-then-nulled pattern) rather than lifting refs.
21. `WorktreeList` — path, branch or detached, HEAD short OID, locked/prunable markers. Read-only.
22. `StashList` — index, message, base OID. Read-only.
23. `SubmoduleList` — path, OID, and whether it is initialised; uninitialised submodules must render
    as "not initialised", never as an error.
24. `CapabilitiesPanel` — render exactly the capability set the host reports, with absent operations
    visibly absent rather than disabled-and-mysterious. This is the UI half of "capabilities must
    omit anything unimplemented".
25. `ShortcutSheet` — `?` opens a grouped table of `{keys, description}` (Global / Navigation /
    History / Diff). Register shortcuts in **one** handler that ignores events from inputs and
    ignores `event.repeat`, and display the combo on the control that owns it.

### M1 — useful but not required

26. `CommandPalette` — `Cmd+K` with actions over repos, branches, tags, and "go to commit". Gitron's
    `CommandBar.svelte` is 917 lines; a much smaller version is enough.
27. `JournalPanel` — a read-only list of the host's recorded operations with outcome and duration.
    M1 builds the journal anyway; showing it is nearly free and it is the honest way to surface
    "unknown" outcomes.
28. `DoctorPanel` — the `refyard doctor` report rendered in-app: git version, object format, hook
    presence, config sources. Read-only, and it gives the capability list its evidence.

### After M1 (shape the M1 components to accept these)

29. `StageControls` — per-row hover button, per-section bulk action, and (later) hunk/line
    checkboxes. Build the bulk path first: a bulk request must carry the **full path list**, be
    pre-checked in the host, and reject atomically. Render the resulting per-path rejection reasons
    (GitButler's `pathsToRejectedChanges` idea with Refyard's own reason union) in one dialog that
    names every rejected path and why.
30. `CommitBox` — sidebar footer, title + body, `Cmd+Enter`, disabled with a stated reason during
    conflict states, inline error for the commit itself. Not a modal.
31. `ConfirmDialog` — one component parameterised by `{ title, consequence, confirmLabel, danger }`
    used by every destructive action, with the preview-token staleness path: if the token the
    request carried no longer matches the file's fingerprint, the dialog reopens with "this file
    changed since you confirmed" and the operation does not run.
32. `ToastHost` — success/info only, bottom-right, single-id replace so a progress toast becomes its
    own result. Errors belong in the banner, not here.

### Interactions to specify in the M1 UI (not optional polish)

| Interaction         | Behaviour                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection           | Single-select in M1; the selection model keyed by `{repoId, type, path/oid}` from day one so multi-select is a later addition, not a rewrite. Prune the selection against the new status on every refresh. |
| Scroll vs selection | A scroll-driven highlight must never overwrite a clicked selection. Give the list a small "scroll lock" so follow-scroll resumes only after the user's next explicit action.                               |
| Refresh             | User-initiated only in M1 (`Cmd+R`), plus host events. Never auto-refresh while an operation is in flight, and never auto-retry a mutation.                                                                |
| Staleness           | Show it, do not hide it: when the host reports the worktree changed under a preview token, mark the affected row and the open diff stale rather than silently re-reading.                                  |
| Filtering           | Any filter (search, path) shows a banner naming the active filter with a one-click clear.                                                                                                                  |
| Focus               | Panes are focusable containers; `Escape` returns focus to the pane that owns the overlay, and closes overlays on list scroll.                                                                              |
| Empty states        | Every pane needs one, and they differ: no repo open, repo open but clean, filter matched nothing, and "could not determine".                                                                               |

---

## License note

Both repositories are **reference material only**. No code, markup, style sheet, asset, or string was
copied from either into Refyard, and none may be. Both live under `references/`, which AGENTS.md
keeps untracked.

|                         | Repo A — Gitron                                                                                                                                                                   | Repo B — GitButler                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| License                 | **PolyForm Noncommercial License 1.0.0** (`LICENSE`; also `"license": "PolyForm-Noncommercial-1.0.0"` in `package.json`)                                                          | **Functional Source License, Version 1.1, MIT Future License — FSL-1.1-MIT** (`LICENSE.md`)                                                                                                            |
| Character               | Noncommercial only: any commercial use is outside the grant, and the licence is not an open-source licence.                                                                       | Fair Source / source-available: permits most non-competing use, and each release converts to MIT after a stated period; using it to build a competing product is explicitly excluded.                  |
| Consequence for Refyard | Study-only. Ideas, layouts, and interaction patterns may be learned from; expression may not be reproduced, in whole or in part.                                                  | Study-only. The non-compete term makes copying into a Git workbench especially unsafe — Refyard is the same category of product.                                                                       |
| What was actually taken | Descriptions of pane structure, state-flow shape, virtualization strategy, token naming, and interaction inventory — recorded above with file paths so each idea is attributable. | Same.                                                                                                                                                                                                  |
| What must not happen    | No file, snippet, class name, CSS custom property name, component API, or comment may be transplanted; no dependency on Gitron.                                                   | No file, snippet, class name, CSS token name, component API, or comment may be transplanted; no dependency on `@gitbutler/ui`, `@gitbutler/design-core`, `@gitbutler/shared`, or `@gitbutler/but-sdk`. |

Any Refyard component that ends up structurally similar to one described here must be justified by
Refyard's own contract (typed DTOs, capability honesty, preview tokens, unknown-outcome reporting),
not by "the reference did it this way". Where this document names a concrete API shape (three-style
status chips, `{default,min}` pane widths, `uiState.pick(...)` setting bundles), it is naming an
_idea to re-derive_, and the Refyard version should be designed against `packages/git-contract`
first and only then made to look like anything in particular.
