/** Additional worktree workbench coverage for per-side diffs and per-worktree drafts. */
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { symlink, writeFile } from "node:fs/promises";
import { createRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test("keeps staged and unstaged diffs and commit drafts scoped to each worktree", async ({
  page,
}) => {
  const repo = await createRepo({ initialCommit: true });
  const linked = join(repo.root, ".worktrees", "feature");
  await repo.write("mixed.txt", "base\n");
  await repo.commitAll("mixed base");
  await repo.git(["worktree", "add", "-b", "feature-ui", linked]);

  await repo.write("mixed.txt", "INDEX VERSION\n");
  await repo.git(["add", "mixed.txt"]);
  await repo.write("mixed.txt", "WORKTREE VERSION\n");
  await writeFile(join(linked, "linked-only.txt"), "linked content\n");

  const service = await startE2eService({ repo });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    const mainDiff = page.getByTestId("main-diff-panel");
    await expect(
      working
        .getByTestId("staged-files")
        .getByText("mixed.txt", { exact: true }),
    ).toBeVisible();
    await expect(
      working
        .getByTestId("unstaged-files")
        .getByText("mixed.txt", { exact: true }),
    ).toBeVisible();

    await working
      .getByTestId("staged-files")
      .getByText("mixed.txt", { exact: true })
      .click();
    await expect(mainDiff).toBeVisible();
    await expect(mainDiff).toContainText("INDEX VERSION");
    await expect(mainDiff).not.toContainText("WORKTREE VERSION");

    await working
      .getByTestId("unstaged-files")
      .getByText("mixed.txt", { exact: true })
      .click();
    await expect(mainDiff).toContainText("WORKTREE VERSION");
    await expect(mainDiff).toContainText("INDEX VERSION");
    // External edits must refresh an already-open diff without another click.
    await repo.write("mixed.txt", "EXTERNAL EDIT\n");
    await expect(mainDiff).toContainText("EXTERNAL EDIT", { timeout: 15000 });

    await page
      .getByRole("button", { name: "Back to history", exact: true })
      .click();
    await working.getByTestId("commit-message").fill("main draft");
    await page.screenshot({ path: "test-results/worktree-history.png" });

    await page
      .getByRole("button", { name: /Worktrees/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Open worktree feature-ui", exact: true })
      .click();
    await expect(working).toContainText("feature-ui");
    await working.getByTestId("commit-message").fill("feature draft");

    await page
      .getByRole("button", { name: "Open worktree main", exact: true })
      .click();
    await expect(working).toContainText("main");
    await expect(working.getByTestId("commit-message")).toHaveValue(
      "main draft",
    );

    await page
      .getByRole("button", { name: "Open worktree feature-ui", exact: true })
      .click();
    await expect(working.getByTestId("commit-message")).toHaveValue(
      "feature draft",
    );
  } finally {
    await service.stop();
    await repo.dispose();
  }
});

test("opens a worktree in a separate tab and restores its selection when the tab closes", async ({
  page,
}) => {
  const repo = await createRepo({ initialCommit: true });
  const linked = join(repo.root, ".worktrees", "feature");
  await repo.git(["worktree", "add", "-b", "feature-ui", linked]);
  const service = await startE2eService({ repo });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(service.pairingUrl);
    const main = page.locator("main[data-tab-count]");
    const tabs = page.getByTestId("repository-tabs");
    const working = page.getByTestId("working-copy-panel");

    await page
      .getByRole("button", { name: /Worktrees/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Open worktree feature-ui", exact: true })
      .click();
    await expect(working).toContainText("feature-ui");
    await working.getByTestId("commit-message").fill("feature draft");

    const featureRow = page.getByRole("button", {
      name: "Open worktree feature-ui",
      exact: true,
    });
    await featureRow.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Open worktree in new tab", exact: true })
      .click();

    await expect(main).toHaveAttribute("data-tab-count", "2");
    const tabRows = tabs.locator('[data-testid^="repository-tab-"]');
    await expect(tabRows).toHaveCount(2);
    await expect(working.getByTestId("commit-message")).toHaveValue(
      "feature draft",
    );

    // Switch to the original repository tab, which is still associated with
    // the selected feature worktree, then return to the separate tab.
    await tabRows.nth(0).getByRole("button").first().click();
    await expect(working).toContainText("feature-ui");
    await expect(working.getByTestId("commit-message")).toHaveValue(
      "feature draft",
    );
    await tabRows.nth(1).getByRole("button").first().click();
    await expect(working).toContainText("feature-ui");

    // Closing the active linked-worktree tab should restore the original tab's
    // worktree selection and its draft instead of falling back to primary.
    await tabRows.nth(1).getByRole("button").nth(1).click();
    await expect(main).toHaveAttribute("data-tab-count", "1");
    await expect(working).toContainText("feature-ui");
    await expect(working.getByTestId("commit-message")).toHaveValue(
      "feature draft",
    );

    const resizeHandle = page.getByTestId("right-sidebar-resize-handle");
    await expect(resizeHandle).toBeVisible();
    const before = await main.getAttribute("style");
    await resizeHandle.focus();
    await resizeHandle.press("ArrowLeft");
    await expect.poll(() => main.getAttribute("style")).not.toBe(before);
  } finally {
    await service.stop();
    await repo.dispose();
  }
});

// A home-relative symlink resolves on the host; reopening must restore a closed tab.
test("reopens a closed repository tab from a home-relative path", async ({
  page,
}) => {
  const repo = await createRepo({ initialCommit: true });
  await symlink(repo.root, join(repo.home, "repo-shortcut"));
  const service = await startE2eService({ repo });
  try {
    await page.goto(service.pairingUrl);
    const tabs = page.getByTestId("repository-tabs");
    await expect(
      tabs.getByRole("button", { name: "Close repo", exact: true }),
    ).toBeVisible();
    await tabs.getByRole("button", { name: "Close repo", exact: true }).click();
    await expect(page.getByTestId("repository-launcher")).toBeVisible();
    await page
      .getByLabel("Local repository path", { exact: true })
      .fill("~/repo-shortcut");
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(page.getByTestId("working-copy-panel")).toBeVisible();
    await expect(tabs.locator('[data-testid^="repository-tab-"]')).toHaveCount(
      1,
    );
    await expect(
      tabs.getByRole("button", { name: "repo", exact: true }),
    ).toBeVisible();
  } finally {
    await service.stop();
    await repo.dispose();
  }
});
