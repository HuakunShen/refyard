# Refyard Git client direction

> Status: product direction, revision 0 — 2026-09-16.
> Scope: the next product phase after the standalone V1 infrastructure work.
> Authority: this document refines `docs/product/north-star.md` for the Git-client experience.
> If an implementation plan says the Cloudflare Worker is the only production UI artifact,
> this document and the north star supersede that constraint: the local workbench is a first-class
> production form again.

## 1. Decision in one sentence

Refyard is a **local-first, browser-native Git client** whose default experience is one command that
opens a complete local GUI, while the same UI and Git service can also be used remotely through an
explicit hosted mode and embedded into Xross or Kunkun through the existing service boundary.

The next phase is not another infrastructure phase. The service, contract, graph, journal, safety
model and deployment seams are mature enough to support product work. The priority now is to make
Refyard competitive as a daily Git client: fast working-copy flows, a useful history graph,
contextual actions, searchable history, partial staging and the commit-level operations users expect.

## 2. Why the direction changes now

The repository has accumulated a strong backend before the UI reached the same level of maturity.
Today Refyard already has:

- a closed Git intention contract instead of remote argv execution;
- a portable Git core and graph engine;
- authenticated repository-scoped reads and writes;
- managed multi-repository workspaces;
- mutation journaling, recovery and explicit unknown outcomes;
- a virtualized commit graph and diff inspector;
- Hono, OpenAPI, Scalar and a bounded MCP surface;
- a static PWA that can be deployed independently;
- integration seams for Xross and Kunkun.

That work remains valuable and is not being replaced. The problem is now one of product balance:
adding another transport or deployment form contributes less than making the operations already
implemented easier to discover and use.

The governing principle for the next phase is therefore:

> **Backend completeness is not product completeness. A capability counts as a Git-client feature
> only when a normal user can discover it, invoke it safely and understand the result from the GUI.**

## 3. Product forms

### 3.1 Local workbench — the default

The default path is intentionally boring:

```text
npx refyard .
    │
    ├─ starts the Node Git service on loopback
    ├─ serves the bundled static Svelte UI from the same process
    ├─ creates a short-lived single-use pairing ticket
    ├─ opens the browser automatically when appropriate
    └─ cleans the bootstrap credential from the browser URL after pairing
```

`refyard open .` is the installed spelling of the same product experience.

Local mode keeps UI and API on one loopback origin. It is the lowest-friction form, avoids CORS and
public-network assumptions, and should be the path used in screenshots, onboarding and normal
single-machine documentation.

The existing asset server and `webRoot` capability are the correct architectural basis. Restoring
local mode is a packaging and lifecycle decision, not a new frontend implementation.

### 3.2 API-only service — the supervisor and integration form

`refyard serve` remains a supported, explicit API-only mode. It is intended for:

- Xross launching or supervising Refyard on another device;
- Kunkun embedding or proxying the Git service;
- SSH/headless environments;
- tunnels and user-owned remote access;
- tests and machine-readable supervisors.

`serve` must not silently open a browser. Machine-readable mode keeps bootstrap material out of
stdout and preserves the current explicit lifecycle contract.

### 3.3 Hosted PWA — the remote UI form

The Cloudflare Worker deployment remains useful, but it is **an additional client**, not the only
production UI artifact.

The hosted PWA serves the same product UI and connects to a separately running Git service through
an explicitly configured secure endpoint. It retains the stricter hosted requirements already in
the north star: exact origin allowlists, host-side opt-in, password/session exchange, TLS on the
browser-visible endpoint, and no central Refyard relay with repository authority.

The hosted form must never become the first place a Git mutation is exposed. Local mode remains the
reference path for new write functionality.

### 3.4 Embedded clients

Xross and Kunkun remain clients or supervisors of the same Git service and reusable UI/core
boundaries. They do not justify a second Git implementation. Integration-specific transport is an
adapter, not a fork of Refyard's domain logic.

## 4. Alternatives considered

### A. Cloudflare-only UI

This keeps the npm package smaller and makes one web deployment the canonical UI. It also turns a
local Git client into a two-component setup, makes first-run use depend on a separately hosted
artifact, and weakens the meaning of `refyard open`.

**Decision: reject as the default product shape.** Hosted UI remains supported, but not exclusive.

### B. Dual local + hosted UI from one source tree

The same static Svelte build can be packaged with the CLI for local use and deployed to Cloudflare
for remote use. The connection adapter determines whether the browser talks to its own origin or an
explicit remote API origin.

