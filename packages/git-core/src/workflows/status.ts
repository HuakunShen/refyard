/**
 * Status and repository layout, as portable facts.
 *
 * This is the read every screen depends on, so the shape of the answer is chosen
 * carefully:
 *
 * - **Paths stay bytes.** Status records carry raw path bytes; display text is the
 *   host codec's job, and a mutation input is a `pathId`, never a decoded string.
 * - **`unborn` is a state, not an error.** A repository with no commits reports
 *   `kind: "unborn"` with a branch name and no object name, because "there is
 *   nothing here yet" is a normal answer that the UI renders as such.
 * - **Operation state comes from markers the host observed.** `merge`,
 *   `rebase`, `cherry-pick` and friends are decided by which files exist in the
 *   Git directory, so the host passes the marker names it saw and this module maps
 *   them. Core never guesses from status text.
 * - **Layout is read separately and honestly.** The first layout read is the full
 *   one; in a repository with no working tree Git refuses `--show-toplevel`, so the
 *   bare-safe form is used and the answer says `bare: true` instead of leaving the
 *   top level as an unexplained empty string.
 */
import { parseStatus, type StatusRecord } from "../parse/status.js";
import {
  planHeadOid,
  planHeadRef,
  planRepositoryLayout,
  planStatus,
} from "../plan/status.js";
import {
  GitWorkflowError,
  parseFailure,
  runMeaningfulExit,
  runRequired,
  type GitEngine,
} from "./engine.js";

export type ObjectFormat = "sha1" | "sha256";

export type OperationInProgress =
  | "merge"
  | "cherry-pick"
  | "revert"
  | "rebase"
  | "bisect"
  | "apply-mailbox"
  | "unknown";

export interface LayoutFacts {
  readonly gitDir: string;
  readonly commonDir: string;
  readonly topLevel: string | null;
  readonly bare: boolean;
  readonly shallow: boolean;
  readonly objectFormat: ObjectFormat;
}

export interface HeadFacts {
  readonly kind: "born" | "unborn";
  readonly branchName: string | null;
  readonly oid: string | null;
  readonly detached: boolean;
}

export interface StatusFacts {
  readonly layout: LayoutFacts;
  readonly head: HeadFacts;
  readonly upstream: {
    readonly name: string;
    readonly ahead: number;
    readonly behind: number;
  } | null;
  readonly operationInProgress: OperationInProgress | null;
  readonly records: readonly StatusRecord[];
  readonly stashCount: number | null;
}

/** Git directory markers, mapped to the operation they mean. */
const OPERATION_MARKERS: Readonly<Record<string, OperationInProgress>> = {
  MERGE_HEAD: "merge",
  CHERRY_PICK_HEAD: "cherry-pick",
  REVERT_HEAD: "revert",
  "rebase-merge": "rebase",
  "rebase-apply": "rebase",
  BISECT_LOG: "bisect",
};

/**
 * Map observed marker file names to an operation state.
 *
 * An unknown marker name is reported as `unknown` rather than ignored: a
 * repository in a state this version does not model must still stop the UI from
 * offering a commit that Git would refuse.
 */
export function operationFromMarkers(
  markers: readonly string[],
): OperationInProgress | null {
  if (markers.length === 0) {
    return null;
  }
  for (const marker of markers) {
    const known = OPERATION_MARKERS[marker];
    if (known !== undefined) {
      return known;
    }
  }
  return "unknown";
}

/** Parse the six (or five, in a worktree-less repository) layout lines. */
export function parseLayoutOutput(
  bytes: Uint8Array,
  options: { readonly topLevelRequested: boolean },
): LayoutFacts {
  const text = decodeAsciiText(bytes, "rev-parse layout");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const expected = options.topLevelRequested ? 6 : 5;
  if (lines.length !== expected) {
    throw new GitWorkflowError({
      code: "GitOutputIncomplete",
      command: "rev-parse layout",
      message: `expected ${expected} layout lines but found ${lines.length}`,
    });
  }
  const [gitDir, commonDir, ...rest] = lines;
  const bareIndex = options.topLevelRequested ? 1 : 0;
  const topLevel = options.topLevelRequested ? (rest[0] ?? null) : null;
  const bare = rest[bareIndex];
  const objectFormat = rest[bareIndex + 1];
  const shallow = rest[bareIndex + 2];
  if (
    gitDir === undefined ||
    commonDir === undefined ||
    bare === undefined ||
    objectFormat === undefined ||
    shallow === undefined
  ) {
    throw new GitWorkflowError({
      code: "GitOutputIncomplete",
      command: "rev-parse layout",
      message: "layout output was missing a field",
    });
  }
  return {
    gitDir,
    commonDir,
    topLevel: topLevel === "" ? null : topLevel,
    bare: bare === "true",
    shallow: shallow === "true",
    objectFormat: objectFormat === "sha256" ? "sha256" : "sha1",
  };
}

