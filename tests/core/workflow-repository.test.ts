/**
 * Classification for the two commands that create a repository.
 *
 * `git init` and `git clone` are the only writes whose *destination* did not exist
 * before the command ran, so "it failed" is not the whole answer: a failed clone can
 * leave a half-fetched directory behind, and reporting that as a plain failure would
 * invite a retry into a directory that is no longer empty. The rule these cases pin
 * down is a comparison — what the destination held before, what it holds after, and
 * how the process ended — with the ambiguous endings reported as unknown.
 *
 * A stub engine is used deliberately here: the interesting cases are a timeout and a
 * partial clone, and neither can be produced on demand with real Git.
 */
import { describe, expect, it } from "vitest";
import {
  cloneRepository,
  initRepository,
  type CreationOutcome,
  type DestinationState,
  type GitCommandSpec,
  type GitEngine,
  type GitRunResult,
} from "@refyard/git-core";

const encoder = new TextEncoder();

function exitResult(exitCode: number, stderr = ""): GitRunResult {
  return {
    termination: "exit",
    exitCode,
    stdout: new Uint8Array(),
    stderr: encoder.encode(stderr),
    stderrTruncated: false,
    durationMs: 5,
  };
}

function killedResult(
  termination: "timeout" | "signal",
  stderr = "",
): GitRunResult {
  return {
    termination,
    exitCode: null,
    stdout: new Uint8Array(),
    stderr: encoder.encode(stderr),
    stderrTruncated: false,
    durationMs: 120_000,
  };
}

interface Stub {
  readonly engine: GitEngine;
  readonly specs: readonly GitCommandSpec[];
  /** Mutable on purpose: the observer appends to it as the workflow runs. */
  readonly observed: { destination: string; state: DestinationState }[];
}

/**
 * Narrow an outcome to the kind a case is about.
 *
 * An assertion function rather than a cast: the call site then reads the members of
 * the kind it asserted, and a wrong kind fails the case with the kind it actually got.
 */
function assertKind<T extends CreationOutcome["kind"]>(
  outcome: CreationOutcome,
  kind: T,
): asserts outcome is Extract<CreationOutcome, { kind: T }> {
  if (outcome.kind !== kind) {
    throw new Error(`expected a ${kind} outcome, got ${outcome.kind}`);
  }
}

/** An engine that answers with queued results, recording the specs it was given. */
function stub(options: {
  readonly results: readonly GitRunResult[];
}): Stub {
  const specs: GitCommandSpec[] = [];
  const observed: { destination: string; state: DestinationState }[] = [];
  const results = [...options.results];
  return {
    specs,
    observed,
    engine: {
      async run(spec): Promise<GitRunResult> {
        specs.push(spec);
        const next = results.shift();
        if (next === undefined) {
          throw new Error("the workflow ran more commands than the test queued");
        }
        return next;
      },
    },
  };
}

function observer(
  stubValue: Stub,
  states: readonly DestinationState[],
): (destination: string) => Promise<DestinationState> {
  const queue = [...states];
  return async (destination) => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("the workflow observed the destination more times than the test queued");
    }
    stubValue.observed.push({ destination, state: next });
    return next;
  };
}

describe("init classification", () => {
  it("reports success, and ran init at the destination it was given", async () => {
    const engine = stub({ results: [exitResult(0)] });
    const outcome: CreationOutcome = await initRepository(engine.engine, {
      cwdHandle: "root_1",
      destination: "/root/new",
      initialBranch: "trunk",
      observeDestination: observer(engine, ["absent", "nonEmpty"]),
    });
    expect(outcome.kind).toBe("done");
    expect(outcome.destinationAfter).toBe("nonEmpty");
    expect(engine.specs.map((spec) => spec.argv)).toEqual([
      ["init", "--quiet", "--initial-branch=trunk", "--", "/root/new"],
    ]);
  });

  it("carries Git's own diagnostic when init refuses", async () => {
    const engine = stub({
      results: [exitResult(128, "fatal: cannot mkdir /root/new: Permission denied")],
    });
    const outcome: CreationOutcome = await initRepository(engine.engine, {
      cwdHandle: "root_1",
      destination: "/root/new",
      initialBranch: null,
      observeDestination: observer(engine, ["absent", "absent"]),
    });
    assertKind(outcome, "refused");
    expect(outcome.code).toBe("GitCommandFailed");
    expect(outcome.exitCode).toBe(128);
    expect(outcome.diagnostic).toContain("Permission denied");
    expect(outcome.destinationAfter).toBe("absent");
  });

  it("reports a partial init as something left behind, not as a plain failure", async () => {
    // A non-zero exit after Git created part of `.git` is not "nothing happened",
    // and a client that retried into it would be told the destination is occupied.
    const engine = stub({
      results: [exitResult(128, "fatal: could not write config file")],
    });
    const outcome: CreationOutcome = await initRepository(engine.engine, {
      cwdHandle: "root_1",
      destination: "/root/new",
      initialBranch: null,
      observeDestination: observer(engine, ["absent", "nonEmpty"]),
    });
    assertKind(outcome, "leftBehind");
    expect(outcome.destinationAfter).toBe("nonEmpty");
  });

  it("reports a killed init as unknown, never as a failure that was undone", async () => {
    const engine = stub({ results: [killedResult("timeout")] });
    const outcome: CreationOutcome = await initRepository(engine.engine, {
      cwdHandle: "root_1",
      destination: "/root/new",
      initialBranch: null,
      observeDestination: observer(engine, ["absent", "nonEmpty"]),
    });
    assertKind(outcome, "uncertain");
    expect(outcome.code).toBe("GitTimedOut");
    // The destination state travels with it: the caller can say what is on disk
    // without claiming to know whether the command finished.
    expect(outcome.destinationAfter).toBe("nonEmpty");
  });
});

