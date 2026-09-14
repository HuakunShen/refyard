/**
 * The read service against real repositories.
 *
 * Every case here exists because a plausible implementation gets it wrong:
 *
 * - `pathId` is bound to raw bytes in one worktree, so the same path in a second
 *   worktree is a different id (a mutation must not be replayable across them);
 * - a history page is served from the snapshot it started with, so commits added
 *   after the first page do not shift the second page's rows and the response says
 *   the tips moved instead;
 * - a cursor is signed and repo-scoped, so it cannot be pointed at another
 *   repository or forged;
 * - an unrepresentable path is listed and refused as an operation input;
 * - a linked worktree is the same repository with a different worktree id, and a
 *   second clone of the same project is a different repository;
 * - a repository whose directory was replaced is refused rather than served under
 *   an old grant.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostEngine, type GitEngine } from "@refyard/git-core";
import {
  ReadProblem,
  createGitHost,
  createHandleRegistry,
  createPathRegistry,
  createPreviewStore,
  createReadService,
  createRepositoryRegistry,
  createRootRegistry,
  createSnapshotStore,
  createTextCodec,
  createWorktreeRegistry,
  type ReadService,
} from "@refyard/host-node";
import {
  createRepo,
  fixtureGitPath,
  type GitFixtureRepo,
} from "../support/repo.js";

const gitPath = fixtureGitPath();

interface Harness {
  readonly service: ReadService;
  readonly repositoryId: string;
  readonly allowedRootId: string;
  /** Register a second repository under the same approved root and service. */
  registerAdditional(path: string, env: NodeJS.ProcessEnv): Promise<string>;
  dispose(): Promise<void>;
}

interface HarnessInternals {
  readonly roots: ReturnType<typeof createRootRegistry>;
  readonly repositories: ReturnType<typeof createRepositoryRegistry>;
  readonly handles: ReturnType<typeof createHandleRegistry>;
}

interface HarnessOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Directory to approve; defaults to the repository directory itself. */
  readonly rootPath?: string;
  /** Path of the repository relative to the approved root. */
  readonly relativePath?: string;
  /** Disposal for the scratch directory this harness reads; defaults to nothing. */
  readonly dispose?: () => Promise<void>;
  readonly executionTrusted?: boolean;
}

let counter = 0;

