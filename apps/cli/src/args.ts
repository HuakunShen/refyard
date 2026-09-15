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
 * refyard serve --repo <path> [--port N] [--ticket-ttl S] [--no-open]
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
      readonly port: number;
      readonly portExplicit: boolean;
      readonly openBrowser: boolean;
      readonly ticketTtlSeconds: number;
      readonly allowRoot: boolean;
      readonly json: boolean;
    }
  | {
      readonly kind: "serve";
      readonly path: string;
      readonly port: number;
      readonly portExplicit: boolean;
      readonly openBrowser: boolean;
      readonly ticketTtlSeconds: number;
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
  refyard serve --repo <path> [opts]   serve without opening a browser
  refyard doctor [--json]              report what this machine can do

options:
  --repo <path>     repository to serve (required by \`serve\`, optional otherwise)
  --port <n>        loopback port; default ${DEFAULT_PORT} (another free port is
                    taken if it is busy); 0 asks the OS for one
  --ticket-ttl <s>  pairing ticket lifetime in seconds; default 60, max 86400
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
    if (path !== null || repoPath !== null) {
      return { ok: false, message: "doctor does not take a repository path" };
    }
    return { ok: true, command: { kind: "doctor", json, allowRoot } };
  }

  const chosen = repoPath ?? path ?? cwd;
  if (kind === "serve" && repoPath === null && path === null) {
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
      path: resolve(cwd, chosen),
      port: port.value,
      portExplicit: port.explicit,
      openBrowser,
      ticketTtlSeconds: ticketTtl.value,
      allowRoot,
      json,
    },
  };
}
