/**
 * Refs, remotes, worktrees, submodules and stashes as portable facts — and the two
 * commands that create a repository.
 *
 * The reads are grouped because they share a shape: each one asks Git for a listing,
 * and each listing's *interpretation* — which object a tag really points at, which of
 * three object names a submodule is out of sync on, whether a stash locator still
 * matches the object it was recorded with — belongs here rather than in the UI.
 *
 * Creation is here for the opposite reason: `git init` and `git clone` are the only
 * writes whose destination may not exist when they start, so what a failure *left on
 * disk* is part of the answer. The comparison (before, after, how the process ended)
 * is a product rule and lives in core; the observation itself is I/O, so the host
 * supplies it as a function — core never touches a filesystem.
 *
 * Identity comes later. Core returns paths, objects and names; the host registry
 * mints `repositoryId`/`worktreeId`/`pathId` and decides what a session may see.
 */
import {
  parseConfigEntries,
  parseRemoteList,
  parseLsTree,
  type ConfigEntry,
} from "../parse/meta.js";
import {
  parseForEachRef,
  parseReflog,
  type RefRecord,
  type ReflogRecord,
} from "../parse/refs.js";
import { parseLsFilesStage, type IndexEntry } from "../parse/ls-files.js";
import { parseWorktreeList, type WorktreeRecord } from "../parse/worktree.js";
import {
  planForEachRef,
  planLsFilesStage,
  planStashList,
  planWorktreeList,
} from "../plan/status.js";
import {
  planLsTreeEntry,
  planRemotes,
  planSubmoduleConfig,
} from "../plan/refs.js";
import {
  boundedDiagnostic,
  GitWorkflowError,
  parseFailure,
  runMeaningfulExit,
  runRequired,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { planRepositoryClone, planRepositoryInit } from "../plan/repository.js";
import type { GitCommandSpec, GitTermination } from "../ports.js";
import { unsafeRemoteUrlReason } from "../validate/remote-url.js";

/* --------------------------------------------------------------------- refs */

export interface RefFacts {
  readonly refs: readonly RefRecord[];
  readonly remotes: readonly {
    readonly name: string;
    readonly fetchUrl: string;
    readonly pushUrl: string | null;
  }[];
}

/** Branches, remote-tracking refs, tags and remotes, in one pass each. */
export async function readRefFacts(
  engine: GitEngine,
  input: { readonly cwdHandle: string; readonly maxEntries?: number },
): Promise<RefFacts> {
  const refSpec = planForEachRef({ cwdHandle: input.cwdHandle });
  let refs: readonly RefRecord[];
  try {
    refs = parseForEachRef(
      await runRequired(engine, refSpec),
      input.maxEntries === undefined ? {} : { maxEntries: input.maxEntries },
    );
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(refSpec.description, error);
  }

  const remoteSpec = planRemotes({ cwdHandle: input.cwdHandle });
  const remoteBytes = await runRequired(engine, remoteSpec);
  let records;
  try {
    records = parseRemoteList(remoteBytes);
  } catch (error) {
    throw parseFailure(remoteSpec.description, error);
  }

  const byName = new Map<
    string,
    { name: string; fetchUrl: string; pushUrl: string | null }
  >();
  for (const record of records) {
    const existing = byName.get(record.name);
    if (record.kind === "fetch") {
      byName.set(record.name, {
        name: record.name,
        fetchUrl: record.url,
        pushUrl: existing?.pushUrl ?? null,
      });
    } else {
      byName.set(record.name, {
        name: record.name,
        fetchUrl: existing?.fetchUrl ?? record.url,
        pushUrl: record.url,
      });
    }
  }
  return { refs, remotes: [...byName.values()] };
}

/** The object a ref points at after peeling annotated tags. */
export function tipOids(refs: readonly RefRecord[], limit: number): string[] {
  const heads = refs
    .filter((ref) => ref.refName.startsWith("refs/heads/"))
    .map((ref) => ({ refName: ref.refName, oid: ref.peeledOid ?? ref.oid }));
  const remotes = refs
    .filter((ref) => ref.refName.startsWith("refs/remotes/"))
    .map((ref) => ({ refName: ref.refName, oid: ref.peeledOid ?? ref.oid }));
  // Sorted by ref name, then de-duplicated: two refs pointing at the same commit
  // are one tip for `rev-list`, and passing it twice would skew the page.
  const ordered = [...heads, ...remotes].sort((a, b) =>
    a.refName < b.refName ? -1 : a.refName > b.refName ? 1 : 0,
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tip of ordered) {
    if (seen.has(tip.oid)) {
      continue;
    }
    seen.add(tip.oid);
    result.push(tip.oid);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

/* ----------------------------------------------------------------- worktrees */

/** Worktree list as Git reports it, with raw path bytes. */
export async function readWorktreeFacts(
  engine: GitEngine,
  input: { readonly cwdHandle: string },
): Promise<readonly WorktreeRecord[]> {
  const spec = planWorktreeList({ cwdHandle: input.cwdHandle });
  try {
    return parseWorktreeList(await runRequired(engine, spec));
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(spec.description, error);
  }
}

/* ---------------------------------------------------------------- submodules */

export interface SubmoduleConfigEntry {
  readonly name: string;
  readonly path: string;
  readonly url: string;
  readonly branch: string | null;
}

export interface SubmoduleFacts {
  /** Configured submodules from `.gitmodules`, keyed by name. */
  readonly configured: readonly SubmoduleConfigEntry[];
  /**
   * Index entries whose mode is a gitlink.
   *
   * They keep raw path bytes, and the caller identifies each one by the `pathId` it
   * mints for those bytes. Keying them by decoded text here would make a path that
   * is not valid UTF-8 unreachable — or worse, collide with another path after a
   * lossy decode.
   */
  readonly gitlinks: readonly IndexEntry[];
}

/**
 * Read the parent repository's submodule facts.
 *
 * Three separate sources are kept separate on purpose — what the configuration
 * says, what the index records, and (later, from the submodule itself) what is
 * actually checked out. Collapsing them into one "up to date" flag is what makes a
 * submodule UI lie.
 *
 * `hasGitmodulesFile` comes from the host: Git reports a missing config file as an
 * error, and "this repository has no submodules" is an ordinary answer that must
 * not be dressed up as one.
 */
export async function readSubmoduleFacts(
  engine: GitEngine,
  input: { readonly cwdHandle: string; readonly hasGitmodulesFile: boolean },
): Promise<SubmoduleFacts> {
  let configured: SubmoduleConfigEntry[] = [];
  if (input.hasGitmodulesFile) {
    const spec = planSubmoduleConfig({ cwdHandle: input.cwdHandle });
    const bytes = await runMeaningfulExit(engine, spec, [1]);
    if (bytes !== null) {
      try {
        configured = submodulesFromConfig(parseConfigEntries(bytes));
        assertSafeSubmoduleUrls(configured, spec.description);
      } catch (error) {
        throw parseFailure(spec.description, error);
      }
    }
  }

  const indexSpec = planLsFilesStage({ cwdHandle: input.cwdHandle });
  let entries: readonly IndexEntry[];
  try {
    entries = parseLsFilesStage(await runRequired(engine, indexSpec));
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(indexSpec.description, error);
  }

  return { configured, gitlinks: entries.filter((entry) => entry.gitlink) };
}

/** Validate repository-local submodule URLs before any submodule operation uses them. */
export async function assertSafeSubmoduleConfig(
  engine: GitEngine,
  input: { readonly cwdHandle: string },
): Promise<void> {
  const spec = planSubmoduleConfig(input);
  const bytes = await runMeaningfulExit(engine, spec, [1]);
  if (bytes === null) {
    return;
  }
  let configured: readonly SubmoduleConfigEntry[];
  try {
    configured = submodulesFromConfig(parseConfigEntries(bytes));
  } catch (error) {
    throw parseFailure(spec.description, error);
  }
  assertSafeSubmoduleUrls(configured, spec.description);
}

function assertSafeSubmoduleUrls(
  configured: readonly SubmoduleConfigEntry[],
  command: string,
): void {
  for (const entry of configured) {
    if (entry.url.length === 0) {
      continue;
    }
    const reason = unsafeRemoteUrlReason(entry.url);
    if (reason !== null) {
      throw new GitWorkflowError({
        code: "GitCommandFailed",
        command,
        message: `submodule ${entry.name} has an unsafe configured URL: ${reason}`,
      });
    }
  }
}

/** Group `submodule.<name>.<key>` config entries into one record per submodule. */
export function submodulesFromConfig(
  entries: readonly ConfigEntry[],
): SubmoduleConfigEntry[] {
  const byName = new Map<
    string,
    { name: string; path: string; url: string; branch: string | null }
  >();
  for (const entry of entries) {
    const match = /^submodule\.(.+)\.(path|url|branch)$/.exec(entry.key);
    if (match === null) {
      continue;
    }
    const name = match[1];
    const key = match[2];
    if (name === undefined || key === undefined) {
      continue;
    }
    const current = byName.get(name) ?? {
      name,
      path: "",
      url: "",
      branch: null,
    };
    const value = decodeLenient(entry.value);
    if (key === "path") {
      current.path = value;
    } else if (key === "url") {
      current.url = value;
    } else {
      current.branch = value;
    }
    byName.set(name, current);
  }
  return [...byName.values()].filter(
    (entry) => entry.path.length > 0 || entry.url.length > 0,
  );
}

/**
 * The object a commit recorded for a submodule path.
 *
 * Missing from the tree (a new submodule not yet committed) is reported as null
 * rather than as an error: the three-object display exists to show that state.
 */
export async function readRecordedGitlinkOid(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly revision: string;
    readonly path: string;
  },
): Promise<string | null> {
  const spec = planLsTreeEntry(
    { cwdHandle: input.cwdHandle },
    { revision: input.revision, path: input.path },
  );
  const bytes = await runRequired(engine, spec);
  let entries;
  try {
    entries = parseLsTree(bytes);
  } catch (error) {
    throw parseFailure(spec.description, error);
  }
  const entry = entries[0];
  if (entry === undefined) {
    return null;
  }
  if (entry.objectType !== "commit" || entry.mode !== "160000") {
    throw new GitWorkflowError({
      code: "ObjectMissing",
      command: spec.description,
      message: `${input.path} is a ${entry.objectType} (mode ${entry.mode}), not a gitlink`,
    });
  }
  return entry.oid;
}

/* ------------------------------------------------------------------- stashes */

export interface StashFacts {
  readonly locator: string;
  readonly oid: string;
  /** The message without Git's `On <branch>: ` prefix, when it has one. */
  readonly messageBytes: Uint8Array;
  readonly branchBytes: Uint8Array | null;
  readonly createdAtSeconds: number;
}

/**
 * Read the stash list.
 *
 * The locator (`stash@{0}`) is where an entry sits right now and moves as stashes
 * are added or dropped, so it is always returned alongside the object name. A write
 * built from a bare locator would eventually act on a different stash.
 */
export async function readStashFacts(
  engine: GitEngine,
  input: { readonly cwdHandle: string; readonly maxEntries?: number },
): Promise<readonly StashFacts[]> {
  const spec = planStashList({ cwdHandle: input.cwdHandle });
  // No stash ref at all exits non-zero with empty output; that is "no stashes",
  // while any other failure is still an error.
  const bytes = await runMeaningfulExit(engine, spec, [1, 128]);
  if (bytes === null || bytes.byteLength === 0) {
    return [];
  }
  let records: readonly ReflogRecord[];
  try {
    records = parseReflog(
      bytes,
      input.maxEntries === undefined ? {} : { maxEntries: input.maxEntries },
    );
  } catch (error) {
    throw parseFailure(spec.description, error);
  }
  return records.map((record) => {
    const split = splitStashSubject(record.subjectBytes);
    return {
      locator: record.locator,
      oid: record.oid,
      messageBytes: split.messageBytes,
      branchBytes: split.branchBytes,
      createdAtSeconds: record.timestamp,
    };
  });
}

/**
 * Split Git's stash subject into the branch it was made on and the user's message.
 *
 * Git writes `On <branch>: <message>` (or `WIP on <branch>: …`). The split is done
 * on bytes with ASCII markers so a message that is not valid UTF-8 survives; when
 * the shape is not recognised the whole subject is the message and the branch is
 * unknown, rather than a guess.
 */
export function splitStashSubject(subjectBytes: Uint8Array): {
  readonly branchBytes: Uint8Array | null;
  readonly messageBytes: Uint8Array;
} {
  const prefix = matchAsciiPrefix(subjectBytes, ["On ", "WIP on "]);
  if (prefix === null) {
    return { branchBytes: null, messageBytes: subjectBytes };
  }
  const separator = indexOfAscii(subjectBytes, ": ", prefix);
  if (separator === -1) {
    return { branchBytes: null, messageBytes: subjectBytes };
  }
  return {
    branchBytes: subjectBytes.subarray(prefix, separator),
    messageBytes: subjectBytes.subarray(separator + 2),
  };
}

function matchAsciiPrefix(
  bytes: Uint8Array,
  candidates: readonly string[],
): number | null {
  for (const candidate of candidates) {
    if (bytes.byteLength < candidate.length) {
      continue;
    }
    let matches = true;
    for (let index = 0; index < candidate.length; index += 1) {
      if (bytes[index] !== candidate.charCodeAt(index)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return candidate.length;
    }
  }
  return null;
}

function indexOfAscii(bytes: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  for (
    let index = from;
    index + needle.length <= bytes.byteLength;
    index += 1
  ) {
    if (bytes[index] !== first) {
      continue;
    }
    let matches = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle.charCodeAt(offset)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return index;
    }
  }
  return -1;
}

function decodeLenient(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

/* ---------------------------------------------------------------- creation */

/**
 * What a destination looks like on disk, as the host reports it.
 *
 * `empty` and `nonEmpty` are deliberately distinct from `absent`: `git clone` refuses
 * a destination that exists and holds anything, but accepts one that exists and is
 * empty, and a refusal is only a refusal when the command was the thing that did not
 * happen.
 */
export type DestinationState = "absent" | "empty" | "nonEmpty";

/** Injected by the host: reading a directory is I/O, which core does not do. */
export type ObserveDestination = (
  destination: string,
) => Promise<DestinationState>;

interface CreationFailure {
  readonly code: GitFailureCode;
  readonly exitCode: number | null;
  readonly diagnostic: string;
}

/**
 * How a creation command ended, with the destination state that came with it.
 *
 * - `refused`: Git exited non-zero and the destination holds what it held before —
 *   a refusal, with Git's own diagnostic as the reason;
 * - `leftBehind`: Git exited non-zero and the destination now holds something it did
 *   not hold before. This is not "failed": a retry into that directory is no longer
 *   the same operation, and nothing here removes what the user chose;
 * - `uncertain`: the process was killed, timed out or produced no usable result. What
 *   is on disk is a fact and travels with the outcome; whether the command finished
 *   is not known, and the caller must not retry.
 */
export type CreationOutcome =
  | { readonly kind: "done"; readonly destinationAfter: DestinationState }
  | ({
      readonly kind: "refused";
      readonly destinationAfter: DestinationState;
    } & CreationFailure)
  | ({
      readonly kind: "leftBehind";
      readonly destinationAfter: DestinationState;
    } & CreationFailure)
  | ({
      readonly kind: "uncertain";
      readonly destinationAfter: DestinationState;
    } & CreationFailure);

function failureCodeOf(termination: GitTermination): GitFailureCode {
  switch (termination) {
    case "timeout":
      return "GitTimedOut";
    case "signal":
      return "GitTerminatedBySignal";
    case "output-limit":
      return "GitOutputLimitExceeded";
    case "spawn-error":
      return "GitNotStarted";
    default:
      return "GitCommandFailed";
  }
}

/**
 * Run one creation command and classify it.
 *
 * The destination is observed before and after: that pair is what separates "Git
 * refused" from "Git left a half-written directory", and both are reported without
 * cleaning anything up. A killed process is `uncertain` regardless of what it left,
 * because a timeout says nothing about how far it got.
 */
async function runCreation(
  engine: GitEngine,
  spec: GitCommandSpec,
  input: {
    readonly destination: string;
    readonly observeDestination: ObserveDestination;
  },
): Promise<CreationOutcome> {
  const before = await input.observeDestination(input.destination);
  const result = await engine.run(spec);
  const after = await input.observeDestination(input.destination);
  const diagnostic = boundedDiagnostic(result.stderr);

  if (result.termination === "exit" && result.exitCode === 0) {
    return { kind: "done", destinationAfter: after };
  }
  if (result.termination !== "exit") {
    return {
      kind: "uncertain",
      destinationAfter: after,
      code: failureCodeOf(result.termination),
      exitCode: result.exitCode,
      diagnostic,
    };
  }
  const failure = {
    destinationAfter: after,
    code: "GitCommandFailed" as const,
    exitCode: result.exitCode,
    diagnostic,
  };
  // Something that was not there before survived the failure. Only a destination
  // that was `absent` or `empty` before can have gained content from this command.
  if (before !== "nonEmpty" && after === "nonEmpty") {
    return { kind: "leftBehind", ...failure };
  }
  return { kind: "refused", ...failure };
}

/** `git init`, classified by what the destination holds afterwards. */
export async function initRepository(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly destination: string;
    readonly initialBranch: string | null;
    readonly observeDestination: ObserveDestination;
  },
): Promise<CreationOutcome> {
  return runCreation(
    engine,
    planRepositoryInit(
      { cwdHandle: input.cwdHandle },
      { destination: input.destination, initialBranch: input.initialBranch },
    ),
    input,
  );
}

/** `git clone`, classified by what the destination holds afterwards. */
export async function cloneRepository(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly remoteUrl: string;
    readonly destination: string;
    readonly initializeSubmodules: boolean;
    readonly observeDestination: ObserveDestination;
  },
): Promise<CreationOutcome> {
  return runCreation(
    engine,
    planRepositoryClone(
      { cwdHandle: input.cwdHandle },
      {
        remoteUrl: input.remoteUrl,
        destination: input.destination,
        initializeSubmodules: input.initializeSubmodules,
      },
    ),
    input,
  );
}
