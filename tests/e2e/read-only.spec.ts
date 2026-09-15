/**
 * The read-only loop, end to end, in a real browser.
 *
 * Everything here is the shipped article: the CLI's own bundle under Node, the static
 * Svelte bundle it serves, a temporary repository created by the shared fixture (its own
 * `HOME`, its own config, no network), and the machine's `git`. Nothing is stubbed, and no
 * test writes to a repository it did not create.
 *
 * The assertions are weighted towards what a unit test cannot see: that opening the
 * printed pairing URL really pairs, that the graph column stays aligned with the rows it
 * belongs to, and — the point of M1 — that no control on screen could change the
 * repository.
 *
 * A service is started per test because a pairing ticket is single use by design: sharing
 * one across tests would either fail or teach the suite to reuse a credential.
 */
import { expect, test } from "@playwright/test";
import { mkdir, rm, symlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLI_BUNDLE = join(REPO_ROOT, ".refyard-dev", "cli.mjs");
const WEB_BUILD = join(REPO_ROOT, "apps", "web", "build");
/** Where the CLI looks for a web build next to its own bundle. */
const STAGED_WEB = join(REPO_ROOT, ".refyard-dev", "web");

interface RunningService {
  readonly pairingUrl: string;
  stop(): Promise<void>;
}

test.beforeAll(async () => {
  await ensureBuilt();
});

test.describe("read-only workbench", () => {
  let repo: GitFixtureRepo;

  test.beforeAll(async () => {
    repo = await createRepo({ initialCommit: true });
    await repo.write("b.txt", "second\n");
    await repo.commitAll("second");
    // A modified tracked file and an untracked one, so the Changes pane has both kinds
    // and the diff pane has a real hunk rather than a synthesized file.
    await repo.write("a.txt", "base\nchanged\n");
    await repo.write("untracked.txt", "new file\n");
  });

  test.afterAll(async () => {
    await repo.dispose();
  });

  let service: RunningService;

  test.beforeEach(async () => {
    service = await startService(repo);
  });

  test.afterEach(async () => {
    await service.stop();
  });

  test("pairs by opening the printed URL and reads the repository", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);

    // Pairing happens on load; the header only renders once a session exists.
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

    // The two commits the fixture made.
    await expect(
      page.getByText("second", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("base", { exact: true }).first()).toBeVisible();

    // The graph drew real geometry for those rows. Scoped to the gutter: the header's
    // theme-toggle icon is also an svg, and its sun is literally a circle.
    const graphPaths = page.locator("svg[data-slot='graph-gutter'] path");
    expect(await graphPaths.count()).toBeGreaterThan(0);

    // Changed paths, in Git's own status letters. The path appears in both the
    // Changes list and the staging list; either is the pane rendering real status.
    await expect(page.getByText("untracked.txt").first()).toBeVisible();
    await expect(page.getByText("metadata only")).toHaveCount(0);
  });

  test("removes the spent ticket from the address bar", async ({ page }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();
    // Either spelling counts: a spent ticket must not survive a reload or a bookmark.
    expect(page.url()).not.toContain("pair=");
  });

  test("opens a commit's diff from the history list", async ({ page }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();

    await page
      .getByRole("button", { name: /second/ })
      .first()
      .click();

    // The detail pane names the commit that was clicked...
    await expect(page.getByText("committer", { exact: true })).toBeVisible();

    // ... its change set is listed without patches (the host bounds that on purpose) ...
    await expect(
      page.getByText("Patches are read one path at a time"),
    ).toBeVisible();

    // ... and selecting the file reads its patch: the commit added b.txt with one line.
    await page
      .getByRole("button", { name: /b\.txt/ })
      .first()
      .click();
    await expect(page.getByText("+second").first()).toBeVisible();
  });

  test("reads a changed path's diff when the path is selected", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();

    await page
      .getByRole("button", { name: /a\.txt/ })
      .first()
      .click();
    // The pane names which side of the change is being read...
    await expect(page.getByText("unstaged", { exact: true })).toBeVisible();
    // ... and the working-tree change against the index is a real hunk.
    await expect(page.getByText("+changed").first()).toBeVisible();
  });

  test("keeps the graph aligned with the row it belongs to", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();

    const row = await page
      .getByRole("button", { name: /second/ })
      .first()
      .boundingBox();
    const circle = await page
      .locator("svg[data-slot='graph-gutter'] circle")
      .first()
      .boundingBox();
    expect(row).not.toBeNull();
    expect(circle).not.toBeNull();
    if (row === null || circle === null) {
      return;
    }
    // One row height is shared by the virtualized list and the geometry; if the two ever
    // drift, the circle moves off its own row and this is where it shows up.
    const rowCentre = row.y + row.height / 2;
    const circleCentre = circle.y + circle.height / 2;
    expect(Math.abs(rowCentre - circleCentre)).toBeLessThanOrEqual(2);
  });

  test("offers a control only for an operation this build implements", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();

    // The badge states what is implemented, and the controls on screen match it: every
    // surface whose operations have effects is mounted, and a kind this build has no
    // effect for — cloning needs a workspace root this build cannot approve yet —
    // offers no control at all.
    await expect(page.getByText(/write operations/)).toBeVisible();
    for (const panel of [
      "staging-panel",
      "stash-panel",
      "tag-panel",
      "worktree-panel",
      "submodule-panel",
      "branch-panel",
    ]) {
      await expect(page.getByTestId(panel)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /^clone/i })).toHaveCount(0);
  });

  test("reports a bad ticket instead of pairing", async ({ page }) => {
    const origin = new URL(service.pairingUrl).origin;
    await page.goto(`${origin}/?pair=not-a-real-ticket`);

    await expect(page.getByText("Pairing failed")).toBeVisible();
    await expect(page.getByTestId("build-badge")).toHaveCount(0);
  });
});

/** Start the CLI bundle against one repository and wait for the pairing URL it prints. */
/** The service for this spec's fixture, on the fixture's own environment. */
async function startService(fixture: GitFixtureRepo): Promise<RunningService> {
  return startE2eService({ repo: fixture });
}

/**
 * The e2e run needs the CLI bundle and the web build, both produced by the commands the
 * plan lists before `pnpm test:e2e`. This only reports clearly when one is missing, so a
 * failure is never an unexplained browser error.
 */
async function ensureBuilt(): Promise<void> {
  for (const [label, path] of [
    ["the CLI bundle (bun scripts/bundle-cli.ts)", CLI_BUNDLE],
    ["the web build (pnpm build)", WEB_BUILD],
  ] as const) {
    try {
      await stat(path);
    } catch {
      throw new Error(
        `${label} is missing at ${path}; run the build before the e2e suite.`,
      );
    }
  }
  // The host serves a web build found next to its own bundle; staging a link keeps the
  // repository root clean and `.refyard-dev/` is already ignored.
  try {
    await stat(STAGED_WEB);
  } catch {
    await mkdir(dirname(STAGED_WEB), { recursive: true });
    await symlink(WEB_BUILD, STAGED_WEB, "dir");
  }
}

// Remove the staged link even if Playwright's worker is recycled before the suite ends.
process.on("exit", () => {
  void rm(STAGED_WEB, { force: true });
});
