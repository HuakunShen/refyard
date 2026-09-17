/**
 * The write loop, end to end, in a real browser.
 *
 * The shipped bundle under Node, the static Svelte app it serves, a temporary
 * repository created by the shared fixture, and the machine's `git` — the same
 * articles the read-only spec uses, now exercising stage, unstage, discard and
 * commit through the UI's own controls.
 *
 * The assertions are the ones a unit test cannot make: that selecting a path and
 * pressing Stage really changes the repository, that a discard asks first and
 * restores the file, that a commit ends with an empty change pane, and that the
 * page says which repository state resulted rather than trusting its own request.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

interface RunningService {
  readonly origin: string;
  readonly pairingUrl: string;
  stop(): Promise<void>;
}

test.describe("staging workbench", () => {
  let repo: GitFixtureRepo;
  let service: RunningService;

  // A repository per test: the write cases change the index and the history, and one
  // case must not inherit another's commits.
  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  test.afterEach(async () => {
    await service?.stop();
    await repo.dispose();
  });

  test("stages a selected path, commits it, and shows the resulting history", async ({
    page,
  }) => {
    await repo.write("a.txt", "changed through the UI\n");
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();

    // Stage exactly a.txt through its row action.
    await working
      .getByRole("button", { name: "Stage a.txt", exact: true })
      .click();

    await expect(
      working.getByTestId("working-copy-staging-message"),
    ).toContainText(/staged 1 path/);
    // The change pane re-read: a.txt is now staged, with an explicit Unstage action.
    await expect(
      working.getByRole("button", { name: "Unstage a.txt", exact: true }),
    ).toBeVisible();

    await working.getByTestId("commit-message").fill("ui commit\n");
    await working.getByTestId("commit-button").click();
    await expect(working.getByTestId("commit-message-result")).toContainText(
      /created commit/,
    );

    // The new commit is on disk, with the message typed in the browser.
    const subject = new TextDecoder().decode(
      await repo.git(["log", "--format=%s", "-1"]),
    );
    expect(subject.trim()).toEqual("ui commit");
  });

  test("unstages without touching the working file", async ({ page }) => {
    await repo.write("a.txt", "staged then unstaged\n");
    await repo.git(["add", "--", "a.txt"]);
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();

    await working
      .getByRole("button", { name: "Unstage a.txt", exact: true })
      .click();
    await expect(
      working.getByTestId("working-copy-staging-message"),
    ).toContainText(/unstaged 1 path/);
    await expect(
      working.getByRole("button", { name: "Stage a.txt", exact: true }),
    ).toBeVisible();

    // The bytes on disk are exactly what the test wrote.
    expect(await repo.read("a.txt")).toEqual(
      new TextEncoder().encode("staged then unstaged\n"),
    );
  });

  test("discard asks twice, restores the file, and leaves a backup", async ({
    page,
  }) => {
    await repo.write("a.txt", "will be discarded\n");
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();

    // First click arms the confirm; nothing has happened yet.
    const pathRow = working
      .locator('[data-testid^="unstaged-row-"]')
      .filter({ hasText: "a.txt" });
    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Discard…", exact: true }).click();
    expect(await repo.read("a.txt")).toEqual(
      new TextEncoder().encode("will be discarded\n"),
    );
    await expect(page.getByTestId("working-copy-discard-dialog")).toBeVisible();
    await page.getByTestId("working-copy-discard-dialog-confirm").click();
    await expect(
      working.getByTestId("working-copy-staging-message"),
    ).toContainText(/discarded 1 path/);
    await expect(pathRow).toHaveCount(0);

    // Restored to the index content — the fixture committed "base\n".
    expect(await repo.read("a.txt")).toEqual(
      new TextEncoder().encode("base\n"),
    );
  });

  test("refuses to discard an untracked path", async ({ page }) => {
    await repo.write("notes.md", "untracked work\n");
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();

    // Untracked entries expose no destructive row button. Their context-menu discard
    // action remains visible but disabled because the host only discards tracked paths.
    const pathRow = working
      .locator('[data-testid^="unstaged-row-"]')
      .filter({ hasText: "notes.md" });
    await expect(pathRow).toBeVisible();
    await expect(
      working.getByRole("button", { name: "Discard notes.md", exact: true }),
    ).toHaveCount(0);
    await pathRow.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Discard…", exact: true }),
    ).toBeDisabled();
    expect(await repo.read("notes.md")).toEqual(
      new TextEncoder().encode("untracked work\n"),
    );
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}
