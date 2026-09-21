/**
 * Audit records for runtime repository approvals and revocations, and for
 * provider connections.
 *
 * Access grants are intentionally in-memory: restarting the service requires a fresh
 * explicit approval. The audit is durable, however, so a later investigation can answer
 * which path was approved or revoked, under which root, by which actor and when — and,
 * since the provider axis, when a forge account was connected or disconnected. It never
 * stores a bearer, ticket, request body, repository contents or a provider token.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AccessAction =
  | "register"
  | "revoke"
  | "provider-connect"
  | "provider-disconnect";

export interface RepositoryAccessEntry {
  readonly action: "register" | "revoke";
  readonly path: string;
  readonly allowedRootId: string;
  readonly repositoryId: string;
  readonly actor: string;
  readonly atMs: number;
}

/** The account name is recorded; the token bytes never are. */
export interface ProviderAccessEntry {
  readonly action: "provider-connect" | "provider-disconnect";
  readonly provider: string;
  readonly accountLogin: string;
  readonly actor: string;
  readonly atMs: number;
}

export type AccessJournalEntry =
  | RepositoryAccessEntry
  | ProviderAccessEntry;

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
  const actor = Reflect.get(value, "actor");
  const atMs = Reflect.get(value, "atMs");
  if (
    typeof actor !== "string" ||
    typeof atMs !== "number" ||
    !Number.isFinite(atMs)
  ) {
    return null;
  }
  if (action === "register" || action === "revoke") {
    const path = Reflect.get(value, "path");
    const allowedRootId = Reflect.get(value, "allowedRootId");
    const repositoryId = Reflect.get(value, "repositoryId");
    if (
      typeof path !== "string" ||
      typeof allowedRootId !== "string" ||
      typeof repositoryId !== "string"
    ) {
      return null;
    }
    return { action, path, allowedRootId, repositoryId, actor, atMs };
  }
  if (action === "provider-connect" || action === "provider-disconnect") {
    const provider = Reflect.get(value, "provider");
    const accountLogin = Reflect.get(value, "accountLogin");
    if (typeof provider !== "string" || typeof accountLogin !== "string") {
      return null;
    }
    return { action, provider, accountLogin, actor, atMs };
  }
  return null;
}
