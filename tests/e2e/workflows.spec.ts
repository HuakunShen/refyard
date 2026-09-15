/**
 * T12 end to end: a merge that stops, and the two ways out of it.
 *
 * The cases are the ones where a merge is not a single button: a divergent merge
 * leaves the workbench in a state the user must be able to see and act on. The
 * conflict panel has to name the conflicted path, refuse to continue while it is
 * unmerged, and let the merge be aborted — with the repository restored on disk, not
 * just in the UI.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

interface RunningService {
  readonly pairingUrl: string;
  stop(): Promise<void>;
}

test.describe("merge workbench", () => {
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

  /** `a.txt` diverges on `other`; returns the branch to merge in. */
  async function diverge(): Promise<string> {
    await repo.git(["switch", "-c", "other"]);
    await repo.write("a.txt", "other\n");
    await repo.commitAll("other");
    await repo.git(["switch", "main"]);
    await repo.write("a.txt", "main\n");
    await repo.commitAll("main");
    return "other";
  }

  test("stops on a conflict, then continues after the path is staged", async ({
    page,
  }) => {
    const other = await diverge();
    await page.goto(service.pairingUrl);

    await page.getByTestId(`merge-${other}`).click();
    // The panel names the conflict and the path, and the merge stays in progress.
    await expect(page.getByTestId("conflict-panel")).toBeVisible();
    await expect(page.getByTestId("conflicted-paths")).toContainText("a.txt");
    await expect(page.getByTestId("continue-merge")).toBeDisabled();

    // Resolution happens outside the workbench — that is the flow the panel states.
    await repo.write("a.txt", "resolved\n");
    await page.getByTestId("select-all").click();
    await page.getByTestId("stage-selected").click();
    // Once nothing is conflicted, the continue button is available.
    await expect(page.getByTestId("conflicted-paths")).toHaveCount(0);
    await page.getByTestId("continue-merge").click();
    await expect(page.getByTestId("conflict-message-result")).toContainText(
      /continued the merge/,
    );
    // The panel stays to show the outcome; what must be gone is the merge state.
    await expect(page.getByTestId("continue-merge")).toHaveCount(0);
    await expect(page.getByTestId("conflicted-paths")).toHaveCount(0);

    expect(await repo.readText("a.txt")).toEqual("resolved\n");
    const parents = new TextDecoder()
      .decode(await repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]))
      .trim()
      .split(" ");
    expect(parents.length).toBe(3);
  });

  test("aborts a conflicted merge and restores the branch on disk", async ({
    page,
  }) => {
    const other = await diverge();
    const before = (await repo.headOid()).trim();
    await page.goto(service.pairingUrl);

    await page.getByTestId(`merge-${other}`).click();
    await expect(page.getByTestId("conflict-panel")).toBeVisible();

    // Aborting is two steps: the first one arms, and the merge is still in progress
    // (Head does not move during a conflicted merge, so the panel is the evidence).
    await page.getByTestId("abort-merge").click();
    await expect(page.getByTestId("conflict-panel")).toBeVisible();
    await expect(page.getByTestId("conflicted-paths")).toContainText("a.txt");

    await page.getByTestId("abort-merge-confirm").click();
    await expect(page.getByTestId("conflict-message-result")).toContainText(
      /aborted the merge/,
    );
    // The panel stays to show the outcome; what must be gone is the merge state.
    await expect(page.getByTestId("abort-merge")).toHaveCount(0);
    await expect(page.getByTestId("conflicted-paths")).toHaveCount(0);
    expect((await repo.headOid()).trim()).toEqual(before);
    expect(await repo.readText("a.txt")).toEqual("main\n");
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