describe("clone classification", () => {
  it("passes the submodule switch through and reports success", async () => {
    const engine = stub({ results: [exitResult(0)] });
    const outcome: CreationOutcome = await cloneRepository(engine.engine, {
      cwdHandle: "root_1",
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: true,
      observeDestination: observer(engine, ["absent", "nonEmpty"]),
    });
    expect(outcome.kind).toBe("done");
    expect(engine.specs[0]?.argv).toEqual([
      "clone",
      "--quiet",
      "--recurse-submodules",
      "--",
      "/remote/repo.git",
      "/root/cloned",
    ]);
  });

  it("leaves a refusal alone when the destination already held the user's files", async () => {
    // The common refusal: Git will not clone into a directory with content. Nothing
    // was created, so this is a failure with Git's diagnostic — not a partial clone.
    const engine = stub({
      results: [
        exitResult(
          128,
          "fatal: destination path '/root/cloned' already exists and is not an empty directory.",
        ),
      ],
    });
    const outcome: CreationOutcome = await cloneRepository(engine.engine, {
      cwdHandle: "root_1",
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
      observeDestination: observer(engine, ["nonEmpty", "nonEmpty"]),
    });
    assertKind(outcome, "refused");
    expect(outcome.diagnostic).toContain("not an empty directory");
  });

  it("reports a clone that failed after writing as left behind, so nothing is retried blindly", async () => {
    const engine = stub({
      results: [exitResult(128, "fatal: the remote end hung up unexpectedly")],
    });
    const outcome: CreationOutcome = await cloneRepository(engine.engine, {
      cwdHandle: "root_1",
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
      observeDestination: observer(engine, ["absent", "nonEmpty"]),
    });
    assertKind(outcome, "leftBehind");
    expect(outcome.diagnostic).toContain("hung up");
    expect(outcome.destinationAfter).toBe("nonEmpty");
  });

  it("reports a clone that failed on an empty destination as a plain refusal", async () => {
    const engine = stub({
      results: [exitResult(128, "fatal: repository '/remote/repo.git' does not exist")],
    });
    const outcome: CreationOutcome = await cloneRepository(engine.engine, {
      cwdHandle: "root_1",
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
      observeDestination: observer(engine, ["empty", "empty"]),
    });
    assertKind(outcome, "refused");
    expect(outcome.destinationAfter).toBe("empty");
  });

  it("reports a killed clone as unknown even when it left a directory behind", async () => {
    // Unknown outranks left-behind: the process was killed mid-write, so what is on
    // disk there is not a state anyone can describe — only report.
    const engine = stub({ results: [killedResult("signal")] });
    const outcome: CreationOutcome = await cloneRepository(engine.engine, {
      cwdHandle: "root_1",
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
      observeDestination: observer(engine, ["absent", "nonEmpty"]),
    });
    assertKind(outcome, "uncertain");
    expect(outcome.code).toBe("GitTerminatedBySignal");
    expect(outcome.destinationAfter).toBe("nonEmpty");
  });

  it("observes the destination before the command and again after it", async () => {
    const engine = stub({ results: [exitResult(0)] });
    await cloneRepository(engine.engine, {
      cwdHandle: "root_1",
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
      observeDestination: observer(engine, ["empty", "nonEmpty"]),
    });
    expect(engine.observed.map((entry) => entry.state)).toEqual([
      "empty",
      "nonEmpty",
    ]);
    expect(engine.observed.map((entry) => entry.destination)).toEqual([
      "/root/cloned",
      "/root/cloned",
    ]);
    expect(engine.specs).toHaveLength(1);
  });
});
