/**
 * Xross launch seam for an installed Refyard service.
 *
 * This module owns the product-specific sequence — an authorized remote exec
 * starts `refyard serve --json`, the exec stays open, readiness identifies the
 * remote loopback port, and Xross forwards that port. It does not embed Xross's
 * protobuf/Rust implementation, accept a caller-provided shell, install a
 * program, or bypass either peer policy.
 */

export interface XrossExecEvent {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface XrossExecHandle {
  /** The authorized stream remains live until the browser session closes. */
  readonly events: AsyncIterable<XrossExecEvent>;
  close(): Promise<void>;
}

export interface XrossExecRequest {
  readonly deviceId: string;
  /** Fixed argv assembled here; callers cannot replace it with a shell command. */
  readonly command: readonly string[];
  readonly keepAlive: true;
}

export interface XrossForwardRequest {
  readonly deviceId: string;
  readonly localPort: number;
  readonly targetHost: "127.0.0.1";
  readonly targetPort: number;
}

export interface XrossForward {
  readonly forwardId: string;
  readonly localPort: number;
}

export interface XrossLaunchTransport {
  exec(input: XrossExecRequest): Promise<XrossExecHandle>;
  openForward(input: XrossForwardRequest): Promise<XrossForward>;
  closeForward(forwardId: string): Promise<void>;
}

export interface LaunchProbe {
  readonly exec: "ready" | "refused" | "missing";
  readonly node: "available" | "missing" | "unknown";
  readonly git: "available" | "missing" | "unknown";
  readonly forward: "allowed" | "refused" | "unknown";
}

export type LaunchOutcome =
  | {
      readonly kind: "ready";
      readonly installAutomatically: false;
    }
  | {
      readonly kind: "dependencyMissing";
      readonly installAutomatically: false;
      readonly missing: readonly string[];
      readonly reason: string;
    }
  | {
      readonly kind: "permissionDenied";
      readonly installAutomatically: false;
      readonly reason: string;
    };

/**
 * Translate only facts the Xross adapter can actually observe.
 *
 * Xross has no app manifest or dependency broker today. `dependencyMissing`
 * therefore means the named program/runtime was absent or the peer refused the
 * exec offer; it never authorizes an install. A forward denial remains a peer
 * permission result, not a missing binary.
 */
export function selectLaunchOutcome(probe: LaunchProbe): LaunchOutcome {
  if (probe.exec !== "ready") {
    return {
      kind: "dependencyMissing",
      installAutomatically: false,
      missing: ["refyard (peer shell-allow or exec permission)"],
      reason:
        "the peer did not authorize or start the installed refyard executable; Xross has no app registry to resolve a version",
    };
  }
  const missing: string[] = [];
  if (probe.node !== "available") {
    missing.push("Node.js");
  }
  if (probe.git !== "available") {
    missing.push("Git");
  }
  if (missing.length > 0) {
    return {
      kind: "dependencyMissing",
      installAutomatically: false,
      missing,
      reason:
        "the peer did not provide every runtime dependency required by the installed refyard service",
    };
  }
  if (probe.forward !== "allowed") {
    return {
      kind: "permissionDenied",
      installAutomatically: false,
      reason:
        "the peer refused the TCP forward or its forward capability is not available",
    };
  }
  return { kind: "ready", installAutomatically: false };
}

export interface LaunchRemoteRefyardOptions {
  readonly transport: XrossLaunchTransport;
  readonly deviceId: string;
  /** Exact path selected by the user on the peer. */
  readonly repositoryPath: string;
  /** Static PWA origin. The ticket is bound to this exact origin by the CLI. */
  readonly uiOrigin: string;
  /** `0` delegates the local forward port to Xross. */
  readonly localPort?: number;
}

export interface LaunchedRefyard {
  readonly pairingUrl: string;
  readonly forwardId: string;
  readonly localPort: number;
  /** Close the daemon-owned forward and then the held exec stream. */
  close(): Promise<void>;
}

interface Readiness {
  readonly port: number;
}

/** Launch the already-installed service through an authorized Xross transport. */
export async function launchRemoteRefyard(
  options: LaunchRemoteRefyardOptions,
): Promise<LaunchedRefyard> {
  validateLaunchOptions(options);
  const command = [
    "refyard",
    "serve",
    "--json",
    "--no-open",
    "--repo",
    options.repositoryPath,
    "--ui-origin",
    options.uiOrigin,
  ];
  const execution = await options.transport.exec({
    deviceId: options.deviceId,
    command,
    keepAlive: true,
  });

  let forward: XrossForward | null = null;
  try {
    const observed = await observeReadiness(execution.events);
    forward = await options.transport.openForward({
      deviceId: options.deviceId,
      localPort: options.localPort ?? 0,
      targetHost: "127.0.0.1",
      targetPort: observed.readiness.port,
    });
    validateForward(forward);
    const pairingUrl = rewritePairingUrl(
      observed.pairingUrl,
      options.uiOrigin,
      forward.localPort,
    );
    let closed = false;
    return {
      pairingUrl,
      forwardId: forward.forwardId,
      localPort: forward.localPort,
      async close(): Promise<void> {
        if (closed) {
          return;
        }
        closed = true;
        let failure: unknown = null;
        try {
          await options.transport.closeForward(forward?.forwardId ?? "");
        } catch (error: unknown) {
          failure = error;
        }
        try {
          await execution.close();
        } catch (error: unknown) {
          failure ??= error;
        }
        if (failure !== null) {
          throw failure;
        }
      },
    };
  } catch (error: unknown) {
    if (forward !== null) {
      try {
        await options.transport.closeForward(forward.forwardId);
      } catch {
        // The original launch failure is the actionable fact; cleanup remains
        // best effort because there is no safe retry for a live forward.
      }
    }
    await execution.close();
    throw error;
  }
}

async function observeReadiness(
  events: AsyncIterable<XrossExecEvent>,
): Promise<{
  readonly readiness: Readiness;
  readonly pairingUrl: string;
}> {
  let stdout = "";
  let stderr = "";
  let readiness: Readiness | null = null;
  let pairingUrl: string | null = null;
  for await (const event of events) {
    if (event.stream === "stdout") {
      stdout += event.text;
      readiness ??= readinessFromLines(stdout);
    } else {
      stderr += event.text;
      pairingUrl ??= pairingUrlFromLines(stderr);
    }
    if (readiness !== null && pairingUrl !== null) {
      return { readiness, pairingUrl };
    }
  }
  throw new Error(
    readiness === null
      ? "the remote refyard service ended before reporting readiness"
      : "the remote refyard service ended before reporting a pairing URL",
  );
}

function readinessFromLines(output: string): Readiness | null {
  const lines = output.split("\n");
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value) || value["apiOnly"] !== true) {
      continue;
    }
    const port = value["port"];
    if (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65_535
    ) {
      return { port };
    }
  }
  return null;
}

