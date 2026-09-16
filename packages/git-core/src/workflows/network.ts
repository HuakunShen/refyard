/**
 * Remote and network workflows.
 *
 * The network half is where "what happened" is genuinely multi-part, and these
 * functions keep the parts separate rather than collapsing them:
 *
 * - a push yields the porcelain per-ref result — a rejected ref is not "the push
 *   failed", and an up-to-date ref is not "pushed";
 * - a pull reports remote-tracking updates *and* whether the working branch moved,
 *   because a fast-forward refusal happens after the fetch half already succeeded;
 * - a fetch reports which tracking refs moved, never a local branch change.
 *
 * A non-zero exit still carries the parsed output when Git produced one: `git push`
 * exits 1 for a rejected ref while printing the full porcelain table, and throwing
 * that away would turn a precise answer into a bare failure.
 */
import type { GitCommandSpec } from "../ports.js";
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import {
  parseFetchPorcelain,
  parsePushPorcelain,
  type FetchParseResult,
  type PushParseResult,
} from "../parse/network.js";
import {
  planBranchUpstreamRef,
  planFastForwardMerge,
  planFetch,
  planPush,
  planRemoteAdd,
  planRemoteRemove,
  planRemoteRename,
  planRemoteSetUrl,
} from "../plan/remotes.js";
import { parseRemoteList } from "../parse/meta.js";
import { planRemotes } from "../plan/refs.js";
import { unsafeRemoteUrlReason } from "../validate/remote-url.js";

export type CommandOutcome =
  | { readonly kind: "done" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

async function runQuiet(
  engine: GitEngine,
  spec: GitCommandSpec,
): Promise<CommandOutcome> {
  const result = await engine.run(spec);
  if (result.termination === "exit" && result.exitCode === 0) {
    return { kind: "done" };
  }
  return {
    kind: "refused",
    code: failureCodeOf(result.termination),
    exitCode: result.exitCode,
    diagnostic: boundedDiagnostic(result.stderr),
  };
}

function failureCodeOf(
  termination: GitCommandSpec["deadlineClass"] | string,
): GitFailureCode {
  switch (termination) {
    case "timeout":
      return "GitTimedOut";
    case "signal":
      return "GitTerminatedBySignal";
    case "spawn-error":
      return "GitNotStarted";
    case "output-limit":
      return "GitOutputLimitExceeded";
    default:
      return "GitCommandFailed";
  }
}

type RemoteSafety =
  | { readonly kind: "safe" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

/** Refuse hostile URLs already present in repository config before network Git runs. */
async function checkConfiguredRemote(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly name: string; readonly direction: "fetch" | "push" },
): Promise<RemoteSafety> {
  const spec = planRemotes(context);
  const result = await engine.run(spec);
  if (result.termination !== "exit" || result.exitCode !== 0) {
    return {
      kind: "refused",
      code: failureCodeOf(result.termination),
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    };
  }
  let records;
  try {
    records = parseRemoteList(result.stdout);
  } catch {
    return {
      kind: "refused",
      code: "GitOutputUnparsable",
      exitCode: result.exitCode,
      diagnostic: "the configured remote list could not be parsed safely",
    };
  }
  const matching = records.filter((record) => record.name === input.name);
  const fetchUrl = matching.find((record) => record.kind === "fetch")?.url;
  const pushUrl = matching.find((record) => record.kind === "push")?.url;
  const url = input.direction === "push" ? (pushUrl ?? fetchUrl) : fetchUrl;
  if (url === undefined) {
    return {
      kind: "refused",
      code: "GitCommandFailed",
      exitCode: null,
      diagnostic: `remote ${input.name} has no configured ${input.direction} URL`,
    };
  }
  const reason = unsafeRemoteUrlReason(url);
  if (reason !== null) {
    return {
      kind: "refused",
      code: "GitCommandFailed",
      exitCode: null,
      diagnostic: `remote ${input.name} has an unsafe configured URL: ${reason}`,
    };
  }
  return { kind: "safe" };
}

export async function addRemote(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly name: string;
    readonly fetchUrl: string;
    readonly pushUrl: string | null;
  },
): Promise<CommandOutcome> {
  const added = await runQuiet(engine, planRemoteAdd(context, input));
  if (added.kind === "refused" || input.pushUrl === null) {
    return added;
  }
  // The push URL is set in a second command; a failure there leaves the remote
  // added with a fetch URL only, and the caller reports that state honestly.
  return runQuiet(
    engine,
    planRemoteSetUrl(context, {
      name: input.name,
      url: input.pushUrl,
      push: true,
    }),
  );
}

export function updateRemote(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly name: string;
    readonly newName: string | null;
    readonly fetchUrl: string | null;
    readonly pushUrl: string | null;
  },
): Promise<CommandOutcome> {
  return (async (): Promise<CommandOutcome> => {
    let currentName = input.name;
    if (input.newName !== null) {
      const renamed = await runQuiet(
        engine,
        planRemoteRename(context, {
          name: currentName,
          newName: input.newName,
        }),
      );
      if (renamed.kind === "refused") {
        return renamed;
      }
      currentName = input.newName;
    }
    if (input.fetchUrl !== null) {
      const set = await runQuiet(
        engine,
        planRemoteSetUrl(context, {
          name: currentName,
          url: input.fetchUrl,
          push: false,
        }),
      );
      if (set.kind === "refused") {
        return set;
      }
    }
    if (input.pushUrl !== null) {
      return runQuiet(
        engine,
        planRemoteSetUrl(context, {
          name: currentName,
          url: input.pushUrl,
          push: true,
        }),
      );
    }
    return { kind: "done" };
  })();
}

export function removeRemote(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  name: string,
): Promise<CommandOutcome> {
  return runQuiet(engine, planRemoteRemove(context, name));
}

