/**
 * Creating a repository, end to end through the panel.
 *
 * The two cases are the ones a wrong implementation gets wrong in a way a user would
 * feel: the repository must exist on disk where the destination said, and it must be
 * the repository the page is now working in — a create that leaves the user looking at
 * the previous repository is a create that did not finish. The clone case uses a local
 * bare remote, so nothing here touches a network.
 *
 * The service runs with its own state directory (`startE2eService`), the same way the
 * other specs do, so a run cannot inherit another run's registry.
 */
import { expect, test } from "@playwright/test";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createBareRemote,
  createRepo,
  type BareRemoteFixture,
  type GitFixtureRepo,
} from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test.describe("repository creation", () => {
  let repo: GitFixtureRepo;
  let remote: BareRemoteFixture | null = null;
  let service: E2eService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await remote?.dispose();
    remote = null;
    await repo.dispose();
  });

  test("creates a repository at the destination and moves the page to it", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await page.getByTestId("workbench-nav-repositories").click();
    await expect(page.getByTestId("repository-panel")).toBeVisible();

    await page.getByTestId("repository-destination").fill("e2e-created");
    // The branch is pinned rather than left empty. An empty field means "Git's own
    // default on this machine", and that is `main` only where somebody configured it:
    // this spec asserted `main` and passed on macOS, where the developer's global
    // config said so, then failed on a Linux box whose config says nothing and got
    // `master`. What the default *is* is covered where it can be compared against Git
    // itself (the integration suite runs a real `git init` and compares).
    await page.getByLabel("initial branch").fill("main");
    await page.getByTestId("repository-submit").click();
    await expect(page.getByTestId("repository-message-result")).toContainText(
      /created a repository at e2e-created/,
    );

    // On disk: a repository, whose HEAD names the branch that was asked for.
    expect(await exists(join(repo.root, "e2e-created", ".git", "HEAD"))).toBe(
      true,
    );
    const head = new TextDecoder()
      .decode(
        await repo.git([
          "-C",
          join(repo.root, "e2e-created"),
          "symbolic-ref",
          "--short",
          "HEAD",
        ]),
      )
      .trim();
    expect(head).toBe("main");

    // The page is working in the new repository, not merely listing it: the list marks
    // it as the selected one, which is what every panel below reads from.
    await expect(
      page.getByRole("button", { name: /e2e-created no commits/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("clones a local bare remote and shows what Git said when it refuses", async ({
    page,
  }) => {
    remote = await createBareRemote();
    await repo.git(["push", "--quiet", remote.path, "main"]);
    await page.goto(service.pairingUrl);
    await page.getByTestId("workbench-nav-repositories").click();
    await expect(page.getByTestId("repository-panel")).toBeVisible();

    // First: a destination that already holds the user's files. Git refuses it, and the
    // panel must show *that* — not a rewritten failure, and not a silent success.
    await repo.write("occupied/keep.txt", "mine\n");
    await expect(page.getByTestId("repository-mode-clone")).toBeEnabled();
    await page.getByTestId("repository-mode-clone").click();
    await page.getByTestId("repository-destination").fill("occupied");
    await page.getByTestId("repository-remote-url").fill(remote.path);
    await page.getByTestId("repository-submit").click();
    await expect(page.getByTestId("repository-message-result")).toContainText(
      /empty/i,
    );
    // Nothing was deleted to make room.
    expect(await repo.readText("occupied/keep.txt")).toBe("mine\n");

    // Then the same remote into a free destination: the clone lands, and the page moves
    // to it.
    await page.getByTestId("repository-destination").fill("e2e-cloned");
    await page.getByTestId("repository-submit").click();
    await expect(page.getByTestId("repository-message-result")).toContainText(
      /cloned/,
    );
    expect(await repo.readText("e2e-cloned/a.txt")).toBe("base\n");
    await expect(
      page.getByRole("button", { name: /e2e-cloned main/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("keeps the selected clone form when the browser briefly goes offline", async ({
    page,
    context,
  }) => {
    // Prevents: a transient browser signal destroys the panel and silently loses the
    // user's selected mode and any remote/destination values.
    await page.goto(service.pairingUrl);
    await page.getByTestId("workbench-nav-repositories").click();
    await expect(page.getByTestId("repository-panel")).toBeVisible();
    await expect(page.getByTestId("repository-mode-clone")).toBeEnabled();
    await page.getByTestId("repository-mode-clone").click();
    await page.getByTestId("repository-remote-url").fill("/tmp/example.git");

    await context.setOffline(true);
    await expect(page.getByTestId("connection-state")).toContainText("offline");
    await context.setOffline(false);

    await expect(page.getByTestId("repository-mode-clone")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("repository-remote-url")).toHaveValue(
      "/tmp/example.git",
    );
  });

  test("approves and revokes a repository from the managed-access panel", async ({
    page,
  }) => {
    const second = await createRepo({ initialCommit: true });
    try {
      const secondPath = await realpath(second.root);
      // Prevents: the UI inventing candidates or changing a live grant without an
      // explicit path approval, and prevents revocation from leaving the row readable.
      await page.goto(service.pairingUrl);
      await page.getByTestId("workbench-nav-repositories").click();
      await expect(page.getByTestId("repository-access-panel")).toBeVisible();
      await page.getByTestId("repository-register-path").fill(secondPath);
      await page.getByTestId("repository-register").click();
      await expect(page.getByTestId("repository-access-message")).toContainText(
        /approved/,
      );

      const row = page
        .locator('[data-testid^="repository-access-row-"]')
        .filter({ hasText: secondPath });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Revoke" }).click();
      await expect(page.getByTestId("repository-access-message")).toContainText(
        /revoked/,
      );
      await expect(row).toHaveCount(0);
    } finally {
      await second.dispose();
    }
  });
});
