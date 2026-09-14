/**
 * The read half of `GitService`.
 *
 * This is where portable facts become the public contract: identities are minted
 * (repository, worktree, path, snapshot, preview), raw path bytes are bound to
 * `pathId`s, and every response is validated against its Zod schema before it is
 * returned. Validating here rather than at the HTTP layer is deliberate — a shape
 * this module cannot produce is a bug in this module, and the fastest place to find
 * it is the test that called it.
 *
 * Three rules run through every read:
 *
 * - **A read never runs repository-supplied code.** Diffs pass `--no-ext-diff` and
 *   `--no-textconv`, status passes `--no-optional-locks`, and nothing here invokes a
 *   hook. No `--no-verify` appears anywhere either: this build has no mutations yet.
 * - **Every bound is reported, not silently applied.** When a page is cut short the
 *   response says so (`truncated`) and names the limit; it never presents a partial
 *   list as complete.
 * - **Unknown stays unknown.** A Git failure becomes a `Problem` with the exit code
 *   and bounded diagnostics — never a fabricated empty list.
 */
import { join } from "node:path";
import { z } from "zod";
import {
  LIMITS,
  RUNTIME_LIMITS,
  capabilitiesResponseSchema,
  diffResponseSchema,
  historyPageSchema,
  previewsResponseSchema,
  refsSnapshotSchema,
  repositoriesResponseSchema,
  stashesResponseSchema,
  statusSnapshotSchema,
  submodulesResponseSchema,
  worktreesResponseSchema,
  type CapabilitiesResponse,
  type DiffResponse,
  type FilePatch,
  type GitCapabilities,
  type HistoryPage,
  type OperationCapability,
  type PreviewsResponse,
  type Problem,
  type ProblemCode,
  type ReadKind,
  type RepositorySummary,
  type RefsSnapshot,
  type RepositoriesResponse,
  type StashesResponse,
  type StatusSnapshot,
  type SubmodulesResponse,
  type UnavailableReason,
  type WorktreesResponse,
} from "@refyard/git-contract";
import {
  CORE_LIMITS,
  GitWorkflowError,
  decorationMap,
  readCommitBodies,
  readDiffFacts,
  readHeadFacts,
  readHistoryPage,
  readRecordedGitlinkOid,
  readRefFacts,
  readStashFacts,
  readStatusFacts,
  readSubmoduleFacts,
  tipOids,
  type CommitFacts,
  type GitEngine,
  type IndexEntry,
  type ParsedFilePatch,
  type RefRecord,
  type TextCodec,
} from "@refyard/git-core";
import { HandleError, isInsideOrEqual } from "../filesystem/handles.js";
import { fingerprintFile } from "../filesystem/metadata.js";
import type { PathBinding, PathRegistry } from "../registry/paths.js";
import type {
  RepositoryRecord,
  RepositoryRegistry,
} from "../registry/repositories.js";
import type { HostWorktree, WorktreeRegistry } from "../registry/worktrees.js";
import type { RootRegistry } from "../registry/roots.js";
import type { PreviewStore } from "../filesystem/preview.js";
import type { SnapshotStore, SnapshotRecord } from "./snapshots.js";
import { statusIndexKey } from "./preconditions.js";
import {
  createGitDirLookup,
  fileExistsIn,
  isoFromMs,
  isoFromSeconds,
  readOperationMarkers,
  redactRemoteUrl,
  synthesizeUntrackedPatch,
  type SynthesizedPatch,
} from "./read-support.js";

export class ReadProblem extends Error {
  readonly code: ProblemCode;
  readonly details: Record<string, string | number | boolean>;
  readonly retryable: boolean;

  constructor(input: {
    code: ProblemCode;
    message: string;
    details?: Record<string, string | number | boolean>;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "ReadProblem";
    this.code = input.code;
    this.details = input.details ?? {};
    this.retryable = input.retryable ?? false;
  }

  toProblem(): Problem {
    return {
      code: this.code,
      message: this.message,
      ...(Object.keys(this.details).length === 0
        ? {}
        : { details: this.details }),
      retryable: this.retryable,
    };
  }
}

export interface ReadServiceOptions {
  readonly engine: GitEngine;
  readonly roots: RootRegistry;
  readonly repositories: RepositoryRegistry;
  readonly worktrees: WorktreeRegistry;
  readonly paths: PathRegistry;
  readonly snapshots: SnapshotStore;
  readonly previews: PreviewStore;
  readonly codec: TextCodec;
  readonly serviceInstanceId: string;
  readonly apiMajor: number;
  readonly contractVersion: string;
  readonly gitPath: string;
  readonly gitVersion: string;
  readonly gitFeatures: GitCapabilities;
  readonly unavailable: readonly UnavailableReason[];
  readonly reads: readonly ReadKind[];
  readonly operations: readonly OperationCapability[];
  readonly now?: () => number;
}

export interface StatusQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string | undefined;
  readonly includeIgnored?: boolean | undefined;
}

export interface HistoryQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  readonly detailOid?: string | undefined;
  readonly firstParentOnly?: boolean | undefined;
}

export interface DiffQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string | undefined;
  readonly kind: "unstaged" | "staged" | "untracked" | "commit" | "range";
  readonly oid?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly pathId?: string | undefined;
  readonly maxBytes?: number | undefined;
}

