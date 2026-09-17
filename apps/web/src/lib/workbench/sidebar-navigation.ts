export type SidebarViewId =
  | "repositories"
  | "working-copy"
  | "branches"
  | "remotes"
  | "stashes"
  | "tags"
  | "worktrees"
  | "submodules"
  | "refs";

export interface SidebarView {
  readonly id: SidebarViewId;
  readonly label: string;
  readonly count?: number;
  readonly available: boolean;
}

export interface SidebarAvailabilityInput {
  readonly hasRepository: boolean;
  readonly branchAvailable: boolean;
  readonly networkAvailable: boolean;
  readonly stashAvailable: boolean;
  readonly tagAvailable: boolean;
  readonly worktreeAvailable: boolean;
  readonly submoduleAvailable: boolean;
  readonly repositoryCount?: number;
  readonly changeCount?: number;
  readonly branchCount?: number;
  readonly remoteCount?: number;
  readonly stashCount?: number;
  readonly tagCount?: number;
  readonly worktreeCount?: number;
  readonly submoduleCount?: number;
  readonly refsCount?: number;
}

export interface SidebarNavigationState {
  activeView: SidebarViewId;
  /** Tracks the no-repository -> repository transition that chooses the first daily view. */
  repositoryWasAvailable: boolean;
  /** Allows an operation start to focus Working Copy once without trapping later navigation. */
  operationWasInProgress: boolean;
}

function view(
  id: SidebarViewId,
  label: string,
  available: boolean,
  count?: number,
): SidebarView {
  return count === undefined
    ? { id, label, available }
    : { id, label, available, count };
}

export function availableSidebarViews(
  input: SidebarAvailabilityInput,
): readonly SidebarView[] {
  const repo = input.hasRepository;
  return [
    view("repositories", "Repositories", true, input.repositoryCount),
    view("working-copy", "Working Copy", repo, input.changeCount),
    view(
      "branches",
      "Branches",
      repo && input.branchAvailable,
      input.branchCount,
    ),
    view("refs", "Refs", repo && !input.branchAvailable, input.refsCount),
    view(
      "remotes",
      "Remotes",
      repo && input.networkAvailable,
      input.remoteCount,
    ),
    view("stashes", "Stashes", repo && input.stashAvailable, input.stashCount),
    view("tags", "Tags", repo && input.tagAvailable, input.tagCount),
    view(
      "worktrees",
      "Worktrees",
      repo && input.worktreeAvailable,
      input.worktreeCount,
    ),
    view(
      "submodules",
      "Submodules",
      repo && input.submoduleAvailable,
      input.submoduleCount,
    ),
  ];
}

export function createSidebarNavigationState(): SidebarNavigationState {
  return {
    activeView: "repositories",
    repositoryWasAvailable: false,
    operationWasInProgress: false,
  };
}

function isAvailable(
  views: readonly SidebarView[],
  id: SidebarViewId,
): boolean {
  return views.some((entry) => entry.id === id && entry.available);
}

export function reconcileSidebarNavigation(
  state: SidebarNavigationState,
  views: readonly SidebarView[],
  hasRepository: boolean,
  operationInProgress = false,
): void {
  const hadRepository = state.repositoryWasAvailable;
  const hadOperation = state.operationWasInProgress;
  state.repositoryWasAvailable = hasRepository;
  state.operationWasInProgress = operationInProgress;

  if (!hasRepository) {
    state.activeView = "repositories";
    return;
  }

  if (!hadRepository && state.activeView === "repositories") {
    state.activeView = isAvailable(views, "working-copy")
      ? "working-copy"
      : "repositories";
    return;
  }

  if (operationInProgress && !hadOperation && isAvailable(views, "working-copy")) {
    state.activeView = "working-copy";
    return;
  }

  if (!isAvailable(views, state.activeView)) {
    state.activeView = isAvailable(views, "working-copy")
      ? "working-copy"
      : "repositories";
  }
}

export function selectSidebarView(
  state: SidebarNavigationState,
  viewId: SidebarViewId,
  views: readonly SidebarView[],
): boolean {
  if (!isAvailable(views, viewId)) {
    return false;
  }
  state.activeView = viewId;
  return true;
}
