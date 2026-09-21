/**
 * Contract tests: the 44-operation union, its target pairing, and the semantic
 * rules that JSON Schema cannot express.
 *
 * These are the tests that make "the browser cannot ask for arbitrary Git
 * execution" a checkable property. They run over the *whole* union rather than a
 * few representative operations, because the failure that matters is the one
 * operation somebody added with the wrong target or without a confirmation flag.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CONFIRMATION_REQUIRED_KINDS,
  CONTRACT_SCHEMAS,
  LIMITS,
  MUTATION_KINDS,
  MutationRequestSchema,
  OPERATION_SCHEMAS,
  OPERATION_TARGET_LIST,
  RUNTIME_LIMITS,
  objectIdSchema,
  targetKindsOf,
  utf8ByteLength,
  validateMutationRequest,
  type MutationKind,
} from "@refyard/git-contract";

const PATH_ID = "path_aaaaaaaaaaaaaaaa";
const OTHER_PATH_ID = "path_bbbbbbbbbbbbbbbb";
const PREVIEW_TOKEN = "pt_aaaaaaaaaaaaaaaa";
const OTHER_PREVIEW_TOKEN = "pt_bbbbbbbbbbbbbbbb";
const SNAPSHOT_ID = "snap_aaaaaaaaaaaaaaaa";
const REPOSITORY_ID = "repo_aaaaaaaaaaaaaaaa";
const WORKTREE_ID = "wt_aaaaaaaaaaaaaaaa";
const ROOT_ID = "root_aaaaaaaaaaaaaaaa";
const OID = "a".repeat(40);
const OTHER_OID = "b".repeat(40);
const STASH = { oid: OID, locator: "stash@{0}" };

/** One minimal, valid payload per operation — the union is covered, not sampled. */
const MINIMAL_OPERATION: Readonly<Record<MutationKind, unknown>> = {
  initRepository: { kind: "initRepository", initialBranch: null },
  cloneRepository: {
    kind: "cloneRepository",
    remoteUrl: "https://example.invalid/project.git",
    relativeDestination: "project",
    initializeSubmodules: false,
  },
  stagePaths: {
    kind: "stagePaths",
    pathIds: [PATH_ID],
    previewTokens: [PREVIEW_TOKEN],
  },
  unstagePaths: { kind: "unstagePaths", pathIds: [PATH_ID] },
  discardTrackedPaths: {
    kind: "discardTrackedPaths",
    pathIds: [PATH_ID],
    previewTokens: [PREVIEW_TOKEN],
    confirmed: true,
  },
  commit: { kind: "commit", message: "fix: something" },
  amendCommit: { kind: "amendCommit", message: null, confirmed: true },
  createBranch: {
    kind: "createBranch",
    branchName: "feature/graph",
    startOid: null,
    switchToIt: false,
  },
  switchBranch: { kind: "switchBranch", branchName: "main" },
  renameBranch: { kind: "renameBranch", branchName: "old", newName: "new" },
  deleteBranch: {
    kind: "deleteBranch",
    branchName: "feature/graph",
    confirmed: true,
  },
  setBranchUpstream: {
    kind: "setBranchUpstream",
    branchName: "main",
    upstream: null,
  },
  addRemote: {
    kind: "addRemote",
    remoteName: "origin",
    fetchUrl: "https://example.invalid/project.git",
    pushUrl: null,
  },
  updateRemote: {
    kind: "updateRemote",
    remoteName: "origin",
    newName: "upstream",
    fetchUrl: null,
    pushUrl: null,
  },
  removeRemote: { kind: "removeRemote", remoteName: "origin", confirmed: true },
  fetch: { kind: "fetch", remoteName: "origin", prune: false, tags: "none" },
  push: {
    kind: "push",
    remoteName: "origin",
    sourceRef: "refs/heads/main",
    destinationRef: "refs/heads/main",
    setUpstream: true,
  },
  pull: { kind: "pull", remoteName: "origin", mode: "ff-only" },
  createStash: {
    kind: "createStash",
    message: null,
    includeUntracked: false,
    keepIndex: false,
  },
  applyStash: { kind: "applyStash", stash: STASH, restoreIndex: false },
  popStash: {
    kind: "popStash",
    stash: STASH,
    restoreIndex: false,
    confirmed: true,
  },
  dropStash: { kind: "dropStash", stash: STASH, confirmed: true },
  createTag: {
    kind: "createTag",
    tagName: "v1.0.0",
    targetOid: null,
    annotation: null,
  },
  deleteTag: { kind: "deleteTag", tagName: "v1.0.0", confirmed: true },
  pushTag: { kind: "pushTag", remoteName: "origin", tagName: "v1.0.0" },
  createWorktree: {
    kind: "createWorktree",
    relativeDestination: "worktrees/graph",
    reference: { kind: "existingBranch", branchName: "main" },
  },
  removeWorktree: {
    kind: "removeWorktree",
    worktreeId: WORKTREE_ID,
    confirmed: true,
  },
  lockWorktree: { kind: "lockWorktree", worktreeId: WORKTREE_ID, reason: null },
  unlockWorktree: { kind: "unlockWorktree", worktreeId: WORKTREE_ID },
  addSubmodule: {
    kind: "addSubmodule",
    remoteUrl: "https://example.invalid/lib.git",
    relativePath: "vendor/lib",
    branchName: null,
    initialize: false,
  },
  updateSubmodule: {
    kind: "updateSubmodule",
    pathIds: [PATH_ID],
    initialize: false,
    recursive: false,
  },
  syncSubmodule: {
    kind: "syncSubmodule",
    pathIds: [PATH_ID],
    recursive: false,
  },
  merge: {
    kind: "merge",
    sourceOid: OTHER_OID,
    mode: "default",
    message: null,
  },
  continueMerge: { kind: "continueMerge", message: null },
  abortMerge: { kind: "abortMerge", confirmed: true },
  revertCommit: { kind: "revertCommit", oid: OID },
  resetBranch: { kind: "resetBranch", oid: OID, mode: "mixed" },
  cherryPick: { kind: "cherryPick", oid: OID },
  continueCherryPick: { kind: "continueCherryPick" },
  abortCherryPick: { kind: "abortCherryPick", confirmed: true },
  rebase: { kind: "rebase", upstreamOid: OID },
  continueRebase: { kind: "continueRebase" },
  abortRebase: { kind: "abortRebase", confirmed: true },
  dropCommit: { kind: "dropCommit", oid: OID, confirmed: true },
};

