import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("History row selection", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let secondOid: string;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    await repo.write("b.txt", "second\n");
    await repo.commitAll("second");
    secondOid = await repo.headOid();
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("clicking a row outside the message cell selects its commit", async ({
    page,
  }) => {
    // Real-world failure prevented: only the subject used to be a button, so
    // clicking the graph, author, date or hash area did nothing — GitKraken
    // selects on a whole-row click, and that is the reflex users bring.
    await page.goto(service.pairingUrl);
    const message = page.getByTestId(`commit-row-${secondOid}`);
    await message.waitFor();
    const row = message.locator(
      "xpath=ancestor::div[contains(@class,'absolute')][1]",
    );

    // Click the graph-gutter stretch of the row: no button lives there.
    await row.click({ position: { x: 300, y: 13 } });
    await expect(message).toHaveAttribute("aria-current", "true");

    // The message button keeps working and moves the selection to the base
    // commit.
    const baseMessage = page.locator(
      '[data-testid^="commit-row-"]:not([data-testid="commit-row-' +
        secondOid +
        '"])',
    );
    await baseMessage.first().click();
    await expect(message).not.toHaveAttribute("aria-current", "true");
    await expect(baseMessage.first()).toHaveAttribute("aria-current", "true");
  });
});