function pairingUrlFromLines(output: string): string | null {
  for (const line of output.split("\n")) {
    const match = /^pairing URL \(single use\): (\S+)$/.exec(line.trim());
    if (match === null || match[1] === undefined) {
      continue;
    }
    try {
      const url = new URL(match[1]);
      if (url.origin.length > 0) {
        return url.toString();
      }
    } catch {
      // Keep reading: a partial stream chunk may have ended in the middle of a URL.
    }
  }
  return null;
}

function rewritePairingUrl(
  pairingUrl: string,
  uiOrigin: string,
  localPort: number,
): string {
  const url = new URL(pairingUrl);
  if (url.origin !== uiOrigin) {
    throw new Error(
      "the remote ticket was not minted for the requested static UI origin",
    );
  }
  url.searchParams.set("api", `http://127.0.0.1:${localPort}`);
  return url.toString();
}

function validateLaunchOptions(options: LaunchRemoteRefyardOptions): void {
  if (options.deviceId.length === 0 || options.repositoryPath.length === 0) {
    throw new Error(
      "a Xross device and an explicitly selected repository are required",
    );
  }
  const uiOrigin = new URL(options.uiOrigin);
  if (uiOrigin.protocol !== "https:" || uiOrigin.origin !== options.uiOrigin) {
    throw new Error("the Xross static UI origin must be an exact HTTPS origin");
  }
  if (
    options.localPort !== undefined &&
    (!Number.isInteger(options.localPort) ||
      options.localPort < 0 ||
      options.localPort > 65_535)
  ) {
    throw new Error("the local forward port must be 0 through 65535");
  }
}

function validateForward(forward: XrossForward): void {
  if (
    forward.forwardId.length === 0 ||
    !Number.isInteger(forward.localPort) ||
    forward.localPort <= 0 ||
    forward.localPort > 65_535
  ) {
    throw new Error("Xross returned an unusable local forward");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
