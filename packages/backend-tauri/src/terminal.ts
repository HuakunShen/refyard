/**
 * The native terminal: pty bytes over Tauri commands and one event stream.
 *
 * The host owns the pty; this side only shuttles frames. Output arrives on the
 * `refyard://terminal` event as base64 contract frames demultiplexed by session
 * id, input leaves as base64 in a command — the same closed-table discipline as
 * every other command, and the same shape the HTTP adapter speaks, so the panel
 * above cannot tell which transport is underneath.
 */
import {
  terminalAcknowledgementSchema,
  terminalFrameSchema,
  terminalOpenResponseSchema,
} from "@refyard/git-contract";
import type {
  TerminalObserver,
  TerminalOpenRequest,
  TerminalService,
  TerminalSessionHandle,
} from "@refyard/git-service";
import { BackendError } from "@refyard/git-service";
import type { NativeCommand, NativePorts } from "./commands.js";

/** The event name the Rust host emits pty frames on. */
export const TERMINAL_EVENT_NAME = "refyard://terminal";

export function createTauriTerminalService(
  ports: NativePorts,
  sessionId: string,
): TerminalService {
  const observers = new Map<string, TerminalObserver>();
  let listening: Promise<void> | null = null;

  function ensureListener(): Promise<void> {
    listening ??= ports
      .listen(TERMINAL_EVENT_NAME, (event: { readonly payload: unknown }) => {
        const parsed = terminalFrameSchema.safeParse(event.payload);
        if (!parsed.success) {
          return;
        }
        const observer = observers.get(parsed.data.sessionId);
        if (observer === undefined) {
          return;
        }
        if (parsed.data.kind === "output") {
          observer.onData(fromBase64(parsed.data.data));
        } else {
          observer.onExit(parsed.data.exitCode);
        }
      })
      .then(() => undefined);
    return listening;
  }

  async function invokeTerminal(
    command: NativeCommand,
    request: unknown,
  ): Promise<void> {
    await ports.invoke(command, { sessionId, request });
  }

  return {
    async open(
      request: TerminalOpenRequest,
      observer: TerminalObserver,
    ): Promise<TerminalSessionHandle> {
      await ensureListener();
      const payload = await ports.invoke<unknown>("refyard_terminal_open", {
        sessionId,
        request,
      });
      const parsed = terminalOpenResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BackendError({
          code: "InternalError",
          message:
            "the native host answered a terminal open with a shape this client cannot validate",
          retryable: false,
        });
      }
      observers.set(parsed.data.sessionId, observer);
      let broken = false;
      const check = (payload: unknown): void => {
        if (broken) {
          return;
        }
        if (!terminalAcknowledgementSchema.safeParse(payload).success) {
          broken = true;
          observer.onError({
            code: "InternalError",
            message:
              "the native host answered a terminal command with a shape this client cannot validate",
            retryable: false,
          });
        }
      };
      const handle: TerminalSessionHandle = {
        info: parsed.data,
        write(data: Uint8Array): void {
          if (broken) {
            return;
          }
          void invokeTerminal("refyard_terminal_write", {
            sessionId: parsed.data.sessionId,
            data: toBase64(data),
          })
            .then(check)
            .catch(() => {
              // Input is fire-and-forget; a dead session is reported by its
              // exit frame, not by a write rejection nobody could act on.
            });
        },
        resize(cols: number, rows: number): void {
          if (broken) {
            return;
          }
          void invokeTerminal("refyard_terminal_resize", {
            sessionId: parsed.data.sessionId,
            cols,
            rows,
          })
            .then(check)
            .catch(() => {});
        },
        async close(): Promise<void> {
          observers.delete(parsed.data.sessionId);
          await invokeTerminal("refyard_terminal_close", {
            sessionId: parsed.data.sessionId,
          }).catch(() => undefined);
        },
      };
      return handle;
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
