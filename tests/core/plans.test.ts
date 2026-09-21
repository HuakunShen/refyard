/**
 * Planner tests.
 *
 * A planner's output is the *only* thing that can reach Git, so these tests check
 * both halves of that claim:
 *
 * - **the shape**: an argument vector (never a shell string), no empty or
 *   NUL-bearing element, an explicit deadline class, and the specific flags whose
 *   absence would be a safety bug — `--literal-pathspecs`, `--` before paths,
 *   `--pathspec-file-nul` for byte-safe path lists, `-F -` for messages;
 * - **the behaviour**: the argv is actually run against a real repository, and the
 *   repository's state afterwards is what the operation promised. A flag that
 *   looks right but is rejected by Git is only discovered by running it.
 *
 * The path cases are deliberately hostile: a file named `-n`, one named
 * `:(glob)**`, and one with a newline. Those are the names a literal-pathspec rule
 * exists for.
 */
import { describe, expect, it } from "vitest";
import {
  CatFileDecoder,
  parseCommitObject,
  parseLsFilesStage,
  parseReflog,
  parseStatus,
  planAmendCommit,
  planCatFileBatch,
  planCommit,
  planDiffPatchAll,
  planDiffPatchForPath,
  planForEachRef,
  planLsFilesStage,
  planRepositoryClone,
  planRepositoryInit,
  planRestoreWorktree,
  planStashList,
  planRevList,
  planStage,
  planStashApply,
  planStashDrop,
  planStashPop,
  planStashPush,
  planStashResolve,
  planStatus,
  planUnstage,
  planUnstageUnborn,
  planRevertAbort,
  planRevertCommit,
  planRevertInProgress,
  planResetBranch,
  planCherryPickAbort,
  planCherryPick,
  planCherryPickContinue,
  planCherryPickInProgress,
  planRebaseAbort,
  planRebase,
  planRebaseContinue,
  planRebaseInProgress,
  planDropCommitAncestry,
  planDropCommitParent,
  planDropCommitRebase,
  planDropCommitSecondParent,
  planSquashSoftReset,
  type GitCommandSpec,
} from "@refyard/git-core";
import { createRepo } from "../support/repo.js";

const CWD = "wt_aaaaaaaaaaaaaaaa";
const context = { cwdHandle: CWD };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);

/** Every planner spec a test suite touches, for the shared invariants below. */
function allSpecs(): GitCommandSpec[] {
  return [
    planStatus(context),
    planStatus(context, { showStash: true, includeIgnored: true }),
    planForEachRef(context),
    planLsFilesStage(context),
    planStashList(context),
    planRevList(context, { tips: ["HEAD"], maxCount: 200, skip: 100 }),
    planCatFileBatch(context, ["a".repeat(40)]),
    planDiffPatchAll(context),
    planDiffPatchForPath(context, { path: "a.txt" }),
    planStage(context, [bytes("a.txt")]),
    planUnstage(context, [bytes("a.txt")]),
    planUnstageUnborn(context, [bytes("a.txt")]),
    planRestoreWorktree(context, [bytes("a.txt")]),
    planCommit(context, bytes("subject\n\nbody\n")),
    planAmendCommit(context, null),
    planAmendCommit(context, bytes("subject\n")),
    planStashPush(context, {
      message: "work in progress",
      includeUntracked: false,
      keepIndex: false,
    }),
    planStashApply(context, { locator: "stash@{0}", restoreIndex: false }),
    planStashPop(context, { locator: "stash@{0}", restoreIndex: true }),
    planStashDrop(context, "stash@{0}"),
    planStashResolve(context, "stash@{0}"),
    planRepositoryInit(context, {
      destination: "/root/new",
      initialBranch: "trunk",
    }),
    planRepositoryInit(context, {
      destination: "/root/new",
      initialBranch: null,
    }),
    planRepositoryClone(context, {
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: true,
    }),
    planRepositoryClone(context, {
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
    }),
    planRevertCommit(context, { oid: "a".repeat(40) }),
    planRevertInProgress(context),
    planRevertAbort(context),
  ];
}

