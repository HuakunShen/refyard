#!/usr/bin/env bun
/**
 * The real-server fixture for the SSH provider: a container running sshd and git, and
 * nothing else.
 *
 * The point of this fixture is to make "the reads work over SSH with nothing installed on
 * the remote host" a measurement rather than a claim. The image carries OpenSSH, Git and a
 * POSIX shell; it carries no Refyard artifact, no JavaScript runtime, and no language
 * runtime of any kind. The host side of the fixture is this script: it generates a host
 * key and a client key locally, builds the client's `known_hosts` from the public key it
 * just generated (never `ssh-keyscan`, whose whole meaning is trusting whatever answered),
 * writes a scratch `HOME` holding the client's `config`, `known_hosts` and key, and seeds a
 * repository with tracked, modified and untracked files.
 *
 *   bun scripts/native-ssh-fixture.ts start    # build, run, seed, write state.json
 *   bun scripts/native-ssh-fixture.ts status   # what is running, and where
 *   bun scripts/native-ssh-fixture.ts stop     # remove the container and its network
 *
 * `start` is safe to run twice: it replaces its own container and rewrites the scratch
 * home, and the keys it generated are reused so the known_hosts entry keeps matching. It
 * never touches the developer's `~/.ssh`, and it never writes to a repository outside its
 * own state directory under `target/`. The Docker network is private to this fixture and
 * the host port is ephemeral and bound to 127.0.0.1.
 *
 * State (keys, scratch home, seed files, `state.json`) lives in
 * `target/native-ssh-fixture/` unless `REFYARD_SSH_FIXTURE_STATE` names another
 * directory; the ignored tests in `crates/refyard-host/tests/ssh_exec.rs` read
 * `state.json` from the same place.
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = join(repoRoot, "tests", "native", "ssh-fixture");
const stateDir =
  process.env.REFYARD_SSH_FIXTURE_STATE ??
  join(repoRoot, "target", "native-ssh-fixture");

const image = "refyard-native-ssh-fixture:local";
const container = "refyard-native-ssh-fixture";
const network = "refyard-native-ssh-fixture-net";
const alias = "refyard-ssh-fixture";
const remoteUser = "gituser";
// Deliberately not a plain path: every remote command this fixture runs has to survive the
// quoting layer, so a space, an apostrophe and a non-ASCII character are part of the test.
const remoteRepo = "/srv/refyard fixture's rëpo";
const hostKeyDir = join(stateDir, "host-keys");
const hostKeyPath = join(hostKeyDir, "ssh_host_ed25519_key");
const clientKeyPath = (home: string) => join(home, ".ssh", "id_ed25519");
const homeDir = join(stateDir, "home");
const localRepoPath = join(stateDir, "repo-local");
const statePath = join(stateDir, "state.json");

/** The committed state the fixture repository starts from. */
const firstCommitDate = "2026-01-02T03:04:05+00:00";
const secondCommitDate = "2026-01-03T03:04:05+00:00";

type RunResult = { code: number; stdout: string; stderr: string };

/** Runs one program with an argument vector. No shell is involved on either side. */
async function run(
  argv: string[],
  options: {
    input?: Uint8Array;
    env?: Record<string, string>;
    /** Pass the child's output through instead of capturing it, for long steps. */
    stream?: boolean;
  } = {},
): Promise<RunResult> {
  if (options.stream === true) {
    const child = Bun.spawn(argv, {
      stdin: options.input === undefined ? "ignore" : new Blob([options.input]),
      stdout: "inherit",
      stderr: "inherit",
      env: options.env ?? (process.env as Record<string, string>),
    });
    return { code: await child.exited, stdout: "", stderr: "" };
  }
  const child = Bun.spawn(argv, {
    stdin: options.input === undefined ? "ignore" : new Blob([options.input]),
    stdout: "pipe",
    stderr: "pipe",
    env: options.env ?? (process.env as Record<string, string>),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  return { code, stdout, stderr };
}

/** The same, refusing to continue when the program fails. */
async function must(
  argv: string[],
  options: {
    input?: Uint8Array;
    env?: Record<string, string>;
    stream?: boolean;
  } = {},
): Promise<RunResult> {
  const result = await run(argv, options);
  if (result.code !== 0) {
    throw new Error(
      `${argv[0]} ${argv.slice(1).join(" ")} exited with ${result.code}\n${result.stderr.trim()}`,
    );
  }
  return result;
}

/** The container's git, as the remote user, with a fixed identity and commit date. */
async function remoteGit(
  args: string[],
  options: { date?: string } = {},
): Promise<void> {
  const argv = ["docker", "exec", "-u", remoteUser];
  if (options.date !== undefined) {
    argv.push(
      "-e",
      `GIT_AUTHOR_DATE=${options.date}`,
      "-e",
      `GIT_COMMITTER_DATE=${options.date}`,
    );
  }
  argv.push(container, "git", "-C", remoteRepo, ...args);
  await must(argv);
}

/**
 * The environment the client's own `ssh` runs with.
 *
 * `HOME` points at the fixture's scratch directory as well, but it is *not* what isolates
 * the client: OpenSSH takes the config, known_hosts and key from the passwd entry for the
 * uid. The isolation is the explicit `-F` and the absolute paths inside that file.
 */
function clientEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: homeDir,
    LANG: process.env.LANG ?? "C.UTF-8",
    TERM: "dumb",
  };
}

