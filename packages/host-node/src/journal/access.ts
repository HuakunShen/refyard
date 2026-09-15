/**
 * Audit records for runtime repository approvals and revocations.
 *
 * Access grants are intentionally in-memory: restarting the service requires a fresh
 * explicit approval. The audit is durable, however, so a later investigation can answer
 * which path was approved or revoked, under which root, by which actor and when. It never
 * stores a bearer, ticket, request body or repository contents.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AccessAction = "register" | "revoke";

export interface AccessJournalEntry {
  readonly action: AccessAction;
  readonly path: string;
  readonly allowedRootId: string;
  readonly repositoryId: string;
  readonly actor: string;
  readonly atMs: number;
}

export interface AccessJournalOptions {
  readonly stateRoot: string;
}

export interface AccessJournal {
  load(): Promise<readonly AccessJournalEntry[]>;
  append(entry: AccessJournalEntry): Promise<void>;
  list(): readonly AccessJournalEntry[];
  filePath(): string;
}

export function createAccessJournal(
  options: AccessJournalOptions,
): AccessJournal {
  const filePath = join(options.stateRoot, "access.jsonl");
  const entries: AccessJournalEntry[] = [];
  let appendTail: Promise<void> = Promise.resolve();

  return {
    async load(): Promise<readonly AccessJournalEntry[]> {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        return [...entries];
      }
      const lines = text.split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.length === 0) {
          continue;
        }
        const entry = parseEntry(line);
        if (entry === null) {
          if (index !== lines.length - 1 && index !== lines.length - 2) {
            throw new Error(
              `the access journal at ${filePath} has an unreadable record at line ${index + 1}`,
            );
          }
          continue;
        }
        entries.push(entry);
      }
      return [...entries];
    },

    async append(entry): Promise<void> {
      const write = appendTail.then(async () => {
        await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
        await appendFile(filePath, `${JSON.stringify(entry)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        entries.push(entry);
      });
      appendTail = write.catch(() => {});
      await write;
    },

    list(): readonly AccessJournalEntry[] {
      return [...entries];
    },

    filePath(): string {
      return filePath;
    },
  };
}

function parseEntry(line: string): AccessJournalEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const action = Reflect.get(value, "action");
  const path = Reflect.get(value, "path");
  const allowedRootId = Reflect.get(value, "allowedRootId");
  const repositoryId = Reflect.get(value, "repositoryId");
  const actor = Reflect.get(value, "actor");
  const atMs = Reflect.get(value, "atMs");
  if (
    (action !== "register" && action !== "revoke") ||
    typeof path !== "string" ||
    typeof allowedRootId !== "string" ||
    typeof repositoryId !== "string" ||
    typeof actor !== "string" ||
    typeof atMs !== "number" ||
    !Number.isFinite(atMs)
  ) {
    return null;
  }
  return { action, path, allowedRootId, repositoryId, actor, atMs };
}
