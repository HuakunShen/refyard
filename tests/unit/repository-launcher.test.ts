/** Repository launcher and tab state stays deterministic outside Svelte components. */
import { describe, expect, it } from "vitest";
import {
  adoptRepositoryTabs,
  closeRepositoryTab,
  createRepositoryTabs,
  openRepositoryTab,
  selectRepositoryTab,
  type RepositoryTab,
} from "../../apps/web/src/lib/workbench/repository-tabs.js";
import {
  filterRecentRepositories,
  type RecentRepository,
} from "../../apps/web/src/lib/workbench/repository-launcher.js";

const repoA: RepositoryTab = {
  repositoryId: "repo_a",
  displayName: "alpha",
  displayPath: "/projects/alpha",
};
const repoB: RepositoryTab = {
  repositoryId: "repo_b",
  displayName: "beta",
  displayPath: "/projects/beta",
};

describe("repository tabs", () => {
  it("keeps two worktrees of the same repository in distinct tabs", () => {
    // Prevents opening a linked checkout from silently reusing the primary tab.
    const state = createRepositoryTabs([repoA]);
    openRepositoryTab(state, { ...repoA, worktreeId: "wt_feature" });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeRepositoryId).toBe("repo_a:wt_feature");
    closeRepositoryTab(state, "repo_a:wt_feature");
    expect(state.tabs).toEqual([repoA]);
    expect(state.activeRepositoryId).toBe("repo_a");
  });
  it("opens and activates repositories without duplicating a tab", () => {
    const state = createRepositoryTabs();

    openRepositoryTab(state, repoA);
    openRepositoryTab(state, repoB);
    openRepositoryTab(state, repoA);

    expect(state.tabs).toEqual([repoA, repoB]);
    expect(state.activeRepositoryId).toBe("repo_a");
    expect(state.revision).toBe(3);
  });

  it("selects an existing tab and chooses a neighbor after closing the active tab", () => {
    const state = createRepositoryTabs([repoA, repoB]);

    selectRepositoryTab(state, "repo_b");
    closeRepositoryTab(state, "repo_b");

    expect(state.tabs).toEqual([repoA]);
    expect(state.activeRepositoryId).toBe("repo_a");
  });

  it("lands a new tab beside the active one instead of at the end of the strip", () => {
    // Prevents: every newly opened repository appearing past the edge of a long strip, so
    // the tab the reader just asked for is the one they cannot see.
    const state = createRepositoryTabs([repoA, repoB]);
    const repoC: RepositoryTab = {
      repositoryId: "repo_c",
      displayName: "gamma",
      displayPath: "/projects/gamma",
    };

    openRepositoryTab(state, repoC);

    expect(state.tabs).toEqual([repoA, repoC, repoB]);
    expect(state.activeRepositoryId).toBe("repo_c");
  });

  it("adopts a Session's repository as the active tab, next to the current one", () => {
    // Prevents: a panel that silently keeps showing the previous project because adoption
    // only appended and only ever filled an empty selection.
    const state = createRepositoryTabs([repoA]);
    const adopted = adoptRepositoryTabs(state, [repoB]);

    expect(adopted).toBe(true);
    expect(state.tabs).toEqual([repoA, repoB]);
    expect(state.activeRepositoryId).toBe("repo_b");
  });

  it("keeps a closed repository closed when the service lists it again", () => {
    // Prevents: "it forgets what I closed and remembers what I opened". Adoption reads the
    // service's repository list, and a close leaves no trace in that list, so without a
    // record of the close the tab returns on the next read.
    const state = createRepositoryTabs([repoA, repoB]);
    closeRepositoryTab(state, "repo_b");

    expect(adoptRepositoryTabs(state, [repoB])).toBe(false);
    expect(state.tabs).toEqual([repoA]);

    // Asking for it again is the reader changing their mind.
    openRepositoryTab(state, repoB);
    expect(state.tabs).toEqual([repoA, repoB]);
    expect(adoptRepositoryTabs(state, [repoB])).toBe(false);
  });

  it("does not activate an unknown repository", () => {
    const state = createRepositoryTabs([repoA]);

    selectRepositoryTab(state, "missing");

    expect(state.activeRepositoryId).toBe("repo_a");
  });
});

describe("recent repositories", () => {
  const recent: readonly RecentRepository[] = [
    { ...repoA, lastOpenedAt: "2026-09-18T00:00:00Z", available: true },
    { ...repoB, lastOpenedAt: "2026-09-17T00:00:00Z", available: false },
  ];

  it("matches recent entries by name or path and keeps newest order", () => {
    expect(filterRecentRepositories(recent, "BETA")).toEqual([recent[1]]);
    expect(filterRecentRepositories(recent, "projects")).toEqual(recent);
  });

  it("returns all recent entries for an empty query", () => {
    expect(filterRecentRepositories(recent, "  ")).toEqual(recent);
  });
});
