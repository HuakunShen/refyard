/**
 * Changes made by *other* programs, in a real browser.
 *
 * The event stream is the fast path: it carries hints about writes this service performed.
 * It carries nothing about a commit in a terminal, a rebase in an IDE, or a script that
 * touches a file — and until this case existed, the workbench was correct about those only
 * in the sense that its next read would have been right, whenever that happened.
 *
 * So this spec writes to the repository with nothing but `fs`, waits, and asserts the
 * workbench notices. Nothing is stubbed and no event is synthesised: if polling were removed
 * or slowed past the assertion window, this case fails.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

test.describe("live updates without events", () => {
  let repo: GitFixtureRepo;
  let service: E2eService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("shows a file written by another program, with no event to prompt it", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("working-copy-panel")).toBeVisible();
    // The repository is clean, and the panel says so in the empty state rather than
    // rendering a list of nothing.
    await expect(page.getByText("Working tree is clean")).toBeVisible();

    // Something else on this machine changes the repository. The service is not told —
    // there is no watcher, and the SSE stream only reports writes it performed itself.
    await repo.write("outside.txt", "written by another program\n");

    // The workbench notices on its own, within a few polls of the visible cadence.
    await expect(page.getByTestId("unstaged-files")).toContainText(
      "outside.txt",
      {
        timeout: 15_000,
      },
    );
    await expect(page.getByTestId("unstaged-files")).toContainText("untracked");

    // And the content is real, not a row rendered from a stale list: the path was staged
    // by *this* service afterwards and Git agrees it is the same file.
    await page
      .getByRole("button", { name: "Stage outside.txt", exact: true })
      .click();
    await expect(
      page.getByTestId("working-copy-staging-message"),
    ).toContainText(/staged 1 path/, { timeout: 15_000 });
  });
});
