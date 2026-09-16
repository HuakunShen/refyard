/**
 * T10 end to end: stashes and tags through the panels.
 *
 * The two cases that matter are the ones with a failure mode: a drop only happens
 * after an explicit confirm, and a conflicted pop keeps the entry on screen (the
 * operation reports `needsAttention`, and the stash list still holds it).
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

interface RunningService {
  readonly pairingUrl: string;
  stop(): Promise<void>;
}

test.describe("stash and tag workbench", () => {
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

  test("keeps a destructive confirmation armed across a transient stash read failure", async ({
    page,
  }) => {
    // Prevents: a background metadata retry unmounting ConfirmAction after the user
    // armed a destructive action, forcing the user to guess whether the first click
    // did anything and making a second click unsafe to reason about.
    await repo.write("a.txt", "stashed\n");
    await repo.git(["stash", "push", "-m", "to keep armed"]);
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("stash-list")).toContainText("to keep armed");

    await page.getByTestId("drop-stash-stash@{0}").click();
    // Stop only after the confirmation is armed. The next background metadata read
    // then fails through the real browser/service boundary, as it did in the long run.
    await service.stop();
    await expect(page.getByText("Could not read stashes")).toBeVisible();
    await expect(
      page.getByTestId("drop-stash-stash@{0}-confirm"),
    ).toBeVisible();
    await expect(page.getByTestId("stash-list")).toContainText("to keep armed");
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
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