**Decision: adopt.** The extra packaged UI is small relative to the current npm artifact, and the
user-experience gain is much larger than the distribution-size saving from omitting it.

### C. Native desktop wrapper as the primary client

Electron, Tauri or another native wrapper could provide OS integration and a traditional app
lifecycle. It would also add a second packaging/runtime problem before the browser client itself has
matured.

**Decision: defer.** A native wrapper may later host the same UI and service, but it is not needed to
make Refyard a good Git client.

## 5. Git-client experience north star

Refyard should feel like a Git client, not an administration dashboard for Git capabilities.

The primary daily workflow is:

1. open a repository or workspace;
2. understand current branch and sync state immediately;
3. inspect changed files;
4. stage exactly the intended change;
5. commit;
6. browse or search history;
7. act on a commit, branch, tag or remote in context;
8. fetch, pull or push without leaving the main workspace;
9. resolve conflicts with the operation and affected paths visible together.

Secondary objects such as remotes, tags, stashes, worktrees and submodules remain first-class, but
they should not all consume permanently expanded panels in the main sidebar.

## 6. Information architecture

The current implementation exposes many capabilities as vertically stacked `SectionCard`s. That
was useful while proving features, but it should not be the long-term navigation model.

The target desktop layout remains a three-pane workbench:

```text
┌──────────────── Repository / branch / sync toolbar ────────────────┐
│                                                                    │
├──────────────────┬────────────────────────┬────────────────────────┤
│                  │                        │                        │
│ Working copy /   │ Commit history +      │ Commit, file and       │
│ repository tree  │ graph                  │ diff inspector         │
│                  │                        │                        │
│ Changes          │ Search / filters       │ Contextual actions     │
│ Branches         │                        │                        │
│ Remotes          │                        │                        │
│ Stashes          │                        │                        │
│ Tags             │                        │                        │
│ Worktrees        │                        │                        │
│                  │                        │                        │
└──────────────────┴────────────────────────┴────────────────────────┘
```

The left side is a navigable object tree, not a form collection. Creation and maintenance forms are
opened contextually through a menu, dialog or focused subview. Frequently used state stays visible;
infrequent configuration does not.

The center pane is primarily history. The right pane is an inspector whose contents follow the
selection: commit details, file diff, working-copy diff, conflict detail, or another selected Git
object.

## 7. Contextual actions are a primary interaction model

Refyard needs a consistent context-menu system. Git operations naturally attach to the object the
user is looking at, and hiding them in unrelated permanent panels makes the UI harder to scan.

A commit context menu should grow toward:

- create branch here;
- create tag here;
- cherry-pick;
- revert;
- reset current branch here, with explicit soft/mixed/hard choices;
- copy SHA;
- copy commit message.

A branch context menu should include switch, merge into current, rename, upstream management and
safe deletion. A file context menu should include stage, unstage, discard, open, reveal and copy
path. A remote context menu should include fetch, push, edit and remove.

Destructive actions continue to use the existing confirmation and precondition model. A context
menu is only a discovery surface; it never bypasses core safety rules.

## 8. History becomes a query surface, not only an infinite list

The existing virtualized graph and paged lane layout are assets and should be kept. The next step is
finding specific history without scrolling through it.

History should support bounded server-side filtering for at least:

- commit message text;
- full or abbreviated object id;
- author;
- branch/ref scope;
- date range;
- path/file history.

The browser should send a typed history query. Trusted core remains responsible for turning that
query into Git argv, and the host returns a bounded page with the same consistency guarantees as
today. Refyard should not download an arbitrarily large history and filter it in the browser.

Search/filter state should compose with the graph rather than switch to an unrelated search page.

## 9. Working copy and staging

File-level stage, unstage and discard are the baseline, not the endpoint.

The next staging capability should be **hunk-level staging**:

- stage hunk;
- unstage hunk;
- discard hunk, with the same destructive-operation safeguards;
- eventually stage selected lines where the patch model can represent the selection safely.

This is one of the areas where a GUI adds clear value over simple Git command wrappers. The diff
view should become an action surface instead of a read-only inspector.

Patch operations must stay intention-based. The browser must never send arbitrary patch text as a
privileged command substitute without a bounded contract, stale-content protection and an exact
precondition model.

## 10. Commit-level Git operations

The next missing operations should be added in increasing workflow complexity.

### First wave

