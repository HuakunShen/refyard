/**
 * T11 end to end: worktrees through the panel.
 *
 * The cases are the two that a wrong implementation gets wrong in a way a user would
 * feel: a linked worktree must appear on disk at the approved destination after the
 * panel says it was created, and the primary worktree must have no remove control at
 * all — Git refuses that removal, so a button for it would only ever fail.
 */
import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

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
    service = await startService(repo);
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
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
