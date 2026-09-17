/** Pure recent-repository filtering and availability presentation helpers. */
import type { RepositoryTab } from "./repository-tabs.js";

export interface RecentRepository extends RepositoryTab {
  readonly lastOpenedAt: string;
  readonly available: boolean;
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
