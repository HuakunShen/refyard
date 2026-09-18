/**
 * The native HTTP surface against the published contract, using the browser's own clients.
 *
 * `createGitClient` and `createMutationClient` are the same classes the SvelteKit
 * workbench ships: the same paths, the same query spellings, the same DTO expectations.
 * Driving them against the native service and validating every answer with the contract's
 * own Zod schema is the check that the native boundary speaks the API the product already
 * speaks — a wrong parameter name or a missing field fails here, not in a browser later.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGitClient, createMutationClient, type GitClient, type MutationClient } from "@refyard/git-client";
import {
  capabilitiesResponseSchema,
  diffResponseSchema,
  historyPageSchema,
  operationRecordSchema,
  previewsResponseSchema,
  refsSnapshotSchema,
  repositoriesResponseSchema,
  statusSnapshotSchema,
} from "@refyard/git-contract";

import { startNativeService, type RunningNativeService } from "./native-server.ts";

let service: RunningNativeService;
let client: GitClient;
let mutations: MutationClient;

beforeAll(async () => {
  service = await startNativeService();
  const token = await service.pair();
  const bearer = (): string => token;
  client = createGitClient({
    baseUrl: service.baseUrl,
    fetch: (input, init) => fetch(input, init),
    token: bearer,
  });
  mutations = createMutationClient({
    baseUrl: service.baseUrl,
    fetch: (input, init) => fetch(input, init),
    token: bearer,
  });
});

afterAll(async () => {
  await service.stop();
});

/** Polls a submission until it settles; a 202 is an acceptance, never a result. */
async function settled(operationId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const record = operationRecordSchema.parse(await mutations.get(operationId));
    if (record.status !== "accepted" && record.status !== "running") {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the operation ${operationId} did not settle`);
}

describe("the native service answers the contract the browser already speaks", () => {
  it("answers capabilities that validate", async () => {
    const parsed = capabilitiesResponseSchema.parse(await client.capabilities());
    expect(parsed.apiMajor).toBe(1);
    expect(parsed.reads).toContain("status");
    expect(parsed.operations.map((operation) => operation.kind)).toEqual([
      "stagePaths",
      "unstagePaths",
      "commit",
    ]);
  });

  it("lists the repository the process was started with", async () => {
    const parsed = repositoriesResponseSchema.parse(await client.repositories());
    expect(parsed.repositories).toHaveLength(1);
    expect(parsed.repositories[0]?.head.kind).toBe("born");
  });

  it("answers status, history and refs that validate", async () => {
    const repositories = repositoriesResponseSchema.parse(await client.repositories());
    const repositoryId = repositories.repositories[0]?.repositoryId as string;

    const status = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    expect(status.entries).toHaveLength(0);

    const history = historyPageSchema.parse(await client.history({ repositoryId }));
    expect(history.commits.map((commit) => commit.subject)).toEqual(["base"]);

    const refs = refsSnapshotSchema.parse(await client.refs({ repositoryId }));
    expect(refs.branches.map((branch) => branch.name)).toContain("main");
  });

  it("previews, stages and commits through the mutation surface", async () => {
    const repositories = repositoriesResponseSchema.parse(await client.repositories());
    const repositoryId = repositories.repositories[0]?.repositoryId as string;
    const status = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    const worktreeId = status.worktreeId;

    service.repo.write("a.txt", "changed\n");
    const changed = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    expect(changed.entries.map((entry) => entry.displayPath)).toContain("a.txt");
    const pathId = changed.entries.find((entry) => entry.displayPath === "a.txt")?.pathId as string;

    const previews = previewsResponseSchema.parse(
      await client.previews({ repositoryId, worktreeId, pathIds: [pathId] }),
    );
    expect(previews.tokens[0]?.fingerprintAlgorithm).toBe("sha256");

    const stage = await mutations.submit({
      clientRequestId: "native-contract-stage",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId,
        expectedSnapshotId: changed.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [pathId],
        previewTokens: [previews.tokens[0]?.previewToken as string],
      },
    });
    expect(stage.kind).toBe("accepted");
    const stagedRecord = await settled(
      stage.kind === "accepted" ? stage.accepted.operationId : "",
    );
    expect(stagedRecord.status).toBe("succeeded");

    const staged = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    // `a.txt` was committed at fixture time and modified here, so staging it marks the
    // index entry modified against HEAD, not added.
    expect(staged.entries[0]?.indexStatus).toBe("M");

    const commit = await mutations.submit({
      clientRequestId: "native-contract-commit",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId,
        expectedSnapshotId: staged.snapshotId,
      },
      operation: { kind: "commit", message: "committed from the contract suite" },
    });
    const commitRecord = await settled(
      commit.kind === "accepted" ? commit.accepted.operationId : "",
    );
    expect(commitRecord.status).toBe("succeeded");

    // Git itself is the judge: the commit is in the fixture's log with the exact message.
    const log = await service.repo.git(["log", "-1", "--format=%s"]);
    expect(new TextDecoder().decode(log).trim()).toBe("committed from the contract suite");
  });

  it("answers a diff of the committed work that validates", async () => {
    const repositories = repositoriesResponseSchema.parse(await client.repositories());
    const repositoryId = repositories.repositories[0]?.repositoryId as string;
    const history = historyPageSchema.parse(await client.history({ repositoryId }));
    const oid = history.commits[0]?.oid as string;
    const diff = diffResponseSchema.parse(
      await client.diff({ repositoryId, kind: "commit", oid }),
    );
    expect(diff.files.map((file) => file.displayPath)).toContain("a.txt");
  });

  // Prevents: a replay of the same request id running a second write. The byte-identical
  // replay answers as a duplicate carrying the original record.
  it("answers a byte-identical replay as a duplicate", async () => {
    const repositories = repositoriesResponseSchema.parse(await client.repositories());
    const repositoryId = repositories.repositories[0]?.repositoryId as string;
    const status = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    const worktreeId = status.worktreeId;
    const request = {
      clientRequestId: "native-contract-duplicate",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId,
        expectedSnapshotId: status.snapshotId,
      },
      operation: { kind: "commit", message: "a replayed commit" },
    } as const;
    const first = await mutations.submit(request);
    const second = await mutations.submit(request);
    const firstId = first.kind === "accepted" ? first.accepted.operationId : first.record.operationId;
    const secondId =
      second.kind === "accepted" ? second.accepted.operationId : second.record.operationId;
    expect(secondId).toBe(firstId);
    expect(second.kind).toBe("duplicate");
  });
});
