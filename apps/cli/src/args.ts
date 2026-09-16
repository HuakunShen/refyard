/**
 * Command-line parsing: citty reads the tokens, this module owns the rules.
 *
 * The grammar is small and fixed. Tokenising it is exactly the kind of work a maintained
 * parser does better than this repository ever will (flag/`--no-` negation, value
 * consumption, camel-case mirrors), so the raw split is delegated to citty's `parseArgs`.
 * What is *not* delegated is deciding what the tokens mean: citty is permissive by design —
 * an unknown flag arrives as a boolean and a stray value becomes a positional — and a Git
 * tool must refuse `--depth 5` rather than open a repository named "5". So every parsed
 * key is checked against the declared set, values are validated in full, and the output is
 * a typed command object — never a string to be re-split, which is what would make putting
 * user text into a shell checkable.
 *
 * ```
 * refyard [path]                    # same as `open`
 * refyard open [path] [--port N] [--ticket-ttl S] [--no-open]
 * refyard serve --repo <path>... [--port N] [--ticket-ttl S] [--no-open]
 * refyard doctor [--json]
 * ```
 *
 * Rules enforced here rather than documented:
 *
 * - an unknown flag is an error, not something ignored;
 * - `--port` must be an integer in 0..65535 (`0` asks the OS for a free port, which
 *   is how tests and throwaway sessions work);
 * - exactly one path may be given, and it is resolved relative to the caller's
 *   working directory — never inside core, which has no notion of a cwd;
 * - `--allow-root` must be explicit, so running as root is never an accident;
 * - `--ticket-ttl` widens the pairing ticket's life beyond the 60-second default — a
 *   convenience for a URL that will be read later (a chat message, a bookmarked note),
 *   never a smaller default.
 */
import { DEFAULT_SERVICE_PORT } from "@refyard/host-node";
import { parseArgs as parseTokens } from "citty";
import { resolve } from "node:path";

export type CliCommand =
  | {
      readonly kind: "open";
      readonly path: string;
      readonly paths: readonly string[];
      readonly port: number;
      readonly portExplicit: boolean;
      readonly openBrowser: boolean;
      readonly ticketTtlSeconds: number;
      readonly allowedOrigins: readonly string[];
      readonly uiOrigin: string | null;
      readonly apiOrigin: string | null;
      readonly allowRoot: boolean;
      readonly json: boolean;
    }
  | {
      readonly kind: "serve";
      readonly path: string;
      readonly paths: readonly string[];
      readonly port: number;
      readonly portExplicit: boolean;
      readonly openBrowser: boolean;
      readonly ticketTtlSeconds: number;
      readonly allowedOrigins: readonly string[];
      readonly uiOrigin: string | null;
      readonly apiOrigin: string | null;
      readonly allowRoot: boolean;
      readonly json: boolean;
    }
  | {
      readonly kind: "doctor";
      readonly json: boolean;
      readonly allowRoot: boolean;
    }
  | { readonly kind: "help" }
  | { readonly kind: "version" };

export type ParseResult =
  | { readonly ok: true; readonly command: CliCommand }
  | { readonly ok: false; readonly message: string };

/**
 * The loopback port this CLI asks for when `--port` is absent.
 *
 * Re-exported from the host, which is the layer that binds: one number, one place. If
 * something else holds it, the service takes another free port and says so (see
 * `runService`) — a default that refused to start would be unusable whenever a second
 * refyard, a dev server or a tunnel held it.
 */
export const DEFAULT_PORT = DEFAULT_SERVICE_PORT;
/** Matches the auth store's default; both exist so the CLI can print what it chose. */
export const DEFAULT_TICKET_TTL_SECONDS = 60;

/** The flags citty tokenises for every command. Values arrive as strings; validated below. */
const ARGS_DEF = {
  repo: { type: "string", valueHint: "path" },
  port: { type: "string", valueHint: "n" },
  open: { type: "boolean" },
  "allow-root": { type: "boolean" },
  json: { type: "boolean" },
  "ticket-ttl": { type: "string", valueHint: "s" },
  "allow-origin": { type: "string", valueHint: "origin" },
  "ui-origin": { type: "string", valueHint: "origin" },
  "api-origin": { type: "string", valueHint: "origin" },
} as const;

/**
 * Every key citty may legally return, including the camel-case mirrors it synthesises for
 * kebab-case names (`allow-root` → `allowRoot`). Anything else in the parsed object is an
 * unknown flag that must be named and refused.
 */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "_",
  ...Object.keys(ARGS_DEF),
  ...Object.keys(ARGS_DEF)
    .filter((name) => name.includes("-"))
    .map((name) =>
      name.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    ),
]);

