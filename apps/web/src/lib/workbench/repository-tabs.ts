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
  /**
   * Keys the reader closed.
   *
   * Adopting every repository the service lists is what makes a closed tab come back: the
   * list is the source of adoption and a close leaves no trace in it, so the workbench
   * "remembers what was opened and forgets what was closed". This records the close so
   * automatic adoption respects it. An explicit open clears the entry, because asking for a
   * repository is the reader changing their mind.
   */
  dismissed: Set<string>;
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
    dismissed: new Set(),
    revision: 0,
  };
}

export function openRepositoryTab(
  state: RepositoryTabsState,
  tab: RepositoryTab,
): void {
  const key = repositoryTabKey(tab);
  state.dismissed.delete(key);
  const existing = state.tabs.some(
    (candidate) => repositoryTabKey(candidate) === key,
  );
  if (!existing) {
    state.tabs = insertAfterActive(state, tab);
  }
  state.activeRepositoryId = key;
  state.revision += 1;
}

/**
 * Adopt repositories the service lists that have no tab yet — what opening a Session's
 * repository does.
 *
 * Two decisions the reader notices. A tab lands **beside the active one** rather than at the
 * end of an already long strip, and the adopted repository becomes active: an adopted
 * repository is the one the Session just asked for, so leaving the reader on an older one is
 * the difference between "it opened my project" and "it opened something". A repository the
 * reader closed stays closed.
 *
 * @returns whether anything was adopted.
 */
export function adoptRepositoryTabs(
  state: RepositoryTabsState,
  incoming: readonly RepositoryTab[],
): boolean {
  const known = new Set(state.tabs.map((tab) => repositoryTabKey(tab)));
  const adopted = incoming.filter(
    (tab) =>
      !known.has(repositoryTabKey(tab)) &&
      !state.dismissed.has(repositoryTabKey(tab)),
  );
  if (adopted.length === 0) {
    return false;
  }
  for (const tab of adopted) {
    state.tabs = insertAfterActive(state, tab);
  }
  const newest = adopted[adopted.length - 1];
  if (newest !== undefined) {
    state.activeRepositoryId = repositoryTabKey(newest);
  }
  state.revision += 1;
  return true;
}

/** The tab list with `tab` directly after the active one. */
function insertAfterActive(
  state: RepositoryTabsState,
  tab: RepositoryTab,
): RepositoryTab[] {
  const activeIndex = state.tabs.findIndex(
    (candidate) => repositoryTabKey(candidate) === state.activeRepositoryId,
  );
  if (activeIndex < 0) {
    return [...state.tabs, tab];
  }
  return [
    ...state.tabs.slice(0, activeIndex + 1),
    tab,
    ...state.tabs.slice(activeIndex + 1),
  ];
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
  state.dismissed.add(repositoryId);
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
