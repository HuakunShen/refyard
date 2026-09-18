/**
 * Pure recent-repository identity and filtering, plus the one mapping from a chosen
 * execution target to the request the host is asked to create.
 *
 * Both live here rather than in the page because both are easy to get subtly wrong in a
 * component: a recent entry is the same repository only when its path *and* its target
 * match, and a target request may only be built from a selection that names a host the
 * host can resolve — a hand-entered alias without its configuration source is refused
 * instead of being sent with a guessed source.
 */
import type { CreateTargetRequest } from "@refyard/git-contract";
import {
  executionLocationKey,
  type ExecutionTargetSelection,
} from "@refyard/git-ui/lib/execution-targets";
import type { RepositoryTab } from "./repository-tabs.js";

export interface RecentRepository extends RepositoryTab {
  readonly lastOpenedAt: string;
  readonly available: boolean;
  /**
   * The execution target this repository was explicitly opened with, when one was
   * chosen. It is what a recent entry restores; the launcher itself never selects a
   * remembered SSH host by default. `null` and absence both mean this machine.
   */
  readonly target?: ExecutionTargetSelection | null;
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

/**
 * A recent entry's identity: the same path on this machine and on a host are different
 * places. It is the launcher's list key too, so two entries cannot collide on an id the
 * host minted per registration.
 */
export function recentRepositoryKey(entry: {
  readonly displayPath: string;
  readonly target?: ExecutionTargetSelection | null;
}): string {
  return executionLocationKey(entry.target, entry.displayPath);
}

export type CreateTargetPlan =
  | { readonly kind: "request"; readonly request: CreateTargetRequest }
  | { readonly kind: "refused"; readonly message: string };

/**
 * The request that selects where Git runs for a chosen target.
 *
 * A listed candidate is named by its `hostId`, which the host resolves itself. A
 * manually entered alias can only be bound to the configuration source it should be
 * read from — the picker does not carry that source, so this refuses rather than
 * guessing one, and the caller shows the refusal where it would have shown progress.
 */
export function createTargetRequestFor(
  selection: ExecutionTargetSelection,
): CreateTargetPlan {
  if (selection.kind === "local") {
    return {
      kind: "refused",
      message:
        "this machine needs no execution target; open a local path with the Browse control instead",
    };
  }
  if (selection.kind === "ssh-config-manual") {
    return {
      kind: "refused",
      message: `opening "${selection.manualAlias}" needs the SSH configuration source that alias was read from, and the selection does not name one; choose a listed host instead`,
    };
  }
  return {
    kind: "request",
    request: { kind: "ssh-config", hostId: selection.hostId },
  };
}