describe("planner invariants", () => {
  it("returns an argument vector, never a shell string", () => {
    for (const spec of allSpecs()) {
      expect(Array.isArray(spec.argv), spec.description).toBe(true);
      expect(spec.argv.length, spec.description).toBeGreaterThan(0);
      for (const element of spec.argv) {
        expect(
          element.length,
          `${spec.description}: empty argument`,
        ).toBeGreaterThan(0);
        expect(
          element.includes("\u0000"),
          `${spec.description}: NUL in argument`,
        ).toBe(false);
      }
    }
  });

  it("never includes the executable, so the host decides which git runs", () => {
    for (const spec of allSpecs()) {
      expect(spec.argv[0], spec.description).not.toMatch(/(^|\/)git$/);
    }
  });

  it("carries the host-issued working directory handle and a deadline class", () => {
    for (const spec of allSpecs()) {
      expect(spec.cwdHandle, spec.description).toBe(CWD);
      expect(["readonly", "network", "hook"]).toContain(spec.deadlineClass);
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it("classifies reads as readonly and writes as hook-running", () => {
    // A clone is the one write whose deadline is the network's: it may take minutes,
    // and the contract's network deadline is what it is for.
    expect(
      planRepositoryClone(context, {
        remoteUrl: "/remote/repo.git",
        destination: "/root/cloned",
        initializeSubmodules: false,
      }).deadlineClass,
    ).toBe("network");
    expect(planStatus(context).deadlineClass).toBe("readonly");
    expect(planForEachRef(context).deadlineClass).toBe("readonly");
    expect(planCatFileBatch(context, [head()]).deadlineClass).toBe("readonly");
    expect(planStage(context, [bytes("a.txt")]).deadlineClass).toBe("hook");
    expect(planCommit(context, bytes("s")).deadlineClass).toBe("hook");
  });

  it("asks for no optional locks on reads, so a read cannot take the index lock", () => {
    expect(planStatus(context).argv).toContain("--no-optional-locks");
    // The status format is the machine one, with NUL framing.
    expect(planStatus(context).argv).toContain("--porcelain=v2");
    expect(planStatus(context).argv).toContain("-z");
  });

  it("disables external diff and textconv on every diff, so repository config cannot run a program", () => {
    for (const spec of [
      planDiffPatchAll(context),
      planDiffPatchForPath(context, { path: "x" }),
    ]) {
      expect(spec.argv).toContain("--no-ext-diff");
      expect(spec.argv).toContain("--no-textconv");
      expect(spec.argv).toContain("--no-color");
    }
  });
});

function head(): string {
  return "a".repeat(40);
}

describe("path-safe staging and unstaging", () => {
  it("stages exactly the selected paths, with literal pathspecs and NUL-framed stdin", () => {
    const spec = planStage(context, [bytes("a.txt"), bytes("b c.txt")]);
    expect(spec.argv).toEqual([
      "--literal-pathspecs",
      "add",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
      "--",
    ]);
    // Paths travel as NUL-separated bytes, so a path with a newline cannot split
    // into two pathspecs and no quoting rules apply.
    expect(decoder.decode(spec.stdin)).toBe("a.txt\u0000b c.txt\u0000");
  });

  it("stages a path whose name looks like a pathspec magic or an option", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      // `:(glob)**` would expand to every path if it were interpreted as a
      // pathspec; `-n` would be read as a switch by a careless `git add`.
      const wildcardName = "*";
      // Windows cannot hold a `:` or a `*` in a file name at all, so those two names
      // are only exercised where the filesystem allows them. The option-looking
      // name and the literal-bytes rule run everywhere.
      const names =
        process.platform === "win32"
          ? ["-n"]
          : [":(glob)**", "-n", wildcardName];
      for (const name of names) {
        await repo.write(`dir/${name}`, `content of ${name}\n`);
      }
      const selected = names
        .filter((name) => name !== wildcardName)
        .map((name) => bytes(`dir/${name}`));
      const spec = planStage(context, selected);
      await repo.git(spec.argv, { stdin: spec.stdin });

      const cached = decoder.decode(
        await repo.git(["diff", "--cached", "--name-only", "-z"]),
      );
      // Exactly the selected paths, in Git's sort order — a name that looks like
      // pathspec magic must not have been expanded into the repository.
      expect(
        cached.split("\u0000").filter((entry) => entry.length > 0),
      ).toEqual(selected.map((name) => decoder.decode(name)).sort());
      // The wildcard file exists in the working tree and must NOT have been staged.
      if (names.includes(wildcardName)) {
        const status = parseStatus(await repo.git(planStatus(context).argv));
        expect(
          status.records.some(
            (record) => decoder.decode(record.path) === `dir/${wildcardName}`,
          ),
        ).toBe(true);
      }
    } finally {
      await repo.dispose();
    }
  });

  it("unstages without touching the working tree bytes", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "changed in the working tree\n");
      await repo.git(["add", "--", "a.txt"]);
      const before = await repo.read("a.txt");

      const spec = planUnstage(context, [bytes("a.txt")]);
      await repo.git(spec.argv, { stdin: spec.stdin });

      expect(await repo.read("a.txt")).toEqual(before);
      const status = parseStatus(await repo.git(planStatus(context).argv));
      expect(status.records[0]?.indexStatus).toBe(".");
      expect(status.records[0]?.worktreeStatus).toBe("M");
    } finally {
      await repo.dispose();
    }
  });

  it("unstages in a repository with no commits, where restore has no HEAD to read", async () => {
    const repo = await createRepo();
    try {
      await repo.write("a.txt", "first\n");
      await repo.git(["add", "--", "a.txt"]);
      expect(
        parseLsFilesStage(await repo.git(planLsFilesStage(context).argv)),
      ).toHaveLength(1);

      const spec = planUnstageUnborn(context, [bytes("a.txt")]);
      await repo.git(spec.argv, { stdin: spec.stdin });

      expect(
        parseLsFilesStage(await repo.git(planLsFilesStage(context).argv)),
      ).toHaveLength(0);
      // The file is still there: unstaging is not deleting.
      expect(await repo.readText("a.txt")).toBe("first\n");
    } finally {
      await repo.dispose();
    }
  });

  it("restores a tracked file from the index, not from HEAD", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "staged\n");
      await repo.git(["add", "--", "a.txt"]);
      await repo.write("a.txt", "unstaged\n");

      const spec = planRestoreWorktree(context, [bytes("a.txt")]);
      await repo.git(spec.argv, { stdin: spec.stdin });

      // The index held "staged", so that is what the working tree now holds; HEAD's
      // "base" must not have been restored.
      expect(await repo.readText("a.txt")).toBe("staged\n");
    } finally {
      await repo.dispose();
    }
  });
});

