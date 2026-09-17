/**
 * `createTauriBackendAdapter` — the native way to reach the Refyard service.
 *
 * There is no bearer, no port and no HTTP here: the WebView calls commands and listens
 * for scoped events, and the host binds the session to the window that asked for it.
 * That is the point of the adapter layer — the UI above it is identical, and the
 * difference is confined to this file.
 *
 * Two things this file deliberately does *not* do: it never claims a capability the
 * host did not report, and it never re-sends a mutation. A dropped response leaves the
 * operation where the host recorded it, and the caller finds it again by id.
 */
import { z } from "zod";
import type {
  AcknowledgeUncertainOperationRequest,
  CreateTargetRequest,
} from "@refyard/git-contract";
import type {
  BackendAdapter,
  BackendConnectOptions,
  BackendSession,
  ConnectionState,
  EventService,
  EventSubscription,
  GitReadService,
  HostService,
  MutationService,
  SessionMetadata,
} from "@refyard/git-service";
import { BackendError } from "@refyard/git-service";

import {
  assertHostRequest,
  assertReadRequest,
  HOST_RESPONSE_SCHEMAS,
  nativeSessionMetadataSchema,
  OPERATION_COMMANDS,
  operationRecordSchemaForNative,
  problemFromInvocation,
  validateHostResponse,
  validateReadResponse,
  type GitReadRequest,
  type HostRequest,
  type NativePorts,
  type NativeReadMethod,
} from "./commands.js";
import { createNativeEventService } from "./events.js";

export interface TauriBackendAdapterOptions {
  readonly ports: NativePorts;
  /**
   * Where subscription ids come from. Random in production; a counter in tests, so an
   * assertion can name the subscription it means.
   */
  readonly nextSubscriptionId?: () => string;
}

