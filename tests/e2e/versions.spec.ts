/**
 * T14 end to end: a bookmark pointing at a service that is not the one this tab paired with.
 *
 * The address is a preference, so this is the ordinary case, not an exotic one: the user
 * started refyard again, or started a second copy, or the port is now answering for
 * something else entirely. The dangerous behaviour is quiet reuse of a token that belongs
 * to another service — every read then fails as if the app were broken, and a write could
 * be answered by a service the user never intended to talk to.
 *
 * The spec drives the real scenario: pair with one service, replace it with another on the
 * *same address*, reload, and require the page to notice and ask for a new pairing.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

interface RunningService {
  readonly pairingUrl: string;
  readonly origin: string;
  readonly port: number;
  readonly instanceId: string;
  stop(): Promise<void>;
}

test.describe("a service that is not the one we paired with", () => {
  let repo: GitFixtureRepo;
  let first: RunningService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    first = await startService(repo, 0);
  });

  test.afterEach(async () => {
    await first.stop();
    await repo.dispose();
  });

  test("requires a new pairing when the instance behind the address changed", async ({
    page,
  }) => {
    await page.goto(first.pairingUrl);
    await expect(page.getByTestId("staging-panel")).toBeVisible();

    const paired = await page.evaluate(
      "sessionStorage.getItem('refyard.session.instance')",
    );
    expect(paired).toEqual(first.instanceId);

    // Same address, different service: the first one is gone and a second copy of
    // refyard is answering on the port its bookmark names.
    await first.stop();
    const second = await startService(repo, first.port);
    try {
      expect(second.instanceId).not.toEqual(first.instanceId);
      await page.reload();
      // The page notices: the stored token is gone and pairing is asked for again.
      await expect
        .poll(async () =>
          page.evaluate("sessionStorage.getItem('refyard.session.token')"),
        )
        .toBeNull();
      await expect(page.getByLabel("Pairing ticket")).toBeVisible();
      // And nothing is offered to write with.
      await expect(page.getByTestId("staging-panel")).toHaveCount(0);

      // Pairing with the new service works, which is what makes the refusal recoverable
      // rather than a dead end.
      await page.getByLabel("Pairing ticket").fill(second.pairingUrl);
      await page.getByRole("button", { name: "Pair" }).click();
      await expect(page.getByTestId("staging-panel")).toBeVisible();
      const nowPaired = await page.evaluate(
        "sessionStorage.getItem('refyard.session.instance')",
      );
      expect(nowPaired).toEqual(second.instanceId);
    } finally {
      await second.stop();
    }
  });
});

/** Start the CLI bundle against one repository; `port` 0 asks the OS for a free one. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(
  fixture: GitFixtureRepo,
  port: number,
): Promise<RunningService> {
  return startE2eService({ repo: fixture, port });
}
