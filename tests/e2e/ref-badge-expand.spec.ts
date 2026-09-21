import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("Ref badge hover expansion", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;

  // Long enough that the badge cannot fit the default 140px Branch / Tag
  // column — the resting badge must truncate, and hovering must reveal the
  // whole name the way GitKraken expands a truncated branch chip.
  const LONG_BRANCH = "rc5-proxy-rework-with-a-very-long-name";

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    await repo.git(["branch", LONG_BRANCH]);
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("expands a truncated ref badge on hover and hides it on leave", async ({
    page,
  }) => {
    // Real-world failure prevented: a narrow column hiding branch names with
    // no way to read them — the overlay must escape the column's clipping and
    // retire cleanly when the pointer leaves.
    await page.goto(service.pairingUrl);
    const badge = page.getByTestId(`commit-ref-refs/heads/${LONG_BRANCH}`);
    await expect(badge).toBeVisible();
    await expect(page.getByTestId("ref-badge-overlay")).toHaveCount(0);

    await badge.hover();
    const overlay = page.getByTestId("ref-badge-overlay");
    await expect(overlay).toContainText(LONG_BRANCH);

    // The overlay escapes the Branch / Tag cell: it reaches past the column's
    // right edge instead of being clipped by it.
    const overlayBox = await overlay.boundingBox();
    const badgeBox = await badge.boundingBox();
    if (overlayBox === null || badgeBox === null) {
      throw new Error("overlay or badge has no box");
    }
    expect(overlayBox.width).toBeGreaterThan(badgeBox.width + 20);

    await page.mouse.move(20, 300);
    await expect(page.getByTestId("ref-badge-overlay")).toHaveCount(0);
  });
});
