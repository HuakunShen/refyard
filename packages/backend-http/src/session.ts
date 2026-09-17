/**
 * The HTTP backend session.
 *
 * Everything HTTP-specific lives on this side of the boundary: the bearer, the
 * fetch wrapper that ties requests to this session's lifetime, the SSE stream, and
 * the tolerant read of an older service's capability answer. What the caller gets
 * is a `BackendSession` whose methods return contract DTOs and throw one
 * `BackendError`, exactly like the native session will.
 */
import { z } from "zod";
import {
  executionTargetSummarySchema,
  operationRecordSchema,
  sshHostListSchema,
  validateCreateTargetRequest,
  type ExecutionTargetSummary,
  type OperationRecord,
  type SshHostList,
} from "@refyard/git-contract";
import {
  createGitClient,
  createMutationClient,
  GitClientError,
} from "@refyard/git-client";
import {
  BackendError,
  normalizeProblem,
  type BackendSession,
  type ConnectionState,
  type EventService,
  type EventSubscription,
  type GitReadService,
  type HostService,
  type MutationService,
  type SessionMetadata,
} from "@refyard/git-service";
import { createHttpEventService } from "./events.js";
import {
  probeHostExtension,
  requestJson,
  unsupportedHostOperation,
  type HostProbePorts,
} from "./legacy-capabilities.js";

const targetListSchema = z.array(executionTargetSummarySchema);

export interface HttpSessionPorts {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token: () => string | null;
  /** Known only when this session came from a ticket exchange. */
  readonly sessionId: string | null;
  readonly serviceInstanceId: string;
  readonly backendLabel?: string;
}

export function toBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  if (error instanceof GitClientError) {
    return new BackendError(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        retryable: error.retryable,
      },
      { status: error.status, correlationId: error.correlationId },
    );
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    // The session was disposed while this read was in flight. That is a
    // cancellation, not a Git or network failure, and it must not surface as one.
    return new BackendError({
      code: "Cancelled",
      message: "the request was cancelled because the session was released",
      retryable: false,
    });
  }
  return new BackendError(
    normalizeProblem(undefined, {
      message: error instanceof Error ? error.message : "the request failed",
    }),
  );
}

function problemForValidation(
  problems: readonly { message: string }[],
): BackendError {
  return new BackendError({
    code: "InvalidRequest",
    message:
      problems.length === 0
        ? "the request is not a valid target request"
        : problems.map((entry) => entry.message).join("; "),
    retryable: false,
  });
}

