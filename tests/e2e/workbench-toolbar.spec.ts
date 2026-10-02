/**
 * The workbench toolbar: the basic actions a reader operates the repository by.
 *
 * The row exists because pull and push were undiscoverable — flows the product had,
 * buried in side panels. These cases pin what a reader depends on: the row appears
 * with a repository open, every button is honest about what it can do right now
 * (clean tree holds Stage all; no remote holds the sync trio), and a real change
 * wakes the buttons up. The flows themselves are the side panels' own, already
 * covered by their specs; what this pins is the surfacing.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

test.describe("workbench toolbar", () => {
  let approved: GitFixtureRepo;
  let service: E2eService;

  test.beforeEach(async () => {
    approved = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo: approved });
  });

  test.afterEach(async () => {
    await service.stop();
    await approved.dispose();
  });

  test("shows the actions and holds them honestly on a clean, remote-less repository", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("workbench-toolbar")).toBeVisible();

    // The sync trio is present but held: no remote means fetch has nowhere to go,
    // and the disabled button says why rather than firing a refused request.
    const fetch = page.getByTestId("toolbar-fetch");
    await expect(fetch).toBeDisabled();
    await expect(fetch).toHaveAttribute("title", /no remote/i);

    await expect(page.getByTestId("toolbar-stage-all")).toBeDisabled();
    await expect(page.getByTestId("toolbar-stash")).toBeDisabled();

    // A repository without a single remote also has nothing to pop.
    await expect(page.getByTestId("toolbar-pop-stash")).toBeDisabled();
  });

  test("a real change wakes the local actions", async ({ page }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("workbench-toolbar")).toBeVisible();

    await approved.write("notes.txt", "a change the toolbar can act on\n");
    await expect(page.getByTestId("toolbar-stage-all")).toBeEnabled({
      timeout: 15_000,
    });
    await expect(page.getByTestId("toolbar-stash")).toBeEnabled();
    // The count the reader decides by is the button's own label.
    await expect(page.getByTestId("toolbar-stage-all")).toContainText("1");
  });
});
