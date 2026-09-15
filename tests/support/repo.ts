/**
 * Temporary, fully isolated Git repositories for tests.
 *
 * Nothing in this suite may touch a developer's own repository or global Git
 * configuration, so every fixture gets its own temporary directory, its own
 * `HOME`, and config paths pointed at scratch files. The environment is built
 * from an allow-list rather than inherited: a stray `GIT_DIR`, `GIT_WORK_TREE` or
 * `GIT_CONFIG` in the caller's shell would otherwise silently redirect writes into
 * a real repository.
 *
 * `gitResult` hands back raw bytes. Tests that assert on Git's machine output must
 * decide for themselves how to decode, because production code does not get to
 * decide that by accident either.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A deterministic commit identity and instant, so fixtures are reproducible. */
const FIXTURE_AUTHOR_NAME = "Refyard Fixture";
const FIXTURE_AUTHOR_EMAIL = "fixture@refyard.invalid";
const FIXTURE_DATE = "2026-01-01T00:00:00+00:00";

export interface GitRunResult {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export interface GitRunOptions {
  /** Working directory; defaults to the repository root. */
  readonly cwd?: string;
  /** Extra environment entries merged over the isolated environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Bytes written to the process's stdin, for commands that read a list or a message. */
  readonly stdin?: Uint8Array;
}

export interface GitFixtureRepo {
  /** Working tree of the primary checkout. */
  readonly root: string;
  /** Isolated HOME. */
  readonly home: string;
  /** Temporary directory holding the whole fixture (repo, home, config). */
  readonly scratchRoot: string;
  /** Environment every `git` call in this fixture runs with. */
  readonly env: Readonly<Record<string, string>>;
  git(args: readonly string[], options?: GitRunOptions): Promise<Uint8Array>;
  gitResult(
    args: readonly string[],
    options?: GitRunOptions,
  ): Promise<GitRunResult>;
  write(relativePath: string, content: string | Uint8Array): Promise<void>;
  read(relativePath: string): Promise<Uint8Array>;
  readText(relativePath: string): Promise<string>;
  /** `git add -A && git commit`, returning the new commit id. */
  commitAll(
    message: string,
    options?: { readonly date?: string },
  ): Promise<string>;
  headOid(): Promise<string>;
  dispose(): Promise<void>;
}

export interface BareRemoteFixture {
  readonly path: string;
  git(args: readonly string[]): Promise<Uint8Array>;
  gitResult(args: readonly string[]): Promise<GitRunResult>;
  dispose(): Promise<void>;
}

export class GitFixtureError extends Error {
  readonly argv: readonly string[];
  readonly code: number | null;
  readonly stderr: Uint8Array;

  constructor(
    argv: readonly string[],
    code: number | null,
    stderr: Uint8Array,
  ) {
    super(
      `git ${argv.join(" ")} exited with ${code}: ${new TextDecoder().decode(stderr)}`,
    );
    this.name = "GitFixtureError";
    this.argv = argv;
    this.code = code;
    this.stderr = stderr;
  }
}

/** The `git` binary every fixture uses; overridable for a pinned installation. */
export function fixtureGitPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["REFYARD_TEST_GIT"] ?? "git";
}

/** Variables that must survive so `git` can run at all on this platform. */
const INHERITED_ENV_KEYS = [
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "ComSpec",
] as const;

function isolatedEnv(
  home: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // A repository workbench must behave the same in January and in a locale that
  // happens to translate Git's messages; fixtures pin both.
  env["LC_ALL"] = "C";
  env["LANG"] = "C";
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = join(home, ".config");
  env["GIT_CONFIG_GLOBAL"] = join(home, ".gitconfig");
  env["GIT_CONFIG_SYSTEM"] = process.platform === "win32" ? "NUL" : "/dev/null";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_ASKPASS"] = "";
  env["GIT_DEFAULT_BRANCH"] = "main";
  env["GIT_AUTHOR_NAME"] = FIXTURE_AUTHOR_NAME;
  env["GIT_AUTHOR_EMAIL"] = FIXTURE_AUTHOR_EMAIL;
  env["GIT_COMMITTER_NAME"] = FIXTURE_AUTHOR_NAME;
  env["GIT_COMMITTER_EMAIL"] = FIXTURE_AUTHOR_EMAIL;
  env["GIT_AUTHOR_DATE"] = FIXTURE_DATE;
  env["GIT_COMMITTER_DATE"] = FIXTURE_DATE;
  return { ...env, ...extra };
}

