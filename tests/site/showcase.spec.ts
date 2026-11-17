/** Proves browser hydration, real component interactivity, and the safe demo boundary. */
import { test, expect } from "@playwright/test";

test("the complete Svelte workbench can switch repositories, stage, commit, and reset", async ({ page }) => {
  const failedRequests: string[] = [];
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await page.goto("/demo/");
  await expect(page.getByTestId("demo-safety-notice")).toContainText("simulated");
  await expect(page.getByTestId("repository-tabs")).toBeVisible();
  await expect(page.getByTestId("demo-navigation")).toBeVisible();
  await expect(page.getByTestId("history-scroll")).toBeVisible();
  await expect(page.getByTestId("working-copy-panel")).toBeVisible();
  await expect(page.locator('[data-testid^="commit-row-"]').first()).toBeVisible();
  await page.getByTestId("stage-path_ui").click();
  await expect(page.getByTestId("unstage-path_ui")).toBeVisible();
  await page.getByTestId("repository-tab-sample-api").getByRole("button").first().click();
  await expect(page.getByTestId("stage-path_ui")).toBeVisible();
  await page.getByTestId("repository-tab-atlas-editor").getByRole("button").first().click();
  await page.getByTestId("unstage-path_ui").click();
  await expect(page.getByTestId("stage-path_ui")).toBeVisible();
  await page.getByTestId("commit-message").fill("docs: explain the interactive sandbox");
  await page.getByTestId("commit-panel").getByRole("button", { name: /commit/i }).first().click();
  await expect(page.getByText("docs: explain the interactive sandbox").first()).toBeVisible();
  await page.getByTestId("demo-reset").click();
  await expect(page.getByText("docs: explain the interactive sandbox")).toHaveCount(0);
  expect(failedRequests.filter((url) => /localhost|127\.0\.0\.1.*api|github\.com.*api/i.test(url))).toEqual([]);
});

test("homepage contains the full interactive sandbox and links to documentation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Git history");
  await expect(page.locator("#try-it")).toBeVisible();
  await expect(page.getByTestId("repository-tabs")).toBeVisible();
  await expect(page.getByRole("link", { name: /Documentation/ })).toHaveAttribute("href", "/docs/");
  await page.getByRole("searchbox", { name: "Search commit history" }).fill("not-a-real-commit");
  await expect(page.locator('[data-testid^="commit-row-"]')).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search commit history" }).fill("");
  await expect(page.locator('[data-testid^="commit-row-"]').first()).toBeVisible();
});

test("commit keyboard navigation ignores focused text inputs", async ({ page }) => {
  await page.goto("/demo/");
  const search = page.getByRole("searchbox", { name: "Search commit history" });
  await search.focus();
  await search.press("ArrowDown");
  await expect(search).toBeFocused();
});
