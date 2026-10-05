/**
 * Which program a new terminal session runs.
 *
 * The host decides, never the browser: the caller names a repository, and the
 * shell is this machine's own login shell, resolved the way a terminal emulator
 * would resolve it. `$SHELL` first because a person who chose fish wants fish;
 * the passwd entry is not consulted here — a Node process can read it only by
 * shelling out, and a wrong-but-known default beats a second subprocess at
 * service startup. The name reported in `capabilities` is what new sessions run.
 */
import { existsSync } from "node:fs";

export interface TerminalCommand {
  readonly shell: string;
  readonly argv: readonly string[];
  /** The name `capabilities.terminal.shell` reports. */
  readonly name: string;
}

const UNIX_FALLBACKS = ["/bin/zsh", "/bin/bash", "/bin/sh"] as const;

export function defaultTerminalCommand(
  environment: Readonly<Record<string, string | undefined>>,
): TerminalCommand {
  if (process.platform === "win32") {
    const comspec = environment.ComSpec ?? "powershell.exe";
    return { shell: comspec, argv: ["-NoLogo"], name: basename(comspec) };
  }
  const fromEnvironment = environment.SHELL;
  if (
    typeof fromEnvironment === "string" &&
    fromEnvironment.startsWith("/") &&
    existsSync(fromEnvironment)
  ) {
    return loginShell(fromEnvironment);
  }
  for (const candidate of UNIX_FALLBACKS) {
    if (existsSync(candidate)) {
      return loginShell(candidate);
    }
  }
  // A machine with no shell at all cannot offer a terminal; the caller turns
  // this into an honest refusal rather than spawning something surprising.
  throw new Error("no shell found to run a terminal session with");
}

function loginShell(shell: string): TerminalCommand {
  // A login shell sources the profile the person already maintains: the PATH,
  // aliases and prompt of their own machine, which is the point of a terminal
  // beside a workbench.
  return { shell, argv: ["-l"], name: basename(shell) };
}

function basename(path: string): string {
  const last = path.lastIndexOf("/");
  return last === -1 ? path : path.slice(last + 1);
}