/** Generates an ed25519 key pair if the path does not already hold one. */
async function ensureKey(path: string, comment: string): Promise<void> {
  if (existsSync(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await must([
    "ssh-keygen",
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    comment,
    "-f",
    path,
  ]);
}

/** Writes one seed file under the state directory. */
async function seedFile(
  stage: string,
  relative: string,
  content: Uint8Array | string,
) {
  const path = join(stateDir, "seed", stage, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Stages the three states of the fixture repository: initial commit, second commit, worktree. */
async function writeSeed(): Promise<void> {
  await rm(join(stateDir, "seed"), { recursive: true, force: true });

  await seedFile(
    "stage-1",
    "README.md",
    "# Fixture repository\n\nRead over SSH.\n",
  );
  await seedFile("stage-1", "a.txt", "alpha\nbeta\n");
  await seedFile(
    "stage-1",
    "data/b.bin",
    Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x0a, 0x0d, 0x7f,
    ]),
  );
  // Names are chosen so their bytes survive the trip through this host's filesystem
  // unchanged: an apostrophe, spaces and a non-ASCII name with no canonical
  // decomposition. A name whose bytes macOS may normalise (an `é`, say) would make the
  // remote and local repositories disagree about a path the tests never meant to vary.
  await seedFile(
    "stage-1",
    "weird 'quoted' name.txt",
    "punctuation survives transport\n",
  );
  await seedFile(
    "stage-1",
    "日本語のメモ.txt",
    "no combining characters here\n",
  );

  await seedFile(
    "stage-2",
    "README.md",
    "# Fixture repository\n\nRead over SSH.\n\nSecond commit.\n",
  );
  await seedFile("stage-2", "docs/notes.md", "- one\n- two\n");

  // The worktree state is what the reads are diffed against: one tracked file modified,
  // one tracked file with punctuation in its name modified, one untracked file.
  await seedFile("worktree", "a.txt", "alpha\nbeta\ngamma\n");
  await seedFile(
    "worktree",
    "weird 'quoted' name.txt",
    "punctuation survives transport twice\n",
  );
  await seedFile("worktree", "untracked file.txt", "not committed\n");
}

/** Copies one seed stage into the running container's repository. */
async function copySeed(stage: string): Promise<void> {
  await must([
    "docker",
    "cp",
    `${join(stateDir, "seed", stage)}/.`,
    `${container}:${remoteRepo}`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chown",
    "-R",
    `${remoteUser}:${remoteUser}`,
    remoteRepo,
  ]);
}

/** Waits until the fixture's own sshd answers a real connection through the fixture config. */
async function waitForSshd(
  configPath: string,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  let last = "no attempt made";
  while (Date.now() - started < timeoutMs) {
    const result = await run(
      ["ssh", "-F", configPath, "-o", "ConnectTimeout=3", alias, "true"],
      {
        env: clientEnvironment(),
      },
    );
    if (result.code === 0) return;
    last = result.stderr.trim().split("\n")[0] ?? "";
    await Bun.sleep(250);
  }
  throw new Error(
    `the fixture sshd did not answer within ${timeoutMs} ms: ${last}`,
  );
}

/** Refuses to continue when Docker is not usable, with the daemon's own words. */
async function requireDocker(): Promise<void> {
  const result = await run([
    "docker",
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  if (result.code !== 0) {
    throw new Error(
      `Docker is not available, so the SSH fixture cannot run:\n${result.stderr.trim()}`,
    );
  }
}

async function start(): Promise<void> {
  await requireDocker();
  await mkdir(hostKeyDir, { recursive: true });
  await mkdir(join(homeDir, ".ssh"), { recursive: true, mode: 0o700 });
  await mkdir(localRepoPath, { recursive: true });
  await ensureKey(hostKeyPath, "refyard ssh fixture host key");
  await ensureKey(clientKeyPath(homeDir), "refyard ssh fixture client key");
  await writeSeed();

  // One private network for this fixture; a port is published on 127.0.0.1 only, and the
  // host side of the port is ephemeral so two checkouts cannot collide.
  const existingNetwork = await run(["docker", "network", "inspect", network]);
  if (existingNetwork.code !== 0) {
    await must(["docker", "network", "create", network]);
  }
  await must(["docker", "rm", "-f", container]);
  await must(
    [
      "docker",
      "build",
      "-t",
      image,
      "-f",
      join(fixtureRoot, "Dockerfile"),
      fixtureRoot,
    ],
    {
      stream: true,
    },
  );
  await must([
    "docker",
    "run",
    "-d",
    "--name",
    container,
    "--network",
    network,
    "-p",
    "127.0.0.1::22",
    image,
  ]);

  const published = await must(["docker", "port", container, "22/tcp"]);
  const portText = published.stdout.trim().split("\n")[0] ?? "";
  const port = Number(portText.split(":").pop());
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `could not read the published port from ${JSON.stringify(portText)}`,
    );
  }

  // The host key was generated here, so the container is given it after start — and the
  // client's known_hosts is written from the same public key before any connection exists.
  const hostPublicKey = (await readFile(`${hostKeyPath}.pub`, "utf8"))
    .trim()
    .split(/\s+/);
  const knownHostsPath = join(homeDir, ".ssh", "known_hosts");
  await writeFile(
    knownHostsPath,
    `[127.0.0.1]:${port} ${hostPublicKey[0]} ${hostPublicKey[1]}\n`,
  );
  await chmod(knownHostsPath, 0o600);

  const configPath = join(homeDir, ".ssh", "config");
  await writeFile(
    configPath,
    [
      "# Written by scripts/native-ssh-fixture.ts. This file belongs to the fixture, and the",
      "# provider is pointed at it explicitly with `-F`: OpenSSH resolves ~/.ssh/config,",
      "# ~/.ssh/known_hosts and ~ inside option values from the passwd entry for the uid, not",
      "# from HOME, so a scratch HOME would still have read the developer's own files. The",
      "# paths below are absolute for the same reason: `~` would expand to the wrong home.",
      `Host ${alias}`,
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      `  User ${remoteUser}`,
      `  IdentityFile ${clientKeyPath(homeDir)}`,
      "  IdentitiesOnly yes",
      `  UserKnownHostsFile ${knownHostsPath}`,
      "  StrictHostKeyChecking yes",
      "",
    ].join("\n"),
  );
  await chmod(join(homeDir, ".ssh"), 0o700);
  await chmod(clientKeyPath(homeDir), 0o600);

  await must([
    "docker",
    "cp",
    hostKeyPath,
    `${container}:/etc/ssh/ssh_host_ed25519_key`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chown",
    "root:root",
    "/etc/ssh/ssh_host_ed25519_key",
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chmod",
    "600",
    "/etc/ssh/ssh_host_ed25519_key",
  ]);

  await must([
    "docker",
    "cp",
    `${clientKeyPath(homeDir)}.pub`,
    `${container}:/tmp/refyard_fixture_key.pub`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "mkdir",
    "-p",
    `/home/${remoteUser}/.ssh`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "cp",
    "/tmp/refyard_fixture_key.pub",
    `/home/${remoteUser}/.ssh/authorized_keys`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chown",
    "-R",
    `${remoteUser}:${remoteUser}`,
    `/home/${remoteUser}/.ssh`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chmod",
    "700",
    `/home/${remoteUser}/.ssh`,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chmod",
    "600",
    `/home/${remoteUser}/.ssh/authorized_keys`,
  ]);
  // The public key travelled through /tmp because that is how docker cp stages a file.
  // Nothing of the fixture's is left behind in the container beyond the authorised key.
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "rm",
    "-f",
    "/tmp/refyard_fixture_key.pub",
  ]);

  await waitForSshd(configPath, 30_000);

  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "mkdir",
    "-p",
    remoteRepo,
  ]);
  await must([
    "docker",
    "exec",
    "-u",
    "root",
    container,
    "chown",
    "-R",
    `${remoteUser}:${remoteUser}`,
    "/srv",
  ]);
  await copySeed("stage-1");
  await remoteGit(["init", "-q", "-b", "main"]);
  await remoteGit(["config", "user.name", "Refyard Fixture"]);
  await remoteGit(["config", "user.email", "fixture@refyard.invalid"]);
  await remoteGit(["add", "-A"]);
  await remoteGit(["commit", "-q", "-m", "fixture: initial content"], {
    date: firstCommitDate,
  });
  await copySeed("stage-2");
  await remoteGit(["add", "-A"]);
  await remoteGit(["commit", "-q", "-m", "fixture: second content"], {
    date: secondCommitDate,
  });
  await copySeed("worktree");

  // A byte-for-byte copy of the repository the reads run against on the far side. The
  // SSH tests run the same plans locally over this copy, so a difference in the bytes is a
  // difference the transport made, not a difference in repository state.
  await rm(localRepoPath, { recursive: true, force: true });
  await mkdir(localRepoPath, { recursive: true });
  await must(["docker", "cp", `${container}:${remoteRepo}/.`, localRepoPath]);

  const state = {
    container,
    network,
    image,
    alias,
    host: "127.0.0.1",
    port,
    user: remoteUser,
    home: homeDir,
    config_file: configPath,
    repo_path: remoteRepo,
    local_repo_path: localRepoPath,
    known_hosts: knownHostsPath,
    host_key_public: `${hostKeyPath}.pub`,
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const runtime = await run([
    "docker",
    "exec",
    container,
    "sh",
    "-c",
    "command -v node bun deno refyard; echo none",
  ]);

  console.log(`fixture up: ${container} (image ${image}, network ${network})`);
  console.log(`  alias:          ${alias}`);
  console.log(`  host:port:      127.0.0.1:${port}`);
  console.log(`  client HOME:    ${homeDir}`);
  console.log(`  remote repo:    ${remoteRepo}`);
  console.log(`  local copy:     ${localRepoPath}`);
  console.log(`  state:          ${statePath}`);
  console.log(`  remote runtimes: ${runtime.stdout.trim()}`);
  console.log("");
  console.log("next:");
  console.log(
    "  cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1",
  );
  console.log("  bun scripts/native-ssh-fixture.ts stop");
}

