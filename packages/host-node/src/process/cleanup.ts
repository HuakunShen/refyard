/**
 * Process-tree cleanup, and honesty about its limits.
 *
 * Git is not one process: it starts hooks, credential helpers, SSH, GPG and, for
 * long network operations, pack helpers. Stopping only the process this host
 * spawned leaves those children running against the same repository — which is
 * worse than a slow command, because a half-finished `git commit` can still take
 * the index lock.
 *
 * POSIX: the child is started in its own process group and the group is signalled,
 * so the tree is stopped together. Windows: `taskkill /PID <id> /T /F` with an
 * argument vector, invoked from a trusted system path.
 *
 * **What this is not:** a job object. The design is explicit that V1 adds no
 * native addon, and `taskkill` cannot promise to catch a process that has left the
 * job or detached itself. When the host cannot confirm the tree is gone, it says
 * `uncertain` — and the coordinator refuses new writers for that repository until
 * the situation is resolved, rather than assuming the coast is clear.
 */
import { spawnSync } from "node:child_process";
import { platform } from "node:os";

export type CleanupReport =
  | { readonly kind: "not-needed" }
  | {
      readonly kind: "signalled";
      readonly signal: NodeJS.Signals;
      readonly groupId: number;
    }
  | { readonly kind: "killed"; readonly groupId: number }
  | { readonly kind: "taskkill"; readonly exitCode: number | null }
  /** The tree could not be confirmed gone. Callers must stop writing to this repository. */
  | { readonly kind: "uncertain"; readonly reason: string };

export interface SignalOptions {
  /** Milliseconds to wait after SIGTERM before SIGKILL. */
  readonly graceMs: number;
}

/** Absolute path of the Windows taskkill binary, taken from the system directory. */
function taskkillPath(): string {
  const systemRoot = process.env["SYSTEMROOT"] ?? "C:\\Windows";
  return `${systemRoot}\\System32\\taskkill.exe`;
}

/**
 * Stop the process group that began with `pid`.
 *
 * `detached: true` at spawn time made the child a process-group leader, so a
 * negative pid signals the group. If the group no longer exists, the signal call
 * throws `ESRCH` — which means the tree is already gone, not that cleanup failed.
 */
export function signalProcessGroup(
  pid: number,
  options: SignalOptions,
): CleanupReport {
  if (platform() === "win32") {
    // No process groups to signal on Windows; the documented tree-kill switch is
    // used instead, with an argument vector and no shell.
    const result = spawnSync(
      taskkillPath(),
      ["/PID", String(pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
      },
    );
    if (result.error !== undefined) {
      return {
        kind: "uncertain",
        reason: `taskkill could not run: ${result.error.message}`,
      };
    }
    return { kind: "taskkill", exitCode: result.status };
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (isNoSuchProcess(error)) {
      return { kind: "not-needed" };
    }
    return { kind: "uncertain", reason: describeError(error) };
  }

  // SIGKILL after the grace period, on a timer the caller does not wait for: the
  // runner settles its result on its own deadline, and a well-behaved Git exits
  // from SIGTERM immediately.
  const killer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, options.graceMs);
  killer.unref?.();

  return { kind: "signalled", signal: "SIGTERM", groupId: pid };
}

/** True when the tree is known to be gone and the caller may write again. */
export function cleanupIsCertain(report: CleanupReport): boolean {
  return report.kind !== "uncertain";
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ESRCH"
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
