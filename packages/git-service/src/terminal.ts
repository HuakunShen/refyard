/**
 * The transport-neutral terminal interface.
 *
 * Like every surface on `BackendSession`, a component is written against this and
 * never against SSE or `invoke`. One method, one direction each: `open` starts a
 * session and subscribes its observer in the same call, the handle drives the
 * session afterwards. A transport that cannot carry a terminal leaves the
 * session's `terminal` unset — absence is the honest answer, and the UI keeps the
 * panel hidden.
 */
import type { Problem, TerminalOpenResponse } from "@refyard/git-contract";

export interface TerminalOpenRequest {
  readonly repositoryId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalObserver {
  /** Bytes the shell wrote. Chunks may split anywhere, including mid-escape. */
  onData(chunk: Uint8Array): void;
  /**
   * The shell exited. The code is null when the host ended the session or could
   * not observe one. No event follows this one.
   */
  onExit(exitCode: number | null): void;
  /** The transport failed and the session is no longer usable. */
  onError(problem: Problem): void;
}

export interface TerminalSessionHandle {
  readonly info: TerminalOpenResponse;
  /** Bytes typed by the emulator. Fire-and-forget; delivery failures hit `onError`. */
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Kill the shell. Idempotent; `onExit` still fires exactly once. */
  close(): Promise<void>;
}

export interface TerminalService {
  open(
    request: TerminalOpenRequest,
    observer: TerminalObserver,
  ): Promise<TerminalSessionHandle>;
}
