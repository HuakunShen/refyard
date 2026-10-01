/** Mutation feedback and recovery confirmation stay with their repository/worktree target. */
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("mutation result context", () => {
  let repo: GitFixtureRepo;
  let second: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    second = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await second.dispose();
    await repo.dispose();
  });

  async function openSecond(page: Page): Promise<void> {
    await page.getByTestId("new-repository-tab").click();
    await page.getByLabel("Local repository path").fill(second.root);
    await page.getByTestId("launcher-open").click();
    await expect(page.locator('[data-testid^="repository-tab-"]')).toHaveCount(
      2,
    );
    await expect(
      page
        .locator('[data-testid^="repository-tab-"]')
        .nth(1)
        .getByRole("button")
        .first(),
    ).toHaveAttribute("aria-current", "page");
  }

  for (const scenario of ["branch", "tag", "merge"]) {
    test(`keeps ${scenario} outcomes out of another repository and restores them on return`, async ({
      page,
    }) => {
      // Prevents a completed action in repository A being presented as a result for repository B.
      if (scenario === "merge") {
        await repo.git(["switch", "-c", "other"]);
        await repo.write("a.txt", "other\n");
        await repo.commitAll("other");
        await repo.git(["switch", "main"]);
        await repo.write("a.txt", "main\n");
        await repo.commitAll("main");
      }
      await page.goto(service.pairingUrl);
      let resultId: string;
      let view: string;
      let outcome: string;
      if (scenario === "branch") {
        view = "branches";
        resultId = "branch-message";
        outcome = "created branch scoped-result";
        await page.getByTestId("workbench-nav-branches").click();
        await page
          .getByLabel("new branch name", { exact: true })
          .fill("scoped-result");
        await page.getByTestId("create-branch").click();
      } else if (scenario === "tag") {
        view = "tags";
        resultId = "tag-message-result";
        outcome = "created tag scoped-result";
        const oid = await repo.headOid();
        await page.getByTestId(`commit-row-${oid}`).click({ button: "right" });
        await page.getByTestId(`commit-context-${oid}-create-tag`).click();
        await page.getByTestId("commit-ref-name").fill("scoped-result");
        await page.getByTestId("commit-ref-submit").click();
        await page.getByTestId("workbench-nav-tags").click();
      } else {
        view = "working-copy";
        resultId = "conflict-message-result";
        outcome = "aborted the merge";
        await page.getByTestId("workbench-nav-branches").click();
        await page.getByTestId("merge-other").click();
        await expect(page.getByTestId("conflicted-paths")).toContainText(
          "a.txt",
        );
        await page.getByTestId("abort-merge").click();
        await page.getByTestId("abort-merge-confirm").click();
      }
      await expect(page.getByTestId(resultId)).toContainText(outcome);
      await openSecond(page);
      await page.getByTestId(`workbench-nav-${view}`).click();
      await expect(page.getByTestId(resultId)).toHaveCount(0);
      await page
        .locator('[data-testid^="repository-tab-"]')
        .nth(0)
        .getByRole("button")
        .first()
        .click();
      await page.getByTestId(`workbench-nav-${view}`).click();
      await expect(page.getByTestId(resultId)).toContainText(outcome);
    });
  }
  test("shares repository-wide results across linked worktrees but isolates branch-switch results", async ({
    page,
  }) => {
    // Prevents fixing repository leakage by hiding shared ref outcomes or showing a switch result in the wrong worktree.
    await repo.git([
      "worktree",
      "add",
      "-b",
      "linked-view",
      join(repo.root, ".worktrees", "linked"),
    ]);
    await page.goto(service.pairingUrl);
    await page.getByTestId("workbench-nav-branches").click();
    await page
      .getByLabel("new branch name", { exact: true })
      .fill("scoped-result");
    await page.getByTestId("create-branch").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "created branch scoped-result",
    );
    await page.getByTestId("workbench-nav-worktrees").click();
    await page
      .getByRole("button", { name: "Open worktree linked-view", exact: true })
      .click();
    await page.getByTestId("workbench-nav-branches").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "created branch scoped-result",
    );
    await page.getByTestId("switch-scoped-result").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "switched to scoped-result",
    );
    await page.getByTestId("workbench-nav-worktrees").click();
    await page
      .getByRole("button", { name: "Open worktree main", exact: true })
      .click();
    await page.getByTestId("workbench-nav-branches").click();
    await expect(page.getByTestId("branch-message")).toHaveCount(0);
    await page.getByTestId("workbench-nav-worktrees").click();
    await page
      .getByRole("button", { name: "Open worktree scoped-result", exact: true })
      .click();
    await page.getByTestId("workbench-nav-branches").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "switched to scoped-result",
    );
  });
  test("requires a new abort confirmation after switching to another repository with the same operation", async ({
    page,
  }) => {
    // Prevents an armed rebase abort from carrying over to another repository's stopped rebase.
    for (const fixture of [repo, second]) {
      await fixture.git(["switch", "-c", "other"]);
      await fixture.write("a.txt", "other\n");
      await fixture.commitAll("other");
      await fixture.git(["switch", "main"]);
      await fixture.write("a.txt", "main\n");
      await fixture.commitAll("main");
      expect((await fixture.gitResult(["rebase", "other"])).code).toBe(1);
    }
    await page.goto(service.pairingUrl);
    await openSecond(page);
    const tabs = page.locator('[data-testid^="repository-tab-"]');
    await tabs.nth(0).getByRole("button").first().click();
    await expect(tabs.nth(0).getByRole("button").first()).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "rebase in progress",
    );
    await page.getByTestId("abort-merge").click();
    await expect(page.getByTestId("abort-merge-confirm")).toBeVisible();
    await tabs.nth(1).getByRole("button").first().click();
    await expect(tabs.nth(1).getByRole("button").first()).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "rebase in progress",
    );
    await expect(page.getByTestId("abort-merge-confirm")).toHaveCount(0);
    await expect(page.getByTestId("abort-merge")).toBeVisible();
  });
});