const HELP_TEXT = `refyard — a local Git workbench

usage:
  refyard [path]                       open the workbench for a repository
  refyard open [path] [options]        same, spelled out
  refyard serve --repo <path>... [opts]  serve without opening a browser
  refyard doctor [--json]              report what this machine can do

options:
  --repo <path>...  repository to serve (repeat for multiple explicit repositories)
  --port <n>        loopback port; default ${DEFAULT_PORT} (another free port is
                    taken if it is busy); 0 asks the OS for one
  --ticket-ttl <s>  pairing ticket lifetime in seconds; default 60, max 86400
  --allow-origin <origin> exact hosted browser origin allowed to call the API (repeatable)
  --ui-origin <origin>    separately deployed UI origin that receives the pairing URL
  --api-origin <origin>   browser-visible API origin (required for a remote UI)
  --no-open         do not open a browser
  --json            machine-readable output; for \`open\`/\`serve\` it prints one JSON
                    object on stdout (no ticket) and sends the pairing URL to stderr
  --allow-root      permit running as root; off by default
  -h, --help        this text
  -v, --version     version info
`;

export function helpText(): string {
  return HELP_TEXT;
}

/** A whole number within a range, or the message explaining why not. */
function wholeNumberInRange(
  flag: string,
  value: string,
  min: number,
  max: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string } {
  if (!/^\d{1,5}$/.test(value)) {
    return {
      ok: false,
      message: `${flag} must be a whole number, not "${value}"`,
    };
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    return {
      ok: false,
      message: `${flag} must be between ${min} and ${max}`,
    };
  }
  return { ok: true, value: parsed };
}

/**
 * An optional whole-number flag: absent means the caller's default, present means
 * validated. The distinction is the point — `--port` given badly is an error, `--port`
 * not given at all is just the default port.
 */
function optionalWholeNumber(
  flag: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
):
  | { readonly ok: true; readonly value: number; readonly explicit: boolean }
  | { readonly ok: false; readonly message: string } {
  if (value === undefined) {
    return { ok: true, value: fallback, explicit: false };
  }
  const validated = wholeNumberInRange(flag, value, min, max);
  return validated.ok
    ? { ok: true, value: validated.value, explicit: true }
    : validated;
}

/** Collect a repeatable scalar before citty collapses it to its last value. */
function repeatedRepoValues(
  words: readonly string[],
):
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly message: string } {
  const values: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--repo") {
      const value = words[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: "--repo needs a path" };
      }
      values.push(value);
      index += 1;
      continue;
    }
    if (word?.startsWith("--repo=") === true) {
      const value = word.slice("--repo=".length);
      if (value.length === 0) {
        return { ok: false, message: "--repo needs a path" };
      }
      values.push(value);
    }
  }
  return { ok: true, values };
}

/** Collect repeatable string options before citty collapses them to their last value. */
function repeatedOptionValues(
  words: readonly string[],
  flag: string,
):
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly message: string } {
  const values: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === flag) {
      const value = words[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: `${flag} needs a value` };
      }
      values.push(value);
      index += 1;
      continue;
    }
    if (word?.startsWith(`${flag}=`) === true) {
      const value = word.slice(flag.length + 1);
      if (value.length === 0) {
        return { ok: false, message: `${flag} needs a value` };
      }
      values.push(value);
    }
  }
  return { ok: true, values };
}

/** Normalize one configured browser origin without accepting paths or wildcards. */
function normalizeOrigin(
  flag: string,
  value: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: `${flag} must be an http(s) origin` };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return {
      ok: false,
      message: `${flag} must be an exact http(s) origin without a path or credentials`,
    };
  }
  return { ok: true, value: url.origin };
}

