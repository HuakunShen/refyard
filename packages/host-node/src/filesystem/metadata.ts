/**
 * File metadata, content fingerprints, and the private recovery area.
 *
 * These three belong together because they answer one question: *may this
 * destructive operation run, and can what it destroys be recovered?*
 *
 * - **metadata** decides whether a path may be acted on at all. A symlink, a
 *   submodule, a socket or a device is not a regular file, and "discard changes"
 *   on one of those means something different — or nothing — so it is refused
 *   rather than approximated.
 * - **fingerprints** are what a preview token binds to. `git status` saying `M` is
 *   not evidence that the content the user looked at is still there; a hash of the
 *   bytes is, and a mismatch makes the operation stale.
 * - **recovery** writes what is about to be lost into a private directory and
 *   verifies the copy before anything is overwritten. A backup that cannot be
 *   verified means the operation does not run — the design's rule, and the reason
 *   this module returns a report instead of a boolean.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export type PathKind =
  "regularFile" | "directory" | "symlink" | "submoduleGitlink" | "other";

export interface PathMetadata {
  readonly path: string;
  readonly kind: PathKind;
  readonly sizeBytes: number;
  /** Octal mode as reported by the filesystem, e.g. `644`. */
  readonly mode: string;
  readonly modifiedAtMs: number;
  /** True when the path is executable, which a restore must preserve. */
  readonly executable: boolean;
}

export interface ContentFingerprint {
  readonly algorithm: "sha256";
  readonly hex: string;
  readonly sizeBytes: number;
  readonly contentKind: "text" | "binary" | "unrepresentable";
}

export class PathRefusedError extends Error {
  readonly code: "UnsupportedPathEncoding" | "Forbidden" | "NotFound";
  readonly path: string;

  constructor(code: PathRefusedError["code"], path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PathRefusedError";
    this.code = code;
    this.path = path;
  }
}

/** Classify a path without following a symlink: the type decides what may be done. */
export async function readPathMetadata(path: string): Promise<PathMetadata> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    throw new PathRefusedError("NotFound", path, "does not exist");
  }
  const kind: PathKind = info.isSymbolicLink()
    ? "symlink"
    : info.isFile()
      ? "regularFile"
      : info.isDirectory()
        ? "directory"
        : "other";
  return {
    path,
    kind,
    sizeBytes: info.size,
    mode: (info.mode & 0o777).toString(8).padStart(3, "0"),
    modifiedAtMs: info.mtimeMs,
    executable: (info.mode & 0o111) !== 0,
  };
}

/** A directory cannot be discarded as if it were a file, and neither can a link. */
export function isDiscardableKind(kind: PathKind): boolean {
  return kind === "regularFile";
}

const TEXT_SNIFF_BYTES = 8000;

/**
 * Fingerprint a file's contents.
 *
 * The hash is streamed, so a large file does not have to fit in memory, and the
 * content kind is sniffed from a prefix: a NUL byte means binary, which is what
 * the UI needs to say "binary file" instead of showing replacement characters.
 */
export async function fingerprintFile(
  path: string,
): Promise<ContentFingerprint> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let prefix: Uint8Array = new Uint8Array(0);
  await pipeline(
    createReadStream(path),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        const view = new Uint8Array(chunk);
        sizeBytes += view.byteLength;
        if (prefix.byteLength < TEXT_SNIFF_BYTES) {
          const room = TEXT_SNIFF_BYTES - prefix.byteLength;
          const merged = new Uint8Array(
            prefix.byteLength + Math.min(room, view.byteLength),
          );
          merged.set(prefix, 0);
          merged.set(
            view.subarray(0, Math.min(room, view.byteLength)),
            prefix.byteLength,
          );
          prefix = merged;
        }
        hash.update(view);
        yield new Uint8Array(0);
      }
    },
  );
  return {
    algorithm: "sha256",
    hex: hash.digest("hex"),
    sizeBytes,
    contentKind: sniffContentKind(prefix),
  };
}

export function sniffContentKind(
  prefix: Uint8Array,
): ContentFingerprint["contentKind"] {
  if (prefix.includes(0x00)) {
    return "binary";
  }
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    strict.decode(prefix);
    return "text";
  } catch {
    return "unrepresentable";
  }
}

/* ------------------------------------------------------------------ recovery */

export interface RecoveryBudget {
  readonly maxTotalBytes: number;
  readonly maxAgeMs: number;
}

