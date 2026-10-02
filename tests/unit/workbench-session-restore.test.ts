/**
 * Session restore: the open-tab set survives a restart.
 *
 * The cases are the ones a real week of use produces — a normal quit with two tabs,
 * a quit with nothing open, a repository that was moved or deleted between runs, a
 * corrupt store, and an SSH tab that cannot be restored until its target exists.
 * Each asserts what the workbench does next, not an internal shape.
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_TABS_KEY,
  loadSessionTabs,
  restoreSessionTabs,
  saveSessionTabs,
  tabsFromRestore,
} from "../../apps/web/src/lib/workbench/session-restore.js";
import type { RepositorySummary } from "@refyard/git-contract";

function memoryStorage(initial: Record<string, string> = {}): {
  store: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (key) => (key in store ? (store[key] ?? null) : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

function summary(
  repositoryId: string,
  displayPath: string,
  displayName = displayPath.split("/").pop() ?? displayPath,
): RepositorySummary {
  return {
    repositoryId,
    allowedRootId: "root_1",
    displayName,
    displayPath,
    objectFormat: "sha1",
    worktreeIds: ["wt_1"],
    primaryWorktreeId: "wt_1",
    head: {
      kind: "born",
      branchName: "main",
      oid: "a".repeat(40),
      detached: false,
    },
    operationInProgress: null,
    lastFetchedAt: null,
  };
}

function tab(repositoryId: string, displayPath: string) {
  return {
    repositoryId,
    displayName: displayPath.split("/").pop() ?? displayPath,
    displayPath,
  };
}

describe("saving the open-tab set", () => {
  it("writes one entry per tab and marks the active one", () => {
    const storage = memoryStorage();
    const tabs = [tab("repo_1", "/dev/xross"), tab("repo_2", "/dev/refyard")];
    saveSessionTabs(storage, tabs, "repo_2");
    const saved = loadSessionTabs(storage);
    expect(saved?.tabs).toEqual([
      { displayPath: "/dev/xross" },
      { displayPath: "/dev/refyard", active: true },
    ]);
  });

  it("round-trips through the exact key the restore reads", () => {
    const storage = memoryStorage();
    saveSessionTabs(storage, [tab("repo_1", "/dev/xross")], "repo_1");
    expect(Object.keys(storage.store)).toEqual([SESSION_TABS_KEY]);
    expect(loadSessionTabs(storage)?.tabs).toHaveLength(1);
  });
});

describe("loading a saved session", () => {
  it("reads a missing store as nothing to restore", () => {
    expect(loadSessionTabs(memoryStorage())).toBeNull();
  });

  it("reads a corrupt store as nothing to restore rather than throwing", () => {
    expect(loadSessionTabs(memoryStorage({ [SESSION_TABS_KEY]: "{not json" })))
      .toBeNull();
  });

  it("drops malformed entries but keeps the well-formed ones", () => {
    const storage = memoryStorage({
      [SESSION_TABS_KEY]: JSON.stringify({
        tabs: [
          { displayPath: "/dev/ok", active: true },
          { displayPath: 42 },
          null,
          {},
        ],
        savedAt: "2026-10-02T00:00:00.000Z",
      }),
    });
    const saved = loadSessionTabs(storage);
    expect(saved?.tabs).toEqual([{ displayPath: "/dev/ok", active: true }]);
  });

  it("treats an all-malformed session as nothing to restore", () => {
    const storage = memoryStorage({
      [SESSION_TABS_KEY]: JSON.stringify({ tabs: [42, "nope"] }),
    });
    expect(loadSessionTabs(storage)).toBeNull();
  });
});

describe("mapping a restore onto fresh tabs", () => {
  const saved = [
    { displayPath: "/dev/xross", active: true },
    { displayPath: "/dev/refyard" },
    { displayPath: "/dev/gone" },
  ];
  const registered = new Map([
    ["/dev/xross", summary("repo_a", "/dev/xross", "xross-dev")],
    ["/dev/refyard", summary("repo_b", "/dev/refyard", "refyard")],
  ]);

  it("preserves the saved order and skips paths that failed to register", () => {
    const { tabs, activeRepositoryId } = tabsFromRestore(saved, registered);
    expect(tabs.map((tab) => tab.repositoryId)).toEqual(["repo_a", "repo_b"]);
    expect(tabs.map((tab) => tab.displayName)).toEqual(["xross-dev", "refyard"]);
    // The saved active tab came back, so it stays active despite sitting first.
    expect(activeRepositoryId).toBe("repo_a:wt_1");
  });

  it("activates the first restored tab when the saved active one failed", () => {
    const onlyOther = [
      { displayPath: "/dev/refyard" },
      { displayPath: "/dev/gone", active: true },
    ];
    const { tabs, activeRepositoryId } = tabsFromRestore(onlyOther, registered);
    expect(tabs).toHaveLength(1);
    expect(activeRepositoryId).toBe("repo_b:wt_1");
  });

  it("restores to nothing when every registration failed", () => {
    const { tabs, activeRepositoryId } = tabsFromRestore(
      [{ displayPath: "/dev/gone", active: true }],
      new Map(),
    );
    expect(tabs).toEqual([]);
    expect(activeRepositoryId).toBeNull();
  });

  it("carries the fresh worktree id from the summary", () => {
    const { tabs } = tabsFromRestore(saved, registered);
    expect(tabs[0]?.worktreeId).toBe("wt_1");
  });
});

describe("restoreSessionTabs", () => {
  const saved = [
    { displayPath: "/dev/xross", active: true },
    { displayPath: "/dev/refyard" },
    { displayPath: "/dev/gone" },
  ];

  function fakeService(
    listed: RepositorySummary[],
    registeredNow: RepositorySummary[] = [],
  ) {
    const registerCalls: string[] = [];
    return {
      registerCalls,
      service: {
        repositories: async () => ({ repositories: listed }),
        registerRepository: async (path: string) => {
          registerCalls.push(path);
          const added = registeredNow.find(
            (row) => row.displayPath === path,
          );
          if (added === undefined) {
            throw new Error("conflict: that repository is already registered");
          }
          return { repositories: [added] };
        },
      },
    };
  }

  it("prefers the surviving registry over re-registering", async () => {
    const { service, registerCalls } = fakeService([
      summary("repo_a", "/dev/xross", "xross-dev"),
      summary("repo_b", "/dev/refyard", "refyard"),
    ]);
    const { tabs, activeRepositoryId } = await restoreSessionTabs(
      saved,
      service,
    );
    // Only the path the surviving registry does not know is worth a register call.
    expect(registerCalls).toEqual(["/dev/gone"]);
    expect(tabs.map((tab) => tab.repositoryId)).toEqual(["repo_a", "repo_b"]);
    expect(activeRepositoryId).toBe("repo_a:wt_1");
  });

  it("registers what the registry lost and skips what it cannot", async () => {
    const { service, registerCalls } = fakeService(
      [],
      [summary("repo_b", "/dev/refyard", "refyard")],
    );
    const { tabs, activeRepositoryId } = await restoreSessionTabs(
      saved,
      service,
    );
    expect(registerCalls).toEqual(["/dev/xross", "/dev/refyard", "/dev/gone"]);
    expect(tabs.map((tab) => tab.repositoryId)).toEqual(["repo_b"]);
    expect(activeRepositoryId).toBe("repo_b:wt_1");
  });

  it("skips remote-target tabs without asking the service about them", async () => {
    const { service, registerCalls } = fakeService([]);
    const { tabs } = await restoreSessionTabs(
      [{ displayPath: "/xross", targetId: "tgt_ssh_1", active: true }],
      service,
    );
    expect(registerCalls).toEqual([]);
    expect(tabs).toEqual([]);
  });
});
