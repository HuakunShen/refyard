/**
 * T11 end to end: worktrees and submodules.
 *
 * The cases are the ones where a worktree or submodule operation destroys or
 * misrepresents something:
 *
 * - the primary worktree can never be removed through the API, and a Git refusal
 *   (dirty, locked) is reported as-is — there is no recursive-delete fallback;
 * - a worktree destination comes from the approved root plus a relative path, so a
 *   `..` escape is refused at the boundary;
 * - submodule state is three object names (recorded, index, actual), never one
 *   "up to date" flag, and `update` checks out exactly the recorded commit.
 *
 * The submodule remote is a local bare repository under the fixture's scratch root,
 * used with the fixture's own `protocol.file.allow=always` local config: local-path
 * submodules are exactly the case Git will not transport without the user's own
 * approval, and this build never grants that approval on the user's behalf.
 */
import { readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  refsSnapshotSchema,
  statusSnapshotSchema,
  submodulesResponseSchema,
  worktreesResponseSchema,
} from "@refyard/git-contract";
import {
  createBareRemote,
  createRepo,
  type BareRemoteFixture,
  type GitFixtureRepo,
} from "../support/repo.js";
import {
  startTestService,
  submitAndWait,
  type TestService,
} from "../support/service.js";

async function startService(repo: GitFixtureRepo): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

interface WorktreeRow {
  readonly worktreeId: string;
  readonly displayPath: string;
  readonly isMain: boolean;
  readonly isLocked: boolean;
  readonly lockReason: string | null;
  readonly head: { branchName: string | null };
}

