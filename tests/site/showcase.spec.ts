/** Proves browser hydration, real component interactivity, and the safe demo boundary. */
import { test, expect } from "@playwright/test";

test("the real Svelte workbench can review, stage, commit, and reset", async ({ page }) => {
  const failedRequests: string[] = [];
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await page.goto("/demo/");
  await expect(page.getByTestId("demo-safety-notice")).toContainText("simulated");
  await expect(page.getByTestId("history-scroll")).toBeVisible();
  await expect(page.locator('[data-testid^="commit-row-"]').first()).toBeVisible();
  await page.getByTestId("demo-working-tab").click();
  await expect(page.getByTestId("working-copy-panel")).toBeVisible();
  await page.getByTestId("stage-path_ui").click();
  await expect(page.getByTestId("unstage-path_ui")).toBeVisible();
  await page.getByTestId("unstage-path_ui").click();
  await expect(page.getByTestId("stage-path_ui")).toBeVisible();
  await page.getByTestId("commit-message").fill("docs: explain the interactive sandbox");
  await page.getByTestId("commit-panel").getByRole("button", { name: /commit/i }).first().click();
  await expect(page.getByTestId("demo-history-layout")).toBeVisible();
  await expect(page.getByText("docs: explain the interactive sandbox").first()).toBeVisible();
  await page.getByTestId("demo-reset").click();
  await expect(page.getByText("docs: explain the interactive sandbox")).toHaveCount(0);
  expect(failedRequests.filter((url) => /localhost|127\.0\.0\.1.*api|github\.com.*api/i.test(url))).toEqual([]);
});

test("showcase links to docs and live sandbox", async ({ page }) => {
  await page.goto("/showcase/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refyard");
  await expect(page.getByRole("link", { name: /interactive demo/i })).toHaveAttribute("href", "/demo/");
});
