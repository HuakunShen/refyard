/**
 * Runtime repository approval and revocation through the public HTTP service.
 *
 * The cases use the production CLI assembly against isolated fixture repositories. They
 * protect the form-2 boundary: a browser may add only the exact path it names, receives
 * no implicit parent grant, and loses access when the repository is revoked.
 */
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filesystemEntriesResponseSchema,
  repositoriesResponseSchema,
} from "@refyard/git-contract";
import { runService, type RunningService } from "../../apps/cli/src/serve.js";
import {
  createRepo,
  fixtureGitPath,
  type GitFixtureRepo,
} from "../support/repo.js";
import { ticketFrom } from "../support/service.js";

async function start(repository: GitFixtureRepo): Promise<RunningService> {
  return runService({
    repositoryPath: repository.root,
    stateRootPath: join(repository.scratchRoot, "state"),
    gitPath: fixtureGitPath(),
    port: 0,
    portExplicit: true,
    openBrowser: false,
    ticketTtlSeconds: 60,
    webRoot: null,
    allowRoot: false,
    installSignalHandlers: false,
    write: () => {},
  });
}

async function pair(running: RunningService): Promise<{
  readonly origin: string;
  readonly token: string;
}> {
  const origin = `http://127.0.0.1:${running.http.port}`;
  const response = await fetch(`${origin}/api/v1/session/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ ticket: ticketFrom(running.pairingUrl) }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return { origin, token: body.token };
}

async function register(
  origin: string,
  token: string,
  path: string,
): Promise<Response> {
  return fetch(`${origin}/api/v1/repositories/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin,
    },
    body: JSON.stringify({ path }),
  });
}

describe("managed workspaces", () => {
  it("browses bounded directories for the authenticated local path picker", async () => {
    const repo = await createRepo({ initialCommit: true });
    const running = await start(repo);
    try {
      const { origin, token } = await pair(running);
      const response = await fetch(
        `${origin}/api/v1/filesystem/entries?path=${encodeURIComponent(repo.scratchRoot)}`,
        { headers: { authorization: `Bearer ${token}`, origin } },
      );
      expect(response.status).toBe(200);
      const body = filesystemEntriesResponseSchema.parse(await response.json());
      expect(body.path).toBe(await realpath(repo.scratchRoot));
      expect(body.entries.some((entry) => entry.kind === "repository")).toBe(
        true,
      );
      expect(
        body.entries.every((entry) => !entry.path.includes("/.git/")),
      ).toBe(true);
    } finally {
      await running.close();
      await repo.dispose();
    }
  });

  it("approves exact paths, revokes access, and preserves the audit after restart", async () => {
    const repo = await createRepo({ initialCommit: true });
    const second = await createRepo({ initialCommit: true });
    const nested = join(repo.root, "nested-repository");
    await repo.git(["init", "--quiet", nested]);
    const nestedPath = await realpath(nested);
    const secondPath = await realpath(second.root);
    const running = await start(repo);
    try {
      const { origin, token } = await pair(running);
      const initial = await fetch(`${origin}/api/v1/repositories`, {
        headers: { authorization: `Bearer ${token}`, origin },
      });
      const initialList = repositoriesResponseSchema.parse(
        await initial.json(),
      );
      expect(initialList.repositories).toHaveLength(1);

      const inside = await register(origin, token, nested);
      expect(inside.status).toBe(200);
      const insideList = repositoriesResponseSchema.parse(await inside.json());
      const nestedRecord = insideList.repositories.find(
        (entry) => entry.displayPath === nestedPath,
      );
      expect(nestedRecord).toBeDefined();
      expect(insideList.allowedRoots).toHaveLength(1);

      const outside = await register(origin, token, second.root);
      expect(outside.status).toBe(200);
      const outsideList = repositoriesResponseSchema.parse(
        await outside.json(),
      );
      const secondRecord = outsideList.repositories.find(
        (entry) => entry.displayPath === secondPath,
      );
      expect(secondRecord).toBeDefined();
      expect(outsideList.allowedRoots).toHaveLength(2);

      const plainPath = join(repo.scratchRoot, "not-a-repository");
      await repo.write("not-a-repository", "not git\n");
      const notRepository = await register(origin, token, plainPath);
      expect(notRepository.status).toBe(404);

      const gitDirectory = await register(
        origin,
        token,
        join(repo.root, ".git"),
      );
      expect(gitDirectory.status).toBe(403);

      const duplicate = await register(origin, token, nested);
      expect(duplicate.status).toBe(409);

      const revoked = await fetch(`${origin}/api/v1/repositories/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          origin,
        },
        body: JSON.stringify({ repositoryId: nestedRecord?.repositoryId }),
      });
      expect(revoked.status).toBe(200);
      const afterRevoke = repositoriesResponseSchema.parse(
        await revoked.json(),
      );
      expect(
        afterRevoke.repositories.some((entry) => entry.displayPath === nested),
      ).toBe(false);
      const denied = await fetch(
        `${origin}/api/v1/status?repositoryId=${nestedRecord?.repositoryId ?? ""}`,
        { headers: { authorization: `Bearer ${token}`, origin } },
      );
      expect(denied.status).toBe(403);

      const journal = await readFile(
        running.assembly.accessJournal.filePath(),
        "utf8",
      );
      expect(journal).toContain('"action":"register"');
      expect(journal).toContain('"action":"revoke"');
      expect(journal).toContain(nestedPath);
    } finally {
      await running.close();
      await second.dispose();
    }

    const restarted = await start(repo);
    try {
      expect(restarted.assembly.accessJournal.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "register", path: nestedPath }),
          expect.objectContaining({ action: "revoke", path: nestedPath }),
        ]),
      );
    } finally {
      await restarted.close();
      await repo.dispose();
    }
  });
});