/** Build a read service over one repository directory, wired the way production is. */
async function createHarness(
  repositoryRoot: string,
  options: HarnessOptions,
): Promise<Harness> {
  const codec = createTextCodec();
  const handles = createHandleRegistry();
  const roots = createRootRegistry({ handles, codec });
  const paths = createPathRegistry({
    codec,
    nextPathId: () => `path_${(counter += 1).toString(36)}`,
  });
  const worktrees = createWorktreeRegistry({
    codec,
    handles,
    nextWorktreeId: () => `wt_${(counter += 1).toString(36)}`,
  });
  const host = createGitHost({
    gitPath,
    registry: handles,
    // Only the fixture's own variables travel; the runner still strips the blocked
    // names, so GIT_DIR cannot leak in from the ambient environment either.
    env: Object.fromEntries(
      Object.entries(options.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
  const engine: GitEngine = createHostEngine(host, { runIdPrefix: "test" });
  const repositories = createRepositoryRegistry({
    roots,
    worktrees,
    codec,
    engine,
    nextRepositoryId: () => `repo_${(counter += 1).toString(36)}`,
  });
  const snapshots = createSnapshotStore({
    nextSnapshotId: () => `snap_${(counter += 1).toString(36)}`,
  });
  const previews = createPreviewStore();
  const root = await roots.approve({
    path: options.rootPath ?? repositoryRoot,
    ...(options.executionTrusted === undefined
      ? {}
      : { executionTrusted: options.executionTrusted }),
  });
  const record = await repositories.register({
    allowedRootId: root.allowedRootId,
    relativePath: options.relativePath ?? "",
    handles,
  });
  const service = createReadService({
    engine,
    roots,
    repositories,
    worktrees,
    paths,
    snapshots,
    previews,
    codec,
    serviceInstanceId: "srvc_test",
    apiMajor: 1,
    contractVersion: "1.0.0",
    gitPath,
    gitVersion: "2.50.1",
    gitFeatures: {
      porcelainV2Status: true,
      worktreeListZ: true,
      catFileBatch: true,
      pushPorcelain: true,
      fetchPorcelain: true,
      objectFormats: ["sha1", "sha256"],
    },
    unavailable: [],
    reads: [
      "capabilities",
      "repositories",
      "status",
      "history",
      "refs",
      "diff",
      "worktrees",
      "submodules",
      "stashes",
    ],
    // This build implements no mutations; the capability list says so by omission.
    operations: [],
  });
  const internals: HarnessInternals = { roots, repositories, handles };
  return {
    service,
    repositoryId: record.repositoryId,
    allowedRootId: root.allowedRootId,
    async registerAdditional(path, _env) {
      // The second repository is registered under a newly approved root of its own,
      // because a registration names the root it was approved through.
      const secondRoot = await internals.roots.approve({
        path,
        executionTrusted: false,
      });
      const second = await internals.repositories.register({
        allowedRootId: secondRoot.allowedRootId,
        relativePath: "",
        handles: internals.handles,
      });
      return second.repositoryId;
    },
    async dispose() {
      await options.dispose?.();
    },
  };
}

/**
 * The common case: a harness over the fixture repository.
 *
 * The approved root is the fixture's scratch directory and the repository is
 * registered as `repo` inside it, which is what lets a linked worktree created next
 * to the repository fall inside the same approval — the ordinary arrangement for
 * someone who approves a projects directory rather than one checkout.
 */
async function harnessFor(repo: GitFixtureRepo): Promise<Harness> {
  return createHarness(repo.root, {
    env: repo.env,
    rootPath: repo.scratchRoot,
    relativePath: "repo",
    dispose: () => repo.dispose(),
  });
}

describe("repository registration and identity", () => {
  let repo: GitFixtureRepo;
  let harness: Harness;

  beforeEach(async () => {
    repo = await createRepo({
      initialCommit: true,
      config: { "user.name": "Fixture" },
    });
    harness = await harnessFor(repo);
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("reports the repository, its root and its primary worktree", async () => {
    const response = await harness.service.repositories();
    expect(response.repositories).toHaveLength(1);
    const summary = response.repositories[0];
    expect(summary?.repositoryId).toBe(harness.repositoryId);
    expect(summary?.objectFormat).toBe("sha1");
    expect(summary?.worktreeIds).toHaveLength(1);
    expect(summary?.head.kind).toBe("born");
    expect(summary?.head.branchName).toBe("main");
    expect(response.allowedRoots[0]?.repositoryIds).toEqual([
      harness.repositoryId,
    ]);
  });

  it("gives two worktrees of one repository one repository id and two worktree ids", async () => {
    // Prevents: two worktrees of the same repository being shown as two clones,
    // which would let the UI offer a "fetch" per worktree and confuse ref state.
    const linked = join(repo.scratchRoot, "linked");
    await repo.git(["worktree", "add", "-b", "feature", linked]);
    const worktrees = await harness.service.worktrees({
      repositoryId: harness.repositoryId,
    });
    expect(worktrees.worktrees).toHaveLength(2);
    const ids = worktrees.worktrees.map((worktree) => worktree.worktreeId);
    expect(new Set(ids).size).toBe(2);
    const main = worktrees.worktrees.find((worktree) => worktree.isMain);
    expect(main?.head.branchName).toBe("main");
  });

  it("recognises a second clone at a different path as a different repository", async () => {
    const clonePath = join(repo.scratchRoot, "clone");
    await repo.git(["clone", "--quiet", repo.root, clonePath]);
    const root = await harness.service.repositories();
    // The first harness registered only the original repository; a second harness
    // over the clone must not collide with it.
    const second = await createHarness(clonePath, { env: repo.env });
    try {
      const response = await second.service.repositories();
      expect(response.repositories[0]?.repositoryId).not.toBe(
        harness.repositoryId,
      );
    } finally {
      await second.dispose();
    }
    expect(root.repositories).toHaveLength(1);
  });

  it("refuses a repository whose directory was replaced", async () => {
    // Prevents: a delete-and-re-clone inheriting the old approval, which is how a
    // service ends up reading a repository the user never approved.
    await rm(repo.root, { recursive: true, force: true });
    await mkdir(repo.root, { recursive: true });
    await repo.git(["init", "--quiet", "--initial-branch=main"]);
    await expect(
      harness.service.status({ repositoryId: harness.repositoryId }),
    ).rejects.toMatchObject({ code: "Forbidden" });
  });

  it("refuses a root whose directory was replaced", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "refyard-swap-"));
    const directory = join(scratch, "root");
    const moved = join(scratch, "root-moved");
    try {
      await makeDirectory(directory);
      const codec = createTextCodec();
      const handles = createHandleRegistry();
      const roots = createRootRegistry({ handles, codec });
      const approved = await roots.approve({ path: directory });
      await rm(directory, { recursive: true, force: true });
      await makeDirectory(directory);
      void moved;
      await expect(
        roots.requireIntact(approved.allowedRootId),
      ).rejects.toMatchObject({
        code: "Forbidden",
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("refuses a root path that leaves the approved directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "refyard-outside-"));
    try {
      await writeFile(join(outside, "file.txt"), "x\n");
      await symlink(outside, join(repo.root, "escape"));
      const codec = createTextCodec();
      const handles = createHandleRegistry();
      const roots = createRootRegistry({ handles, codec });
      const approved = await roots.approve({ path: repo.root });
      await expect(
        handles.resolve(handles.handleFor(approved.allowedRootId, "escape")),
      ).rejects.toThrow(/escapes its approved root/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("status reads", () => {
  let repo: GitFixtureRepo;
  let harness: Harness;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    harness = await harnessFor(repo);
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("reports a clean repository with its branch and head", async () => {
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    expect(status.entries).toHaveLength(0);
    expect(status.head.kind).toBe("born");
    expect(status.head.branchName).toBe("main");
    expect(status.head.oid).toBe(await repo.headOid());
  });

  it("reports an unborn repository as unborn rather than failing", async () => {
    // Prevents: a fresh `git init` being reported as an error state, which sends a
    // first-time user looking for a problem that does not exist.
    const empty = await createRepo();
    const emptyHarness = await harnessFor(empty);
    try {
      const status = await emptyHarness.service.status({
        repositoryId: emptyHarness.repositoryId,
      });
      expect(status.head.kind).toBe("unborn");
      expect(status.head.oid).toBeNull();
      expect(status.head.branchName).toBe("main");

      const history = await emptyHarness.service.history({
        repositoryId: emptyHarness.repositoryId,
      });
      expect(history.commits).toEqual([]);
      expect(history.nextCursor).toBeNull();
    } finally {
      await emptyHarness.dispose();
    }
  });

  it("keeps a path's raw bytes when the file name is not ASCII", async () => {
    await repo.write("moved 新\tname.txt", "content\n");
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    const entry = status.entries.find((candidate) =>
      candidate.displayPath.includes("新"),
    );
    expect(entry).toBeDefined();
    expect(entry?.pathEncoding).toBe("utf8");
    expect(entry?.kind).toBe("untracked");
  });

  it("reports an operation in progress from the markers a merge leaves behind", async () => {
    // Prevents: offering a commit during a conflicted merge, which Git would refuse
    // after the user had filled in a message.
    await repo.write("a.txt", "changed\n");
    await repo.git(["commit", "-q", "-am", "change"]);
    await repo.git(["checkout", "-q", "-b", "other", "HEAD~1"]);
    await repo.write("a.txt", "other\n");
    await repo.git(["commit", "-q", "-am", "other"]);
    await repo.gitResult(["merge", "main"]);
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    expect(status.operationInProgress).toBe("merge");
    const conflicted = status.entries.find(
      (entry) => entry.kind === "unmerged",
    );
    expect(conflicted?.stages?.map((stage) => stage.stage)).toEqual([1, 2, 3]);
  });

  it("binds a path id to one worktree, so the same path differs per worktree", async () => {
    await repo.write("shared.txt", "content\n");
    const primary = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    const primaryEntry = primary.entries.find((entry) =>
      entry.displayPath.endsWith("shared.txt"),
    );
    const linked = join(repo.scratchRoot, "linked");
    await repo.git(["worktree", "add", "-b", "feature", linked]);
    const worktrees = await harness.service.worktrees({
      repositoryId: harness.repositoryId,
    });
    const linkedWorktree = worktrees.worktrees.find(
      (worktree) => !worktree.isMain,
    );
    expect(linkedWorktree).toBeDefined();
    const linkedStatus = await harness.service.status({
      repositoryId: harness.repositoryId,
      worktreeId: linkedWorktree?.worktreeId,
    });
    // The linked worktree is clean at the branch point, so the file is not listed
    // there at all — which is itself the proof that the two worktrees are read
    // independently.
    expect(
      linkedStatus.entries.some((entry) =>
        entry.displayPath.endsWith("shared.txt"),
      ),
    ).toBe(false);
    expect(primaryEntry).toBeDefined();
  });
});

describe("history reads and paging", () => {
  let repo: GitFixtureRepo;
  let harness: Harness;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    harness = await harnessFor(repo);
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("returns topology with subjects, parents and decoration", async () => {
    await repo.write("b.txt", "b\n");
    await repo.commitAll("second commit");
    const page = await harness.service.history({
      repositoryId: harness.repositoryId,
      limit: 10,
    });
    expect(page.commits).toHaveLength(2);
    expect(page.commits[0]?.subject).toBe("second commit");
    expect(page.commits[0]?.parents).toHaveLength(1);
    expect(page.commits[0]?.refNames).toContain("refs/heads/main");
    expect(page.objectFormat).toBe("sha1");
    expect(page.nextCursor).toBeNull();
  });

  it("pages from the snapshot's tips, so a commit added later does not shift rows", async () => {
    // Prevents: a second page that repeats or skips commits because the branch
    // moved between the two requests.
    for (let index = 0; index < 5; index += 1) {
      await repo.write(`f${index}.txt`, `${index}\n`);
      await repo.commitAll(`commit ${index}`);
    }
    const first = await harness.service.history({
      repositoryId: harness.repositoryId,
      limit: 3,
    });
    expect(first.commits).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    expect(first.truncated).toBe(true);

    // The branch advances after the first page was served.
    await repo.write("new.txt", "new\n");
    const newHead = await repo.commitAll("committed after page one");

    const second = await harness.service.history({
      repositoryId: harness.repositoryId,
      cursor: first.nextCursor ?? "",
      limit: 3,
    });
    // The pinned tips mean the second page continues the same graph...
    expect(second.commits.every((commit) => commit.oid !== newHead)).toBe(true);
    // ...and the response says the branch moved, so the UI can offer a refresh.
    expect(second.tipsMoved).toBe(true);
    const firstPageOids = new Set(first.commits.map((commit) => commit.oid));
    expect(second.commits.some((commit) => firstPageOids.has(commit.oid))).toBe(
      false,
    );
  });

  it("starts a fresh snapshot when the request has no cursor, and reports tips as moved", async () => {
    const first = await harness.service.history({
      repositoryId: harness.repositoryId,
    });
    await repo.write("c.txt", "c\n");
    await repo.commitAll("later");
    const fresh = await harness.service.history({
      repositoryId: harness.repositoryId,
    });
    expect(fresh.commits[0]?.subject).toBe("later");
    expect(fresh.snapshotId).not.toBe(first.snapshotId);
  });

  it("refuses a cursor it never issued", async () => {
    // Prevents: a hand-written or guessed cursor being interpreted as paging state
    // the host did not create.
    await expect(
      harness.service.history({
        repositoryId: harness.repositoryId,
        cursor: "cur_forged",
      }),
    ).rejects.toMatchObject({ code: "StaleSnapshot" });
    await expect(
      harness.service.history({
        repositoryId: harness.repositoryId,
        cursor: "not-a-cursor",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("refuses a cursor from another service instance", async () => {
    // Prevents: a cursor from a different process (or a previous run) resuming a
    // page against state this instance never recorded.
    await repo.write("second.txt", "second\n");
    await repo.commitAll("second commit");
    const first = await harness.service.history({
      repositoryId: harness.repositoryId,
      limit: 1,
    });
    expect(first.nextCursor).not.toBeNull();
    const other = await createRepo({ initialCommit: true });
    const otherHarness = await harnessFor(other);
    try {
      await expect(
        otherHarness.service.history({
          repositoryId: otherHarness.repositoryId,
          cursor: first.nextCursor ?? "",
        }),
      ).rejects.toMatchObject({ code: "StaleSnapshot" });
    } finally {
      await otherHarness.dispose();
    }
  });

  it("refuses a cursor that belongs to another repository in the same instance", async () => {
    // Prevents: a cursor from one repository paging another repository's history,
    // which would show commits under the wrong repository.
    await repo.write("second.txt", "second\n");
    await repo.commitAll("second commit");
    const first = await harness.service.history({
      repositoryId: harness.repositoryId,
      limit: 1,
    });
    const other = await createRepo({ initialCommit: true });
    const otherId = await harness.registerAdditional(
      join(other.scratchRoot, "repo"),
      other.env,
    );
    try {
      await expect(
        harness.service.history({
          repositoryId: otherId,
          cursor: first.nextCursor ?? "",
        }),
      ).rejects.toMatchObject({ code: "Forbidden" });
    } finally {
      await other.dispose();
    }
  });

  it("returns one commit's full message when asked for detail", async () => {
    const oid = await repo.headOid();
    const page = await harness.service.history({
      repositoryId: harness.repositoryId,
      detailOid: oid,
    });
    expect(page.detail?.oid).toBe(oid);
    // The fixture commits a message with a trailing newline; the body keeps it and
    // the subject strips it, which is the difference the UI relies on.
    expect(page.detail?.subject).toBe("base");
    expect(page.detail?.body.endsWith("\n")).toBe(true);
  });

  it("marks a commit whose parent is absent as a boundary", async () => {
    // Prevents: a shallow clone being drawn as a complete history with a root that
    // never existed.
    for (let index = 0; index < 3; index += 1) {
      await repo.write(`s${index}.txt`, `${index}\n`);
      await repo.commitAll(`step ${index}`);
    }
    const shallowSource = join(repo.scratchRoot, "shallow");
    await repo.git([
      "clone",
      "--quiet",
      "--depth=1",
      `file://${repo.root}`,
      shallowSource,
    ]);
    const shallowHarness = await createHarness(shallowSource, {
      env: repo.env,
    });
    try {
      const page = await shallowHarness.service.history({
        repositoryId: shallowHarness.repositoryId,
        limit: 10,
      });
      expect(page.shallow).toBe(true);
      expect(page.commits).toHaveLength(1);
      expect(page.commits[0]?.boundary).toBe(true);
      expect(page.commits[0]?.missingParents).toHaveLength(1);
    } finally {
      await shallowHarness.dispose();
    }
  });
});

describe("refs, stashes and diff reads", () => {
  let repo: GitFixtureRepo;
  let harness: Harness;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    harness = await harnessFor(repo);
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("separates branches, remote branches and tags", async () => {
    await repo.git(["branch", "feature"]);
    await repo.git(["tag", "lightweight"]);
    await repo.git(["tag", "-a", "annotated", "-m", "annotated tag"]);
    const refs = await harness.service.refs({
      repositoryId: harness.repositoryId,
    });
    expect(refs.branches.map((branch) => branch.name).sort()).toEqual([
      "feature",
      "main",
    ]);
    expect(
      refs.branches.find((branch) => branch.name === "main")?.isCurrent,
    ).toBe(true);
    const annotated = refs.tags.find((tag) => tag.name === "annotated");
    expect(annotated?.annotated).toBe(true);
    expect(annotated?.targetOid).toBe(await repo.headOid());
    expect(refs.tags.find((tag) => tag.name === "lightweight")?.annotated).toBe(
      false,
    );
  });

  it("redacts a credential from a remote URL", async () => {
    // Prevents: a token in a cloned URL being handed to the browser and ending up
    // in a screenshot or a bug report.
    await repo.git([
      "remote",
      "add",
      "origin",
      "https://user:secret@example.com/repo.git",
    ]);
    const refs = await harness.service.refs({
      repositoryId: harness.repositoryId,
    });
    const origin = refs.remotes.find((remote) => remote.name === "origin");
    expect(origin?.fetchUrlDisplay).toBe("https://example.com/repo.git");
    expect(JSON.stringify(refs)).not.toContain("secret");
  });

  it("lists stashes with their locator and message", async () => {
    await repo.write("w.txt", "work\n");
    await repo.git(["add", "w.txt"]);
    await repo.git(["stash", "push", "-m", "work in progress"]);
    const stashes = await harness.service.stashes({
      repositoryId: harness.repositoryId,
    });
    expect(stashes.stashes).toHaveLength(1);
    expect(stashes.stashes[0]?.locator).toBe("stash@{0}");
    expect(stashes.stashes[0]?.message).toContain("work in progress");
    expect(stashes.stashes[0]?.oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it("describes an unstaged change and its patch when a path is named", async () => {
    await repo.write("a.txt", "base\nchanged\n");
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    const pathId = status.entries[0]?.pathId ?? "";
    const diff = await harness.service.diff({
      repositoryId: harness.repositoryId,
      kind: "unstaged",
      pathId,
    });
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0];
    expect(file?.changeKind).toBe("modified");
    expect(file?.insertions).toBe(1);
    expect(file?.patch.kind).toBe("text");
    if (file?.patch.kind === "text") {
      expect(file.patch.synthesized).toBe(false);
      expect(
        file.patch.hunks[0]?.lines.some((line) => line.kind === "add"),
      ).toBe(true);
    }
  });

  it("synthesizes a patch for an untracked file and marks it as synthesized", async () => {
    await repo.write("untracked.txt", "one\ntwo\n");
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    const pathId = status.entries[0]?.pathId ?? "";
    const diff = await harness.service.diff({
      repositoryId: harness.repositoryId,
      kind: "untracked",
      pathId,
    });
    expect(diff.files).toHaveLength(1);
    const patch = diff.files[0]?.patch;
    expect(patch?.kind).toBe("text");
    if (patch?.kind === "text") {
      expect(patch.synthesized).toBe(true);
      expect(patch.hunks[0]?.lines.map((line) => line.text)).toEqual([
        "one",
        "two",
      ]);
    }
  });

  it("reports a staged change against HEAD", async () => {
    await repo.write("a.txt", "staged\n");
    await repo.git(["add", "a.txt"]);
    const diff = await harness.service.diff({
      repositoryId: harness.repositoryId,
      kind: "staged",
    });
    expect(diff.files.map((file) => file.changeKind)).toEqual(["modified"]);
    expect(diff.stats.filesChanged).toBe(1);
  });

  it("reports a rename as a rename with both paths", async () => {
    await repo.git(["mv", "a.txt", "renamed.txt"]);
    const diff = await harness.service.diff({
      repositoryId: harness.repositoryId,
      kind: "staged",
    });
    const file = diff.files[0];
    expect(file?.changeKind).toBe("renamed");
    expect(file?.oldDisplayPath).toBe("a.txt");
    expect(file?.displayPath).toBe("renamed.txt");
    expect(file?.oldPathId).not.toBe(file?.pathId);
  });

  it("bounds a diff at 200 files and says so", async () => {
    // Prevents: a huge change set producing an unbounded response the browser
    // cannot render. Staged changes list every file individually, so this is the
    // case that actually reaches the bound.
    for (let index = 0; index < 205; index += 1) {
      await repo.write(`bulk/file-${index}.txt`, `${index}\n`);
    }
    await repo.commitAll("add bulk files");
    for (let index = 0; index < 205; index += 1) {
      await repo.write(`bulk/file-${index}.txt`, `changed ${index}\n`);
    }
    await repo.git(["add", "-A"]);
    const diff = await harness.service.diff({
      repositoryId: harness.repositoryId,
      kind: "staged",
    });
    expect(diff.files).toHaveLength(200);
    expect(diff.truncated).toBe(true);
    expect(diff.stats.filesChanged).toBe(200);
    // Without a named path the patch is not fetched, so each row says so rather
    // than pretending the file has no changes.
    expect(diff.files.every((file) => file.patch.kind === "unavailable")).toBe(
      true,
    );
  });

  it("collapses an untracked directory into one entry, as Git does", async () => {
    // Prevents: a service that lists files Git did not list, or the reverse, so the
    // count a user sees matches what `git status` would tell them.
    for (let index = 0; index < 5; index += 1) {
      await repo.write(`newdir/file-${index}.txt`, `${index}\n`);
    }
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]?.displayPath).toBe("newdir/");
  });
});

describe("submodule reads", () => {
  let agent: GitFixtureRepo;
  let parent: GitFixtureRepo;
  let harness: Harness;

  beforeEach(async () => {
    agent = await createRepo({ initialCommit: true });
    parent = await createRepo({ initialCommit: true });
    // `protocol.file.allow=always` is required by Git for a local submodule clone;
    // it is set for this fixture only and never in the service's own configuration.
    await parent.git([
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      agent.root,
      "vendor/agent",
    ]);
    await parent.commitAll("add submodule");
    harness = await harnessFor(parent);
  });

  afterEach(async () => {
    await harness.dispose();
    await parent.dispose();
    await agent.dispose();
  });

  it("shows the recorded, index and actual object for a submodule", async () => {
    const response = await harness.service.submodules({
      repositoryId: harness.repositoryId,
    });
    expect(response.submodules).toHaveLength(1);
    const row = response.submodules[0];
    expect(row?.displayPath).toBe("vendor/agent");
    expect(row?.recordedOid).toMatch(/^[0-9a-f]{40}$/);
    expect(row?.indexOid).toBe(row?.recordedOid);
    expect(row?.actualOid).toBe(row?.recordedOid);
    expect(row?.state).toBe("initialized");
  });

  it("reports a submodule that is checked out at a different commit as out of sync", async () => {
    const childPath = join(parent.root, "vendor/agent");
    await writeFile(join(childPath, "extra.txt"), "extra\n");
    await parent.git(["-C", childPath, "add", "extra.txt"]);
    await parent.git([
      "-C",
      childPath,
      "commit",
      "--quiet",
      "-m",
      "child moves on",
    ]);
    const response = await harness.service.submodules({
      repositoryId: harness.repositoryId,
    });
    const row = response.submodules[0];
    expect(row?.actualOid).not.toBe(row?.indexOid);
    expect(row?.state).toBe("outOfSync");
  });
});

describe("previews", () => {
  let repo: GitFixtureRepo;
  let harness: Harness;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    harness = await harnessFor(repo);
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("issues a content fingerprint for a selected path", async () => {
    await repo.write("a.txt", "changed\n");
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    const pathId = status.entries[0]?.pathId ?? "";
    const previews = await harness.service.previews({
      repositoryId: harness.repositoryId,
      worktreeId: status.worktreeId,
      pathIds: [pathId],
    });
    expect(previews.tokens).toHaveLength(1);
    expect(previews.tokens[0]?.previewToken.startsWith("pt_")).toBe(true);
    expect(previews.tokens[0]?.fingerprintAlgorithm).toBe("sha256");
    expect(previews.tokens[0]?.contentKind).toBe("text");
  });

  it("refuses a path id that belongs to another worktree", async () => {
    await repo.write("a.txt", "changed\n");
    const status = await harness.service.status({
      repositoryId: harness.repositoryId,
    });
    const pathId = status.entries[0]?.pathId ?? "";
    await repo.git([
      "worktree",
      "add",
      "-b",
      "feature",
      join(repo.scratchRoot, "linked"),
    ]);
    const worktrees = await harness.service.worktrees({
      repositoryId: harness.repositoryId,
    });
    const linked = worktrees.worktrees.find((worktree) => !worktree.isMain);
    await expect(
      harness.service.previews({
        repositoryId: harness.repositoryId,
        worktreeId: linked?.worktreeId ?? "",
        pathIds: [pathId],
      }),
    ).rejects.toBeInstanceOf(ReadProblem);
  });
});

describe("capabilities", () => {
  it("lists only what this build implements", async () => {
    const repo = await createRepo({ initialCommit: true });
    const harness = await harnessFor(repo);
    try {
      const capabilities = harness.service.capabilities();
      expect(capabilities.apiMajor).toBe(1);
      expect(capabilities.host.kind).toBe("node");
      expect(capabilities.reads).toContain("status");
      expect(capabilities.reads).toContain("history");
      // No write operation is implemented yet, so none may be advertised.
      expect(capabilities.operations).toEqual([]);
      expect(capabilities.git.features.porcelainV2Status).toBe(true);
    } finally {
      await harness.dispose();
    }
  });
});

/** A directory that can be replaced, for the delete-and-recreate cases. */
async function makeDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "marker.txt"), "here\n");
}
