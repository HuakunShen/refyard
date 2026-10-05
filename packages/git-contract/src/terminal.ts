/**
 * The interactive terminal surface.
 *
 * A terminal session is a PTY the host owns and the UI renders. The browser never
 * names a path, a shell or an argument: it names an approved repository and a grid
 * size, and the host resolves everything else on its side of the boundary. Payloads
 * travel as base64 because SSE and JSON frames are text, and terminal bytes are not
 * guaranteed to be UTF-8 — the encoding is the contract's job so both transports
 * speak the same frame.
 */
import { z } from "zod";
import { displayPathSchema, prefixedId, repositoryIdSchema } from "./ids.js";
import { LIMITS } from "./limits.js";

export const terminalSessionIdSchema = prefixedId("term", {
  id: "TerminalSessionId",
  description: "One live terminal session on one host.",
});
export type TerminalSessionId = z.infer<typeof terminalSessionIdSchema>;

/** Grid bounds wide enough for any real terminal, tight enough to refuse nonsense. */
export const terminalColsSchema = z.int().min(2).max(500);
export const terminalRowsSchema = z.int().min(2).max(200);

/** Advertised inside `capabilities` by a host that can open terminal sessions. */
export const terminalCapabilitySchema = z
  .strictObject({
    shell: z.string().min(1).max(128),
  })
  .meta({
    id: "TerminalCapability",
    description:
      "This host opens terminal sessions. `shell` names the program new sessions run; the caller cannot choose it.",
  });
export type TerminalCapability = z.infer<typeof terminalCapabilitySchema>;

/** One decoded input chunk from the emulator. A keystroke is a few bytes. */
export const terminalPayloadSchema = z
  .string()
  .max(LIMITS.terminalPayloadMaxBytes)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "not a base64 payload");

export const terminalOpenRequestSchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .meta({
    id: "TerminalOpenRequest",
    description:
      "Open a terminal session in an approved repository. The host picks the shell and the working directory; the caller never names either.",
  });

export const terminalOpenResponseSchema = z
  .strictObject({
    sessionId: terminalSessionIdSchema,
    shell: z.string().min(1).max(128),
    cwd: displayPathSchema,
  })
  .meta({
    id: "TerminalOpenResponse",
    description:
      "A live terminal session. The shell and directory are reported, not chosen, so the UI can show what actually runs.",
  });

export const terminalInputRequestSchema = z
  .strictObject({
    sessionId: terminalSessionIdSchema,
    data: terminalPayloadSchema,
  })
  .meta({
    id: "TerminalInputRequest",
    description: "Bytes typed (or pasted) into one terminal session, base64.",
  });

export const terminalResizeRequestSchema = z
  .strictObject({
    sessionId: terminalSessionIdSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .meta({
    id: "TerminalResizeRequest",
    description: "Resize one terminal session's pty to the rendered grid.",
  });

export const terminalCloseRequestSchema = z
  .strictObject({
    sessionId: terminalSessionIdSchema,
  })
  .meta({
    id: "TerminalCloseRequest",
    description:
      "Close one terminal session. The shell is killed; a session that already exited closes cleanly.",
  });

/** The answer to input, resize and close: applied, with nothing else to report. */
export const terminalAcknowledgementSchema = z
  .strictObject({ accepted: z.literal(true) })
  .meta({
    id: "TerminalAcknowledgement",
    description:
      "The terminal action was applied. Output and exit travel on the session's output stream, never in this answer.",
  });

/** The `text/event-stream` frame body for terminal output. */
export const terminalOutputFrameSchema = z
  .strictObject({
    kind: z.literal("output"),
    sessionId: terminalSessionIdSchema,
    data: terminalPayloadSchema,
  })
  .meta({
    id: "TerminalOutputFrame",
    description: "Bytes the shell wrote, base64, delivered over the output stream.",
  });

export const terminalExitFrameSchema = z
  .strictObject({
    kind: z.literal("exit"),
    sessionId: terminalSessionIdSchema,
    exitCode: z.int().nullable(),
  })
  .meta({
    id: "TerminalExitFrame",
    description:
      "The shell exited. The code is null when the host killed the session or could not observe one.",
  });

export const terminalFrameSchema = z.union([
  terminalOutputFrameSchema,
  terminalExitFrameSchema,
]);
export type TerminalFrame = z.infer<typeof terminalFrameSchema>;
export type TerminalOpenRequest = z.infer<typeof terminalOpenRequestSchema>;
export type TerminalOpenResponse = z.infer<typeof terminalOpenResponseSchema>;
export type TerminalInputRequest = z.infer<typeof terminalInputRequestSchema>;
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;
export type TerminalCloseRequest = z.infer<typeof terminalCloseRequestSchema>;
export type TerminalAcknowledgement = z.infer<
  typeof terminalAcknowledgementSchema
>;

/** Query for the session output stream. */
export const terminalOutputQuerySchema = z
  .strictObject({
    sessionId: terminalSessionIdSchema,
  })
  .meta({
    id: "TerminalOutputQuery",
    description: "Names the terminal session whose output stream to open.",
  });
export type TerminalOutputQuery = z.infer<typeof terminalOutputQuerySchema>;
