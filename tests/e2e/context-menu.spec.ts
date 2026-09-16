import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
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
});
