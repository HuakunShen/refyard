/**
 * The terminal service: sessions, ownership and the output stream.
 *
 * This is the host-side half of the terminal surface, and it exists to keep three
 * properties that a shell running on someone's machine must not lose:
 *
 * - **the caller never names a path or a program.** A request names an approved
 *   repository id; the working directory and the shell are resolved here, on the
 *   host, from the registry.
 * - **one browser session owns one terminal.** Every method re-checks that the
 *   bearer asking is the bearer that opened the session, so a second tab (or a
 *   second, weaker grant) cannot drive a shell it did not start.
 * - **absence is honest.** A host whose pty port is null reports no terminal
 *   capability; `open` on such a host is refused, never faked.
 *
 * Output bytes are handed to the single attached stream as base64 contract
 * frames; while no stream is attached, a bounded buffer keeps the shell's first
 * bytes (the prompt, a banner) so opening the panel never shows a torn start.
 */
import { LIMITS } from "@refyard/git-contract";
import {
  terminalExitFrameSchema,
  terminalFrameSchema,
  terminalOutputFrameSchema,
  type TerminalCapability,
  type TerminalFrame,
} from "@refyard/git-contract";
import { ReadProblem } from "../coordinator/reads.js";
import type { PtyPort, PtyProcess } from "./port.js";
import type { TerminalCommand } from "./shell.js";

/**
 * The one thing the terminal service needs from the repository registry, stated
 * structurally: the approved working directory of an approved repository. The
 * full registry satisfies it; a test passes a stub and spawns no Git at all.
 */
export interface TerminalRepositoryLookup {
  get(repositoryId: string): {
    readonly displayPath: { readonly text: string };
  } | null;
}

export interface TerminalSessionOpened {
  readonly sessionId: string;
  readonly shell: string;
  readonly cwd: string;
}

export interface TerminalService {
  /** What `capabilities.terminal` reports; null means this host has no pty port. */
  capability(): TerminalCapability | null;
  open(input: {
    readonly repositoryId: string;
    readonly cols: number;
    readonly rows: number;
    readonly ownerSessionId: string;
  }): TerminalSessionOpened;
  write(input: {
    readonly sessionId: string;
    readonly bytes: Uint8Array;
    readonly ownerSessionId: string;
  }): void;
  resize(input: {
    readonly sessionId: string;
    readonly cols: number;
    readonly rows: number;
    readonly ownerSessionId: string;
  }): void;
  close(input: {
    readonly sessionId: string;
    readonly ownerSessionId: string;
  }): void;
  /**
   * Attach the one output stream. Returns the detach function; attaching again
   * replaces the previous stream, which is how a reconnecting SSE client takes
   * over without a zombie frame writer.
   */
  subscribe(
    sessionId: string,
    ownerSessionId: string,
    send: (frame: TerminalFrame) => void,
  ): () => void;
  /** Shut down every live session; the host calls this when the process stops. */
  closeAll(): void;
}

export interface TerminalServiceOptions {
  /** Null is a host without a pty module; every method then refuses honestly. */
  readonly port: PtyPort | null;
  readonly repositories: TerminalRepositoryLookup;
  readonly command: TerminalCommand;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly nextSessionId: () => string;
  readonly now?: () => number;
}

interface TerminalSession {
  readonly sessionId: string;
  readonly repositoryId: string;
  readonly ownerSessionId: string;
  /** Cleared once the shell exited; the record remains for its exit frame. */
  process: PtyProcess | null;
  readonly shell: string;
  readonly cwd: string;
  readonly openedAt: number;
  /** Bounded tail buffer kept while no stream is attached (oldest bytes go first). */
  readonly pending: Uint8Array[];
  pendingBytes: number;
  subscriber: ((frame: TerminalFrame) => void) | null;
  exited: boolean;
  /** Set before the service kills a session, so its exit reports as null. */
  killedByHost: boolean;
}

/**
 * Raw bytes per output frame: base64 inflates by 4/3, and the contract caps one
 * payload at 65,536 characters, so the largest safe raw piece stays well under.
 */
const MAX_FRAME_BYTES = 32 * 1024;

