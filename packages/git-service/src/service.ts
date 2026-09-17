/**
 * The transport-neutral Git service interfaces.
 *
 * These are extracted from the HTTP client the UI already used, not invented
 * beside it: same methods, same DTOs, same error vocabulary. A component (or a
 * workbench controller) is written against these types and never against HTTP,
 * SSE, `invoke`, or a token. Which adapter supplies them is decided once, at the
 * composition root.
 */
import type {
  CapabilitiesResponse,
  DiffResponse,
  FilesystemEntriesResponse,
  HealthResponse,
  HistoryPage,
  HistoryQuery,
  OperationAccepted,
  OperationRecord,
  ParsedMutationRequest,
  PreviewsResponse,
  RefsSnapshot,
  RepositoriesResponse,
  StashesResponse,
  StatusSnapshot,
  SubmodulesResponse,
  WorktreesResponse,
} from "@refyard/git-contract";

/**
 * Which execution target a read is about. Omitting both fields keeps the original
 * meaning — the session's default local target — which is what lets one UI talk to
 * a service that has never heard of targets.
 */
export interface TargetSelector {
  readonly targetId?: string;
  readonly repositoryId?: string;
}

export interface RegisterRepositoryOptions {
  readonly targetId: string;
}

export interface StatusQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
  readonly includeIgnored?: boolean;
}

export interface DiffQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
  readonly kind: "unstaged" | "staged" | "untracked" | "commit" | "range";
  readonly oid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly pathId?: string;
  readonly maxBytes?: number;
}

export interface WorktreesQuery {
  readonly repositoryId: string;
}

export interface SubmodulesQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
}

export interface StashesQuery {
  readonly repositoryId: string;
}

export interface PreviewsQuery {
  readonly repositoryId: string;
  readonly worktreeId: string;
  readonly pathIds: readonly string[];
}

export interface FilesystemEntriesQuery {
  readonly path?: string;
  readonly targetId?: string;
}

export interface GitReadService {
  health(): Promise<HealthResponse>;
  capabilities(query?: TargetSelector): Promise<CapabilitiesResponse>;
  repositories(): Promise<RepositoriesResponse>;
  filesystemEntries(
    query?: FilesystemEntriesQuery,
  ): Promise<FilesystemEntriesResponse>;
  /** Registers a path the user chose. `targetId` names where that path lives. */
  registerRepository(
    path: string,
    options?: RegisterRepositoryOptions,
  ): Promise<RepositoriesResponse>;
  revokeRepository(repositoryId: string): Promise<RepositoriesResponse>;
  status(query: StatusQuery): Promise<StatusSnapshot>;
  history(query: HistoryQuery): Promise<HistoryPage>;
  refs(query: { readonly repositoryId: string }): Promise<RefsSnapshot>;
  diff(query: DiffQuery): Promise<DiffResponse>;
  worktrees(query: WorktreesQuery): Promise<WorktreesResponse>;
  submodules(query: SubmodulesQuery): Promise<SubmodulesResponse>;
  stashes(query: StashesQuery): Promise<StashesResponse>;
  previews(query: PreviewsQuery): Promise<PreviewsResponse>;
}

/**
 * A submission either started a new operation or replayed an existing one. The
 * duplicate case is a result, not an error: the caller must never treat "I did not
 * see the first response" as a reason to write again.
 */
export type SubmitResult =
  | { readonly kind: "accepted"; readonly accepted: OperationAccepted }
  | { readonly kind: "duplicate"; readonly record: OperationRecord };

export interface MutationService {
  submit(request: ParsedMutationRequest): Promise<SubmitResult>;
  get(operationId: string): Promise<OperationRecord>;
  list(
    limit?: number,
  ): Promise<{ readonly operations: readonly OperationRecord[] }>;
  cancel(operationId: string): Promise<OperationRecord>;
}
