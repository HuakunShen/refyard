/** Navigation preserves drafts while selected files use the main diff surface. */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("repository sidebar navigation", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    await repo.git(["branch", "draft-nav"]);
    await repo.write("a.txt", "changed\n");
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("opens in Working Copy and keeps History visible", async ({ page }) => {
    await page.goto(service.pairingUrl);
    await expect(
      page.getByTestId("workbench-nav-working-copy"),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle Worktrees" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle Branches" }),
    ).not.toBeVisible();
    await expect(page.getByTestId("workbench-nav-working-copy")).toContainText(
      "1",
    );
    await expect(page.getByTestId("workbench-nav-branches")).toContainText("2");

    for (const id of [
      "repositories",
      "working-copy",
      "branches",
      "remotes",
      "stashes",
      "tags",
      "worktrees",
      "submodules",
    ]) {
      await expect(page.getByTestId(`workbench-nav-${id}`)).toBeVisible();
    }
  });

  test("switches focused object views and preserves a branch rename draft", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);

    await page.getByTestId("workbench-nav-repositories").click();
    await expect(page.getByTestId("repository-panel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle Worktrees" }),
    ).not.toBeVisible();

    await page.getByTestId("workbench-nav-branches").click();
    await expect(
      page.getByRole("button", { name: "Toggle Branches" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle Repositories" }),
    ).not.toBeVisible();

    const row = page.getByTestId("branch-row-draft-nav");
    await row.click({ button: "right" });
    await page.getByTestId("branch-context-draft-nav-rename").click();
    const rename = page.getByLabel("new name for draft-nav");
    await rename.fill("draft-survives-navigation");

    await page.getByTestId("workbench-nav-working-copy").click();
    await expect(rename).not.toBeVisible();
    await page.getByTestId("workbench-nav-branches").click();
    await expect(rename).toBeVisible();
    await expect(rename).toHaveValue("draft-survives-navigation");

    await page.getByTestId("branch-row-main").click({ button: "right" });
    await expect(page.getByTestId("branch-context-main-rename")).toBeVisible();
  });

  test("opens a working-copy path in the main display and returns to history", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    const pathRow = page
      .getByTestId("unstaged-files")
      .getByText("a.txt", { exact: true });
    await expect(pathRow).toBeVisible();
    await pathRow.click();

    await expect(page.getByTestId("main-diff-panel")).toContainText("changed");
    await expect(
      page.getByRole("heading", { name: "History" }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "Back to history" }).click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  });
});
