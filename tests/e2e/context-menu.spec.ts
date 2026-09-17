import { expect, test } from "@playwright/test";
import {
  createBareRemote,
  createRepo,
  type GitFixtureRepo,
} from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("Git context menus", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let historicalOid: string;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    historicalOid = await repo.headOid();
    await repo.write("a.txt", "second\n");
    await repo.commitAll("second");
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("creates refs and copies the SHA from a commit context menu", async ({
    page,
    context,
  }) => {
    await page.goto(service.pairingUrl);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    const menu = page.getByTestId(`commit-context-${historicalOid}`);
    await expect(menu).toBeVisible();
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-create-branch`),
    ).toHaveText("Create Branch Here…");
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-create-tag`),
    ).toHaveText("Create Tag Here…");
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-copy-sha`),
    ).toHaveText("Copy SHA");

    await page
      .getByTestId(`commit-context-${historicalOid}-create-branch`)
      .click();
    await page.getByTestId("commit-ref-name").fill("from-historical");
    await page.getByTestId("commit-ref-submit").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /created branch from-historical/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/heads/from-historical"]))
        .trim(),
    ).toBe(historicalOid);

    await row.click({ button: "right" });
    await page
      .getByTestId(`commit-context-${historicalOid}-create-tag`)
      .click();
    await page.getByTestId("commit-ref-name").fill("historical-tag");
    await page
      .getByTestId("commit-ref-annotation")
      .fill("created from the commit menu");
    await page.getByTestId("commit-ref-submit").click();
    await expect(page.getByTestId("tag-message-result")).toContainText(
      /created (annotated )?tag historical-tag/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/tags/historical-tag^{}"]))
        .trim(),
    ).toBe(historicalOid);

    await row.click({ button: "right" });
    await page.getByTestId(`commit-context-${historicalOid}-copy-sha`).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            navigator as unknown as {
              clipboard: { readText(): Promise<string> };
            }
          ).clipboard.readText(),
        ),
      )
      .toBe(historicalOid);
  });

  test("offers branch actions by branch state and confirms deletion", async ({
    page,
  }) => {
    const topicOid = await repo.headOid();
    await repo.git(["branch", "topic-menu"]);
    await page.goto(service.pairingUrl);
    await page.getByTestId("workbench-nav-branches").click();

    const current = page.getByTestId("branch-row-main");
    await current.click({ button: "right" });
    await expect(
      page.getByTestId("branch-context-main-upstream"),
    ).toBeVisible();
    await expect(page.getByTestId("branch-context-main-rename")).toBeVisible();
    await expect(page.getByTestId("branch-context-main-switch")).toHaveCount(0);
    await expect(page.getByTestId("branch-context-main-merge")).toHaveCount(0);
    await expect(page.getByTestId("branch-context-main-delete")).toHaveCount(0);

    const topic = page.getByTestId("branch-row-topic-menu");
    await topic.click({ button: "right" });
    await expect(
      page.getByTestId("branch-context-topic-menu-switch"),
    ).toBeVisible();
    await expect(
      page.getByTestId("branch-context-topic-menu-merge"),
    ).toBeVisible();
    await expect(
      page.getByTestId("branch-context-topic-menu-delete"),
    ).toBeVisible();
    await page.getByTestId("branch-context-topic-menu-rename").click();

    await page.getByLabel("new name for topic-menu").fill("renamed-menu");
    await page.getByTestId("save-rename-topic-menu").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /renamed topic-menu to renamed-menu/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/heads/renamed-menu"]))
        .trim(),
    ).toBe(topicOid);

    const renamed = page.getByTestId("branch-row-renamed-menu");
    await renamed.click({ button: "right" });
    await page.getByTestId("branch-context-renamed-menu-delete").click();
    await expect(page.getByTestId("branch-delete-dialog")).toBeVisible();
    expect(
      new TextDecoder()
        .decode(await repo.git(["branch", "--list", "renamed-menu"]))
        .trim(),
    ).toBe("renamed-menu");
    await page.getByTestId("branch-delete-dialog-confirm").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /deleted branch renamed-menu/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["branch", "--list", "renamed-menu"]))
        .trim(),
    ).toBe("");
  });
  test("stages, unstages and confirms discard from a path context menu", async ({
    page,
  }) => {
    await repo.write("a.txt", "working-copy-change\n");
    await page.goto(service.pairingUrl);

    const pathRow = page
      .locator('[data-testid^="unstaged-row-"], [data-testid^="staged-row-"]')
      .filter({ hasText: "a.txt" });
    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    const pathMenu = page.getByRole("menu");
    await expect(pathMenu.getByText("Stage", { exact: true })).toBeVisible();
    await pathMenu.getByText("Stage", { exact: true }).click();
    await expect
      .poll(async () =>
        new TextDecoder()
          .decode(await repo.git(["diff", "--cached", "--name-only"]))
          .trim(),
      )
      .toContain("a.txt");

    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    await expect(
      page.getByRole("menu").getByText("Unstage", { exact: true }),
    ).toBeVisible();
    await page.getByRole("menu").getByText("Unstage", { exact: true }).click();
    await expect
      .poll(async () =>
        new TextDecoder()
          .decode(await repo.git(["diff", "--cached", "--name-only"]))
          .trim(),
      )
      .not.toContain("a.txt");

    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    await page.getByRole("menu").getByText("Discard…", { exact: true }).click();
    await expect(page.getByTestId("working-copy-discard-dialog")).toBeVisible();
    expect(await repo.readText("a.txt")).toBe("working-copy-change\n");
    await page.getByTestId("working-copy-discard-dialog-confirm").click();
    await expect.poll(() => repo.readText("a.txt")).toBe("second\n");
  });
  test("targets the clicked remote and confirms removal", async ({ page }) => {
    const remote = await createBareRemote();
    try {
      await repo.git(["remote", "add", "origin", remote.path]);
      await repo.git(["remote", "add", "mirror", remote.path]);
      await repo.git(["push", "origin", "main"]);
      await page.goto(service.pairingUrl);
      await page.getByTestId("workbench-nav-remotes").click();

      await page.getByLabel("select remote origin").check();
      const mirrorRow = page.getByTestId("remote-row-mirror");
      await mirrorRow.click({ button: "right" });
      await expect(
        page.getByTestId("remote-context-mirror-edit"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-fetch"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-pull"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-push"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-remove"),
      ).toBeVisible();

      await page.getByTestId("remote-context-mirror-edit").click();
      await expect(page.getByLabel("remote name for mirror")).toBeVisible();
      await page.getByTestId("cancel-edit-remote-mirror").click();

      await mirrorRow.click({ button: "right" });
      await page.getByTestId("remote-context-mirror-fetch").click();
      await expect(page.getByTestId("remote-message")).toContainText(
        /fetched mirror/,
      );

      await mirrorRow.click({ button: "right" });
      await page.getByTestId("remote-context-mirror-remove").click();
      await expect(page.getByTestId("remote-remove-dialog")).toBeVisible();
      expect(
        new TextDecoder()
          .decode(await repo.git(["remote"]))
          .trim()
          .split("\n"),
      ).toEqual(["mirror", "origin"]);
      await page.getByTestId("remote-remove-dialog-confirm").click();
      await expect(page.getByTestId("remote-message")).toContainText(
        /removed remote mirror/,
      );
      expect(
        new TextDecoder()
          .decode(await repo.git(["remote"]))
          .trim()
          .split("\n"),
      ).toEqual(["origin"]);
    } finally {
      await remote.dispose();
    }
  });
});