async function readWorktrees(
  service: TestService,
): Promise<readonly WorktreeRow[]> {
  const response = await service.fetch(
    `/api/v1/worktrees?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const parsed = worktreesResponseSchema.parse(await response.json());
  return parsed.worktrees.map((worktree) => ({
    worktreeId: worktree.worktreeId,
    displayPath: worktree.displayPath,
    isMain: worktree.isMain,
    isLocked: worktree.isLocked,
    lockReason: worktree.lockReason,
    head: { branchName: worktree.head.branchName },
  }));
}

async function readSubmodules(service: TestService): Promise<
  readonly {
    name: string;
    pathId: string;
    displayPath: string;
    recordedOid: string | null;
    indexOid: string | null;
    actualOid: string | null;
    state: string;
  }[]
> {
  const statusResponse = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  const status = statusSnapshotSchema.parse(await statusResponse.json());
  const response = await service.fetch(
    `/api/v1/submodules?repositoryId=${service.repositoryId}&worktreeId=${status.worktreeId}`,
  );
  expect(response.status).toBe(200);
  const parsed = submodulesResponseSchema.parse(await response.json());
  return parsed.submodules.map((entry) => ({
    name: entry.name,
    pathId: entry.pathId,
    displayPath: entry.displayPath,
    recordedOid: entry.recordedOid,
    indexOid: entry.indexOid,
    actualOid: entry.actualOid,
    state: entry.state,
  }));
}

async function repositoryTarget(service: TestService): Promise<object> {
  const response = await service.fetch(
    `/api/v1/refs?repositoryId=${service.repositoryId}`,
  );
  const refs = refsSnapshotSchema.parse(await response.json());
  return {
    kind: "repository",
    repositoryId: service.repositoryId,
    expectedSnapshotId: refs.snapshotId,
  };
}

async function worktreeTarget(service: TestService): Promise<object> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  const status = statusSnapshotSchema.parse(await response.json());
  return {
    kind: "worktree",
    repositoryId: service.repositoryId,
    worktreeId: status.worktreeId,
    expectedSnapshotId: status.snapshotId,
  };
}

/**
 * Approve file transport in the fixture's isolated *global* config.
 *
 * Git will not clone a `file://`-style submodule without `protocol.file.allow`,
 * and a repository-local setting does not apply to the transport check. The fixture
 * plays the user here: this writes the approval into the scratch HOME's gitconfig,
 * which is what a user who wants local submodules configures themselves. The
 * service never grants this on anyone's behalf.
 */
async function allowFileTransport(repo: GitFixtureRepo): Promise<void> {
  await appendFile(
    join(repo.home, ".gitconfig"),
    '[protocol "file"]\n\tallow = always\n',
    "utf8",
  );
}

/** A bare repository with one commit, usable as a local submodule remote. */
async function seedSubmoduleRemote(): Promise<BareRemoteFixture> {
  const seed = await createRepo({ initialCommit: true });
  const remote = await createBareRemote();
  await seed.git(["remote", "add", "origin", remote.path]);
  await seed.git(["push", "origin", "main"]);
  await seed.dispose();
  return remote;
}

describe("worktrees", () => {
  it("creates a linked worktree with a new branch and lists it", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const record = await submitAndWait(service, {
        clientRequestId: "wt-create-new-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "createWorktree",
          relativeDestination: "feature-tree",
          reference: {
            kind: "newBranch",
            branchName: "feature-tree",
            startOid: (await repo.headOid()).trim(),
          },
        },
      });
      expect(record.status).toBe("succeeded");
      const worktrees = await readWorktrees(service);
      expect(worktrees.length).toBe(2);
      const created = worktrees.find((entry) => !entry.isMain);
      expect(created?.head.branchName).toEqual("feature-tree");
      // The checkout exists on disk with the repository's content.
      const content = await readFile(
        join(created?.displayPath ?? "", "a.txt"),
        "utf8",
      );
      expect(content).toEqual("base\n");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("creates a detached worktree at an explicit commit", async () => {
    const repo = await createRepo({ initialCommit: true });
    const oid = (await repo.headOid()).trim();
    const service = await startService(repo);
    try {
      const record = await submitAndWait(service, {
        clientRequestId: "wt-create-detached-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "createWorktree",
          relativeDestination: "detached-tree",
          reference: { kind: "detached", oid },
        },
      });
      expect(record.status).toBe("succeeded");
      const worktrees = await readWorktrees(service);
      const created = worktrees.find((entry) => !entry.isMain);
      expect(created?.head.branchName).toBeNull();
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a destination that escapes the approved root", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "wt-escape-1",
          target: await repositoryTarget(service),
          operation: {
            kind: "createWorktree",
            relativeDestination: "../../outside-the-root",
            reference: { kind: "detached", oid: (await repo.headOid()).trim() },
          },
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("never removes the primary worktree", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const worktrees = await readWorktrees(service);
      const main = worktrees.find((entry) => entry.isMain);
      if (main === undefined) {
        throw new Error("fixture has no primary worktree");
      }
      const record = await submitAndWait(service, {
        clientRequestId: "wt-remove-main-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "removeWorktree",
          worktreeId: main.worktreeId,
          confirmed: true,
        },
      });
      expect(record.status).not.toBe("succeeded");
      expect(record.problem?.code).toBe("Conflict");
      // The repository is intact.
      expect((await repo.gitResult(["status", "--porcelain=v2"])).code).toBe(0);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("removes a clean linked worktree but refuses a dirty one", async () => {
    // Prevents: a remove that falls back to deleting files Git would not remove.
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      await submitAndWait(service, {
        clientRequestId: "wt-create-for-remove-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "createWorktree",
          relativeDestination: "to-remove",
          reference: {
            kind: "newBranch",
            branchName: "to-remove",
            startOid: (await repo.headOid()).trim(),
          },
        },
      });
      const created = (await readWorktrees(service)).find(
        (entry) => !entry.isMain,
      );
      if (created === undefined) {
        throw new Error("the worktree was not created");
      }
      // Make it dirty: Git refuses to remove it, and nothing may delete the files.
      const dirtyPath = join(created.displayPath, "dirty.txt");
      await writeFile(dirtyPath, "dirty in the linked worktree\n");
      const dirty = await submitAndWait(service, {
        clientRequestId: "wt-remove-dirty-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "removeWorktree",
          worktreeId: created.worktreeId,
          confirmed: true,
        },
      });
      expect(dirty.status).toBe("failed");
      expect(await readFile(dirtyPath, "utf8")).toEqual(
        "dirty in the linked worktree\n",
      );

      // Clean it and remove: Git's own state allows it now.
      await rm(dirtyPath);
      const removed = await submitAndWait(service, {
        clientRequestId: "wt-remove-clean-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "removeWorktree",
          worktreeId: created.worktreeId,
          confirmed: true,
        },
      });
      expect(removed.status).toBe("succeeded");
      const after = await readWorktrees(service);
      expect(after.length).toBe(1);
      expect(after[0]?.isMain).toBe(true);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("removes without confirmation is refused at the boundary", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "wt-remove-unconfirmed-1",
          target: await repositoryTarget(service),
          operation: {
            kind: "removeWorktree",
            worktreeId: "wt_anything",
          },
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("locks and unlocks a worktree with a reason", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      await submitAndWait(service, {
        clientRequestId: "wt-create-for-lock-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "createWorktree",
          relativeDestination: "locked-tree",
          reference: {
            kind: "newBranch",
            branchName: "locked-tree",
            startOid: (await repo.headOid()).trim(),
          },
        },
      });
      const created = (await readWorktrees(service)).find(
        (entry) => !entry.isMain,
      );
      if (created === undefined) {
        throw new Error("the worktree was not created");
      }
      const locked = await submitAndWait(service, {
        clientRequestId: "wt-lock-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "lockWorktree",
          worktreeId: created.worktreeId,
          reason: "on a removable disk",
        },
      });
      expect(locked.status).toBe("succeeded");
      const afterLock = (await readWorktrees(service)).find(
        (entry) => entry.worktreeId === created.worktreeId,
      );
      expect(afterLock?.isLocked).toBe(true);
      expect(afterLock?.lockReason).toEqual("on a removable disk");

      // A locked worktree cannot be removed: Git refuses, and that is the answer.
      const refused = await submitAndWait(service, {
        clientRequestId: "wt-remove-locked-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "removeWorktree",
          worktreeId: created.worktreeId,
          confirmed: true,
        },
      });
      expect(refused.status).toBe("failed");

      const unlocked = await submitAndWait(service, {
        clientRequestId: "wt-unlock-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "unlockWorktree",
          worktreeId: created.worktreeId,
        },
      });
      expect(unlocked.status).toBe("succeeded");
      const afterUnlock = (await readWorktrees(service)).find(
        (entry) => entry.worktreeId === created.worktreeId,
      );
      expect(afterUnlock?.isLocked).toBe(false);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("submodules", () => {
  it("adds a submodule from a local remote and reports its three object names", async () => {
    const repo = await createRepo({ initialCommit: true });
    await allowFileTransport(repo);
    const subRemote = await seedSubmoduleRemote();
    const service = await startService(repo);
    try {
      const record = await submitAndWait(service, {
        clientRequestId: "sub-add-1",
        target: await worktreeTarget(service),
        operation: {
          kind: "addSubmodule",
          remoteUrl: subRemote.path,
          relativePath: "vendor/lib",
          branchName: null,
          initialize: true,
        },
      });
      expect(record.status).toBe("succeeded");
      const gitmodules = await repo.readText(".gitmodules");
      expect(gitmodules).toContain("vendor/lib");
      const submodules = await readSubmodules(service);
      expect(submodules.length).toBe(1);
      const entry = submodules[0];
      expect(entry?.state).toBe("initialized");
      // The add stages the gitlink but the test has not committed it, so there is
      // nothing for the parent *commit* to record yet — the three object names are
      // distinct on purpose, and only the index and the checkout exist here.
      expect(entry?.indexOid).not.toBeNull();
      expect(entry?.actualOid).toEqual(entry?.indexOid);
      expect(entry?.recordedOid).toBeNull();
    } finally {
      await service.close();
      await repo.dispose();
      await subRemote.dispose();
    }
  });

  it("refuses a transport-helper submodule URL at the boundary", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "sub-helper-1",
          target: await worktreeTarget(service),
          operation: {
            kind: "addSubmodule",
            remoteUrl: "ext::sh -c whoami",
            relativePath: "vendor/evil",
            branchName: null,
            initialize: true,
          },
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("updates a submodule to exactly the recorded commit", async () => {
    const repo = await createRepo({ initialCommit: true });
    await allowFileTransport(repo);
    const subRemote = await seedSubmoduleRemote();
    const service = await startService(repo);
    try {
      await submitAndWait(service, {
        clientRequestId: "sub-add-for-update-1",
        target: await worktreeTarget(service),
        operation: {
          kind: "addSubmodule",
          remoteUrl: subRemote.path,
          relativePath: "vendor/lib",
          branchName: null,
          initialize: true,
        },
      });
      // The test commits the staged gitlink, so the parent commit now records a
      // submodule commit and `update` has something explicit to restore.
      await repo.commitAll("add the submodule");
      const before = (await readSubmodules(service))[0];
      if (before === undefined) {
        throw new Error("no submodule was added");
      }
      if (before.recordedOid === null) {
        throw new Error("the parent commit does not record the submodule");
      }
      // The remote moves ahead: a second clone pushes a new commit to it.
      const otherSeed = await createRepo({ initialCommit: true });
      await otherSeed.git(["remote", "add", "origin", subRemote.path]);
      await otherSeed.write("newer.txt", "newer\n");
      await otherSeed.commitAll("newer");
      await otherSeed.git(["push", "origin", "main"]);
      await otherSeed.dispose();
      const remoteHead = new TextDecoder()
        .decode(await subRemote.git(["rev-parse", "refs/heads/main"]))
        .trim();
      expect(remoteHead).not.toEqual(before.recordedOid);

      // Wipe the submodule checkout: update must restore the recorded commit.
      await rm(join(repo.root, "vendor/lib"), { recursive: true, force: true });
      const record = await submitAndWait(service, {
        clientRequestId: "sub-update-1",
        target: await worktreeTarget(service),
        operation: {
          kind: "updateSubmodule",
          pathIds: [before.pathId],
          initialize: true,
          recursive: false,
        },
      });
      expect(record.status).toBe("succeeded");
      const after = (await readSubmodules(service))[0];
      // The recorded commit, not the newer one the remote now has: `update` never
      // implies `--remote`.
      expect(after?.actualOid).toEqual(before.recordedOid);
      expect(after?.actualOid).not.toEqual(remoteHead);
    } finally {
      await service.close();
      await repo.dispose();
      await subRemote.dispose();
    }
  });

  it("syncs submodule URLs from the parent configuration", async () => {
    const repo = await createRepo({ initialCommit: true });
    await allowFileTransport(repo);
    const subRemote = await seedSubmoduleRemote();
    const service = await startService(repo);
    try {
      await submitAndWait(service, {
        clientRequestId: "sub-add-for-sync-1",
        target: await worktreeTarget(service),
        operation: {
          kind: "addSubmodule",
          remoteUrl: subRemote.path,
          branchName: null,
          relativePath: "vendor/lib",
          initialize: true,
        },
      });
      const entry = (await readSubmodules(service))[0];
      if (entry === undefined) {
        throw new Error("no submodule was added");
      }
      // Change the URL the parent records, then sync.
      const gitmodules = await repo.readText(".gitmodules");
      const otherRemote = await seedSubmoduleRemote();
      try {
        await repo.write(
          ".gitmodules",
          gitmodules.replace(subRemote.path, otherRemote.path),
        );
        const record = await submitAndWait(service, {
          clientRequestId: "sub-sync-1",
          target: await worktreeTarget(service),
          operation: {
            kind: "syncSubmodule",
            pathIds: [entry.pathId],
            recursive: false,
          },
        });
        expect(record.status).toBe("succeeded");
        const configUrl = new TextDecoder().decode(
          await repo.git(["config", "--get", `submodule.vendor/lib.url`]),
        );
        expect(configUrl).toContain(otherRemote.path);
      } finally {
        await otherRemote.dispose();
      }
    } finally {
      await service.close();
      await repo.dispose();
      await subRemote.dispose();
    }
  });
});