export interface ReadService {
  capabilities(): CapabilitiesResponse;
  repositories(): Promise<RepositoriesResponse>;
  status(query: StatusQuery): Promise<StatusSnapshot>;
  history(query: HistoryQuery): Promise<HistoryPage>;
  refs(query: { readonly repositoryId: string }): Promise<RefsSnapshot>;
  diff(query: DiffQuery): Promise<DiffResponse>;
  worktrees(query: {
    readonly repositoryId: string;
  }): Promise<WorktreesResponse>;
  submodules(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string | undefined;
  }): Promise<SubmodulesResponse>;
  stashes(query: { readonly repositoryId: string }): Promise<StashesResponse>;
  previews(query: {
    readonly repositoryId: string;
    readonly worktreeId: string;
    readonly pathIds: readonly string[];
  }): Promise<PreviewsResponse>;
}

/** Bound on how many files a single diff response may describe. */
const DIFF_MAX_FILES = 200;

export function createReadService(options: ReadServiceOptions): ReadService {
  const now = options.now ?? Date.now;
  const gitDirs = createGitDirLookup(options.engine);

  function mintPath(input: {
    readonly repositoryId: string;
    readonly worktreeId: string;
    readonly bytes: Uint8Array;
  }): PathBinding {
    return options.paths.bind(input);
  }

  function layoutOf(record: RepositoryRecord) {
    return {
      gitDir: record.gitDir,
      commonDir: record.commonDir,
      topLevel: record.bare ? null : record.displayPath.text,
      bare: record.bare,
      shallow: record.shallow,
      objectFormat: record.objectFormat,
    };
  }

  function requireHandle(worktree: HostWorktree): string {
    if (worktree.handle === null) {
      throw new ReadProblem({
        code: "Forbidden",
        message: `${worktree.displayPath.text} is outside every approved root; approve that directory before reading it`,
      });
    }
    return worktree.handle;
  }

  function requirePathBinding(input: {
    readonly repositoryId: string;
    readonly worktreeId: string;
    readonly pathId: string;
  }): PathBinding {
    const binding = options.paths.getForWorktree(input);
    if (binding === null) {
      throw new ReadProblem({
        code: "NotFound",
        message:
          "that path id is unknown, or it belongs to a different worktree",
        details: { pathId: input.pathId },
      });
    }
    if (binding.executionText === null) {
      throw new ReadProblem({
        code: "UnsupportedPathEncoding",
        message:
          "this path's bytes cannot be represented exactly on this host, so it cannot be used as an input",
        details: { pathId: input.pathId },
      });
    }
    return binding;
  }

  /** Translate a core or handle failure into a problem a client can act on. */
  function problemFrom(
    error: unknown,
    details: Record<string, string | number | boolean> = {},
  ): ReadProblem {
    if (error instanceof ReadProblem) {
      return error;
    }
    if (error instanceof HandleError) {
      const code: ProblemCode =
        error.code === "Forbidden"
          ? "Forbidden"
          : error.code === "NotFound"
            ? "NotFound"
            : "UnsupportedPathEncoding";
      return new ReadProblem({ code, message: error.message, details });
    }
    if (error instanceof GitWorkflowError) {
      const code: ProblemCode =
        error.code === "GitTimedOut"
          ? "Timeout"
          : error.code === "GitNotStarted"
            ? "Unavailable"
            : error.code === "GitOutputLimitExceeded"
              ? "LimitExceeded"
              : error.code === "GitOutputUnparsable" ||
                  error.code === "GitOutputIncomplete" ||
                  error.code === "ObjectMissing"
                ? "InternalError"
                : "GitCommandFailed";
      return new ReadProblem({
        code,
        message: error.message,
        details: {
          ...details,
          command: error.command,
          ...(error.exitCode === null ? {} : { exitCode: error.exitCode }),
          ...(error.diagnostic.length === 0
            ? {}
            : { diagnostic: error.diagnostic.slice(0, 500) }),
        },
        retryable: code === "Timeout",
      });
    }
    return new ReadProblem({
      code: "InternalError",
      message: error instanceof Error ? error.message : "the read failed",
      details,
    });
  }

  /** Validate a response against the contract before returning it. */
  function checked<T>(schema: z.ZodType<T>, value: T, label: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new ReadProblem({
        code: "InternalError",
        // The field path is part of the message: this failure means this module
        // built the wrong shape, and "does not match" alone is unactionable.
        message: `this service produced a ${label} response that does not match the contract: ${issues}`,
        details: { issues },
      });
    }
    return parsed.data;
  }

  return {
    capabilities(): CapabilitiesResponse {
      return checked(
        capabilitiesResponseSchema,
        {
          apiMajor: options.apiMajor,
          contractVersion: options.contractVersion,
          serviceInstanceId: options.serviceInstanceId,
          host: { kind: "node", version: process.version },
          git: {
            executableDisplay: options.codec.toDisplayPath(
              new TextEncoder().encode(options.gitPath),
            ).text,
            version: options.gitVersion,
            features: options.gitFeatures,
          },
          reads: [...options.reads],
          // Only what this build actually implements. A write operation is absent
          // from this list until it runs for real, so a client can never be told an
          // operation is available and then be refused.
          operations: options.operations.map((operation) => ({
            kind: operation.kind,
            targets: [...operation.targets],
          })),
          limits: RUNTIME_LIMITS,
          unavailable: [...options.unavailable],
        },
        "capabilities",
      );
    },

    async repositories(): Promise<RepositoriesResponse> {
      const roots = options.roots.list();
      const repositories: RepositorySummary[] = [];
      for (const record of options.repositories.list()) {
        let worktrees: readonly HostWorktree[] = [];
        try {
          worktrees = await options.repositories.worktreesOf(
            record.repositoryId,
          );
        } catch {
          worktrees = options.worktrees.list(record.repositoryId);
        }
        const primary =
          worktrees.find((worktree) => worktree.isMain) ?? worktrees[0] ?? null;
        repositories.push({
          repositoryId: record.repositoryId,
          allowedRootId: record.allowedRootId,
          displayName: record.displayName,
          displayPath: record.displayPath.text,
          objectFormat: record.objectFormat,
          worktreeIds: worktrees.map((worktree) => worktree.worktreeId),
          primaryWorktreeId: primary?.worktreeId ?? record.primaryWorktreeId,
          head: headStateOf(await headFor(primary)),
          operationInProgress: null,
          lastFetchedAt: record.lastFetchedAt,
        });
      }
      return checked(
        repositoriesResponseSchema,
        {
          repositories,
          allowedRoots: roots.map((root) => ({
            allowedRootId: root.allowedRootId,
            displayPath: root.displayPath.text,
            repositoryIds: root.repositoryIds.filter((id) =>
              repositories.some((entry) => entry.repositoryId === id),
            ),
          })),
        },
        "repositories",
      );
    },

    async status(query): Promise<StatusSnapshot> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          query.worktreeId ?? null,
        );
        const handle = requireHandle(worktree);
        const gitDir = await gitDirs.gitDirFor({
          worktreeId: worktree.worktreeId,
          handle,
          isMain: worktree.isMain,
          primaryGitDir: record.gitDir,
        });
        const facts = await readStatusFacts(options.engine, {
          cwdHandle: handle,
          layout: layoutOf(record),
          operationMarkers: await readOperationMarkers(gitDir),
          includeIgnored: query.includeIgnored === true,
        });
        const snapshot = options.snapshots.create({
          kind: "status",
          repositoryId: record.repositoryId,
          worktreeId: worktree.worktreeId,
          headOid: facts.head.oid,
          indexKey: indexKeyOf(facts),
        });
        const entries = facts.records.map((entry) => {
          const binding = mintPath({
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            bytes: entry.path,
          });
          const originalBinding =
            entry.originalPath === null
              ? null
              : mintPath({
                  repositoryId: record.repositoryId,
                  worktreeId: worktree.worktreeId,
                  bytes: entry.originalPath,
                });
          return {
            pathId: binding.pathId,
            displayPath: binding.displayPath.text,
            pathEncoding: binding.encoding,
            kind: entry.kind,
            indexStatus: entry.indexStatus,
            worktreeStatus: entry.worktreeStatus,
            originalPathId: originalBinding?.pathId ?? null,
            originalDisplayPath: originalBinding?.displayPath.text ?? null,
            headOid: entry.oids.head,
            indexOid: entry.oids.index,
            modes:
              entry.modes.head === null &&
              entry.modes.index === null &&
              entry.modes.worktree === null
                ? null
                : {
                    head: entry.modes.head,
                    index: entry.modes.index,
                    worktree: entry.modes.worktree,
                  },
            submodule:
              entry.submoduleField === "N..."
                ? null
                : {
                    commitChanged: entry.submoduleCommitChanged,
                    modified: entry.submoduleModified,
                    untracked: entry.submoduleUntracked,
                  },
            stages:
              entry.stages.length === 0
                ? null
                : entry.stages.map((stage) => ({
                    stage: stage.stage,
                    mode: stage.mode,
                    oid: stage.oid,
                  })),
          };
        });
        return checked(
          statusSnapshotSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            readAt: isoFromMs(now()),
            head: headStateOf(facts.head),
            upstream: facts.upstream,
            operationInProgress: facts.operationInProgress,
            entries,
            entryCount: entries.length,
            // A status larger than the parser's bound is an error, not a silently
            // shortened list, so this is never true for a served response.
            truncated: false,
          },
          "status",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async history(query): Promise<HistoryPage> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          query.worktreeId ?? null,
        );
        const handle = requireHandle(worktree);
        const limit = query.limit ?? LIMITS.historyDefaultPageSize;
        if (limit > LIMITS.historyMaxPageSize) {
          throw new ReadProblem({
            code: "InvalidRequest",
            message: `limit may not exceed ${LIMITS.historyMaxPageSize}`,
            details: { limit },
          });
        }

        const refFacts = await readRefFacts(options.engine, {
          cwdHandle: handle,
        });
        const head = await readHeadFacts(options.engine, handle);
        const currentTips = collectTips(head.oid, refFacts.refs);
        const decoration = decorationMap(refFacts.refs);

        let snapshot: SnapshotRecord;
        let skip = 0;
        if (query.cursor === undefined) {
          snapshot = options.snapshots.create({
            kind: "history",
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            tips: currentTips,
            headOid: head.oid,
          });
        } else {
          const resolved = options.snapshots.resolveCursor(query.cursor);
          if (!resolved.ok) {
            throw new ReadProblem({
              code:
                resolved.reason === "malformed"
                  ? "InvalidRequest"
                  : "StaleSnapshot",
              message:
                resolved.reason === "expired"
                  ? "that cursor has expired; reload history"
                  : "that cursor is not one this service issued; start the page again",
            });
          }
          if (
            resolved.payload.repositoryId !== record.repositoryId ||
            resolved.payload.worktreeId !== worktree.worktreeId
          ) {
            // A real cursor, pointed at another repository: the state exists, so
            // this is a scope violation rather than a malformed request.
            throw new ReadProblem({
              code: "Forbidden",
              message:
                "that cursor belongs to a different repository or worktree",
            });
          }
          const found = options.snapshots.get(resolved.payload.snapshotId);
          if (found === null || found.kind !== "history") {
            throw new ReadProblem({
              code: "StaleSnapshot",
              message: "that page's snapshot has expired; reload history",
            });
          }
          snapshot = found;
          skip = resolved.payload.skip;
        }

        if (snapshot.tips.length === 0) {
          // An unborn repository has no topology to page. That is an empty history,
          // not a failure, and there is no cursor to continue with.
          return checked(
            historyPageSchema,
            {
              snapshotId: snapshot.snapshotId,
              repositoryId: record.repositoryId,
              readAt: isoFromMs(now()),
              objectFormat: record.objectFormat,
              shallow: record.shallow,
              commits: [],
              nextCursor: null,
              tipsMoved: false,
              truncated: false,
              detail: null,
            },
            "history",
          );
        }

        const page = await readHistoryPage(options.engine, {
          cwdHandle: handle,
          tips: snapshot.tips,
          // One extra row answers "is there another page?" without claiming there is.
          maxCount: limit + 1,
          skip,
          firstParentOnly: query.firstParentOnly === true,
          decoration,
        });
        const hasMore = page.rows.length > limit;
        const commits = page.commits
          .slice(0, limit)
          .map((commit) => commitSummary(commit));
        const detail =
          query.detailOid === undefined
            ? null
            : await readCommitDetail(query.detailOid, handle);
        const tipsMoved = !sameTips(snapshot.tips, currentTips);
        const nextCursor = hasMore
          ? options.snapshots.createCursor({
              snapshotId: snapshot.snapshotId,
              skip: skip + commits.length,
              limit,
              kind: "history",
              repositoryId: record.repositoryId,
              worktreeId: worktree.worktreeId,
            })
          : null;

        return checked(
          historyPageSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            readAt: isoFromMs(now()),
            objectFormat: record.objectFormat,
            shallow: record.shallow,
            commits,
            nextCursor,
            tipsMoved,
            truncated: hasMore || page.missingObjects.length > 0,
            detail,
          },
          "history",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async refs(query): Promise<RefsSnapshot> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          null,
        );
        const handle = requireHandle(worktree);
        const facts = await readRefFacts(options.engine, { cwdHandle: handle });
        const head = await readHeadFacts(options.engine, handle);
        const snapshot = options.snapshots.create({
          kind: "refs",
          repositoryId: record.repositoryId,
          worktreeId: null,
          headOid: head.oid,
        });
        const currentBranchRef =
          head.branchName === null ? null : `refs/heads/${head.branchName}`;

        return checked(
          refsSnapshotSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            readAt: isoFromMs(now()),
            objectFormat: record.objectFormat,
            head: headStateOf(head),
            branches: facts.refs
              .filter((ref) => ref.refName.startsWith("refs/heads/"))
              .map((ref) => ({
                name: ref.refName.slice("refs/heads/".length),
                fullName: ref.refName,
                oid: ref.oid,
                isCurrent: ref.refName === currentBranchRef,
                upstream:
                  ref.upstream === null
                    ? null
                    : {
                        fullName: ref.upstream,
                        ahead: ref.upstreamTrack?.ahead ?? 0,
                        behind: ref.upstreamTrack?.behind ?? 0,
                        gone: ref.upstreamTrack?.gone ?? false,
                      },
              })),
            remoteBranches: facts.refs
              .filter((ref) => ref.refName.startsWith("refs/remotes/"))
              .map((ref) => {
                const short = ref.refName.slice("refs/remotes/".length);
                const slash = short.indexOf("/");
                return {
                  name: short,
                  fullName: ref.refName,
                  oid: ref.oid,
                  remoteName: slash === -1 ? short : short.slice(0, slash),
                };
              }),
            tags: facts.refs
              .filter((ref) => ref.refName.startsWith("refs/tags/"))
              .map((ref) => ({
                name: ref.refName.slice("refs/tags/".length),
                fullName: ref.refName,
                oid: ref.oid,
                annotated: ref.objectType === "tag",
                targetOid: ref.peeledOid,
              })),
            remotes: facts.remotes.map((remote) => ({
              name: remote.name,
              fetchUrlDisplay: redactRemoteUrl(remote.fetchUrl),
              pushUrlDisplay:
                remote.pushUrl === null
                  ? null
                  : redactRemoteUrl(remote.pushUrl),
            })),
            otherRefs: facts.refs
              .filter(
                (ref) =>
                  !ref.refName.startsWith("refs/heads/") &&
                  !ref.refName.startsWith("refs/remotes/") &&
                  !ref.refName.startsWith("refs/tags/"),
              )
              .map((ref) => ({
                fullName: ref.refName,
                oid: ref.oid,
                kind:
                  ref.refName === "refs/stash"
                    ? ("stash" as const)
                    : refKind(ref.refName),
              })),
            truncated: false,
          },
          "refs",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async diff(query): Promise<DiffResponse> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          query.worktreeId ?? null,
        );
        const handle = requireHandle(worktree);
        const snapshot = options.snapshots.create({
          kind: "diff",
          repositoryId: record.repositoryId,
          worktreeId: worktree.worktreeId,
        });
        const requestedBinding =
          query.pathId === undefined
            ? null
            : requirePathBinding({
                repositoryId: record.repositoryId,
                worktreeId: worktree.worktreeId,
                pathId: query.pathId,
              });
        const request = {
          kind: query.kind,
          oid: query.oid ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
          pathId: requestedBinding?.pathId ?? null,
        };

        if (query.kind === "untracked") {
          return checked(
            diffResponseSchema,
            await untrackedDiff({
              record,
              worktree,
              handle,
              snapshot,
              request,
              requestedBinding,
            }),
            "diff",
          );
        }

        const explicitPaths =
          requestedBinding === null || requestedBinding.executionText === null
            ? undefined
            : [requestedBinding.executionText];
        const facts = await readDiffFacts(options.engine, {
          cwdHandle: handle,
          scope: {
            kind: query.kind,
            ...(query.oid === undefined ? {} : { oid: query.oid }),
            ...(query.from === undefined ? {} : { from: query.from }),
            ...(query.to === undefined ? {} : { to: query.to }),
          },
          ...(explicitPaths === undefined ? {} : { patchPaths: explicitPaths }),
          ...(query.maxBytes === undefined
            ? {}
            : { maxBytesPerPatch: query.maxBytes }),
          // Without a named path the change set is described first; a patch for
          // every changed file in one response is unbounded work in a large repo.
          includePatch: explicitPaths !== undefined,
        });

        const limited = facts.files.slice(0, DIFF_MAX_FILES);
        const limitations = [...facts.limitations];
        if (facts.files.length > limited.length) {
          limitations.push(
            `the change set has ${facts.files.length} files; the first ${DIFF_MAX_FILES} are listed`,
          );
        }
        if (explicitPaths === undefined && limited.length > 0) {
          limitations.push(
            "patches are fetched per path; request one with pathId to see its patch",
          );
        }

        const files = limited.map((file) => {
          const binding = mintPath({
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            bytes: file.pathBytes,
          });
          const originalBinding =
            file.oldPathBytes === null
              ? null
              : mintPath({
                  repositoryId: record.repositoryId,
                  worktreeId: worktree.worktreeId,
                  bytes: file.oldPathBytes,
                });
          return {
            pathId: binding.pathId,
            displayPath: binding.displayPath.text,
            oldPathId: originalBinding?.pathId ?? null,
            oldDisplayPath: originalBinding?.displayPath.text ?? null,
            changeKind: file.changeKind,
            isBinary: file.isBinary,
            isSubmodule: file.isSubmodule,
            insertions: file.insertions,
            deletions: file.deletions,
            modes: file.modes,
            patch: filePatchDto(file.patch),
          };
        });

        return checked(
          diffResponseSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            readAt: isoFromMs(now()),
            request,
            files,
            stats: {
              filesChanged: files.length,
              insertions: sum(files.map((file) => file.insertions)),
              deletions: sum(files.map((file) => file.deletions)),
              binaryFiles: files.filter((file) => file.isBinary).length,
            },
            truncated: limitations.length > 0,
          },
          "diff",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async worktrees(query): Promise<WorktreesResponse> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktrees = await options.repositories.worktreesOf(
          query.repositoryId,
        );
        const snapshot = options.snapshots.create({
          kind: "worktrees",
          repositoryId: record.repositoryId,
          worktreeId: null,
        });
        return checked(
          worktreesResponseSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            readAt: isoFromMs(now()),
            worktrees: worktrees.map((worktree) => ({
              worktreeId: worktree.worktreeId,
              displayPath: worktree.displayPath.text,
              head: {
                kind:
                  worktree.headOid === null
                    ? ("unborn" as const)
                    : ("born" as const),
                branchName:
                  worktree.branchRef === null
                    ? null
                    : worktree.branchRef.startsWith("refs/heads/")
                      ? worktree.branchRef.slice("refs/heads/".length)
                      : worktree.branchRef,
                oid: worktree.headOid,
                detached: worktree.detached,
              },
              isMain: worktree.isMain,
              isBare: worktree.isBare,
              isDetached: worktree.detached,
              isLocked: worktree.locked,
              lockReason: worktree.lockReason?.text ?? null,
              isPrunable: worktree.prunable,
            })),
          },
          "worktrees",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async submodules(query): Promise<SubmodulesResponse> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          query.worktreeId ?? null,
        );
        const handle = requireHandle(worktree);
        const snapshot = options.snapshots.create({
          kind: "submodules",
          repositoryId: record.repositoryId,
          worktreeId: worktree.worktreeId,
        });
        const facts = await readSubmoduleFacts(options.engine, {
          cwdHandle: handle,
          hasGitmodulesFile: await fileExistsIn(worktree.path, ".gitmodules"),
        });
        const head = await readHeadFacts(options.engine, handle);

        // Gitlinks are keyed by their raw bytes, so a path that is not valid UTF-8
        // still matches the `.gitmodules` entry that produced it.
        const gitlinksByPath = new Map<string, IndexEntry>();
        for (const gitlink of facts.gitlinks) {
          gitlinksByPath.set(bytesKey(gitlink.path), gitlink);
        }

        const rows: SubmodulesResponse["submodules"] = [];
        const usedPaths = new Set<string>();
        for (const configured of facts.configured) {
          const bytes = new TextEncoder().encode(configured.path);
          const binding = mintPath({
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            bytes,
          });
          usedPaths.add(bytesKey(bytes));
          const gitlink = gitlinksByPath.get(bytesKey(bytes)) ?? null;
          const actualOid = await readSubmoduleHead(
            worktree.path,
            configured.path,
          );
          const recordedOid =
            head.oid === null
              ? null
              : await readRecordedGitlinkOid(options.engine, {
                  cwdHandle: handle,
                  revision: head.oid,
                  path: configured.path,
                });
          const indexOid = gitlink?.oid ?? null;
          rows.push({
            name: configured.name,
            pathId: binding.pathId,
            displayPath: binding.displayPath.text,
            recordedOid,
            indexOid,
            actualOid,
            state: submoduleState({ actualOid, indexOid, recordedOid }),
            urlDisplay: redactRemoteUrl(configured.url),
            branchName: configured.branch,
            submoduleRepositoryId: null,
          });
        }

        // A gitlink with no `.gitmodules` entry still exists in the index; it is
        // shown rather than dropped, with the state this build cannot determine.
        for (const [key, gitlink] of gitlinksByPath) {
          if (usedPaths.has(key)) {
            continue;
          }
          const binding = mintPath({
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            bytes: gitlink.path,
          });
          rows.push({
            name: binding.displayPath.text,
            pathId: binding.pathId,
            displayPath: binding.displayPath.text,
            recordedOid: null,
            indexOid: gitlink.oid,
            actualOid: null,
            state: "unknown",
            urlDisplay: "",
            branchName: null,
            submoduleRepositoryId: null,
          });
        }

        return checked(
          submodulesResponseSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            readAt: isoFromMs(now()),
            submodules: rows,
            truncated: false,
          },
          "submodules",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async stashes(query): Promise<StashesResponse> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          null,
        );
        const handle = requireHandle(worktree);
        const snapshot = options.snapshots.create({
          kind: "stashes",
          repositoryId: record.repositoryId,
          worktreeId: null,
        });
        return checked(
          stashesResponseSchema,
          {
            snapshotId: snapshot.snapshotId,
            repositoryId: record.repositoryId,
            readAt: isoFromMs(now()),
            stashes: (
              await readStashFacts(options.engine, { cwdHandle: handle })
            ).map((stash) => ({
              oid: stash.oid,
              locator: stash.locator,
              message: options.codec.decodeText(stash.messageBytes),
              createdAt: isoFromSeconds(stash.createdAtSeconds),
              branchDisplay:
                stash.branchBytes === null
                  ? null
                  : options.codec.decodeText(stash.branchBytes),
            })),
            truncated: false,
          },
          "stashes",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },

    async previews(query): Promise<PreviewsResponse> {
      try {
        const record = await options.repositories.require(query.repositoryId);
        const worktree = await options.repositories.worktree(
          query.repositoryId,
          query.worktreeId,
        );
        if (query.pathIds.length === 0) {
          throw new ReadProblem({
            code: "InvalidRequest",
            message: "at least one path id is required",
          });
        }
        if (query.pathIds.length > LIMITS.pathSelectionMaxEntries) {
          throw new ReadProblem({
            code: "LimitExceeded",
            message: `at most ${LIMITS.pathSelectionMaxEntries} paths may be previewed at once`,
            details: { pathCount: query.pathIds.length },
          });
        }
        // The preview names the state it was taken against, so a mutation built on
        // it is refused if the index moved in between.
        const previewFacts = await readStatusFacts(options.engine, {
          cwdHandle: requireHandle(worktree),
          layout: layoutOf(record),
          operationMarkers: [],
        });
        const snapshot = options.snapshots.create({
          kind: "status",
          repositoryId: record.repositoryId,
          worktreeId: worktree.worktreeId,
          headOid: previewFacts.head.oid,
          indexKey: indexKeyOf(previewFacts),
        });

        const tokens = [];
        for (const pathId of query.pathIds) {
          const binding = requirePathBinding({
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            pathId,
          });
          const absolute = join(worktree.path, binding.executionText ?? "");
          if (!isInsideOrEqual(worktree.path, absolute)) {
            throw new ReadProblem({
              code: "Forbidden",
              message: "that path resolves outside the worktree",
              details: { pathId },
            });
          }
          const fingerprint = await fingerprintOrNull(absolute);
          const issued = options.previews.issue({
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            pathId,
            // An unreadable file gets an empty fingerprint, which can never match a
            // later verification: the mutation is refused as stale rather than
            // proceeding against content nobody saw.
            fingerprintHex: fingerprint?.hex ?? "",
            sizeBytes: fingerprint?.sizeBytes ?? null,
            contentKind: fingerprint?.contentKind ?? "unrepresentable",
          });
          tokens.push({
            pathId,
            previewToken: issued.previewToken,
            sizeBytes: fingerprint?.sizeBytes ?? null,
            contentKind:
              fingerprint?.contentKind ?? ("unrepresentable" as const),
            fingerprintAlgorithm: "sha256" as const,
            expiresAt: isoFromMs(issued.expiresAtMs),
          });
        }

        return checked(
          previewsResponseSchema,
          {
            repositoryId: record.repositoryId,
            worktreeId: worktree.worktreeId,
            snapshotId: snapshot.snapshotId,
            readAt: isoFromMs(now()),
            tokens,
          },
          "previews",
        );
      } catch (error) {
        throw problemFrom(error, { repositoryId: query.repositoryId });
      }
    },
  };

  /* --------------------------------------------------------------- helpers */

  async function headFor(worktree: HostWorktree | null) {
    if (worktree === null || worktree.handle === null) {
      return {
        kind: "unborn" as const,
        branchName: null,
        oid: null,
        detached: false,
      };
    }
    return readHeadFacts(options.engine, worktree.handle);
  }

  /**
   * The index fingerprint a mutation will be checked against.
   *
   * It covers the paths Git already reported as changed plus the Head, which is
   * enough to detect "the state the user confirmed has moved" without hashing the
   * whole repository on every read — the design forbids that explicitly.
   */
  function indexKeyOf(facts: Parameters<typeof statusIndexKey>[0]): string {
    return statusIndexKey(facts);
  }

  function collectTips(
    headOid: string | null,
    refs: readonly RefRecord[],
  ): string[] {
    const tips = tipOids(refs, LIMITS.historyTipsMax);
    if (headOid !== null && !tips.includes(headOid)) {
      return [headOid, ...tips].slice(0, LIMITS.historyTipsMax);
    }
    return tips;
  }

  function commitSummary(commit: CommitFacts) {
    return {
      oid: commit.oid,
      parents: [...commit.parents],
      subject: options.codec.decodeText(commit.subjectBytes),
      authorName: options.codec.decodeText(commit.authorNameBytes),
      authorEmail: options.codec.decodeText(commit.authorEmailBytes),
      authoredAt: isoFromSeconds(commit.authoredAtSeconds),
      committedAt: isoFromSeconds(commit.committedAtSeconds),
      refNames: [...commit.refNames],
      signed: commit.signed,
      boundary: commit.boundary,
      missingParents: [...commit.missingParents],
    };
  }

  async function readCommitDetail(oid: string, handle: string) {
    const { bodies, missing } = await readCommitBodies(options.engine, {
      cwdHandle: handle,
      oids: [oid],
    });
    const body = bodies[0];
    if (body === undefined) {
      throw new ReadProblem({
        code: "NotFound",
        message: `commit ${oid} is not present in this repository`,
        details: {
          oid,
          ...(missing.length === 0 ? {} : { missing: missing.join(",") }),
        },
      });
    }
    return {
      oid,
      parents: [...body.parents],
      treeOid: body.treeOid,
      authorName: options.codec.decodeText(body.authorNameBytes),
      authorEmail: options.codec.decodeText(body.authorEmailBytes),
      authoredAt: isoFromSeconds(body.authoredAtSeconds),
      committerName: options.codec.decodeText(body.committerNameBytes),
      committerEmail: options.codec.decodeText(body.committerEmailBytes),
      committedAt: isoFromSeconds(body.committedAtSeconds),
      subject: options.codec.decodeText(commitSubjectOf(body.messageBytes)),
      body: options.codec.decodeText(body.messageBytes),
      encoding: body.encoding,
      signed: body.signed,
    };
  }

  async function untrackedDiff(input: {
    readonly record: RepositoryRecord;
    readonly worktree: HostWorktree;
    readonly handle: string;
    readonly snapshot: SnapshotRecord;
    readonly request: DiffResponse["request"];
    readonly requestedBinding: PathBinding | null;
  }): Promise<DiffResponse> {
    const facts = await readStatusFacts(options.engine, {
      cwdHandle: input.handle,
      layout: layoutOf(input.record),
      operationMarkers: [],
    });
    const untracked = facts.records.filter(
      (entry) => entry.kind === "untracked",
    );
    const targeted =
      input.requestedBinding === null
        ? untracked
        : untracked.filter((entry) =>
            equalBytes(
              entry.path,
              input.requestedBinding?.bytes ?? new Uint8Array(0),
            ),
          );
    const limited = targeted.slice(0, DIFF_MAX_FILES);

    const files = [];
    for (const entry of limited) {
      const binding = mintPath({
        repositoryId: input.record.repositoryId,
        worktreeId: input.worktree.worktreeId,
        bytes: entry.path,
      });
      const synthesized: SynthesizedPatch =
        binding.executionText === null
          ? {
              kind: "unavailable",
              reason: "the path cannot be represented exactly",
            }
          : await synthesizeUntrackedPatch({
              worktreePath: input.worktree.path,
              relativePath: binding.executionText,
              maxBytes: CORE_LIMITS.patchMaxBytesPerFile,
              codec: options.codec,
            });
      files.push({
        pathId: binding.pathId,
        displayPath: binding.displayPath.text,
        oldPathId: null,
        oldDisplayPath: null,
        changeKind: "added" as const,
        isBinary: synthesized.kind === "binary",
        isSubmodule: false,
        insertions: synthesized.hunks?.[0]?.newLines ?? null,
        deletions: 0,
        modes: null,
        patch: synthesizedPatchDto(synthesized),
      });
    }

    return {
      snapshotId: input.snapshot.snapshotId,
      repositoryId: input.record.repositoryId,
      worktreeId: input.worktree.worktreeId,
      readAt: isoFromMs(now()),
      request: input.request,
      files,
      stats: {
        filesChanged: files.length,
        insertions: sum(files.map((file) => file.insertions)),
        deletions: 0,
        binaryFiles: files.filter((file) => file.isBinary).length,
      },
      truncated: targeted.length > limited.length,
    };
  }

  /**
   * The submodule's own HEAD, read inside its directory.
   *
   * A submodule that is not initialized has no Git directory to read, which is a
   * state rather than an error. Anything else that fails (permissions, a broken
   * checkout) also yields `null` here, and the row's state reports `unknown` instead
   * of an invented object name.
   */
  async function readSubmoduleHead(
    worktreePath: string,
    relativePath: string,
  ): Promise<string | null> {
    const childHandle = childHandleFor(join(worktreePath, relativePath));
    if (childHandle === null) {
      return null;
    }
    try {
      const head = await readHeadFacts(options.engine, childHandle);
      return head.oid;
    } catch {
      return null;
    }
  }

  function childHandleFor(absolute: string): string | null {
    for (const root of options.roots.list()) {
      if (!isInsideOrEqual(root.path, absolute)) {
        continue;
      }
      const relativePath = relativeTo(root.path, absolute);
      if (relativePath === null) {
        continue;
      }
      try {
        return options.roots.handles.handleFor(
          root.allowedRootId,
          relativePath,
        );
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ helpers */

function headStateOf(input: {
  readonly kind: "born" | "unborn";
  readonly branchName: string | null;
  readonly oid: string | null;
  readonly detached: boolean;
}): {
  kind: "born" | "unborn";
  branchName: string | null;
  oid: string | null;
  detached: boolean;
} {
  return {
    kind: input.kind,
    branchName: input.branchName,
    oid: input.oid,
    detached: input.detached,
  };
}

function relativeTo(root: string, absolute: string): string | null {
  if (root === absolute) {
    return "";
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : null;
}

function bytesKey(bytes: Uint8Array): string {
  let key = "";
  for (const byte of bytes) {
    key += byte.toString(16).padStart(2, "0");
  }
  return key;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function sum(values: readonly (number | null)[]): number {
  let total = 0;
  for (const value of values) {
    total += value ?? 0;
  }
  return total;
}

function refKind(fullName: string): "notes" | "replace" | "other" {
  if (fullName.startsWith("refs/notes/")) {
    return "notes";
  }
  if (fullName.startsWith("refs/replace/")) {
    return "replace";
  }
  return "other";
}

function sameTips(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function submoduleState(input: {
  readonly actualOid: string | null;
  readonly indexOid: string | null;
  readonly recordedOid: string | null;
}): "uninitialized" | "initialized" | "outOfSync" | "dirty" | "unknown" {
  if (input.indexOid === null && input.recordedOid === null) {
    return "unknown";
  }
  if (input.actualOid === null) {
    return "uninitialized";
  }
  if (input.indexOid !== null && input.actualOid !== input.indexOid) {
    return "outOfSync";
  }
  if (input.recordedOid !== null && input.actualOid !== input.recordedOid) {
    return "outOfSync";
  }
  return "initialized";
}

/** Map a parsed patch body onto the contract's `FilePatch`. */
function filePatchDto(patch: ParsedFilePatch | null): FilePatch {
  if (patch === null) {
    return {
      kind: "unavailable",
      reason: "no patch was requested for this path",
    };
  }
  switch (patch.body.kind) {
    case "text":
      return {
        kind: "text",
        synthesized: false,
        hunks: patch.body.hunks.map((hunk) => ({
          header: hunk.header,
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          lines: hunk.lines.map((line) => ({
            kind: line.kind,
            text: line.text,
            noNewline: line.noNewline,
          })),
        })),
      };
    case "binary":
      return { kind: "binary" };
    case "submodule":
      return {
        kind: "submodule",
        oldOid: patch.body.oldOid,
        newOid: patch.body.newOid,
      };
    case "modeOnly":
      // A mode-only change has no lines; the file's `modes` carry the fact.
      return { kind: "text", synthesized: false, hunks: [] };
    default:
      return { kind: "unavailable", reason: patch.body.reason };
  }
}

function synthesizedPatchDto(patch: SynthesizedPatch): FilePatch {
  switch (patch.kind) {
    case "text":
      return {
        kind: "text",
        synthesized: true,
        hunks: (patch.hunks ?? []).map((hunk) => ({
          header: hunk.header,
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          lines: hunk.lines.map((line) => ({ ...line })),
        })),
      };
    case "binary":
      return { kind: "binary" };
    case "oversize":
      return {
        kind: "oversize",
        reason: patch.reason ?? "the file is too large to show",
      };
    default:
      return {
        kind: "unavailable",
        reason: patch.reason ?? "the file could not be read",
      };
  }
}

async function fingerprintOrNull(absolute: string): Promise<{
  readonly hex: string;
  readonly sizeBytes: number;
  readonly contentKind: "text" | "binary" | "unrepresentable";
} | null> {
  try {
    return await fingerprintFile(absolute);
  } catch {
    return null;
  }
}

function commitSubjectOf(messageBytes: Uint8Array): Uint8Array {
  for (let index = 0; index < messageBytes.byteLength; index += 1) {
    if (messageBytes[index] === 0x0a) {
      return messageBytes.subarray(0, index);
    }
  }
  return messageBytes;
}