const TARGETS: Readonly<Record<string, unknown>> = {
  workspace: {
    kind: "workspace",
    allowedRootId: ROOT_ID,
    relativeDestination: "projects/graph",
  },
  repository: {
    kind: "repository",
    repositoryId: REPOSITORY_ID,
    expectedSnapshotId: SNAPSHOT_ID,
  },
  worktree: {
    kind: "worktree",
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    expectedSnapshotId: SNAPSHOT_ID,
  },
};

function requestFor(
  kind: MutationKind,
  targetKind: keyof typeof TARGETS,
): unknown {
  return {
    clientRequestId: "request-1",
    target: TARGETS[targetKind],
    operation: MINIMAL_OPERATION[kind],
  };
}

describe("the mutation union", () => {
  it("declares exactly the 44 documented operations, in order", () => {
    expect(MUTATION_KINDS).toHaveLength(44);
    expect(MUTATION_KINDS[0]).toBe("initRepository");
    expect(MUTATION_KINDS.at(-1)).toBe("dropCommit");
    // A copy in the list would silently reduce coverage of every loop below.
    expect(new Set(MUTATION_KINDS).size).toBe(MUTATION_KINDS.length);
  });

  it("has a schema for every kind, and every schema declares the same kind it is filed under", () => {
    for (const kind of MUTATION_KINDS) {
      const parsed = OPERATION_SCHEMAS[kind].safeParse(MINIMAL_OPERATION[kind]);
      expect(parsed.success, `${kind} rejects its own minimal payload`).toBe(
        true,
      );
      const wrongKind = OPERATION_SCHEMAS[kind].safeParse({
        ...(MINIMAL_OPERATION[kind] as object),
        kind: "runGit",
      });
      expect(wrongKind.success, `${kind} accepted a mismatched kind`).toBe(
        false,
      );
    }
  });

  it("accepts a declared target pairing and rejects every undeclared one", () => {
    for (const kind of MUTATION_KINDS) {
      const allowed = targetKindsOf(kind);
      for (const targetKind of [
        "workspace",
        "repository",
        "worktree",
      ] as const) {
        const result = MutationRequestSchema.safeParse(
          requestFor(kind, targetKind),
        );
        expect(
          result.success,
          `${kind} against a ${targetKind} target should be ${allowed.includes(targetKind) ? "accepted" : "rejected"}`,
        ).toBe(allowed.includes(targetKind));
      }
    }
  });

  it("refuses the shape this project exists to prevent: a raw Git invocation", () => {
    const invalid = {
      clientRequestId: "request-1",
      target: TARGETS.workspace,
      operation: { kind: "runGit", rawArgs: ["reset", "--hard"] },
    };
    expect(MutationRequestSchema.safeParse(invalid).success).toBe(false);
    expect(validateMutationRequest(invalid).ok).toBe(false);
  });

  it("refuses unknown fields on the envelope, the target and the operation", () => {
    const planned = requestFor("commit", "worktree");
    const base = planned as {
      clientRequestId: string;
      target: object;
      operation: object;
    };
    expect(
      MutationRequestSchema.safeParse({ ...base, extra: true }).success,
    ).toBe(false);
    expect(
      MutationRequestSchema.safeParse({
        ...base,
        target: { ...base.target, extra: true },
      }).success,
    ).toBe(false);
    expect(
      MutationRequestSchema.safeParse({
        ...base,
        operation: { ...base.operation, extra: true },
      }).success,
    ).toBe(false);
  });

  it("requires explicit confirmation for exactly the operations that can destroy work", () => {
    expect([...CONFIRMATION_REQUIRED_KINDS].sort()).toEqual(
      [
        "abortCherryPick",
        "abortMerge",
        "abortRebase",
        "amendCommit",
        "dropCommit",
        "deleteBranch",
        "deleteTag",
        "discardTrackedPaths",
        "dropStash",
        "popStash",
        "removeRemote",
        "removeWorktree",
      ].sort(),
    );
    for (const kind of CONFIRMATION_REQUIRED_KINDS) {
      const operation = MINIMAL_OPERATION[kind] as Record<string, unknown>;
      const withoutConfirmation = { ...operation };
      delete withoutConfirmation["confirmed"];
      const result = MutationRequestSchema.safeParse({
        clientRequestId: "request-1",
        target: TARGETS[targetKindsOf(kind)[0] ?? "repository"],
        operation: withoutConfirmation,
      });
      expect(result.success, `${kind} was accepted without confirmation`).toBe(
        false,
      );
    }
  });

  it("reports the reference plan’s pairing example exactly as written", () => {
    const invalid = {
      clientRequestId: "request-1",
      target: {
        kind: "workspace",
        allowedRootId: ROOT_ID,
        relativeDestination: "new",
      },
      operation: { kind: "stagePaths", pathIds: ["p1"], previewTokens: ["v1"] },
    };
    expect(MutationRequestSchema.safeParse(invalid).success).toBe(false);
    expect(
      MutationRequestSchema.safeParse({
        ...invalid,
        operation: { kind: "initRepository", initialBranch: "main" },
      }).success,
    ).toBe(true);
    expect(
      MutationRequestSchema.safeParse({
        ...invalid,
        operation: { kind: "runGit", rawArgs: ["reset", "--hard"] },
      }).success,
    ).toBe(false);
  });
});

