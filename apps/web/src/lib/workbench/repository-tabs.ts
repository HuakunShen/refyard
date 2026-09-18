/**
 * Pure session state for the repositories currently open in workbench tabs, and the
 * identity one repository is cached under.
 *
 * A path is not an identity. The same absolute path is a different repository on this
 * machine and on a host the user's SSH configuration names, so every repository-scoped
 * key carries the target it was opened on; the query cache is keyed by that array, and
 * the tab is identified by the string form below. Both come from the same two facts —
 * which machine, which repository — so a tab and its cached reads cannot disagree.
 */

export interface RepositoryTab {
  readonly repositoryId: string;
  /**
   * The execution target this repository was opened on. A local checkout and the same
   * path on an SSH host are different repositories to the user, so the identity below
   * carries the target when one is known.
   */
  readonly targetId?: string;
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
  const repositoryIdentity =
    tab.worktreeId === undefined
      ? tab.repositoryId
      : `${tab.repositoryId}:${tab.worktreeId}`;
  return tab.targetId === undefined
    ? repositoryIdentity
    : `${tab.targetId}/${repositoryIdentity}`;
}

/**
 * The key every repository-scoped query is cached under, from the session namespace
 * (so a previous session's answers are never read as this one's), the execution target
 * and the repository's path.
 *
 * It returns an array because that is what the query cache is keyed by: the parts stay
 * separate values, so a target id and a path whose characters could run together
 * (`tgt_a` + `b_c/x` against `tgt_a-b_c` + `/x`) cannot produce one key, and the
 * `[namespace, targetId]` prefix lets one target's cached reads be invalidated without
 * touching another target's or this machine's. An absent target stays in the key as
 * `null`, so callers that name no target share one local identity rather than forming a
 * third one.
 */
export function repositoryCacheKey(
  sessionNamespace: string,
  targetId: string | null | undefined,
  path: string,
): readonly unknown[] {
  return [sessionNamespace, targetId ?? null, path];
}
