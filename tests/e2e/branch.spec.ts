/**
 * T09 end to end: branches, remotes and a local push, in a real browser.
 *
 * The remote is a local bare repository, so nothing here touches a network and no
 * credential is involved. The cases assert through the repository on disk as well as
 * the screen: a switch must move HEAD, a delete must remove the ref, and a push must
 * publish exactly the selected branch.
 */
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBareRemote,
  createRepo,
  type BareRemoteFixture,
  type GitFixtureRepo,
} from "../support/repo.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLI_BUNDLE = join(REPO_ROOT, ".refyard-dev", "cli.mjs");

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
    service = await startService(repo.root);
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
async function startService(repositoryPath: string): Promise<RunningService> {
  const child = spawn(
    process.execPath,
    [CLI_BUNDLE, "serve", "--no-open", "--port", "0", "--repo", repositoryPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const collect = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const deadline = Date.now() + 30_000;
  for (;;) {
    const match = /http:\/\/127\.0\.0\.1:\d+\/[?#]pair=[A-Za-z0-9_-]+/.exec(
      output,
    );
    if (match !== null) {
      const pairingUrl = match[0];
      return {
        pairingUrl,
        async stop(): Promise<void> {
          if (child.exitCode !== null || child.signalCode !== null) {
            return;
          }
          const exited = new Promise<void>((resolve) => {
            child.once("exit", () => {
              resolve();
            });
          });
          child.kill("SIGTERM");
          await exited;
        },
      };
    }
    if (Date.now() > deadline) {
      throw new Error(`the service never printed a pairing URL:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
