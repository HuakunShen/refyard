/** Real Chromium history searches against isolated Git commits and the shipped host. */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("history search", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let newestOid: string;
  /** The initial commit the `base-only` branch points at. */
  let baseOid: string;
  const releaseOids: string[] = [];
  test.beforeAll(async () => {
    repo = await createRepo({ initialCommit: true });
    baseOid = await repo.headOid();
    await repo.git(["branch", "base-only"]);
    for (let index = 0; index < 105; index += 1) {
      await repo.write("a.txt", `release ${index}\n`);
      newestOid = await repo.commitAll(`Release item ${index}`, {
        date: "2026-02-01T12:00:00Z",
      });
      releaseOids.push(newestOid);
    }
    await repo.write("a.txt", "pending change\n");
  });
  test.afterAll(async () => {
    await repo.dispose();
  });
  test.beforeEach(async () => {
    service = await startE2eService({ repo, mode: "local" });
  });
  test.afterEach(async () => {
    await service.stop();
  });

  test("applies explicit combined searches, ref, SHA, dates and known file, then restores graph", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(service.pairingUrl);
    const latest = page.getByTestId(`commit-row-${newestOid}`);
    await expect(latest).toBeVisible();
    await expect(page.locator("svg[data-slot='graph-gutter']")).toBeVisible();
    expect(
      await page.locator("svg[data-slot='graph-gutter'] path").count(),
    ).toBeGreaterThan(0);
    const search = page.getByRole("form", { name: "History search" });
    const message = page.getByLabel("Search commit messages");
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/history"))
        requests.push(request.url());
    });
    await message.fill("Release item 104");
    await expect(latest).toBeVisible();
    // Prevents keystrokes spawning Git searches; the applied state changes only on submit.
    expect(
      requests.some((url) => new URL(url).searchParams.has("message")),
    ).toBe(false);
    await search.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Author", { exact: true }).fill("Fixture");
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      page.getByText("Filtered history · graph hidden"),
    ).toBeVisible();
    await expect(latest).toBeVisible();
    await expect(page.locator("svg[data-slot='graph-gutter']")).toHaveCount(0);
    expect(
      requests.some((url) => {
        const query = new URL(url).searchParams;
        return (
          query.get("message") === "Release item 104" &&
          query.get("author") === "Fixture"
        );
      }),
    ).toBe(true);
    await latest.click();
    await expect(page.getByText("committer", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("desktop-expanded.png"),
      fullPage: true,
    });
    await testInfo.attach("desktop history filters", {
      path: testInfo.outputPath("desktop-expanded.png"),
      contentType: "image/png",
    });

    await search.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.locator("svg[data-slot='graph-gutter']")).toBeVisible();
    expect(
      await page.locator("svg[data-slot='graph-gutter'] path").count(),
    ).toBeGreaterThan(0);
    await page
      .getByLabel("Ref", { exact: true })
      .selectOption("refs/heads/base-only");
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    // Identified by the tip's oid: the row button's accessible name is the
    // subject alone now that refs and metadata live in their own columns.
    await expect(page.getByTestId(`commit-row-${baseOid}`)).toBeVisible();
    await expect(latest).toHaveCount(0);
    await expect(page.locator("svg[data-slot='graph-gutter']")).toHaveCount(1);

    await search.getByRole("button", { name: "Clear", exact: true }).click();
    await page
      .getByLabel("Commit SHA", { exact: true })
      .fill(newestOid.slice(0, 12));
    await message.press("Enter");
    await expect(latest).toBeVisible();
    await expect(page.getByTestId("sparse-commit-marker")).toHaveCount(1);

    await search.getByRole("button", { name: "Clear", exact: true }).click();
    await page
      .getByLabel("Known file", { exact: true })
      .selectOption({ label: "a.txt" });
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(latest).toBeVisible();
    await expect(page.getByLabel("Applied history filters")).toContainText(
      "File: a.txt",
    );
    await expect(
      page.getByLabel("Known file", { exact: true }),
    ).not.toHaveValue("");
    await page
      .getByLabel("Commit SHA", { exact: true })
      .fill(newestOid.slice(0, 12));
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(search.getByRole("alert")).toContainText("cannot be combined");
    await expect(latest).toBeVisible();

    await search.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByLabel("Committed after (UTC)").fill("2026-02-01T00:00");
    await page.getByLabel("Committed before (UTC)").fill("2026-02-02T00:00");
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(latest).toBeVisible();
    await expect(page.locator("svg[data-slot='graph-gutter']")).toHaveCount(0);
    await message.fill("nothing matches this phrase");
    await message.press("Enter");
    await expect(
      page.getByText("No matching commits", { exact: true }),
    ).toBeVisible();
    await expect(latest).toHaveCount(0);
    await search.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(latest).toBeVisible();
    await expect(page.locator("svg[data-slot='graph-gutter']")).toBeVisible();
    expect(
      await page.locator("svg[data-slot='graph-gutter'] path").count(),
    ).toBeGreaterThan(0);
  });

  test("continues filtered pages using only cursor identity and wraps on a narrow viewport", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(service.pairingUrl);
    const search = page.getByRole("form", { name: "History search" });
    await expect(search).toBeVisible();
    await page.getByLabel("Search commit messages").fill("Release");
    await search.getByRole("button", { name: "Filters", exact: true }).click();
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      page.getByText("Filtered history · graph hidden"),
    ).toBeVisible();
    // Prevents a stacked narrow pane expanding to all rows and defeating virtualization.
    const visibleRows = page.locator('[data-testid^="commit-row-"]');
    await expect(visibleRows.first()).toBeVisible();
    expect(await visibleRows.count()).toBeLessThan(100);
    const scrollList = page
      .getByTestId("history-panel")
      .locator("div.overflow-auto");
    const continuation = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname.endsWith("/history") &&
        new URL(request.url()).searchParams.has("cursor"),
    );
    await scrollList.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    const url = new URL((await continuation).url());
    expect([...url.searchParams.keys()].sort()).toEqual([
      "cursor",
      "repositoryId",
      "worktreeId",
    ]);
    await expect(
      page.getByText("End of the loaded history", { exact: true }),
    ).toBeVisible();
    // Prevents page boundaries losing, repeating or reordering commits in the actual UI.
    const expectedOids = [...releaseOids].reverse();
    const rowHeight = await visibleRows
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(rowHeight).toBeGreaterThan(0);
    const renderedOids: string[] = [];
    const observedOids = new Set<string>();
    for (const [index, oid] of expectedOids.entries()) {
      await scrollList.evaluate((element, top) => {
        element.scrollTop = top;
      }, index * rowHeight);
      await expect(page.getByTestId(`commit-row-${oid}`)).toBeVisible();
      const windowOids = await visibleRows.evaluateAll((elements) =>
        elements.map(
          (element) =>
            element.getAttribute("data-testid")?.slice("commit-row-".length) ??
            "",
        ),
      );
      expect(new Set(windowOids).size).toBe(windowOids.length);
      const firstIndex = expectedOids.indexOf(windowOids[0] ?? "");
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(windowOids).toEqual(
        expectedOids.slice(firstIndex, firstIndex + windowOids.length),
      );
      for (const renderedOid of windowOids) {
        if (!observedOids.has(renderedOid)) {
          observedOids.add(renderedOid);
          renderedOids.push(renderedOid);
        }
      }
    }
    expect(renderedOids).toEqual(expectedOids);
    expect(renderedOids).toHaveLength(105);
    const restart = page.waitForRequest((request) => {
      const query = new URL(request.url()).searchParams;
      return (
        new URL(request.url()).pathname.endsWith("/history") &&
        query.get("message") === "Release" &&
        !query.has("cursor")
      );
    });
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await restart;
    await expect(
      page.getByText("End of the loaded history", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("svg[data-slot='graph-gutter']")).toHaveCount(0);
    await page.getByLabel("Commit SHA", { exact: true }).fill("xyz");
    await search.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(search.getByRole("alert")).toHaveText(
      "Commit SHA needs 4–64 hexadecimal digits",
    );
    await expect(search).toHaveAccessibleDescription(
      "Commit SHA needs 4–64 hexadecimal digits",
    );
    await expect(search.getByRole("alert")).not.toContainText(
      /pattern|schema|Invalid string/,
    );
    await page
      .getByTestId("history-panel")
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    const box = await search.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath("narrow-expanded.png"),
      fullPage: true,
    });
    await testInfo.attach("narrow history filters", {
      path: testInfo.outputPath("narrow-expanded.png"),
      contentType: "image/png",
    });
  });
});
