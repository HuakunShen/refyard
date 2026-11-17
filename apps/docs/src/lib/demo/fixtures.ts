/**
 * Deterministic, entirely synthetic Git history, patch and working-copy DTOs for
 * the public browser demo. These are validated against the product contract.
 */
import {
  commitDetailSchema,
  commitSummarySchema,
  diffResponseSchema,
  statusSnapshotSchema,
  type CommitDetail,
  type CommitSummary,
  type DiffResponse,
  type StatusEntry,
  type StatusSnapshot,
} from "@refyard/git-contract";

export interface DemoFixture {
  commits: readonly CommitSummary[];
  detailsByOid: Readonly<Record<string, CommitDetail>>;
  diffsByOid: Readonly<Record<string, DiffResponse>>;
  status: StatusSnapshot;
}

const REPOSITORY = "repo_showcase";
const WORKTREE = "wt_showcase";
const SNAPSHOT = "snap_showcase";
const AUTHORS = ["Alex Morgan", "Casey Chen", "Jordan Ellis", "Riley Park"];
const SUBJECTS = [
  "refactor: isolate graph rendering from data reads",
  "feat: preview changes before staging",
  "fix: preserve commit lane colors through merges",
  "docs: explain the working copy model",
  "feat: keyboard navigation for history",
  "perf: virtualize long commit timelines",
  "test: cover reordered history pages",
  "merge: integrate feature/graph-rework",
  "feat: add split patch review",
  "fix: align connector strokes on retina screens",
  "feat: contextual branch labels",
  "chore: simplify color tokens",
  "fix: keep selected commit visible",
  "feat: introduce repository workspace tabs",
  "docs: add staging walkthrough",
  "refactor: separate commit metadata panel",
  "feat: search across commit subjects",
  "fix: handle detached HEAD accurately",
  "test: add realistic merge fixtures",
  "feat: initial change explorer",
];
const FILES = [
  "src/git/graph/layout.ts",
  "src/components/CommitGraph.svelte",
  "src/components/DiffPanel.svelte",
  "docs/workflows/working-copy.md",
];

/** Synthetic SHA-1-shaped IDs, never a real object hash. */
export function demoOid(index: number): string {
  let state = (index + 0x9e3779b9) >>> 0;
  return Array.from({ length: 5 }, (_, round) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state = (state + Math.imul(round + 1, 0x6d2b79f5)) >>> 0;
    return state.toString(16).padStart(8, "0");
  }).join("");
}

