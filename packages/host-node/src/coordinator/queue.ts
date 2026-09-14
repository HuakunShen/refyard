/**
 * The queue: bounded work, one writer per repository.
 *
 * Three limits, each with a reason:
 *
 * - **One writer per common Git directory**, enforced *inside this service*. The
 *   design is explicit that this is not a lock on the repository: an IDE, a
 *   terminal or another agent can still write at the same time. What the queue
 *   guarantees is that this service does not race *itself*, and it never claims
 *   otherwise — no Git lock file is deleted, no operation is forced.
 * - **Up to two readers per repository and four Git processes in total.** A read
 *   and a write can run at once (Git tolerates that), but a repository cannot have
 *   three concurrent reads against one object store, and the whole machine cannot
 *   have five Git processes from this service.
 * - **A bounded queue per actor** (32 by default). A client that submits faster than
 *   work completes is told the queue is full rather than growing the process until
 *   it dies.
 *
 * Cancellation only applies to work that has not started: a running mutation is
 * never relabelled `cancelled`, because the process may already have changed the
 * repository and pretending otherwise would hide that.
 */
import { LIMITS } from "@refyard/git-contract";

export type QueueMode = "read" | "write";

export interface QueueLimits {
  readonly maxQueuedPerActor: number;
  readonly maxGlobalGitProcesses: number;
  readonly maxReadersPerRepository: number;
}

export const DEFAULT_QUEUE_LIMITS: QueueLimits = {
  maxQueuedPerActor: LIMITS.queuedOperationsPerActor,
  maxGlobalGitProcesses: LIMITS.concurrentGitProcesses,
  maxReadersPerRepository: LIMITS.concurrentReadersPerRepository,
};

export type EnqueueResult<Job> =
  | { readonly ok: true; readonly ticket: QueueTicket<Job> }
  | {
      readonly ok: false;
      readonly reason: "queue-full" | "actor-busy";
      readonly message: string;
    };

export interface QueueTicket<Job> {
  readonly id: string;
  readonly actor: string;
  readonly repositoryId: string;
  readonly mode: QueueMode;
  /** Position at enqueue time, for a UI that wants to show "2 ahead of you". */
  readonly positionAtEnqueue: number;
  readonly job: Job;
}

export interface QueueOptions {
  readonly limits?: Partial<QueueLimits>;
}

export interface Queue<Job> {
  enqueue(input: {
    readonly id: string;
    readonly actor: string;
    readonly repositoryId: string;
    readonly mode: QueueMode;
    readonly job: Job;
  }): EnqueueResult<Job>;
  /** Remove a job that has not started. Returns false once it is running. */
  cancel(id: string): boolean;
  /**
   * Run queued work while the limits allow it.
   *
   * The executor is given a `release` function and must call it exactly once when
   * the work finishes, whatever the outcome; that is what makes the limits
   * self-healing after a failure rather than dependent on a happy path.
   */
  run(execute: (ticket: QueueTicket<Job>, release: () => void) => void): void;
  /** True when the id was started and has not finished. */
  isRunning(id: string): boolean;
  pendingCount(): number;
  runningCount(): number;
  depthFor(actor: string): number;
  state(): {
    readonly queued: readonly string[];
    readonly running: readonly string[];
    readonly writers: readonly string[];
  };
}

export function createQueue<Job>(options: QueueOptions = {}): Queue<Job> {
  const limits: QueueLimits = { ...DEFAULT_QUEUE_LIMITS, ...options.limits };
  const pending: QueueTicket<Job>[] = [];
  const running = new Map<
    string,
    { readonly ticket: QueueTicket<Job>; readonly release: () => void }
  >();
  let globalRunning = 0;
  const readersPerRepository = new Map<string, number>();
  const writers = new Set<string>();

  function canStart(ticket: QueueTicket<Job>): boolean {
    if (globalRunning >= limits.maxGlobalGitProcesses) {
      return false;
    }
    if (ticket.mode === "write") {
      return !writers.has(ticket.repositoryId);
    }
    if (writers.has(ticket.repositoryId)) {
      // A read during a write would race the index; the design allows reads
      // alongside reads, not alongside a mutation of the same repository.
      return false;
    }
    return (
      (readersPerRepository.get(ticket.repositoryId) ?? 0) <
      limits.maxReadersPerRepository
    );
  }

  function start(
    ticket: QueueTicket<Job>,
    execute: (ticket: QueueTicket<Job>, release: () => void) => void,
  ): void {
    globalRunning += 1;
    if (ticket.mode === "write") {
      writers.add(ticket.repositoryId);
    } else {
      readersPerRepository.set(
        ticket.repositoryId,
        (readersPerRepository.get(ticket.repositoryId) ?? 0) + 1,
      );
    }
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      running.delete(ticket.id);
      globalRunning -= 1;
      if (ticket.mode === "write") {
        writers.delete(ticket.repositoryId);
      } else {
        const current = readersPerRepository.get(ticket.repositoryId) ?? 0;
        if (current <= 1) {
          readersPerRepository.delete(ticket.repositoryId);
        } else {
          readersPerRepository.set(ticket.repositoryId, current - 1);
        }
      }
    };
    running.set(ticket.id, { ticket, release });
    execute(ticket, release);
  }

  return {
    enqueue(input): EnqueueResult<Job> {
      const depth = pending.filter(
        (ticket) => ticket.actor === input.actor,
      ).length;
      if (depth >= limits.maxQueuedPerActor) {
        return {
          ok: false,
          reason: "queue-full",
          message: `this session already has ${depth} operations queued; wait for them to finish`,
        };
      }
      const existingWrite = [...pending].some(
        (ticket) =>
          ticket.repositoryId === input.repositoryId &&
          ticket.mode === input.mode &&
          input.mode === "write",
      );
      if (existingWrite) {
        // Two queued writers for one repository is not an error, it is a queue; the
        // refusal here is only for the *same* id being enqueued twice.
        const duplicate = pending.some((ticket) => ticket.id === input.id);
        if (duplicate) {
          return {
            ok: false,
            reason: "actor-busy",
            message: "that operation is already queued",
          };
        }
      }
      const ticket: QueueTicket<Job> = {
        id: input.id,
        actor: input.actor,
        repositoryId: input.repositoryId,
        mode: input.mode,
        positionAtEnqueue: pending.length,
        job: input.job,
      };
      pending.push(ticket);
      return { ok: true, ticket };
    },

    cancel(id): boolean {
      const index = pending.findIndex((ticket) => ticket.id === id);
      if (index === -1) {
        return false;
      }
      pending.splice(index, 1);
      return true;
    },

    run(execute): void {
      // Single pass in queue order: a job that cannot start does not block one
      // behind it, so a busy repository cannot stall every other repository.
      for (let index = 0; index < pending.length;) {
        const ticket = pending[index];
        if (ticket === undefined) {
          break;
        }
        if (!canStart(ticket)) {
          index += 1;
          continue;
        }
        pending.splice(index, 1);
        start(ticket, execute);
      }
    },

    isRunning(id): boolean {
      return running.has(id);
    },

    pendingCount(): number {
      return pending.length;
    },

    runningCount(): number {
      return running.size;
    },

    depthFor(actor): number {
      return pending.filter((ticket) => ticket.actor === actor).length;
    },

    state(): {
      readonly queued: readonly string[];
      readonly running: readonly string[];
      readonly writers: readonly string[];
    } {
      return {
        queued: pending.map((ticket) => ticket.id),
        running: [...running.keys()],
        writers: [...writers],
      };
    },
  };
}
