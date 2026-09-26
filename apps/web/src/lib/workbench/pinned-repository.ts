/** Resolve a host-selected repository without ever substituting a different one. */
export function pinnedRepository<T extends { repositoryId: string; displayPath: string }>(
  list: readonly T[],
  repositoryId: string | null,
  repositoryPath: string | null,
): T | undefined {
  if (repositoryId !== null) {
    return list.find((entry) => entry.repositoryId === repositoryId);
  }
  if (repositoryPath !== null) {
    const wanted = repositoryPath.replace(/^\/private/, "");
    return list.find(
      (entry) => entry.displayPath.replace(/^\/private/, "") === wanted,
    );
  }
  return undefined;
}