async function stop(): Promise<void> {
  const removed = await run(["docker", "rm", "-f", container]);
  const networkRemoved = await run(["docker", "network", "rm", network]);
  console.log(
    removed.code === 0
      ? `removed container ${container}`
      : `no container ${container} to remove`,
  );
  console.log(
    networkRemoved.code === 0
      ? `removed network ${network}`
      : `no network ${network} to remove`,
  );
  console.log(
    `kept ${stateDir} (keys, scratch home, local copy); start reuses them`,
  );
}

async function status(): Promise<void> {
  const running = await run([
    "docker",
    "inspect",
    "-f",
    "{{.State.Running}}",
    container,
  ]);
  console.log(
    running.code === 0
      ? `container ${container}: ${running.stdout.trim() === "true" ? "running" : "stopped"}`
      : `container ${container}: absent`,
  );
  const port = await run(["docker", "port", container, "22/tcp"]);
  if (port.code === 0) console.log(`port: ${port.stdout.trim()}`);
  const state = await readFile(statePath, "utf8").catch(() => undefined);
  console.log(
    state === undefined
      ? `state: ${statePath} does not exist`
      : `state: ${state}`,
  );
}

const command = Bun.argv[2] ?? "";
try {
  if (command === "start") {
    await start();
  } else if (command === "stop") {
    await stop();
  } else if (command === "status") {
    await status();
  } else {
    console.error("usage: bun scripts/native-ssh-fixture.ts start|stop|status");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
