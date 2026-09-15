/**
 * T14 end to end: a bookmark pointing at a service that is not the one this tab paired with.
 *
 * The address is a preference, so this is the ordinary case, not an exotic one: the user
 * started refyard again, or started a second copy, or the port is now answering for
 * something else entirely. The dangerous behaviour is quiet reuse of a token that belongs
 * to another service — every read then fails as if the app were broken, and a write could
 * be answered by a service the user never intended to talk to.
 *
 * The spec drives the real scenario: pair with one service, replace it with another on the
 * *same address*, reload, and require the page to notice and ask for a new pairing.
 */
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLI_BUNDLE = join(REPO_ROOT, ".refyard-dev", "cli.mjs");

interface RunningService {
  readonly pairingUrl: string;
  readonly origin: string;
  readonly port: number;
  readonly instanceId: string;
  stop(): Promise<void>;
}

test.describe("a service that is not the one we paired with", () => {
  let repo: GitFixtureRepo;
  let first: RunningService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    first = await startService(repo.root, 0);
  });

  test.afterEach(async () => {
    await first.stop();
    await repo.dispose();
  });

  test("requires a new pairing when the instance behind the address changed", async ({
    page,
  }) => {
    await page.goto(first.pairingUrl);
    await expect(page.getByTestId("staging-panel")).toBeVisible();

    const paired = await page.evaluate(
      "sessionStorage.getItem('refyard.session.instance')",
    );
    expect(paired).toEqual(first.instanceId);

    // Same address, different service: the first one is gone and a second copy of
    // refyard is answering on the port its bookmark names.
    await first.stop();
    const second = await startService(repo.root, first.port);
    try {
      expect(second.instanceId).not.toEqual(first.instanceId);
      await page.reload();
      // The page notices: the stored token is gone and pairing is asked for again.
      await expect
        .poll(async () =>
          page.evaluate("sessionStorage.getItem('refyard.session.token')"),
        )
        .toBeNull();
      await expect(page.getByLabel("Pairing ticket")).toBeVisible();
      // And nothing is offered to write with.
      await expect(page.getByTestId("staging-panel")).toHaveCount(0);

      // Pairing with the new service works, which is what makes the refusal recoverable
      // rather than a dead end.
      await page.getByLabel("Pairing ticket").fill(second.pairingUrl);
      await page.getByRole("button", { name: "Pair" }).click();
      await expect(page.getByTestId("staging-panel")).toBeVisible();
      const nowPaired = await page.evaluate(
        "sessionStorage.getItem('refyard.session.instance')",
      );
      expect(nowPaired).toEqual(second.instanceId);
    } finally {
      await second.stop();
    }
  });
});

/** Start the CLI bundle against one repository; `port` 0 asks the OS for a free one. */
async function startService(
  repositoryPath: string,
  port: number,
): Promise<RunningService> {
  const child = spawn(
    process.execPath,
    [
      CLI_BUNDLE,
      "serve",
      "--no-open",
      "--port",
      String(port),
      "--repo",
      repositoryPath,
      "--json",
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  const collect = (chunk: Buffer): void => {
    stdout += chunk.toString("utf8");
  };
  child.stdout.on("data", collect);

  const deadline = Date.now() + 30_000;
  for (;;) {
    const line = stdout
      .split("\n")
      .find((candidate) => candidate.trim().startsWith("{"));
    if (line !== undefined) {
      const ready = JSON.parse(line) as {
        serviceInstanceId: string;
        port: number;
        url: string;
      };
      // The pairing URL is on stderr in `--json` mode; read it from the human channel
      // rather than inventing one for the test.
      const ticket = await pairingTicket(child);
      return {
        pairingUrl: `${ready.url}/?pair=${ticket}`,
        origin: ready.url,
        port: ready.port,
        instanceId: ready.serviceInstanceId,
        async stop(): Promise<void> {
          if (child.exitCode !== null || child.signalCode !== null) {
            return;
          }
          const exited = new Promise<void>((resolve) => {
            child.once("exit", () => {
              resolve();
            });
          });
          child.kill("SIGTERM");
          await exited;
        },
      };
    }
    if (child.exitCode !== null) {
      throw new Error(`the service exited with ${child.exitCode}`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the service never printed its readiness object:\n${stdout}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The pairing URL the service wrote to stderr, by the time readiness is printed. */
async function pairingTicket(child: ReturnType<typeof spawn>): Promise<string> {
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const match = /pair=([A-Za-z0-9_-]+)/.exec(stderr);
    if (match !== null && match[1] !== undefined) {
      return match[1];
    }
    if (Date.now() > deadline) {
      throw new Error(`the service never printed a pairing URL:\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
