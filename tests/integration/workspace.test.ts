/**
 * Creating a repository: `initRepository` and `cloneRepository`, through the API.
 *
 * These are the two operations whose target is a **workspace** — an approved root plus
 * a destination inside it — so the questions are different from every other mutation
 * suite. There is no repository to read first; the point of the operation is that one
 * comes into being. What the cases therefore check is:
 *
 * - the destination is created *inside the approved root* and nowhere else, and a
 *   relative path that would leave it is refused before anything touches the disk;
 * - the new repository is registered and immediately readable through the same API a
 *   UI would use, because a repository the service cannot read is not a result;
 * - a clone that Git refuses registers **nothing** and deletes **nothing** the user
 *   put there — the failure is reported with Git's own diagnostic.
 *
 * The remote is a local bare repository under the fixture's scratch root: no network,
 * no credential helper, no hosting dependency.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  repositoriesResponseSchema,
  statusSnapshotSchema,
} from "@refyard/git-contract";
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

const decoder = new TextDecoder();

async function startedService(repo: GitFixtureRepo): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

/** A workspace target inside this service's own approved root. */
function workspaceTarget(
  service: TestService,
  relativeDestination: string,
): object {
  return {
    kind: "workspace",
    allowedRootId: service.allowedRootId,
    relativeDestination,
  };
}

async function listRepositories(
  service: TestService,
): Promise<readonly { repositoryId: string; displayPath: string }[]> {
  const response = await service.fetch("/api/v1/repositories");
  expect(response.status).toBe(200);
  return repositoriesResponseSchema.parse(await response.json()).repositories;
}

describe("initRepository", () => {
  it("creates the repository at the destination and registers it, readable at once", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startedService(repo);
    try {
      const before = await listRepositories(service);
      const record = await submitAndWait(service, {
        clientRequestId: "init-1",
        target: workspaceTarget(service, "nested/created"),
        operation: { kind: "initRepository", initialBranch: "trunk" },
      });
      expect(record.status).toBe("succeeded");
      expect(record.result?.summary).toContain("nested/created");
      // On disk: a repository whose HEAD names the branch that was asked for.
      const created = join(repo.root, "nested", "created");
      const head = decoder
        .decode(
          await repo.git(["-C", created, "symbolic-ref", "--short", "HEAD"]),
        )
        .trim();
      expect(head).toBe("trunk");

      // Registered, and readable through the API a UI uses — a repository the service
      // cannot read is not a result anyone can act on.
      const after = await listRepositories(service);
      expect(after.length).toBe(before.length + 1);
      const registered = after.find((entry) =>
        entry.displayPath.endsWith("nested/created"),
      );
      expect(registered).toBeDefined();
      const status = await service.fetch(
        `/api/v1/status?repositoryId=${registered?.repositoryId ?? ""}`,
      );
      expect(status.status).toBe(200);
      const parsed = statusSnapshotSchema.parse(await status.json());
      // An empty repository: the branch is unborn and there is nothing to list.
      expect(parsed.entries).toEqual([]);
      expect(parsed.head.branchName).toBe("trunk");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("leaves the branch to Git when the request says null", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startedService(repo);
    try {
      const record = await submitAndWait(service, {
        clientRequestId: "init-2",
        target: workspaceTarget(service, "defaulted"),
        operation: { kind: "initRepository", initialBranch: null },
      });
      expect(record.status).toBe("succeeded");
      const head = decoder
        .decode(
          await repo.git([
            "-C",
            join(repo.root, "defaulted"),
            "symbolic-ref",
            "--short",
            "HEAD",
          ]),
        )
        .trim();
      // The fixture pins the default in its own global config; what matters is that
      // the service did not invent a name of its own.
      expect(head).toBe("main");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a destination that would leave the approved root, creating nothing", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startedService(repo);
    try {
      const response = await service.fetch("/api/v1/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "init-escape",
          target: workspaceTarget(service, "../outside"),
          operation: { kind: "initRepository", initialBranch: null },
        }),
      });
      expect(response.status).toBe(400);
      const body = (await response.text()).toString();
      expect(body).toContain("InvalidRequest");
      // Nothing was created outside the root, and nothing was created inside it either.
      await expect(
        readFile(join(repo.scratchRoot, "outside", ".git", "HEAD")),
      ).rejects.toThrow();
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("cloneRepository", () => {
  it("clones a local bare remote, registers it, and its history is readable", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    const service = await startedService(repo);
    try {
      await repo.git(["push", "--quiet", remote.path, "main"]);
      const originOid = (await repo.headOid()).trim();

      const record = await submitAndWait(service, {
        clientRequestId: "clone-1",
        target: workspaceTarget(service, "cloned"),
        operation: {
          kind: "cloneRepository",
          remoteUrl: remote.path,
          relativeDestination: "cloned",
          initializeSubmodules: false,
        },
      });
      expect(record.status).toBe("succeeded");
      // The result names the tip the clone landed on, so a UI can move straight to it.
      expect(record.result?.newHeadOid).toBe(originOid);
      expect(await readFile(join(repo.root, "cloned", "a.txt"), "utf8")).toBe(
        "base\n",
      );

      const repositories = await listRepositories(service);
      const cloned = repositories.find((entry) =>
        entry.displayPath.endsWith("cloned"),
      );
      expect(cloned).toBeDefined();
      const history = await service.fetch(
        `/api/v1/history?repositoryId=${cloned?.repositoryId ?? ""}&limit=10`,
      );
      expect(history.status).toBe(200);
      const page = (await history.json()) as {
        commits: readonly { oid: string }[];
      };
      expect(page.commits[0]?.oid).toBe(originOid);
    } finally {
      await service.close();
      await remote.dispose();
      await repo.dispose();
    }
  });

  it("registers nothing and deletes nothing when the destination already holds files", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    const service = await startedService(repo);
    try {
      await repo.git(["push", "--quiet", remote.path, "main"]);
      await repo.write("occupied/keep.txt", "mine\n");
      const before = await listRepositories(service);

      const record = await submitAndWait(service, {
        clientRequestId: "clone-occupied",
        target: workspaceTarget(service, "occupied"),
        operation: {
          kind: "cloneRepository",
          remoteUrl: remote.path,
          relativeDestination: "occupied",
          initializeSubmodules: false,
        },
      });
      expect(record.status).toBe("failed");
      // Git's own diagnostic, not a paraphrase: the user is told what Git said.
      expect(record.problem?.message ?? "").toMatch(/empty/i);
      // The user's file is exactly where they left it, and no repository was added.
      expect(
        await readFile(join(repo.root, "occupied", "keep.txt"), "utf8"),
      ).toBe("mine\n");
      expect(await listRepositories(service)).toHaveLength(before.length);
    } finally {
      await service.close();
      await remote.dispose();
      await repo.dispose();
    }
  });
});
