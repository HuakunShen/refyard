/**
 * Host extension discovery for the HTTP backend.
 *
 * The Git routes are unchanged since 1.1.0, so a service can be older than this
 * client in exactly one way that matters: it has no host/execution-target routes at
 * all. That is a *capability* answer, not an error — but only a 404 on the
 * extension's own path may be read that way. A 401, 403 or 500 is passed through
 * with its real problem code, because swallowing those would report "no SSH
 * support" for a service that is simply refusing this caller.
 */
import {
  hostCapabilitiesSchema,
  type HostCapabilities,
  type Problem,
  type ProblemCode,
} from "@refyard/git-contract";
import { BackendError, normalizeProblem } from "@refyard/git-service";

/**
 * What a service with no host routes can honestly claim: it has one implicit local
 * target, no OS directory dialog (it is not on the user's machine), and no way to
 * acknowledge an uncertain operation. It never claims SSH.
 */
export const LEGACY_HOST_CAPABILITIES: HostCapabilities = {
  sshConfig: false,
  localFolderPicker: false,
  uncertainOperationAcknowledgement: false,
  targetKinds: ["local"],
};

export interface HostProbePorts {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token: () => string | null;
  readonly signal?: AbortSignal;
}

/** Fetch a JSON body and turn any failure into a `BackendError`. */
export async function requestJson(
  ports: HostProbePorts,
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<unknown> {
  const token = ports.token();
  const headers: Record<string, string> = { accept: "application/json" };
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await ports.fetch(`${ports.baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    credentials: "omit",
    cache: "no-store",
    ...(ports.signal === undefined ? {} : { signal: ports.signal }),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  const correlationId = response.headers.get("x-refyard-correlation");
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    throw new BackendError(
      normalizeProblem(payload, {
        message: `the service returned ${response.status} without a problem body`,
        correlationId,
      }),
      { status: response.status, correlationId },
    );
  }
  return response.json();
}

export interface HostExtensionProbe {
  readonly extended: boolean;
  readonly capabilities: HostCapabilities;
}

/**
 * Asks the service what it can do about targets. A 404 on
 * `/api/v1/host/capabilities` is the version signal; anything else non-OK is a
 * failure with its own problem code.
 */
export async function probeHostExtension(
  ports: HostProbePorts,
): Promise<HostExtensionProbe> {
  try {
    const payload = await requestJson(ports, "/api/v1/host/capabilities");
    const parsed = hostCapabilitiesSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BackendError({
        code: "InternalError",
        message:
          "the service answered the host capability probe with a shape this client cannot validate",
        retryable: false,
      });
    }
    return { extended: true, capabilities: parsed.data };
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) {
      return { extended: false, capabilities: LEGACY_HOST_CAPABILITIES };
    }
    throw error;
  }
}

/**
 * Refuses a host request the service cannot honour. Reporting `sshConfig: false`
 * and then answering an SSH request with an empty list would be the same class of
 * lie as reporting an unimplemented operation as available.
 */
export function unsupportedHostOperation(message: string): BackendError {
  const problem: Problem = {
    code: "UnsupportedOperation" satisfies ProblemCode,
    message,
    retryable: false,
  };
  return new BackendError(problem);
}
