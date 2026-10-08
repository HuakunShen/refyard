/**
 * The session half of one terminal tab: everything between the transport's
 * TerminalService and the emulator, with no DOM of its own. The lifecycle is
 * the point — a tab whose view unmounts without destroying its session leaks
 * the whole chain (emulator buffer, transport observer entry, and the host's
 * pty, which keeps producing output into the detached buffer), so the
 * component's unmount path must be a destroy() call, and this module makes
 * that destroy safe from every race: before open resolves, after the shell
 * exited, or twice in a row.
 */
import type { TerminalOpenResponse } from "@refyard/git-contract";
import type {
  TerminalService,
  TerminalSessionHandle,
} from "@refyard/git-service";

/**
 * Scrollback retained per shell. xterm defaults to 1000; a workbench shell is
 * a build-log reader so a little more helps, but every retained line is cells
 * held for as long as the tab lives — hidden tabs keep their buffers by
 * design, and each additional shell pays the whole cost again.
 */
export const TERMINAL_SCROLLBACK_LINES = 5000;

/** The emulator surface this module drives — xterm's Terminal, structurally. */
export interface EmulatorLike {
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array | string): void;
  onData(callback: (data: string) => void): { dispose(): void };
  dispose(): void;
}

export interface TerminalTabCallbacks {
  onReady(info: TerminalOpenResponse): void;
  onExit(exitCode: number | null): void;
}

export interface TerminalTabSession {
  /** Report a new grid to the host; a grid that did not change is not re-sent. */
  resize(cols: number, rows: number): void;
  /**
   * End the session: close the host shell (which also removes the transport's
   * observer entry), dispose the emulator, drop queued input. Idempotent, and
   * safe while the open request is still in flight.
   */
  destroy(): Promise<void>;
}

/** Keystrokes wait this long so a burst becomes one write, not one per key. */
const INPUT_BURST_MS = 10;

export function startTerminalTab(
  terminal: TerminalService,
  repositoryId: string,
  emulator: EmulatorLike,
  callbacks: TerminalTabCallbacks,
): TerminalTabSession {
  const encoder = new TextEncoder();
  /** Drives write/resize; null until open resolves and cleared on exit. */
  let session: TerminalSessionHandle | null = null;
  /**
   * Close for the opened handle, kept past exit: the transport's observer
   * entry (and any host-side session record) only goes away through close(),
   * so even a shell that died on its own must be closed once at destroy.
   */
  let closer: (() => Promise<void>) | null = null;
  let disposed = false;
  let sentCols = 0;
  let sentRows = 0;
  let inputQueue: Uint8Array[] = [];
  let inputTimer: ReturnType<typeof setTimeout> | null = null;

  const detachInput = emulator.onData((data) => {
    if (disposed) {
      return;
    }
    inputQueue.push(encoder.encode(data));
    inputTimer ??= setTimeout(flushInput, INPUT_BURST_MS);
  });

  function flushInput(): void {
    inputTimer = null;
    if (session === null || inputQueue.length === 0) {
      return;
    }
    const total = inputQueue.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of inputQueue.splice(0)) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    session.write(merged);
  }

  function sendResize(cols: number, rows: number): void {
    if (session === null || (cols === sentCols && rows === sentRows)) {
      return;
    }
    sentCols = cols;
    sentRows = rows;
    session.resize(cols, rows);
  }

  async function destroy(): Promise<void> {
    // Idempotent as a whole, not just in its host effects: the close-tab path
    // and the unmount teardown can both run, and the second must not touch the
    // emulator (or anything else) again.
    if (disposed) {
      return;
    }
    disposed = true;
    detachInput.dispose();
    if (inputTimer !== null) {
      clearTimeout(inputTimer);
      inputTimer = null;
    }
    inputQueue = [];
    session = null;
    const closing = closer?.();
    closer = null;
    emulator.dispose();
    await closing;
  }

  void (async () => {
    const opened = await terminal.open(
      { repositoryId, cols: emulator.cols, rows: emulator.rows },
      {
        onData: (chunk) => {
          if (disposed) {
            return;
          }
          emulator.write(chunk);
        },
        onExit: (exitCode) => {
          session = null;
          callbacks.onExit(exitCode);
        },
        onError: () => {
          // The transport died; the exit path renders the tab as dead and the
          // panel's error surface explains what happened.
          session = null;
          callbacks.onExit(null);
        },
      },
    );
    if (disposed) {
      // Destroy won the race with open; the session the host started must not
      // outlive the tab that asked for it.
      await opened.close();
      return;
    }
    session = opened;
    closer = () => opened.close();
    // The host opened a grid it was asked for; the panel may have resized
    // while the session was starting, so the truth goes back once now.
    sendResize(emulator.cols, emulator.rows);
    callbacks.onReady(opened.info);
  })();

  return {
    resize: sendResize,
    destroy,
  };
}
