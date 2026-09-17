/** Pure session state for the repositories currently open in workbench tabs. */

export interface RepositoryTab {
  readonly repositoryId: string;
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
    activeRepositoryId: tabs[0]?.repositoryId ?? null,
    revision: 0,
  };
}

export function openRepositoryTab(
  state: RepositoryTabsState,
  tab: RepositoryTab,
): void {
  const existing = state.tabs.some(
    (candidate) => candidate.repositoryId === tab.repositoryId,
  );
  if (!existing) {
    state.tabs = [...state.tabs, tab];
  }
  state.activeRepositoryId = tab.repositoryId;
  state.revision += 1;
}

export function selectRepositoryTab(
  state: RepositoryTabsState,
  repositoryId: string,
): void {
  if (!state.tabs.some((tab) => tab.repositoryId === repositoryId)) {
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
    (tab) => tab.repositoryId === repositoryId,
  );
  if (index < 0) {
    return;
  }
  const nextTabs = state.tabs.filter(
    (tab) => tab.repositoryId !== repositoryId,
  );
  state.tabs = nextTabs;
  if (state.activeRepositoryId === repositoryId) {
    state.activeRepositoryId =
      nextTabs[index]?.repositoryId ??
      nextTabs[index - 1]?.repositoryId ??
      null;
  }
  state.revision += 1;
}

function uniqueTabs(tabs: readonly RepositoryTab[]): RepositoryTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.repositoryId)) {
      return false;
    }
    seen.add(tab.repositoryId);
    return true;
  });
}
