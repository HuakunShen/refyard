/** Conflict recovery controls follow each advertised capability, including partial hosts. */
import { expect, test } from "@playwright/test";
import { capabilitiesResponseSchema } from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

// These cases vary the capability response; the worker must not intercept those requests.
test.use({ serviceWorkers: "block" });

test.describe("conflict recovery capabilities", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let originalHead: string;
  let upstream: string;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    await repo.git(["switch", "-c", "other"]);
    await repo.write("a.txt", "other\n");
    upstream = await repo.commitAll("other");
    await repo.git(["switch", "main"]);
    await repo.write("a.txt", "main\n");
    originalHead = await repo.commitAll("main");
    const conflict = await repo.gitResult(["rebase", "other"]);
    expect(conflict.code).toBe(1);
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  for (const scenario of [
    {
      name: "both rebase recovery operations without merge",
      kinds: ["continueRebase", "abortRebase"],
      canContinue: true,
      canAbort: true,
    },
    {
      name: "merge capability without rebase recovery",
      kinds: ["merge"],
      canContinue: false,
      canAbort: false,
    },
    {
      name: "abort-only rebase recovery",
      kinds: ["abortRebase"],
      canContinue: false,
      canAbort: true,
    },
    {
      name: "continue-only rebase recovery",
      kinds: ["continueRebase"],
      canContinue: true,
      canAbort: false,
    },
  ]) {
    test(`shows exactly the available actions for ${scenario.name}`, async ({
      page,
    }) => {
      // Prevents a merge-centric gate hiding rebase recovery, or promising a missing continue/abort capability.
      await page.route("**/api/v1/capabilities", async (route) => {
        const response = await route.fetch();
        const capabilities = capabilitiesResponseSchema.parse(
          await response.json(),
        );
        await route.fulfill({
          response,
          json: {
            ...capabilities,
            operations: capabilities.operations.filter((operation) =>
              scenario.kinds.includes(operation.kind),
            ),
          },
        });
      });
      await page.goto(service.pairingUrl);
      const panel = page.getByTestId("conflict-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("rebase in progress");
      await expect(page.getByTestId("conflicted-paths")).toContainText("a.txt");
      const continueButton = page.getByTestId("continue-merge");
      const abortButton = page.getByTestId("abort-merge");
      await expect(continueButton).toHaveCount(scenario.canContinue ? 1 : 0);
      await expect(abortButton).toHaveCount(scenario.canAbort ? 1 : 0);

      if (scenario.canContinue) {
        await expect(continueButton).toBeDisabled();
      }
      if (!scenario.canContinue && !scenario.canAbort) {
        await expect(page.getByTestId("foreign-operation-note")).toBeVisible();
        expect(await repo.headOid()).toBe(upstream);
      } else if (scenario.canAbort) {
        await abortButton.click();
        await expect(panel).toContainText("rebase in progress");
        await page.getByTestId("abort-merge-confirm").click();
        await expect(page.getByTestId("conflict-message-result")).toContainText(
          "aborted the rebase",
        );
        await expect(abortButton).toHaveCount(0);
        expect(await repo.headOid()).toBe(originalHead);
        expect(await repo.readText("a.txt")).toBe("main\n");
      } else {
        await repo.write("a.txt", "resolved\n");
        await repo.git(["add", "--", "a.txt"]);
        await expect(continueButton).toBeEnabled();
        await continueButton.click();
        await expect(page.getByTestId("conflict-message-result")).toContainText(
          "continued the rebase",
        );
        await expect(continueButton).toHaveCount(0);
        expect(await repo.readText("a.txt")).toBe("resolved\n");
        expect(
          new TextDecoder()
            .decode(await repo.git(["rev-parse", "HEAD^"]))
            .trim(),
        ).toBe(upstream);
      }
    });
  }
});