export const DEFAULT_RECOVERY_BUDGET: RecoveryBudget = {
  // 256 MiB of recoverable content, kept for seven days. The design's numbers:
  // a full budget refuses a new backup rather than deleting a protected one.
  maxTotalBytes: 256 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export interface BackupRecord {
  readonly backupPath: string;
  readonly originalPath: string;
  readonly fingerprint: ContentFingerprint;
  readonly createdAtMs: number;
  /** Original mode, so a restore can put it back rather than guessing. */
  readonly mode: string;
}

export type BackupOutcome =
  | { readonly kind: "verified"; readonly record: BackupRecord }
  | { readonly kind: "refused"; readonly reason: string };

export interface RecoveryStoreOptions {
  /** Private directory; must be inside the service's own state root. */
  readonly root: string;
  readonly budget?: RecoveryBudget;
  /** Injected so tests can age entries without waiting a week. */
  readonly now?: () => number;
}

export interface RecoveryStore {
  /** Copy a file into the recovery area and verify the copy before returning. */
  backUp(input: {
    readonly originalPath: string;
    readonly contentRoot: string;
    readonly operationId: string;
  }): Promise<BackupOutcome>;
  list(): Promise<readonly BackupRecord[]>;
  usageBytes(): Promise<number>;
  /** Drop entries older than the budget. Never removes one that is still protected. */
  prune(): Promise<number>;
  restore(record: BackupRecord): Promise<void>;
}

export function createRecoveryStore(
  options: RecoveryStoreOptions,
): RecoveryStore {
  const budget = options.budget ?? DEFAULT_RECOVERY_BUDGET;
  const now = options.now ?? Date.now;
  const indexPath = join(options.root, "index.json");

  async function readIndex(): Promise<BackupRecord[]> {
    try {
      const text = await readFile(indexPath, "utf8");
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as BackupRecord[]) : [];
    } catch {
      return [];
    }
  }

  async function writeIndex(records: readonly BackupRecord[]): Promise<void> {
    await mkdir(options.root, { recursive: true });
    await writeFile(indexPath, JSON.stringify(records, null, 2), "utf8");
  }

  return {
    async backUp({ originalPath, contentRoot, operationId }) {
      const metadata = await readPathMetadata(originalPath);
      if (metadata.kind !== "regularFile") {
        return {
          kind: "refused",
          reason: `only regular files are backed up, this is a ${metadata.kind}`,
        };
      }
      const existing = await readIndex();
      const liveBytes = existing.reduce(
        (total, record) => total + record.fingerprint.sizeBytes,
        0,
      );
      if (liveBytes + metadata.sizeBytes > budget.maxTotalBytes) {
        // Refuse rather than evict: the entries taking up space are exactly the
        // ones a previous discard may need.
        return {
          kind: "refused",
          reason: `recovery area holds ${liveBytes} bytes of ${budget.maxTotalBytes}; prune or restore first`,
        };
      }

      const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
      const relativePath = relative(contentRoot, originalPath)
        .split(sep)
        .join("/");
      const backupPath = join(options.root, operationId, stamp, relativePath);
      await mkdir(dirname(backupPath), { recursive: true });

      const source = await readFile(originalPath);
      await writeFile(backupPath, source);
      const originalFingerprint = await fingerprintFile(originalPath);
      const copyFingerprint = await fingerprintFile(backupPath);
      if (originalFingerprint.hex !== copyFingerprint.hex) {
        // A copy that does not match is not a backup. The operation is refused and
        // the partial copy removed, so nothing downstream can assume safety.
        await rm(dirname(backupPath), { recursive: true, force: true });
        return {
          kind: "refused",
          reason: "backup copy did not match the original bytes",
        };
      }

      const record: BackupRecord = {
        backupPath,
        originalPath,
        fingerprint: copyFingerprint,
        createdAtMs: now(),
        mode: metadata.mode,
      };
      await writeIndex([...existing, record]);
      return { kind: "verified", record };
    },

    async list() {
      return readIndex();
    },

    async usageBytes() {
      const records = await readIndex();
      return records.reduce(
        (total, record) => total + record.fingerprint.sizeBytes,
        0,
      );
    },

    async prune() {
      const records = await readIndex();
      const cutoff = now() - budget.maxAgeMs;
      const keep: BackupRecord[] = [];
      let removed = 0;
      for (const record of records) {
        if (record.createdAtMs >= cutoff) {
          keep.push(record);
          continue;
        }
        await rm(dirname(dirname(record.backupPath)), {
          recursive: true,
          force: true,
        });
        removed += 1;
      }
      if (removed > 0) {
        await writeIndex(keep);
      }
      return removed;
    },

    async restore(record) {
      const contents = await readFile(record.backupPath);
      await writeFile(record.originalPath, contents, {
        mode: Number.parseInt(record.mode, 8),
      });
    },
  };
}

/** Total size of a directory tree, for budget reporting. */
export async function directorySize(root: string): Promise<number> {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(path);
    } else if (entry.isFile()) {
      total += (await stat(path)).size;
    }
  }
  return total;
}

/** Display name of a path's parent, for messages that should not print the whole path. */
export function parentName(path: string): string {
  return basename(dirname(path));
}
