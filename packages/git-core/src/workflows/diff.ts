/**
 * Diff reads: change sets, line statistics and bounded text patches.
 *
 * A diff is always bounded and always scoped to one of five requests, and the three
 * Git commands behind it answer different questions — which is why they are joined
 * here rather than merged into one call:
 *
 * - `diff --name-status` says *what happened* to each path (including renames and
 *   type changes),
 * - `diff --numstat` says *how much* changed, and reports `-`/`-` for a binary file
 *   rather than pretending it has lines,
 * - `diff --patch` says *which* lines, and is read one path at a time so a single
 *   huge file cannot consume the whole response budget.
 *
 * Untracked files have no diff at all. They are reported as changes with an empty
 * patch body rather than being synthesized from a file read that the user did not
 * authorise for display.
 */
import { CORE_LIMITS } from "../bytes/limits.js";
import {
  parseNameStatus,
  parseNumstat,
  type NameStatusEntry,
} from "../parse/numstat.js";
import { parsePatch, type ParsedFilePatch } from "../parse/patch.js";
import {
  planDiffNameStatus,
  planDiffNumstat,
  planDiffPatchForPath,
} from "../plan/paths.js";
import {
  GitWorkflowError,
  parseFailure,
  runRequired,
  type GitEngine,
} from "./engine.js";

export type DiffRequestKind =
  "unstaged" | "staged" | "untracked" | "commit" | "range";

export interface DiffScope {
  readonly kind: DiffRequestKind;
  /** For `commit`: the commit whose parent is compared. */
  readonly oid?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface DiffFileFacts {
  readonly pathBytes: Uint8Array;
  readonly oldPathBytes: Uint8Array | null;
  readonly changeKind: NameStatusEntry["changeKind"];
  readonly isBinary: boolean;
  readonly isSubmodule: boolean;
  readonly insertions: number | null;
  readonly deletions: number | null;
  readonly modes: {
    readonly old: string | null;
    readonly new: string | null;
  } | null;
  readonly patch: ParsedFilePatch | null;
}

export interface DiffFacts {
  readonly files: readonly DiffFileFacts[];
  /** True when any bound stopped the read early. */
  readonly truncated: boolean;
  /** Reasons a bound was hit, for the response to report honestly. */
  readonly limitations: readonly string[];
}

/** Translate a request into the `diff` arguments the three reads share. */
export function diffArguments(scope: DiffScope): {
  readonly cached: boolean;
  readonly from?: string;
  readonly to?: string;
} {
  switch (scope.kind) {
    case "staged":
      return { cached: true };
    case "commit": {
      if (scope.oid === undefined) {
        throw new GitWorkflowError({
          code: "NoRevisionFound",
          command: "diff",
          message: "a commit diff requires an object name",
        });
      }
      // `<oid>^!` is the commit against its first parent — Git's own shorthand, so
      // a root commit diffs against the empty tree rather than failing.
      return { cached: false, from: `${scope.oid}^!` };
    }
    case "range": {
      if (scope.from === undefined || scope.to === undefined) {
        throw new GitWorkflowError({
          code: "NoRevisionFound",
          command: "diff",
          message: "a range diff requires both endpoints",
        });
      }
      return { cached: false, from: scope.from, to: scope.to };
    }
    case "unstaged":
    case "untracked":
      return { cached: false };
    default:
      throw new GitWorkflowError({
        code: "GitCommandFailed",
        command: "diff",
        message: `unsupported diff request ${String(scope.kind)}`,
      });
  }
}

/**
 * Read the change set: what changed, how much, and — when asked — the patch.
 *
 * `patchFor` decides which paths get a text patch. The caller passes one path at a
 * time so each patch can be bounded separately and a `pathId` can be attributed to
 * the file it belongs to; nothing here guesses which path a patch belongs to from
 * the patch headers.
 */
export async function readDiffFacts(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly scope: DiffScope;
    /** Paths to fetch a text patch for, as representable text. */
    readonly patchPaths?: readonly string[];
    readonly maxBytesPerPatch?: number;
    readonly includePatch?: boolean;
  },
): Promise<DiffFacts> {
  const args = diffArguments(input.scope);
  const limitations: string[] = [];

  const nameStatusSpec = planDiffNameStatus(
    { cwdHandle: input.cwdHandle },
    args,
  );
  let changes: readonly NameStatusEntry[];
  try {
    changes = parseNameStatus(await runRequired(engine, nameStatusSpec));
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(nameStatusSpec.description, error);
  }

  const numstatSpec = planDiffNumstat({ cwdHandle: input.cwdHandle }, args);
  let stats;
  try {
    stats = parseNumstat(await runRequired(engine, numstatSpec));
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(numstatSpec.description, error);
  }

  // Join on the new path, which is the only stable identity a rename shares with
  // its numstat row.
  const statsByPath = new Map(
    stats.map((entry) => [pathKey(entry.path), entry] as const),
  );

  const patches = new Map<
    string,
    { patch: ParsedFilePatch; truncated: boolean }
  >();
  if (input.includePatch !== false && input.patchPaths !== undefined) {
    for (const path of input.patchPaths) {
      const spec = planDiffPatchForPath(
        { cwdHandle: input.cwdHandle },
        { path, ...args },
      );
      const bytes = await runRequired(engine, spec);
      let parsed;
      try {
        parsed = parsePatch(bytes, {
          maxBytes: input.maxBytesPerPatch ?? CORE_LIMITS.patchMaxBytesPerFile,
          maxLines: CORE_LIMITS.patchMaxLinesPerFile,
        });
      } catch (error) {
        throw parseFailure(spec.description, error);
      }
      const file = parsed.files[0];
      if (file !== undefined) {
        patches.set(path, { patch: file, truncated: parsed.truncated });
      }
      if (parsed.truncated) {
        limitations.push(
          `the patch for ${path} was truncated by the size bound`,
        );
      }
    }
  }

  const files: DiffFileFacts[] = changes.map((change) => {
    const stat = statsByPath.get(pathKey(change.path));
    const patchEntry = patches.get(decodeLenient(change.path));
    const patch = patchEntry?.patch ?? null;
    const isBinary = stat?.binary === true;
    return {
      pathBytes: change.path,
      oldPathBytes: change.originalPath,
      changeKind: change.changeKind,
      isBinary,
      isSubmodule: patch?.body.kind === "submodule",
      insertions: stat?.insertions ?? null,
      deletions: stat?.deletions ?? null,
      modes: patch === null ? null : { old: patch.oldMode, new: patch.newMode },
      patch,
    };
  });

  return {
    files,
    truncated: limitations.length > 0,
    limitations,
  };
}

/** A path key for joining two listings: the raw bytes, hex-encoded. */
export function pathKey(bytes: Uint8Array): string {
  let key = "";
  for (const byte of bytes) {
    key += byte.toString(16).padStart(2, "0");
  }
  return key;
}

function decodeLenient(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}
