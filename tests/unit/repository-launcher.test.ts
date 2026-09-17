/** Repository launcher and tab state stays deterministic outside Svelte components. */
import { describe, expect, it } from "vitest";
import {
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
