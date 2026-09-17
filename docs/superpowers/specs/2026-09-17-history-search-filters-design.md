# History Search and Filters Design

**Status:** Implemented and locally verified on 2026-09-18; see [evidence](../../evidence/2026-09-18-history-search.md).

**Date:** 2026-09-17

**Product phase:** Phase C — daily-driver interaction, item 3

## Summary

Refyard will add server-side, typed history search and filters to the existing paged History surface. The feature must preserve the current bounded-read, semantic-Git-command, snapshot-consistent architecture: the browser never downloads an unbounded history to filter locally, never sends raw Git argv, and never reinterprets display paths as execution paths.

The first release supports commit-message search, author search, observed-ref scoping, commit date bounds, abbreviated/full object-id lookup, and history for an already host-bound `pathId`. Filters compose with AND semantics. Search is applied explicitly with Enter or an Apply action rather than on every keystroke.

Filtered histories that can omit intermediate commits are marked as sparse. Sparse results keep the existing virtualized commit-row presentation and actions, but do not draw parent lanes through commits that the filter intentionally removed. Ref-only and first-parent history remain continuous graph walks.

## Goals

- Make History useful as a daily Git client surface for locating commits by message, author, ref, date, SHA, and known file.
- Keep all expensive filtering in Git on the host, with bounded page sizes and the existing read deadlines.
- Preserve stable pagination when refs move after page one.
- Make cursor continuation authoritative: a cursor continues the exact normalized query that created it.
- Preserve Refyard's authority boundaries for refs, object IDs, and paths.
- Keep graph rendering truthful when filtering creates holes in ancestry.
- Keep local, hosted, Xross, Kunkun, HTTP, and typed-client access on the same history contract.

## Non-goals

This phase does not add regex or fuzzy search, saved searches, a search index/database, arbitrary user-entered filesystem paths, rename-following file history, branch comparison, compressed filtered ancestry, or command-palette integration. It also does not change Git mutation semantics.

## Public contract

`HistoryQuery` gains optional walk-defining filters:

```ts
interface HistoryQuery {
  repositoryId: RepositoryId;
  worktreeId?: WorktreeId;
  cursor?: Cursor;
  limit?: number;
  detailOid?: ObjectId;
  firstParentOnly?: boolean;
  message?: string;
  author?: string;
  oidPrefix?: string;
  refFullName?: FullRefName;
  committedAfter?: Timestamp;
  committedBefore?: Timestamp;
  pathId?: PathId;
}
```

`HistoryPage` gains:

```ts
topology: "continuous" | "sparse";
```

`continuous` means every omitted parent is absent only because of pagination or repository object availability, so the existing lane continuation model is valid. `sparse` means the query itself may intentionally omit intermediate commits; the UI must not imply that unresolved parents will appear on later pages.

### Field semantics

- `message`: case-insensitive literal substring over commit messages. Length: 1–512 Unicode scalar values after trimming; NUL, CR/LF and unpaired surrogates are rejected.
- `author`: case-insensitive literal substring over Git author identity. Length: 1–512 Unicode scalar values after trimming, with the same single-line/control restrictions as message.
- `oidPrefix`: lowercase hexadecimal, 4–64 characters. The host additionally validates the maximum against the repository object format.
- `refFullName`: a fully qualified ref under `refs/`; it must also match a ref observed by the host for this repository.
- `committedAfter` / `committedBefore`: UTC timestamps applied to committer time. If both exist, `committedAfter <= committedBefore` is required.
- `pathId`: an opaque path binding already minted by Refyard for this repository/worktree. Display-path strings are never accepted.
- ordinary filters compose with AND semantics.

### Cursor requests

A request with `cursor` is a continuation request. New clients include only `repositoryId`, optional `worktreeId`, `cursor`, and optional `detailOid`. It must not redefine any filter field. For existing v1 clients, redundant `limit` or `firstParentOnly` is accepted only when identical to the cursor/snapshot; conflicting values return `InvalidRequest`. New clients omit both fields. The cursor remains authoritative.

`detailOid` remains orthogonal to the paged walk: callers may request one full commit body while continuing a history page.

## Normalized history intent

The host converts the first request into an internal normalized intent before creating a snapshot. The normalized intent is server-only and contains resolved values rather than user-facing aliases:

```ts
interface NormalizedHistoryIntent {
  readonly firstParentOnly: boolean;
  readonly message: string | null;
  readonly author: string | null;
  readonly resolvedRefOid: ObjectId | null;
  readonly committedAfterSeconds: number | null;
  readonly committedBeforeSeconds: number | null;
  readonly resolvedPathText: string | null;
  readonly oid: ObjectId | null;
  readonly oidLookup: boolean; // distinguishes no match from an ordinary walk
  readonly topology: "continuous" | "sparse";
}
```

The snapshot stores this normalized intent together with the pinned walk tips and a fixed-size fingerprint of all observed refs and HEAD. The fingerprint is independent of the scoped/bounded walk tips, so movement outside the walk-tip limit is still detected without retaining thousands of ref strings per snapshot. Cursor records continue that snapshot and offset; the client never receives or edits the normalized values.

