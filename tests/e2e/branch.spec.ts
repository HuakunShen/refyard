/**
 * T09 end to end: branches, remotes and a local push, in a real browser.
 *
 * The remote is a local bare repository, so nothing here touches a network and no
 * credential is involved. The cases assert through the repository on disk as well as
 * the screen: a switch must move HEAD, a delete must remove the ref, and a push must
 * publish exactly the selected branch.
 */
import { expect, test } from "@playwright/test";
import {
  createBareRemote,
  createRepo,
  type BareRemoteFixture,
  type GitFixtureRepo,
} from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

interface RunningService {
  readonly pairingUrl: string;
  stop(): Promise<void>;
}

test.describe("branch workbench", () => {
  let repo: GitFixtureRepo;
  let remote: BareRemoteFixture;
  let service: RunningService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    remote = await createBareRemote();
    service = await startService(repo);
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
    await remote.dispose();
  });

  test("creates, switches and deletes a branch through the panel", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("branch-panel")).toBeVisible();

    await page.getByLabel("new branch name").fill("feature-e2e");
    await page.getByTestId("create-branch").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /created branch feature-e2e/,
    );
    // On disk: the branch exists and HEAD did not move.
    const branches = new TextDecoder().decode(
      await repo.git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
    );
    expect(branches).toContain("refs/heads/feature-e2e");

    // Switch to it; HEAD moves on disk.
    await page.getByTestId("switch-feature-e2e").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /switched to feature-e2e/,
    );
    const head = new TextDecoder()
      .decode(await repo.git(["symbolic-ref", "--short", "HEAD"]))
      .trim();
    expect(head).toEqual("feature-e2e");

    // Switch back, then delete the merged branch.
    await page.getByTestId("switch-main").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /switched to main/,
    );
    await page.getByTestId("delete-feature-e2e").click();
    await page.getByTestId("delete-feature-e2e-confirm").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /deleted branch feature-e2e/,
    );
    const remaining = new TextDecoder().decode(
      await repo.git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
    );
    expect(remaining).not.toContain("feature-e2e");
  });

  test("sets and clears the current branch upstream from observed remote refs", async ({
    page,
  }) => {
    // Prevents: advertising setBranchUpstream in capabilities while leaving users no
    // safe GUI path to choose one of the remote-tracking refs already on screen.
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["push", "origin", "main"]);
    await repo.git(["fetch", "origin"]);

    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("branch-panel")).toBeVisible();
    await page.getByTestId("edit-upstream-main").click();
    await page.getByLabel("upstream for main").selectOption("origin/main");
    await page.getByTestId("save-upstream-main").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "set main to track origin/main",
    );

    const configured = new TextDecoder()
      .decode(
        await repo.git([
          "for-each-ref",
          "--format=%(upstream:short)",
          "refs/heads/main",
        ]),
      )
      .trim();
    expect(configured).toEqual("origin/main");

    await page.getByTestId("edit-upstream-main").click();
    await page.getByLabel("upstream for main").selectOption("");
    await page.getByTestId("save-upstream-main").click();
    await expect(page.getByTestId("branch-message")).toContainText(/upstream/i);
    const cleared = new TextDecoder()
      .decode(
        await repo.git([
          "for-each-ref",
          "--format=%(upstream:short)",
          "refs/heads/main",
        ]),
      )
      .trim();
    expect(cleared).toEqual("");
  });

  test("renames a remote and edits its fetch and push URLs", async ({
    page,
  }) => {
    // Prevents: advertising updateRemote while leaving it backend-only, or submitting
    // redacted display URLs back to Git when an edit field is intentionally left blank.
    const originalPush = `${remote.path}-push`;
    const replacementFetch = `${remote.path}-fetch-replacement`;
    const replacementPush = `${remote.path}-push-replacement`;
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["remote", "set-url", "--push", "origin", originalPush]);

    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("remote-panel")).toBeVisible();
    await page.getByTestId("edit-remote-origin").click();
    await expect(page.getByLabel("remote name for origin")).toHaveValue(
      "origin",
    );
    await expect(page.getByLabel("fetch URL for origin")).toHaveValue("");
    await expect(page.getByLabel("push URL for origin")).toHaveValue("");

    await page.getByLabel("remote name for origin").fill("upstream");
    await page.getByLabel("fetch URL for origin").fill(replacementFetch);
    await page.getByTestId("save-remote-origin").click();
    await expect(page.getByTestId("remote-message")).toContainText(
      /updated remote origin/,
    );

    const names = new TextDecoder()
      .decode(await repo.git(["remote"]))
      .trim()
      .split("\n");
    expect(names).toEqual(["upstream"]);
    expect(
      new TextDecoder()
        .decode(await repo.git(["remote", "get-url", "upstream"]))
        .trim(),
    ).toEqual(replacementFetch);
    expect(
      new TextDecoder()
        .decode(await repo.git(["remote", "get-url", "--push", "upstream"]))
        .trim(),
    ).toEqual(originalPush);

    await page.getByTestId("edit-remote-upstream").click();
    await page.getByLabel("push URL for upstream").fill(replacementPush);
    await page.getByTestId("save-remote-upstream").click();
    await expect(page.getByTestId("remote-message")).toContainText(
      /updated remote upstream/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["remote", "get-url", "--push", "upstream"]))
        .trim(),
    ).toEqual(replacementPush);
  });

  test("pushes the current branch to the selected remote and nothing else", async ({
    page,
  }) => {
    await repo.git(["branch", "do-not-push"]);
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("remote-panel")).toBeVisible();

    await page
      .getByTestId("remote-panel")
      .getByLabel("remote name")
      .fill("origin");
    await page
      .getByTestId("remote-panel")
      .getByLabel("remote url")
      .fill(remote.path);
    await page.getByTestId("add-remote").click();
    await expect(page.getByTestId("remote-message")).toContainText(
      /added remote origin/,
    );

    await page.getByTestId("push-remote").click();
    await expect(page.getByTestId("remote-message")).toContainText(/pushed/);

    // Exactly one branch reached the remote.
    const heads = new TextDecoder().decode(
      await remote.git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
    );
    expect(heads).toContain("refs/heads/main");
    expect(heads).not.toContain("do-not-push");
  });

  test("keeps the push buttons disabled until a remote is selected", async ({
    page,
  }) => {
    await repo.git(["remote", "add", "origin", remote.path]);
    await repo.git(["remote", "add", "mirror", remote.path]);
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("remote-panel")).toBeVisible();

    // Two remotes, none selected: no default, so nothing can be published by accident.
    await expect(page.getByTestId("push-remote")).toBeDisabled();
    await page.getByLabel("select remote mirror").check();
    await expect(page.getByTestId("push-remote")).toBeEnabled();
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
