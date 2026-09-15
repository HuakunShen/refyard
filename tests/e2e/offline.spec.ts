/**
 * T14 end to end: what an offline page does, and what it must never do.
 *
 * The dangerous behaviour is the friendly one: queueing a write and sending it when the
 * network comes back. A page cannot know whether the request is still right after an
 * outage — the repository may have moved under it — so the rule is refuse, say so, and
 * forget. This spec drives the real UI offline and reads the host's own operation list
 * to prove that nothing was accepted.
 */
import { expect, test, type Page } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

interface RunningService {
  readonly pairingUrl: string;
  readonly origin: string;
  stop(): Promise<void>;
}

test.describe("an offline workbench", () => {
  let repo: GitFixtureRepo;
  let service: RunningService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  /**
   * How many operations this service has accepted, read from the host itself.
   *
   * The list is scoped to the calling session, so it answers exactly the question the
   * spec needs: did *this* page cause a write to be accepted?
   */
  async function acceptedOperations(page: Page): Promise<number> {
    // A string expression: the spec's own tsconfig has no DOM lib, and Playwright
    // evaluates it in the page anyway.
    const token = await page.evaluate(
      "sessionStorage.getItem('refyard.session.token')",
    );
    const response = await fetch(`${service.origin}/api/v1/operations`, {
      headers: { authorization: `Bearer ${token}`, origin: service.origin },
    });
    expect(response.status).toBe(200);
    const listed = (await response.json()) as { operations: unknown[] };
    return listed.operations.length;
  }

  test("starts a service whose operation list holds nothing from another run", async ({
    page,
  }) => {
    // Prevents: a spec's service running on the developer's real state root, replaying
    // the journal of every earlier run. The list has a page limit, so a polluted service
    // would report the same count before and after a click and "the count did not move"
    // would stop being evidence of anything.
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("staging-panel")).toBeVisible();
    expect(await acceptedOperations(page)).toBe(0);
  });

  test("refuses a write while offline and never replays it after reconnecting", async ({
    page,
    context,
  }) => {
    await repo.write("a.txt", "changed\n");
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("select-all")).toBeVisible();
    const before = await acceptedOperations(page);

    // The network drops while the page is loaded and usable: the case where a user
    // clicks a button that cannot reach the service.
    await context.setOffline(true);
    await page.getByTestId("select-all").click();
    await page.getByTestId("stage-selected").click();
    await expect(page.getByTestId("staging-message")).toContainText(/offline/i);

    await context.setOffline(false);
    await page.waitForTimeout(1_000);
    // Nothing was accepted during the outage and nothing arrived after it: a page that
    // had queued the stage would have replayed it here.
    expect(await acceptedOperations(page)).toEqual(before);
    expect(await repo.readText("a.txt")).toEqual("changed\n");
  });

  test("reloads from the cached shell while offline, and says it is not connected", async ({
    page,
    context,
  }) => {
    await repo.write("a.txt", "changed\n");
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("staging-panel")).toBeVisible();
    const before = await acceptedOperations(page);

    // The service worker has to be in control before the network goes away, or the
    // reload only proves that Chromium has a disk cache.
    // A string expression: no DOM lib in this tsconfig, and the page is what has the
    // service worker, not the test process.
    await page.evaluate("navigator.serviceWorker.ready");
    await context.setOffline(true);
    await page.reload();

    // The shell came from the cache and the page says what it is.
    await expect(page.getByTestId("connection-state")).toContainText(
      "not connected",
    );
    await expect(page.getByText("refyard")).toBeVisible();
    // With no data and no service, no write control is offered at all.
    await expect(page.getByTestId("stage-selected")).toHaveCount(0);

    await context.setOffline(false);
    await page.waitForTimeout(1_000);
    expect(await acceptedOperations(page)).toEqual(before);
    expect(await repo.readText("a.txt")).toEqual("changed\n");
  });

  test("stages the same path once the connection is back", async ({
    page,
    context,
  }) => {
    await repo.write("a.txt", "changed\n");
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("select-all")).toBeVisible();
    const before = await acceptedOperations(page);

    await context.setOffline(true);
    await page.getByTestId("select-all").click();
    await page.getByTestId("stage-selected").click();
    await expect(page.getByTestId("staging-message")).toContainText(/offline/i);

    await context.setOffline(false);
    // The user asks again, deliberately — and this time it is accepted.
    await page.getByTestId("select-all").click();
    await page.getByTestId("stage-selected").click();
    await expect(page.getByTestId("staging-message")).toContainText(/staged/i);
    expect(await acceptedOperations(page)).toBeGreaterThan(before);
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
