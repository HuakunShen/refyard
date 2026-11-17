/** A closed, browser-only catalogue of fictional repositories for the public demo. */
import { statusSnapshotSchema } from "@refyard/git-contract";
import { makeDemoFixture, type DemoFixture } from "./fixtures.js";
import { createDemoState, reduceDemoState, type DemoAction, type DemoState } from "./reducer.js";

export interface DemoRepositoryFixture {
  readonly id: string;
  readonly name: string;
  readonly branch: string;
  readonly path: string;
  readonly fixture: DemoFixture;
}

const CATALOGUE = [
  { id: "atlas-editor", name: "atlas-editor", branch: "main", path: "~/Projects/atlas-editor" },
  { id: "sample-api", name: "sample-api", branch: "develop", path: "~/Projects/sample-api" },
  { id: "design-system", name: "design-system", branch: "main", path: "~/Projects/design-system" },
] as const;

export function makeDemoRepositories(): readonly DemoRepositoryFixture[] {
  return CATALOGUE.map(({ id, name, branch, path }, index) => {
    const fixture = makeDemoFixture();
    const repositoryId = `repo_${id.replaceAll("-", "_")}`;
    const commits = fixture.commits.map((commit, commitIndex) => {
      const subject = index === 0 ? commit.subject : commitIndex < 5
        ? `${index === 1 ? "api" : "ui"}: ${commit.subject}` : commit.subject;
      return { ...commit, subject, refNames: commit.refNames.map((ref) => ref === "refs/heads/main" ? `refs/heads/${branch}` : ref === "refs/remotes/origin/main" ? `refs/remotes/origin/${branch}` : ref) };
    });
    const detailsByOid = Object.fromEntries(commits.map((commit) => {
      const detail = fixture.detailsByOid[commit.oid];
      if (!detail) throw new Error("Preset demo commit detail is missing");
      return [commit.oid, { ...detail, subject: commit.subject }];
    }));
    const diffsByOid = Object.fromEntries(Object.entries(fixture.diffsByOid).map(([oid, diff]) => [oid, {
      ...diff, repositoryId, worktreeId: `wt_${id.replaceAll("-", "_")}`,
    }]));
    const status = statusSnapshotSchema.parse({
      ...fixture.status, repositoryId, worktreeId: `wt_${id.replaceAll("-", "_")}`,
      head: { ...fixture.status.head, branchName: branch },
      upstream: { ...fixture.status.upstream, name: `origin/${branch}` },
      entries: fixture.status.entries.map((entry) => ({ ...entry,
        displayPath: index === 1 ? entry.displayPath.replace("src/components", "src/routes").replace("src/git", "src/server")
          : index === 2 ? entry.displayPath.replace("src/git", "src/tokens").replace("src/components", "src/primitives")
          : entry.displayPath,
      })),
    });
    return { id, name, branch, path, fixture: { commits, detailsByOid, diffsByOid, status } };
  });
}

export interface DemoWorkspaceState {
  readonly repositories: readonly DemoRepositoryFixture[];
  readonly openRepositoryIds: readonly string[];
  readonly activeRepositoryId: string;
  readonly statesById: Readonly<Record<string, DemoState>>;
}

export type DemoWorkspaceAction =
  | { readonly type: "select-repository"; readonly repositoryId: string }
  | { readonly type: "close-tab"; readonly repositoryId: string }
  | { readonly type: "open-tab"; readonly repositoryId: string }
  | { readonly type: "repo"; readonly action: DemoAction }
  | { readonly type: "stage-all" }
  | { readonly type: "reset" };

export function createDemoWorkspace(): DemoWorkspaceState {
  const repositories = makeDemoRepositories();
  return {
    repositories,
    openRepositoryIds: repositories.map((repo) => repo.id),
    activeRepositoryId: repositories[0]?.id ?? "",
    statesById: Object.fromEntries(repositories.map((repo) => [repo.id, createDemoState(repo.fixture)])),
  };
}

export function getActiveDemoState(workspace: DemoWorkspaceState): DemoState {
  const state = workspace.statesById[workspace.activeRepositoryId];
  if (!state) throw new Error("Public demo catalogue has no active repository");
  return state;
}

export function reduceDemoWorkspace(workspace: DemoWorkspaceState, action: DemoWorkspaceAction): DemoWorkspaceState {
  switch (action.type) {
    case "reset": return createDemoWorkspace();
    case "select-repository":
      return workspace.openRepositoryIds.includes(action.repositoryId)
        ? { ...workspace, activeRepositoryId: action.repositoryId } : workspace;
    case "open-tab":
      if (!workspace.statesById[action.repositoryId]) return workspace;
      return { ...workspace,
        openRepositoryIds: workspace.openRepositoryIds.includes(action.repositoryId)
          ? workspace.openRepositoryIds : [...workspace.openRepositoryIds, action.repositoryId],
        activeRepositoryId: action.repositoryId,
      };
    case "close-tab": {
      if (!workspace.openRepositoryIds.includes(action.repositoryId) || workspace.openRepositoryIds.length <= 1) return workspace;
      const openRepositoryIds = workspace.openRepositoryIds.filter((id) => id !== action.repositoryId);
      return { ...workspace, openRepositoryIds,
        activeRepositoryId: workspace.activeRepositoryId === action.repositoryId
          ? openRepositoryIds[0] ?? workspace.activeRepositoryId : workspace.activeRepositoryId };
    }
    case "stage-all": {
      const state = getActiveDemoState(workspace);
      // Mixed index/worktree entries cannot be safely represented as whole-file staging.
      const pathIds = state.status.entries.filter((entry) =>
        entry.kind === "untracked" || (entry.kind === "ordinary" && entry.indexStatus === "." && entry.worktreeStatus !== "."),
      ).map((entry) => entry.pathId);
      return reduceDemoWorkspace(workspace, { type: "repo", action: { type: "stage", pathIds } });
    }
    case "repo": {
      const previous = getActiveDemoState(workspace);
      const next = reduceDemoState(previous, action.action);
      if (previous === next) return workspace;
      return { ...workspace, statesById: { ...workspace.statesById, [workspace.activeRepositoryId]: next } };
    }
  }
}