describe("commit planning", () => {
  it("passes the message on stdin with cleanup disabled", () => {
    const message = bytes('标题\n\nbody with "quotes" and \\backslashes\n');
    const spec = planCommit(context, message);
    expect(spec.argv).toEqual(["commit", "--cleanup=verbatim", "--file=-"]);
    expect(spec.stdin).toEqual(message);
  });

  it("never disables hooks or signing", () => {
    for (const spec of [
      planCommit(context, bytes("s")),
      planAmendCommit(context, bytes("s")),
    ]) {
      expect(spec.argv).not.toContain("--no-verify");
      expect(spec.argv).not.toContain("--no-gpg-sign");
      expect(spec.argv.join(" ")).not.toContain("gpgSign");
    }
  });

  it("commits the index as it stands and preserves the message byte for byte", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("b.txt", "b\n");
      await repo.write("c.txt", "c\n");
      await repo.git(["add", "--", "b.txt"]);
      const message = "feat: 中文 subject\n\nsecond line\n\n";
      const spec = planCommit(context, bytes(message));
      await repo.git(spec.argv, { stdin: spec.stdin });

      const headOid = await repo.headOid();
      const catFile = planCatFileBatch(context, [headOid]);
      const batch = new CatFileDecoder();
      const entries = batch.push(
        await repo.git(catFile.argv, { stdin: catFile.stdin }),
      );
      batch.finish();
      const first = entries[0];
      if (first === undefined || "missing" in first) {
        throw new Error("expected a commit object");
      }
      const commit = parseCommitObject(first.body);
      // The trailing blank line survives: Git's default cleanup would have
      // stripped it and silently changed what the user wrote.
      expect(decoder.decode(commit.messageBytes)).toBe(message);
      expect(commit.parentOids).toHaveLength(1);

      // c.txt was never staged and must not be in the commit.
      const committed = decoder.decode(
        await repo.git(["show", "--name-only", "--format=", "HEAD"]),
      );
      expect(committed.trim()).toBe("b.txt");
    } finally {
      await repo.dispose();
    }
  });

  it("amends without an editor when the message is unchanged", () => {
    expect(planAmendCommit(context, null).argv).toEqual([
      "commit",
      "--amend",
      "--no-edit",
    ]);
  });
});