This changes the current cursor rule from “continue this snapshot and offset” to “continue this exact snapshot, offset, page size, and normalized walk.” A ref moving, a path binding being evicted, or the browser changing its draft filters cannot alter later pages.

## Ref scoping

`refFullName` is not passed directly to Git as an arbitrary revision expression. The host reads refs with the existing `for-each-ref` workflow, requires an exact observed `fullName`, and resolves it to the peeled commit OID where appropriate.

That resolved OID becomes the sole walk tip for the snapshot. Ref-only history is therefore a continuous walk. If the ref moves after page one, pagination continues from the pinned OID and `tipsMoved` reports that repository refs changed.

An unknown or unobserved ref is `NotFound`, not an empty successful history.

## Object-id lookup

`oidPrefix` is a direct locator, not a raw revspec. The host uses a dedicated semantic planner based on Git's object disambiguation facilities, then keeps only commit objects.

Resolution rules:

- zero commit matches: return an empty sparse history page;
- exactly one commit match: use that full OID as the located commit;
- more than one commit match: return `InvalidRequest` and ask for more hexadecimal digits;
- a full OID that names a non-commit is treated as no commit match.

`oidPrefix` may combine with message, author, ref scope, and date bounds. The located commit must satisfy the remaining filters and, when a ref is supplied, be reachable from the resolved ref tip. `oidPrefix` does not combine with `pathId` in this first release.

## Path history

`pathId` continues Refyard's existing path-authority model. The host resolves it through `PathRegistry.getForWorktree`, proves repository/worktree ownership, and requires an exact executable representation. An unrepresentable path fails with `UnsupportedPathEncoding` rather than being guessed from its display string.

The exact executable path text is copied into the normalized snapshot intent so later pages do not depend on the path registry entry still existing.

This first release naturally supports history for files Refyard already knows, primarily changed files surfaced by status/diff. A future repository-tree read may mint path IDs for arbitrary tracked files without changing this history API.

Path filtering does not follow renames in this phase.

## Git planner

The existing history workflow remains based on `rev-list` for topology and batched `cat-file` for commit bodies. `planRevList` is extended with typed optional filters; it remains the only place that constructs the history argv.

For message/author search it uses fixed-string, case-insensitive Git limiting options. A closed private command hint requests Unicode text matching; the Node adapter selects `C.UTF-8` for that read invocation only. No raw environment field enters the public contract, and other commands retain the host environment. Date limits are passed as normalized numeric timestamps rather than locale-dependent free-form dates. Path input is supplied after `--` from the host-resolved binding with literal pathspec handling. Date filtering traverses intervening older commits so clock skew cannot hide a matching ancestor. Tips remain OIDs sent through stdin, never browser-provided ref expressions.

Representative semantics:

```text
git rev-list --topo-order --parents --max-count=N \
  --fixed-strings --regexp-ignore-case \
  --grep=<message> --author=<author> \
  --since-as-filter="@<after-seconds> +0000" --min-age=<before-seconds> \
  --stdin -- <resolved-path>
```

The planner adds only options represented by the normalized intent. It never accepts an array of caller-supplied arguments.

## Snapshot and pagination behavior

On the first page the coordinator:

1. validates the typed query and cross-field constraints;
2. resolves repository/worktree and current observed refs;
3. resolves any ref, path, and object-id prefix into normalized authority values;
4. computes the initial tips for the selected scope;
5. stores the normalized history intent in the history snapshot;
6. runs the first bounded page and creates a cursor when more rows exist.

On continuation the coordinator resolves only the cursor, verifies repository/worktree ownership, loads the snapshot, and reuses the snapshot's normalized intent and page size. No filter is reconstructed from browser input.

`tipsMoved` keeps its existing meaning. `truncated` continues to indicate either another page or missing repository objects; it does not mean “filter omitted commits.”

## Continuous versus sparse topology

The following are `continuous`:

- no filters;
- `refFullName` only;
- `firstParentOnly` with or without ref scope;
- date bounds only when Git's walk itself remains ancestry-contiguous is **not** assumed; therefore date bounds are classified sparse in v1.

The following are `sparse`:

- message filter;
- author filter;
- date bounds;
- path filter;
- object-id locator;
- any combination containing one of the above.

In sparse mode commit summaries retain their true `parents`; the contract does not invent compressed ancestry. The UI must not feed sparse pages into the continuous lane-layout algorithm.

## Browser UX

History remains the permanent center pane. A compact filter bar appears above the list with:

- a primary message-search input;
- secondary controls for author, ref, SHA, after, before, and known path;
- Apply/Enter to execute;
- Clear to restore the default history;
- chips or concise labels for active non-empty filters.

Draft state and applied state are separate. Typing never starts a Git process. Apply normalizes the draft into the TanStack query key, resets infinite pagination to page one, clears the selected commit/diff selection, and starts the new server query.