export function parseArgs(
  argv: readonly string[],
  cwd: string = process.cwd(),
): ParseResult {
  const words = [...argv];
  const first = words[0];
  let kind: "open" | "serve" | "doctor" = "open";
  if (first === "open" || first === "serve" || first === "doctor") {
    kind = first;
    words.shift();
  } else if (first !== undefined && !first.startsWith("-")) {
    // `refyard <path>` is the documented shorthand for `refyard open <path>`.
    kind = "open";
  }

  if (words.includes("-h") || words.includes("--help")) {
    return { ok: true, command: { kind: "help" } };
  }
  if (words.includes("-v") || words.includes("--version")) {
    return { ok: true, command: { kind: "version" } };
  }

  const parsed = parseTokens(words, ARGS_DEF);
  const repoValues = repeatedRepoValues(words);
  if (!repoValues.ok) {
    return repoValues;
  }
  const allowedOriginValues = repeatedOptionValues(words, "--allow-origin");
  if (!allowedOriginValues.ok) {
    return allowedOriginValues;
  }
  const uiOriginValues = repeatedOptionValues(words, "--ui-origin");
  if (!uiOriginValues.ok) {
    return uiOriginValues;
  }
  if (uiOriginValues.values.length > 1) {
    return { ok: false, message: "--ui-origin may be given only once" };
  }
  const apiOriginValues = repeatedOptionValues(words, "--api-origin");
  if (!apiOriginValues.ok) {
    return apiOriginValues;
  }
  if (apiOriginValues.values.length > 1) {
    return { ok: false, message: "--api-origin may be given only once" };
  }
  const allowedOrigins: string[] = [];
  for (const value of allowedOriginValues.values) {
    const normalized = normalizeOrigin("--allow-origin", value);
    if (!normalized.ok) {
      return normalized;
    }
    if (!allowedOrigins.includes(normalized.value)) {
      allowedOrigins.push(normalized.value);
    }
  }
  const rawUiOrigin = uiOriginValues.values[0] ?? null;
  const normalizedUiOrigin =
    rawUiOrigin === null ? null : normalizeOrigin("--ui-origin", rawUiOrigin);
  if (normalizedUiOrigin !== null && !normalizedUiOrigin.ok) {
    return normalizedUiOrigin;
  }
  const uiOrigin =
    normalizedUiOrigin === null ? null : normalizedUiOrigin.value;
  if (uiOrigin !== null && !allowedOrigins.includes(uiOrigin)) {
    allowedOrigins.push(uiOrigin);
  }
  const rawApiOrigin = apiOriginValues.values[0] ?? null;
  const normalizedApiOrigin =
    rawApiOrigin === null
      ? null
      : normalizeOrigin("--api-origin", rawApiOrigin);
  if (normalizedApiOrigin !== null && !normalizedApiOrigin.ok) {
    return normalizedApiOrigin;
  }
  const apiOrigin =
    normalizedApiOrigin === null ? null : normalizedApiOrigin.value;
  if (apiOrigin !== null && uiOrigin === null) {
    return {
      ok: false,
      message: "--api-origin requires --ui-origin so the browser can use it",
    };
  }

  // citty tolerates what this tool must not: name and refuse anything undeclared.
  const unknown = Object.keys(parsed).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, message: `unknown option "--${unknown[0]}"` };
  }

  const positionals = parsed._;
  if (positionals.length > 1) {
    return {
      ok: false,
      message: `only one path may be given (already have "${positionals[0]}")`,
    };
  }
  const path = positionals[0] ?? null;
  const repoPath = parsed.repo ?? null;
  if (repoValues.values.length > 0 && path !== null) {
    return {
      ok: false,
      message:
        "pass repository paths either as positional arguments or with --repo",
    };
  }

  const port = optionalWholeNumber(
    "--port",
    parsed.port,
    DEFAULT_PORT,
    0,
    65_535,
  );
  if (!port.ok) {
    return port;
  }
  const ticketTtl = optionalWholeNumber(
    "--ticket-ttl",
    parsed["ticket-ttl"],
    DEFAULT_TICKET_TTL_SECONDS,
    1,
    86_400,
  );
  if (!ticketTtl.ok) {
    return ticketTtl;
  }

  const json = parsed.json === true;
  const allowRoot = parsed["allow-root"] === true;
  // `serve` never opens a browser unless it is asked to; `open` always does.
  const openBrowser =
    kind === "serve" ? (parsed.open ?? false) : (parsed.open ?? true);

  if (kind === "doctor") {
    if (path !== null || repoPath !== null || repoValues.values.length > 0) {
      return { ok: false, message: "doctor does not take a repository path" };
    }
    return { ok: true, command: { kind: "doctor", json, allowRoot } };
  }

  const chosenPaths =
    repoValues.values.length > 0
      ? repoValues.values
      : [repoPath ?? path ?? cwd];
  if (
    kind === "serve" &&
    repoValues.values.length === 0 &&
    repoPath === null &&
    path === null
  ) {
    return {
      ok: false,
      message:
        "serve needs a repository: pass --repo <path> or a path argument",
    };
  }
  return {
    ok: true,
    command: {
      kind,
      path: resolve(cwd, chosenPaths[0] ?? cwd),
      paths: chosenPaths.map((chosen) => resolve(cwd, chosen)),
      allowedOrigins,
      uiOrigin,
      apiOrigin,
      port: port.value,
      portExplicit: port.explicit,
      openBrowser,
      ticketTtlSeconds: ticketTtl.value,
      allowRoot,
      json,
    },
  };
}
