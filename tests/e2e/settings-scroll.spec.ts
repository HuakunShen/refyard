/**
 * Settings stays reachable when the sheet is taller than the window.
 *
 * The sheet carries appearance, updates and the about/connection rows. On a short window —
 * a laptop screen with browser chrome, a resized window — the lower sections were clipped
 * by the dialog's own `overflow-hidden` with no way down, so a reader could change the
 * accent colour and never reach git version, service instance or disconnect. Every section
 * the sheet renders has to be reachable by scrolling inside the sheet, and the sheet itself
 * must never grow past the window.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("Settings scrolling", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("scrolls to the last section in a window shorter than the sheet", async ({
    page,
  }) => {
    // Prevents: a settings sheet whose lower half is clipped and unreachable.
    await page.setViewportSize({ width: 1100, height: 520 });
    await page.goto(service.pairingUrl);
    await page.getByTestId("settings-open").click();

    const sheet = page.getByTestId("settings-scroll-area");
    const viewport = sheet.locator('[data-slot="scroll-area-viewport"]');
    await expect(viewport).toBeVisible();

    // The sheet fits the window: what cannot fit is scrolled inside it, never hidden past
    // the window's own edge. The window's height is read on this side because the suite's
    // TypeScript has no DOM lib — the same reason other specs pass browser code as strings.
    const windowHeight = page.viewportSize()?.height ?? 0;
    const bounds = await viewport.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });
    expect(windowHeight).toBeGreaterThan(0);
    expect(
      bounds.bottom,
      `the settings viewport ends below the window: ${JSON.stringify({ ...bounds, windowHeight })}`,
    ).toBeLessThanOrEqual(windowHeight);
    expect(
      bounds.scrollHeight,
      `the settings sheet has nothing to scroll, so the window is not the constraint: ${JSON.stringify(bounds)}`,
    ).toBeGreaterThan(bounds.clientHeight);

    // A reader scrolls with the wheel over the sheet, so the test does too.
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await page.mouse.wheel(0, 600);

    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop), {
        message: "the settings sheet did not scroll",
      })
      .toBeGreaterThan(0);

    await expect(page.getByTestId("settings-about")).toBeInViewport();
  });
});
