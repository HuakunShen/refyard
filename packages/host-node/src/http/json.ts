/**
 * Request bodies, query strings and redacted logs.
 *
 * Everything a client sends crosses the contract before it is used: the body is
 * read with a hard byte limit, parsed as JSON, and validated by the same Zod schema
 * that generates the published JSON Schema. That is what makes "unknown key" a 400
 * instead of a silently ignored field — `strictObject` is doing load-bearing work,
 * not decoration.
 *
 * Query strings are converted here and validated there: repeated parameters become
 * arrays, integers become numbers, an empty value becomes the empty string (so the
 * schema can reject it) — and the conversion never coerces a boolean or an object,
 * because a query string cannot express one.
 *
 * Logging is deliberately lossy. A journal line records the method, the path, the
 * status and the session id; it never records a token, a ticket, an Authorization
 * header, a query string or a body, because those carry credentials and repository
 * content.
 */
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { ZodType } from "zod";
import type { Problem } from "@refyard/git-contract";

export interface HttpLimits {
  /** Largest JSON body accepted, in bytes. */
  readonly maxBodyBytes: number;
  /** Largest request target accepted, in bytes. */
  readonly maxUrlBytes: number;
  /** Largest number of query parameters accepted. */
  readonly maxQueryParameters: number;
  /** Longest single query value accepted, in bytes. */
  readonly maxQueryValueBytes: number;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = {
  maxBodyBytes: 1024 * 1024,
  maxUrlBytes: 8192,
  maxQueryParameters: 64,
  maxQueryValueBytes: 4096,
};

export type ReadBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly problem: Problem };

/**
 * Read and parse a JSON body.
 *
 * The limit is enforced while reading rather than after, so a client that streams
 * a gigabyte is cut off at the bound instead of allocating it first. A declared
 * `content-length` over the limit is refused before a byte is read.
 */
export async function readJsonBody(
  request: IncomingMessage,
  limits: HttpLimits,
): Promise<ReadBodyResult> {
  const declared = request.headers["content-length"];
  if (typeof declared === "string") {
    const length = Number.parseInt(declared, 10);
    if (Number.isFinite(length) && length > limits.maxBodyBytes) {
      return {
        ok: false,
        problem: {
          code: "LimitExceeded",
          message: `the request body may not exceed ${limits.maxBodyBytes} bytes`,
          details: { maxBodyBytes: limits.maxBodyBytes },
          retryable: false,
        },
      };
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > limits.maxBodyBytes) {
      return {
        ok: false,
        problem: {
          code: "LimitExceeded",
          message: `the request body may not exceed ${limits.maxBodyBytes} bytes`,
          details: { maxBodyBytes: limits.maxBodyBytes },
          retryable: false,
        },
      };
    }
    chunks.push(buffer);
  }

  if (total === 0) {
    return {
      ok: false,
      problem: {
        code: "InvalidRequest",
        message: "a JSON body is required",
        retryable: false,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {
      ok: false,
      problem: {
        code: "InvalidRequest",
        message: "the request body is not valid JSON",
        retryable: false,
      },
    };
  }
  return { ok: true, value: parsed };
}

/** Validate a value against a contract schema, converting the issues to a problem. */
export function validate<T>(
  schema: ZodType<T>,
  value: unknown,
  label: string,
):
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: Problem } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      problem: {
        code: "InvalidRequest",
        message: `${label} is not valid: ${first === undefined ? "no detail" : `${first.path.join(".") || "(root)"} ${first.message}`}`,
        details: { issues: parsed.error.issues.length },
        retryable: false,
      },
    };
  }
  return { ok: true, value: parsed.data };
}

/** A query value after conversion: parameters, plus the numbers and booleans the
 * contract's schema declares for them. */
export type ConvertedQuery = Record<
  string,
  string | string[] | number | boolean
>;

export type QueryResult =
  | { readonly ok: true; readonly value: ConvertedQuery }
  | { readonly ok: false; readonly problem: Problem };

/**
 * Convert a query string into the value shape the contract's query schemas expect.
 *
 * A repeated key becomes an array, a key appearing once stays a string. Nothing is
 * coerced to a number or a boolean here: the schema's own `z.int()` would reject a
 * string anyway, and a coercion layer that guessed would accept `?limit=abc` as
 * something.
 */
