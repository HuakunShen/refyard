/**
 * Follow a submitted operation to its terminal state.
 *
 * Two rules, both about what a write may *not* do:
 *
 * - **A dropped connection is not an outcome.** The operation may still be running
 *   on the host, so a failed poll is retried — as a `GET`, which cannot repeat a
 *   mutation — and if the service stays unreachable the result names the operation id
 *   instead of an outcome. Nothing here resubmits a request; there is no code path
 *   from this module back to `submit`.
 * - **A terminal record is the answer, whoever produced it.** `needsAttention` and
 *   `unknown` are returned as what they are, never collapsed into failure, because a
 *   merge that stopped for a conflict and a command whose effect is unknown need
 *   different things from the user.
 *
 * It lives outside the Svelte component so it can be tested without a browser: the
 * property that matters ("a lost poll never repeats a write") is exactly the kind that
 * is easy to break by accident and impossible to see on screen.
 */
import type { OperationRecord } from "@refyard/git-contract";
import type { MutationService } from "@refyard/git-service";

/** Every status a record can rest at; anything else is still running. */
export const OPERATION_TERMINAL: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "needsAttention",
  "unknown",
  "cancelled",
]);

/**
 * The read side of the injected mutation service: all this module needs, and all it
 * may use. Binding it to the service interface rather than a local shape is what keeps
 * the follower transport-blind — it cannot grow a fetch, a URL, or a resubmit.
 */
export type OperationReader = Pick<MutationService, "get">;

export interface FollowOptions {
  /** Total polls before giving up, each followed by `intervalMs` of waiting. */
  readonly attempts?: number;
  readonly intervalMs?: number;
  /** Consecutive transport failures tolerated before reporting the lost connection. */
  readonly transportFailuresAllowed?: number;
  /** Injected so tests do not wait in real time. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function followOperation(
  reader: OperationReader,
  operationId: string,
  options: FollowOptions = {},
): Promise<string> {
  const attempts = options.attempts ?? 120;
  const intervalMs = options.intervalMs ?? 250;
  const allowed = options.transportFailuresAllowed ?? 5;
  const sleep = options.sleep ?? DEFAULT_SLEEP;

  let transportFailures = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let record: OperationRecord;
    try {
      record = await reader.get(operationId);
      transportFailures = 0;
    } catch {
      transportFailures += 1;
      if (transportFailures >= allowed) {
        return `lost the connection while following operation ${operationId}; it was not resubmitted — check the operation list when the service is reachable again`;
      }
      await sleep(intervalMs);
      continue;
    }
    if (OPERATION_TERMINAL.has(record.status)) {
      if (record.status === "succeeded") {
        return record.result?.summary ?? "done";
      }
      return `${record.status}: ${record.problem?.message ?? "no detail"}`;
    }
    await sleep(intervalMs);
  }
  return `operation ${operationId} did not finish in time; it was not resubmitted — check the operation list before trying again`;
}
