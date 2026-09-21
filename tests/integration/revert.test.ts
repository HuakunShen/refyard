/**
 * Reverting one completed commit through the API.
 *
 * Revert is a mutation whose failure modes are asymmetric: a clean revert is a
 * normal commit (hooks run, head moves), a merge commit is refused before Git
 * is asked anything that could choose a parent, and a conflict is *aborted by
 * the host* so the repository comes out exactly as it went in — the cases:
 *
 * - reverting HEAD writes Git's own `Revert "<subject>"` commit and restores
 *   the reverted content;
 * - reverting a non-HEAD commit is also clean when nothing since touches the
 *   same paths, and the undo lands on top of HEAD;
 * - a merge commit is refused without changing anything (picking a parent is
 *   not a decision this build makes);
 * - an object this repository does not have is refused by Git, and the refusal
 *   is reported rather than papered over;
 * - a conflict aborts: head, content and status are all unchanged afterwards,
 *   and nothing (`REVERT_HEAD` included) is left behind.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { statusSnapshotSchema } from "@refyard/git-contract";
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
  readonly unmerged: readonly { readonly displayPath: string }[];
}

async function startService(repo: GitFixtureRepo): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

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
      .map((entry) => ({ displayPath: entry.displayPath })),
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

async function submitRevert(
  service: TestService,
  oid: string,
): Promise<Awaited<ReturnType<typeof submitAndWait>>> {
  const target = await worktreeTarget(service);
  const body = {
    clientRequestId: `revert-${Math.random().toString(36).slice(2, 8)}`,
    target,
    operation: { kind: "revertCommit", oid },
  };
  return submitAndWait(service, body);
}

/** `a.txt` moves base → one → two; both later commits return their oids. */
async function commitChain(repo: GitFixtureRepo): Promise<{
  readonly one: string;
  readonly two: string;
}> {
  await repo.write("a.txt", "one\n");
  const one = await repo.commitAll("one");
  // A different file: the reverse patch of either commit applies cleanly.
  await repo.write("b.txt", "two\n");
  const two = await repo.commitAll("two");
  return { one, two };
}

/** `a.txt` moves base → one → two, so the reverse of `one` conflicts with HEAD. */
async function sameFileChain(repo: GitFixtureRepo): Promise<string> {
  await repo.write("a.txt", "one\n");
  const one = await repo.commitAll("one");
  await repo.write("a.txt", "two\n");
  await repo.commitAll("two");
  return one;
}

/** A real merge commit at HEAD, built directly through Git as setup. */
async function mergeAtHead(repo: GitFixtureRepo): Promise<string> {
  await repo.git(["switch", "-c", "side"]);
  await repo.write("side.txt", "side\n");
  const side = await repo.commitAll("side");
  await repo.git(["switch", "main"]);
  await repo.git(["merge", "--no-ff", "-m", "merge side", side]);
  return (await repo.headOid()).trim();
}

describe("reverting", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("reverts HEAD and writes Git's own revert commit", async () => {
    const { two } = await commitChain(repo);

    const record = await submitRevert(service, two);
    expect(record.status).toBe("succeeded");
    expect(record.result?.newHeadOid).toBeDefined();
    expect(record.result?.newHeadOid).not.toEqual(two);
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual('Revert "two"');
    expect(await repo.readText("a.txt")).toEqual("one\n");
    // b.txt was added by "two", so its revert deletes it from worktree and index.
    expect(
      new TextDecoder()
        .decode(await repo.git(["ls-files", "--", "b.txt"]))
        .trim(),
    ).toEqual("");
  });

  it("reverts a non-HEAD commit on top of HEAD", async () => {
    const { one, two } = await commitChain(repo);

    const record = await submitRevert(service, one);
    expect(record.status).toBe("succeeded");
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual('Revert "one"');
    // The reverse patch rewrites a.txt back to the base content; "two" only
    // ever touched b.txt, so nothing conflicts.
    expect((await readStatus(service)).headOid).toEqual(
      record.result?.newHeadOid,
    );
    expect(await repo.readText("a.txt")).toEqual("base\n");
    expect(await repo.readText("b.txt")).toEqual("two\n");
    expect((await repo.headOid()).trim()).not.toEqual(two);
  });

  it("refuses a merge commit without choosing a parent", async () => {
    const mergeOid = await mergeAtHead(repo);

    const record = await submitRevert(service, mergeOid);
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("InvalidRequest");
    expect(record.problem?.message).toMatch(/merge/i);
    expect((await repo.headOid()).trim()).toEqual(mergeOid);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("refuses an object this repository does not have", async () => {
    const head = (await repo.headOid()).trim();

    const record = await submitRevert(service, "1".repeat(40));
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("GitCommandFailed");
    expect(record.problem?.message).toMatch(/bad object/i);
    expect((await repo.headOid()).trim()).toEqual(head);
  });

  it("aborts a conflicted revert so the branch comes out unchanged", async () => {
    // HEAD says "two\n"; the reverse of "one" wants "base\n" — a content conflict.
    const one = await sameFileChain(repo);
    const head = (await repo.headOid()).trim();

    const record = await submitRevert(service, one);
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("Conflict");
    expect(record.problem?.message).toMatch(/aborted/i);

    expect((await repo.headOid()).trim()).toEqual(head);
    expect(await repo.readText("a.txt")).toEqual("two\n");
    const status = await readStatus(service);
    expect(status.operationInProgress).toBeNull();
    expect(status.unmerged).toEqual([]);
  });
});
