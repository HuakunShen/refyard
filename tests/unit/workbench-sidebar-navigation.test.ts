import { describe, expect, it } from "vitest";
import {
  availableSidebarViews,
  createSidebarNavigationState,
  reconcileSidebarNavigation,
  selectSidebarView,
} from "../../apps/web/src/lib/workbench/sidebar-navigation.js";

function views(
  overrides: Partial<Parameters<typeof availableSidebarViews>[0]> = {},
) {
  return availableSidebarViews({
    hasRepository: true,
    branchAvailable: true,
    networkAvailable: true,
    stashAvailable: true,
    tagAvailable: true,
    worktreeAvailable: true,
    submoduleAvailable: true,
    repositoryCount: 2,
    changeCount: 3,
    branchCount: 4,
    remoteCount: 2,
    stashCount: 1,
    tagCount: 5,
    worktreeCount: 2,
    submoduleCount: 1,
    refsCount: 11,
    ...overrides,
  });
}

describe("repository sidebar navigation", () => {
  it("starts in repositories without a selected repository", () => {
    const state = createSidebarNavigationState();
    const available = views({ hasRepository: false });
    reconcileSidebarNavigation(state, available, false);
    expect(state.activeView).toBe("repositories");
    expect(
      available.filter((entry) => entry.available).map((entry) => entry.id),
    ).toEqual(["repositories"]);
  });

  it("moves to Working Copy the first time a repository becomes available", () => {
    const state = createSidebarNavigationState();
    reconcileSidebarNavigation(state, views({ hasRepository: false }), false);
    reconcileSidebarNavigation(state, views(), true);
    expect(state.activeView).toBe("working-copy");
  });

  it("keeps an explicitly selected available view stable", () => {
    const state = createSidebarNavigationState();
    reconcileSidebarNavigation(state, views(), true);
    expect(selectSidebarView(state, "branches", views())).toBe(true);
    reconcileSidebarNavigation(state, views(), true);
    expect(state.activeView).toBe("branches");

    expect(selectSidebarView(state, "repositories", views())).toBe(true);
    reconcileSidebarNavigation(state, views(), true);
    expect(state.activeView).toBe("repositories");
  });

  it("uses Refs only when the branch workflow is unavailable", () => {
    const withBranches = views();
    expect(
      withBranches.find((entry) => entry.id === "branches")?.available,
    ).toBe(true);
    expect(withBranches.find((entry) => entry.id === "refs")?.available).toBe(
      false,
    );

    const withRefs = views({ branchAvailable: false });
    expect(withRefs.find((entry) => entry.id === "branches")?.available).toBe(
      false,
    );
    expect(withRefs.find((entry) => entry.id === "refs")?.available).toBe(true);
  });

  it("keeps product order and carries loaded counts", () => {
    expect(
      views()
        .filter((entry) => entry.available)
        .map(({ id, count }) => [id, count]),
    ).toEqual([
      ["repositories", 2],
      ["working-copy", 3],
      ["branches", 4],
      ["remotes", 2],
      ["stashes", 1],
      ["tags", 5],
      ["worktrees", 2],
      ["submodules", 1],
    ]);
  });

  it("falls back to Working Copy when the active capability disappears", () => {
    const state = createSidebarNavigationState();
    reconcileSidebarNavigation(state, views(), true);
    selectSidebarView(state, "remotes", views());
    expect(state.activeView).toBe("remotes");

    reconcileSidebarNavigation(state, views({ networkAvailable: false }), true);
    expect(state.activeView).toBe("working-copy");
  });

  it("falls back to Repositories when the selected repository disappears", () => {
    const state = createSidebarNavigationState();
    reconcileSidebarNavigation(state, views(), true);
    selectSidebarView(state, "branches", views());

    reconcileSidebarNavigation(state, views({ hasRepository: false }), false);
    expect(state.activeView).toBe("repositories");
  });

  it("focuses Working Copy once when a repository operation starts", () => {
    const state = createSidebarNavigationState();
    reconcileSidebarNavigation(state, views(), true, false);
    selectSidebarView(state, "branches", views());

    reconcileSidebarNavigation(state, views(), true, true);
    expect(state.activeView).toBe("working-copy");

    // Do not trap the user in Working Copy while the same operation remains active.
    expect(selectSidebarView(state, "branches", views())).toBe(true);
    reconcileSidebarNavigation(state, views(), true, true);
    expect(state.activeView).toBe("branches");

    // A later operation gets the same one-time focus behavior.
    reconcileSidebarNavigation(state, views(), true, false);
    reconcileSidebarNavigation(state, views(), true, true);
    expect(state.activeView).toBe("working-copy");
  });

  it("refuses selecting an unavailable destination", () => {
    const state = createSidebarNavigationState();
    reconcileSidebarNavigation(state, views(), true);
    expect(
      selectSidebarView(state, "remotes", views({ networkAvailable: false })),
    ).toBe(false);
    expect(state.activeView).toBe("working-copy");
  });
});