describe("revert planning", () => {
  // `--no-edit` keeps Git's own revert message and keeps hooks running; a revert
  // that stops for a message editor would hang the queue on a UI the host cannot show.
  it("reverts one object name with the message editor disabled", () => {
    const spec = planRevertCommit(context, { oid: "b".repeat(40) });
    expect(spec.argv).toEqual(["revert", "--no-edit", "b".repeat(40)]);
    expect(spec.stdin).toBeUndefined();
  });

  it("probes REVERT_HEAD as a read and aborts as a write", () => {
    expect(planRevertInProgress(context).argv).toEqual([
      "rev-parse",
      "--verify",
      "--quiet",
      "REVERT_HEAD",
    ]);
    expect(planRevertAbort(context).argv).toEqual(["revert", "--abort"]);
  });

  it("plans the cherry-pick family without an editor and without -m", () => {
    expect(planCherryPick(context, { oid: "d".repeat(40) }).argv).toEqual([
      "cherry-pick",
      "--no-edit",
      "d".repeat(40),
    ]);
    // The stop probe is a read; finishing uses the sequencer subcommands.
    expect(planCherryPickInProgress(context).argv).toEqual([
      "rev-parse",
      "--verify",
      "--quiet",
      "CHERRY_PICK_HEAD",
    ]);
    expect(planCherryPickContinue(context).argv).toEqual([
      "cherry-pick",
      "--continue",
    ]);
    expect(planCherryPickAbort(context).argv).toEqual(["cherry-pick", "--abort"]);
  });

  it("cherry-picks a real commit, keeping the original subject and author", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.git(["switch", "-c", "side"]);
      await repo.write("a.txt", "from side\n");
      const side = await repo.commitAll("from side");
      const author = new TextDecoder()
        .decode(await repo.git(["log", "-1", "--format=%an <%ae>", side]))
        .trim();
      await repo.git(["switch", "main"]);
      // A commit of main's own: without it the pick would reproduce the side
      // commit byte for byte — same parent, tree, author, timestamps — and land
      // on the identical object id.
      await repo.write("main.txt", "main own\n");
      await repo.commitAll("main own");

      const spec = planCherryPick(context, { oid: side });
      await repo.git(spec.argv, { stdin: spec.stdin });

      const subject = new TextDecoder()
        .decode(await repo.git(["log", "-1", "--format=%s"]))
        .trim();
      expect(subject).toEqual("from side");
      const got = new TextDecoder()
        .decode(await repo.git(["log", "-1", "--format=%an <%ae>"]))
        .trim();
      expect(got).toEqual(author);
      expect((await repo.headOid()).trim()).not.toEqual(side);
    } finally {
      await repo.dispose();
    }
  });

  it("plans the squash soft reset as fixed text", () => {
    // HEAD^ is never client input, so the argv is constant.
    expect(planSquashSoftReset(context).argv).toEqual([
      "reset",
      "--soft",
      "HEAD^",
    ]);
  });

  it("squashes a real top commit into its parent, combining the trees", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "A\n");
      await repo.commitAll("A");
      await repo.write("b.txt", "B\n");
      await repo.commitAll("B");
      const oneCommit = await repo.git(["rev-parse", "HEAD~1"]);

      const reset = planSquashSoftReset(context);
      await repo.git(reset.argv, { stdin: reset.stdin });
      const commitStep = planAmendCommit(context, null);
      await repo.git(commitStep.argv, { stdin: commitStep.stdin });

      const subjects = new TextDecoder()
        .decode(await repo.git(["log", "--format=%s"]))
        .trim()
        .split("\n");
      expect(subjects).toEqual(["A", "base"]);
      // Both changes live in the one squashed commit.
      expect(await repo.readText("a.txt")).toEqual("A\n");
      expect(await repo.readText("b.txt")).toEqual("B\n");
      void oneCommit;
    } finally {
      await repo.dispose();
    }
  });

  it("plans the drop probes and the onto-rebase", () => {
    const oid = "d".repeat(40);
    expect(planDropCommitAncestry(context, { oid }).argv).toEqual([
      "merge-base",
      "--is-ancestor",
      oid,
      "HEAD",
    ]);
    expect(planDropCommitSecondParent(context, { oid }).argv).toEqual([
      "rev-parse",
      "--verify",
      "--quiet",
      `${oid}^2`,
    ]);
    expect(planDropCommitParent(context, { oid }).argv).toEqual([
      "rev-parse",
      "--verify",
      `${oid}^`,
    ]);
    expect(
      planDropCommitRebase(context, { oid, parentOid: "b".repeat(40) }).argv,
    ).toEqual(["rebase", "--onto", "b".repeat(40), oid]);
  });

  it("drops a real middle commit and replays the rest", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "A\n");
      await repo.commitAll("A");
      await repo.write("b.txt", "B\n");
      await repo.commitAll("B");
      await repo.write("c.txt", "C\n");
      await repo.commitAll("C");

      const spec = planDropCommitRebase(context, {
        oid: await repo.git(["rev-parse", "HEAD~1"]).then((bytes) =>
          new TextDecoder().decode(bytes).trim(),
        ),
        parentOid: await repo.git(["rev-parse", "HEAD~2"]).then((bytes) =>
          new TextDecoder().decode(bytes).trim(),
        ),
      });
      await repo.git(spec.argv, { stdin: spec.stdin });

      const subjects = new TextDecoder()
        .decode(await repo.git(["log", "--format=%s"]))
        .trim()
        .split("\n");
      expect(subjects).toEqual(["C", "A", "base"]);
      // Dropping B discards its change: b.txt is gone from history and tree,
      // while A's and C's content survive.
      const bTracked = await repo.gitResult(["ls-files", "--", "b.txt"]);
      expect(new TextDecoder().decode(bTracked.stdout).trim()).toEqual("");
      expect(await repo.readText("c.txt")).toEqual("C\n");
    } finally {
      await repo.dispose();
    }
  });

  it("plans the rebase family without ever opening an editor", () => {
    expect(planRebase(context, { upstreamOid: "e".repeat(40) }).argv).toEqual([
      "rebase",
      "e".repeat(40),
    ]);
    // The continue's editor override is process-scoped (`-c`): no config file
    // is touched, and the replayed commit keeps its original message.
    expect(planRebaseContinue(context).argv).toEqual([
      "-c",
      "core.editor=true",
      "rebase",
      "--continue",
    ]);
    expect(planRebaseInProgress(context).argv).toEqual([
      "rev-parse",
      "--verify",
      "REBASE_HEAD",
    ]);
    expect(planRebaseAbort(context).argv).toEqual(["rebase", "--abort"]);
  });

  it("rebases a real branch, replaying its commits onto the new base", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.git(["switch", "-c", "side"]);
      await repo.write("side.txt", "from side\n");
      await repo.commitAll("from side");
      await repo.git(["switch", "main"]);
      await repo.write("main.txt", "from main\n");
      await repo.commitAll("from main");
      const mainTip = await repo.headOid();
      await repo.git(["switch", "side"]);

      const spec = planRebase(context, { upstreamOid: mainTip });
      await repo.git(spec.argv, { stdin: spec.stdin });

      // The branch now sits on main's tip, with its own commit replayed after.
      const parents = new TextDecoder()
        .decode(await repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]))
        .trim()
        .split(" ");
      expect(parents.length).toBe(2);
      expect(parents[1]).toEqual(mainTip);
      expect(await repo.readText("side.txt")).toEqual("from side\n");
      expect(await repo.readText("main.txt")).toEqual("from main\n");
    } finally {
      await repo.dispose();
    }
  });

  it("resets only with the content-preserving mode flags", () => {
    expect(
      planResetBranch(context, { oid: "c".repeat(40), mode: "soft" }).argv,
    ).toEqual(["reset", "--soft", "c".repeat(40)]);
    expect(
      planResetBranch(context, { oid: "c".repeat(40), mode: "mixed" }).argv,
    ).toEqual(["reset", "--mixed", "c".repeat(40)]);
    // `--hard` is a mode the planner cannot be asked for: the input union has
    // no such member, and the string below documents that it must stay that way.
    for (const spec of [
      planResetBranch(context, { oid: "c".repeat(40), mode: "soft" }),
      planResetBranch(context, { oid: "c".repeat(40), mode: "mixed" }),
    ]) {
      expect(spec.argv).not.toContain("--hard");
    }
  });

  it("resets a real branch and moves the head without touching the tree", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "second\n");
      const second = await repo.commitAll("second");
      await repo.write("a.txt", "third\n");
      const third = await repo.commitAll("third");
      const spec = planResetBranch(context, { oid: second, mode: "mixed" });
      await repo.git(spec.argv, { stdin: spec.stdin });

      expect((await repo.headOid()).trim()).toEqual(second);
      // Mixed reset left the working file alone and unstaged the delta.
      expect(await repo.readText("a.txt")).toEqual("third\n");
      // No trim: the leading space of " M a.txt" is the empty index column,
      // which is the assertion — unstaged worktree change, staged nothing.
      const status = new TextDecoder().decode(
        await repo.git(["status", "--porcelain"]),
      );
      expect(status).toContain(" M a.txt");
      expect((await repo.headOid()).trim()).not.toEqual(third);
    } finally {
      await repo.dispose();
    }
  });

  it("reverts a real commit and records the undo commit Git writes", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "second\n");
      const second = await repo.commitAll("second");
      const before = await repo.headOid();

      const spec = planRevertCommit(context, { oid: second });
      await repo.git(spec.argv, { stdin: spec.stdin });

      const subject = new TextDecoder()
        .decode(await repo.git(["log", "-1", "--format=%s"]))
        .trim();
      expect(subject).toEqual('Revert "second"');
      expect(await repo.readText("a.txt")).toEqual("base\n");
      expect((await repo.headOid()).trim()).not.toEqual(before.trim());
      expect((await repo.headOid()).trim()).not.toEqual(second);
    } finally {
      await repo.dispose();
    }
  });
});

