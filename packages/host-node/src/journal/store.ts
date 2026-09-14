/**
 * The journal: what this service did, persisted before it did it.
 *
 * The design's ordering rule is the whole point of this file:
 *
 * 1. write `accepted` **before** the operation may run,
 * 2. write `running` **before** Git is started,
 * 3. write the terminal state when it is known.
 *
 * A crash between those points is therefore *visible*: the restart finds a record
 * that says `accepted` or `running`, and that record is reported as `unknown` — not
 * as a success, and never retried. Without the journal ordering, a crash mid-commit
 * would leave no trace, and the UI would show a repository in a state nobody
 * explained.
 *
 * What is stored is what the design allows: identity, target, status, timestamps,
 * a **payload digest**, a bounded result summary and a problem. Never a diff, a
 * commit message, a password, a ticket, an SSH key, a credential-bearing URL or
 * source code — nothing that would make the journal a second copy of the user's
 * data, and nothing that has to be redacted before the file can be read.
 *
 * The file is JSONL with one line per state transition, last-wins per operation.
 * A torn final line (a crash mid-append) is discarded on load rather than treated
 * as corruption: that is exactly the case the format has to survive.
 */
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type {
  MutationKind,
  MutationTarget,
  OperationRecord,
  OperationResult,
  OperationStatus,
  Problem,
} from "@refyard/git-contract";
import {
  isTerminalStatus,
  mayPruneRecord,
  type RetentionPolicy,
} from "./retention.js";

export interface JournalEntry {
  readonly operationId: string;
  readonly clientRequestId: string;
  readonly actor: string;
  readonly kind: MutationKind;
  readonly target: MutationTarget;
  readonly status: OperationStatus;
  readonly sequence: number;
  readonly acceptedAtMs: number;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
  /** SHA-256 of the canonical request, for idempotency comparison. */
  readonly payloadDigest: string;
  readonly repositoryId: string;
  readonly result: OperationResult | null;
  readonly problem: Problem | null;
  /** Why a terminal state could not be determined; present only for `unknown`. */
  readonly unknownReason: string | null;
}

export type AppendOutcome =
  | { readonly ok: true; readonly entry: JournalEntry }
  | { readonly ok: false; readonly reason: "full"; readonly message: string };

export interface JournalStoreOptions {
  /** Private state directory; the journal never lives inside a repository. */
  readonly stateRoot: string;
  readonly retention: RetentionPolicy;
  readonly now?: () => number;
}

export interface JournalStore {
  /** Load existing records; unfinished ones are the caller's to reconcile. */
  load(): Promise<readonly JournalEntry[]>;
  append(entry: JournalEntry): Promise<AppendOutcome>;
  get(operationId: string): JournalEntry | null;
  /** Records for one actor, newest first, bounded by the caller's limit. */
  list(input: {
    readonly actor: string;
    readonly limit: number;
  }): readonly JournalEntry[];
  /** Records that the design says must be reported as unknown after a restart. */
  unfinished(): readonly JournalEntry[];
  /** Bytes written so far, for the retention decision. */
  sizeBytes(): number;
  entryCount(): number;
  /** Replace the record set on disk, dropping what retention allows. */
  compact(): Promise<number>;
  filePath(): string;
}

