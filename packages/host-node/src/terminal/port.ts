/**
 * The pty boundary host-node talks to.
 *
 * A pty is a machine capability, not a Git one, so it crosses into the service as a
 * port the way the Git host does: the terminal service plans (which shell, which
 * directory, which environment) and the port executes. The seam exists so the
 * service is testable without a real pty and so a future native pty provider can
 * replace node-pty without touching a line of session logic.
 *
 * Bytes in, bytes out: the port never decodes terminal output, because a pty
 * stream is not guaranteed to be valid UTF-8 at chunk boundaries.
 */
export interface PtySpawnRequest {
  /** Absolute directory the shell starts in. The service has already approved it. */
  readonly cwd: string;
  readonly shell: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cols: number;
  readonly rows: number;
}

export interface PtyProcess {
  /** Bytes typed by the emulator. The port encodes them the way the shell expects. */
  write(chunk: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** End the session: kill the shell and release the pty. Idempotent. */
  kill(): void;
  /** Exactly one listener: the terminal service is the demultiplexer. */
  onData(listener: (chunk: Uint8Array) => void): void;
  /**
   * Exactly one listener. The code is null when the port ended the session itself
   * or cannot observe one — never a fabricated zero.
   */
  onExit(listener: (exitCode: number | null) => void): void;
}

export interface PtyPort {
  readonly kind: string;
  spawn(request: PtySpawnRequest): PtyProcess;
}
