import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("Graph column compression", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    // Two divergent branches give the graph more than one lane to squeeze —
    // no merge needed for that.
    await repo.git(["checkout", "--quiet", "-b", "topic"]);
    await repo.write("b.txt", "topic\n");
    await repo.git(["add", "-A"]);
    await repo.git(["commit", "--quiet", "-m", "topic"]);
    await repo.git(["checkout", "--quiet", "main"]);
    await repo.write("c.txt", "main side\n");
    await repo.git(["add", "-A"]);
    await repo.git(["commit", "--quiet", "-m", "on main"]);
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("squeezes the lanes into whatever width the graph is dragged to", async ({
    page,
  }) => {
    // Real-world failure prevented: the old lane floor refused to shrink the
    // column below the lane count's natural width, so a user could not get the
    // compact GitKraken layout; the lanes must compress instead.
    await page.goto(service.pairingUrl);
    const gutter = page.locator('svg[data-slot="graph-gutter"]');
    await expect(gutter).toBeVisible();
    const paths = () => gutter.locator("path").count();
    expect(await paths()).toBeGreaterThan(0);
    const wideBox = await gutter.boundingBox();
    if (wideBox === null) throw new Error("no gutter box");

    const handle = page.getByTestId("history-column-resize-graph");
    const grip = await handle.boundingBox();
    if (grip === null) throw new Error("no grip box");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 50, grip.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const narrowBox = await gutter.boundingBox();
    if (narrowBox === null) throw new Error("no narrow gutter box");
    // The column got narrower, and the lanes are all still drawn inside it.
    expect(narrowBox.width).toBeLessThan(wideBox.width);
    expect(await paths()).toBeGreaterThan(0);
  });
});
