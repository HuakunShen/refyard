/**
 * Jobs: the mutation state machine, and the only place a write ever starts.
 *
 * The state machine is small on purpose, and every transition is persisted before
 * it takes effect:
 *
 * ```
 * accepted ──▶ running ──▶ succeeded
 *    │            │    └──▶ failed
 *    │            │    └──▶ needsAttention
 *    │            └───────▶ unknown        (Git may have changed things)
 *    └──▶ cancelled                        (only while still queued)
 * ```
 *
 * Three properties are enforced here rather than trusted to callers:
 *
 * - **Idempotency by `clientRequestId`.** The same id with the same payload digest
 *   returns the original record — a client that lost the response and retried gets
 *   an answer, not a second commit. The same id with a *different* payload is an
 *   `IdempotencyConflict`, never a silent acceptance of the new payload.
 * - **No automatic retry, ever.** A failed or unknown operation stays that way. The
 *   only way it changes is a human submitting a new operation.
 * - **No write without a registered effect.** The CLI registers the effects this
 *   build can run, and `submit` refuses every other kind with `UnsupportedOperation`;
 *   the capability list is derived from the same registry, which is why the two can
 *   never disagree.
 *
 * Events are emitted from the same place that writes the journal record, so a client
 * that reconnects and queries the operation sees the same state the event carried.
 */
import type { z } from "zod";
import type {
  MutationKind,
  OperationFor,
  OperationRecord,
  OperationResult,
  OperationStatus,
  ParsedMutationRequest,
  Problem,
} from "@refyard/git-contract";
import { LIMITS } from "@refyard/git-contract";
import type { JournalStore, JournalEntry } from "../journal/store.js";
import { canonicalPayloadDigest } from "../journal/store.js";
import type { Recovery } from "../journal/recovery.js";
import { createQueue, type Queue, type QueueTicket } from "./queue.js";
import {
  checkPreconditions,
  type PreconditionContext,
} from "./preconditions.js";

export type EffectOutcome =
  | { readonly kind: "succeeded"; readonly result: OperationResult }
  | { readonly kind: "failed"; readonly problem: Problem }
  | { readonly kind: "needsAttention"; readonly problem: Problem }
  | { readonly kind: "unknown"; readonly problem: Problem };

export interface MutationEffect {
  readonly kind: MutationKind;
  /**
   * Perform the mutation.
   *
   * The effect receives the validated request and must report what happened
   * honestly: `unknown` is an outcome, not a failure of the effect.
   */
  run(input: {
    readonly request: ParsedMutationRequest;
    readonly operationId: string;
    readonly actor: string;
  }): Promise<EffectOutcome>;
}

/**
 * Declare an effect with its own operation type.
 *
 * The schema is what narrows the request's `operation` field to this kind's shape,
 * so an effect body works with typed fields and no cast. It also means an effect
 * validates its own payload: the HTTP layer already checked the union, and this is
 * the second check at the point of use, which is where a mistake would actually do
 * something.
 */
export function createEffect<K extends MutationKind>(input: {
  readonly kind: K;
  readonly schema: z.ZodType<OperationFor<K>>;
  readonly run: (input: {
    readonly operation: OperationFor<K>;
    readonly request: ParsedMutationRequest;
    readonly operationId: string;
    readonly actor: string;
  }) => Promise<EffectOutcome>;
}): MutationEffect {
  return {
    kind: input.kind,
    async run({ request, operationId, actor }): Promise<EffectOutcome> {
      const parsed = input.schema.safeParse(request.operation);
      if (!parsed.success) {
        return {
          kind: "failed",
          problem: {
            code: "InvalidOperationPayload",
            message: `the ${input.kind} payload did not match its contract`,
            retryable: false,
            operationId,
          },
        };
      }
      return input.run({ operation: parsed.data, request, operationId, actor });
    },
  };
}

export interface JobEvent {
  readonly kind: "operation" | "repositoryChanged";
  readonly operation: OperationRecord | null;
  readonly repositoryId: string;
  readonly worktreeIds: readonly string[];
}

