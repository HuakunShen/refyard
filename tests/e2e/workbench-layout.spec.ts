/**
 * The workbench sizes itself to the column it is given, and offers the divider that column
 * actually has.
 *
 * Two failures this pins, both reported from a real embedded panel:
 *
 * - **A resize handle that is not there.** The handles were keyed to a *viewport* media
 *   query, so a narrow column — an embedded panel, a small window — rendered the stacked
 *   layout with no handle at all, and the fixed row heights it stacked made the result
 *   unusable rather than merely unsized.
 * - **A divider that moves nothing.** The stacked layout's own divider had to exist, be the
 *   only one on screen, and persist: a panel the reader sized is a panel they expect to stay
 *   sized.
 *
 * Plus the embedded mode that goes with it: one repository, no strip of tabs for the others.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("Workbench layout", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("stacks with one draggable divider when the column is narrow", async ({
    page,
  }) => {
    // Prevents: a narrow column whose repository list cannot be resized at all, because the
    // handle it needed was hidden by a viewport rule while the layout it sized was stacked.
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(service.pairingUrl);

    const column = page.getByTestId("repository-column");
    await expect(column).toBeVisible();
    // The column handles size columns the stacked layout does not have.
    await expect(page.getByTestId("left-sidebar-resize-handle")).toBeHidden();
    await expect(page.getByTestId("right-sidebar-resize-handle")).toBeHidden();

    const divider = page.getByTestId("stacked-nav-resize-handle");
    await expect(divider).toBeVisible();

    const before = await column.boundingBox();
    const grip = await divider.boundingBox();
    if (before === null || grip === null) {
      throw new Error("the stacked column or its divider has no box");
    }
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2,
      grip.y + grip.height / 2 + 80,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    const after = await column.boundingBox();
    if (after === null) {
      throw new Error("the stacked column has no box after the drag");
    }
    expect(after.height).toBeGreaterThan(before.height + 40);

    // Sized once, sized after a reload.
    await page.reload();
    const restored = await page
      .getByTestId("repository-column")
      .boundingBox();
    if (restored === null) {
      throw new Error("the stacked column has no box after the reload");
    }
    expect(restored.height).toBeGreaterThan(before.height + 40);
  });

  test("keeps three columns and their side handles when the column is wide", async ({
    page,
  }) => {
    // Prevents: the stacked divider appearing beside the column layout, where it would move
    // a height the layout does not use.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(service.pairingUrl);

    await expect(page.getByTestId("left-sidebar-resize-handle")).toBeVisible();
    await expect(page.getByTestId("right-sidebar-resize-handle")).toBeVisible();
    await expect(page.getByTestId("stacked-nav-resize-handle")).toBeHidden();
    await expect(page.getByTestId("workbench-tabstrip")).toBeVisible();
  });

  test("shows one repository and no tab strip in single-repository mode", async ({
    page,
  }) => {
    // Prevents: an embedded panel listing every repository the service happens to know —
    // tabs for other Sessions' projects, and closed ones that come back.
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`${service.pairingUrl}&single=1`);

    await expect(page.getByTestId("workbench-single-repository")).toBeVisible();
    await expect(page.getByTestId("workbench-tabstrip")).toHaveCount(0);
    // The repository it is showing is named, not left blank.
    await expect(
      page.getByTestId("workbench-single-repository"),
    ).toContainText(repo.root.split("/").pop() ?? "");
  });

  test("fits every region in a narrow column instead of scrolling the panel", async ({
    page,
  }) => {
    // Prevents: the stacked workbench behaving like a long page — three regions each with a
    // fixed 44rem height inside a scrolling column, so the working copy and the commit box
    // sat below the fold of a panel the reader cannot scroll usefully. Each region scrolls
    // itself; the column itself does not.
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("history-panel")).toBeVisible();

    const overflow = await page
      .locator("main")
      .evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);

    for (const id of [
      "repository-column",
      "history-panel",
      "working-copy-panel",
    ]) {
      const box = await page.getByTestId(id).boundingBox();
      if (box === null) {
        throw new Error(`${id} has no box`);
      }
      expect(box.y + box.height).toBeLessThanOrEqual(901);
    }
  });

  test("keeps the diff and the working copy inside a narrow column", async ({
    page,
  }) => {
    // Prevents: opening a diff pushing the working copy — the only place to stage and commit
    // from — past the bottom of a panel that does not scroll as a whole.
    await repo.write("changed.txt", "changed\n");
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(service.pairingUrl);

    const working = page.getByTestId("working-copy-panel");
    await working
      .getByTestId("unstaged-files")
      .getByText("changed.txt", { exact: true })
      .click();

    const diff = page.getByTestId("main-diff-panel");
    await expect(diff).toBeVisible();
    await expect(diff).toContainText("changed.txt");

    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error("the viewport has no size");
    }
    for (const box of [
      await diff.boundingBox(),
      await working.boundingBox(),
    ]) {
      if (box === null) {
        throw new Error("a panel has no box");
      }
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  test("stays settled when the host names a repository that is not the first", async ({
    page,
  }) => {
    // Prevents: an infinite effect loop — and the frozen panel that comes with it — as soon
    // as the service knows more than one repository. The name the host gives is not the one
    // the list defaults to, so pinning the tabs to it while another effect kept re-adopting
    // the default made the two effects write each other's state forever.
    const second = await createRepo({ initialCommit: true });
    try {
      // A second repository has to exist before the pinned one can disagree with the default,
      // and one is registered by opening it.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(service.pairingUrl);
      await page.getByTestId("new-repository-tab").click();
      await expect(page.getByTestId("repository-launcher")).toBeVisible();
      await page.getByLabel("Local repository path").fill(second.root);
      await page.getByTestId("launcher-open").click();
      await expect(
        page
          .getByTestId("repository-tabs")
          .locator('[data-testid^="repository-tab-"]'),
      ).toHaveCount(2);

      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(String(error)));
      await page.setViewportSize({ width: 640, height: 900 });
      await page.goto(
        `${service.pairingUrl}&single=1&repo=${encodeURIComponent(second.root)}`,
      );

      await expect(page.getByTestId("workbench-single-repository")).toBeVisible();
      await expect(page.getByTestId("workbench-tabstrip")).toHaveCount(0);
      // The repository the host named, not whichever the list happens to start with.
      await expect(page.getByTestId("workbench-single-repository")).toContainText(
        second.root.split("/").pop() ?? "",
      );
      expect(failures).toEqual([]);

      // A settled panel still answers the pointer.
      const divider = page.getByTestId("stacked-nav-resize-handle");
      await expect(divider).toBeVisible();
      const before = await page.getByTestId("repository-column").boundingBox();
      const grip = await divider.boundingBox();
      if (before === null || grip === null) {
        throw new Error("the column or its divider has no box");
      }
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        grip.x + grip.width / 2,
        grip.y + grip.height / 2 + 80,
        { steps: 8 },
      );
      await page.mouse.up();
      const after = await page.getByTestId("repository-column").boundingBox();
      expect(after?.height ?? 0).toBeGreaterThan(before.height + 40);
    } finally {
      await second.dispose();
    }
  });

  test("collapses the repository column to an icon rail and gives the width to the graph", async ({
    page,
  }) => {
    // Prevents: a workbench column spending a third of its width on navigation labels when
    // the reader is there for the graph. Collapsing is the reader's answer, so it also has to
    // outlive the page.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(service.pairingUrl);

    const sidebar = page.getByTestId("repository-sidebar");
    const history = page.getByTestId("history-panel");
    await expect(sidebar).toBeVisible();
    const expanded = await sidebar.boundingBox();
    const cramped = await history.boundingBox();
    if (expanded === null || cramped === null) {
      throw new Error("the sidebar or the history has no box");
    }

    await page.getByTestId("repository-sidebar-toggle").click();

    const nav = page.getByTestId("workbench-nav");
    await expect(nav).toHaveAttribute("data-collapsed", "true");
    // The label is gone from the rail and kept as the accessible name — the control still
    // says what it is, to a pointer and to a screen reader.
    const workingCopy = page.getByTestId("workbench-nav-working-copy");
    await expect(workingCopy).toHaveAttribute("aria-label", "Working Copy");
    await expect(workingCopy).not.toContainText("Working Copy");

    const rail = await sidebar.boundingBox();
    const roomy = await history.boundingBox();
    if (rail === null || roomy === null) {
      throw new Error("the rail or the history has no box after collapsing");
    }
    expect(rail.width).toBeLessThan(80);
    expect(roomy.width).toBeGreaterThan(cramped.width + 150);
    // A column of icons, not a row clipped to the rail's width — the rail's own width says
    // nothing about which way its contents went.
    const railNav = await nav.boundingBox();
    if (railNav === null) {
      throw new Error("the rail navigation has no box");
    }
    expect(railNav.height).toBeGreaterThan(railNav.width);

    await page.reload();
    await expect(page.getByTestId("workbench-nav")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  test("collapses the stacked band so the history keeps the height", async ({
    page,
  }) => {
    // Prevents: the rail being a column-only idea — stacked, the navigation is a band across
    // the top, and that band is the height the graph is missing.
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(service.pairingUrl);

    const sidebar = page.getByTestId("repository-sidebar");
    const history = page.getByTestId("history-panel");
    await expect(sidebar).toBeVisible();
    const band = await sidebar.boundingBox();
    const shortHistory = await history.boundingBox();
    if (band === null || shortHistory === null) {
      throw new Error("the band or the history has no box");
    }

    await page.getByTestId("repository-sidebar-toggle").click();
    await expect(page.getByTestId("workbench-nav")).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    const rail = await sidebar.boundingBox();
    const tallHistory = await history.boundingBox();
    if (rail === null || tallHistory === null) {
      throw new Error("the rail or the history has no box after collapsing");
    }
    expect(rail.height).toBeLessThan(80);
    expect(tallHistory.height).toBeGreaterThan(shortHistory.height + 100);
    // A row of icons, not a column squeezed into a band.
    expect(rail.width).toBeGreaterThan(band.width - 2);
    const bandNav = await page.getByTestId("workbench-nav").boundingBox();
    if (bandNav === null) {
      throw new Error("the band navigation has no box");
    }
    expect(bandNav.width).toBeGreaterThan(bandNav.height);
  });
});
