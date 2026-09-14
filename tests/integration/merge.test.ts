/**
 * T12: merging, continuing a merged index, and aborting.
 *
 * A merge is the operation that can stop halfway, so these cases are about the
 * halfway state and not about the happy path:
 *
 * - a divergent merge lands in `needsAttention` with the conflicted paths visible in
 *   the status read, and the repository reports `operationInProgress: merge` — the
 *   state the UI needs to offer "resolve, stage, continue";
 * - another write is refused while the merge is unfinished, but continuing and
 *   aborting it are allowed, because those *are* the finish;
 * - an abort restores the head the merge started from, and a Git refusal to restore
 *   is reported as a refusal rather than papered over with a reset;
 * - a repository this build cannot merge into (no commits yet, or a source that is
 *   not a commit) fails closed with a message, and nothing about the repository is
 *   changed to make it work.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  refsSnapshotSchema,
  statusSnapshotSchema,
} from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  submitAndWait,
  type TestService,
} from "../support/service.js";

interface StatusView {
  readonly snapshotId: string;
  readonly worktreeId: string;
  readonly operationInProgress: string | null;
  readonly headOid: string | null;
  readonly unmerged: readonly {
    readonly pathId: string;
    readonly displayPath: string;
    readonly stages: readonly { readonly stage: number }[] | null;
  }[];
}

/** Start a service whose reads and writes carry the bearer it paired for. */
async function startService(repo: GitFixtureRepo): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

/**
 * Read status through the API.
 *
 * No `worktreeId` is passed: the host answers for the primary worktree, which is
 * where this build's single-writer queue runs its merges.
 */
async function readStatus(service: TestService): Promise<StatusView> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const status = statusSnapshotSchema.parse(await response.json());
  return {
    snapshotId: status.snapshotId,
    worktreeId: status.worktreeId,
    operationInProgress: status.operationInProgress,
    headOid: status.head.oid,
    unmerged: status.entries
      .filter((entry) => entry.kind === "unmerged")
      .map((entry) => ({
        pathId: entry.pathId,
        displayPath: entry.displayPath,
        stages: entry.stages,
      })),
  };
}

async function worktreeTarget(service: TestService): Promise<object> {
  const status = await readStatus(service);
  return {
    kind: "worktree",
    repositoryId: service.repositoryId,
    worktreeId: status.worktreeId,
    expectedSnapshotId: status.snapshotId,
  };
}

/**
 * `a.txt` diverges: `other` changes it, then `main` changes it differently.
 *
 * The fixture writes through Git directly — this is the *setup* for a merge, not a
 * merge through the API, and both sides must exist before the request is built so the
 * snapshot the request carries is the one it is checked against.
 */
async function divergeOneFile(repo: GitFixtureRepo): Promise<string> {
  await repo.git(["switch", "-c", "other"]);
  await repo.write("a.txt", "other\n");
  const other = await repo.commitAll("other");
  await repo.git(["switch", "main"]);
  await repo.write("a.txt", "main\n");
  await repo.commitAll("main");
  return other;
}

async function startConflict(
  service: TestService,
  other: string,
): Promise<void> {
  const record = await submitAndWait(service, {
    clientRequestId: `merge-conflict-${Math.random().toString(36).slice(2, 8)}`,
    target: await worktreeTarget(service),
    operation: {
      kind: "merge",
      sourceOid: other,
      mode: "default",
      message: null,
    },
  });
  expect(record.status).toBe("needsAttention");
}

