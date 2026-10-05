/**
 * The terminal client: one HTTP surface for the pty the host owns.
 *
 * `open` is a POST that both creates the session and names its observer; the
 * output stream is a fetch-SSE (never `EventSource`, which cannot carry the
 * bearer) exactly like the event stream, and input, resize and close are plain
 * POSTs. The stream does not reconnect: bytes a dropped connection never
 * delivered are gone, and pretending otherwise would paint a terminal that
 * silently skipped output — so the observer hears an error and the UI shows the
 * session as dead, which is the truth.
 */
import {
  terminalFrameSchema,
  terminalOpenResponseSchema,
  type Problem,
} from "@refyard/git-contract";
import type {
  TerminalObserver,
  TerminalOpenRequest,
  TerminalService,
  TerminalSessionHandle,
} from "@refyard/git-service";

export interface TerminalClientOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token: () => string | null;
  /** Tied to the session lifetime so `dispose()` really stops the stream. */
  readonly signal?: AbortSignal;
}

interface ProblemBody {
  readonly problem?: Problem;
}

async function post(
  options: TerminalClientOptions,
  path: string,
  body: unknown,
): Promise<Response> {
  return options.fetch(`${options.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.token() ?? ""}`,
    },
    credentials: "omit",
    body: JSON.stringify(body),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function problemOf(response: Response): Promise<Problem> {
  let body: ProblemBody | null = null;
  try {
    body = (await response.json()) as ProblemBody;
  } catch {
    body = null;
  }
  const problem = body?.problem;
  if (problem !== undefined && typeof problem.code === "string") {
    return problem;
  }
  return {
    code: response.status === 401 ? "Unauthenticated" : "InternalError",
    message: `the terminal request failed with status ${response.status}`,
    retryable: false,
  };
}

export function createTerminalClient(
  options: TerminalClientOptions,
): TerminalService {
  return {
    async open(
      request: TerminalOpenRequest,
      observer: TerminalObserver,
    ): Promise<TerminalSessionHandle> {
      const created = await post(options, "/api/v1/terminal/open", request);
      if (!created.ok) {
        throw new Error((await problemOf(created)).message);
      }
      const info = terminalOpenResponseSchema.parse(await created.json());

      // The output stream is opened here, not by the caller: a session whose
      // stream lags its creation would silently drop the shell's first bytes.
      const stream = new AbortController();
      const finished = watchOutput(options, stream.signal, info.sessionId, observer);

      let writeBroken = false;
      const reportOnce = (problem: Problem): void => {
        if (!writeBroken) {
          writeBroken = true;
          observer.onError(problem);
        }
      };

      return {
        info,
        write(data: Uint8Array): void {
          if (writeBroken) {
            return;
          }
          void post(options, "/api/v1/terminal/input", {
            sessionId: info.sessionId,
            data: toBase64(data),
          })
            .then(async (response) => {
              if (!response.ok) {
                reportOnce(await problemOf(response));
              }
            })
            .catch(() => {
              reportOnce({
                code: "InternalError",
                message: "the terminal input request could not be sent",
                retryable: false,
              });
            });
        },
        resize(cols: number, rows: number): void {
          if (writeBroken) {
            return;
          }
          void post(options, "/api/v1/terminal/resize", {
            sessionId: info.sessionId,
            cols,
            rows,
          }).catch(() => {});
        },
        async close(): Promise<void> {
          stream.abort();
          await post(options, "/api/v1/terminal/close", {
            sessionId: info.sessionId,
          }).catch(() => {});
          await finished.catch(() => {});
        },
      };
    },
  };
}

async function watchOutput(
  options: TerminalClientOptions,
  signal: AbortSignal,
  sessionId: string,
  observer: TerminalObserver,
): Promise<void> {
  const response = await options.fetch(
    `${options.baseUrl}/api/v1/terminal/output?sessionId=${encodeURIComponent(sessionId)}`,
    {
      headers: {
        authorization: `Bearer ${options.token() ?? ""}`,
        accept: "text/event-stream",
      },
      credentials: "omit",
      signal,
    },
  );
  if (!response.ok || response.body === null) {
    observer.onError({
      code: response.status === 401 ? "Unauthenticated" : "InternalError",
      message: "the terminal output stream could not be opened",
      retryable: false,
    });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return;
    }
    buffered += decoder.decode(chunk.value, { stream: true });
    let boundary = buffered.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      boundary = buffered.indexOf("\n\n");
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const parsed = terminalFrameSchema.safeParse(
          JSON.parse(line.slice("data: ".length)),
        );
        if (!parsed.success) {
          observer.onError({
            code: "InternalError",
            message: "the terminal stream carried a frame this client cannot read",
            retryable: false,
          });
          return;
        }
        if (parsed.data.kind === "exit") {
          observer.onExit(parsed.data.exitCode);
          return;
        }
        observer.onData(fromBase64(parsed.data.data));
      }
    }
  }
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
