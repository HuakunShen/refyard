# History Search and Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded server-side commit-history search by message, author, observed ref, date, SHA prefix, and known `pathId`, with cursor-stable pagination and truthful sparse-history rendering.

**Architecture:** Extend the existing typed `HistoryQuery` rather than adding a parallel search endpoint. The first request is normalized by the Node host into server-owned history intent stored with the snapshot; continuations send only the opaque cursor and cannot redefine the walk. Git Core extends the semantic `rev-list` planner and adds a dedicated SHA-prefix resolver; the web app keeps draft/applied filter state and suppresses continuous graph edges for sparse results.

**Tech Stack:** TypeScript, Zod, system Git CLI planners, Hono, TanStack Query, Svelte 5, `@refyard/git-graph`, Vitest, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-09-17-history-search-filters-design.md`

## Completion record (2026-09-18)

All ten original tasks are complete through the grouped execution below. The detailed checklists are retained as the implementation sketch; amendments and this receipt take precedence over illustrative code/individual commit names. Focused RED/GREEN tests and complete aggregate suites replace duplicate per-file runs; real rendered browser behavior replaces proposed structural-only UI tests.

| Original tasks | Completed slice / commits                                                                            | Verification                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3–4            | Portable filters/locator `b9637fe`, exact dates/Unicode policy `94c2496`                             | 107 core tests; real SHA-1/256/collision/date/path fixtures; independent review fixes approved                                                                                      |
| 1–2,5–6        | Contract/snapshot/host/client `bde35cc`                                                              | Pure contract and snapshot tests; real reads/HTTP/scope; generated453-schema artifact; independent review approved                                                                  |
| 7–9            | Reusable UI/model/browser tests `8e7a924`, alert link `4425306`, exact rendered pagination `47b7b9d` | Draft/query model; real Chromium Apply/Clear/filter combinations/SHA/path/date/empty/graph;105-OID exact rendered union/order;1440px/390px screenshots; independent review approved |
| 10             | Product/spec/plan/evidence update in this documentation commit                                       | Root check/boundaries/contract/unit346/integration411/portable4+11smoke/build; full Chromium47; compatibility9 across three engines                                                 |

Contract1.1.0 fixture correction `347085d` and pre-existing compatibility navigation correction `5908dc1` preserve their original assertions. [Detailed commands, counts, decisions and unverified platforms](../../evidence/2026-09-18-history-search.md) are the authoritative receipt. Main's restored staged plan remains untouched; no push, publication, deployment or automatic merge occurred.

## Execution amendments (2026-09-17)

The user authorized continued implementation and a compact History toolbar: message search always visible, secondary filters expandable. These amendments supersede conflicting examples below.

- Group the work into three implementation slices with independent review: **A** portable planners/workflows (Tasks 3–4); **B** contract, snapshot, coordinator and client (Tasks 1–2, 5–6); **C** web model, polished filter UI and browser coverage (Tasks 7–9). Task 10 remains final verification and evidence. A and B may proceed against an agreed typed interface; C consumes B's contract. Each slice gets focused RED/GREEN evidence and a scoped commit.
- Cross-field rules live in `validate.ts`, not Zod refinements. Text is trimmed and bounded to 512 Unicode scalar values; NUL, CR/LF and unpaired surrogates are rejected (single-line literal search, never Git pattern lists).
- Cursor state owns page size and first-parent mode. For compatibility with existing v1 clients, redundant `limit`/`firstParentOnly` may be supplied only when identical to the cursor/snapshot. Conflicts and all filter fields on continuation are rejected. New clients send cursor plus identity only.
- Normalize first-page intent and copy it into snapshots. Keep a fixed-size fingerprint of all observed refs/HEAD separately from scoped walk tips so `tipsMoved` is not permanently true for ref-scoped reads.
- Date bounds must handle non-monotonic commit timestamps without stopping traversal at an old commit. Literal bound paths must not become Git wildcard/pathspec expressions. Sparse commit parents come from actual commit objects, not rewritten path-limited topology.
- SHA lookup returns one commit only, never its ancestor walk, and applies remaining predicates consistently with ordinary history. Bound disambiguation output and refuse ambiguity honestly.
- Required `topology` must be propagated to all response producers/fixtures; account for older additive clients explicitly, and do not claim backward compatibility solely because a field was added.
- UI uses existing design tokens/components; accessible labels, keyboard Apply/Enter, draft/applied distinction, clear active filters, loading/errors/empty states, and responsive wrapping. Path filter uses a known host-bound ID and its display label; clearing selection must not erase applied path authority.
- Production changes cover History and the responsive workbench layout needed to use it. Git mutation semantics remain unchanged. No publication, deployment or automatic merge into main.

## Global Constraints

- Work in isolated branch `codex/history-search-filters` at `/private/tmp/refyard-history-search-20260917`; preserve the restored plan on `main`.
- Use Node `26.8.2` for checks and test gates.
- Preserve the one public `GET /api/v1/history` read surface; do not add a second search backend.
- Never expose raw Git argv, shell, cwd, revision expressions, or display-path authority to the browser.
- `message` and `author` are trimmed, bounded, case-insensitive literal searches, never regular expressions.
- `refFullName` must resolve from host-observed refs before Git receives a tip OID.
- `pathId` must resolve through the existing worktree-bound path registry; copy exact execution text into snapshot intent.
- `oidPrefix` is lowercase hex, 4–64 characters, and cannot combine with `pathId` in v1.
- New clients send only repository/worktree identity, cursor, and optional `detailOid` on continuation. Filter fields and conflicting legacy page options are rejected; exactly matching legacy limit/firstParentOnly remain accepted.
- Sparse histories retain true parent OIDs but never use the continuous lane-layout renderer.
- Every production change follows RED → GREEN → focused verification → isolated commit.

---

## File / responsibility map

- `packages/git-contract/src/reads.ts`: public history query/page schemas.
- `packages/git-contract/src/validate.ts`: history semantic and cross-field validation.
- `packages/git-contract/src/limits.ts`: published text-filter length limit if exposed through runtime limits.
- `packages/git-contract/generated/contract.schema.json`: generated artifact after contract changes.
- `packages/host-node/src/coordinator/snapshot-types.ts`: normalized server-side history intent shape stored by snapshots.
- `packages/host-node/src/coordinator/snapshots.ts`: copy/freeze normalized history intent in history snapshots.
- `packages/git-core/src/plan/status.ts`: semantic `rev-list` filter argv construction.
- `packages/git-core/src/plan/refs.ts`: semantic OID-prefix disambiguation / object-type checks.
- `packages/git-core/src/parse/meta.ts`: parse disambiguation and typed object-check output.
- `packages/git-core/src/workflows/history.ts`: filtered topology walk and prefix-resolution workflow helpers.
- `packages/host-node/src/coordinator/reads.ts`: normalize filters, resolve ref/path/SHA authority, create/continue filtered snapshots.
- `packages/git-client/src/client.ts`: typed query encoding for new public fields.
- `apps/web/src/lib/workbench/history-filter.ts`: pure draft/applied filter state and normalization.
- `apps/web/src/lib/workbench/queries.svelte.ts`: filtered infinite-query key/page-one vs cursor request behavior.
- `apps/web/src/lib/workbench/query-model.ts`: topology-mode presentation helpers.
- `apps/web/src/routes/+page.svelte`: center History composition only.
- `packages/git-ui/src/components/HistoryFilterBar.svelte`: filter controls.
- `packages/git-ui/src/components/CommitList.svelte`: sparse marker mode without ancestry edges.
- `tests/contract/schema.test.ts`, `tests/core/*`, `tests/integration/reads.test.ts`, `tests/integration/http.test.ts`, `tests/unit/*`, `tests/e2e/history-search.spec.ts`: layered evidence.

---

### Task 1: Extend the public History contract

**Files:**

- Modify: `packages/git-contract/src/reads.ts`
- Modify: `packages/git-contract/src/limits.ts`
- Modify: `tests/contract/schema.test.ts`
- Modify: `packages/git-contract/generated/contract.schema.json`

**Interfaces:**

- Produces `HistoryQuery` fields `message`, `author`, `oidPrefix`, `refFullName`, `committedAfter`, `committedBefore`, `pathId`.
- Produces `HistoryPage.topology: "continuous" | "sparse"`.
- Enforces continuation and cross-filter constraints before handlers execute.

- [x] **Step 1: Write failing contract tests for the new fields and page topology.**

Add tests that parse:

```ts
historyQuerySchema.parse({
  repositoryId: "repo_test",
  message: "fix auth",
  author: "alice",
  oidPrefix: "abcd1234",
  refFullName: "refs/heads/main",
  committedAfter: "2026-09-01T00:00:00Z",
  committedBefore: "2026-09-17T00:00:00Z",
});
```

and assert `historyPageSchema` requires `topology`.

- [x] **Step 2: Write failing semantic tests for invalid combinations.**

Cover: trimmed-empty message/author, >512 text, uppercase/non-hex/too-short SHA prefix, `committedAfter > committedBefore`, `oidPrefix + pathId`, and any walk-defining field with `cursor`.

- [x] **Step 3: Run the focused contract test and verify RED.**

Run:

```bash
pnpm exec vitest run tests/contract/schema.test.ts
```

Expected: failures because the fields/topology and semantic restrictions do not exist yet.

- [x] **Step 4: Implement the contract schemas.**

Keep existing published runtime limits unchanged. Bound each raw text field to 4096 UTF-16 code units in `reads.ts`; `validateHistoryQuery` enforces 1–512 Unicode scalar values after trimming and rejects control/multiline/unpaired-surrogate input:

```ts
const historyFilterTextSchema = z.string().max(4096);
const oidPrefixSchema = z.string().regex(/^[0-9a-f]{4,64}$/);
```

Extend `historyQuerySchema`; use an exported semantic validator in `validate.ts` to enforce date order, continuation shape, scalar text bounds and `oidPrefix`/`pathId` exclusion before coordinator work. Keep schemas JSON-Schema-exportable. Add `topology: z.enum(["continuous", "sparse"])` to `historyPageSchema`.

- [x] **Step 5: Regenerate the contract artifact and verify GREEN.**

Run:

```bash
pnpm exec vitest run tests/contract/schema.test.ts
bun scripts/generate-schema.ts
pnpm check:contract
```

Expected: contract tests pass and generated artifacts match.

- [x] **Step 6: Commit Task 1.**

```bash
git add packages/git-contract tests/contract/schema.test.ts
git commit -m "feat(contract): add history search filters"
```

---

### Task 2: Make history snapshots own normalized query intent

**Files:**

- Modify: `packages/host-node/src/coordinator/snapshot-types.ts`
- Modify: `packages/host-node/src/coordinator/snapshots.ts`
- Modify: `tests/unit/` snapshot/cursor tests (use the existing snapshot-store test file if present; otherwise create `tests/unit/history-snapshot.test.ts`)

**Interfaces:**

- Produces `NormalizedHistoryIntent` with resolved OIDs/path execution text and topology mode.
- Produces `SnapshotRecord.historyIntent: NormalizedHistoryIntent | null`.
- Keeps existing opaque `CursorPayload.limit` as the authoritative page size on continuation.

- [x] **Step 1: Write a failing snapshot-store test.**

Create a history snapshot with:

```ts
const intent: NormalizedHistoryIntent = {
  firstParentOnly: false,
  message: "auth",
  author: null,
  resolvedRefOid: null,
  committedAfterSeconds: null,
  committedBeforeSeconds: null,
  resolvedPathText: null,
  oid: null,
  oidLookup: false,
  topology: "sparse",
};
```

Assert `store.get(snapshotId)?.historyIntent` is preserved and not shared by mutable reference.

- [x] **Step 2: Run focused test and verify RED.**

Expected: compile/test failure because `NormalizedHistoryIntent` / `historyIntent` do not exist.

- [x] **Step 3: Add the server-only intent shape and snapshot storage.**

Define in `snapshot-types.ts`:

```ts
export interface NormalizedHistoryIntent {
  readonly firstParentOnly: boolean;
  readonly message: string | null;
  readonly author: string | null;
  readonly resolvedRefOid: string | null;
  readonly committedAfterSeconds: number | null;
  readonly committedBeforeSeconds: number | null;
  readonly resolvedPathText: string | null;
  readonly oid: string | null;
  readonly oidLookup: boolean;
  readonly topology: "continuous" | "sparse";
}
```

Add optional creation input and `historyIntent` on `SnapshotRecord`; copy/freeze the object and walk tips when stored. Store the fixed-size `observedRefsFingerprint` separately from bounded/scoped walk tips.

- [x] **Step 4: Verify focused tests and TypeScript.**

Run the snapshot unit test and `pnpm check` under Node 26.

- [x] **Step 5: Commit Task 2.**

```bash
git add packages/host-node/src/coordinator tests/unit
git commit -m "refactor(host): bind history intent to snapshots"
```

---

### Task 3: Extend semantic `rev-list` planning for filters

**Files:**

- Modify: `packages/git-core/src/plan/status.ts`
- Modify: `packages/git-core/src/workflows/history.ts`
- Modify: `tests/core/plans.test.ts`
- Modify: `tests/core/formats.test.ts` if a live-repo planner assertion belongs there.

**Interfaces:**

- Extends `planRevList(context, options)` with `message`, `author`, `committedAfterSeconds`, `committedBeforeSeconds`, and `pathText`.
- Keeps tips on stdin and only host-resolved path text after `--`.

- [x] **Step 1: Write exact-argv RED tests.**

Assert a combined call produces the fixed semantic shape:

```ts
[
  "--literal-pathspecs",
  "rev-list",
  "--topo-order",
  "--parents",
  "--max-count=51",
  "--fixed-strings",
  "--regexp-ignore-case",
  "--grep=fix [literal].*",
  "--author=Alice (Dev)",
  "--since-as-filter=@1788220800 +0000",
  "--min-age=1789603200",
  "--stdin",
  "--",
  "src/-odd[1].ts",
];
```

and tips remain newline-delimited stdin.

- [x] **Step 2: Verify RED.**

Run the focused planner test. Expected: options are unknown / argv does not contain filters.

- [x] **Step 3: Implement minimal planner support.**

Only add `--fixed-strings` and `--regexp-ignore-case` when message or author is present. Add exact raw lower dates `--since-as-filter=@<after> +0000` and numeric `--min-age=<before>`. Negative lower bounds impose no restriction; negative upper bounds produce an empty walk. Use `--literal-pathspecs` globally and append `--` plus exact resolved path after `--stdin` when present. Filtered text commands carry only the closed `textSearchLocale: "unicode"` private hint; Node owns per-invocation UTF-8 locale selection.

- [x] **Step 4: Thread options through `readTopologyPage` and `readHistoryPage`.**

Do not change body parsing, boundary detection, or decoration behavior.

- [x] **Step 5: Run core tests and verify GREEN.**

```bash
pnpm exec vitest run tests/core/plans.test.ts tests/core/formats.test.ts
```

- [x] **Step 6: Commit Task 3.**

```bash
git add packages/git-core tests/core
git commit -m "feat(git-core): plan filtered history walks"
```

---

### Task 4: Add semantic SHA-prefix resolution

**Files:**

- Modify: `packages/git-core/src/plan/refs.ts`
- Modify: `packages/git-core/src/parse/meta.ts`
- Modify: `packages/git-core/src/workflows/history.ts`
- Modify: `tests/core/plans.test.ts`
- Modify: `tests/core/formats.test.ts`

**Interfaces:**

- Produces `resolveCommitPrefix(engine, { cwdHandle, prefix }): Promise<"none" | { kind: "one"; oid: string } | { kind: "ambiguous" }>` and `isCommitReachableFrom(engine, { cwdHandle, ancestorOid, descendantOid }): Promise<boolean>`.
- Never accepts arbitrary rev syntax; only already-validated lowercase hex/full OIDs.

- [x] **Step 1: Write RED planner/parser/workflow tests.**

Cover no matches, one commit, multiple commit matches, and a unique non-commit object. Include SHA-256 fixture coverage where supported by the existing fixture helpers.

- [x] **Step 2: Add a dedicated disambiguation planner.**

Use semantic argv:

```ts
["rev-parse", `--disambiguate=${prefix}`];
```

Then use a batch-check planner that reports both object name and object type, for example:

```ts
["cat-file", "--batch-check=%(objectname) %(objecttype)"];
```

with candidate OIDs on stdin.

- [x] **Step 3: Add strict parsers for newline OID candidates and object types.**

Reject non-hex Git output and malformed type lines rather than guessing.

- [x] **Step 4: Implement `resolveCommitPrefix`.**

Filter candidates to `commit`; zero → `none`, one → full OID, more than one → `ambiguous`.

- [x] **Step 5: Add a semantic ancestry planner/workflow for SHA + ref composition.**

Plan `git merge-base --is-ancestor <ancestorOid> <descendantOid>` from two host-resolved full object IDs. Use `runMeaningfulExit(..., [1])` so exit 0 means reachable, exit 1 means not reachable, and every other termination remains an error. Add RED/GREEN tests for both answers.

- [x] **Step 6: Verify focused core tests GREEN and commit.**

```bash
pnpm exec vitest run tests/core/plans.test.ts tests/core/formats.test.ts
git add packages/git-core tests/core
git commit -m "feat(git-core): resolve commit oid prefixes"
```

---

### Task 5: Normalize history filters in the Node host and make cursors authoritative

**Files:**

- Modify: `packages/host-node/src/coordinator/reads.ts`
- Modify: `packages/host-node/src/coordinator/snapshot-types.ts`
- Modify: `packages/host-node/src/coordinator/snapshots.ts`
- Modify: `tests/integration/reads.test.ts`
- Modify: `tests/integration/scopes.test.ts` only if authorization regression coverage needs the new query fields.

**Interfaces:**

- Consumes public `HistoryQuery` from Task 1, planner/filter support from Task 3, SHA resolver from Task 4, and `NormalizedHistoryIntent` from Task 2.
- Produces one normalized first-page intent and reuses snapshot intent on continuation.

- [x] **Step 1: Write host integration RED tests for each filter.**

Create deterministic fixture commits and assert message, author, date, observed ref, `pathId`, and SHA prefix each return only matching commits. Assert filtered pages report `topology: "sparse"`; unfiltered/ref-only/first-parent pages report `"continuous"`.

- [x] **Step 2: Write RED tests for AND composition and empty success.**

Combine message + author + ref + dates and prove all predicates apply. A valid query with no matching commit returns `commits: []`, `nextCursor: null`, and the correct topology mode.

- [x] **Step 3: Write RED cursor-authority tests.**

Start a multi-page filtered query, move the ref, remove/evict the original path binding if the registry test seam permits it, then continue with the cursor. Assert page two uses the original pinned ref/path intent. Assert continuation requests that also send `limit`, `firstParentOnly`, `message`, `author`, `oidPrefix`, `refFullName`, date bounds, or `pathId` are `InvalidRequest`.

- [x] **Step 4: Write RED authority/error tests.**

Cover unknown observed ref → `NotFound`; foreign path ID → existing scope-safe path error; unrepresentable path → `UnsupportedPathEncoding`; ambiguous SHA prefix → `InvalidRequest`; SHA prefix longer than the repository hash width → `InvalidRequest`.

- [x] **Step 5: Implement first-page normalization in `reads.ts`.**

Add focused helpers near history coordination, for example:

```ts
async function normalizeHistoryIntent(input: {
  query: HistoryQuery;
  record: RepositoryRecord;
  worktree: WorktreeRecord;
  handle: string;
  head: HeadFacts;
  refs: readonly RefRecord[];
}): Promise<{ intent: NormalizedHistoryIntent; tips: string[] }>;
```

Resolve exact observed ref names to peeled OIDs, path bindings with `requirePathBinding`, timestamps to integer seconds, and SHA prefix through `resolveCommitPrefix`. Classify topology as sparse whenever message/author/date/path/SHA filtering is active.

- [x] **Step 6: Change history continuation ordering.**

When `cursor` is present, resolve it before choosing page size or walk options. Use `resolved.payload.limit` and `snapshot.historyIntent`; do not read walk-defining values from the request.

- [x] **Step 7: Implement SHA-locator membership filtering.**

For a resolved SHA commit, prove it satisfies ref ancestry when `refFullName` is also present and apply message/author/date predicates without converting browser input into revspecs. Return an empty sparse page when the commit does not satisfy the remaining predicates.

- [x] **Step 8: Run focused host tests GREEN.**

```bash
pnpm exec vitest run tests/integration/reads.test.ts
```

Then run `pnpm check`.

- [x] **Step 9: Commit Task 5.**

```bash
git add packages/host-node tests/integration/reads.test.ts tests/integration/scopes.test.ts
git commit -m "feat(host): normalize filtered history reads"
```

---

### Task 6: Carry typed filters through HTTP and the public client

**Files:**

- Modify: `packages/git-client/src/client.ts`
- Modify: `tests/integration/http.test.ts`
- Modify: `tests/unit/git-client.test.ts` if query encoding is unit-tested there.

**Interfaces:**

- `GitClient.history(...)` accepts the Task 1 fields.
- First-page URL encoding includes applied filter fields; cursor continuation omits walk-defining fields.

- [x] **Step 1: Write HTTP/client RED tests.**

Call the client with hostile literal text such as `fix [auth].* + spaces`, an author with punctuation, a full ref, timestamps, and a path ID. Assert the server receives the typed values after URL encoding and returns the matching page.

- [x] **Step 2: Add a continuation regression.**

Request page one with filters, then page two with only repository/worktree/cursor. Assert the second request succeeds and attempting to append `message` with the same cursor answers `InvalidRequest`.

- [x] **Step 3: Extend `GitClient.history` and `toQueryString` call sites.**

Keep fields explicit:

```ts
message: query.message,
author: query.author,
oidPrefix: query.oidPrefix,
refFullName: query.refFullName,
committedAfter: query.committedAfter,
committedBefore: query.committedBefore,
pathId: query.pathId,
```

Do not introduce a generic arbitrary-query passthrough.

- [x] **Step 4: Run client/HTTP tests and check.**

```bash
pnpm exec vitest run tests/unit/git-client.test.ts tests/integration/http.test.ts
pnpm check
```

- [x] **Step 5: Commit Task 6.**

```bash
git add packages/git-client tests/unit/git-client.test.ts tests/integration/http.test.ts
git commit -m "feat(client): send typed history filters"
```

---

### Task 7: Add pure web history-filter state and query composition

**Files:**

- Create: `apps/web/src/lib/workbench/history-filter.ts`
- Modify: `apps/web/src/lib/workbench/queries.svelte.ts`
- Modify: `apps/web/src/lib/workbench/query-model.ts`
- Modify: `apps/web/src/lib/workbench/selection.ts` only if a focused helper is needed to clear commit/path selection on Apply/Clear.
- Create: `tests/unit/workbench-history-filter.test.ts`
- Modify: `tests/unit/workbench-query-model.test.ts`

**Interfaces:**

- Produces `HistoryFilterDraft`, `AppliedHistoryFilter`, `createHistoryFilterState`, `applyHistoryFilters`, `clearHistoryFilters`, and `historyFilterIsActive`.
- `createWorkbenchQueries` consumes the applied filter and includes it in the infinite-query key.

- [x] **Step 1: Write RED pure-model tests.**

Cover draft edits not changing applied state; Apply trims text and copies only non-empty fields; Clear resets both; repository change resets authority-bearing and text/date state; equivalent normalized filters compare/query-key identically.

- [x] **Step 2: Define the pure filter model.**

Use serializable values only:

```ts
export interface AppliedHistoryFilter {
  readonly message: string | null;
  readonly author: string | null;
  readonly oidPrefix: string | null;
  readonly refFullName: string | null;
  readonly committedAfter: string | null;
  readonly committedBefore: string | null;
  readonly pathId: string | null;
}
```

Do not store query objects, clients, or DOM state in this module.

- [x] **Step 3: Write a RED query-composition boundary test.**

Assert page one passes all applied filter fields, while `pageParam !== null` sends only repository ID, optional worktree ID, cursor, and page-size authority is left to the server cursor.

- [x] **Step 4: Integrate the applied filter into `queries.svelte.ts`.**

The infinite-query key becomes:

```ts
[
  "history",
  baseUrl,
  token,
  selectedRepositoryId,
  appliedHistoryFilter,
  executionRevision,
];
```

On page one pass `limit: HISTORY_PAGE_SIZE` plus non-null filter fields. On continuation pass only identity + cursor.

- [x] **Step 5: Extend query-model notices for topology.**

Expose whether any returned page is sparse; do not call `layoutPages` for sparse pages. Return an explicit sparse presentation state instead of fake lane rows.

- [x] **Step 6: Run focused unit tests and check.**

```bash
pnpm exec vitest run tests/unit/workbench-history-filter.test.ts tests/unit/workbench-query-model.test.ts tests/unit/workbench-query-boundary.test.ts
pnpm check
```

- [x] **Step 7: Commit Task 7.**

```bash
git add apps/web/src/lib/workbench tests/unit
git commit -m "feat(web): model history filter queries"
```

---

### Task 8: Build the History filter UI and sparse commit presentation

**Files:**

- Create: `packages/git-ui/src/components/HistoryFilterBar.svelte`
- Modify: `packages/git-ui/src/components/CommitList.svelte`
- Modify: `packages/git-ui/src/index.ts`
- Modify: `apps/web/src/routes/+page.svelte`
- Modify: `tests/unit/` component-boundary tests if the project uses structural UI ownership tests.

**Interfaces:**

- `HistoryFilterBar` receives draft values, observed refs, optional known selected path, and callbacks `onDraftChange`, `onApply`, `onClear`.
- `CommitList` receives a `topologyMode: "continuous" | "sparse"` prop; sparse mode renders markers only and no ancestry edges.

- [x] **Step 1: Write structural/component RED tests.**

Require `HistoryFilterBar` to exist and `+page.svelte` to compose it above History. Require `CommitList` to expose an explicit topology-mode input rather than inferring filters itself.

- [x] **Step 2: Implement the filter bar with explicit Apply/Enter.**

Primary visible input is message search. Secondary controls expose author, observed ref, SHA, after, before, and a known `pathId` choice. Typing only mutates draft state. Pressing Enter or Apply invokes `onApply`; Clear invokes `onClear`.

- [x] **Step 3: Wire filter state in the workbench route.**

Applying or clearing filters clears selected commit/path-diff state before changing the applied filter. Switching repository resets filter state. Use refs already returned by `queries.refs`; never accept an arbitrary ref expression.

- [x] **Step 4: Implement sparse rendering in `CommitList`.**

For `continuous`, retain the existing SVG graph and lane geometry unchanged. For `sparse`, render one marker per row in the graph gutter and skip graph edge/continuation rendering entirely. Keep row virtualization, click selection, context menus, refs, author/time, and SHA unchanged.

- [x] **Step 5: Add visible sparse/active-filter feedback.**

Show concise active chips/labels and a `Filtered history · topology hidden` indicator when `HistoryPage.topology === "sparse"`. Empty filtered history gets an explicit no-matches state, not fallback unfiltered commits.

- [x] **Step 6: Run Node 26 `pnpm check` and focused unit/structural tests.**

- [x] **Step 7: Commit Task 8.**

```bash
git add packages/git-ui apps/web/src/routes/+page.svelte tests/unit
git commit -m "feat(git-ui): add history search controls"
```

---

### Task 9: Add Chromium end-to-end history search coverage

**Files:**

- Create: `tests/e2e/history-search.spec.ts`
- Modify: `tests/support/repo.ts` only if deterministic author/timestamp fixture helpers are missing.

**Interfaces:**

- Exercises only the public UI and real Git fixture; no direct coordinator calls for success assertions.

- [x] **Step 1: Write a browser RED for message Apply/Clear.**

Create commits with distinct subjects, type a message, prove no result changes before Apply, Apply and see only matching rows, then Clear and see the continuous graph/history restored.

- [x] **Step 2: Add combined author + ref + date coverage.**

Use fixture commits with deterministic authors/timestamps and a secondary branch/ref. Prove AND semantics and the sparse indicator where appropriate.

- [x] **Step 3: Add SHA prefix and empty-result coverage.**

Use an abbreviated prefix from a known commit and assert the exact row is shown. Search a valid non-matching term and assert explicit empty state.

- [x] **Step 4: Add known-path history coverage.**

Make a tracked file changed in multiple commits, leave it modified so status mints a `pathId`, select/use that known path in History filters, and assert only commits touching it appear.

- [x] **Step 5: Add active-filter pagination coverage.**

Create enough matching commits to cross the page size used by a test seam or fixture helper, load the next page, and prove no duplicate/missing rows and the same filter remains applied.

- [x] **Step 6: Run the focused Chromium spec RED/GREEN cycle.**

```bash
pnpm build && bun scripts/bundle-cli.ts
pnpm exec playwright test tests/e2e/history-search.spec.ts --project=chromium
```

- [x] **Step 7: Commit Task 9.**

```bash
git add tests/e2e/history-search.spec.ts tests/support/repo.ts
git commit -m "test(e2e): cover history search filters"
```

---

### Task 10: Record product status and run release-quality verification

**Files:**

- Modify: `docs/product/git-client-direction.md`
- Modify: `docs/superpowers/plans/2026-09-17-history-search-filters.md`

**Interfaces:**

- Marks Phase C item 3 implemented only after all fresh gates pass.

- [x] **Step 1: Update the product direction after implementation is complete.**

Record message/author/ref/date/SHA/path search, explicit Apply/Clear, cursor-owned query identity, and sparse topology behavior. Leave keyboard/command palette and contextual-feedback items pending.

- [x] **Step 2: Run fresh Node 26 static and contract gates.**

```bash
source ~/.nvm/nvm.sh
nvm use 26.8.2
pnpm check
pnpm check:contract
pnpm check:boundaries
```

- [x] **Step 3: Run fresh unit and integration/security gates.**

```bash
pnpm test:unit
pnpm test:integration
```

- [x] **Step 4: Run fresh full Chromium from a rebuilt bundle.**

```bash
pnpm build
bun scripts/bundle-cli.ts
pnpm exec playwright test --project=chromium
```

- [x] **Step 5: Run final repository hygiene checks.**

```bash
git diff --check
git status --short
git log -12 --oneline
```

Inspect generated schema changes and confirm no build artifacts or unrelated files are staged.

- [x] **Step 6: Commit the product/evidence update.**

```bash
git add docs/product/git-client-direction.md docs/superpowers/plans/2026-09-17-history-search-filters.md
git commit -m "docs(product): record history search filters"
```

## Completion Criteria

- History can be filtered by message, author, observed ref, commit date bounds, SHA prefix, and a known `pathId` through one typed API.
- First-page filters are normalized to server-owned intent; opaque cursors continue that exact intent and page size.
- Ref movement and path-registry eviction cannot reinterpret an existing page chain.
- Sparse searches never draw continuous ancestry through omitted commits.
- Unfiltered/ref-only history retains the existing continuous graph and behavior.
- Browser search runs only on Apply/Enter, not every keystroke.
- Existing auth/grant and no-raw-Git boundaries remain intact.
- Fresh Node 26 check, contract, boundary, unit, integration/security, and full Chromium gates all pass before Phase C item 3 is marked implemented.
