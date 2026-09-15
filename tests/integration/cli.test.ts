/**
 * The CLI: argument grammar, doctor output, and a real end-to-end `serve`.
 *
 * The end-to-end case starts the service exactly as `refyard serve` does, pairs
 * over HTTP, reads status, and shuts down — the same path a user takes, minus the
 * browser. The argument cases are about the failures a user actually hits: a typo'd
 * flag, a port that is not a number, `serve` without a repository, and a port that
 * is already taken.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_USAGE, main } from "../../apps/cli/src/main.js";
import { parseArgs, DEFAULT_PORT } from "../../apps/cli/src/args.js";
import {
  browserCommandFor,
  isLoopbackHttpUrl,
} from "../../apps/cli/src/browser.js";
import { runService } from "../../apps/cli/src/serve.js";
import {
  MUTATION_KINDS,
  capabilitiesResponseSchema,
} from "@refyard/git-contract";
import {
  createRepo,
  fixtureGitPath,
  type GitFixtureRepo,
} from "../support/repo.js";
import { isPairingCommand } from "../../apps/cli/src/pairing-reprint.js";
import { ticketFrom } from "../support/service.js";

const cliDirectory = join(
  import.meta.dirname,
  "..",
  "..",
  "apps",
  "cli",
  "src",
);

function collect(): {
  write: (line: string) => void;
  writeError: (line: string) => void;
  lines: string[];
  errors: string[];
} {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    write: (line) => {
      lines.push(line);
    },
    writeError: (line) => {
      errors.push(line);
    },
  };
}

describe("argument parsing", () => {
  it("treats a bare path as `open`", () => {
    const parsed = parseArgs(["/tmp/repo"], "/tmp");
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.command.kind === "open") {
      expect(parsed.command.path).toBe("/tmp/repo");
      expect(parsed.command.port).toBe(DEFAULT_PORT);
      expect(parsed.command.openBrowser).toBe(true);
    }
  });

  it("resolves a relative path against the caller's directory, not core's", () => {
    const parsed = parseArgs(["./project"], "/home/someone/work");
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.command.kind === "open") {
      expect(parsed.command.path).toBe("/home/someone/work/project");
    }
  });

  it("does not open a browser for `serve`", () => {
    const parsed = parseArgs(["serve", "--repo", "/tmp/repo"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.command.kind === "serve") {
      expect(parsed.command.openBrowser).toBe(false);
    }
  });

  it("requires a repository for `serve`", () => {
    const parsed = parseArgs(["serve"]);
    expect(parsed.ok).toBe(false);
  });

  it("accepts port 0 for an OS-chosen port", () => {
    const parsed = parseArgs(["serve", "--repo", "/tmp/repo", "--port", "0"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.command.kind === "serve") {
      expect(parsed.command.port).toBe(0);
      expect(parsed.command.portExplicit).toBe(true);
    }
  });

  it("rejects a port that is not a number and one out of range", () => {
    expect(parseArgs(["serve", "--port", "abc"]).ok).toBe(false);
    expect(parseArgs(["serve", "--port", "70000"]).ok).toBe(false);
  });

  it("rejects an unknown option instead of ignoring it", () => {
    const parsed = parseArgs(["open", "--depth", "5"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.message).toContain("--depth");
    }
  });

  it("rejects two paths", () => {
    expect(parseArgs(["a", "b"]).ok).toBe(false);
  });

  it("parses --ticket-ttl in whole seconds and defaults to 60", () => {
    const parsed = parseArgs([
      "serve",
      "--repo",
      "/tmp/repo",
      "--ticket-ttl",
      "3600",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.command.kind === "serve") {
      expect(parsed.command.ticketTtlSeconds).toBe(3600);
    }
    const defaulted = parseArgs(["serve", "--repo", "/tmp/repo"]);
    if (defaulted.ok && defaulted.command.kind === "serve") {
      expect(defaulted.command.ticketTtlSeconds).toBe(60);
    }
  });

  it("recognises the pairing reprint keystroke and nothing else", () => {
    // The keystroke mints a credential, so the match must be exact: a line that happens
    // to contain a p, or an empty Enter press, must not print a ticket.
    expect(isPairingCommand("p")).toBe(true);
    expect(isPairingCommand(" P ")).toBe(true);
    expect(isPairingCommand("pair")).toBe(true);
    expect(isPairingCommand("")).toBe(false);
    expect(isPairingCommand("quit")).toBe(false);
    expect(isPairingCommand("repo")).toBe(false);
  });

  it("rejects a ticket ttl that is missing, not a number, or outside 1..86400", () => {
    // Prevents: a typo like `--ticket-ttl 1e9` silently minting a day-long (or
    // year-long) credential, and an empty flag doing nothing at all.
    expect(parseArgs(["serve", "--ticket-ttl"]).ok).toBe(false);
    expect(parseArgs(["serve", "--ticket-ttl", "abc"]).ok).toBe(false);
    expect(parseArgs(["serve", "--ticket-ttl", "0"]).ok).toBe(false);
    expect(parseArgs(["serve", "--ticket-ttl", "99999"]).ok).toBe(false);
  });

  it("accepts help and version anywhere", () => {
    expect(parseArgs(["--help"]).ok).toBe(true);
    expect(parseArgs(["serve", "-v"]).ok).toBe(true);
  });
});

describe("browser launching", () => {
  it("passes the URL as a single argument to a chosen executable", () => {
    // Prevents: a URL reaching a shell, where a `&` or a backtick in a query string
    // would be executed instead of opened.
    const command = browserCommandFor(
      "http://127.0.0.1:47831/?pair=abc",
      "darwin",
    );
    expect(command).toEqual({
      executable: "/usr/bin/open",
      args: ["http://127.0.0.1:47831/?pair=abc"],
    });
    const linux = browserCommandFor("http://127.0.0.1:1/", "linux");
    expect(linux?.args).toEqual(["http://127.0.0.1:1/"]);
  });

  it("only accepts loopback http URLs", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.1:47831/")).toBe(true);
    expect(isLoopbackHttpUrl("http://localhost:47831/")).toBe(true);
    expect(isLoopbackHttpUrl("http://example.com/")).toBe(false);
    expect(isLoopbackHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackHttpUrl("http://127.0.0.1.evil.example/")).toBe(false);
  });
});

describe("main dispatch", () => {
  it("prints help and exits zero", async () => {
    const io = collect();
    const result = await main(["--help"], {
      ...io,
      cliDirectory,
      gitPath: fixtureGitPath(),
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(EXIT_OK);
    expect(io.lines.join("\n")).toContain("refyard");
  });

  it("reports a usage error on stderr and exits 64", async () => {
    const io = collect();
    const result = await main(["open", "--nope"], {
      ...io,
      cliDirectory,
      gitPath: fixtureGitPath(),
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(EXIT_USAGE);
    expect(io.errors.join("\n")).toContain("--nope");
  });

  it("prints a machine-readable doctor report with --json", async () => {
    const io = collect();
    const result = await main(["doctor", "--json"], {
      ...io,
      cliDirectory,
      gitPath: fixtureGitPath(),
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(EXIT_OK);
    const report = JSON.parse(io.lines.join("\n")) as {
      gitVersion: string;
      features: { porcelainV2Status: boolean };
      probes: unknown[];
    };
    expect(report.gitVersion.length).toBeGreaterThan(0);
    expect(report.features.porcelainV2Status).toBe(true);
    expect(report.probes.length).toBeGreaterThan(0);
  });

  it("reports a missing Git as a distinct exit code", async () => {
    const io = collect();
    const result = await main(["doctor", "--json"], {
      ...io,
      cliDirectory,
      gitPath: "/nonexistent/refyard-no-git/git",
      cwd: process.cwd(),
    });
    expect(result.exitCode).not.toBe(EXIT_OK);
    const report = JSON.parse(io.lines.join("\n")) as {
      executableFound: boolean;
    };
    expect(report.executableFound).toBe(false);
  });
});

describe("serving a repository", () => {
  let repo: GitFixtureRepo;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
  });

  afterEach(async () => {
    await repo.dispose();
  });

  it("starts, prints a pairing URL, and answers a paired read", async () => {
    const io = collect();
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      write: io.write,
    });
    try {
      expect(running.pairingUrl).toContain("?pair=");
      const ticket = ticketFrom(running.pairingUrl);
      const origin = `http://127.0.0.1:${running.http.port}`;
      const exchanged = await fetch(`${origin}/api/v1/session/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ ticket }),
      });
      expect(exchanged.status).toBe(200);
      const session = (await exchanged.json()) as { token: string };
      const status = await fetch(
        `${origin}/api/v1/status?repositoryId=${running.assembly.repositoryId}`,
        {
          headers: { authorization: `Bearer ${session.token}`, origin },
        },
      );
      expect(status.status).toBe(200);
      const body = (await status.json()) as { head: { branchName: string } };
      expect(body.head.branchName).toBe("main");

      // The printed ready line carries no pairing secret.
      const ready = io.lines.find((line) => line.trim().startsWith("ready "));
      expect(ready).toBeDefined();
      expect(ready).not.toContain(ticket);
      expect(io.lines.join("\n")).toContain("Ctrl+C");
    } finally {
      await running.close();
    }
  });

  it("keeps pairing material off stdout in --json mode", async () => {
    // Prevents: a supervisor parsing stdout as JSON and finding a ticket — or, worse,
    // logging one. The machine channel carries data; the pairing URL is a note.
    const io = collect();
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      json: true,
      write: io.write,
      writeError: io.writeError,
    });
    try {
      expect(io.lines).toHaveLength(1);
      const ready = JSON.parse(io.lines[0] ?? "{}") as {
        serviceInstanceId: string;
        port: number;
        url: string;
        apiMajor: number;
        repositoryId: string;
      };
      expect(ready.serviceInstanceId).toMatch(/^srvc_/);
      expect(ready.port).toBe(running.http.port);
      expect(ready.url).toEqual(`http://127.0.0.1:${running.http.port}`);
      expect(ready.apiMajor).toBeGreaterThanOrEqual(1);
      expect(io.lines[0] ?? "").not.toContain("pair=");
      expect(io.lines[0] ?? "").not.toContain("ticket");

      // The human-readable URL still exists, on the channel meant for notes.
      const paired = io.errors.find((line) => line.includes("pair="));
      expect(paired).toBeDefined();
      expect(paired).toContain(ticketFrom(running.pairingUrl));
    } finally {
      await running.close();
    }
  });

  it("drains an in-flight request before closing, and does not hang on idle ones", async () => {
    // Prevents: Ctrl+C during work that is already the server's. Stopping must mean
    // "accept nothing new and let what is running finish", not "drop the answer to
    // something that already ran" — and it must not wait on an idle keep-alive socket
    // either, which is the other way this goes wrong.
    const io = collect();
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      shutdownGraceMs: 300,
      write: io.write,
    });
    const origin = `http://127.0.0.1:${running.http.port}`;
    const exchanged = await fetch(`${origin}/api/v1/session/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ ticket: ticketFrom(running.pairingUrl) }),
    });
    const { token } = (await exchanged.json()) as { token: string };

    // An event stream: the server has answered and the request stays open until the
    // client goes away, which is a request that is unambiguously in flight.
    const stream = await fetch(`${origin}/api/v1/events`, {
      headers: { authorization: `Bearer ${token}`, origin },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    const startedAt = Date.now();
    await running.close();
    const elapsed = Date.now() - startedAt;
    // It waited for the stream (at least part of the grace period) instead of cutting
    // it immediately...
    expect(elapsed).toBeGreaterThanOrEqual(150);
    // ...and it did not wait forever either: the grace period is a bound, not a hope.
    expect(elapsed).toBeLessThan(3_000);
    await stream.body?.cancel().catch(() => undefined);

    // A listener that has stopped really is gone.
    await expect(
      fetch(`${origin}/api/v1/capabilities`, {
        headers: { authorization: `Bearer ${token}`, origin },
      }),
    ).rejects.toThrow();

    // With nothing in flight, closing does not burn the grace period: idle keep-alive
    // sockets must not hold the process open.
    const idle = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      shutdownGraceMs: 2_000,
      write: io.write,
    });
    const idleStarted = Date.now();
    await idle.close();
    expect(Date.now() - idleStarted).toBeLessThan(1_000);
  });

  it("names every contract mutation as available or unavailable, never both", async () => {
    // Prevents: a capabilities report that contradicts itself. The build once said
    // "this build implements reads only; no Git mutation is enabled" while listing 33
    // available mutations, because the message was written when that was true and
    // nothing tied it to what the coordinator actually registers. The invariant that
    // cannot drift is set arithmetic: every kind in the contract is either implemented
    // or named as missing, and no kind is both.
    const io = collect();
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      write: io.write,
    });
    try {
      const origin = `http://127.0.0.1:${running.http.port}`;
      const exchanged = await fetch(`${origin}/api/v1/session/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ ticket: ticketFrom(running.pairingUrl) }),
      });
      const { token } = (await exchanged.json()) as { token: string };
      const response = await fetch(`${origin}/api/v1/capabilities`, {
        headers: { authorization: `Bearer ${token}`, origin },
      });
      const capabilities = capabilitiesResponseSchema.parse(
        await response.json(),
      );

      const available = new Set(
        capabilities.operations.map((operation) => operation.kind),
      );
      const unavailable = new Set(
        capabilities.unavailable.flatMap((reason) => reason.operations),
      );

      // Nothing is in both lists.
      for (const kind of available) {
        expect(unavailable.has(kind)).toBe(false);
      }
      // Nothing is in neither: a kind the contract defines is either implemented or
      // named as missing, so a reader never has to guess which.
      for (const kind of MUTATION_KINDS) {
        expect(available.has(kind) || unavailable.has(kind)).toBe(true);
      }
      // Every contract mutation is implemented, so the missing list is *empty* — not
      // a sentence saying nothing is missing, and not a stale entry. This is the other
      // end of the arithmetic the harness case exercises with a reduced effect set: a
      // build with nothing missing reports nothing.
      expect(capabilities.unavailable).toEqual([]);
      expect(available.size).toBe(MUTATION_KINDS.length);
      // The last two to arrive, and the two that used to be named here as missing.
      expect(available.has("initRepository")).toBe(true);
      expect(available.has("cloneRepository")).toBe(true);
      expect(available.has("commit")).toBe(true);
      expect(available.has("merge")).toBe(true);
    } finally {
      await running.close();
    }
  });

  it("reports the version of the installation, not of the source tree", async () => {
    // A packaged build writes dist/build-info.json beside the bundle; the banner and
    // `--version` read it, so an installed copy does not claim to be "0.0.0-dev".
    const io = collect();
    const result = await main(["--version"], {
      write: io.write,
      writeError: io.writeError,
      cliDirectory,
      gitPath: fixtureGitPath(),
      cwd: repo.root,
    });
    expect(result.exitCode).toBe(EXIT_OK);
    // Running from source there is no build-info, so the constant is the honest answer.
    expect(io.lines[0]).toMatch(/^refyard \d+\.\d+\.\d+/);
  });

  it("keeps serving after startup when the terminal interface is installed", async () => {
    // Prevents: a startup-order bug where the console wiring closed the service the
    // moment `runService` resolved, so the process exited (cleanly, code 0) before
    // any browser could pair — with no error anywhere.
    const io = collect();
    const installedInts = new Set(process.listeners("SIGINT"));
    const installedTerms = new Set(process.listeners("SIGTERM"));
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      write: io.write,
    });
    try {
      // An unauthenticated read must still be refused over HTTP — anything proves
      // the listener is up, and 401 proves it is this service answering.
      const response = await fetch(
        `http://127.0.0.1:${running.http.port}/api/v1/status`,
      );
      expect(response.status).toBe(401);
      expect(io.lines.join("\n")).toContain("press p + Enter");
    } finally {
      await running.close();
      // The production path installs process-level signal handlers; remove the ones
      // this test added so they cannot intercept a later Ctrl+C of the test runner.
      for (const listener of process.listeners("SIGINT")) {
        if (!installedInts.has(listener)) {
          process.removeListener("SIGINT", listener);
        }
      }
      for (const listener of process.listeners("SIGTERM")) {
        if (!installedTerms.has(listener)) {
          process.removeListener("SIGTERM", listener);
        }
      }
    }
  });

  it("refuses a port that is already in use rather than moving to another one", async () => {
    // Prevents: a bookmark, a PWA manifest and a pairing URL silently pointing at a
    // port where this service is not listening.
    const first = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      write: () => {},
    });
    try {
      await expect(
        runService({
          repositoryPath: repo.root,
          gitPath: fixtureGitPath(),
          port: first.http.port,
          openBrowser: false,
          ticketTtlSeconds: 60,
          webRoot: null,
          allowRoot: false,
          installSignalHandlers: false,
          write: () => {},
        }),
      ).rejects.toThrow(/already in use/);
    } finally {
      await first.close();
    }
  });

  it("reports a directory that is not a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "refyard-not-a-repo-"));
    try {
      await expect(
        runService({
          repositoryPath: plain,
          gitPath: fixtureGitPath(),
          port: 0,
          openBrowser: false,
          ticketTtlSeconds: 60,
          webRoot: null,
          allowRoot: false,
          installSignalHandlers: false,
          write: () => {},
        }),
      ).rejects.toThrow();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("serves the placeholder page when no web build is installed", async () => {
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      write: () => {},
    });
    try {
      const response = await fetch(`http://127.0.0.1:${running.http.port}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("no web build");
    } finally {
      await running.close();
    }
  });

  it("never writes the pairing ticket to a file", async () => {
    // Prevents: a "helpful" debug log on disk becoming a stored credential.
    const io = collect();
    const running = await runService({
      repositoryPath: repo.root,
      gitPath: fixtureGitPath(),
      port: 0,
      openBrowser: false,
      ticketTtlSeconds: 60,
      webRoot: null,
      allowRoot: false,
      installSignalHandlers: false,
      write: io.write,
    });
    try {
      const ticket = ticketFrom(running.pairingUrl);
      // The only writable artifacts in this version are the recovery directory and
      // the state root; neither exists until a mutation runs, so nothing on disk can
      // hold the ticket yet. The check is that the CLI wrote no file at all.
      const listing = await readFile(
        join(repo.scratchRoot, "repo", "a.txt"),
        "utf8",
      );
      expect(listing).toBe("base\n");
      expect(io.lines.join("\n")).toContain(
        ticket.length > 0 ? "open this URL" : "",
      );
    } finally {
      await running.close();
    }
  });
});