export function createTerminalService(
  options: TerminalServiceOptions,
): TerminalService {
  const sessions = new Map<string, TerminalSession>();
  const port = options.port;

  function requirePort(): PtyPort {
    if (port === null) {
      throw new ReadProblem({
        code: "UnsupportedOperation",
        message:
          "this host has no pty module, so it cannot open a terminal session",
      });
    }
    return port;
  }

  function requireLiveSession(input: {
    readonly sessionId: string;
    readonly ownerSessionId: string;
  }): TerminalSession {
    const session = sessions.get(input.sessionId);
    if (session === undefined) {
      throw new ReadProblem({
        code: "NotFound",
        message: "no such terminal session on this host",
      });
    }
    if (session.ownerSessionId !== input.ownerSessionId) {
      throw new ReadProblem({
        code: "Forbidden",
        message: "this terminal belongs to another browser session",
      });
    }
    return session;
  }

  function requireLiveProcess(
    session: TerminalSession,
  ): PtyProcess {
    const process = session.process;
    if (process === null) {
      throw new ReadProblem({
        code: "NotFound",
        message: "that terminal session has already exited",
      });
    }
    return process;
  }

  function finish(session: TerminalSession, exitCode: number | null): void {
    if (session.exited) {
      return;
    }
    session.exited = true;
    // The entry stays until an explicit close (or the next open's sweep): a shell
    // that exits before its viewer attached must still deliver its exit frame.
    session.process = null;
    session.subscriber?.(
      terminalExitFrameSchema.parse({
        kind: "exit",
        sessionId: session.sessionId,
        exitCode,
      }),
    );
  }

  function deliver(session: TerminalSession, bytes: Uint8Array): void {
    // One pty read is not one frame: a frame's base64 must stay inside the
    // contract's payload bound, so output is cut into frame-sized pieces here —
    // the emulator reassembles the stream, and the split is invisible there.
    for (let start = 0; start < bytes.byteLength; start += MAX_FRAME_BYTES) {
      const piece = bytes.subarray(start, start + MAX_FRAME_BYTES);
      if (session.subscriber !== null) {
        session.subscriber(outputFrame(session.sessionId, piece));
        continue;
      }
      session.pending.push(piece);
      session.pendingBytes += piece.byteLength;
    }
    while (
      session.pendingBytes > LIMITS.terminalPreSubscribeBufferBytes &&
      session.pending.length > 1
    ) {
      const dropped = session.pending.shift();
      session.pendingBytes -= dropped?.byteLength ?? 0;
    }
  }

  return {
    capability(): TerminalCapability | null {
      return port === null ? null : { shell: options.command.name };
    },

    open(input): TerminalSessionOpened {
      const pty = requirePort();
      // A shell that exited while nobody was attached still holds its slot until
      // now: sweep the finished records before counting, exactly once each.
      for (const [sessionId, session] of [...sessions]) {
        if (session.exited && session.subscriber === null) {
          sessions.delete(sessionId);
        }
      }
      if (sessions.size >= LIMITS.terminalSessionsPerService) {
        throw new ReadProblem({
          code: "ResourceBusy",
          message: `this host serves at most ${LIMITS.terminalSessionsPerService} terminal sessions at once`,
          retryable: true,
        });
      }
      const record = options.repositories.get(input.repositoryId);
      if (record === null) {
        throw new ReadProblem({
          code: "NotFound",
          message: "no approved repository with that id on this host",
        });
      }
      const cwd = record.displayPath.text;
      const process = pty.spawn({
        cwd,
        shell: options.command.shell,
        argv: options.command.argv,
        env: terminalEnvironment(options.environment),
        cols: input.cols,
        rows: input.rows,
      });
      const sessionId = options.nextSessionId();
      const session: TerminalSession = {
        sessionId,
        repositoryId: input.repositoryId,
        ownerSessionId: input.ownerSessionId,
        process,
        shell: options.command.name,
        cwd,
        openedAt: options.now?.() ?? Date.now(),
        pending: [],
        pendingBytes: 0,
        subscriber: null,
        exited: false,
        killedByHost: false,
      };
      sessions.set(sessionId, session);
      process.onData((bytes) => {
        deliver(session, bytes);
      });
      process.onExit((exitCode) => {
        // A host kill reaches here through the process's own exit event, whose
        // code differs per platform and per killer; the flag, not the code,
        // decides that the exit is reported as null.
        finish(session, session.killedByHost ? null : exitCode);
      });
      return { sessionId, shell: session.shell, cwd };
    },

    write(input): void {
      requireLiveProcess(requireLiveSession(input)).write(input.bytes);
    },

    resize(input): void {
      requireLiveProcess(requireLiveSession(input)).resize(
        input.cols,
        input.rows,
      );
    },

    close(input): void {
      const session = requireLiveSession(input);
      session.killedByHost = true;
      session.process?.kill();
      // An explicit close is the one removal that is not a sweep: the record
      // (and its buffered output) is nobody's business after this.
      sessions.delete(session.sessionId);
    },

    subscribe(sessionId, ownerSessionId, send): () => void {
      const session = requireLiveSession({ sessionId, ownerSessionId });
      session.subscriber = send;
      for (const chunk of session.pending) {
        send(outputFrame(sessionId, chunk));
      }
      session.pending.length = 0;
      session.pendingBytes = 0;
      if (session.exited) {
        send(
          terminalExitFrameSchema.parse({
            kind: "exit",
            sessionId,
            exitCode: null,
          }),
        );
      }
      return () => {
        if (session.subscriber === send) {
          session.subscriber = null;
        }
      };
    },

    closeAll(): void {
      for (const session of [...sessions.values()]) {
        session.killedByHost = true;
        session.process?.kill();
        finish(session, null);
        sessions.delete(session.sessionId);
      }
    },
  };
}

function outputFrame(sessionId: string, bytes: Uint8Array): TerminalFrame {
  return terminalOutputFrameSchema.parse({
    kind: "output",
    sessionId,
    data: toBase64(bytes),
  });
}

/** The shell's environment: this machine's own, pinned to a terminal-typing profile. */
function terminalEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string") {
      entries[name] = value;
    }
  }
  entries.TERM = "xterm-256color";
  entries.COLORTERM = "truecolor";
  if (entries.LANG === undefined || entries.LANG === "") {
    entries.LANG = "en_US.UTF-8";
  }
  return entries;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

/** Frame validation at the stream boundary: a malformed frame never reaches SSE. */
export function parseTerminalFrame(value: unknown): TerminalFrame {
  return terminalFrameSchema.parse(value);
}
