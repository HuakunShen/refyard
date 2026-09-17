/**
 * History reads: topology, commit bodies, decoration and boundary facts.
 *
 * The paging model is the part worth reading twice. A history page is served from
 * a **snapshot**: the set of tips it started with, captured once. Continuing with a
 * cursor re-runs `rev-list` against those same tips, so a page that took a while to
 * arrive cannot silently interleave commits from a branch that moved underneath it.
 * The caller is told `tipsMoved` instead, and decides whether to offer a refresh.
 *
 * Two facts are computed rather than guessed:
 *
 * - **Boundary and missing parents.** A shallow clone and a partially fetched
 *   repository both produce rows whose parents are not present locally. Drawing
 *   those as roots would show a truncated history as a complete one, so every
 *   parent outside the page is checked with `cat-file --batch-check`; only the ones
 *   Git confirms absent are marked.
 * - **Decoration.** Ref names per commit come from the refs read of the same
 *   snapshot, not from `git log --decorate`, so a ref that moved between the two
 *   reads cannot decorate an unrelated commit.
 */
import { CORE_LIMITS } from "../bytes/limits.js";
import {
  CatFileDecoder,
  isMissingEntry,
  parseCommitObject,
} from "../parse/cat-file.js";
import {
  parseCommitCandidates,
  parseDisambiguatedOids,
  parseObjectPresence,
  parseRevListTopology,
} from "../parse/meta.js";
import {
  planCatFileExists,
  planCatFileObjectTypes,
  planDisambiguateCommitPrefix,
  planIsCommitAncestor,
} from "../plan/refs.js";
import {
  planCatFileBatch,
  planRevList,
  type HistoryFilters,
} from "../plan/status.js";
import {
  GitWorkflowError,
  parseFailure,
  runRequired,
  runMeaningfulExit,
  type GitEngine,
} from "./engine.js";

export interface TopologyRow {
  readonly oid: string;
  readonly parentOids: readonly string[];
  readonly boundary: boolean;
}

/** Everything a commit body carries, independent of where it appeared. */
export interface CommitBodyFacts {
  readonly parents: readonly string[];
  readonly treeOid: string;
  readonly subjectBytes: Uint8Array;
  readonly messageBytes: Uint8Array;
  readonly authorNameBytes: Uint8Array;
  readonly authorEmailBytes: Uint8Array;
  readonly authoredAtSeconds: number;
  readonly authorTimezone: string;
  readonly committerNameBytes: Uint8Array;
  readonly committerEmailBytes: Uint8Array;
  readonly committedAtSeconds: number;
  readonly committerTimezone: string;
  readonly encoding: string | null;
  readonly signed: boolean;
}

/** One row of a page: the body joined with the graph facts around it. */
export interface CommitFacts extends CommitBodyFacts {
  readonly oid: string;
  /** True when Git marked a boundary, or when a named parent is absent locally. */
  readonly boundary: boolean;
  readonly missingParents: readonly string[];
  readonly refNames: readonly string[];
}

export interface HistoryPageFacts {
  readonly rows: readonly TopologyRow[];
  readonly commits: readonly CommitFacts[];
  /** Names the page asked for and Git could not produce. */
  readonly missingObjects: readonly string[];
  /** The tips this page was served from; the caller pins them in a snapshot. */
  readonly tips: readonly string[];
}

/**
 * Read one page of topology.
 *
 * Tips are object names (never ref names): a snapshot that pinned `HEAD` would
 * follow the branch when it moved, which is exactly the interleaving the snapshot
 * exists to prevent.
 */
export async function readTopologyPage(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly tips: readonly string[];
    readonly maxCount: number;
    readonly skip: number;
    readonly firstParentOnly?: boolean;
    readonly onlyOid?: string;
  } & HistoryFilters,
): Promise<readonly TopologyRow[]> {
  const spec = planRevList({ cwdHandle: input.cwdHandle }, input);
  try {
    return parseRevListTopology(await runRequired(engine, spec));
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(spec.description, error);
  }
}

