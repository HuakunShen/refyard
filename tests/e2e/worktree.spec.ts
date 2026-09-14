/**
 * T11 end to end: worktrees through the panel.
 *
 * The cases are the two that a wrong implementation gets wrong in a way a user would
 * feel: a linked worktree must appear on disk at the approved destination after the
 * panel says it was created, and the primary worktree must have no remove control at
 * all — Git refuses that removal, so a button for it would only ever fail.
 */
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLI_BUNDLE = join(REPO_ROOT, ".refyard-dev", "cli.mjs");

interface RunningService {
  readonly pairingUrl: string;
  stop(): Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test.describe("worktree workbench", () => {
  let repo: GitFixtureRepo;
  let service: RunningService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo.root);
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("creates a linked worktree and removes it after a confirm", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("worktree-panel")).toBeVisible();

    await page.getByLabel("worktree destination").fill("linked-tree");
    await page.getByLabel("worktree new branch").fill("linked-tree");
    await page.getByTestId("create-worktree").click();
    await expect(page.getByTestId("worktree-message-result")).toContainText(
      /created worktree at/,
    );
    // The checkout exists on disk with the repository's content, not just in the list.
    expect(await repo.readText("linked-tree/a.txt")).toEqual("base\n");

    const list = page.getByTestId("worktree-list");
    await expect(list).toContainText("linked-tree");
    const branch = new TextDecoder().decode(
      await repo.git(["branch", "--list", "linked-tree"]),
    );
    expect(branch).toContain("linked-tree");

    // Removing it is two steps, and the first one removes nothing.
    const remove = page.getByTestId(/^remove-worktree-wt_\w+$/);
    await remove.click();
    expect(await exists(join(repo.root, "linked-tree"))).toBe(true);
    await page.getByTestId(/^remove-worktree-wt_\w+-confirm$/).click();
    await expect(page.getByTestId("worktree-message-result")).toContainText(
      /removed worktree at/,
    );
    expect(await exists(join(repo.root, "linked-tree"))).toBe(false);
  });

  test("offers no remove control for the primary worktree", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("worktree-panel")).toBeVisible();
    await expect(page.getByTestId("worktree-list")).toContainText("primary");
    // Git refuses to remove the primary worktree, and the panel does not pretend
    // otherwise: with only that worktree on screen there is nothing to remove.
    await expect(page.getByTestId(/^remove-worktree-/)).toHaveCount(0);
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
async function startService(repositoryPath: string): Promise<RunningService> {
  const child = spawn(
    process.execPath,
    [CLI_BUNDLE, "serve", "--no-open", "--port", "0", "--repo", repositoryPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const collect = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const deadline = Date.now() + 30_000;
  for (;;) {
    const match = /http:\/\/127\.0\.0\.1:\d+\/[?#]pair=[A-Za-z0-9_-]+/.exec(
      output,
    );
    if (match !== null) {
      const pairingUrl = match[0];
      return {
        pairingUrl,
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
    if (Date.now() > deadline) {
      throw new Error(`the service never printed a pairing URL:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