/**
 * Read the repository layout.
 *
 * The full form is tried first. A bare repository answers with an error from
 * `--show-toplevel`, so the bare-safe form is then read; if that also fails the
 * original error is reported, because "the layout could not be read" is the truth.
 */
export async function readLayout(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
): Promise<LayoutFacts> {
  const full = planRepositoryLayout(context);
  try {
    return parseLayoutOutput(await runRequired(engine, full), {
      topLevelRequested: true,
    });
  } catch (error) {
    if (
      !(error instanceof GitWorkflowError) ||
      error.code !== "GitCommandFailed"
    ) {
      throw error;
    }
    const bareSafe = planRepositoryLayout(context, { omitTopLevel: true });
    const bytes = await runRequired(engine, bareSafe);
    const layout = parseLayoutOutput(bytes, { topLevelRequested: false });
    if (!layout.bare) {
      // A non-bare repository whose top level cannot be read is a real failure:
      // reporting it as bare would hide the working tree from every later read.
      throw error;
    }
    return layout;
  }
}

/** Read status and lay it over the repository's identity facts. */
export async function readStatusFacts(
  engine: GitEngine,
  input: {
    readonly cwdHandle: string;
    readonly layout: LayoutFacts;
    readonly operationMarkers: readonly string[];
    readonly includeIgnored?: boolean;
  },
): Promise<StatusFacts> {
  const spec = planStatus(
    { cwdHandle: input.cwdHandle },
    {
      includeIgnored: input.includeIgnored === true,
    },
  );
  let parsed;
  try {
    parsed = parseStatus(await runRequired(engine, spec));
  } catch (error) {
    throw parseFailure(spec.description, error);
  }

  if (!parsed.branch.seen) {
    // Every status read this service issues passes `--branch`; without the headers
    // the answer cannot say what HEAD is, and reporting a default would invent it.
    throw new GitWorkflowError({
      code: "GitOutputIncomplete",
      command: spec.description,
      message: "status output carried no branch headers",
    });
  }

  return {
    layout: input.layout,
    head: headFromStatusBranch(parsed.branch),
    upstream:
      parsed.upstream === null || parsed.aheadBehind === null
        ? null
        : {
            name: parsed.upstream,
            ahead: parsed.aheadBehind.ahead,
            behind: parsed.aheadBehind.behind,
          },
    operationInProgress: operationFromMarkers(input.operationMarkers),
    records: parsed.records,
    stashCount: parsed.stashCount,
  };
}

/**
 * HEAD as status reported it.
 *
 * The branch header is the authoritative source here — it already distinguishes
 * unborn from detached, so a second `symbolic-ref` call would only add a way for
 * the two to disagree.
 */
export function headFromStatusBranch(branch: {
  readonly initial: boolean;
  readonly detached: boolean;
  readonly oid: string | null;
  readonly head: string | null;
}): HeadFacts {
  if (branch.initial) {
    return {
      kind: "unborn",
      branchName: branch.head,
      oid: null,
      detached: false,
    };
  }
  return {
    kind: "born",
    branchName: branch.detached ? null : branch.head,
    oid: branch.oid,
    detached: branch.detached,
  };
}

/**
 * HEAD as the registry needs it, before any status read exists.
 *
 * `symbolic-ref --quiet HEAD` exits 1 for a detached HEAD, which is a fact rather
 * than a failure, and `rev-parse --verify --quiet HEAD` exits 1 in a repository
 * with no commits — also a fact, and the reason `kind: "unborn"` exists.
 */
export async function readHeadFacts(
  engine: GitEngine,
  cwdHandle: string,
): Promise<HeadFacts> {
  const branchRef = await runMeaningfulExit(
    engine,
    planHeadRef({ cwdHandle }),
    [1],
  );
  if (branchRef === null) {
    const oid = await runMeaningfulExit(
      engine,
      planHeadOid({ cwdHandle }),
      [1],
    );
    return {
      kind: oid === null ? "unborn" : "born",
      branchName: null,
      oid: oid === null ? null : decodeAsciiText(oid, "rev-parse HEAD").trim(),
      detached: true,
    };
  }
  const branchRefName = decodeAsciiText(branchRef, "symbolic-ref HEAD").trim();
  const headOid = await runMeaningfulExit(
    engine,
    planHeadOid({ cwdHandle }),
    [1],
  );
  return {
    kind: headOid === null ? "unborn" : "born",
    branchName: branchRefName.startsWith("refs/heads/")
      ? branchRefName.slice("refs/heads/".length)
      : branchRefName,
    oid:
      headOid === null
        ? null
        : decodeAsciiText(headOid, "rev-parse HEAD").trim(),
    detached: false,
  };
}

function decodeAsciiText(bytes: Uint8Array, format: string): string {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new GitWorkflowError({
        code: "GitOutputUnparsable",
        command: format,
        message: `${format}: unexpected non-ASCII byte in an ASCII field`,
      });
    }
    text += String.fromCharCode(byte);
  }
  return text;
}