function makeCommit(index: number): CommitSummary {
  const authorName = AUTHORS[index % AUTHORS.length] ?? "Refyard Demo";
  const authoredAt = new Date(Date.UTC(2026, 9, 20, 11, 0, 0) - index * 5_400_000).toISOString();
  const parents = index === 31 ? [] : index === 7 ? [demoOid(8), demoOid(10)] : [demoOid(index + 1)];
  const refNames = index === 0
    ? ["refs/heads/main", "refs/remotes/origin/main"]
    : index === 4 ? ["refs/heads/feature/graph-rework"]
      : index === 16 ? ["refs/tags/v0.7.0"] : [];
  return commitSummarySchema.parse({
    oid: demoOid(index), parents,
    subject: SUBJECTS[index % SUBJECTS.length] ?? "chore: refine Git experience",
    authorName,
    authorEmail: `${authorName.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
    authoredAt, committedAt: authoredAt, refNames,
    signed: index % 6 === 0, boundary: false, missingParents: [],
  });
}

function makeDetail(commit: CommitSummary): CommitDetail {
  return commitDetailSchema.parse({
    oid: commit.oid, parents: commit.parents, treeOid: demoOid(100 + Number.parseInt(commit.oid.slice(-2), 16)),
    authorName: commit.authorName, authorEmail: commit.authorEmail, authoredAt: commit.authoredAt,
    committerName: commit.authorName, committerEmail: commit.authorEmail, committedAt: commit.committedAt,
    subject: commit.subject, body: "Built in the Refyard demonstration repository.\nAll commits and files shown here are generated examples.",
    encoding: "UTF-8", signed: commit.signed,
  });
}

/** A bounded, parsed text patch — rendered by the real DiffPanel component. */
export function makeDemoDiff(oid: string, index: number): DiffResponse {
  const displayPath = FILES[index % FILES.length] ?? "src/demo.ts";
  const pathId = `path_patch_${index}`;
  const before = index % 2 === 0 ? "const renderMode = 'compact';" : "const showHistory = false;";
  const after = index % 2 === 0 ? "const renderMode = 'detailed';" : "const showHistory = true;";
  return diffResponseSchema.parse({
    snapshotId: SNAPSHOT, repositoryId: REPOSITORY, worktreeId: WORKTREE,
    readAt: "2026-10-20T12:00:00.000Z",
    request: { kind: "commit", oid, from: null, to: null, pathId: null },
    files: [{
      pathId, displayPath, oldPathId: null, oldDisplayPath: null,
      changeKind: "modified", isBinary: false, isSubmodule: false,
      insertions: 1, deletions: 1, modes: { old: "100644", new: "100644" },
      patch: {
        kind: "text", synthesized: false,
        hunks: [{
          header: "@@ -11,4 +11,4 @@", oldStart: 11, oldLines: 4, newStart: 11, newLines: 4,
          lines: [
            { kind: "context", text: "export function createWorkspace() {", noNewline: false },
            { kind: "remove", text: `  ${before}`, noNewline: false },
            { kind: "add", text: `  ${after}`, noNewline: false },
            { kind: "context", text: "  return initializeGraph();", noNewline: false },
            { kind: "context", text: "}", noNewline: false },
          ],
        }],
      },
    }],
    stats: { filesChanged: 1, insertions: 1, deletions: 1, binaryFiles: 0 }, truncated: false,
  });
}

function statusEntry(pathId: string, displayPath: string, indexStatus: string, worktreeStatus: string, kind: StatusEntry["kind"] = "ordinary"): StatusEntry {
  return {
    pathId, displayPath, pathEncoding: "utf8", kind,
    indexStatus, worktreeStatus, originalPathId: null, originalDisplayPath: null,
    headOid: kind === "untracked" ? null : demoOid(200),
    indexOid: kind === "untracked" ? null : indexStatus === "." ? demoOid(200) : demoOid(201),
    modes: kind === "untracked" ? null : { head: "100644", index: "100644", worktree: "100644" },
    submodule: null, stages: null,
  };
}

export function makeDemoFixture(): DemoFixture {
  const commits = Array.from({ length: 32 }, (_, index) => makeCommit(index));
  const detailsByOid: Record<string, CommitDetail> = {};
  const diffsByOid: Record<string, DiffResponse> = {};
  for (const [index, commit] of commits.entries()) {
    detailsByOid[commit.oid] = makeDetail(commit);
    diffsByOid[commit.oid] = makeDemoDiff(commit.oid, index);
  }
  const entries: StatusEntry[] = [
    statusEntry("path_graph", "src/git/graph/layout.ts", "M", "."),
    statusEntry("path_ui", "src/components/CommitGraph.svelte", ".", "M"),
    statusEntry("path_docs", "docs/workflows/working-copy.md", ".", "M"),
    statusEntry("path_untracked", "src/components/KeyboardHints.svelte", "?", "?", "untracked"),
    statusEntry("path_mixed", "src/lib/theme.ts", "M", "M"),
  ];
  const status = statusSnapshotSchema.parse({
    snapshotId: SNAPSHOT, repositoryId: REPOSITORY, worktreeId: WORKTREE,
    readAt: "2026-10-20T12:00:00.000Z",
    head: { kind: "born", branchName: "main", oid: commits[0]?.oid ?? null, detached: false },
    upstream: { name: "origin/main", ahead: 0, behind: 0 }, operationInProgress: null,
    entries, entryCount: entries.length, truncated: false,
  });
  return { commits, detailsByOid, diffsByOid, status };
}