describe("merging", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("merges a fast-forwardable branch and reports the new head", async () => {
    await repo.git(["switch", "-c", "feature"]);
    await repo.write("feature.txt", "feature\n");
    const feature = await repo.commitAll("feature");
    await repo.git(["switch", "main"]);

    const record = await submitAndWait(service, {
      clientRequestId: "merge-ff-1",
      target: await worktreeTarget(service),
      operation: {
        kind: "merge",
        sourceOid: feature,
        mode: "default",
        message: null,
      },
    });
    expect(record.status).toBe("succeeded");
    expect(record.result?.newHeadOid).toEqual(feature);
    expect(await repo.readText("feature.txt")).toEqual("feature\n");
  });

  it("merges with --no-ff so the merge commit is explicit", async () => {
    await repo.git(["switch", "-c", "feature"]);
    await repo.write("feature.txt", "feature\n");
    const feature = await repo.commitAll("feature");
    await repo.git(["switch", "main"]);

    const record = await submitAndWait(service, {
      clientRequestId: "merge-noff-1",
      target: await worktreeTarget(service),
      operation: {
        kind: "merge",
        sourceOid: feature,
        mode: "no-ff",
        message: "merge feature",
      },
    });
    expect(record.status).toBe("succeeded");
    expect(record.result?.newHeadOid).not.toEqual(feature);
    const parents = new TextDecoder()
      .decode(await repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]))
      .trim()
      .split(" ");
    expect(parents.length).toBe(3);
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual("merge feature");
  });

  it("reports a divergent merge as conflicts and keeps the merge open", async () => {
    const other = await divergeOneFile(repo);

    const record = await submitAndWait(service, {
      clientRequestId: "merge-conflict-1",
      target: await worktreeTarget(service),
      operation: {
        kind: "merge",
        sourceOid: other,
        mode: "default",
        message: null,
      },
    });
    // The merge did start and did stop: that is `needsAttention`, never `failed`
    // (which would suggest nothing happened) and never `succeeded`. The count is a
    // detail on the problem; the names come from the status read below.
    expect(record.status).toBe("needsAttention");
    expect(record.problem?.details?.conflictedPaths).toEqual(1);

    const status = await readStatus(service);
    expect(status.operationInProgress).toEqual("merge");
    expect(status.unmerged.map((entry) => entry.displayPath)).toEqual([
      "a.txt",
    ]);
    // Three stages: base, ours, theirs — what each side contributed.
    expect(status.unmerged[0]?.stages?.map((stage) => stage.stage)).toEqual([
      1, 2, 3,
    ]);
  });

  it("refuses another write while the merge is unfinished", async () => {
    await startConflict(service, await divergeOneFile(repo));

    // A repository-targeted write (branches are repository-wide) must be blocked by
    // the unfinished merge in the worktree that holds it.
    const refs = refsSnapshotSchema.parse(
      await (
        await service.fetch(`/api/v1/refs?repositoryId=${service.repositoryId}`)
      ).json(),
    );
    const response = await service.fetch("/api/v1/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: "merge-then-branch",
        target: {
          kind: "repository",
          repositoryId: service.repositoryId,
          expectedSnapshotId: refs.snapshotId,
        },
        operation: {
          kind: "createBranch",
          branchName: "while-merging",
          startOid: null,
          switchToIt: false,
        },
      }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("Conflict");
    // Nothing was created.
    const branches = new TextDecoder().decode(
      await repo.git(["branch", "--list", "while-merging"]),
    );
    expect(branches.trim()).toEqual("");
  });

  it("stages a resolved conflict while the merge is unfinished, and blocks the rest", async () => {
    await startConflict(service, await divergeOneFile(repo));
    await repo.write("a.txt", "merged\n");

    const conflicted = await readStatus(service);
    expect(conflicted.unmerged.map((entry) => entry.displayPath)).toEqual([
      "a.txt",
    ]);
    const pathId = conflicted.unmerged[0]?.pathId;
    expect(pathId).toBeDefined();

    // Staging is the resolution step Git documents, so it has to work while the
    // merge is open — otherwise the panel's own instructions could not be followed.
    const previews = await service.fetch("/api/v1/previews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: service.repositoryId,
        worktreeId: conflicted.worktreeId,
        pathIds: [pathId],
      }),
    });
    const tokens = (await previews.json()) as {
      tokens: { previewToken: string }[];
    };
    const staged = await submitAndWait(service, {
      clientRequestId: "merge-stage-1",
      target: await worktreeTarget(service),
      operation: {
        kind: "stagePaths",
        pathIds: [pathId ?? ""],
        previewTokens: tokens.tokens.map((token) => token.previewToken),
      },
    });
    expect(staged.status).toBe("succeeded");
    // The path is no longer conflicted; the merge is still open.
    const afterStaging = await readStatus(service);
    expect(afterStaging.unmerged).toEqual([]);
    expect(afterStaging.operationInProgress).toEqual("merge");

    // The rest stays blocked: a plain commit would write the wrong history where the
    // merge commit belongs, and a discard would fight the conflict state.
    const blocked = await service.fetch("/api/v1/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: "merge-then-commit",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: afterStaging.worktreeId,
          expectedSnapshotId: afterStaging.snapshotId,
        },
        operation: { kind: "commit", message: "wrong commit" },
      }),
    });
    expect(blocked.status).toBe(409);
  });

  it("continues the merge once the conflicted path is resolved and staged", async () => {
    await startConflict(service, await divergeOneFile(repo));

    // Resolution happens outside the service — an editor, another tool, the user's
    // own hands — which is why the workflow re-reads the index rather than trusting
    // anything it planned earlier.
    await repo.write("a.txt", "merged\n");
    await repo.git(["add", "a.txt"]);

    const record = await submitAndWait(service, {
      clientRequestId: "merge-continue-1",
      target: await worktreeTarget(service),
      operation: { kind: "continueMerge", message: null },
    });
    expect(record.status).toBe("succeeded");

    const status = await readStatus(service);
    expect(status.operationInProgress).toBeNull();
    expect(status.unmerged).toEqual([]);
    expect(await repo.readText("a.txt")).toEqual("merged\n");
    // The merge commit has both sides for parents.
    const parents = new TextDecoder()
      .decode(await repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]))
      .trim()
      .split(" ");
    expect(parents.length).toBe(3);
  });

  it("refuses to continue while the conflicted path is still unmerged", async () => {
    await startConflict(service, await divergeOneFile(repo));

    const record = await submitAndWait(service, {
      clientRequestId: "merge-continue-unresolved",
      target: await worktreeTarget(service),
      operation: { kind: "continueMerge", message: null },
    });
    expect(record.status).toBe("failed");
    // Still mid-merge: a refused continue must not clear the state.
    const status = await readStatus(service);
    expect(status.operationInProgress).toEqual("merge");
  });

  it("aborts the merge and restores the head it started from", async () => {
    const other = await divergeOneFile(repo);
    const before = (await repo.headOid()).trim();
    await startConflict(service, other);

    const record = await submitAndWait(service, {
      clientRequestId: "merge-abort-1",
      target: await worktreeTarget(service),
      operation: { kind: "abortMerge", confirmed: true },
    });
    expect(record.status).toBe("succeeded");
    expect((await repo.headOid()).trim()).toEqual(before);
    expect(await repo.readText("a.txt")).toEqual("main\n");
    const status = await readStatus(service);
    expect(status.operationInProgress).toBeNull();
    expect(status.unmerged).toEqual([]);
  });

  it("refuses an abort when no merge is in progress", async () => {
    const record = await submitAndWait(service, {
      clientRequestId: "merge-abort-none",
      target: await worktreeTarget(service),
      operation: { kind: "abortMerge", confirmed: true },
    });
    expect(record.status).toBe("failed");
    expect(record.problem?.message).toMatch(/no merge is in progress/i);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("refuses a source that is not a commit without changing the repository", async () => {
    const head = (await repo.headOid()).trim();
    const blob = new TextDecoder()
      .decode(await repo.git(["rev-parse", "HEAD:a.txt"]))
      .trim();

    const record = await submitAndWait(service, {
      clientRequestId: "merge-bad-source",
      target: await worktreeTarget(service),
      operation: {
        kind: "merge",
        sourceOid: blob,
        mode: "default",
        message: null,
      },
    });
    expect(record.status).toBe("failed");
    expect((await repo.headOid()).trim()).toEqual(head);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("refuses a commit this repository does not have, without fetching", async () => {
    const head = (await repo.headOid()).trim();
    // A well-formed object name that is not in this repository — the shape a shallow
    // or partial clone shows for history it never fetched.
    const record = await submitAndWait(service, {
      clientRequestId: "merge-missing-object",
      target: await worktreeTarget(service),
      operation: {
        kind: "merge",
        sourceOid: "1".repeat(40),
        mode: "default",
        message: null,
      },
    });
    expect(record.status).toBe("failed");
    expect(record.problem?.message).toMatch(/not a commit in this repository/i);
    expect((await repo.headOid()).trim()).toEqual(head);
    // Nothing was fetched to make the merge possible: the repository has no remotes
    // to fetch from, and a request that needs one is refused rather than helped.
    const remotes = new TextDecoder().decode(await repo.git(["remote"]));
    expect(remotes.trim()).toEqual("");
  });

  it("merges onto a detached HEAD, which Git allows", async () => {
    await repo.git(["switch", "-c", "feature"]);
    await repo.write("feature.txt", "feature\n");
    const feature = await repo.commitAll("feature");
    await repo.git(["switch", "main"]);
    const at = (await repo.headOid()).trim();
    await repo.git(["switch", "--detach", at]);

    const record = await submitAndWait(service, {
      clientRequestId: "merge-detached-1",
      target: await worktreeTarget(service),
      operation: {
        kind: "merge",
        sourceOid: feature,
        mode: "default",
        message: null,
      },
    });
    expect(record.status).toBe("succeeded");
    expect(await repo.readText("feature.txt")).toEqual("feature\n");
    const detached = new TextDecoder().decode(
      await repo
        .git(["symbolic-ref", "--quiet", "HEAD"])
        .catch(() => new Uint8Array()),
    );
    expect(detached.trim()).toEqual("");
  });

  it("fails closed in a repository with no commits", async () => {
    const fresh = await createRepo();
    const freshService = await startService(fresh);
    try {
      const status = await readStatus(freshService);
      const record = await submitAndWait(freshService, {
        clientRequestId: "merge-unborn-1",
        target: {
          kind: "worktree",
          repositoryId: freshService.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "merge",
          sourceOid: "0".repeat(40),
          mode: "default",
          message: null,
        },
      });
      expect(record.status).toBe("failed");
      expect(record.problem?.message).toMatch(/no commit|unborn/i);
    } finally {
      await freshService.close();
      await fresh.dispose();
    }
  });

  it("does not hand a foreign operation to the merge family", async () => {
    // A cherry-pick this build did not start: `continueMerge` must not be handed a
    // repository that is halfway through somebody else's operation.
    await repo.git(["switch", "-c", "side"]);
    await repo.write("a.txt", "side\n");
    const side = await repo.commitAll("side");
    await repo.git(["switch", "main"]);
    await repo.write("a.txt", "main\n");
    await repo.commitAll("main");
    // This cherry-pick is *meant* to conflict: it leaves the CHERRY_PICK_HEAD state
    // the service must refuse to finish on the user's behalf.
    const picked = await repo.gitResult(["cherry-pick", side]);
    expect(picked.code).toBe(1);

    const status = await readStatus(service);
    expect(status.operationInProgress).toEqual("cherry-pick");

    // Refused at submission: `continueMerge` is not handed a repository that is
    // halfway through somebody else's operation, and no record is created for a
    // request that could not have been about this state.
    const response = await service.fetch("/api/v1/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: "merge-foreign-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "continueMerge", message: null },
      }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { problem: { details?: unknown } };
    expect(body.problem.details).toEqual({ operation: "cherry-pick" });
    // The cherry-pick state is untouched.
    expect((await readStatus(service)).operationInProgress).toEqual(
      "cherry-pick",
    );
  });
});