export type NetworkOutcome<TResult> =
  | { readonly kind: "done"; readonly result: TResult }
  | {
      readonly kind: "partial";
      readonly result: TResult;
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    }
  | { readonly kind: "uncertain"; readonly reason: string };

/** `git fetch --porcelain` — per-ref tracking updates, or an honest failure. */
export async function fetchRemote(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly remoteName: string;
    readonly prune: boolean;
    readonly tags: "none" | "following";
  },
): Promise<NetworkOutcome<FetchParseResult>> {
  const safety = await checkConfiguredRemote(engine, context, {
    name: input.remoteName,
    direction: "fetch",
  });
  if (safety.kind === "refused") {
    return safety;
  }
  const spec = planFetch(context, input);
  const result = await engine.run(spec);
  let parsed: FetchParseResult;
  try {
    parsed = parseFetchPorcelain(result.stdout);
  } catch {
    return {
      kind: "uncertain",
      reason: "git fetch produced output this build could not parse",
    };
  }
  if (result.termination === "exit" && result.exitCode === 0) {
    return { kind: "done", result: parsed };
  }
  return {
    kind: "refused",
    code: failureCodeOf(result.termination),
    exitCode: result.exitCode,
    diagnostic: boundedDiagnostic(result.stderr),
  };
}

/**
 * `git push --porcelain` — the per-ref table survives a non-zero exit.
 *
 * Git exits 1 when any ref was rejected while still printing the whole table, so a
 * parsed table with a non-zero exit is `partial`: the refs that moved are real, and
 * so is the refusal.
 */
export async function pushRef(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly remoteName: string;
    readonly sourceRef: string;
    readonly destinationRef: string;
    readonly setUpstream: boolean;
  },
): Promise<NetworkOutcome<PushParseResult>> {
  const safety = await checkConfiguredRemote(engine, context, {
    name: input.remoteName,
    direction: "push",
  });
  if (safety.kind === "refused") {
    return safety;
  }
  const spec = planPush(context, input);
  const result = await engine.run(spec);
  let parsed: PushParseResult;
  try {
    parsed = parsePushPorcelain(result.stdout);
  } catch {
    return {
      kind: "uncertain",
      reason: "git push produced output this build could not parse",
    };
  }
  if (result.termination === "exit" && result.exitCode === 0) {
    return { kind: "done", result: parsed };
  }
  if (parsed.refs.length > 0) {
    return {
      kind: "partial",
      result: parsed,
      code: failureCodeOf(result.termination),
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    };
  }
  return {
    kind: "refused",
    code: failureCodeOf(result.termination),
    exitCode: result.exitCode,
    diagnostic: boundedDiagnostic(result.stderr),
  };
}

export interface PullResult {
  /** Tracking refs that moved during the fetch half, from the porcelain output. */
  readonly fetchRefs: FetchParseResult["refs"];
  /** False when the branch could not be fast-forwarded (diverged or dirty). */
  readonly branchMoved: boolean;
}

/**
 * Pull, as its two real halves: fetch (per-ref porcelain) then fast-forward.
 *
 * The separation is the product requirement: a fetch that updated tracking refs and
 * a branch that could not be fast-forwarded are two facts, and `git pull`'s single
 * exit code cannot express both. The branch half only runs when the branch actually
 * tracks the remote the request named — pulling from an unrelated remote would
 * merge something the user did not ask for.
 */
export async function pullFastForward(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly remoteName: string; readonly branchName: string },
): Promise<NetworkOutcome<PullResult>> {
  // Which ref is "the branch's upstream" is Git's answer, not ours.
  const upstreamSpec = planBranchUpstreamRef(context, input.branchName);
  const upstreamResult = await engine.run(upstreamSpec);
  if (upstreamResult.termination !== "exit" || upstreamResult.exitCode !== 0) {
    return {
      kind: "refused",
      code: failureCodeOf(upstreamResult.termination),
      exitCode: upstreamResult.exitCode,
      diagnostic:
        boundedDiagnostic(upstreamResult.stderr).trim().length > 0
          ? boundedDiagnostic(upstreamResult.stderr)
          : `the branch ${input.branchName} has no upstream to pull from`,
    };
  }
  const upstreamRef = decodeAscii(upstreamResult.stdout);
  const upstreamRemote = upstreamRef.split("/")[0] ?? "";
  if (upstreamRemote !== input.remoteName) {
    return {
      kind: "refused",
      code: "GitCommandFailed",
      exitCode: null,
      diagnostic: `the branch ${input.branchName} tracks ${upstreamRef}, which is on ${upstreamRemote}; the pull named ${input.remoteName}`,
    };
  }

  const fetched = await fetchRemote(engine, context, {
    remoteName: input.remoteName,
    prune: false,
    tags: "none",
  });
  if (fetched.kind === "uncertain") {
    return fetched;
  }
  if (fetched.kind === "refused") {
    return fetched;
  }

  const mergeSpec = planFastForwardMerge(context, upstreamRef);
  const merged = await engine.run(mergeSpec);
  if (merged.termination === "exit" && merged.exitCode === 0) {
    return {
      kind: "done",
      result: { fetchRefs: fetched.result.refs, branchMoved: true },
    };
  }
  return {
    kind: "partial",
    result: { fetchRefs: fetched.result.refs, branchMoved: false },
    code: failureCodeOf(merged.termination),
    exitCode: merged.exitCode,
    diagnostic: boundedDiagnostic(merged.stderr),
  };
}

/**
 * ASCII-decode a one-line answer (`rev-parse` output). Core has no TextDecoder; the
 * values this decodes are ref names, which are ASCII by construction.
 */
function decodeAscii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte === 0x0a || byte === 0x0d) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text;
}