- cherry-pick one explicit commit;
- revert one explicit commit;
- reset the current branch to an explicit commit, with soft/mixed/hard represented as distinct,
  visible choices and destructive variants confirmed.

### Second wave

- rebase the current branch onto an explicit target;
- continue/abort supported rebase states;
- expose conflict state consistently with merge conflicts.

### Later

- interactive rebase;
- commit reorder/squash/fixup UX;
- more advanced history editing.

Interactive rebase should not be used as the implementation shortcut for simpler operations. Each
public operation gets a closed semantic contract and its own safety behavior.

## 11. Complete the GUI for capabilities already implemented

Service capability and GUI capability are different concepts. The UI must not imply that a
backend operation is user-accessible merely because it appears in `/capabilities`.

The immediate known gaps include GUI surfaces for:

- `setBranchUpstream`;
- `updateRemote`.

Future capability reporting should make it possible to distinguish service support from what the
current client version exposes. At minimum, user-facing copy should not equate the raw backend
operation count with GUI feature completeness.

## 12. Keyboard-first use

A daily Git client needs keyboard paths as well as buttons and context menus.

The target includes:

- a command palette;
- shortcuts for refresh, fetch, commit, stage/unstage and focus changes;
- keyboard navigation through changed files and history rows;
- discoverable shortcut labels in menus;
- no hidden shortcut that performs a destructive action without the same confirmation path as the
  visible command.

The command palette invokes the same typed UI commands as menus and buttons. It is not a raw Git
console.

## 13. Frontend architecture direction

`apps/web/src/routes/+page.svelte` has become the frontend application layer as well as the route.
It currently owns connection lifecycle, storage, polling, SSE, queries, selection, mutation
orchestration and the full workbench layout. That concentration should be reduced before adding a
large second wave of Git UX.

The target split is responsibility-based, for example:

```text
apps/web/src/lib/workbench/
  session.svelte.ts       pairing, reconnect and session lifecycle
  queries.svelte.ts       repository-scoped query composition
  mutations.svelte.ts     mutation submission/follow/invalidation
  events.svelte.ts        SSE lifecycle and cache invalidation
  selection.svelte.ts     selected repository/commit/path state

apps/web/src/lib/components/workbench/
  WorkbenchShell.svelte
  RepositorySidebar.svelte
  WorkingCopyPane.svelte
  HistoryPane.svelte
  InspectorPane.svelte
```

The exact file names are implementation details; the boundary is the decision. The SvelteKit route
should compose application units rather than contain the implementation of every workflow.

Reusable visual Git components remain in `packages/git-ui` and do not acquire `$app/*` imports or
network ownership.

## 14. HTTP architecture direction

The Hono migration should be finished rather than leaving two HTTP application implementations in
one process.

The Node HTTP server should become a thin listener/lifecycle adapter. Hono should own the active
Web-standard application surface: session exchange, authenticated Git API, SSE, MCP, OpenAPI/Scalar
and static assets where local mode enables them.

Transport-neutral route definitions and contract schemas remain shared authorities. The old manual
API/auth/query dispatch path in `server.ts` should not remain as a shadow implementation once the
Hono path handles those requests.

The objective is one security boundary, not two equivalent-looking implementations that can drift.

## 15. Authorization model

Repository and root grants remain the mandatory scope boundary. The existing `scopes` vocabulary
should either enforce real semantics or stop pretending to do so.

The preferred direction is to make scopes meaningful:

- `repository:read` — status, history, refs, diffs and other non-mutating repository reads;
- `repository:write` — staging, commit, branch mutation, stash, merge, reset and related local
  repository writes;
- `repository:network` — fetch, pull, push and other operations that contact configured remotes;
- `workspace:manage` — register/revoke repositories and create/clone within granted roots.

A request must pass both dimensions: the session must have the target repository/root grant **and**
the required operation scope. A broad scope never grants an unapproved repository or directory.

This becomes particularly useful for MCP, Kunkun and Xross, where a client may intentionally be
read-only or may be allowed to edit local state without being allowed to use network credentials.

## 16. Pairing and credential transport

Local bootstrap remains short-lived and single-use. The implementation currently supports query
parameter pairing for browser flows that do not preserve fragments; documentation and comments
must describe the mechanism that actually ships instead of retaining the older fragment-only threat
model.

The security properties to preserve are:

- bootstrap credentials are single-use and short-lived;
- request logging never records them;
- Referrer Policy prevents propagation to another origin;
- the browser removes bootstrap material from the visible URL immediately after exchange;
- long-lived session credentials are not stored in `localStorage`;
- hosted mode adds its explicit password/origin protections instead of treating a remote page like
  loopback.