describe("validation of one request", () => {
  /**
   * Validate one request. The target kind defaults to the one the operation
   * declares, so a test about branch-name rules is not accidentally testing the
   * pairing rule instead.
   */
  function problemsFor(overrides: {
    operation: unknown;
    targetKind?: keyof typeof TARGETS;
    target?: unknown;
    clientRequestId?: string;
  }): readonly { code: string; message: string; path?: string }[] {
    const kind = readKind(overrides.operation);
    const targetKind =
      overrides.targetKind ??
      (kind === null ? "worktree" : (targetKindsOf(kind)[0] ?? "worktree"));
    const result = validateMutationRequest({
      clientRequestId: overrides.clientRequestId ?? "request-1",
      target: overrides.target ?? TARGETS[targetKind],
      operation: overrides.operation,
    });
    return result.ok ? [] : result.problems;
  }

  function readKind(operation: unknown): MutationKind | null {
    if (
      typeof operation !== "object" ||
      operation === null ||
      !("kind" in operation)
    ) {
      return null;
    }
    const kind = operation.kind;
    return typeof kind === "string" &&
      MUTATION_KINDS.some((candidate) => candidate === kind)
      ? (kind as MutationKind)
      : null;
  }

  it("accepts every minimal operation with its declared target", () => {
    for (const kind of MUTATION_KINDS) {
      const result = validateMutationRequest(
        requestFor(kind, targetKindsOf(kind)[0] ?? "repository"),
      );
      expect(
        result.ok,
        `${kind} failed semantic validation: ${JSON.stringify(result)}`,
      ).toBe(true);
    }
  });

  it("treats an unimplemented operation as unsupported rather than accepted", () => {
    // M1 ships no mutations, so every kind must be refused as unsupported when the
    // supported set is empty — never silently accepted and never reported available.
    for (const kind of MUTATION_KINDS) {
      const result = validateMutationRequest(
        requestFor(kind, targetKindsOf(kind)[0] ?? "repository"),
        {
          supportedKinds: [],
        },
      );
      expect(result.ok, `${kind} was accepted while unsupported`).toBe(false);
      if (!result.ok) {
        expect(result.problems[0]?.code).toBe("UnsupportedOperation");
      }
    }
  });

  it("rejects a stage request whose preview tokens do not match its paths one to one", () => {
    const problems = problemsFor({
      operation: {
        kind: "stagePaths",
        pathIds: [PATH_ID, OTHER_PATH_ID],
        previewTokens: [PREVIEW_TOKEN],
      },
    });
    expect(problems.map((problem) => problem.code)).toEqual([
      "InvalidOperationPayload",
    ]);
    expect(problems[0]?.message).toContain("one-to-one");
  });

  it("rejects a duplicated path or preview token in a selection", () => {
    const duplicatedPath = problemsFor({
      operation: { kind: "unstagePaths", pathIds: [PATH_ID, PATH_ID] },
    });
    expect(duplicatedPath[0]?.message).toContain("repeats an earlier path");
    // Reusing one token for two paths would make "which file did the user see?"
    // unanswerable, which is the whole point of the token.
    const duplicatedToken = problemsFor({
      operation: {
        kind: "stagePaths",
        pathIds: [PATH_ID, OTHER_PATH_ID],
        previewTokens: [PREVIEW_TOKEN, PREVIEW_TOKEN],
      },
    });
    expect(duplicatedToken[0]?.message).toContain("repeats an earlier token");
    const distinct = problemsFor({
      operation: {
        kind: "stagePaths",
        pathIds: [PATH_ID, OTHER_PATH_ID],
        previewTokens: [PREVIEW_TOKEN, OTHER_PREVIEW_TOKEN],
      },
    });
    expect(distinct).toEqual([]);
  });

  it.each([
    ["-force", 'starts with "-"'],
    ["feature..x", '".."'],
    ["feature@{1}", '"@{"'],
    ["trailing/", 'end with "/"'],
    ["locked.lock", '".lock"'],
    ["has space", "space"],
    ["refs^", "^"],
  ])("rejects the branch name %s", (branchName: string, reason: string) => {
    const problems = problemsFor({
      operation: { kind: "switchBranch", branchName },
    });
    expect(
      problems.length,
      `expected ${branchName} to be rejected for ${reason}`,
    ).toBeGreaterThan(0);
  });

  it("accepts branch names Git accepts, including slashes and non-ASCII", () => {
    for (const branchName of [
      "main",
      "feature/graph-paging",
      "修复/graph",
      "v1.2.3_rc-1",
    ]) {
      expect(
        problemsFor({ operation: { kind: "switchBranch", branchName } }),
      ).toEqual([]);
    }
  });

  it("rejects a rename that does not change anything", () => {
    const problems = problemsFor({
      operation: { kind: "renameBranch", branchName: "main", newName: "main" },
    });
    expect(problems[0]?.message).toContain("must differ");
  });

  it.each([
    ["ext::sh -c whoami", "transport helper"],
    ["file:///etc/passwd", "only https:// and ssh://"],
    ["http://example.invalid/r.git", "only https:// and ssh://"],
    ["--upload-pack=/tmp/x", 'must not start with "-"'],
    // Drive-relative: `C:project.git` means "wherever this drive's current
    // directory is", which is not a location a user can be shown or re-check.
    ["C:project.git", "only https:// and ssh://"],
  ])(
    "refuses the remote URL %s",
    (remoteUrl: string, expectedMessage: string) => {
      const problems = problemsFor({
        operation: {
          kind: "addRemote",
          remoteName: "origin",
          fetchUrl: remoteUrl,
          pushUrl: null,
        },
      });
      expect(
        problems.length,
        `expected ${remoteUrl} to be refused`,
      ).toBeGreaterThan(0);
      expect(problems[0]?.message).toContain(expectedMessage);
    },
  );

  it("accepts the remote URL forms Git can actually use here", () => {
    for (const fetchUrl of [
      "https://example.invalid/project.git",
      "ssh://git@example.invalid:2222/project.git",
      "git@example.invalid:team/project.git",
      "/Users/someone/src/project.git",
      // A Windows absolute path is as local as `/Users/...`: the browser sends what
      // the user picked, and refusing this shape meant a Windows user could not add
      // a local remote at all. It cannot be an option (`-`), a transport helper
      // (`::`) or anything else dangerous — those are refused before this point.
      "C:\\Users\\someone\\src\\project.git",
      "C:/Users/someone/src/project.git",
      "\\\\server\\share\\project.git",
    ]) {
      const result = validateMutationRequest({
        clientRequestId: "request-1",
        target: TARGETS.repository,
        operation: {
          kind: "addRemote",
          remoteName: "origin",
          fetchUrl,
          pushUrl: null,
        },
      });
      expect(result.ok, `${fetchUrl} was rejected`).toBe(true);
    }
  });

  it("rejects a workspace destination that is absolute, escaping, or names .git", () => {
    for (const relativeDestination of [
      "/absolute/path",
      "../escape",
      "inside/../../escape",
      "project/.git/hooks",
    ]) {
      const problems = problemsFor({
        target: {
          kind: "workspace",
          allowedRootId: ROOT_ID,
          relativeDestination,
        },
        operation: { kind: "initRepository", initialBranch: null },
      });
      expect(
        problems.length,
        `${relativeDestination} was accepted`,
      ).toBeGreaterThan(0);
      expect(problems[0]?.path).toBe("target.relativeDestination");
    }
  });

  it("rejects an updateRemote that changes nothing", () => {
    const problems = problemsFor({
      operation: {
        kind: "updateRemote",
        remoteName: "origin",
        newName: null,
        fetchUrl: null,
        pushUrl: null,
      },
    });
    expect(problems[0]?.message).toContain("at least one change");
  });

  it("accepts a push-URL-only remote update", () => {
    // Prevents: the public contract rejecting a change the trusted workflow can apply.
    const problems = problemsFor({
      operation: {
        kind: "updateRemote",
        remoteName: "origin",
        newName: null,
        fetchUrl: null,
        pushUrl: "https://push.example.invalid/project.git",
      },
    });
    expect(problems).toEqual([]);
  });

  it("rejects a blank commit message and accepts one with a newline and non-ASCII text", () => {
    expect(
      problemsFor({ operation: { kind: "commit", message: "   \n\t " } })[0]
        ?.message,
    ).toContain("blank");
    expect(
      problemsFor({
        operation: {
          kind: "commit",
          message: '标题\n\n正文 with "quotes" and \\backslashes',
        },
      }),
    ).toEqual([]);
  });

  it("rejects a malformed client request id", () => {
    const problems = problemsFor({
      clientRequestId: ":",
      operation: MINIMAL_OPERATION.commit,
    });
    expect(problems[0]?.code).toBe("InvalidRequest");
  });
});

