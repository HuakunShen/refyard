import { m } from "@refyard/git-ui/i18n";
/** Pure draft/applied history state and bounded page intent; display paths never become authority. */
import {
  validateHistoryQuery,
  type HistoryQuery,
  type HistoryPage,
} from "@refyard/git-contract";

export type AppliedHistoryFilters = Pick<
  HistoryQuery,
  | "message"
  | "author"
  | "oidPrefix"
  | "refFullName"
  | "committedAfter"
  | "committedBefore"
  | "pathId"
>;
import type {
  HistoryFilterDraft,
  KnownHistoryPath,
} from "@refyard/git-ui/lib/history-filters";

export interface HistoryFilterState {
  repositoryId: string | null;
  revision: number;
  draft: HistoryFilterDraft;
  applied: AppliedHistoryFilters;
  appliedPath: KnownHistoryPath | null;
  error: string | null;
}
export function createHistoryFilterState(
  repositoryId: string | null = null,
): HistoryFilterState {
  return {
    repositoryId,
    revision: 0,
    draft: {
      message: "",
      author: "",
      oidPrefix: "",
      refFullName: "",
      committedAfter: "",
      committedBefore: "",
      path: null,
    },
    applied: {},
    appliedPath: null,
    error: null,
  };
}
export function clearHistoryFilters(
  state: HistoryFilterState,
  repositoryId = state.repositoryId,
): void {
  const revision = state.revision + 1;
  Object.assign(state, createHistoryFilterState(repositoryId), { revision });
}
function utcBound(value: string): string {
  return value.length === 16 ? `${value}:00Z` : `${value}Z`;
}
export function applyHistoryFilters(state: HistoryFilterState): boolean {
  const draft = state.draft;
  const result = validateHistoryQuery({
    repositoryId: state.repositoryId ?? "repo_unselected",
    ...(draft.message.trim() === "" ? {} : { message: draft.message }),
    ...(draft.author.trim() === "" ? {} : { author: draft.author }),
    ...(draft.oidPrefix.trim() === ""
      ? {}
      : { oidPrefix: draft.oidPrefix.trim().toLowerCase() }),
    ...(draft.refFullName === "" ? {} : { refFullName: draft.refFullName }),
    ...(draft.committedAfter === ""
      ? {}
      : { committedAfter: utcBound(draft.committedAfter) }),
    ...(draft.committedBefore === ""
      ? {}
      : { committedBefore: utcBound(draft.committedBefore) }),
    ...(draft.path === null ? {} : { pathId: draft.path.pathId }),
  });
  if (!result.ok) {
    state.error = result.problems
      .map((problem) => {
        if (problem.path === "oidPrefix")
          return "Commit SHA needs 4–64 hexadecimal digits";
        if (problem.path === "pathId" && draft.oidPrefix.trim() !== "")
          return m.filter_err_sha_file();
        if (
          problem.path === "committedAfter" ||
          problem.path === "committedBefore"
        )
          return m.filter_err_dates();
        if (problem.path === "message" || problem.path === "author")
          return m.filter_err_line({ field: problem.path === "message" ? m.filter_field_message() : m.filter_field_author() });
        return problem.message;
      })
      .join(". ");
    return false;
  }
  const { repositoryId: _repositoryId, ...filters } = result.value;
  state.applied = filters;
  state.revision += 1;
  state.appliedPath = draft.path === null ? null : { ...draft.path };
  state.error = null;
  return true;
}
export function historyFiltersActive(filters: AppliedHistoryFilters): boolean {
  return Object.keys(filters).length > 0;
}
export function historyFilterLabels(state: HistoryFilterState): string[] {
  const filter = state.applied;
  return [
    ...(filter.message === undefined ? [] : [`Message: ${filter.message}`]),
    ...(filter.author === undefined ? [] : [`Author: ${filter.author}`]),
    ...(filter.refFullName === undefined
      ? []
      : [
          `Ref: ${filter.refFullName.replace(/^refs\/(heads|tags|remotes)\//, "")}`,
        ]),
    ...(filter.oidPrefix === undefined ? [] : [`SHA: ${filter.oidPrefix}`]),
    ...(filter.committedAfter === undefined
      ? []
      : [m.filter_after({ value: filter.committedAfter })]),
    ...(filter.committedBefore === undefined
      ? []
      : [m.filter_before({ value: filter.committedBefore })]),
    ...(filter.pathId === undefined
      ? []
      : [m.filter_file({ name: state.appliedPath?.displayPath ?? m.filter_selected_file() })]),
  ];
}
export function historyPageQuery(
  repositoryId: string,
  worktreeId: string | null,
  filters: AppliedHistoryFilters,
  cursor: string | null,
  limit: number,
): HistoryQuery {
  const identity = {
    repositoryId,
    ...(worktreeId === null ? {} : { worktreeId }),
  };
  return cursor === null
    ? { ...identity, ...filters, limit }
    : { ...identity, cursor };
}
export function historyTopologyFor(
  pages: readonly Pick<HistoryPage, "topology">[],
): HistoryPage["topology"] {
  return pages.some((page) => page.topology === "sparse")
    ? "sparse"
    : "continuous";
}