A future same-origin HttpOnly cookie for local browser sessions may be evaluated, but bearer
sessions remain valuable for non-browser clients. This is not a prerequisite for the Git-client
product phase.

## 17. Packaging and release shape

The production npm artifact should once again be allowed to contain the built local SPA in addition
to the Node CLI bundle.

The release invariants become:

- the packaged UI is generated from the same `apps/web` source as the hosted PWA;
- local UI assets contain no repository-specific or build-machine paths;
- `refyard open` can locate those assets without a checkout;
- `refyard serve` can remain API-only;
- Cloudflare deployment builds the same web app independently;
- package smoke tests exercise the real local open lifecycle, not assert that the package is
  API-only.

Distribution size is a metric, not the product architecture. A material future size regression may
justify optimization, but omitting the default local UI solely to minimize a small artifact is not
the product direction.

## 18. Things not to change

The Git-client push does **not** reopen these decisions:

- continue to use the target machine's system Git rather than replacing it with libgit2;
- browser and remote clients send intentions, never argv, shell, cwd or env blobs;
- `git-core` and `git-graph` stay host-free;
- repository access is explicit and never widened by scanning parent directories;
- user hooks, signing, filters, SSH behavior and credentials remain Git's own;
- uncertain mutation outcomes remain unknown and are never retried automatically;
- destructive operations keep confirmation, backup and stale-precondition rules;
- Xross/Kunkun integrations reuse the service/core boundaries instead of forking Git logic;
- no native wrapper is required to complete this phase.

## 19. Delivery order

The direction should be delivered in product-sized slices rather than one giant rewrite.

### Phase A — restore the obvious product

1. Restore packaged local SPA support.
2. Make `npx refyard .` / `refyard open .` launch the local same-origin workbench by default.
3. Keep `refyard serve` API-only and keep hosted PWA support.
4. Update package/e2e evidence to test all three forms honestly.

### Phase B — prepare the client for more UX

1. Split the oversized route-level frontend orchestration by responsibility.
2. Finish the Hono migration and remove shadow HTTP dispatch.
3. Make authorization scopes real.
4. Fix pairing/security documentation drift.
5. Expose the already implemented upstream and remote-edit operations in the GUI.

### Phase C — daily-driver interaction

1. Replace the stacked-card sidebar with the repository/object navigation model.
2. Add consistent context menus. **Implemented:** commit, branch, working-copy path and remote rows now share one right-click action layer; destructive actions retain explicit confirmation.
3. Add history search and filters.
4. Add keyboard navigation and command palette.
5. Improve contextual feedback for branch/network/operation state.

Status as of 2026-09-17: item 2 is implemented. Items 1, 3, 4 and 5 remain Phase C work.

### Phase D — stronger Git workflows

1. Cherry-pick.
2. Revert.
3. Reset.
4. Hunk staging and unstaging.
5. Rebase and its conflict continuation/abort flow.
6. File history and other high-value history tools.
7. Interactive rebase only after the simpler history-editing workflows are stable.

The ordering is intentional: it makes the existing product easier to start and easier to use before
adding another large family of mutations.

## 20. Success criteria

This phase is successful when all of the following are true:

1. A new user can run one command in a repository and reach a working local GUI without deploying
   or configuring a separate UI.
2. The hosted PWA remains usable as an explicit remote mode rather than being removed.
3. Normal stage/commit/history/branch/sync work can be completed without navigating a long stack of
   unrelated forms.
4. A commit, branch, file or remote exposes its relevant actions where the object is displayed.
5. History can find a commit by meaningful criteria without requiring the user to scroll through
   pages manually.
6. The GUI visibly exposes every backend capability it claims as a client feature.
7. The frontend route is a composition surface, not a multi-thousand-line application controller.
8. There is one active HTTP security/application path rather than a Hono path plus a shadow copy.
9. Read, write, network and workspace-management authority can be granted independently without
   widening repository/root access.
10. New advanced Git operations preserve Refyard's existing safety rules and real-Git test
    discipline.

## 21. Product test

When choosing between two next tasks, ask this question:

> **Does this make Refyard easier to start, easier to understand, or materially better at a Git
> workflow a developer performs every day?**

If the answer is no, and the task is another transport, deployment variant or infrastructure layer,
it should normally wait until the daily Git-client experience catches up with the backend already
built.
