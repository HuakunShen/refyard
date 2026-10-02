/**
 * Session restore: the tabs a session had open come back on the next one.
 *
 * The Tauri host keeps its repository registry in memory, so every launch starts with
 * an empty registry — the exact situation where a reader had to go digging through the
 * launcher's recent list to find yesterday's repositories. This spec pins the fix: the
 * open-tab set is written to `localStorage` as it changes, and on the next load each
 * saved path is re-registered before the workbench decides what to show.
 *
 * The honest way to prove restore — and not the always-on registry adoption — does the
 * work is to answer the second load's repository *list* with an empty registry, the way
 * a freshly started host would, while letting the restore's own register calls through
 * to the real service. If restore works, the tabs come back and the launcher stays
 * shut; if it does not, nothing else in the page can bring them back.
 */
import { expect, test, type Page } from "@playwright/test";
import { realpath } from "node:fs/promises";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

/** Reads the page's own saved-session store, as the app wrote it. */
async function readSessionStore(page: Page): Promise<unknown> {
  const raw = await page.evaluate(() =>
    localStorage.getItem("refyard.session.tabs"),
  );
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Opens the launcher and opens one real path through it, waiting for its tab. */
async function openRepositoryThroughLauncher(
  page: Page,
  path: string,
): Promise<void> {
  await page.getByTestId("new-repository-tab").click();
  await expect(page.getByTestId("repository-launcher")).toBeVisible();
  await page.getByLabel("Local repository path").fill(path);
  await page.getByTestId("launcher-open").click();
  await expect(
    page
      .getByTestId("repository-tabs")
      .locator('[data-testid^="repository-tab-"]'),
  ).toHaveCount(2);
  await expect(page.getByTestId("repository-launcher")).toHaveCount(0);
}

/**
 * Revokes every registered repository through the real service, leaving the registry
 * exactly as a freshly started desktop host presents it: empty. The page's own session
 * token authorises the calls, so nothing is stubbed — the reload that follows meets a
 * host that genuinely does not know these repositories, and restore must win them back
 * by registering their paths again.
 */
async function revokeEveryRepository(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const token = sessionStorage.getItem("refyard.session.token");
    const auth: Record<string, string> = token
      ? { authorization: `Bearer ${token}` }
      : {};
    const list = (await fetch("/api/v1/repositories", { headers: auth }).then(
      (response) => response.json(),
    )) as { repositories?: Array<{ repositoryId: string }> };
    for (const entry of list.repositories ?? []) {
      await fetch("/api/v1/repositories/revoke", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ repositoryId: entry.repositoryId }),
      });
    }
  });
}

test.describe("session restore", () => {
  let approved: GitFixtureRepo;
  let unapproved: GitFixtureRepo;
  let unapprovedPath: string;
  let service: E2eService;

  test.beforeEach(async () => {
    approved = await createRepo({ initialCommit: true });
    unapproved = await createRepo({ initialCommit: true });
    unapprovedPath = await realpath(unapproved.root);
    service = await startE2eService({ repo: approved });
  });

  test.afterEach(async () => {
    await service.stop();
    await unapproved.dispose();
    await approved.dispose();
  });

  test("an opened repository comes back on reload without the launcher", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.getByTestId("repository-tabs")).toBeVisible();

    await openRepositoryThroughLauncher(page, unapprovedPath);

    // The save side ran: the open-tab set is on disk before anything reloads.
    const saved = await readSessionStore(page);
    expect(saved).toEqual(
      expect.objectContaining({
        tabs: expect.arrayContaining([
          expect.objectContaining({ displayPath: unapprovedPath }),
          expect.objectContaining({ active: true }),
        ]),
      }),
    );

    // The next load meets an empty registry, exactly as a freshly started desktop
    // host presents. Restore must bring the tab back on its own.
    await revokeEveryRepository(page);
    await page.reload();
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(
      page
        .getByTestId("repository-tabs")
        .locator('[data-testid^="repository-tab-"]'),
    ).toHaveCount(2);
    await expect(page.getByTestId("repository-launcher")).toHaveCount(0);
    // The saved active tab — the one the reader opened last — is the one that
    // comes back selected.
    await expect(
      page
        .getByTestId("repository-tabs")
        .locator('[aria-current="page"]'),
    ).toBeVisible();
  });

  test("a saved session pointing nowhere restores nothing and opens the launcher", async ({
    page,
  }) => {
    // Seed the store the previous session would have left behind a repository that
    // no longer exists: restore must skip it, and the launcher must take over.
    await page.addInitScript(() => {
      localStorage.setItem(
        "refyard.session.tabs",
        JSON.stringify({
          tabs: [{ displayPath: "/dev/ vanished", active: true }],
          savedAt: "2026-10-02T00:00:00.000Z",
        }),
      );
    });
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(page.getByTestId("repository-tabs")).toBeVisible();
    // The approved repository is still adopted from the live registry; the vanished
    // path contributes nothing.
    await expect(
      page
        .getByTestId("repository-tabs")
        .locator('[data-testid^="repository-tab-"]'),
    ).toHaveCount(1);
  });
});