describe("history and object planning", () => {
  it("sends tips on stdin rather than in argv", () => {
    const spec = planRevList(context, {
      tips: ["refs/heads/main", "--all"],
      maxCount: 200,
      skip: 40,
    });
    // A tip that looks like an option travels as data, because stdin is not parsed
    // as a command line.
    expect(spec.argv).toEqual([
      "rev-list",
      "--topo-order",
      "--parents",
      "--max-count=200",
      "--skip=40",
      "--stdin",
    ]);
    expect(decoder.decode(spec.stdin)).toBe("refs/heads/main\n--all\n");
  });

  it("refuses to plan a history read with no tips", () => {
    expect(() =>
      planRevList(context, { tips: [], maxCount: 10, skip: 0 }),
    ).toThrowError(/at least one tip/);
  });

  it("sends object names on stdin for cat-file, one per line", () => {
    const spec = planCatFileBatch(context, [head(), "b".repeat(64)]);
    expect(spec.argv).toEqual(["cat-file", "--batch"]);
    expect(decoder.decode(spec.stdin)).toBe(`${head()}\n${"b".repeat(64)}\n`);
  });

  it("refuses to plan an object read with no object names", () => {
    expect(() => planCatFileBatch(context, [])).toThrowError(
      /at least one object name/,
    );
  });
});

