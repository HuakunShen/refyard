/**
 * End-to-end merge and rebase conflicts, with both ways out of each operation.
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

test.describe("conflict workbench", () => {
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
    await page.getByTestId("workbench-nav-branches").click();

    await page.getByTestId(`merge-${other}`).click();
    // A stopped merge pulls the sidebar back to Working Copy, where conflict + staging live.
    await expect(
      page.getByTestId("workbench-nav-working-copy"),
    ).toHaveAttribute("aria-current", "page");
    // The panel names the conflict and the path, and the merge stays in progress.
    await expect(page.getByTestId("conflict-panel")).toBeVisible();
    await expect(page.getByTestId("conflicted-paths")).toContainText("a.txt");
    await expect(page.getByTestId("continue-merge")).toBeDisabled();

    // Resolution happens outside the workbench — that is the flow the panel states.
    await repo.write("a.txt", "resolved\n");
    await page
      .getByRole("button", { name: "Stage a.txt", exact: true })
      .click();
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
    await page.getByTestId("workbench-nav-branches").click();

    await page.getByTestId(`merge-${other}`).click();
    await expect(
      page.getByTestId("workbench-nav-working-copy"),
    ).toHaveAttribute("aria-current", "page");
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
  test("continues a conflicted rebase after staging the resolution", async ({
    page,
  }) => {
    // Prevents the rebase continue button from submitting continueMerge and stranding the replay.
    await diverge();
    const upstream = new TextDecoder()
      .decode(await repo.git(["rev-parse", "other"]))
      .trim();
    await page.goto(service.pairingUrl);
    await page
      .getByTestId("commit-ref-refs/heads/other")
      .click({ button: "right" });
    await page
      .getByTestId("commit-ref-context-refs/heads/other-rebase-onto")
      .click();
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "rebase in progress",
    );
    const continueButton = page.getByTestId("continue-merge");
    await expect(continueButton).toHaveText("Continue rebase");
    await expect(continueButton).toBeDisabled();

    await repo.write("a.txt", "resolved rebase\n");
    await page
      .getByRole("button", { name: "Stage a.txt", exact: true })
      .click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(page.getByTestId("conflict-message-result")).toContainText(
      "continued the rebase",
    );
    await expect(continueButton).toHaveCount(0);
    expect(await repo.readText("a.txt")).toBe("resolved rebase\n");
    expect(
      new TextDecoder().decode(await repo.git(["rev-parse", "HEAD^"])).trim(),
    ).toBe(upstream);
    expect(
      new TextDecoder()
        .decode(await repo.git(["log", "-1", "--format=%s"]))
        .trim(),
    ).toBe("main");
    expect(
      new TextDecoder()
        .decode(await repo.git(["branch", "--show-current"]))
        .trim(),
    ).toBe("main");
  });

  test("aborts a conflicted rebase after confirmation and restores the original branch", async ({
    page,
  }) => {
    // Prevents the rebase abort button from submitting abortMerge and leaving a detached conflicted HEAD.
    await diverge();
    const originalHead = await repo.headOid();
    await page.goto(service.pairingUrl);
    await page
      .getByTestId("commit-ref-refs/heads/other")
      .click({ button: "right" });
    await page
      .getByTestId("commit-ref-context-refs/heads/other-rebase-onto")
      .click();
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "rebase in progress",
    );
    await page.getByTestId("abort-merge").click();
    await expect(page.getByTestId("conflicted-paths")).toContainText("a.txt");
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "rebase in progress",
    );
    await page.getByTestId("abort-merge-confirm").click();
    await expect(page.getByTestId("conflict-message-result")).toContainText(
      "aborted the rebase",
    );
    await expect(page.getByTestId("abort-merge")).toHaveCount(0);
    await expect(page.getByTestId("conflicted-paths")).toHaveCount(0);
    expect(await repo.headOid()).toBe(originalHead);
    expect(await repo.readText("a.txt")).toBe("main\n");
    expect(
      new TextDecoder()
        .decode(await repo.git(["branch", "--show-current"]))
        .trim(),
    ).toBe("main");
  });
  for (const operation of ["merge", "cherry-pick", "rebase"]) {
    test(`localizes ${operation} conflict controls and abort confirmation in Chinese`, async ({
      page,
    }) => {
      // Prevents a Chinese UI from leaving conflict recovery controls and destructive confirmation in English.
      await diverge();
      const originalHead = await repo.headOid();
      const started = await repo.gitResult([operation, "other"]);
      expect(started.code).toBe(1);
      await page.goto(service.pairingUrl);
      await page.getByTestId("settings-open").click();
      await page.getByTestId("settings-language-zh").click();
      const operationName =
        operation === "merge"
          ? "合并"
          : operation === "rebase"
            ? "变基"
            : "摘取";
      const panel = page.getByTestId("conflict-panel");
      await expect(panel).toContainText(`${operationName}进行中`);
      await expect(panel).toContainText("1 个冲突文件");
      await expect(panel).toContainText("阶段 1/2/3");
      await expect(panel).toContainText("在 Refyard 外解决这些文件的冲突");
      await expect(page.getByTestId("continue-merge")).toHaveText(
        `继续${operationName}`,
      );
      await expect(page.getByTestId("continue-merge")).toBeDisabled();
      await expect(page.getByTestId("abort-merge")).toHaveText(
        `中止${operationName}`,
      );
      await page.getByTestId("abort-merge").click();
      await expect(panel).toContainText("恢复操作开始时的提交和暂存区。");
      await expect(page.getByTestId("abort-merge-confirm")).toHaveText(
        "中止并恢复到开始时的状态",
      );
      await page.getByTestId("abort-merge-confirm").click();
      await expect(page.getByTestId("abort-merge")).toHaveCount(0);
      expect(await repo.headOid()).toBe(originalHead);
      expect(await repo.readText("a.txt")).toBe("main\n");
    });
  }
  test("requires a new abort confirmation when the sequencer operation changes", async ({
    page,
  }) => {
    // Prevents confirmation for one operation from silently aborting a different externally started operation.
    await diverge();
    expect((await repo.gitResult(["rebase", "other"])).code).toBe(1);
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "rebase in progress",
    );
    await page.getByTestId("abort-merge").click();
    await expect(page.getByTestId("abort-merge-confirm")).toBeVisible();
    await repo.git(["rebase", "--abort"]);
    expect((await repo.gitResult(["merge", "other"])).code).toBe(1);
    await expect(page.getByTestId("conflict-panel")).toContainText(
      "merge in progress",
    );
    await expect(page.getByTestId("abort-merge-confirm")).toHaveCount(0);
    await expect(page.getByTestId("abort-merge")).toHaveText("Abort merge");
    await page.getByTestId("abort-merge").click();
    await page.getByTestId("abort-merge-confirm").click();
    await expect(page.getByTestId("conflict-message-result")).toContainText(
      "aborted the merge",
    );
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
