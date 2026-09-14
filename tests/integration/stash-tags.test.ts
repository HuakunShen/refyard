/**
 * T10 end to end: stashes and tags.
 *
 * The cases are the ways a stash or a tag operation loses something:
 *
 * - a `pop` that conflicts must leave the stash in place (Git's own rule, and the
 *   reason the outcome is `needsAttention` rather than a plain failure);
 * - a locator (`stash@{1}`) is a *position*, so an external `git stash` shifts it —
 *   the write resolves the locator to the OID the user saw and refuses a mismatch
 *   instead of popping whatever is now first;
 * - `apply` never drops; `drop` is confirmed and removes exactly one entry;
 * - a tag is never overwritten, and deleting one locally never touches the remote.
 */
import { describe, expect, it } from "vitest";
import {
  refsSnapshotSchema,
  statusSnapshotSchema,
  stashesResponseSchema,
} from "../../packages/git-contract/src/index.js";
import {
  createBareRemote,
  createRepo,
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

interface Stash {
  readonly oid: string;
  readonly locator: string;
  readonly message: string;
}

async function readStashes(service: TestService): Promise<readonly Stash[]> {
  const response = await service.fetch(
    `/api/v1/stashes?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const parsed = stashesResponseSchema.parse(await response.json());
  return parsed.stashes.map((stash) => ({
    oid: stash.oid,
    locator: stash.locator,
    message: stash.message,
  }));
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

async function tagNames(service: TestService): Promise<readonly string[]> {
  const response = await service.fetch(
    `/api/v1/refs?repositoryId=${service.repositoryId}`,
  );
  const refs = refsSnapshotSchema.parse(await response.json());
  return refs.tags.map((tag) => tag.name);
}

describe("stashes", () => {
  it("creates a stash and lists it with its locator", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "stashed work\n");
    const service = await startService(repo);
    try {
      const target = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "stash-create-1",
        target,
        operation: {
          kind: "createStash",
          message: "a save",
          includeUntracked: false,
          keepIndex: false,
        },
      });
      expect(record.status).toBe("succeeded");
      const stashes = await readStashes(service);
      expect(stashes.length).toBe(1);
      expect(stashes[0]?.message).toContain("a save");
      expect(stashes[0]?.locator).toEqual("stash@{0}");
      // The working tree is back to the committed content.
      expect(await repo.readText("a.txt")).toEqual("base\n");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("apply restores the changes and keeps the stash", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "stashed work\n");
    await repo.git(["stash", "push", "-m", "save"]);
    const service = await startService(repo);
    try {
      const stash = (await readStashes(service))[0];
      if (stash === undefined) {
        throw new Error("fixture produced no stash");
      }
      const target = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "stash-apply-1",
        target,
        operation: {
          kind: "applyStash",
          stash: { oid: stash.oid, locator: stash.locator },
          restoreIndex: false,
        },
      });
      expect(record.status).toBe("succeeded");
      expect(await repo.readText("a.txt")).toEqual("stashed work\n");
      // apply never drops.
      const after = await readStashes(service);
      expect(after.some((entry) => entry.oid === stash.oid)).toBe(true);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("pop restores the changes and drops the stash on success", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "stashed work\n");
    await repo.git(["stash", "push", "-m", "save"]);
    const service = await startService(repo);
    try {
      const stash = (await readStashes(service))[0];
      if (stash === undefined) {
        throw new Error("fixture produced no stash");
      }
      const target = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "stash-pop-1",
        target,
        operation: {
          kind: "popStash",
          stash: { oid: stash.oid, locator: stash.locator },
          restoreIndex: false,
          confirmed: true,
        },
      });
      expect(record.status).toBe("succeeded");
      expect(await repo.readText("a.txt")).toEqual("stashed work\n");
      expect(await readStashes(service)).toEqual([]);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("pop with a conflict preserves the stash and needs attention", async () => {
    // Prevents: a conflicted pop dropping the entry, which would destroy the only
    // copy of the stashed work.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "stashed\n");
    await repo.git(["stash", "push", "-m", "save"]);
    await repo.write("a.txt", "other\n");
    await repo.commitAll("other");
    const service = await startService(repo);
    try {
      const stash = (await readStashes(service))[0];
      if (stash === undefined) {
        throw new Error("fixture produced no stash");
      }
      const target = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "stash-pop-conflict-1",
        target,
        operation: {
          kind: "popStash",
          stash: { oid: stash.oid, locator: stash.locator },
          restoreIndex: false,
          confirmed: true,
        },
      });
      expect(record.status).toBe("needsAttention");
      const after = await readStashes(service);
      expect(after.some((entry) => entry.oid === stash.oid)).toBe(true);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses to apply when the locator now points at a different stash", async () => {
    // Prevents: `stash@{0}` meaning "the newest stash" instead of "the stash the
    // user selected" after an external `git stash` ran.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "first stash\n");
    await repo.git(["stash", "push", "-m", "first"]);
    const service = await startService(repo);
    try {
      const original = (await readStashes(service))[0];
      if (original === undefined) {
        throw new Error("fixture produced no stash");
      }
      // Someone else stashes: the locator stash@{0} now points at the new entry.
      await repo.write("b.txt", "second stash\n");
      await repo.git(["add", "--", "b.txt"]);
      await repo.git(["stash", "push", "-m", "second"]);

      const target = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "stash-moved-1",
        target,
        operation: {
          kind: "applyStash",
          stash: { oid: original.oid, locator: original.locator },
          restoreIndex: false,
        },
      });
      expect(record.status).toBe("failed");
      // Nothing was applied: a.txt still holds the committed content.
      expect(await repo.readText("a.txt")).toEqual("base\n");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("drops one stash, with confirmation, and nothing else", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "first stash\n");
    await repo.git(["stash", "push", "-m", "first"]);
    await repo.write("b.txt", "second stash\n");
    await repo.git(["add", "--", "b.txt"]);
    await repo.git(["stash", "push", "-m", "second"]);
    const service = await startService(repo);
    try {
      const stashes = await readStashes(service);
      const oldest = stashes.find((entry) => entry.message.includes("first"));
      if (oldest === undefined) {
        throw new Error("fixture produced no first stash");
      }
      const unconfirmed = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "stash-drop-unconfirmed-1",
          target: await repositoryTarget(service),
          operation: {
            kind: "dropStash",
            stash: { oid: oldest.oid, locator: oldest.locator },
          },
        }),
      });
      expect(unconfirmed.status).toBe(400);

      const record = await submitAndWait(service, {
        clientRequestId: "stash-drop-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "dropStash",
          stash: { oid: oldest.oid, locator: oldest.locator },
          confirmed: true,
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readStashes(service);
      expect(after.some((entry) => entry.oid === oldest.oid)).toBe(false);
      expect(after.length).toBe(1);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("includes untracked files only when asked", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("fresh.txt", "untracked\n");
    const service = await startService(repo);
    try {
      const target = await worktreeTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "stash-untracked-1",
        target,
        operation: {
          kind: "createStash",
          message: null,
          includeUntracked: true,
          keepIndex: false,
        },
      });
      expect(record.status).toBe("succeeded");
      // The untracked file went into the stash and left the worktree.
      await expect(repo.readText("fresh.txt")).rejects.toThrow();
      const stashes = await readStashes(service);
      expect(stashes.length).toBe(1);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("tags", () => {
  it("creates a lightweight tag at HEAD", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const target = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "tag-light-1",
        target,
        operation: {
          kind: "createTag",
          tagName: "v0.1.0",
          targetOid: null,
          annotation: null,
        },
      });
      expect(record.status).toBe("succeeded");
      expect(await tagNames(service)).toContain("v0.1.0");
      // A lightweight tag is exactly the commit object.
      const head = (await repo.headOid()).trim();
      const tagOid = new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/tags/v0.1.0"]))
        .trim();
      expect(tagOid).toEqual(head);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("creates an annotated tag with its message", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startService(repo);
    try {
      const target = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "tag-annotated-1",
        target,
        operation: {
          kind: "createTag",
          tagName: "v0.2.0",
          targetOid: null,
          annotation: { message: "release two\n" },
        },
      });
      expect(record.status).toBe("succeeded");
      const body = new TextDecoder().decode(
        await repo.git(["cat-file", "tag", "refs/tags/v0.2.0"]),
      );
      expect(body).toContain("release two");
      // An annotated tag is its own object, not the commit.
      const tagOid = new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/tags/v0.2.0"]))
        .trim();
      expect(tagOid).not.toEqual((await repo.headOid()).trim());
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses to overwrite an existing tag", async () => {
    // Prevents: a re-run silently moving a published tag to a different commit.
    const repo = await createRepo({ initialCommit: true });
    await repo.git(["tag", "v1.0.0"]);
    const service = await startService(repo);
    try {
      const target = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "tag-overwrite-1",
        target,
        operation: {
          kind: "createTag",
          tagName: "v1.0.0",
          targetOid: null,
          annotation: null,
        },
      });
      expect(record.status).toBe("failed");
      expect(record.problem?.code).toBe("Conflict");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("pushes one tag and deletes it locally without touching the remote", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["tag", "v1.2.3"]);
    const service = await startService(repo);
    try {
      const pushed = await submitAndWait(service, {
        clientRequestId: "tag-push-1",
        target: await repositoryTarget(service),
        operation: { kind: "pushTag", remoteName: "origin", tagName: "v1.2.3" },
      });
      expect(pushed.status).toBe("succeeded");
      const remoteTags = new TextDecoder().decode(
        await remote.git(["for-each-ref", "--format=%(refname)", "refs/tags"]),
      );
      expect(remoteTags).toContain("refs/tags/v1.2.3");

      const deleted = await submitAndWait(service, {
        clientRequestId: "tag-delete-1",
        target: await repositoryTarget(service),
        operation: {
          kind: "deleteTag",
          tagName: "v1.2.3",
          confirmed: true,
        },
      });
      expect(deleted.status).toBe("succeeded");
      expect(await tagNames(service)).not.toContain("v1.2.3");
      const remoteAfter = new TextDecoder().decode(
        await remote.git(["for-each-ref", "--format=%(refname)", "refs/tags"]),
      );
      // The remote tag is untouched: no implicit remote delete.
      expect(remoteAfter).toContain("refs/tags/v1.2.3");
    } finally {
      await service.close();
      await repo.dispose();
      await remote.dispose();
    }
  });

  it("creates a tag at an older commit when asked", async () => {
    const repo = await createRepo({ initialCommit: true });
    const older = (await repo.headOid()).trim();
    await repo.write("second.txt", "second\n");
    await repo.commitAll("second");
    const service = await startService(repo);
    try {
      const target = await repositoryTarget(service);
      const record = await submitAndWait(service, {
        clientRequestId: "tag-older-1",
        target,
        operation: {
          kind: "createTag",
          tagName: "v0.0.9",
          targetOid: older,
          annotation: null,
        },
      });
      expect(record.status).toBe("succeeded");
      const tagOid = new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/tags/v0.0.9"]))
        .trim();
      expect(tagOid).toEqual(older);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});
