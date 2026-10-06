/**
 * The @kkterminal/pty port — the small alternative to node-pty.
 *
 * `@kkterminal/pty` (the owner's own napi-rs wrapper around portable-pty,
 * developed in the kkterminal workspace) ships a ~590 KB per-platform binding
 * where node-pty unpacks to 64 MB. This adapter wraps its `spawnPty` API into
 * the same `PtyPort` the node-pty adapter speaks, so the terminal service
 * cannot tell them apart and the loader can prefer the small one.
 *
 * Two translation notes. The binding's `write` takes a string, so bytes are
 * decoded exactly like the node-pty adapter decodes them. And its exit
 * callback always reports a numeric code — a host-initiated kill included —
 * so the adapter remembers its own kills and reports those as `null`, which
 * is what the contract promises ("never a fabricated zero").
 */
import { TextDecoder } from "node:util";
import type { PtyPort, PtyProcess, PtySpawnRequest } from "./port.js";

export interface KkterminalPtyModule {
  spawnPty(
    options: {
      shell: string;
      args?: Array<string>;
      cwd?: string;
      env?: Record<string, string>;
      cols: number;
      rows: number;
    },
    onData: (data: Buffer) => void,
    onExit: (exitCode: number) => void,
  ): KkterminalPtySession;
}

export interface KkterminalPtySession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export async function createKkterminalPtyPort(
  load: () => Promise<KkterminalPtyModule> = loadKkterminalPty,
): Promise<PtyPort | null> {
  let module: KkterminalPtyModule;
  try {
    module = await load();
  } catch {
    // Not installed is a normal state: the loader falls through to node-pty,
    // and a machine with neither simply has no terminal capability.
    return null;
  }
  return {
    kind: "kkterminal-pty",
    spawn(request: PtySpawnRequest): PtyProcess {
      // The binding takes its callbacks at spawn time, while the port hands
      // them over afterwards; everything that arrives in between queues here
      // and replays on attach. A shell's first bytes race exactly this way.
      const queued: Uint8Array[] = [];
      const queuedExits: Array<number | null> = [];
      let killed = false;
      let dataListener: ((chunk: Uint8Array) => void) | null = null;
      let exitListener: ((exitCode: number | null) => void) | null = null;

      const session = module.spawnPty(
        {
          shell: request.shell,
          args: [...request.argv],
          cwd: request.cwd,
          env: { ...request.env },
          cols: request.cols,
          rows: request.rows,
        },
        (data) => {
          const bytes = new Uint8Array(data);
          if (dataListener === null) {
            queued.push(bytes);
            return;
          }
          dataListener(bytes);
        },
        (code) => {
          const exitCode = killed ? null : code;
          if (exitListener === null) {
            queuedExits.push(exitCode);
            return;
          }
          exitListener(exitCode);
        },
      );

      return {
        write(chunk: Uint8Array): void {
          if (killed) {
            return;
          }
          // Keyboard bytes are UTF-8 by construction (the emulator encodes
          // its input); non-fatal decoding keeps a malformed paste from
          // throwing inside a write.
          session.write(new TextDecoder("utf-8").decode(chunk));
        },
        resize(cols: number, rows: number): void {
          if (!killed) {
            session.resize(cols, rows);
          }
        },
        kill(): void {
          if (killed) {
            return;
          }
          killed = true;
          session.kill();
        },
        onData(listener: (chunk: Uint8Array) => void): void {
          dataListener = listener;
          for (const bytes of queued.splice(0)) {
            listener(bytes);
          }
        },
        onExit(listener: (exitCode: number | null) => void): void {
          exitListener = listener;
          for (const exitCode of queuedExits.splice(0)) {
            listener(exitCode);
          }
        },
      };
    },
  };
}

async function loadKkterminalPty(): Promise<KkterminalPtyModule> {
  const module = (await import("@kkterminal/pty")) as unknown as KkterminalPtyModule & {
    default?: KkterminalPtyModule;
  };
  return module.default ?? module;
}