Changing repository also clears applied history filters that carry repository-specific authority (`refFullName`, `pathId`, `oidPrefix`). Text/date filters may be cleared with the whole filter state for predictable v1 behavior; filters are not persisted between repositories.

### Sparse presentation

For continuous pages the existing SVG commit graph remains unchanged.

For sparse pages the same virtualized commit rows, refs, author/time metadata, selection, inspector, and context menus remain available, but graph edges are suppressed. Rows render a simple commit marker in the graph gutter and the History header shows a small “Filtered history” / “topology hidden” indication. The UI does not draw a line to a parent that was intentionally filtered out.

## Query composition in the web app

History filter state lives in a focused pure model module, separate from TanStack query construction. It exposes draft/applied state, normalization, `isActive`, and clear/apply transitions.

The history infinite-query key includes the normalized applied filter:

```ts
["history", baseUrl, token, repositoryId, appliedHistoryFilter];
```

Every applied-filter change therefore owns a new page chain and cannot reuse an old cursor. `queries.svelte.ts` passes the typed fields only on page one; continuation requests send the cursor and repository/worktree identity.

Commit-detail queries remain independent and continue to use full object IDs.

## Error handling

- malformed/oversized filter values: `InvalidRequest`;
- `committedAfter > committedBefore`: `InvalidRequest`;
- continuation carrying walk-defining fields: `InvalidRequest`;
- unknown observed ref: `NotFound`;
- unknown/foreign `pathId`: existing `NotFound`/scope-safe path error behavior;
- unrepresentable path: `UnsupportedPathEncoding`;
- ambiguous OID prefix: `InvalidRequest`;
- stale or foreign cursor: existing `StaleSnapshot` / `Forbidden` behavior;
- no search matches: successful empty `HistoryPage` with the appropriate topology mode.

The UI keeps the previous successful result visible while a new applied query is loading only if TanStack's current behavior already does so; no new stale-result policy is introduced in this phase. Errors remain explicit and never silently fall back to unfiltered history.

## Security properties

- No raw Git argv, shell command, or revision expression enters the public API.
- Ref filters must resolve from host-observed refs.
- Object prefixes contain only bounded lowercase hex and are resolved by a dedicated semantic planner.
- Paths remain opaque host bindings; display text never becomes authority.
- All history reads still require `repository:read` plus the existing repository grant.
- Page size, text lengths, path/ref collections, command deadlines, and stdout bounds remain enforced.
- Cursor state stays opaque and server-side, preventing callers from changing snapshot, skip, filter, or resource scope.

## Compatibility

The new query fields and required `topology` response field use contract revision 1.1.0 within API major 1. Refyard's own client, service and web UI are updated in lockstep with the generated schema artifact. Older strict history clients may reject the additional response field, and newer clients reject old responses that lack topology. A mixed-version History response fails explicitly rather than silently assuming continuous ancestry; full old/new History interoperability is not claimed. Existing v1 callers that repeat a matching cursor page size/first-parent value are accepted without changing cursor authority.

The MCP `get_commit` tool continues to request one full commit by OID and does not need search filters. A future MCP history-search tool can reuse the typed history query but is outside this phase.

## Testing strategy

Contract tests cover field bounds, strict unknown-field rejection, timestamp ordering, cursor-continuation restrictions, and generated schema consistency.

Core planner tests assert exact argv/stdin for each filter and combinations, including hostile strings that must remain literal. Object-prefix tests cover no match, one commit, ambiguity, and non-commit objects.

Host integration tests cover message, author, ref, date, path, and SHA queries; AND composition; SHA-1 and SHA-256 repositories; ref movement across pages; cursor/filter immutability; path-registry eviction after page one; foreign cursors; sparse/continuous topology classification; and bounded paging.

HTTP/client tests prove the query survives URL encoding and strict schema parsing without broadening authority.

Web unit tests cover draft/applied transitions, normalization, repository-change clearing, query-key identity, and sparse-mode graph suppression.

Chromium E2E covers applying/clearing message search, combining at least two filters, ref scope, SHA lookup, known-file history, empty results, pagination under an active filter, and restoring the normal graph after Clear. Existing full Chromium regression remains a release gate.

## Acceptance criteria

- A user can locate commits by message, author, observed ref, date range, full/abbreviated SHA, and an existing `pathId` without downloading unbounded history.
- Filters compose predictably with AND semantics and execute only on Apply/Enter.
- A page-two cursor cannot be reinterpreted with different filters or page semantics.
- Ref movement and path-binding eviction after page one do not alter the already-started query.
- Sparse results never display continuous ancestry lines through omitted commits.
- Unfiltered history retains the current graph, virtualization, paging, context menus, selection, and inspector behavior.
- All inputs remain semantic, bounded, and scoped by existing repository authorization.
- Node 26 check, contract artifact validation, unit/integration/security gates, and full Chromium E2E are green before the phase is marked implemented.
