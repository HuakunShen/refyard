/** Pure session state for the repositories currently open in workbench tabs. */

export interface RepositoryTab {
  readonly repositoryId: string;
  readonly worktreeId?: string;
  readonly displayName: string;
  readonly displayPath: string;
}

export interface RepositoryTabsState {
  tabs: RepositoryTab[];
  activeRepositoryId: string | null;
  revision: number;
}

export function createRepositoryTabs(
  initial: readonly RepositoryTab[] = [],
): RepositoryTabsState {
  const tabs = uniqueTabs(initial);
  return {
    tabs,
    activeRepositoryId:
      tabs[0] === undefined ? null : repositoryTabKey(tabs[0]),
    revision: 0,
  };
}

export function openRepositoryTab(
  state: RepositoryTabsState,
  tab: RepositoryTab,
): void {
  const existing = state.tabs.some(
    (candidate) => repositoryTabKey(candidate) === repositoryTabKey(tab),
  );
  if (!existing) {
    state.tabs = [...state.tabs, tab];
  }
  state.activeRepositoryId = repositoryTabKey(tab);
  state.revision += 1;
}

export function selectRepositoryTab(
  state: RepositoryTabsState,
  repositoryId: string,
): void {
  if (!state.tabs.some((tab) => repositoryTabKey(tab) === repositoryId)) {
    return;
  }
  if (state.activeRepositoryId === repositoryId) {
    return;
  }
  state.activeRepositoryId = repositoryId;
  state.revision += 1;
}

export function closeRepositoryTab(
  state: RepositoryTabsState,
  repositoryId: string,
): void {
  const index = state.tabs.findIndex(
    (tab) => repositoryTabKey(tab) === repositoryId,
  );
  if (index < 0) {
    return;
  }
  const nextTabs = state.tabs.filter(
    (tab) => repositoryTabKey(tab) !== repositoryId,
  );
  state.tabs = nextTabs;
  if (state.activeRepositoryId === repositoryId) {
    const neighbor = nextTabs[index] ?? nextTabs[index - 1];
    state.activeRepositoryId =
      neighbor === undefined ? null : repositoryTabKey(neighbor);
  }
  state.revision += 1;
}

function uniqueTabs(tabs: readonly RepositoryTab[]): RepositoryTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(repositoryTabKey(tab))) {
      return false;
    }
    seen.add(repositoryTabKey(tab));
    return true;
  });
}

/** Default repository tabs and linked worktree tabs have distinct session identities. */
export function repositoryTabKey(tab: RepositoryTab): string {
  return tab.worktreeId === undefined
    ? tab.repositoryId
    : `${tab.repositoryId}:${tab.worktreeId}`;
}
