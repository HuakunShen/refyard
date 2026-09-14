/**
 * T09 end to end: branches, remotes, and the network operations.
 *
 * Remotes here are local bare repositories under the fixture's own scratch root —
 * no network, no hosting dependency, no credentials. The cases are the ones where a
 * Git client gets dangerous: a push that publishes more than was selected, a pull
 * that merges or rebases without being asked, a delete that loses unmerged work, a
 * switch that discards local changes, and a remote URL that is a transport helper
 * in disguise.
 */
import { describe, expect, it } from "vitest";
import {
  refsSnapshotSchema,
  statusSnapshotSchema,
} from "../../packages/git-contract/src/index.js";
import { createBareRemote, createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  submitAndWait,
  type TestService,
} from "../support/service.js";

interface Refs {
  readonly snapshotId: string;
  readonly head: { branchName: string | null; oid: string | null };
  readonly branches: readonly {
    name: string;
    oid: string;
    isCurrent: boolean;
    upstream: { fullName: string; ahead: number; behind: number; gone: boolean } | null;
  }[];
  readonly remotes: readonly {
    name: string;
    fetchUrlDisplay: string;
    pushUrlDisplay: string | null;
  }[];
  readonly remoteBranches: readonly { name: string; oid: string }[];
}

async function readRefs(service: TestService): Promise<Refs> {
  const response = await service.fetch(
    `/api/v1/refs?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const parsed = refsSnapshotSchema.parse(await response.json());
  return {
    snapshotId: parsed.snapshotId,
    head: {
      branchName: parsed.head.branchName,
      oid: parsed.head.oid,
    },
    branches: parsed.branches.map((branch) => ({
      name: branch.name,
      oid: branch.oid,
      isCurrent: branch.isCurrent,
      upstream: branch.upstream,
    })),
    remotes: parsed.remotes.map((remote) => ({
      name: remote.name,
      fetchUrlDisplay: remote.fetchUrlDisplay,
      pushUrlDisplay: remote.pushUrlDisplay,
    })),
    remoteBranches: parsed.remoteBranches.map((entry) => ({
      name: entry.name,
      oid: entry.oid,
    })),
  };
}

async function repositoryTarget(
  service: TestService,
): Promise<{ refs: Refs; target: object }> {
  const refs = await readRefs(service);
  return {
    refs,
    target: {
      kind: "repository",
      repositoryId: service.repositoryId,
      expectedSnapshotId: refs.snapshotId,
    },
  };
}

async function worktreeTarget(
  service: TestService,
): Promise<{ snapshotId: string; worktreeId: string; target: object }> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  const status = statusSnapshotSchema.parse(await response.json());
  return {
    snapshotId: status.snapshotId,
    worktreeId: status.worktreeId,
    target: {
      kind: "worktree",
      repositoryId: service.repositoryId,
      worktreeId: status.worktreeId,
      expectedSnapshotId: status.snapshotId,
    },
  };
}

async function startNetworkService(
  repo: GitFixtureRepo,
): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  // Every request this file makes is an authenticated client; the bearer is
  // attached once here instead of threaded through each call.
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

function branchNames(refs: Refs): readonly string[] {
  return refs.branches.map((branch) => branch.name);
}

describe("branches", () => {
  it("creates a branch without moving HEAD", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startNetworkService(repo);
    try {
      const before = await readRefs(service);
      const { target } = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "branch-create-1",
        target,
        operation: {
          kind: "createBranch",
          branchName: "feature",
          startOid: null,
          switchToIt: false,
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readRefs(service);
      expect(branchNames(after)).toContain("feature");
      expect(after.head.branchName).toEqual(before.head.branchName);
      const created = after.branches.find((branch) => branch.name === "feature");
      expect(created?.oid).toEqual(before.head.oid);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("creates and switches in one operation when asked", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "branch-create-switch-1",
        target,
        operation: {
          kind: "createBranch",
          branchName: "feature-two",
          startOid: null,
          switchToIt: true,
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readRefs(service);
      expect(after.head.branchName).toEqual("feature-two");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a branch name that is invalid rather than passing it to Git", async () => {
    // Prevents: a name like `-D` or `a..b` reaching Git as something other than a
    // branch name — the schema closes this at the boundary, and this test is the
    // evidence that it does.
    const repo = await createRepo({ initialCommit: true });
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "branch-invalid-1",
          target,
          operation: {
            kind: "createBranch",
            branchName: "-D",
            startOid: null,
            switchToIt: false,
          },
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("switches branches and reports the new HEAD", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.git(["branch", "other"]);
    const service = await startNetworkService(repo);
    try {
      const { target } = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "switch-1",
        target,
        operation: { kind: "switchBranch", branchName: "other" },
      });
      expect(record.status).toBe("succeeded");
      const after = await readRefs(service);
      expect(after.head.branchName).toEqual("other");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a switch that would overwrite local changes", async () => {
    // Prevents: a checkout that silently discards uncommitted work. Git refuses it
    // and this service reports that refusal instead of forcing.
    const repo = await createRepo({ initialCommit: true });
    await repo.git(["branch", "other"]);
    await repo.git(["switch", "other"]);
    await repo.write("a.txt", "divergent on other\n");
    await repo.commitAll("on other");
    await repo.git(["switch", "main"]);
    await repo.write("a.txt", "uncommitted local work\n");
    const service = await startNetworkService(repo);
    try {
      const { target } = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "switch-refused-1",
        target,
        operation: { kind: "switchBranch", branchName: "other" },
      });
      expect(record.status).toBe("failed");
      expect(record.problem?.code).toBe("GitCommandFailed");
      expect(await repo.readText("a.txt")).toEqual("uncommitted local work\n");
      const after = await readRefs(service);
      expect(after.head.branchName).toEqual("main");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("renames a branch and keeps it current", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "rename-1",
        target,
        operation: {
          kind: "renameBranch",
          branchName: "main",
          newName: "trunk",
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readRefs(service);
      expect(branchNames(after)).toContain("trunk");
      expect(branchNames(after)).not.toContain("main");
      expect(after.head.branchName).toEqual("trunk");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("deletes a merged branch but refuses an unmerged one", async () => {
    // Prevents: `git branch -D` semantics sneaking in — the contract has no force
    // delete, and an unmerged branch must survive a delete request.
    const repo = await createRepo({ initialCommit: true });
    await repo.git(["branch", "merged"]);
    await repo.git(["switch", "-c", "unmerged"]);
    await repo.write("b.txt", "unmerged work\n");
    await repo.commitAll("unmerged commit");
    await repo.git(["switch", "main"]);
    const service = await startNetworkService(repo);
    try {
      const first = await repositoryTarget(service);
      const merged = await submitAndWait(service, {
        clientRequestId: "delete-merged-1",
        target: first.target,
        operation: {
          kind: "deleteBranch",
          branchName: "merged",
          confirmed: true,
        },
      });
      expect(merged.status).toBe("succeeded");
      expect(branchNames(await readRefs(service))).not.toContain("merged");

      const second = await repositoryTarget(service);
      const refused = await submitAndWait(service, {
        clientRequestId: "delete-unmerged-1",
        target: second.target,
        operation: {
          kind: "deleteBranch",
          branchName: "unmerged",
          confirmed: true,
        },
      });
      expect(refused.status).toBe("failed");
      expect(branchNames(await readRefs(service))).toContain("unmerged");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("rejects a delete without explicit confirmation at the boundary", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "delete-unconfirmed-1",
          target,
          operation: { kind: "deleteBranch", branchName: "main" },
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("sets and clears a branch upstream", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["push", "origin", "main"]);
    const service = await startNetworkService(repo);
    try {
      const first = await repositoryTarget(service);
      const set = await submitAndWait(service, {
        clientRequestId: "upstream-set-1",
        target: first.target,
        operation: {
          kind: "setBranchUpstream",
          branchName: "main",
          upstream: { remoteName: "origin", branchName: "main" },
        },
      });
      expect(set.status).toBe("succeeded");
      const withUpstream = await readRefs(service);
      const main = withUpstream.branches.find((branch) => branch.name === "main");
      expect(main?.upstream?.fullName).toEqual("refs/remotes/origin/main");

      const second = await repositoryTarget(service);
      const cleared = await submitAndWait(service, {
        clientRequestId: "upstream-clear-1",
        target: second.target,
        operation: {
          kind: "setBranchUpstream",
          branchName: "main",
          upstream: null,
        },
      });
      expect(cleared.status).toBe("succeeded");
      const without = await readRefs(service);
      const plain = without.branches.find((branch) => branch.name === "main");
      expect(plain?.upstream).toBeNull();
    } finally {
      await service.close();
      await repo.dispose();
      await remote.dispose();
    }
  });
});

describe("remotes", () => {
  it("adds, updates and removes a remote", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    const service = await startNetworkService(repo);
    try {
      const first = await repositoryTarget(service);
      const added = await submitAndWait(service, {
        clientRequestId: "remote-add-1",
        target: first.target,
        operation: {
          kind: "addRemote",
          remoteName: "origin",
          fetchUrl: remote.path,
          pushUrl: null,
        },
      });
      expect(added.status).toBe("succeeded");
      const withRemote = await readRefs(service);
      expect(withRemote.remotes.map((entry) => entry.name)).toEqual(["origin"]);

      const second = await repositoryTarget(service);
      const updated = await submitAndWait(service, {
        clientRequestId: "remote-update-1",
        target: second.target,
        operation: {
          kind: "updateRemote",
          remoteName: "origin",
          newName: "upstream",
          fetchUrl: `${remote.path}`,
          pushUrl: null,
        },
      });
      expect(updated.status).toBe("succeeded");
      const renamed = await readRefs(service);
      expect(renamed.remotes.map((entry) => entry.name)).toEqual(["upstream"]);

      const third = await repositoryTarget(service);
      const removed = await submitAndWait(service, {
        clientRequestId: "remote-remove-1",
        target: third.target,
        operation: {
          kind: "removeRemote",
          remoteName: "upstream",
          confirmed: true,
        },
      });
      expect(removed.status).toBe("succeeded");
      const empty = await readRefs(service);
      expect(empty.remotes).toEqual([]);
    } finally {
      await service.close();
      await repo.dispose();
      await remote.dispose();
    }
  });

  it("refuses a transport-helper URL at the boundary", async () => {
    // Prevents: `ext::sh -c …` and friends being accepted as a remote URL, which
    // would run a program Git is configured to trust. The refusal happens before an
    // operation is accepted, so there is nothing to look up afterwards either.
    const repo = await createRepo({ initialCommit: true });
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "remote-helper-1",
          target,
          operation: {
            kind: "addRemote",
            remoteName: "evil",
            fetchUrl: "ext::sh -c 'touch /tmp/refyard-pwned'",
            pushUrl: null,
          },
        }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        problem: { code: string; message: string };
      };
      expect(body.problem.code).toBe("InvalidRequest");
      expect(body.problem.message).toContain("transport helper");
      const after = await readRefs(service);
      expect(after.remotes).toEqual([]);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("never returns a credential from a remote URL", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.git([
      "remote",
      "add",
      "origin",
      "https://user:secret-token@example.com/team/repo.git",
    ]);
    const service = await startNetworkService(repo);
    try {
      const refs = await readRefs(service);
      const remote = refs.remotes.find((entry) => entry.name === "origin");
      expect(remote?.fetchUrlDisplay).not.toContain("secret-token");
      expect(remote?.fetchUrlDisplay).toContain("example.com");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("fetch, push and pull", () => {
  it("pushes only the explicitly selected branch", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["branch", "do-not-push"]);
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "push-1",
        target,
        operation: {
          kind: "push",
          remoteName: "origin",
          sourceRef: "refs/heads/main",
          destinationRef: "refs/heads/main",
          setUpstream: true,
        },
      });
      expect(record.status).toBe("succeeded");
      const heads = new TextDecoder().decode(
        await remote.git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
      );
      expect(heads).toContain("refs/heads/main");
      expect(heads).not.toContain("do-not-push");
      const after = await readRefs(service);
      const main = after.branches.find((branch) => branch.name === "main");
      expect(main?.upstream?.fullName).toEqual("refs/remotes/origin/main");
    } finally {
      await service.close();
      await repo.dispose();
      await remote.dispose();
    }
  });

  it("reports a rejected push per ref and leaves the remote unchanged", async () => {
    // Prevents: reporting "pushed" from a non-zero exit that includes a partial
    // success, or the reverse. The porcelain result is per ref.
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["push", "origin", "main"]);
    // Rewrite local history so the push is a non-fast-forward.
    await repo.git(["commit", "--amend", "-m", "rewritten"], {
      env: { GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
    });
    const service = await startNetworkService(repo);
    try {
      const { target } = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "push-rejected-1",
        target,
        operation: {
          kind: "push",
          remoteName: "origin",
          sourceRef: "refs/heads/main",
          destinationRef: "refs/heads/main",
          setUpstream: false,
        },
      });
      expect(record.status).toBe("failed");
      const remoteMain = new TextDecoder().decode(
        await remote.git(["rev-parse", "refs/heads/main"]),
      ).trim();
      const localMain = (await repo.headOid()).trim();
      expect(remoteMain).not.toEqual(localMain);
    } finally {
      await service.close();
      await repo.dispose();
      await remote.dispose();
    }
  });

  it("fetch updates remote-tracking refs and leaves local branches alone", async () => {
    const repo = await createRepo({ initialCommit: true });
    const other = await createRepo({ initialCommit: false });
    const remote = await createBareRemote();
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["push", "-u", "origin", "main"]);
    // A second clone adds a commit and pushes it.
    await other.git(["remote", "add", "origin", remote.path]);
    await other.git(["fetch", "origin"]);
    await other.git(["switch", "-c", "main", "--track", "origin/main"]);
    await other.write("from-other.txt", "other work\n");
    await other.commitAll("work from the other clone");
    await other.git(["push", "origin", "main"]);

    const service = await startNetworkService(repo);
    try {
      const localBefore = (await repo.headOid()).trim();
      const { target } = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "fetch-1",
        target,
        operation: { kind: "fetch", remoteName: "origin", prune: false, tags: "none" },
      });
      expect(record.status).toBe("succeeded");
      const after = await readRefs(service);
      const tracking = after.remoteBranches.find(
        (entry) => entry.name === "origin/main",
      );
      expect(tracking?.oid).not.toEqual(localBefore);
      // The local branch did not move: fetch changes remote-tracking refs only.
      expect((await repo.headOid()).trim()).toEqual(localBefore);
    } finally {
      await service.close();
      await repo.dispose();
      await other.dispose();
      await remote.dispose();
    }
  });

  it("pulls ff-only to fast-forward, and refuses a divergence without touching the branch", async () => {
    const repo = await createRepo({ initialCommit: true });
    const other = await createRepo({ initialCommit: false });
    const remote = await createBareRemote();
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["push", "-u", "origin", "main"]);
    await other.git(["remote", "add", "origin", remote.path]);
    await other.git(["fetch", "origin"]);
    await other.git(["switch", "-c", "main", "--track", "origin/main"]);
    await other.write("from-other.txt", "other work\n");
    await other.commitAll("work from the other clone");
    await other.git(["push", "origin", "main"]);

    const service = await startNetworkService(repo);
    try {
      // Fast-forward case: local is strictly behind.
      const first = await worktreeTarget(service);
      const fastForward = await submitAndWait(service, {
        clientRequestId: "pull-ff-1",
        target: first.target,
        operation: { kind: "pull", remoteName: "origin", mode: "ff-only" },
      });
      expect(fastForward.status).toBe("succeeded");
      expect(await repo.readText("from-other.txt")).toEqual("other work\n");

      // Divergence case: both sides have a commit.
      await repo.write("local.txt", "local work\n");
      await repo.commitAll("local commit");
      const localMainBefore = (await repo.headOid()).trim();
      await other.write("other-2.txt", "more from other\n");
      await other.commitAll("second from other");
      await other.git(["push", "origin", "main"]);

      const second = await worktreeTarget(service);
      const divergent = await submitAndWait(service, {
        clientRequestId: "pull-diverged-1",
        target: second.target,
        operation: { kind: "pull", remoteName: "origin", mode: "ff-only" },
      });
      expect(divergent.status).toBe("failed");
      // The branch did not move and no merge happened.
      expect((await repo.headOid()).trim()).toEqual(localMainBefore);
      const after = await readRefs(service);
      const main = after.branches.find((branch) => branch.name === "main");
      expect(main?.oid).toEqual(localMainBefore);
    } finally {
      await service.close();
      await repo.dispose();
      await other.dispose();
      await remote.dispose();
    }
  });
});
