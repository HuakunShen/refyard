/**
 * Pure, side-effect-free state transitions for the browser-only Git sandbox.
 * These actions are simulations, never real Git operations.
 */
import {
  commitDetailSchema,
  commitSummarySchema,
  statusSnapshotSchema,
  type CommitDetail,
  type CommitSummary,
  type DiffResponse,
  type StatusEntry,
  type StatusSnapshot,
} from "@refyard/git-contract";
import { demoOid, makeDemoDiff, type DemoFixture } from "./fixtures.js";

export type DemoSide = "staged" | "unstaged";

export interface DemoState {
  readonly commits: readonly CommitSummary[];
  readonly detailsByOid: Readonly<Record<string, CommitDetail>>;
  readonly diffsByOid: Readonly<Record<string, DiffResponse>>;
  readonly status: StatusSnapshot;
  readonly selectedOid: string | null;
  readonly selectedPathId: string | null;
  readonly selectedSide: DemoSide | null;
  readonly filter: string;
  readonly revision: number;
  readonly baseline: DemoFixture;
}

export type DemoAction =
  | { readonly type: "select-commit"; readonly oid: string }
  | { readonly type: "select-file"; readonly pathId: string; readonly side: DemoSide }
  | { readonly type: "filter"; readonly query: string }
  | { readonly type: "stage"; readonly pathIds: readonly string[] }
  | { readonly type: "unstage"; readonly pathIds: readonly string[] }
  | { readonly type: "commit"; readonly message: string }
  | { readonly type: "reset" };

export function createDemoState(fixture: DemoFixture): DemoState {
  const snapshot = structuredClone(fixture);
  return {
    ...snapshot,
    selectedOid: snapshot.commits[0]?.oid ?? null,
    selectedPathId: null,
    selectedSide: null,
    filter: "",
    revision: 0,
    baseline: structuredClone(fixture),
  };
}

function canMove(entry: StatusEntry, side: DemoSide): boolean {
  if (entry.kind === "unmerged" || entry.kind === "ignored" || entry.pathEncoding !== "utf8" || (entry.stages?.length ?? 0) > 0) return false;
  if (entry.kind === "untracked") return side === "unstaged";
  return side === "unstaged"
    ? entry.indexStatus === "." && entry.worktreeStatus !== "."
    : entry.indexStatus !== "." && entry.worktreeStatus === ".";
}

function transition(entry: StatusEntry, action: "stage" | "unstage"): StatusEntry {
  if (action === "stage") {
    if (entry.kind === "untracked") {
      return { ...entry, kind: "ordinary", indexStatus: "A", worktreeStatus: ".", indexOid: demoOid(202), modes: { head: null, index: "100644", worktree: "100644" } };
    }
    return { ...entry, indexStatus: entry.worktreeStatus, worktreeStatus: ".", indexOid: demoOid(203) };
  }
  if (entry.indexStatus === "A" && entry.headOid === null) {
    return { ...entry, kind: "untracked", indexStatus: "?", worktreeStatus: "?", indexOid: null, modes: null };
  }
  return { ...entry, worktreeStatus: entry.indexStatus, indexStatus: ".", indexOid: entry.headOid };
}

export function reduceDemoState(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset":
      return createDemoState(state.baseline);
    case "filter":
      return { ...state, filter: action.query };
    case "select-commit":
      if (!state.commits.some((commit) => commit.oid === action.oid)) return state;
      return { ...state, selectedOid: action.oid, selectedPathId: null, selectedSide: null };
    case "select-file": {
      if (!state.status.entries.some((entry) => entry.pathId === action.pathId)) return state;
      return { ...state, selectedPathId: action.pathId, selectedSide: action.side };
    }
    case "stage":
    case "unstage": {
      const ids = new Set(action.pathIds);
      if (ids.size === 0) return state;
      const side: DemoSide = action.type === "stage" ? "unstaged" : "staged";
      if ([...ids].some((id) => !state.status.entries.some((entry) => entry.pathId === id && canMove(entry, side)))) return state;
      const entries = state.status.entries.map((entry) => ids.has(entry.pathId) ? transition(entry, action.type) : entry);
      return { ...state, status: statusSnapshotSchema.parse({ ...state.status, entries, entryCount: entries.length }) };
    }
    case "commit": {
      const message = action.message.trim();
      const staged = state.status.entries.filter((entry) => entry.indexStatus !== "." && entry.indexStatus !== "?");
      if (!message || staged.length === 0) return state;
      const previous = state.commits[0];
      const oid = demoOid(1000 + state.revision);
      const timestamp = new Date(Date.UTC(2026, 9, 20, 12, state.revision)).toISOString();
      const [subject, ...body] = message.split("\n");
      if (!subject || subject.length > 4096) return state;
      const commit = commitSummarySchema.parse({
        oid, parents: previous ? [previous.oid] : [], subject,
        authorName: "You · Sandbox", authorEmail: "sandbox@example.invalid",
        authoredAt: timestamp, committedAt: timestamp,
        refNames: ["refs/heads/main"], signed: false, boundary: false, missingParents: [],
      });
      const detail = commitDetailSchema.parse({
        oid: commit.oid, parents: commit.parents, treeOid: demoOid(300 + state.revision),
        subject: commit.subject, authorName: commit.authorName, authorEmail: commit.authorEmail,
        authoredAt: commit.authoredAt, committedAt: commit.committedAt, signed: false,
        committerName: commit.authorName, committerEmail: commit.authorEmail,
        body: body.join("\n"), encoding: "UTF-8",
      });
      const entries = state.status.entries.flatMap((entry) => {
        if (entry.indexStatus === "." || entry.indexStatus === "?") return [entry];
        if (entry.worktreeStatus === ".") return [];
        return [{ ...entry, indexStatus: ".", indexOid: demoOid(202 + state.revision) }];
      });
      const commits = [commit, ...state.commits.map((existing) => ({
        ...existing,
        refNames: existing.refNames.filter((ref) => ref !== "refs/heads/main" && ref !== "refs/remotes/origin/main"),
      }))];
      return {
        ...state, commits,
        detailsByOid: { ...state.detailsByOid, [oid]: detail },
        diffsByOid: { ...state.diffsByOid, [oid]: makeDemoDiff(oid, 1000 + state.revision) },
        status: statusSnapshotSchema.parse({
          ...state.status, head: { ...state.status.head, oid }, entries, entryCount: entries.length,
          upstream: state.status.upstream ? { ...state.status.upstream, ahead: state.status.upstream.ahead + 1 } : null,
        }),
        selectedOid: oid, selectedPathId: null, selectedSide: null,
        revision: state.revision + 1,
      };
    }
  }
}