export interface JobEngineOptions {
  readonly journal: JournalStore;
  readonly recovery: Recovery;
  /** Effects this build can actually run. Empty outside tests. */
  readonly effects: readonly MutationEffect[];
  readonly now?: () => number;
  readonly nextOperationId: () => string;
  readonly nextSequence: () => number;
  /** Called after each state change, so the SSE ring can broadcast it. */
  readonly onEvent?: (event: JobEvent) => void;
  /**
   * Resolve the preconditions for one target.
   *
   * Injected because the facts come from the read layer (Head, index, operation
   * markers) and must be read at submit time, not at planning time. A caller that
   * cannot answer must return a context that fails the check rather than omitting it.
   */
  readonly preconditionsFor?: (
    request: ParsedMutationRequest,
  ) => Promise<PreconditionContext>;
  /** Map a request to the repository it touches, for queueing and journaling. */
  readonly repositoryIdFor: (request: ParsedMutationRequest) => string | null;
}

export type SubmitResult =
  | {
      readonly ok: true;
      readonly record: OperationRecord;
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly problem: Problem };

export interface JobEngine {
  submit(input: {
    readonly request: ParsedMutationRequest;
    readonly actor: string;
  }): Promise<SubmitResult>;
  get(operationId: string, actor: string): OperationRecord | null;
  list(input: { readonly actor: string; readonly limit: number }): {
    readonly operations: readonly OperationRecord[];
    readonly truncated: boolean;
  };
  cancel(input: {
    readonly operationId: string;
    readonly actor: string;
  }): SubmitResult;
  /** Drain the queue; called after submit and whenever a job finishes. */
  pump(): void;
  /** Registering an effect at runtime is how T08 turns a kind on. */
  registerEffect(effect: MutationEffect): void;
  implementedKinds(): readonly MutationKind[];
  pendingCount(): number;
  runningCount(): number;
}

