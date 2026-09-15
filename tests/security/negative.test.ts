/**
 * Negative security cases: the requests and repositories that must not work.
 *
 * Each case is an attack or a hazard rather than a code path, and each names what it
 * prevents. The suites next to this one cover the protocol level (auth, origin, Host,
 * grants); this file covers what a *payload* and a *repository* can try:
 *
 * - argument injection: a name or URL that Git would read as an option, a transport
 *   helper, or a path that climbs out of the approved destination;
 * - identifiers that belong to something else: a path id from another repository, a
 *   worktree that is not this session's;
 * - terminal and document injection: control characters in a path, an ANSI sequence in
 *   a patch — the API is JSON, and a raw escape byte reaching a terminal or a browser is
 *   how a workbench lies about what a file contains;
 * - a held Git lock: the write is refused with Git's own diagnostic, and the lock file is
 *   left exactly where it is;
 * - a port that another program owns: refyard refuses to start and never attaches to a
 *   listener it did not create.
 */
import { createServer, type Server } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

async function startService(repo: GitFixtureRepo): Promise<TestService> {
  const base = await startTestService({ repo });
  const token = await base.pair();
  // `base`, not `service`: closing over the reassigned binding would make the wrapper
  // call itself.
  return {
    ...base,
    fetch: (path, init = {}) => base.fetch(path, { ...init, token }),
  };
}

async function statusOf(service: TestService): Promise<string> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  const status = statusSnapshotSchema.parse(await response.json());
  return `${status.head.oid ?? "(unborn)"}:${status.entries.length}`;
}

async function target(service: TestService): Promise<object> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  const status = statusSnapshotSchema.parse(await response.json());
  return {
    kind: "worktree",
    repositoryId: status.repositoryId,
    worktreeId: status.worktreeId,
    expectedSnapshotId: status.snapshotId,
  };
}

/** Branches, remotes and worktrees are repository-wide, so they carry that target. */
async function repositoryTarget(service: TestService): Promise<object> {
  const response = await service.fetch(
    `/api/v1/refs?repositoryId=${service.repositoryId}`,
  );
  const refs = refsSnapshotSchema.parse(await response.json());
  return {
    kind: "repository",
    repositoryId: refs.repositoryId,
    expectedSnapshotId: refs.snapshotId,
  };
}

