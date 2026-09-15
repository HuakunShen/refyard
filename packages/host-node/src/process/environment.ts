/**
 * The environment every Git process is given.
 *
 * Two problems are solved here, and both have bitten real tools:
 *
 * 1. **Ambient redirects.** A `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
 *    `GIT_OBJECT_DIRECTORY` or `GIT_CONFIG` in the caller's shell would silently
 *    point Git at a different repository, index or configuration than the one the
 *    user approved. They are removed, not inherited.
 * 2. **Interactive Git.** `GIT_TERMINAL_PROMPT=0` stops Git waiting on a terminal
 *    for a password that will never come. That does not make every helper
 *    non-interactive — an SSH askpass or a credential helper can still prompt — so
 *    the design's rule applies: report that credentials are needed on the target
 *    machine rather than disabling host verification to make it go away.
 *
 * Everything else the user's environment provides is kept, because this service
 * runs as that user against *their* repositories: `HOME` finds their global
 * config, `SSH_AUTH_SOCK` their agent, `GPG_TTY`/`GNUPGHOME` their signing setup.
 * A client cannot influence any of this — the environment is built from the host
 * process, never from a request.
 */
import { delimiter, dirname } from "node:path";

/** Variables copied from the host process when present, and only these. */
export const INHERITED_ENV_VARS: readonly string[] = [
  // Executable and shell basics.
  "PATH",
  "PATHEXT",
  "SHELL",
  "COMSPEC",
  // The user, whose repositories and credentials these are.
  "HOME",
  "USER",
  "LOGNAME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  // The commit identity, which belongs to whoever started this service. These set a
  // name, an address and a date — they cannot redirect Git or make it run anything, so
  // they are not on the blocked list — and dropping them would mean two visible
  // failures: a CI job that exported GIT_COMMITTER_* getting commits attributed to
  // somebody else, and Git resolving an identity from the system account database for
  // every command that needs one. That fallback was measured at 15.05s for a single
  // `git worktree add` on the machine this was found on.
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  // Signing and SSH, so the user's existing setup keeps working.
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GNUPGHOME",
  "GPG_TTY",
  "TERM",
  "DISPLAY",
  // Temp space and platform paths.
  "TMPDIR",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  // Locale and timezone, left as the user set them: Git's machine formats are
  // locale-independent, and diagnostics read better in the user's language.
  "LANG",
  "LC_ALL",
  "LC_MESSAGES",
  "TZ",
];

/**
 * Variables that redirect Git, or make it run something, and are therefore never
 * passed through — even if a future edit adds one to the inherit list above.
 *
 * `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` are the
 * environment equivalent of `-c` and can set any config key, including the ones
 * that name a program to execute (a diff driver, a textconv filter, a credential
 * helper, `core.sshCommand`).
 */
export const BLOCKED_ENV_VARS: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_EXTERNAL_DIFF",
  "GIT_DIFF_OPTS",
  "GIT_TRACE",
  "GIT_TRACE2",
  "GIT_TRACE2_EVENT",
  "GIT_TRACE_PERFORMANCE",
  "GIT_TRACE_PACKET",
  "GIT_TRACE_SETUP",
  "GIT_TRACE_SHALLOW",
  "GIT_SSH_VARIANT",
];

/** Variables whose value is set by this host, never inherited. */
export const HOST_SET_ENV_VARS: Readonly<Record<string, string>> = {
  /** Never wait for a terminal prompt: there is no terminal. */
  GIT_TERMINAL_PROMPT: "0",
  /** No pager can take over a captured pipe; `--no-pager` is belt and braces. */
  GIT_PAGER: "cat",
  PAGER: "cat",
};

export interface BuildGitEnvironmentOptions {
  /** Absolute path of the Git executable, so its directory can lead PATH. */
  readonly gitPath?: string;
  /** Extra entries for tests; applied after the allow-list, minus the blocked names. */
  readonly extra?: Readonly<Record<string, string>>;
  /** The ambient environment; defaults to the host process's. */
  readonly source?: NodeJS.ProcessEnv;
}

/**
 * Build the child environment for one Git process.
 *
 * The result contains only inherited-and-allowed variables, the host-set values,
 * and (for tests) explicit extras. `gitPath`'s directory is prepended to PATH so
 * that a hook or a helper invoked by Git finds the same Git the service uses,
 * rather than whatever a modified PATH would offer. The blocked names are removed
 * last and cannot be reintroduced, not even by `extra`.
 */
export function buildGitEnvironment(
  options: BuildGitEnvironmentOptions = {},
): Record<string, string> {
  const source = options.source ?? process.env;
  const env: Record<string, string> = {};

  for (const name of INHERITED_ENV_VARS) {
    const value = source[name];
    if (value !== undefined && value.length > 0) {
      env[name] = value;
    }
  }

  if (options.gitPath !== undefined) {
    const directory = dirname(options.gitPath);
    const existing = env["PATH"];
    env["PATH"] =
      existing === undefined
        ? directory
        : `${directory}${delimiter}${existing}`;
  }

  for (const [name, value] of Object.entries(HOST_SET_ENV_VARS)) {
    env[name] = value;
  }
  if (options.extra !== undefined) {
    for (const [name, value] of Object.entries(options.extra)) {
      env[name] = value;
    }
  }

  // Blocked names are removed last, after every other source has been merged. The
  // block is structural rather than a default: `GIT_DIR`/`GIT_WORK_TREE` retarget
  // which repository a command operates on, and no caller — including a test's
  // `extra` — gets to put one back and make a scoped command act elsewhere.
  for (const name of BLOCKED_ENV_VARS) {
    delete env[name];
  }

  return env;
}

/** Names of the environment variables this host refuses to pass through. */
export function blockedVariableNames(): readonly string[] {
  return BLOCKED_ENV_VARS;
}
