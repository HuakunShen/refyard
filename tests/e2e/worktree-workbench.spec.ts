/** Real worktree isolation and the main-area diff/staging interaction. */
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test("switches worktree WIP, opens main-area diffs and stages only the active checkout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const repo = await createRepo({ initialCommit: true });
  const linked = join(repo.root, ".worktrees", "feature");
  await repo.git(["worktree", "add", "-b", "feature-ui", linked]);
  await repo.write("main-only.txt", "main stays untracked\n");
  await writeFile(join(linked, "linked-only.txt"), "linked staged content\n");
  const service = await startE2eService({ repo });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();
    await page
      .getByRole("button", { name: /Worktrees/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Open worktree feature-ui", exact: true })
      .click();
    await expect(
      working.getByText("linked-only.txt", { exact: true }),
    ).toBeVisible();
    await expect(
      working.getByText("main-only.txt", { exact: true }),
    ).toHaveCount(0);
    await working.getByText("linked-only.txt", { exact: true }).click();
    await expect(page.getByTestId("main-diff-panel")).toBeVisible();
    await expect(page.getByTestId("main-diff-panel")).toContainText(
      "linked staged content",
    );
    await page.screenshot({ path: "test-results/worktree-main-diff.png" });
    const diffBox = await page.getByTestId("main-diff-panel").boundingBox();
    expect(diffBox?.width).toBeGreaterThan(800);
    await working
      .getByRole("button", { name: "Stage linked-only.txt", exact: true })
      .click();
    await expect(
      working.getByRole("button", {
        name: "Unstage linked-only.txt",
        exact: true,
      }),
    ).toBeVisible();
    const mainIndex = await repo.git(["diff", "--cached", "--name-only"]);
    expect(new TextDecoder().decode(mainIndex)).not.toContain("main-only.txt");
    const linkedIndex = await repo.git([
      "-C",
      linked,
      "diff",
      "--cached",
      "--name-only",
    ]);
    expect(new TextDecoder().decode(linkedIndex)).toContain("linked-only.txt");
    await working.getByTestId("commit-message").fill("Commit from linked UI");
    await working.getByTestId("commit-button").click();
    await expect(
      working.getByRole("button", {
        name: "Unstage linked-only.txt",
        exact: true,
      }),
    ).toHaveCount(0);
    const linkedLog = await repo.git([
      "-C",
      linked,
      "log",
      "-1",
      "--format=%s",
    ]);
    expect(new TextDecoder().decode(linkedLog).trim()).toBe(
      "Commit from linked UI",
    );
    const mainLog = await repo.git(["log", "-1", "--format=%s"]);
    expect(new TextDecoder().decode(mainLog)).not.toContain(
      "Commit from linked UI",
    );
    await expect(page.getByTestId("main-diff-panel")).toHaveCount(0);
    await expect(page.getByTestId("worktree-wip-list")).toContainText(
      "feature-ui",
    );
    await expect(working.getByTestId("commit-message")).toHaveValue("");
    expect(errors).toEqual([]);
  } finally {
    await service.stop();
    await repo.dispose();
  }
});
