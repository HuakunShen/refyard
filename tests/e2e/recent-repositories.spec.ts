/**
 * The launcher's Recent list records what the user actually opened.
 *
 * Opening a repository through the launcher is the act a recent entry exists for: the
 * opened repository must appear in the list the next time the launcher is shown, and it
 * must still be there after a reload, because the list lives in `localStorage` — the one
 * store a pairing ticket's single use and a reload both leave alone. Everything here is
 * the shipped article: the built CLI, the built static bundle, and a second fixture
 * repository the service has never approved, opened exactly the way a user opens one.
 *
 * The desktop host reports every repository under a target id — this machine's
 * included — where the Node service names only the repositories that really live
 * elsewhere. The second flow serves that published shape at its published routes, so a
 * locally opened repository is remembered there too, not only where the list happens to
 * omit the target.
 */
import { expect, test, type Page } from "@playwright/test";
import { realpath } from "node:fs/promises";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

const LOCAL_TARGET_ID = "tgt_e2eLocal";

/** Reads the page's own recent-repositories store, as the app wrote it. */
async function readRecentStore(page: Page): Promise<unknown[]> {
  const raw = await page.evaluate(() =>
    localStorage.getItem("refyard.recent.repositories"),
  );
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Rewrites a real repositories answer so every row carries the local target id, the
 * way a host that places this machine's repositories under their own target reports
 * them. Nothing else in the answer is touched.
 */
function withEveryRepositoryOnLocalTarget(
  body: unknown,
  targetId: string,
): unknown {
  if (typeof body !== "object" || body === null) return body;
  const repositories = Reflect.get(body, "repositories");
  if (!Array.isArray(repositories)) return body;
  return {
    ...body,
    repositories: repositories.map((row) =>
      typeof row === "object" && row !== null ? { ...row, targetId } : row,
    ),
  };
}

/** Opens the launcher and opens one real path through it, waiting for its tab. */
async function openSecondRepositoryThroughLauncher(
  page: Page,
  path: string,
): Promise<void> {
  await page.getByTestId("new-repository-tab").click();
  await expect(page.getByTestId("repository-launcher")).toBeVisible();
  await page.getByLabel("Local repository path").fill(path);
  await page.getByTestId("launcher-open").click();
  // The open lands: the unapproved repository gets its own tab and the launcher
  // closes, which is the flow the user sees work.
  await expect(
    page
      .getByTestId("repository-tabs")
      .locator('[data-testid^="repository-tab-"]'),
  ).toHaveCount(2);
  await expect(page.getByTestId("repository-launcher")).toHaveCount(0);
}

test.describe("recent repositories", () => {
  let approved: GitFixtureRepo;
  let unapproved: GitFixtureRepo;
  let unapprovedPath: string;
  let service: E2eService;

  test.beforeEach(async () => {
    approved = await createRepo({ initialCommit: true });
    // A real repository the service never heard of: the launcher's Open is what
    // approves it, and it is the open a recent entry is supposed to record.
    unapproved = await createRepo({ initialCommit: true });
    unapprovedPath = await realpath(unapproved.root);
    service = await startE2eService({ repo: approved });
  });

  test.afterEach(async () => {
    await service.stop();
    await unapproved.dispose();
    await approved.dispose();
  });

  test("records a repository opened through the launcher and keeps it across a reload", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    // The approved repository's tab exists and holds the launcher shut; the tab bar
    // being present is what says the first repository list has landed.
    await expect(page.getByTestId("repository-tabs")).toBeVisible();

    await openSecondRepositoryThroughLauncher(page, unapprovedPath);

    // The store must hold the opened repository — this is the mechanism a reload
    // later depends on, so it is asserted directly rather than inferred from the UI.
    expect(await readRecentStore(page)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayPath: unapprovedPath }),
      ]),
    );

    // Reopening the launcher lists the repository just opened.
    await page.getByTestId("new-repository-tab").click();
    await expect(
      page.getByTestId("repository-launcher").getByText(unapprovedPath),
    ).toBeVisible();

    // The entry survives a reload: localStorage holds it, and the remembered session
    // reconnects the page without spending a second ticket.
    await page.reload();
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(page.getByTestId("repository-tabs")).toBeVisible();
    await page.getByTestId("new-repository-tab").click();
    await expect(
      page.getByTestId("repository-launcher").getByText(unapprovedPath),
    ).toBeVisible();
    expect(await readRecentStore(page)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayPath: unapprovedPath }),
      ]),
    );
  });

  test.describe("when the host names every repository's target", () => {
    test.use({ serviceWorkers: "block" });

    test("records a locally opened repository that carries the local target id", async ({
      page,
    }) => {
      // The fake is the desktop host's published shape at the routes the page really
      // calls; the registration, the filesystem read and the Git reads stay real. A
      // repository whose target is this machine is still opened on this machine, so
      // the target id must not stop it being remembered.
      await page.route("**/api/v1/host/capabilities", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sshConfig: false,
            localFolderPicker: false,
            uncertainOperationAcknowledgement: false,
            targetKinds: ["local"],
          }),
        });
      });
      await page.route("**/api/v1/host/ssh-hosts", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hosts: [],
            warnings: [],
            revision: "rev-e2e-local-1",
          }),
        });
      });
      await page.route("**/api/v1/host/targets", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              targetId: LOCAL_TARGET_ID,
              kind: "local",
              label: "This machine",
              state: "ready",
              remotePathBrowse: false,
              generation: "gen-e2e-local-1",
            },
          ]),
        });
      });
      await page.route("**/api/v1/repositories**", async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          status: response.status(),
          contentType: "application/json",
          body: JSON.stringify(
            withEveryRepositoryOnLocalTarget(
              await response.json(),
              LOCAL_TARGET_ID,
            ),
          ),
        });
      });

      await page.goto(service.pairingUrl);
      await expect(page.getByTestId("build-badge")).toBeVisible();
      await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
      await expect(page.getByTestId("repository-tabs")).toBeVisible();

      await openSecondRepositoryThroughLauncher(page, unapprovedPath);

      // The store must hold the opened repository even though the host reported it
      // under this machine's own target id — asserted directly, because the store is
      // the mechanism a reload depends on.
      expect(await readRecentStore(page)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ displayPath: unapprovedPath }),
        ]),
      );

      // Reopening the launcher lists the repository just opened, and the entry
      // survives a reload.
      await page.getByTestId("new-repository-tab").click();
      await expect(
        page.getByTestId("repository-launcher").getByText(unapprovedPath),
      ).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("build-badge")).toBeVisible();
      await expect(page.getByTestId("repository-tabs")).toBeVisible();
      await page.getByTestId("new-repository-tab").click();
      await expect(
        page.getByTestId("repository-launcher").getByText(unapprovedPath),
      ).toBeVisible();
      expect(await readRecentStore(page)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ displayPath: unapprovedPath }),
        ]),
      );
      // Closing the page stops its background polls before the service stops; a route
      // that fetches through must not outlive the origin it fetches from.
      await page.close();
    });
  });
});
