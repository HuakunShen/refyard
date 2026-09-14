/**
 * The mutation client: submit, poll, cancel.
 *
 * Two rules from the design are implemented here, in the client, because a UI that
 * gets them wrong is the failure they describe:
 *
 * - **A submission is never retried automatically.** `submit` sends once. If the
 *   response is lost, the caller uses `get(operationId)` — the operation may already
 *   be running, and sending it again with the same `clientRequestId` is only safe
 *   because the host deduplicates it, not because the client retries blindly.
 * - **A 202 is not a result.** `submit` returns the accepted envelope; the outcome
 *   comes from `get` or from the event stream. The client exposes no method that
 *   waits and pretends to know.
 */
import { z } from "zod";
import {
  operationAcceptedSchema,
  operationRecordSchema,
  type OperationAccepted,
  type OperationRecord,
  type ParsedMutationRequest,
} from "@refyard/git-contract";
import { GitClientError } from "./client.js";

export interface MutationClientOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token: () => string | null;
}

export interface MutationClient {
  /** Submit once. A duplicate `clientRequestId` returns the original record. */
  submit(
    request: ParsedMutationRequest,
  ): Promise<
    | { readonly kind: "accepted"; readonly accepted: OperationAccepted }
    | { readonly kind: "duplicate"; readonly record: OperationRecord }
  >;
  get(operationId: string): Promise<OperationRecord>;
  list(
    limit?: number,
  ): Promise<{ readonly operations: readonly OperationRecord[] }>;
  cancel(operationId: string): Promise<OperationRecord>;
}

const recordEnvelopeSchema = z.looseObject({
  operation: operationRecordSchema,
});

export function createMutationClient(
  options: MutationClientOptions,
): MutationClient {
  async function send<Response>(
    path: string,
    schema: z.ZodType<Response>,
    body: unknown,
  ): Promise<Response> {
    const token = options.token();
    const response = await options.fetch(`${options.baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw problemFrom(response.status, text);
    }
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new GitClientError({
        code: "InternalError",
        status: response.status,
        message: "the service returned a body that does not match the contract",
      });
    }
    return parsed.data;
  }

  return {
    async submit(request) {
      const response = await options.fetch(
        `${options.baseUrl}/api/v1/operations`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(options.token() === null
              ? {}
              : { authorization: `Bearer ${options.token() ?? ""}` }),
          },
          credentials: "omit",
          cache: "no-store",
          body: JSON.stringify(request),
        },
      );
      const text = await response.text();
      if (!response.ok) {
        throw problemFrom(response.status, text);
      }
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "operation" in parsed
      ) {
        const envelope = recordEnvelopeSchema.parse(parsed);
        return { kind: "duplicate", record: envelope.operation };
      }
      // Only a 202 means "accepted for execution"; anything else that looked like a
      // success would be reported as a duplicate or an error instead.
      if (response.status !== 202) {
        throw new GitClientError({
          code: "InternalError",
          status: response.status,
          message:
            "the service answered a submission without an accepted envelope",
        });
      }
      return {
        kind: "accepted",
        accepted: operationAcceptedSchema.parse(parsed),
      };
    },

    async get(operationId) {
      const response = await options.fetch(
        `${options.baseUrl}/api/v1/operations?operationId=${encodeURIComponent(operationId)}`,
        {
          headers: {
            accept: "application/json",
            ...(options.token() === null
              ? {}
              : { authorization: `Bearer ${options.token() ?? ""}` }),
          },
          credentials: "omit",
          cache: "no-store",
        },
      );
      const text = await response.text();
      if (!response.ok) {
        throw problemFrom(response.status, text);
      }
      const envelope = recordEnvelopeSchema.parse(JSON.parse(text));
      return envelope.operation;
    },

    async list(limit) {
      const response = await options.fetch(
        `${options.baseUrl}/api/v1/operations${limit === undefined ? "" : `?limit=${limit}`}`,
        {
          headers: {
            accept: "application/json",
            ...(options.token() === null
              ? {}
              : { authorization: `Bearer ${options.token() ?? ""}` }),
          },
          credentials: "omit",
          cache: "no-store",
        },
      );
      const text = await response.text();
      if (!response.ok) {
        throw problemFrom(response.status, text);
      }
      const parsed = z
        .looseObject({ operations: z.array(operationRecordSchema) })
        .parse(JSON.parse(text));
      return { operations: parsed.operations };
    },

    async cancel(operationId) {
      const envelope = await send(
        "/api/v1/operations/cancel",
        recordEnvelopeSchema,
        { operationId },
      );
      return envelope.operation;
    },
  };
}

function problemFrom(status: number, text: string): GitClientError {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "problem" in parsed &&
      typeof parsed.problem === "object" &&
      parsed.problem !== null
    ) {
      const problem = parsed.problem as {
        code: GitClientError["code"];
        message: string;
        retryable?: boolean;
        details?: Record<string, string | number | boolean>;
      };
      return new GitClientError({
        code: problem.code,
        status,
        message: problem.message,
        retryable: problem.retryable ?? false,
        ...(problem.details === undefined ? {} : { details: problem.details }),
      });
    }
  } catch {
    // Falls through to the generic error: the status is the only fact that survived.
  }
  return new GitClientError({
    code: status === 401 ? "Unauthenticated" : "InternalError",
    status,
    message: `the service returned ${status} without a problem body`,
  });
}