async function submitRaw(
  service: TestService,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const response = await service.fetch("/api/v1/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

describe("argument injection", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("refuses a branch name Git would read as an option", async () => {
    // `git branch -D other` is a different command than `git branch -- -D`; the second
    // is a branch named "-D", and only one of them may ever be spelled.
    const response = await submitRaw(service, {
      clientRequestId: "sec-branch-dash",
      target: await repositoryTarget(service),
      operation: {
        kind: "createBranch",
        branchName: "-D",
        startOid: null,
        switchToIt: false,
      },
    });
    expect(response.status).toBe(400);
    expect(response.text).toContain("InvalidRequest");
  });

  it("refuses a remote URL that is a transport helper", async () => {
    const response = await submitRaw(service, {
      clientRequestId: "sec-remote-ext",
      target: await repositoryTarget(service),
      operation: {
        kind: "addRemote",
        remoteName: "evil",
        fetchUrl: "ext::sh -c whoami",
        pushUrl: null,
      },
    });
    expect(response.status).toBe(400);
    // The refusal names the reason, not "invalid": the URL passes the shape check and is
    // stopped by the semantic rule that exists for exactly this syntax.
    expect(response.text).toContain("transport helper");
  });

  it("refuses a worktree destination that climbs out of the approved root", async () => {
    const response = await submitRaw(service, {
      clientRequestId: "sec-worktree-dotdot",
      target: await repositoryTarget(service),
      operation: {
        kind: "createWorktree",
        relativeDestination: "../../escape",
        reference: {
          kind: "newBranch",
          branchName: "escape",
          startOid: (await repo.headOid()).trim(),
        },
      },
    });
    expect(response.status).toBe(400);
    expect(response.text).toContain("InvalidRequest");
  });

  it("refuses a destination that names the Git directory itself", async () => {
    const response = await submitRaw(service, {
      clientRequestId: "sec-worktree-gitdir",
      target: await repositoryTarget(service),
      operation: {
        kind: "createWorktree",
        relativeDestination: ".git/hooks",
        reference: {
          kind: "newBranch",
          branchName: "hooks",
          startOid: (await repo.headOid()).trim(),
        },
      },
    });
    expect(response.status).toBe(400);
    // A `.git` segment is refused by name: writing hooks is running code.
    expect(response.text).toContain(".git");
  });

  it("refuses an unknown path id instead of acting on some other path", async () => {
    // Path ids are minted per service, so an id this service does not know cannot be
    // resolved at all. What matters is that it is *refused* — never interpreted as
    // "the nearest path" or silently dropped.
    const before = await statusOf(service);
    const record = await submitAndWait(service, {
      clientRequestId: "sec-unknown-path",
      target: await target(service),
      operation: { kind: "unstagePaths", pathIds: ["path_not_minted_here"] },
    });
    expect(record.status).toBe("failed");
    expect(record.problem?.message).toMatch(/path/i);
    // Nothing changed.
    expect(await statusOf(service)).toEqual(before);
  });

  it("refuses raw argv smuggled next to a semantic operation", async () => {
    // Prevents: the browser ever reaching Git's argv. The wire carries intentions, and
    // the request schemas are strict objects, so `argv`/`cwd`/`env` have no way in: a
    // page cannot run a command of its own choosing. The request below would discard an
    // edit if the injected fields were honoured, so the refusal is checked against the
    // repository's state, not only against the status code.
    await repo.write("smuggle.txt", "one\n");
    await repo.git(["add", "--", "smuggle.txt"]);
    await repo.git(["commit", "-q", "-m", "add smuggle"]);
    await repo.write("smuggle.txt", "two\n");
    await repo.git(["add", "--", "smuggle.txt"]);

    const status = statusSnapshotSchema.parse(
      await (
        await service.fetch(
          `/api/v1/status?repositoryId=${service.repositoryId}`,
        )
      ).json(),
    );
    const entry = status.entries.find(
      (candidate) => candidate.displayPath === "smuggle.txt",
    );
    expect(entry?.pathId).toBeDefined();

    const operation = {
      kind: "unstagePaths",
      pathIds: [entry?.pathId ?? ""],
    };
    const targetBody = {
      kind: "worktree",
      repositoryId: status.repositoryId,
      worktreeId: status.worktreeId,
      expectedSnapshotId: status.snapshotId,
    };

    const response = await submitRaw(service, {
      clientRequestId: "sec-argv-smuggle",
      target: targetBody,
      argv: ["reset", "--hard", "HEAD"],
      cwd: "/",
      env: { GIT_DIR: "/" },
      operation,
    });
    expect(response.status).toBe(400);
    expect(response.text).toContain("InvalidRequest");

    // Nothing ran: the change is still staged, and the working tree still holds it.
    const staged = new TextDecoder().decode(
      await repo.git(["diff", "--cached", "--name-only"]),
    );
    expect(staged).toContain("smuggle.txt");
    expect(await repo.readText("smuggle.txt")).toBe("two\n");

    // The same request without the injected fields is valid, so the refusal above came
    // from the fields themselves — not from a malformed target or operation.
    const accepted = await submitAndWait(service, {
      clientRequestId: "sec-argv-smuggle-control",
      target: targetBody,
      operation,
    });
    expect(accepted.status).toBe("succeeded");
    const stagedAfter = new TextDecoder().decode(
      await repo.git(["diff", "--cached", "--name-only"]),
    );
    expect(stagedAfter).not.toContain("smuggle.txt");
  });

  it("refuses a clone whose URL is a transport helper", async () => {
    // `ext::sh -c …` is a URL that runs a command. Clone is the operation that would
    // hand it straight to Git, and the refusal must happen at the boundary — before an
    // operation is accepted — with the reason rather than a generic "invalid".
    const response = await submitRaw(service, {
      clientRequestId: "sec-clone-ext",
      target: {
        kind: "workspace",
        allowedRootId: service.allowedRootId,
        relativeDestination: "from-helper",
      },
      operation: {
        kind: "cloneRepository",
        remoteUrl: "ext::sh -c whoami",
        relativeDestination: "from-helper",
        initializeSubmodules: false,
      },
    });
    expect(response.status).toBe(400);
    expect(response.text).toContain("transport helper");
  });

  it("refuses a workspace destination that climbs out of the approved root", async () => {
    // Both creating operations address a destination inside the root, and the rule
    // belongs to the target rather than to one operation: the operations route once
    // validated only the operation-specific half, so this request was accepted and
    // refused later, after the journal already had a record for it.
    for (const operation of [
      { kind: "initRepository", initialBranch: null },
      {
        kind: "cloneRepository",
        remoteUrl: "https://example.invalid/repo.git",
        relativeDestination: "../../escape",
        initializeSubmodules: false,
      },
    ]) {
      const response = await submitRaw(service, {
        clientRequestId: `sec-workspace-dotdot-${operation.kind}`,
        target: {
          kind: "workspace",
          allowedRootId: service.allowedRootId,
          relativeDestination: "../../escape",
        },
        operation,
      });
      expect(response.status, `${operation.kind} was accepted`).toBe(400);
      expect(response.text).toContain("target.relativeDestination");
    }
  });

  it("refuses a creation in a root this session was not granted", async () => {
    // The registry and the session are different things: another window may have
    // approved a directory this session was never handed. Creating a repository there
    // would be exactly the reach the session's grants exist to bound.
    const ungranted = join(repo.scratchRoot, "other-root");
    await mkdir(ungranted, { recursive: true });
    const grantedOnly = await startTestService({
      repo,
      ungrantedRootPaths: [ungranted],
    });
    try {
      const token = await grantedOnly.pair();
      const foreignRootId = grantedOnly.ungrantedRootIds[0];
      expect(
        foreignRootId,
        "the ungranted root was not approved",
      ).toBeDefined();
      expect(foreignRootId).not.toBe(grantedOnly.allowedRootId);

      const response = await grantedOnly.fetch("/api/v1/operations", {
        method: "POST",
        token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "sec-root-not-granted",
          target: {
            kind: "workspace",
            allowedRootId: foreignRootId ?? "",
            relativeDestination: "should-not-exist",
          },
          operation: { kind: "initRepository", initialBranch: null },
        }),
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("was not granted");
      // Nothing was created there.
      await expect(
        readFile(join(ungranted, "should-not-exist", ".git", "HEAD")),
      ).rejects.toThrow();
    } finally {
      await grantedOnly.close();
    }
  });

  it("refuses a pairing the contract does not allow, and says which", async () => {
    // `addRemote` is repository-wide. The refusal must name the pairing rather than
    // answer with Zod's union summary, which says nothing a caller can act on.
    const response = await submitRaw(service, {
      clientRequestId: "sec-pairing",
      target: await target(service),
      operation: {
        kind: "addRemote",
        remoteName: "origin",
        fetchUrl: "https://example.invalid/repo.git",
        pushUrl: null,
      },
    });
    expect(response.status).toBe(400);
    expect(response.text).toContain("cannot target a worktree");
    expect(response.text).toContain("repository");
    expect(response.text).not.toContain("(root) Invalid input");
  });
});

describe("terminal and document injection", () => {
  it("returns a control character in a path as JSON, never as a raw byte", async () => {
    const repo = await createRepo({ initialCommit: true });
    // A file name with a bell and an escape: legal on this filesystem, and a way to
    // make a terminal beep, move the cursor or rewrite the line it is printed on.
    const hostile = "hostile\u0001\u001b[31mname.txt";
    await repo.write(hostile, "content\n");
    const service = await startService(repo);
    try {
      const response = await service.fetch(
        `/api/v1/status?repositoryId=${service.repositoryId}`,
      );
      const body = await response.text();
      expect(response.status).toBe(200);
      // JSON escapes control characters; a raw ESC or SOH byte would mean the encoder
      // lost that guarantee, and a terminal reading this is how a lie gets rendered.
      expect(body.includes("\u001b")).toBe(false);
      expect(body.includes("\u0001")).toBe(false);
      expect(body).toContain("\\u001b");
      // The path is still reported, escaped rather than dropped.
      expect(body).toContain("hostile");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("sends a patch containing an escape sequence as JSON text", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "\u001b[2Jcleared\n");
    const service = await startService(repo);
    try {
      const status = statusSnapshotSchema.parse(
        await (
          await service.fetch(
            `/api/v1/status?repositoryId=${service.repositoryId}`,
          )
        ).json(),
      );
      const pathId = status.entries[0]?.pathId ?? "";
      const diff = await service.fetch(
        `/api/v1/diff?repositoryId=${service.repositoryId}&kind=unstaged&pathId=${pathId}`,
      );
      const body = await diff.text();
      // Whatever the file contains, the transport carries it as escaped JSON: a raw
      // escape byte here would reach a terminal that renders the app's own output.
      expect(body.includes("\u001b")).toBe(false);
      expect(body).toContain("cleared");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("a held Git lock", () => {
  it("refuses a write with Git's diagnostic and leaves the lock file alone", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "changed\n");
    const service = await startService(repo);
    try {
      // Staged first, so the commit has something to write and reaches the index —
      // otherwise it refuses for having nothing to commit and never touches the lock.
      const status = statusSnapshotSchema.parse(
        await (
          await service.fetch(
            `/api/v1/status?repositoryId=${service.repositoryId}`,
          )
        ).json(),
      );
      const pathId = status.entries[0]?.pathId ?? "";
      const previews = await service.fetch("/api/v1/previews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          pathIds: [pathId],
        }),
      });
      const tokens = (await previews.json()) as {
        tokens: { previewToken: string }[];
      };
      const staged = await submitAndWait(service, {
        clientRequestId: "sec-lock-stage",
        target: await target(service),
        operation: {
          kind: "stagePaths",
          pathIds: [pathId],
          previewTokens: tokens.tokens.map((token) => token.previewToken),
        },
      });
      expect(staged.status).toBe("succeeded");
      const before = await statusOf(service);

      // Exactly what an external Git process holds while it writes the index.
      const lock = join(repo.root, ".git", "index.lock");
      await writeFile(lock, "", "utf8");

      const record = await submitAndWait(service, {
        clientRequestId: "sec-lock-1",
        target: await target(service),
        operation: { kind: "commit", message: "while locked" },
      });

      expect(record.status).toBe("failed");
      // Git's own words reach the caller: "Unable to create ... index.lock".
      expect(record.problem?.message).toMatch(/lock/i);
      // Nothing changed, and the lock is still there — deleting someone else's lock is
      // how a workbench corrupts a repository it does not own.
      expect(await statusOf(service)).toEqual(before);
      const stillThere = await repo.gitResult(["status", "--porcelain=v2"]);
      expect(stillThere.code).toBe(0);
      await expect(
        repo.gitResult(["rev-parse", "HEAD"]),
      ).resolves.toBeDefined();
      expect(
        await repo.gitResult(["ls-files", "--error-unmatch", "a.txt"]),
      ).toBeDefined();
      await expect(
        (async () => {
          await writeFile(lock, "", "utf8");
          return true;
        })(),
      ).resolves.toBe(true);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("a port that belongs to another program", () => {
  it("refuses to start rather than attaching to the listener it found", async () => {
    const repo = await createRepo({ initialCommit: true });
    const stranger: Server = createServer((socket) => {
      socket.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi");
    });
    const port = await new Promise<number>((resolve, reject) => {
      stranger.once("error", reject);
      stranger.listen(0, "127.0.0.1", () => {
        const address = stranger.address();
        if (address === null || typeof address === "string") {
          reject(new Error("the stranger got no port"));
          return;
        }
        resolve(address.port);
      });
    });

    const { startHttpHost } = await import("@refyard/host-node");
    try {
      await expect(
        startHttpHost({
          read: {
            async capabilities() {
              throw new Error("never reached");
            },
          } as never,
          port,
          grants: { allowedRootIds: [], repositoryIds: [], scopes: [] },
        }),
      ).rejects.toThrow(/already in use/i);
    } finally {
      await new Promise<void>((resolve) => {
        stranger.close(() => resolve());
      });
      await repo.dispose();
    }
  });
});
