/**
 * Whether a workbench read may run, and how its result is keyed.
 *
 * A read is not a function of "does this tab hold a bearer". A native session has no
 * bearer at all, and a session whose service reports a read as unimplemented must not
 * issue it however healthy the connection looks. What a query actually needs is: a
 * ready service session, the service implementing that read, and a valid selection.
 * This module is the one place that decides it, so the controllers cannot drift apart
 * on the question — a controller that answered it locally would be the next place the
 * old token check survived.
 *
 * Cache keys are scoped by `cacheNamespace`, never by a credential: two sessions (or
 * two authorization rounds of the same service) must not read each other's cached
 * repository data, and a bearer copied into a query key would outlive the adapter
 * closure that owns it in the cache, devtools, and serialized state.
 */
import type { ConnectionPhase } from "@refyard/git-service";

export interface QueryStateInput {
  readonly phase: ConnectionPhase;
  /** The service reports this read as implemented (see `capabilities().reads`). */
  readonly supportsRead: boolean;
  /** This query's own selection precondition is met. */
  readonly hasSelection: boolean;
}

export interface QueryState {
  readonly enabled: boolean;
  /** Whether the background cadence may refetch. Never true without `enabled`. */
  readonly poll: boolean;
}

export function queryState(input: QueryStateInput): QueryState {
  const enabled =
    input.phase === "ready" && input.supportsRead && input.hasSelection;
  // Polling is a strict subset of enabled: a read that may not run once must not run
  // on a timer either, including one this service does not implement.
  return { enabled, poll: enabled && input.supportsRead };
}

/**
 * The `[namespace, …identity]` shape every workbench cache key uses.
 *
 * TanStack matches keys by prefix, so a longer key built from the same namespace and
 * identity (`"status"`, repository, worktree) can be invalidated by the shorter one
 * without the invalidator knowing every longer variant.
 */
export function cacheKeyFor(
  cacheNamespace: string,
  ...identity: readonly unknown[]
): readonly unknown[] {
  return [cacheNamespace, ...identity];
}