describe("stash planning", () => {
  it("passes the message in argv with an explicit form, and never includes ignored files", () => {
    const spec = planStashPush(context, {
      message: "-leading dash message",
      includeUntracked: true,
      keepIndex: false,
    });
    expect(spec.argv).toEqual([
      "stash",
      "push",
      "--message=-leading dash message",
      "--include-untracked",
    ]);
    expect(spec.argv).not.toContain("--all");
    expect(spec.stdin).toBeUndefined();
  });

  it("keeps ignored files out even when untracked files are requested", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write(".gitignore", "ignored.txt\n");
      await repo.commitAll("ignore");
      await repo.write("kept.txt", "untracked\n");
      await repo.write("ignored.txt", "ignored\n");

      const spec = planStashPush(context, {
        message: "wip",
        includeUntracked: true,
        keepIndex: false,
      });
      await repo.git(spec.argv);

      const stashes = parseReflog(
        await repo.git([
          "reflog",
          "show",
          "--format=%gd%x00%H%x00%gs%x00%ct",
          "refs/stash",
        ]),
      );
      expect(stashes).toHaveLength(1);
      // The ignored file is still in the working tree, and the untracked one is not.
      expect(await repo.readText("ignored.txt")).toBe("ignored\n");
      // The untracked file left the working tree with the stash; the ignored one
      // did not, and it is the only change status reports.
      await expect(repo.read("kept.txt")).rejects.toThrow();
      const status = parseStatus(
        await repo.git(planStatus(context, { includeIgnored: true }).argv),
      );
      expect(
        status.records.map(
          (record) => `${record.kind}:${decoder.decode(record.path)}`,
        ),
      ).toEqual(["ignored:ignored.txt"]);
    } finally {
      await repo.dispose();
    }
  });

  it("resolves a locator to an object name before acting on it", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "stash me\n");
      await repo.git(["stash", "push", "--message=first"]);
      const spec = planStashResolve(context, "stash@{0}");
      expect(spec.argv).toEqual([
        "rev-parse",
        "--verify",
        "--quiet",
        "stash@{0}^{commit}",
      ]);
      const resolved = decoder.decode(await repo.git(spec.argv)).trim();
      const listed = parseReflog(
        await repo.git([
          "reflog",
          "show",
          "--format=%gd%x00%H%x00%gs%x00%ct",
          "refs/stash",
        ]),
      );
      expect(resolved).toBe(listed[0]?.oid);
    } finally {
      await repo.dispose();
    }
  });

  it("plans pop with Git's own semantics, so a conflict keeps the stash", async () => {
    const repo = await createRepo({ initialCommit: true });
    try {
      await repo.write("a.txt", "stashed\n");
      await repo.git(["stash", "push", "--message=work"]);
      await repo.write("a.txt", "committed\n");
      await repo.commitAll("moved on");

      const listed = parseReflog(
        await repo.git([
          "reflog",
          "show",
          "--format=%gd%x00%H%x00%gs%x00%ct",
          "refs/stash",
        ]),
      );
      const stash = listed[0];
      expect(stash).toBeDefined();
      const spec = planStashPop(context, {
        locator: stash?.locator ?? "stash@{0}",
        restoreIndex: false,
      });
      expect(spec.argv).toEqual([
        "stash",
        "pop",
        stash?.locator ?? "stash@{0}",
      ]);

      // Both sides changed the same line, so this must conflict. The point of using
      // `stash pop` rather than apply-then-drop is that the stash survives a
      // failure, which is what the listing below proves.
      const result = await repo.gitResult(spec.argv);
      expect(result.code).not.toBe(0);
      const after = parseReflog(
        await repo.git([
          "reflog",
          "show",
          "--format=%gd%x00%H%x00%gs%x00%ct",
          "refs/stash",
        ]),
      );
      expect(after.map((entry) => entry.oid)).toEqual([stash?.oid]);
      const conflicted = parseStatus(await repo.git(planStatus(context).argv));
      expect(conflicted.records[0]?.kind).toBe("unmerged");
    } finally {
      await repo.dispose();
    }
  });

  it("plans apply and drop as separate operations", () => {
    expect(
      planStashApply(context, { locator: "stash@{1}", restoreIndex: true })
        .argv,
    ).toEqual(["stash", "apply", "--index", "stash@{1}"]);
    expect(planStashDrop(context, "stash@{1}").argv).toEqual([
      "stash",
      "drop",
      "stash@{1}",
    ]);
  });
});