export function createTauriBackendAdapter(
  options: TauriBackendAdapterOptions,
): BackendAdapter {
  const generateSubscriptionId =
    options.nextSubscriptionId ??
    (() => `sub_${Math.random().toString(36).slice(2, 10)}`);

  return {
    kind: "tauri",
    async connect(
      connectOptions: BackendConnectOptions,
    ): Promise<BackendSession> {
      // A native session is bound to this WebView, not to a ticket: offering an HTTP
      // pairing option here would invite a token that nothing on this side can use.
      if (
        connectOptions.ticket !== undefined ||
        connectOptions.password !== undefined
      ) {
        throw new BackendError({
          code: "InvalidRequest",
          message:
            "a native session is not paired with an HTTP ticket or password",
          retryable: false,
        });
      }

      const raw = await options.ports
        .invoke<unknown>("refyard_connect", {})
        .catch((error: unknown) => {
          throw problemFrom(error);
        });
      const parsed = nativeSessionMetadataSchema.safeParse(raw);
      if (!parsed.success) {
        throw new BackendError({
          code: "InternalError",
          message:
            "the native host answered the session handshake with a shape this client cannot validate",
          retryable: false,
        });
      }
      // The host minted this id and bound it to this window, so the native adapter
      // always knows a real session id — unlike a bearer restored from storage.
      const nativeMetadata = parsed.data;
      const metadata: SessionMetadata = nativeMetadata;

      let state: ConnectionState = { phase: "ready", problem: null };
      const listeners = new Set<(state: ConnectionState) => void>();
      const subscriptions = new Set<EventSubscription>();
      let disposed = false;

      const setState = (next: ConnectionState): void => {
        state = next;
        for (const listener of listeners) listener(state);
      };

      const guard = async <T>(run: () => Promise<T>): Promise<T> => {
        try {
          return await run();
        } catch (error) {
          const failure =
            error instanceof BackendError ? error : problemFrom(error);
          if (failure.code === "Unauthenticated") {
            setState({ phase: "failed", problem: failure.problem });
          }
          throw failure;
        }
      };

      const read = async <M extends NativeReadMethod>(
        request: GitReadRequest,
        method: M,
      ): Promise<unknown> =>
        guard(async () => {
          assertReadRequest(request);
          const payload = await options.ports
            .invoke<unknown>("refyard_git_read", {
              sessionId: metadata.sessionId,
              request,
            })
            .catch((error: unknown) => {
              throw problemFrom(error);
            });
          return validateReadResponse(method, payload);
        });

      const git: GitReadService = {
        health: async () =>
          (await read({ method: "health" }, "health")) as never,
        capabilities: async (query) =>
          (await read(
            query === undefined
              ? { method: "capabilities" }
              : { method: "capabilities", query },
            "capabilities",
          )) as never,
        repositories: async () =>
          (await read({ method: "repositories" }, "repositories")) as never,
        filesystemEntries: async (query) =>
          (await read(
            query === undefined
              ? { method: "filesystemEntries" }
              : { method: "filesystemEntries", query },
            "filesystemEntries",
          )) as never,
        registerRepository: async (path, registerOptions) =>
          (await read(
            registerOptions?.targetId === undefined
              ? { method: "registerRepository", path }
              : {
                  method: "registerRepository",
                  path,
                  targetId: registerOptions.targetId,
                },
            "registerRepository",
          )) as never,
        revokeRepository: async (repositoryId) =>
          (await read(
            { method: "revokeRepository", repositoryId },
            "revokeRepository",
          )) as never,
        status: async (query) =>
          (await read({ method: "status", query }, "status")) as never,
        history: async (query) =>
          (await read({ method: "history", query }, "history")) as never,
        refs: async (query) =>
          (await read({ method: "refs", query }, "refs")) as never,
        diff: async (query) =>
          (await read({ method: "diff", query }, "diff")) as never,
        worktrees: async (query) =>
          (await read({ method: "worktrees", query }, "worktrees")) as never,
        submodules: async (query) =>
          (await read({ method: "submodules", query }, "submodules")) as never,
        stashes: async (query) =>
          (await read({ method: "stashes", query }, "stashes")) as never,
        previews: async (query) =>
          (await read(
            {
              method: "previews",
              query: { ...query, pathIds: [...query.pathIds] },
            },
            "previews",
          )) as never,
      };

      const record = async (payload: unknown): Promise<never> => {
        const parsed = operationRecordSchemaForNative.safeParse(payload);
        if (!parsed.success) {
          throw new BackendError({
            code: "InternalError",
            message:
              "the native host answered an operation command with a shape this client cannot validate",
            retryable: false,
          });
        }
        return parsed.data as never;
      };

      const mutations: MutationService = {
        submit: (request) =>
          guard(async () => {
            const payload = await options.ports
              .invoke<unknown>(OPERATION_COMMANDS.submit, {
                sessionId: metadata.sessionId,
                request,
              })
              .catch((error: unknown) => {
                throw problemFrom(error);
              });
            // A submission answers either an acceptance or a replayed record; both
            // mean "do not send this again".
            const accepted = submissionSchema.safeParse(payload);
            if (!accepted.success) {
              throw new BackendError({
                code: "InternalError",
                message:
                  "the native host answered a submission with a shape this client cannot validate",
                retryable: false,
              });
            }
            return accepted.data;
          }),
        get: (operationId) =>
          guard(async () =>
            record(
              await options.ports.invoke(OPERATION_COMMANDS.get, {
                sessionId: metadata.sessionId,
                operationId,
              }),
            ),
          ),
        list: (limit) =>
          guard(async () => {
            const payload = await options.ports
              .invoke<unknown>(OPERATION_COMMANDS.list, {
                sessionId: metadata.sessionId,
                ...(limit === undefined ? {} : { limit }),
              })
              .catch((error: unknown) => {
                throw problemFrom(error);
              });
            const parsed = operationsListSchema.safeParse(payload);
            if (!parsed.success) {
              throw new BackendError({
                code: "InternalError",
                message:
                  "the native host answered an operation list with a shape this client cannot validate",
                retryable: false,
              });
            }
            return parsed.data;
          }),
        cancel: (operationId) =>
          guard(async () =>
            record(
              await options.ports.invoke(OPERATION_COMMANDS.cancel, {
                sessionId: metadata.sessionId,
                operationId,
              }),
            ),
          ),
      };

      const hostRequest = async <M extends keyof typeof HOST_RESPONSE_SCHEMAS>(
        request: HostRequest,
        method: M,
      ): Promise<unknown> =>
        guard(async () => {
          assertHostRequest(request);
          const payload = await options.ports
            .invoke<unknown>("refyard_host_request", {
              sessionId: metadata.sessionId,
              request,
            })
            .catch((error: unknown) => {
              throw problemFrom(error);
            });
          return validateHostResponse(method, payload);
        });

      const host: HostService = {
        capabilities: async () =>
          (await hostRequest(
            { method: "capabilities" },
            "capabilities",
          )) as never,
        sshHosts: async () =>
          (await hostRequest({ method: "sshHosts" }, "sshHosts")) as never,
        targets: async () =>
          (await hostRequest({ method: "targets" }, "targets")) as never,
        createTarget: async (request: CreateTargetRequest) =>
          (await hostRequest(
            { method: "createTarget", request },
            "createTarget",
          )) as never,
        disconnectTarget: async (targetId: string) => {
          // The command answers with no body, so success *is* the answer; a refusal
          // arrives as a problem and is rethrown by `guard`.
          await guard(async () => {
            await options.ports
              .invoke<unknown>("refyard_host_request", {
                sessionId: metadata.sessionId,
                request: {
                  method: "disconnectTarget",
                  targetId,
                } satisfies HostRequest,
              })
              .catch((error: unknown) => {
                throw problemFrom(error);
              });
          });
        },
        pickLocalDirectory: async () => {
          const payload = await guard(async () =>
            options.ports
              .invoke<unknown>("refyard_host_request", {
                sessionId: metadata.sessionId,
                request: { method: "pickLocalDirectory" } satisfies HostRequest,
              })
              .catch((error: unknown) => {
                throw problemFrom(error);
              }),
          );
          // A cancelled dialog answers with null, which is a result rather than a
          // failure; anything else that is not a path is a shape this client rejects.
          const parsed = z.string().nullable().safeParse(payload);
          if (!parsed.success) {
            throw new BackendError({
              code: "InternalError",
              message:
                "the native host answered the folder dialog with a shape this client cannot validate",
              retryable: false,
            });
          }
          return parsed.data;
        },
        acknowledgeUncertainOperation: async (
          request: AcknowledgeUncertainOperationRequest,
        ) =>
          (await hostRequest(
            { method: "acknowledgeUncertainOperation", request },
            "acknowledgeUncertainOperation",
          )) as never,
      };

      const rawEvents = createNativeEventService({
        ports: options.ports,
        sessionId: nativeMetadata.sessionId,
        serviceInstanceId: metadata.serviceInstanceId,
        nextSubscriptionId: generateSubscriptionId,
      });

      const events: EventService = {
        async subscribe(observer) {
          if (disposed) {
            throw new BackendError({
              code: "Cancelled",
              message:
                "the session was released before this subscription started",
              retryable: false,
            });
          }
          const subscription = await rawEvents.subscribe(observer);
          subscriptions.add(subscription);
          return {
            async dispose(): Promise<void> {
              subscriptions.delete(subscription);
              await subscription.dispose();
            },
          };
        },
      };

      return {
        metadata,
        git,
        mutations,
        host,
        events,
        state: () => state,
        onState: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        async dispose(): Promise<void> {
          if (disposed) return;
          disposed = true;
          for (const subscription of [...subscriptions]) {
            subscriptions.delete(subscription);
            await subscription.dispose();
          }
          await options.ports
            .invoke("refyard_disconnect", { sessionId: metadata.sessionId })
            .catch(() => undefined);
          listeners.clear();
          setState({ phase: "disconnected", problem: null });
        },
      };
    },
  };
}

/** One error mapper for the whole adapter, so a code cannot be lost on one path. */
function problemFrom(error: unknown): BackendError {
  return error instanceof BackendError ? error : problemFromInvocation(error);
}

const submissionSchema = z
  .union([
    z.strictObject({
      kind: z.literal("accepted"),
      accepted: z.strictObject({
        operationId: z.string().min(1),
        status: z.literal("accepted"),
        acceptedAt: z.string().min(1),
      }),
    }),
    z.strictObject({
      kind: z.literal("duplicate"),
      record: operationRecordSchemaForNative,
    }),
  ])
  .meta({ id: "NativeSubmission" });

const operationsListSchema = z.strictObject({
  operations: z.array(operationRecordSchemaForNative),
});