export function createJobEngine(options: JobEngineOptions): JobEngine {
  const now = options.now ?? Date.now;
  const effects = new Map<MutationKind, MutationEffect>();
  for (const effect of options.effects) {
    effects.set(effect.kind, effect);
  }
  const queue: Queue<ParsedMutationRequest> =
    createQueue<ParsedMutationRequest>();
  const awaitingStart = new Map<
    string,
    { readonly actor: string; readonly digest: string }
  >();

  function recordFor(entry: JournalEntry): OperationRecord {
    return {
      operationId: entry.operationId,
      clientRequestId: entry.clientRequestId,
      kind: entry.kind,
      target: entry.target,
      status: entry.status,
      sequence: entry.sequence,
      acceptedAt: new Date(entry.acceptedAtMs).toISOString(),
      startedAt:
        entry.startedAtMs === null
          ? null
          : new Date(entry.startedAtMs).toISOString(),
      finishedAt:
        entry.finishedAtMs === null
          ? null
          : new Date(entry.finishedAtMs).toISOString(),
      result: entry.result,
      problem: entry.problem,
    };
  }

  async function transition(
    entry: JournalEntry,
    next: {
      readonly status: OperationStatus;
      readonly result?: OperationResult | null;
      readonly problem?: Problem | null;
      readonly unknownReason?: string | null;
      readonly started?: boolean;
      readonly finished?: boolean;
    },
  ): Promise<JournalEntry> {
    const updated: JournalEntry = {
      ...entry,
      status: next.status,
      sequence: options.nextSequence(),
      startedAtMs:
        next.started === true
          ? (entry.startedAtMs ?? now())
          : entry.startedAtMs,
      finishedAtMs: next.finished === true ? now() : entry.finishedAtMs,
      result: next.result ?? null,
      problem: next.problem ?? null,
      unknownReason: next.unknownReason ?? null,
    };
    const appended = await options.journal.append(updated);
    if (!appended.ok) {
      // The journal could not record the transition, so the transition did not
      // happen as far as any reader is concerned: report it as unknown rather than
      // pretending a state that is not on disk.
      return {
        ...updated,
        status: "unknown",
        problem: {
          code: "InternalError",
          message: appended.message,
          retryable: false,
          operationId: updated.operationId,
        },
        unknownReason: "the journal could not record this transition",
      };
    }
    options.onEvent?.({
      kind: "operation",
      operation: recordFor(updated),
      repositoryId: updated.repositoryId,
      worktreeIds: [],
    });
    if (next.status === "succeeded" || next.status === "needsAttention") {
      options.onEvent?.({
        kind: "repositoryChanged",
        operation: null,
        repositoryId: updated.repositoryId,
        worktreeIds: [],
      });
    }
    return updated;
  }

  async function runEffect(
    entry: JournalEntry,
    request: ParsedMutationRequest,
    actor: string,
  ): Promise<JournalEntry> {
    const kind = request.operation.kind;
    const effect = effects.get(kind);
    if (effect === undefined) {
      return transition(entry, {
        status: "failed",
        finished: true,
        problem: {
          code: "UnsupportedOperation",
          message: `${kind} is not implemented in this build`,
          retryable: false,
          operationId: entry.operationId,
        },
      });
    }
    let outcome: EffectOutcome;
    try {
      outcome = await effect.run({
        request,
        operationId: entry.operationId,
        actor,
      });
    } catch (error) {
      // An effect that throws leaves the outcome genuinely unknown: it may have
      // changed the repository before it failed. Nothing is retried.
      return transition(entry, {
        status: "unknown",
        finished: true,
        unknownReason: "the effect threw before reporting an outcome",
        problem: {
          code: "UncertainOutcome",
          message: `the operation failed unexpectedly (${
            error instanceof Error ? error.message : "unknown error"
          }); its effect on the repository is unknown and it was not retried`,
          retryable: false,
          operationId: entry.operationId,
        },
      });
    }
    switch (outcome.kind) {
      case "succeeded":
        return transition(entry, {
          status: "succeeded",
          result: outcome.result,
          finished: true,
        });
      case "failed":
        return transition(entry, {
          status: "failed",
          problem: { ...outcome.problem, operationId: entry.operationId },
          finished: true,
        });
      case "needsAttention":
        return transition(entry, {
          status: "needsAttention",
          problem: { ...outcome.problem, operationId: entry.operationId },
          finished: true,
        });
      default:
        return transition(entry, {
          status: "unknown",
          problem: { ...outcome.problem, operationId: entry.operationId },
          unknownReason: outcome.problem.message,
          finished: true,
        });
    }
  }

  return {
    async submit(input): Promise<SubmitResult> {
      const request = input.request;
      const kind = request.operation.kind;
      const clientRequestId = request.clientRequestId;
      const digest = canonicalPayloadDigest(request);

      // Idempotency: the same client request id and the same payload is the same
      // operation, and returns the existing record instead of running twice.
      const existing = options.journal
        .list({ actor: input.actor, limit: LIMITS.idempotencyMaxEntries })
        .find((entry) => entry.clientRequestId === clientRequestId);
      if (existing !== undefined) {
        if (existing.payloadDigest !== digest) {
          return {
            ok: false,
            problem: {
              code: "IdempotencyConflict",
              message:
                "that client request id was already used with a different payload; use a new id for the changed request",
              retryable: false,
              operationId: existing.operationId,
            },
          };
        }
        return { ok: true, record: recordFor(existing), duplicate: true };
      }

      if (!effects.has(kind)) {
        return {
          ok: false,
          problem: {
            code: "UnsupportedOperation",
            message: `${kind} is not implemented in this build; no operation was accepted`,
            retryable: false,
          },
        };
      }

      const repositoryId = options.repositoryIdFor(request);
      if (repositoryId === null) {
        return {
          ok: false,
          problem: {
            code: "NotFound",
            message:
              "that request does not name a repository this service knows",
            retryable: false,
          },
        };
      }

      if (options.preconditionsFor !== undefined) {
        const context = await options.preconditionsFor(request);
        const checked = checkPreconditions(context);
        if (!checked.ok) {
          return { ok: false, problem: checked.problem };
        }
      }

      const operationId = options.nextOperationId();
      const sequence = options.nextSequence();
      const entry: JournalEntry = {
        operationId,
        clientRequestId,
        actor: input.actor,
        kind,
        target: request.target,
        status: "accepted",
        sequence,
        acceptedAtMs: now(),
        startedAtMs: null,
        finishedAtMs: null,
        payloadDigest: digest,
        repositoryId,
        result: null,
        problem: null,
        unknownReason: null,
      };
      // Persist `accepted` before the operation may run. A failure here means the
      // operation is refused, not accepted-and-forgotten.
      const appended = await options.journal.append(entry);
      if (!appended.ok) {
        return {
          ok: false,
          problem: {
            code: "ResourceBusy",
            message: appended.message,
            retryable: true,
          },
        };
      }
      options.onEvent?.({
        kind: "operation",
        operation: recordFor(entry),
        repositoryId,
        worktreeIds: [],
      });

      const enqueued = queue.enqueue({
        id: operationId,
        actor: input.actor,
        repositoryId,
        mode: "write",
        job: request,
      });
      if (!enqueued.ok) {
        await transition(entry, {
          status: "failed",
          finished: true,
          problem: {
            code:
              enqueued.reason === "queue-full" ? "ResourceBusy" : "Conflict",
            message: enqueued.message,
            retryable: enqueued.reason === "queue-full",
            operationId,
          },
        });
        const failed = options.journal.get(operationId);
        return {
          ok: false,
          problem: {
            code:
              enqueued.reason === "queue-full" ? "ResourceBusy" : "Conflict",
            message: enqueued.message,
            retryable: enqueued.reason === "queue-full",
            ...(failed === null ? {} : { operationId }),
          },
        };
      }
      awaitingStart.set(operationId, { actor: input.actor, digest });
      this.pump();
      const current = options.journal.get(operationId) ?? entry;
      return { ok: true, record: recordFor(current), duplicate: false };
    },

    get(operationId, actor): OperationRecord | null {
      const entry = options.journal.get(operationId);
      if (entry === null || entry.actor !== actor) {
        return null;
      }
      return recordFor(entry);
    },

    list(input) {
      const entries = options.journal.list(input);
      return {
        operations: entries.map((entry) => recordFor(entry)),
        truncated: entries.length >= input.limit,
      };
    },

    cancel(input): SubmitResult {
      const entry = options.journal.get(input.operationId);
      if (entry === null || entry.actor !== input.actor) {
        return {
          ok: false,
          problem: {
            code: "NotFound",
            message: "no such operation for this session",
            retryable: false,
          },
        };
      }
      if (entry.status !== "accepted") {
        // A running mutation is never relabelled: it may already have changed the
        // repository, and calling that "cancelled" would hide the change.
        return {
          ok: false,
          problem: {
            code: "Conflict",
            message:
              entry.status === "running"
                ? "that operation is already running; a running mutation cannot be cancelled in this version"
                : `that operation already finished as ${entry.status}`,
            retryable: false,
            operationId: entry.operationId,
          },
        };
      }
      if (!queue.cancel(entry.operationId)) {
        return {
          ok: false,
          problem: {
            code: "Conflict",
            message: "that operation has already started",
            retryable: false,
            operationId: entry.operationId,
          },
        };
      }
      awaitingStart.delete(entry.operationId);
      const cancelled: JournalEntry = {
        ...entry,
        status: "cancelled",
        sequence: options.nextSequence(),
        finishedAtMs: now(),
        problem: {
          code: "Cancelled",
          message: "cancelled while queued; nothing was run",
          retryable: false,
          operationId: entry.operationId,
        },
      };
      void options.journal.append(cancelled);
      options.onEvent?.({
        kind: "operation",
        operation: recordFor(cancelled),
        repositoryId: cancelled.repositoryId,
        worktreeIds: [],
      });
      return { ok: true, record: recordFor(cancelled), duplicate: false };
    },

    pump(): void {
      queue.run(
        (ticket: QueueTicket<ParsedMutationRequest>, release: () => void) => {
          const entry = options.journal.get(ticket.id);
          const pending = awaitingStart.get(ticket.id);
          if (entry === null || pending === undefined) {
            release();
            return;
          }
          void (async () => {
            // Persist `running` *before* the effect starts: that is what makes a crash
            // mid-operation visible to the next process.
            const running = await transition(entry, {
              status: "running",
              started: true,
            });
            try {
              await runEffect(running, ticket.job, pending.actor);
            } finally {
              awaitingStart.delete(ticket.id);
              // Keep draining: finishing one job may unblock the next.
              setImmediate(() => {
                this.pump();
              });
            }
          })().finally(release);
        },
      );
    },

    registerEffect(effect): void {
      effects.set(effect.kind, effect);
    },

    implementedKinds(): readonly MutationKind[] {
      return [...effects.keys()];
    },

    pendingCount(): number {
      return queue.pendingCount();
    },

    runningCount(): number {
      return queue.runningCount();
    },
  };
}
