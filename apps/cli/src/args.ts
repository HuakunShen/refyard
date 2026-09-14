/**
 * Command-line parsing.
 *
 * The grammar is small and fixed, and it is parsed by hand for one reason: the
 * design forbids putting user text into a shell, and a parser whose output is a
 * *typed command object* — rather than a string to be re-split — is what makes that
 * checkable. Every field below is a value this program uses directly.
 *
 * ```
 * refyard [path]                    # same as `open`
 * refyard open [path] [--port N] [--no-open]
 * refyard serve --repo <path> [--port N] [--no-open]
 * refyard doctor [--json]
 * ```
 *
 * Rules that are enforced rather than documented:
 *
 * - an unknown flag is an error, not something ignored;
 * - `--port` must be an integer in 0..65535 (`0` asks the OS for a free port, which
 *   is how tests and throwaway sessions work);
 * - exactly one path may be given, and it is resolved relative to the caller's
 *   working directory — never inside core, which has no notion of a cwd;
 * - `--allow-root` must be explicit, so running as root is never an accident.
 */
import { resolve } from "node:path";

export type CliCommand =
  | {
      readonly kind: "open";
      readonly path: string;
      readonly port: number;
      readonly portExplicit: boolean;
      readonly openBrowser: boolean;
      readonly allowRoot: boolean;
    }
  | {
      readonly kind: "serve";
      readonly path: string;
      readonly port: number;
      readonly portExplicit: boolean;
      readonly openBrowser: boolean;
      readonly allowRoot: boolean;
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

export const DEFAULT_PORT = 47831;

const HELP_TEXT = `refyard — a local Git workbench

usage:
  refyard [path]                       open the workbench for a repository
  refyard open [path] [options]        same, spelled out
  refyard serve --repo <path> [opts]   serve without opening a browser
  refyard doctor [--json]              report what this machine can do

options:
  --repo <path>     repository to serve (required by \`serve\`, optional otherwise)
  --port <n>        loopback port; default ${DEFAULT_PORT}, 0 asks for a free one
  --no-open         do not open a browser
  --json            machine-readable output (doctor)
  --allow-root      permit running as root; off by default
  -h, --help        this text
  -v, --version     version info
`;

export function helpText(): string {
  return HELP_TEXT;
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

  let path: string | null = null;
  let repoPath: string | null = null;
  let port = DEFAULT_PORT;
  let portExplicit = false;
  let openBrowser = kind !== "serve";
  let json = false;
  let allowRoot = false;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) {
      continue;
    }
    switch (word) {
      case "--repo": {
        const value = words[index + 1];
        if (value === undefined || value.startsWith("--")) {
          return { ok: false, message: "--repo requires a path" };
        }
        repoPath = value;
        index += 1;
        break;
      }
      case "--port": {
        const value = words[index + 1];
        if (value === undefined) {
          return { ok: false, message: "--port requires a number" };
        }
        if (!/^\d{1,5}$/.test(value)) {
          return {
            ok: false,
            message: `--port must be a whole number, not "${value}"`,
          };
        }
        const parsed = Number.parseInt(value, 10);
        if (parsed > 65535) {
          return { ok: false, message: "--port must be between 0 and 65535" };
        }
        port = parsed;
        portExplicit = true;
        index += 1;
        break;
      }
      case "--no-open":
        openBrowser = false;
        break;
      case "--open":
        openBrowser = true;
        break;
      case "--json":
        json = true;
        break;
      case "--allow-root":
        allowRoot = true;
        break;
      default: {
        if (word.startsWith("-")) {
          return { ok: false, message: `unknown option "${word}"` };
        }
        if (path !== null) {
          return {
            ok: false,
            message: `only one path may be given (already have "${path}")`,
          };
        }
        path = word;
      }
    }
  }

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
      port,
      portExplicit,
      openBrowser,
      allowRoot,
    },
  };
}