export function createHttpBackendSession(
  ports: HttpSessionPorts,
): BackendSession {
  const lifetime = new AbortController();
  let disposed = false;
  let state: ConnectionState = { phase: "ready", problem: null };
  const stateListeners = new Set<(state: ConnectionState) => void>();
  const subscriptions = new Set<EventSubscription>();

  function setState(next: ConnectionState): void {
    state = next;
    for (const listener of stateListeners) listener(state);
  }

  /**
   * Every request this session makes is tied to its lifetime, so `dispose()` really
   * stops in-flight reads instead of letting a late answer reach the next screen.
   */
  const sessionFetch: typeof fetch = (input, init) => {
    const signal =
      init?.signal == null
        ? lifetime.signal
        : AbortSignal.any([init.signal, lifetime.signal]);
    return ports.fetch(input, { ...init, signal });
  };

  const client = createGitClient({
    baseUrl: ports.baseUrl,
    fetch: sessionFetch,
    token: ports.token,
  });

  async function guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const failure = toBackendError(error);
      // Losing authentication is session state, not just one failed read: the UI
      // shows the pairing panel again instead of retrying every panel forever.
      if (failure.code === "Unauthenticated") {
        setState({ phase: "failed", problem: failure.problem });
      }
      throw failure;
    }
  }

  const git: GitReadService = {
    health: () => guard(() => client.health()),
    capabilities: (query) => guard(() => client.capabilities(query)),
    repositories: () => guard(() => client.repositories()),
    filesystemEntries: (query) => guard(() => client.filesystemEntries(query)),
    registerRepository: (path, options) =>
      guard(() =>
        options === undefined
          ? client.registerRepository(path)
          : client.registerRepository(path, options),
      ),
    revokeRepository: (repositoryId) =>
      guard(() => client.revokeRepository(repositoryId)),
    status: (query) => guard(() => client.status(query)),
    history: (query) => guard(() => client.history(query)),
    refs: (query) => guard(() => client.refs(query)),
    diff: (query) => guard(() => client.diff(query)),
    worktrees: (query) => guard(() => client.worktrees(query)),
    submodules: (query) => guard(() => client.submodules(query)),
    stashes: (query) => guard(() => client.stashes(query)),
    previews: (query) => guard(() => client.previews(query)),
  };

  const mutationClient = createMutationClient({
    baseUrl: ports.baseUrl,
    fetch: sessionFetch,
    token: ports.token,
  });

  const mutations: MutationService = {
    submit: (request) => guard(() => mutationClient.submit(request)),
    get: (operationId) => guard(() => mutationClient.get(operationId)),
    list: (limit) => guard(() => mutationClient.list(limit)),
    cancel: (operationId) => guard(() => mutationClient.cancel(operationId)),
  };

  const probePorts: HostProbePorts = {
    baseUrl: ports.baseUrl,
    fetch: sessionFetch,
    token: ports.token,
    signal: lifetime.signal,
  };
  let extension: Promise<
    Awaited<ReturnType<typeof probeHostExtension>>
  > | null = null;
  const extent = () => (extension ??= probeHostExtension(probePorts));

  async function requireExtension(what: string): Promise<void> {
    const answer = await extent();
    if (!answer.extended) {
      throw unsupportedHostOperation(
        `this service predates execution targets, so it cannot ${what}`,
      );
    }
  }

  const rawEvents = createHttpEventService({
    baseUrl: ports.baseUrl,
    fetch: sessionFetch,
    token: ports.token,
  });

  const events: EventService = {
    async subscribe(observer) {
      if (disposed) {
        throw new BackendError({
          code: "Cancelled",
          message: "the session was released before this subscription started",
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

  const host: HostService = {
    capabilities: async () => (await extent()).capabilities,
    sshHosts: async (): Promise<SshHostList> => {
      await requireExtension("list ssh hosts");
      const payload = await requestJson(probePorts, "/api/v1/host/ssh-hosts");
      const parsed = sshHostListSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BackendError({
          code: "InternalError",
          message:
            "the service answered with an ssh host list this client cannot validate",
          retryable: false,
        });
      }
      return parsed.data;
    },
    targets: async (): Promise<readonly ExecutionTargetSummary[]> => {
      await requireExtension("list execution targets");
      const payload = await requestJson(probePorts, "/api/v1/host/targets");
      const parsed = targetListSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BackendError({
          code: "InternalError",
          message:
            "the service answered with a target list this client cannot validate",
          retryable: false,
        });
      }
      return parsed.data;
    },
    createTarget: async (request): Promise<ExecutionTargetSummary> => {
      const validated = validateCreateTargetRequest(request);
      if (!validated.ok) throw problemForValidation(validated.problems);
      await requireExtension("create an execution target");
      const payload = await requestJson(probePorts, "/api/v1/host/targets", {
        method: "POST",
        body: validated.value,
      });
      const parsed = executionTargetSummarySchema.safeParse(payload);
      if (!parsed.success) {
        throw new BackendError({
          code: "InternalError",
          message:
            "the service answered with a target this client cannot validate",
          retryable: false,
        });
      }
      return parsed.data;
    },
    disconnectTarget: async (targetId: string): Promise<void> => {
      await requireExtension("disconnect an execution target");
      await requestJson(probePorts, "/api/v1/host/targets/disconnect", {
        method: "POST",
        body: { targetId },
      });
    },
    pickLocalDirectory: async (): Promise<string | null> => {
      // A browser cannot open a dialog on the machine running the service, and
      // pretending otherwise would either fail or pick a directory on the wrong host.
      throw unsupportedHostOperation(
        "a browser cannot open a native folder dialog; use the service's path picker instead",
      );
    },
    acknowledgeUncertainOperation: async (
      request,
    ): Promise<OperationRecord> => {
      await requireExtension("acknowledge an uncertain operation");
      const payload = await requestJson(
        probePorts,
        "/api/v1/operations/acknowledge",
        {
          method: "POST",
          body: request,
        },
      );
      const parsed = operationRecordSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BackendError({
          code: "InternalError",
          message:
            "the service answered with an operation record this client cannot validate",
          retryable: false,
        });
      }
      return parsed.data;
    },
  };

  const metadata: SessionMetadata = {
    sessionId: ports.sessionId,
    serviceInstanceId: ports.serviceInstanceId,
    // The cache namespace identifies the authorization round so cached reads from a
    // previous session cannot be read as this one's. It is not a secret.
    cacheNamespace: `http/${ports.serviceInstanceId}/${ports.sessionId ?? "unexchanged"}`,
    backendLabel: ports.backendLabel ?? "HTTP service",
  };

  return {
    metadata,
    git,
    mutations,
    host,
    events,
    state: () => state,
    onState: (listener) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      for (const subscription of [...subscriptions]) {
        subscriptions.delete(subscription);
        await subscription.dispose();
      }
      lifetime.abort();
      stateListeners.clear();
      setState({ phase: "disconnected", problem: null });
    },
  };
}