async function runGit(
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
  stdin?: Uint8Array,
): Promise<GitRunResult> {
  return new Promise<GitRunResult>((resolvePromise, rejectPromise) => {
    const child = spawn(fixtureGitPath(), [...argv], {
      cwd,
      env,
      shell: false,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (stdin !== undefined && child.stdin !== null) {
      child.stdin.end(Buffer.from(stdin));
    }
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    // Optional-chained because the stdio array is built conditionally, so the
    // process type is the generic one: a missing pipe simply yields no bytes.
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(new Uint8Array(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(new Uint8Array(chunk));
    });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      resolvePromise({
        argv: [...argv],
        cwd,
        code,
        signal,
        stdout: concatBytes(stdoutChunks),
        stderr: concatBytes(stderrChunks),
      });
    });
  });
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export interface CreateRepoOptions {
  /** Create `a.txt` with content `base\n` and commit it as `base`. */
  readonly initialCommit?: boolean;
  /** Initial branch name; `main` unless a test is about another default. */
  readonly branch?: string;
  /** Extra `git init` arguments, e.g. `--object-format=sha256`. */
  readonly initArgs?: readonly string[];
  /** Extra Git configuration written into the fixture's global config file. */
  readonly config?: Readonly<Record<string, string>>;
}

export async function createRepo(
  options: CreateRepoOptions = {},
): Promise<GitFixtureRepo> {
  const scratchRoot = await mkdtemp(join(tmpdir(), "refyard-fixture-"));
  const home = join(scratchRoot, "home");
  const root = join(scratchRoot, "repo");
  await mkdir(home, { recursive: true });
  await mkdir(root, { recursive: true });
  // An empty global config file, so the fixture's identity comes only from the
  // environment and a test can assert the user's own config was not read.
  await writeFile(join(home, ".gitconfig"), "", "utf8");
  const env = isolatedEnv(home);

  const gitResult = async (
    args: readonly string[],
    runOptions: GitRunOptions = {},
  ): Promise<GitRunResult> => {
    const runEnv =
      runOptions.env === undefined ? env : { ...env, ...runOptions.env };
    return runGit(args, runOptions.cwd ?? root, runEnv, runOptions.stdin);
  };
  const git = async (
    args: readonly string[],
    runOptions: GitRunOptions = {},
  ): Promise<Uint8Array> => {
    const result = await gitResult(args, runOptions);
    if (result.code !== 0) {
      throw new GitFixtureError(result.argv, result.code, result.stderr);
    }
    return result.stdout;
  };

  const branch = options.branch ?? "main";
  await git([
    "init",
    "--quiet",
    `--initial-branch=${branch}`,
    ...(options.initArgs ?? []),
  ]);
  for (const [key, value] of Object.entries(options.config ?? {})) {
    await git(["config", "--local", key, value]);
  }

  const repo: GitFixtureRepo = {
    root,
    home,
    scratchRoot,
    env,
    git,
    gitResult,
    async write(relativePath, content) {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    async read(relativePath) {
      return new Uint8Array(await readFile(join(root, relativePath)));
    },
    async readText(relativePath) {
      return readFile(join(root, relativePath), "utf8");
    },
    async commitAll(message, commitOptions = {}) {
      await git(["add", "-A"]);
      const envOverride: Record<string, string> = {};
      if (commitOptions.date !== undefined) {
        envOverride["GIT_AUTHOR_DATE"] = commitOptions.date;
        envOverride["GIT_COMMITTER_DATE"] = commitOptions.date;
      }
      await git(["commit", "--quiet", "-m", message], { env: envOverride });
      return (await repo.headOid()).trim();
    },
    async headOid() {
      const bytes = await git(["rev-parse", "HEAD"]);
      return new TextDecoder().decode(bytes).trim();
    },
    async dispose() {
      // Windows refuses to remove a directory while any handle inside it is open, and
      // the service a spec just stopped can still be closing its last one. `rm` retries
      // EBUSY/EPERM/ENOTEMPTY when asked, which is what turns "1 failed" runs that end
      // in `EBUSY: resource busy or locked, rmdir` into clean teardown.
      await rm(scratchRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    },
  };

  if (options.initialCommit === true) {
    await repo.write("a.txt", "base\n");
    await repo.commitAll("base");
  }

  return repo;
}

/** A bare repository usable as a `file://`-style remote, with no network. */
export async function createBareRemote(): Promise<BareRemoteFixture> {
  const scratchRoot = await mkdtemp(join(tmpdir(), "refyard-remote-"));
  const path = join(scratchRoot, "remote.git");
  const home = join(scratchRoot, "home");
  await mkdir(home, { recursive: true });
  const env = isolatedEnv(home);
  // Inside a bare repository directory Git finds itself without GIT_DIR, which is
  // how a real remote is addressed too.
  const gitResult = async (args: readonly string[]): Promise<GitRunResult> =>
    runGit(args, path, env);
  const git = async (args: readonly string[]): Promise<Uint8Array> => {
    const result = await gitResult(args);
    if (result.code !== 0) {
      throw new GitFixtureError(result.argv, result.code, result.stderr);
    }
    return result.stdout;
  };
  // The same branch name `createRepo` uses, so a bare remote's HEAD points at a
  // ref that exists once a fixture pushes to it; without this the isolated global
  // config has no `init.defaultBranch` and the remote's HEAD names an unborn branch.
  await runGit(
    ["init", "--bare", "--quiet", "--initial-branch=main", path],
    scratchRoot,
    env,
  );
  return {
    path,
    git,
    gitResult,
    async dispose() {
      // Windows refuses to remove a directory while any handle inside it is open, and
      // the service a spec just stopped can still be closing its last one. `rm` retries
      // EBUSY/EPERM/ENOTEMPTY when asked, which is what turns "1 failed" runs that end
      // in `EBUSY: resource busy or locked, rmdir` into clean teardown.
      await rm(scratchRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    },
  };
}
