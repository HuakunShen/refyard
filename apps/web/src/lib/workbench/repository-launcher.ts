/** Pure recent-repository filtering and availability presentation helpers. */
import type { ExecutionTargetSelection } from "@refyard/git-ui/lib/execution-targets";
import type { RepositoryTab } from "./repository-tabs.js";

export interface RecentRepository extends RepositoryTab {
  readonly lastOpenedAt: string;
  readonly available: boolean;
  /**
   * The execution target this repository was explicitly opened with, when one was
   * chosen. It is what a recent entry restores; the launcher itself never selects a
   * remembered SSH host by default.
   */
  readonly target?: ExecutionTargetSelection;
}

export function filterRecentRepositories(
  entries: readonly RecentRepository[],
  query: string,
): RecentRepository[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    return [...entries];
  }
  return entries.filter((entry) =>
    `${entry.displayName}\n${entry.displayPath}`
      .toLocaleLowerCase()
      .includes(needle),
  );
}