describe("identifiers and limits", () => {
  it("accepts SHA-1 and SHA-256 object names and nothing else", () => {
    expect(objectIdSchema.safeParse("a".repeat(40)).success).toBe(true);
    expect(objectIdSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(objectIdSchema.safeParse("a".repeat(39)).success).toBe(false);
    expect(objectIdSchema.safeParse("a".repeat(41)).success).toBe(false);
    expect(objectIdSchema.safeParse("A".repeat(40)).success).toBe(false);
  });

  it("counts UTF-8 bytes without a host encoder", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("中文")).toBe(6);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("a\u0000b")).toBe(3);
  });

  it("publishes limits that match the constants they are derived from", () => {
    expect(RUNTIME_LIMITS.historyDefaultPageSize).toBe(
      LIMITS.historyDefaultPageSize,
    );
    expect(RUNTIME_LIMITS.historyMaxPageSize).toBe(LIMITS.historyMaxPageSize);
    expect(RUNTIME_LIMITS.patchMaxBytesPerFile).toBe(
      LIMITS.patchMaxBytesPerFile,
    );
    expect(RUNTIME_LIMITS.previewTokenTtlSeconds).toBe(
      LIMITS.previewTokenTtlSeconds,
    );
    expect(RUNTIME_LIMITS.concurrentGitProcesses).toBe(
      LIMITS.concurrentGitProcesses,
    );
  });
});

describe("the schema registry", () => {
  it("names every schema exactly as its own metadata id", () => {
    for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
      expect(schema.meta()?.id, `${name} has no id metadata`).toBe(name);
    }
  });

  it("exports every named schema to JSON Schema", () => {
    for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
      expect(
        () => z.toJSONSchema(schema),
        `${name} is not exportable`,
      ).not.toThrow();
    }
  });

  it("keeps every operation payload named in the registry naming scheme", () => {
    for (const kind of MUTATION_KINDS) {
      const id = OPERATION_SCHEMAS[kind].meta()?.id;
      expect(id, `${kind} has no schema id`).toBeTypeOf("string");
      expect(id).toMatch(/^[A-Z][A-Za-z]+Operation$/);
    }
  });

  it("describes each operation exactly once in the target list", () => {
    expect(OPERATION_TARGET_LIST).toHaveLength(44);
    const kinds = OPERATION_TARGET_LIST.map(([kind]) => kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const [, targets] of OPERATION_TARGET_LIST) {
      expect(targets.length).toBeGreaterThan(0);
    }
  });
});
