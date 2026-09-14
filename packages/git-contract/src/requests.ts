/**
 * Mutation requests: the only way a client can ask for a state change.
 *
 * A request is `{ clientRequestId, target, operation }`. The target and the
 * operation are validated *together* — `stagePaths` against a workspace target is
 * not a request with a wrong field, it is not a request at all — so the pairing
 * rule lives in one place (`OPERATION_TARGET_LIST`) and the schema is generated
 * from it. There is deliberately no generic escape hatch: an operation kind that
 * is not in the union cannot be expressed, which is what makes `runGit`-style
 * proxying impossible rather than merely forbidden.
 */
import { z } from "zod";
import {
  clientRequestIdSchema,
  operationIdSchema,
  timestampSchema,
  type ClientRequestId,
} from "./ids.js";
import {
  MUTATION_KINDS,
  OPERATION_SCHEMAS,
  OPERATION_TARGET_LIST,
  type MutationKind,
  type OperationFor,
  type TargetKindsOf,
} from "./operations.js";
import {
  targetSchemaFor,
  type RepositoryTarget,
  type TargetKind,
  type WorktreeTarget,
  type WorkspaceTarget,
} from "./targets.js";

/** Non-empty tuple helper, so `z.union` can be built from a mapped list. */
function nonEmpty<T>(items: T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new Error("expected at least one item");
  }
  return [first, ...rest];
}

const REQUEST_BRANCHES = nonEmpty(
  OPERATION_TARGET_LIST.map(([kind, targets]) =>
    z.strictObject({
      clientRequestId: clientRequestIdSchema,
      target: targetSchemaFor(targets),
      operation: OPERATION_SCHEMAS[kind],
    }),
  ),
);

export const MutationRequestSchema = z.union(REQUEST_BRANCHES).meta({
  id: "MutationRequest",
  description:
    "A closed mutation: idempotency key, the resource it addresses, and the operation. Unknown keys and unknown operation kinds are rejected.",
});

/** The parsed shape of the schema above; looser in `target` than the typed union below. */
export type ParsedMutationRequest = z.infer<typeof MutationRequestSchema>;

type TargetForKind<K extends TargetKind> = {
  workspace: WorkspaceTarget;
  repository: RepositoryTarget;
  worktree: WorktreeTarget;
}[K];

/**
 * A request with its target *type* tied to its operation: constructing a
 * `stagePaths` request for a repository target is a compile error as well as a
 * validation error. This is the type clients and the coordinator use; the Zod
 * schema above remains the runtime authority.
 */
export type MutationRequestFor<K extends MutationKind> = {
  readonly clientRequestId: ClientRequestId;
  readonly target: TargetForKind<TargetKindsOf<K>[number]>;
  readonly operation: OperationFor<K>;
};

export type MutationRequest = {
  [K in MutationKind]: MutationRequestFor<K>;
}[MutationKind];

/** The 202 response: accepted for execution, not finished. */
export const operationAcceptedSchema = z
  .strictObject({
    operationId: operationIdSchema,
    status: z.literal("accepted"),
    acceptedAt: timestampSchema,
  })
  .meta({
    id: "OperationAccepted",
    description:
      "The operation was recorded durably. It has not run yet, and may still fail.",
  });

export type OperationAccepted = z.infer<typeof operationAcceptedSchema>;

/** Narrowing helpers, so the coordinator never casts a target. */
export function isWorktreeTarget(
  target: WorkspaceTarget | RepositoryTarget | WorktreeTarget,
): target is WorktreeTarget {
  return target.kind === "worktree";
}

export function isRepositoryTarget(
  target: WorkspaceTarget | RepositoryTarget | WorktreeTarget,
): target is RepositoryTarget {
  return target.kind === "repository";
}

export function isWorkspaceTarget(
  target: WorkspaceTarget | RepositoryTarget | WorktreeTarget,
): target is WorkspaceTarget {
  return target.kind === "workspace";
}

/** All 35 kinds, re-exported here so request consumers need one import. */
export { MUTATION_KINDS };