export function canonicalPayloadDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Deterministic JSON, so two identical requests hash identically.
 *
 * Key order in a JSON body is not meaningful, but it *is* observable, and an
 * idempotency check that depended on it would reject a retry of the same request
 * because a client serialised its fields differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function createJournalStore(options: JournalStoreOptions): JournalStore {
  const now = options.now ?? Date.now;
  const filePath = join(options.stateRoot, "journal.jsonl");
  const entries = new Map<string, JournalEntry>();
  let bytes = 0;

  function serialize(entry: JournalEntry): string {
    // The record is written in the contract's own field names, so a human reading
    // the file and a client reading the API see the same vocabulary.
    return `${JSON.stringify({
      operationId: entry.operationId,
      clientRequestId: entry.clientRequestId,
      actor: entry.actor,
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
      payloadDigest: entry.payloadDigest,
      repositoryId: entry.repositoryId,
      result: entry.result,
      problem: entry.problem,
      unknownReason: entry.unknownReason,
    })}\n`;
  }

  function deserialize(line: string): JournalEntry | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A torn final line is a crash artifact, not corruption.
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    const operationId = candidate["operationId"];
    const clientRequestId = candidate["clientRequestId"];
    const actor = candidate["actor"];
    const kind = candidate["kind"];
    const target = candidate["target"];
    const status = candidate["status"];
    const sequence = candidate["sequence"];
    const acceptedAt = candidate["acceptedAt"];
    const payloadDigest = candidate["payloadDigest"];
    const repositoryId = candidate["repositoryId"];
    if (
      typeof operationId !== "string" ||
      typeof clientRequestId !== "string" ||
      typeof actor !== "string" ||
      typeof kind !== "string" ||
      typeof status !== "string" ||
      typeof sequence !== "number" ||
      typeof acceptedAt !== "string" ||
      typeof payloadDigest !== "string" ||
      typeof repositoryId !== "string" ||
      typeof target !== "object" ||
      target === null
    ) {
      return null;
    }
    return {
      operationId,
      clientRequestId,
      actor,
      kind: kind as MutationKind,
      target: target as MutationTarget,
      status: status as OperationStatus,
      sequence,
      acceptedAtMs: Date.parse(acceptedAt),
      startedAtMs: parseTime(candidate["startedAt"]),
      finishedAtMs: parseTime(candidate["finishedAt"]),
      payloadDigest,
      repositoryId,
      result: (candidate["result"] ?? null) as OperationResult | null,
      problem: (candidate["problem"] ?? null) as Problem | null,
      unknownReason:
        typeof candidate["unknownReason"] === "string"
          ? candidate["unknownReason"]
          : null,
    };
  }

  return {
    async load(): Promise<readonly JournalEntry[]> {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        return [];
      }
      bytes = Buffer.byteLength(text, "utf8");
      const lines = text.split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.length === 0) {
          continue;
        }
        const entry = deserialize(line);
        if (entry === null) {
          // Only the last line may be torn; anything else means the file was edited
          // or truncated by something other than this service, and the safe reading
          // is to stop rather than to guess which records are real.
          if (index !== lines.length - 1 && index !== lines.length - 2) {
            throw new Error(
              `the journal at ${filePath} has an unreadable record at line ${index + 1}; refusing to interpret it`,
            );
          }
          continue;
        }
        entries.set(entry.operationId, entry);
      }
      return [...entries.values()];
    },

    async append(entry): Promise<AppendOutcome> {
      const line = serialize(entry);
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (bytes + lineBytes > options.retention.maxBytes) {
        // Over budget: only expired terminal records may be dropped, and only if
        // that actually frees the room. Otherwise the new operation is refused —
        // never accepted at the cost of an older record nobody has read yet.
        const pruned = await this.compact();
        if (pruned === 0 || bytes + lineBytes > options.retention.maxBytes) {
          return {
            ok: false,
            reason: "full",
            message:
              "the operation journal is full; no expired records could be removed, so no new operation is accepted",
          };
        }
      }
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
      entries.set(entry.operationId, entry);
      bytes += lineBytes;
      return { ok: true, entry };
    },

    get(operationId): JournalEntry | null {
      return entries.get(operationId) ?? null;
    },

    list(input): readonly JournalEntry[] {
      return [...entries.values()]
        .filter((entry) => entry.actor === input.actor)
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, input.limit);
    },

    unfinished(): readonly JournalEntry[] {
      return [...entries.values()].filter(
        (entry) => entry.status === "accepted" || entry.status === "running",
      );
    },

    sizeBytes(): number {
      return bytes;
    },

    entryCount(): number {
      return entries.size;
    },

    async compact(): Promise<number> {
      const current = now();
      const kept: JournalEntry[] = [];
      let dropped = 0;
      let droppedBytes = 0;
      // Oldest first, so the file shrinks from the front.
      const ordered = [...entries.values()].sort(
        (a, b) => a.sequence - b.sequence,
      );
      const projected = new Map<string, number>();
      for (const entry of ordered) {
        if (!isTerminalStatus(entry.status)) {
          kept.push(entry);
          projected.set(
            entry.operationId,
            Buffer.byteLength(serialize(entry), "utf8"),
          );
          continue;
        }
        if (mayPruneRecord(entry, current, options.retention)) {
          dropped += 1;
          droppedBytes += Buffer.byteLength(serialize(entry), "utf8");
          continue;
        }
        kept.push(entry);
        projected.set(
          entry.operationId,
          Buffer.byteLength(serialize(entry), "utf8"),
        );
      }
      if (dropped === 0) {
        return 0;
      }
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const temporary = `${filePath}.compact`;
      await writeFile(
        temporary,
        kept.map((entry) => serialize(entry)).join(""),
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      // Rename is atomic on the platforms this runs on, so a crash during compaction
      // leaves either the old file or the new one, never a half-written journal.
      await rename(temporary, filePath);
      entries.clear();
      for (const entry of kept) {
        entries.set(entry.operationId, entry);
      }
      bytes = [...projected.values()].reduce(
        (total, value) => total + value,
        0,
      );
      void droppedBytes;
      return dropped;
    },

    filePath(): string {
      return filePath;
    },
  };
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The journal's file path for a state root, without constructing the store. */
export function journalPathFor(stateRoot: string): string {
  return join(stateRoot, "journal.jsonl");
}

/** True when the journal file exists; used by tests and the restart check. */
export async function journalExists(stateRoot: string): Promise<boolean> {
  try {
    const info = await stat(journalPathFor(stateRoot));
    return info.isFile();
  } catch {
    return false;
  }
}

/** Build one journal record from the contract's own operation record shape. */
export function entryFromRecord(
  record: OperationRecord,
  extras: {
    readonly actor: string;
    readonly payloadDigest: string;
    readonly repositoryId: string;
    readonly unknownReason?: string | null;
  },
): JournalEntry {
  return {
    operationId: record.operationId,
    clientRequestId: record.clientRequestId,
    actor: extras.actor,
    kind: record.kind,
    target: record.target,
    status: record.status,
    sequence: record.sequence,
    acceptedAtMs: Date.parse(record.acceptedAt),
    startedAtMs:
      record.startedAt === null ? null : Date.parse(record.startedAt),
    finishedAtMs:
      record.finishedAt === null ? null : Date.parse(record.finishedAt),
    payloadDigest: extras.payloadDigest,
    repositoryId: extras.repositoryId,
    result: record.result,
    problem: record.problem,
    unknownReason: extras.unknownReason ?? null,
  };
}