export function parseQuery(rawQuery: string, limits: HttpLimits): QueryResult {
  const value: ConvertedQuery = {};
  if (rawQuery.length === 0) {
    return { ok: true, value };
  }
  const parameters = new URLSearchParams(rawQuery);
  let count = 0;
  for (const [key, entry] of parameters) {
    count += 1;
    if (count > limits.maxQueryParameters) {
      return {
        ok: false,
        problem: {
          code: "LimitExceeded",
          message: `at most ${limits.maxQueryParameters} query parameters are accepted`,
          retryable: false,
        },
      };
    }
    if (Buffer.byteLength(entry, "utf8") > limits.maxQueryValueBytes) {
      return {
        ok: false,
        problem: {
          code: "LimitExceeded",
          message: `a query value may not exceed ${limits.maxQueryValueBytes} bytes`,
          details: { key },
          retryable: false,
        },
      };
    }
    const existing = value[key];
    if (existing === undefined) {
      value[key] = entry;
    } else if (Array.isArray(existing)) {
      existing.push(entry);
    } else if (typeof existing === "string") {
      value[key] = [existing, entry];
    } else {
      // A repeated non-string parameter cannot happen while reading a raw query;
      // keeping the first value is the conservative answer if it ever does.
      value[key] = existing;
    }
  }
  return { ok: true, value };
}

/**
 * Convert a query string into the value shape the contract's schema expects.
 *
 * The conversion is driven by the schema rather than by a hand-kept list of keys:
 * for each parameter it walks to the field's base type, and turns a numeric field
 * into a number and a boolean field into `true`/`false`. Everything else stays a
 * string, so a path, an object id or a cursor arrives at the schema exactly as it
 * was sent.
 *
 * A value that cannot be converted is left as its original string, and the schema
 * then rejects it with its own message — this layer never guesses, and never
 * accepts `limit=abc` as a number. An unknown key is passed through untouched so
 * the schema's `strictObject` reports it instead of silently dropping it here.
 */
export function convertQuery(
  schema: z.ZodObject,
  raw: ConvertedQuery,
): QueryResult {
  const shape: Record<string, unknown> = schema.shape;
  const value: ConvertedQuery = {};
  for (const [key, entry] of Object.entries(raw)) {
    const field = shape[key];
    const base = field === undefined ? null : baseTypeOf(field);
    if (
      base === "number" &&
      typeof entry === "string" &&
      /^-?\d+$/.test(entry)
    ) {
      value[key] = Number.parseInt(entry, 10);
      continue;
    }
    if (base === "boolean" && typeof entry === "string") {
      if (entry === "true") {
        value[key] = true;
        continue;
      }
      if (entry === "false") {
        value[key] = false;
        continue;
      }
    }
    value[key] = entry;
  }
  return { ok: true, value };
}

/** The innermost named type of a field, unwrapping `optional`/`nullable`/`default`. */
function baseTypeOf(field: unknown): string | null {
  let current: unknown = field;
  let guard = 0;
  while (
    typeof current === "object" &&
    current !== null &&
    "def" in current &&
    guard < 8
  ) {
    guard += 1;
    const def = (
      current as {
        readonly def: { readonly type?: string; readonly innerType?: unknown };
      }
    ).def;
    if (def.type === undefined) {
      return null;
    }
    if (def.innerType === undefined) {
      return def.type;
    }
    if (
      def.type === "number" ||
      def.type === "boolean" ||
      def.type === "string"
    ) {
      return def.type;
    }
    current = def.innerType;
  }
  return null;
}

/**
 * One line of request logging, with nothing sensitive in it.
 *
 * The URL is logged as its path only. A pairing ticket travels in a fragment (which
 * a browser never sends), and a credential could still appear in a query string if
 * a caller put one there — so query strings are not logged at all, and neither is
 * any header.
 */
export function logLine(input: {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly sessionId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly problemCode?: string | undefined;
}): string {
  const parts = [
    `${input.method} ${input.path}`,
    String(input.status),
    `${Math.round(input.durationMs)}ms`,
  ];
  if (input.sessionId !== undefined) {
    parts.push(`session=${input.sessionId}`);
  }
  if (input.problemCode !== undefined) {
    parts.push(`problem=${input.problemCode}`);
  }
  if (input.correlationId !== undefined) {
    parts.push(`correlation=${input.correlationId}`);
  }
  return parts.join(" ");
}

/** Redact a URL for display: userinfo removed, query string dropped. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "(unparseable url)";
  }
}
