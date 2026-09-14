/**
 * T10 end to end: stashes and tags through the panels.
 *
 * The two cases that matter are the ones with a failure mode: a drop only happens
 * after an explicit confirm, and a conflicted pop keeps the entry on screen (the
 * operation reports `needsAttention`, and the stash list still holds it).
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
  stop(): Promise<void>;
}

test.describe("stash and tag workbench", () => {
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

  test("stashes working changes and pops them back", async ({ page }) => {
    await repo.write("a.txt", "work to stash\n");
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("stash-panel")).toBeVisible();

    await page.getByLabel("stash message").fill("e2e save");
    await page.getByTestId("create-stash").click();
    await expect(page.getByTestId("stash-message-result")).toContainText(
      /created a stash/,
    );
    // On disk: the worktree is clean again and one stash exists.
    expect(await repo.readText("a.txt")).toEqual("base\n");

    await page.getByTestId("pop-stash-stash@{0}").click();
    await page.getByTestId("pop-stash-stash@{0}-confirm").click();
    await expect(page.getByTestId("stash-message-result")).toContainText(
      /popped stash@\{0\}; the entry was dropped/,
    );
    expect(await repo.readText("a.txt")).toEqual("work to stash\n");
  });

  test("keeps a stash whose pop conflicts", async ({ page }) => {
    await repo.write("a.txt", "stashed\n");
    await repo.git(["stash", "push", "-m", "save"]);
    await repo.write("a.txt", "other\n");
    await repo.commitAll("other");
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("stash-panel")).toBeVisible();

    await page.getByTestId("pop-stash-stash@{0}").click();
    await page.getByTestId("pop-stash-stash@{0}-confirm").click();
    await expect(page.getByTestId("stash-message-result")).toContainText(
      /needsAttention|still there/,
    );
    // The entry is still listed: nothing was dropped.
    await expect(page.getByTestId("stash-list")).toContainText("save");
  });

  test("drops a stash only after the confirm step", async ({ page }) => {
    await repo.write("a.txt", "stashed\n");
    await repo.git(["stash", "push", "-m", "to drop"]);
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("stash-panel")).toBeVisible();

    // Arming the action does not drop anything yet.
    await page.getByTestId("drop-stash-stash@{0}").click();
    await expect(page.getByTestId("stash-list")).toContainText("to drop");
    await page.getByTestId("drop-stash-stash@{0}-confirm").click();
    await expect(page.getByTestId("stash-message-result")).toContainText(
      /dropped stash@\{0\}/,
    );
    await expect(page.getByTestId("stash-list")).toHaveCount(0);
  });

  test("creates and deletes a tag through the panel", async ({ page }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("tag-panel")).toBeVisible();

    await page.getByLabel("tag name").fill("v9.9.9");
    await page.getByLabel("tag annotation").fill("e2e tag\n");
    await page.getByTestId("create-tag").click();
    await expect(page.getByTestId("tag-message-result")).toContainText(
      /created annotated tag v9\.9\.9/,
    );
    const refs = new TextDecoder().decode(
      await repo.git(["for-each-ref", "--format=%(refname)", "refs/tags"]),
    );
    expect(refs).toContain("refs/tags/v9.9.9");

    await page.getByTestId("delete-tag-v9.9.9").click();
    await page.getByTestId("delete-tag-v9.9.9-confirm").click();
    await expect(page.getByTestId("tag-message-result")).toContainText(
      /deleted local tag v9\.9\.9/,
    );
    const after = new TextDecoder().decode(
      await repo.git(["for-each-ref", "--format=%(refname)", "refs/tags"]),
    );
    expect(after).not.toContain("v9.9.9");
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