/**
 * Read the commit bodies for a set of object names.
 *
 * One `cat-file --batch` call reads them all through the length-framed protocol, so
 * a message containing a quote, a newline or a backslash arrives intact. Names Git
 * could not find come back separately instead of being dropped.
 */
export async function readCommitBodies(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly oids: readonly string[];
  },
): Promise<{
  readonly bodies: readonly CommitBodyFacts[];
  readonly missing: readonly string[];
}> {
  if (input.oids.length === 0) {
    return { bodies: [], missing: [] };
  }
  const spec = planCatFileBatch({ cwdHandle: input.cwdHandle }, input.oids);
  const decoder = new CatFileDecoder();
  let entries;
  try {
    entries = decoder.push(await runRequired(engine, spec));
    decoder.finish();
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(spec.description, error);
  }

  const missing: string[] = [];
  const bodies: CommitBodyFacts[] = [];
  for (const entry of entries) {
    if (isMissingEntry(entry)) {
      missing.push(entry.missing);
      continue;
    }
    if (entry.type !== "commit") {
      throw new GitWorkflowError({
        code: "ObjectMissing",
        command: spec.description,
        message: `${entry.oid} is a ${entry.type}, not a commit`,
      });
    }
    bodies.push(commitBodyFacts(entry.body));
  }
  return { bodies, missing };
}

/** The portable facts for one raw commit body. */
export function commitBodyFacts(body: Uint8Array): CommitBodyFacts {
  const parsed = parseCommitObject(body);
  return {
    parents: parsed.parentOids,
    treeOid: parsed.treeOid,
    subjectBytes: firstLineBytes(parsed.messageBytes),
    messageBytes: parsed.messageBytes,
    authorNameBytes: parsed.author.nameBytes,
    authorEmailBytes: parsed.author.emailBytes,
    authoredAtSeconds: parsed.author.timestamp,
    authorTimezone: parsed.author.timezoneOffset,
    committerNameBytes: parsed.committer.nameBytes,
    committerEmailBytes: parsed.committer.emailBytes,
    committedAtSeconds: parsed.committer.timestamp,
    committerTimezone: parsed.committer.timezoneOffset,
    encoding: parsed.encoding,
    signed: parsed.signed,
  };
}

/**
 * Ask Git which of these object names are present.
 *
 * This distinguishes "not loaded yet" (present, so the UI may page towards it) from
 * "missing" (a shallow or partially fetched repository, which must be drawn as a
 * boundary). A name Git did not answer for at all counts as missing: reporting it
 * as present would hide a boundary, and this read exists precisely to avoid that.
 */
export async function findMissingObjects(
  engine: GitEngine,
  input: { readonly cwdHandle: string; readonly oids: readonly string[] },
): Promise<readonly string[]> {
  const unique = [...new Set(input.oids)];
  if (unique.length === 0) {
    return [];
  }
  const bounded = unique.slice(0, CORE_LIMITS.refListMaxEntries);
  const spec = planCatFileExists({ cwdHandle: input.cwdHandle }, bounded);
  const bytes = await runRequired(engine, spec);
  try {
    const { present, missing } = parseObjectPresence(bytes, bounded);
    const answered = new Set(present);
    for (const oid of missing) {
      answered.add(oid);
    }
    return bounded.filter((oid) => !answered.has(oid) || missing.includes(oid));
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      throw error;
    }
    throw parseFailure(spec.description, error);
  }
}

/** Decoration map: object name to the ref names pointing at it. */
export function decorationMap(
  refs: readonly {
    readonly refName: string;
    readonly oid: string;
    readonly peeledOid: string | null;
  }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const ref of refs) {
    const target = ref.peeledOid ?? ref.oid;
    const list = map.get(target);
    if (list === undefined) {
      map.set(target, [ref.refName]);
    } else {
      list.push(ref.refName);
    }
  }
  return map;
}

