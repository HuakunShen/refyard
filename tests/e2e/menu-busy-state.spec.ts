/** Verifies a menu opened during a write refresh observes the live busy state. */
import { expect, test } from "@playwright/test";
import { createRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.use({ serviceWorkers: "block" });

test("re-enables transiently busy actions without enabling a root drop", async ({
  page,
}) => {
  // Prevents snapshotting a short refresh interval into permanently disabled menu actions.
  const repo = await createRepo({ initialCommit: true });
  const service = await startE2eService({ repo });
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holdStatus = false;
  let statusHeld = false;
  try {
    const oid = await repo.headOid();
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${oid}`);
    await expect(row).toBeVisible();
    await page.route("**/api/v1/status?*", async (route) => {
      const response = await route.fetch();
      if (holdStatus) {
        statusHeld = true;
        await gate;
      }
      await route.fulfill({ response });
    });
    await row.click({ button: "right" });
    await page.getByTestId(`commit-context-${oid}-create-branch`).click();
    await page.getByTestId("commit-ref-name").fill("busy-menu");
    holdStatus = true;
    await page.getByTestId("commit-ref-submit").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "created branch busy-menu",
    );
    await expect.poll(() => statusHeld).toBe(true);
    await row.click({ button: "right" });
    const tag = page.getByTestId(`commit-context-${oid}-create-tag`);
    const drop = page.getByTestId(`commit-context-${oid}-drop-commit`);
    await expect(tag).toBeDisabled();
    await expect(drop).toBeDisabled();
    holdStatus = false;
    release();
    await expect(tag).toBeEnabled();
    await expect(drop).toBeDisabled();
    await expect(drop).toContainText("The first commit cannot be dropped");
    await tag.click();
    await expect(page.getByTestId("commit-ref-dialog")).toBeVisible();
    expect(await repo.headOid()).toBe(oid);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await service.stop();
    await repo.dispose();
  }
});
