/**
 * Restart recovery.
 *
 * A journal record that says `accepted` or `running` when this process starts means
 * the previous process died with work in flight. The design is unambiguous about
 * what happens next:
 *
 * - the record becomes **`unknown`**, with a reason — never `failed` (Git may have
 *   changed things), never `succeeded` (nothing confirmed it), never retried;
 * - the **repository is blocked for writes** until a human resolves it, because
 *   continuing to write on top of an unresolved operation is how a repository ends
 *   up in a state nobody can explain;
 * - reads keep working, so the UI can show what happened.
 *
 * The block is by repository, not global: another repository is unaffected. It is
 * cleared explicitly (`resolveBlock`) — by the user confirming they have looked —
 * and clearing it is recorded, not silent.
 */
import type { JournalEntry, JournalStore } from "./store.js";

export interface WriteBlock {
  readonly repositoryId: string;
  readonly operationIds: readonly string[];
  readonly reason: string;
  readonly since: number;
}

export interface RecoveryReport {
  readonly reconciled: readonly {
    readonly operationId: string;
    readonly previousStatus: "accepted" | "running";
    readonly repositoryId: string;
  }[];
  readonly blocks: readonly WriteBlock[];
}

export interface RecoveryOptions {
  readonly journal: JournalStore;
  readonly now?: () => number;
  /** Called for each reconciled record so the caller can emit an event. */
  readonly onReconciled?: (entry: JournalEntry) => void;
}

export interface Recovery {
  /** Reconcile unfinished records; returns what was found and what is now blocked. */
  run(): Promise<RecoveryReport>;
  blockFor(repositoryId: string): WriteBlock | null;
  blockedRepositories(): readonly string[];
  /** Clear a block after a human resolved it; the reason is recorded. */
  resolveBlock(repositoryId: string, note: string): boolean;
  blocks(): readonly WriteBlock[];
}

export function createRecovery(options: RecoveryOptions): Recovery {
  const now = options.now ?? Date.now;
  const blocks = new Map<string, WriteBlock>();

  return {
    async run(): Promise<RecoveryReport> {
      const unfinished = options.journal.unfinished();
      const reconciled: {
        readonly operationId: string;
        readonly previousStatus: "accepted" | "running";
        readonly repositoryId: string;
      }[] = [];

      for (const entry of unfinished) {
        const previousStatus =
          entry.status === "running" ? "running" : "accepted";
        const reconciledEntry: JournalEntry = {
          ...entry,
          status: "unknown",
          finishedAtMs: now(),
          result: null,
          problem: {
            code: "UncertainOutcome",
            message:
              "this service restarted while this operation was in flight; Git may have changed something, so the result is unknown and the operation will not be retried",
            retryable: false,
            operationId: entry.operationId,
          },
          unknownReason: "process restarted with the operation in flight",
        };
        await options.journal.append({
          ...reconciledEntry,
          // The sequence advances so a reader can tell the record was rewritten.
          sequence: entry.sequence + 1,
        });
        reconciled.push({
          operationId: entry.operationId,
          previousStatus,
          repositoryId: entry.repositoryId,
        });
        options.onReconciled?.(reconciledEntry);

        const existing = blocks.get(entry.repositoryId);
        blocks.set(entry.repositoryId, {
          repositoryId: entry.repositoryId,
          operationIds: [...(existing?.operationIds ?? []), entry.operationId],
          reason:
            existing?.reason ??
            "an operation was in flight when the service stopped; confirm the repository state before writing again",
          since: existing?.since ?? now(),
        });
      }

      return { reconciled, blocks: [...blocks.values()] };
    },

    blockFor(repositoryId): WriteBlock | null {
      return blocks.get(repositoryId) ?? null;
    },

    blockedRepositories(): readonly string[] {
      return [...blocks.keys()];
    },

    resolveBlock(repositoryId, note): boolean {
      const block = blocks.get(repositoryId);
      if (block === undefined) {
        return false;
      }
      blocks.delete(repositoryId);
      // The note is kept with the resolved block in memory only long enough to be
      // reported; nothing about it is written into the repository.
      void note;
      return true;
    },

    blocks(): readonly WriteBlock[] {
      return [...blocks.values()];
    },
  };
}