/** Compose one page: topology, bodies, decoration and boundary facts. */
export async function readHistoryPage(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly tips: readonly string[];
    readonly maxCount: number;
    readonly skip: number;
    readonly firstParentOnly?: boolean;
    readonly decoration: ReadonlyMap<string, readonly string[]>;
    readonly onlyOid?: string;
  } & HistoryFilters,
): Promise<HistoryPageFacts> {
  const rows = await readTopologyPage(engine, input);

  const pageOids = new Set(rows.map((row) => row.oid));
  const { bodies, missing: missingObjects } = await readCommitBodies(engine, {
    cwdHandle: input.cwdHandle,
    oids: rows.map((row) => row.oid),
  });
  const bodyByOid = new Map(
    rows.map((row, index) => [row.oid, bodies[index]] as const),
  );

  // The commit object is the authority on its own parents. `rev-list` omits them
  // for a grafted commit — a shallow clone's boundary commit is printed with no
  // parents at all, and `--boundary` does not mark it — so reading the parents from
  // the object is the only way to notice that the walk stopped early. Without this,
  // a truncated history would be drawn as if its oldest row were a root.
  const parentsOf = (row: TopologyRow): readonly string[] => {
    const body = bodyByOid.get(row.oid);
    if (body !== undefined) {
      return body.parents;
    }
    return row.parentOids;
  };

  const outsideParents = rows.flatMap((row) =>
    parentsOf(row).filter((parent) => !pageOids.has(parent)),
  );
  const absentParents =
    outsideParents.length === 0
      ? []
      : await findMissingObjects(engine, {
          cwdHandle: input.cwdHandle,
          oids: outsideParents,
        });
  const absent = new Set(absentParents);

  const commits: CommitFacts[] = rows.map((row) => {
    const body = bodyByOid.get(row.oid);
    if (body === undefined) {
      throw new GitWorkflowError({
        code: "ObjectMissing",
        command: "cat-file --batch",
        message: `the page named ${row.oid} but no body came back for it`,
      });
    }
    const parents = parentsOf(row);
    const parentsMissing = parents.filter((parent) => absent.has(parent));
    return {
      ...body,
      oid: row.oid,
      parents,
      // `boundary` means "this row's history is cut here": Git marked it, or a
      // parent the object names is not in this repository.
      boundary: row.boundary || parentsMissing.length > 0,
      missingParents: parentsMissing,
      refNames: input.decoration.get(row.oid) ?? [],
    };
  });

  return { rows, commits, missingObjects, tips: input.tips };
}

function firstLineBytes(bytes: Uint8Array): Uint8Array {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) {
      return bytes.subarray(0, index);
    }
  }
  return bytes;
}

/** Resolve only commit objects; a noncommit match does not locate a commit. */
export async function resolveCommitPrefix(
  engine: GitEngine,
  input: { readonly cwdHandle: string; readonly prefix: string },
): Promise<
  | "none"
  | { readonly kind: "one"; readonly oid: string }
  | { readonly kind: "ambiguous" }
> {
  const context = { cwdHandle: input.cwdHandle };
  const enumeration = planDisambiguateCommitPrefix(context, input.prefix);
  try {
    const candidates = parseDisambiguatedOids(
      await runRequired(engine, enumeration),
      CORE_LIMITS.refListMaxEntries,
    );
    if (candidates.length === 0) return "none";
    const check = planCatFileObjectTypes(context, candidates);
    const commits = parseCommitCandidates(
      await runRequired(engine, check),
      candidates,
    );
    const oid = commits[0];
    if (oid === undefined) return "none";
    return commits.length === 1 ? { kind: "one", oid } : { kind: "ambiguous" };
  } catch (error) {
    if (error instanceof GitWorkflowError) throw error;
    throw parseFailure(enumeration.description, error);
  }
}

/** Only Git exit 1 is a negative ancestry answer; every other failure propagates. */
export async function isCommitReachableFrom(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly ancestorOid: string;
    readonly descendantOid: string;
  },
): Promise<boolean> {
  return (
    (await runMeaningfulExit(
      engine,
      planIsCommitAncestor(
        { cwdHandle: input.cwdHandle },
        input.ancestorOid,
        input.descendantOid,
      ),
      [1],
    )) !== null
  );
}
