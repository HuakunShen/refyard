/** Exercises graph and workbench context menus against isolated Git repositories. */
import { expect, test } from "@playwright/test";
import {
  createBareRemote,
  createRepo,
  type GitFixtureRepo,
} from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

test.describe("Git context menus", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let historicalOid: string;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    historicalOid = await repo.headOid();
    await repo.write("a.txt", "second\n");
    await repo.commitAll("second");
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("translates graph commit and ref menus when switching languages", async ({
    page,
  }) => {
    // Prevents graph actions retaining English after the user selects Chinese.
    await repo.git(["branch", "graph-ref", historicalOid]);
    await repo.git(["tag", "graph-tag", historicalOid]);
    const targetOid = await repo.headOid();
    await page.goto(service.pairingUrl);
    await page.getByTestId("settings-open").click();
    await page.getByTestId("settings-language-zh").click();
    await page
      .getByTestId(`commit-row-${targetOid}`)
      .click({ button: "right" });
    const menu = page.getByTestId(`commit-context-${targetOid}`);
    for (const [id, label] of [
      ["create-branch", "在此创建分支…"],
      ["create-tag", "在此创建标签…"],
      ["create-worktree", "从这里创建工作树…"],
      ["revert-commit", "还原提交…"],
      ["cherry-pick-commit", "摘取提交…"],
      ["drop-commit", "丢弃提交…"],
      ["reset-branch", "把分支重置到这里…"],
    ]) {
      await expect(
        menu.getByTestId(`commit-context-${targetOid}-${id}`),
      ).toHaveText(label);
    }
    await page.keyboard.press("Escape");
    await page
      .getByTestId("commit-ref-refs/heads/graph-ref")
      .click({ button: "right" });
    const prefix = "commit-ref-context-refs/heads/graph-ref";
    await expect(page.getByTestId(`${prefix}-checkout`)).toHaveText("切换分支");
    await expect(page.getByTestId(`${prefix}-merge`)).toHaveText(
      "将 graph-ref 合并到 main",
    );
    await expect(page.getByTestId(`${prefix}-rebase-onto`)).toHaveText(
      "将 main 变基到 graph-ref",
    );
    await expect(page.getByTestId(`${prefix}-delete`)).toHaveText("删除…");
    await page.keyboard.press("Escape");
    await page
      .getByTestId("commit-ref-refs/tags/graph-tag")
      .click({ button: "right" });
    await expect(
      page.getByTestId("commit-ref-context-refs/tags/graph-tag-delete"),
    ).toHaveText("删除…");
    await page.keyboard.press("Escape");
    await page.getByTestId("settings-open").click();
    await page.getByTestId("settings-language-en").click();
    await page
      .getByTestId(`commit-row-${targetOid}`)
      .click({ button: "right" });
    await expect(
      menu.getByTestId(`commit-context-${targetOid}-create-branch`),
    ).toHaveText("Create Branch Here…");
  });

  test("translates graph action dialogs and reset mode explanations", async ({
    page,
  }) => {
    // Prevents Chinese menus leading into untranslated mutation confirmations.
    await repo.git(["branch", "dialog-ref", historicalOid]);
    await repo.git(["tag", "dialog-tag", historicalOid]);
    const headOid = await repo.headOid();
    await page.goto(service.pairingUrl);
    await page.getByTestId("settings-open").click();
    await page.getByTestId("settings-language-zh").click();
    for (const [action, dialogId, title, explanation] of [
      ["create-branch", "commit-ref-dialog", "创建分支", "不切换 HEAD"],
      ["create-tag", "commit-ref-dialog", "创建标签", "指向此提交"],
      [
        "create-worktree",
        "commit-worktree-dialog",
        "创建工作树",
        "批准的根目录",
      ],
      ["revert-commit", "commit-revert-dialog", "还原", "新提交"],
      [
        "cherry-pick-commit",
        "commit-cherry-pick-dialog",
        "摘取",
        "原始提交说明和作者",
      ],
      ["drop-commit", "commit-drop-dialog", "丢弃", "改写历史"],
      ["reset-branch", "commit-reset-dialog", "将 main 重置", "工作区"],
      ["squash-commit", "commit-squash-dialog", "并入", "两个提交合为一个"],
    ]) {
      const oid =
        action === "squash-commit" || action === "drop-commit"
          ? headOid
          : historicalOid;
      await page.getByTestId(`commit-row-${oid}`).click({ button: "right" });
      await page.getByTestId(`commit-context-${oid}-${action}`).click();
      const dialog = page.getByTestId(dialogId);
      await expect(dialog.getByRole("heading")).toContainText(title);
      await expect(dialog).toContainText(explanation);
      if (action === "reset-branch") {
        await expect(
          page.getByTestId("commit-reset-dialog-mode-mixed"),
        ).toContainText("已暂存的改动变为未暂存");
        await expect(
          page.getByTestId("commit-reset-dialog-mode-soft"),
        ).toContainText("保持暂存区原样");
        await expect(
          page.getByTestId("commit-reset-dialog-confirm"),
        ).toHaveText("重置分支");
      }
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
    }
    for (const [ref, title, note] of [
      ["refs/heads/dialog-ref", "删除 dialog-ref？", "未合并的工作"],
      ["refs/tags/dialog-tag", "删除标签 dialog-tag？", "远端副本"],
    ]) {
      await page.getByTestId(`commit-ref-${ref}`).click({ button: "right" });
      await page.getByTestId(`commit-ref-context-${ref}-delete`).click();
      const dialog = page.getByTestId("commit-ref-delete-dialog");
      await expect(dialog.getByRole("heading")).toHaveText(title);
      await expect(dialog).toContainText(note);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
    }
    await page.getByTestId("settings-open").click();
    await page.getByTestId("settings-language-en").click();
    await page
      .getByTestId(`commit-row-${historicalOid}`)
      .click({ button: "right" });
    await page
      .getByTestId(`commit-context-${historicalOid}-reset-branch`)
      .click();
    await expect(
      page.getByTestId("commit-reset-dialog-mode-mixed"),
    ).toContainText("Staged work becomes unstaged");
    await expect(
      page.getByTestId("commit-reset-dialog-mode-soft"),
    ).toContainText("leaves the index exactly as it is");
  });

  test("explains commit-shape refusals before opening mutation dialogs", async ({
    page,
  }) => {
    // Prevents offering unsupported root drops or merge replay as confirmable operations.
    await repo.git(["branch", "menu-side", historicalOid]);
    const linearOid = await repo.headOid();
    await repo.git(["switch", "menu-side"]);
    await repo.write("side.txt", "side change\n");
    await repo.commitAll("side change");
    await repo.git(["switch", "main"]);
    await repo.git(["merge", "--no-ff", "menu-side", "-m", "merge for menu"]);
    const mergeOid = await repo.headOid();
    await page.goto(service.pairingUrl);
    await page
      .getByTestId(`commit-row-${historicalOid}`)
      .click({ button: "right" });
    const rootDrop = page.getByTestId(
      `commit-context-${historicalOid}-drop-commit`,
    );
    await expect(rootDrop).toBeDisabled();
    await expect(rootDrop).toContainText("The first commit cannot be dropped");
    await rootDrop.click({ force: true });
    await expect(page.getByTestId("commit-drop-dialog")).toHaveCount(0);
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-revert-commit`),
    ).toBeEnabled();
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-cherry-pick-commit`),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.getByTestId(`commit-row-${mergeOid}`).click({ button: "right" });
    for (const id of ["revert-commit", "cherry-pick-commit", "drop-commit"]) {
      const item = page.getByTestId(`commit-context-${mergeOid}-${id}`);
      await expect(item).toBeDisabled();
      await expect(item).toContainText(
        "This operation does not support merge commits",
      );
    }
    await expect(
      page.getByTestId(`commit-context-${mergeOid}-create-branch`),
    ).toBeEnabled();
    await expect(
      page.getByTestId(`commit-context-${mergeOid}-reset-branch`),
    ).toBeEnabled();
    await expect(
      page.getByTestId(`commit-context-${mergeOid}-copy-sha`),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await page
      .getByTestId(`commit-row-${linearOid}`)
      .click({ button: "right" });
    for (const id of ["revert-commit", "cherry-pick-commit", "drop-commit"]) {
      await expect(
        page.getByTestId(`commit-context-${linearOid}-${id}`),
      ).toBeEnabled();
    }
    await page.keyboard.press("Escape");
    await page.getByTestId("settings-open").click();
    await page.getByTestId("settings-language-zh").click();
    await page
      .getByTestId(`commit-row-${historicalOid}`)
      .click({ button: "right" });
    await expect(rootDrop).toContainText("不能丢弃首个提交");
    await page.keyboard.press("Escape");
    await page.getByTestId(`commit-row-${mergeOid}`).click({ button: "right" });
    await expect(
      page.getByTestId(`commit-context-${mergeOid}-revert-commit`),
    ).toContainText("此操作不支持合并提交");
    expect(await repo.headOid()).toBe(mergeOid);
  });

  test("keeps a short viewport menu open while scrolling its actions", async ({
    page,
  }) => {
    // Prevents internal menu scrolling dismissing lower actions, while retaining anchor dismissal.
    for (let index = 0; index < 18; index += 1) {
      await repo.write("a.txt", `menu history ${index}\n`);
      await repo.commitAll(`menu history ${index}`);
    }
    const headOid = await repo.headOid();
    await page.setViewportSize({ width: 1440, height: 420 });
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${headOid}`);
    await row.click({ button: "right" });
    const menu = page.getByTestId(`commit-context-${headOid}`);
    await expect(menu).toBeVisible();
    expect(
      await menu.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    // The production menu deliberately ignores opening-gesture scrolls for 150 ms.
    await page.waitForTimeout(200);
    await menu.hover();
    await page.mouse.wheel(0, 700);
    await expect(menu).toBeVisible();
    await expect
      .poll(() => menu.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const bottomItem = page.getByTestId(
      `commit-context-${headOid}-copy-message`,
    );
    const menuBox = await menu.boundingBox();
    const itemBox = await bottomItem.boundingBox();
    if (menuBox === null || itemBox === null) {
      throw new Error("the scrolled menu or bottom item has no box");
    }
    expect(itemBox.y + itemBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );
    await page.mouse.wheel(0, 700);
    await expect(menu).toBeVisible();
    await page.getByTestId(`commit-context-${headOid}-reset-branch`).click();
    await expect(page.getByTestId("commit-reset-dialog")).toBeVisible();
    await page
      .getByTestId("commit-reset-dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await row.click({ button: "right" });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(200);
    const history = page.getByTestId("history-scroll");
    await history.evaluate((element) => {
      element.scrollTop = 60;
    });
    await expect
      .poll(() => history.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(menu).toHaveCount(0);
  });

  test("navigates graph menus with arrows and skips disabled operations", async ({
    page,
  }) => {
    // Prevents keyboard users being stranded on the menu container or a disabled operation.
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await row.click({ button: "right" });
    const prefix = `commit-context-${historicalOid}`;
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId(`${prefix}-create-branch`)).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByTestId(`${prefix}-copy-message`)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId(`${prefix}-create-branch`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId(`${prefix}-copy-message`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId(`${prefix}-copy-sha`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId(`${prefix}-reset-branch`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByTestId(`${prefix}-cherry-pick-commit`),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("commit-cherry-pick-dialog")).toBeVisible();
    await page
      .getByTestId("commit-cherry-pick-dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(row).toBeFocused();
    await row.click({ button: "right" });
    await page.keyboard.press("Home");
    await expect(page.getByTestId(`${prefix}-create-branch`)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(prefix)).toHaveCount(0);
  });

  test("returns keyboard focus to the trigger and lets Tab leave the menu", async ({
    page,
  }) => {
    // Prevents Escape losing focus and Tab walking through every floating menu button.
    await page.goto(service.pairingUrl);
    const headOid = await repo.headOid();
    const row = page.getByTestId(`commit-row-${headOid}`);
    const menu = page.getByTestId(`commit-context-${headOid}`);
    await row.click({ button: "right" });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(row).toBeFocused();
    await row.click({ button: "right" });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId(`commit-row-${historicalOid}`)).toBeFocused();
    await row.click({ button: "right" });
    await page.keyboard.press("Shift+Tab");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("commit-ref-refs/heads/main")).toBeFocused();
    const badge = page.getByTestId("commit-ref-refs/heads/main");
    await badge.click({ button: "right" });
    await page.keyboard.press("Escape");
    await expect(badge).toBeFocused();
    const gear = page.getByTestId("history-column-settings");
    await gear.click();
    await expect(
      page.getByTestId("history-column-settings-menu"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gear).toBeFocused();
    await row.click({ button: "right" });
    const search = page.getByPlaceholder("Search commit messages…");
    await search.click();
    await expect(menu).toHaveCount(0);
    await expect(search).toBeFocused();
  });

  test("does not steal an annotation's focus when dialog autofocus runs late", async ({
    page,
  }) => {
    // Prevents a delayed initial-focus callback redirecting tag annotation input into the name.
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await expect(row).toBeVisible();
    await page.evaluate(`(() => {
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => frame((time) => window.setTimeout(() => callback(time), 250));
    })()`);
    await row.click({ button: "right" });
    await page
      .getByTestId(`commit-context-${historicalOid}-create-tag`)
      .click();
    const name = page.getByTestId("commit-ref-name");
    const annotation = page.getByTestId("commit-ref-annotation");
    await name.fill("focus-tag");
    await annotation.fill("annotation stays here");
    await page.waitForTimeout(350);
    await expect(annotation).toBeFocused();
    await expect(name).toHaveValue("focus-tag");
    await expect(annotation).toHaveValue("annotation stays here");
  });

  test("creates refs from a commit context menu", async ({ page }) => {
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    const menu = page.getByTestId(`commit-context-${historicalOid}`);
    await expect(menu).toBeVisible();
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-create-branch`),
    ).toHaveText("Create Branch Here…");
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-create-tag`),
    ).toHaveText("Create Tag Here…");
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-copy-sha`),
    ).toHaveText("Copy SHA");

    await page
      .getByTestId(`commit-context-${historicalOid}-create-branch`)
      .click();
    await page.getByTestId("commit-ref-name").fill("from-historical");
    await page.getByTestId("commit-ref-submit").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /created branch from-historical/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/heads/from-historical"]))
        .trim(),
    ).toBe(historicalOid);

    await row.click({ button: "right" });
    await page
      .getByTestId(`commit-context-${historicalOid}-create-tag`)
      .click();
    await page.getByTestId("commit-ref-name").fill("historical-tag");
    await page
      .getByTestId("commit-ref-annotation")
      .fill("created from the commit menu");
    await page.getByTestId("commit-ref-submit").click();
    await expect(page.getByTestId("tag-message-result")).toContainText(
      /created (annotated )?tag historical-tag/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/tags/historical-tag^{}"]))
        .trim(),
    ).toBe(historicalOid);
  });

  test("creates a worktree with a new branch from a commit context menu", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    await expect(
      page.getByTestId(`commit-context-${historicalOid}-create-worktree`),
    ).toHaveText("Create Worktree from Here…");
    await page
      .getByTestId(`commit-context-${historicalOid}-create-worktree`)
      .click();

    const dialog = page.getByTestId("commit-worktree-dialog");
    await expect(dialog).toBeVisible();
    await page
      .getByTestId("commit-worktree-dialog-branch")
      .fill("from-worktree");
    await page
      .getByTestId("commit-worktree-dialog-destination")
      .fill("worktrees/from-historical");
    await page.getByTestId("commit-worktree-dialog-confirm").click();

    await expect(page.getByTestId("worktree-message-result")).toContainText(
      /created worktree at/,
    );
    // The worktree exists, its branch starts at the clicked commit — not HEAD.
    const headOf = await repo.git(["rev-parse", "refs/heads/from-worktree"]);
    expect(new TextDecoder().decode(headOf).trim()).toBe(historicalOid);
    const list = new TextDecoder().decode(await repo.git(["worktree", "list"]));
    expect(list).toContain("from-historical");
  });

  // Reading the clipboard back is a Chromium-only capability in Playwright: Firefox
  // rejects `clipboard-read` as an unknown permission and WebKit gates readText on a
  // user gesture, so on those engines this side effect is not assertable rather than
  // broken. The menu item itself is still asserted everywhere, above.
  test("copies the SHA to the system clipboard from the commit menu", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "asserting the clipboard's content requires Chromium's clipboard permissions",
    );
    await page.goto(service.pairingUrl);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    await page.getByTestId(`commit-context-${historicalOid}-copy-sha`).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            navigator as unknown as {
              clipboard: { readText(): Promise<string> };
            }
          ).clipboard.readText(),
        ),
      )
      .toBe(historicalOid);
  });

  test("offers branch actions by branch state and confirms deletion", async ({
    page,
  }) => {
    const topicOid = await repo.headOid();
    await repo.git(["branch", "topic-menu"]);
    await page.goto(service.pairingUrl);
    await page.getByTestId("workbench-nav-branches").click();

    const current = page.getByTestId("branch-row-main");
    await current.click({ button: "right" });
    await expect(
      page.getByTestId("branch-context-main-upstream"),
    ).toBeVisible();
    await expect(page.getByTestId("branch-context-main-rename")).toBeVisible();
    await expect(page.getByTestId("branch-context-main-switch")).toHaveCount(0);
    await expect(page.getByTestId("branch-context-main-merge")).toHaveCount(0);
    await expect(page.getByTestId("branch-context-main-delete")).toHaveCount(0);

    const topic = page.getByTestId("branch-row-topic-menu");
    await topic.click({ button: "right" });
    await expect(
      page.getByTestId("branch-context-topic-menu-switch"),
    ).toBeVisible();
    await expect(
      page.getByTestId("branch-context-topic-menu-merge"),
    ).toBeVisible();
    await expect(
      page.getByTestId("branch-context-topic-menu-delete"),
    ).toBeVisible();
    await page.getByTestId("branch-context-topic-menu-rename").click();

    await page.getByLabel("new name for topic-menu").fill("renamed-menu");
    await page.getByTestId("save-rename-topic-menu").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /renamed topic-menu to renamed-menu/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["rev-parse", "refs/heads/renamed-menu"]))
        .trim(),
    ).toBe(topicOid);

    const renamed = page.getByTestId("branch-row-renamed-menu");
    await renamed.click({ button: "right" });
    await page.getByTestId("branch-context-renamed-menu-delete").click();
    await expect(page.getByTestId("branch-delete-dialog")).toBeVisible();
    expect(
      new TextDecoder()
        .decode(await repo.git(["branch", "--list", "renamed-menu"]))
        .trim(),
    ).toBe("renamed-menu");
    await page.getByTestId("branch-delete-dialog-confirm").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      /deleted branch renamed-menu/,
    );
    expect(
      new TextDecoder()
        .decode(await repo.git(["branch", "--list", "renamed-menu"]))
        .trim(),
    ).toBe("");
  });
  test("offers ref actions from the graph and confirms tag deletion", async ({
    page,
  }) => {
    await repo.git(["branch", "graph-ref", historicalOid]);
    await repo.git(["tag", "graph-tag", historicalOid]);
    await page.goto(service.pairingUrl);
    await expect(page.getByTestId(`commit-row-${historicalOid}`)).toBeVisible();

    const branchBadge = page.getByTestId("commit-ref-refs/heads/graph-ref");
    await branchBadge.click({ button: "right" });
    const branchMenu = page.getByTestId(
      "commit-ref-context-refs/heads/graph-ref",
    );
    await expect(branchMenu).toBeVisible();
    await expect(
      branchMenu.getByTestId(
        "commit-ref-context-refs/heads/graph-ref-checkout",
      ),
    ).toBeVisible();
    await expect(
      branchMenu.getByTestId("commit-ref-context-refs/heads/graph-ref-merge"),
    ).toHaveText("Merge graph-ref into main");
    await expect(
      branchMenu.getByTestId("commit-ref-context-refs/heads/graph-ref-delete"),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // The checked-out branch is not offered its own switch/merge/delete.
    const headBadge = page.getByTestId("commit-ref-refs/heads/main");
    await headBadge.click({ button: "right" });
    const headMenu = page.getByTestId("commit-ref-context-refs/heads/main");
    await expect(headMenu).toBeVisible();
    await expect(
      headMenu.getByTestId("commit-ref-context-refs/heads/main-checkout"),
    ).toHaveCount(0);
    await expect(
      headMenu.getByTestId("commit-ref-context-refs/heads/main-merge"),
    ).toHaveCount(0);
    await expect(
      headMenu.getByTestId("commit-ref-context-refs/heads/main-delete"),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A tag's delete is destructive: it runs only through the confirm dialog.
    const tagBadge = page.getByTestId("commit-ref-refs/tags/graph-tag");
    await tagBadge.click({ button: "right" });
    const tagMenu = page.getByTestId("commit-ref-context-refs/tags/graph-tag");
    await tagMenu
      .getByTestId("commit-ref-context-refs/tags/graph-tag-delete")
      .click();
    await expect(page.getByTestId("commit-ref-delete-dialog")).toBeVisible();
    expect(
      new TextDecoder()
        .decode(await repo.git(["tag", "--list", "graph-tag"]))
        .trim(),
    ).toBe("graph-tag");
    await page.getByTestId("commit-ref-delete-dialog-confirm").click();
    await expect
      .poll(async () =>
        new TextDecoder()
          .decode(await repo.git(["tag", "--list", "graph-tag"]))
          .trim(),
      )
      .toBe("");
  });

  test("stages, unstages and confirms discard from a path context menu", async ({
    page,
  }) => {
    await repo.write("a.txt", "working-copy-change\n");
    await page.goto(service.pairingUrl);

    const pathRow = page
      .locator('[data-testid^="unstaged-row-"], [data-testid^="staged-row-"]')
      .filter({ hasText: "a.txt" });
    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    const pathMenu = page.getByRole("menu");
    await expect(pathMenu.getByText("Stage", { exact: true })).toBeVisible();
    await pathMenu.getByText("Stage", { exact: true }).click();
    await expect
      .poll(async () =>
        new TextDecoder()
          .decode(await repo.git(["diff", "--cached", "--name-only"]))
          .trim(),
      )
      .toContain("a.txt");
    // Git has staged the file; the panel has to have caught up before the next menu is
    // opened, because that menu's Unstage action is enabled from what the panel believes.
    // Without this the click below races the refresh and lands on a disabled item.
    await expect(
      page.locator('[data-testid^="staged-row-"]').filter({ hasText: "a.txt" }),
    ).toBeVisible();

    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    await expect(
      page.getByRole("menu").getByText("Unstage", { exact: true }),
    ).toBeVisible();
    await page.getByRole("menu").getByText("Unstage", { exact: true }).click();
    await expect
      .poll(async () =>
        new TextDecoder()
          .decode(await repo.git(["diff", "--cached", "--name-only"]))
          .trim(),
      )
      .not.toContain("a.txt");
    // The same, in the other direction: Discard is offered for an unstaged modification.
    await expect(
      page
        .locator('[data-testid^="unstaged-row-"]')
        .filter({ hasText: "a.txt" }),
    ).toBeVisible();

    await expect(pathRow).toBeVisible();
    await pathRow.click({ button: "right" });
    await page.getByRole("menu").getByText("Discard…", { exact: true }).click();
    await expect(page.getByTestId("working-copy-discard-dialog")).toBeVisible();
    expect(await repo.readText("a.txt")).toBe("working-copy-change\n");
    await page.getByTestId("working-copy-discard-dialog-confirm").click();
    await expect.poll(() => repo.readText("a.txt")).toBe("second\n");
  });
  test("drops a middle commit after confirmation", async ({ page }) => {
    // A third commit makes the clicked commit a middle one: dropping it must
    // keep the commit after it.
    await repo.write("third.txt", "third\n");
    await repo.commitAll("third");
    // The middle commit: dropping the root would be refused by design.
    const secondOid = new TextDecoder()
      .decode(await repo.git(["rev-parse", "HEAD~1"]))
      .trim();

    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${secondOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    const item = page.getByTestId(`commit-context-${secondOid}-drop-commit`);
    await expect(item).toHaveText("Drop Commit…");
    await item.click();

    const dialog = page.getByTestId("commit-drop-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("commit-drop-dialog-confirm").click();

    await expect
      .poll(async () => {
        const result = await repo.gitResult([
          "merge-base",
          "--is-ancestor",
          secondOid,
          "HEAD",
        ]);
        return String(result.code);
      })
      .toBe("1");
    // The commit after the dropped one survives the rewrite.
    const subjects = new TextDecoder()
      .decode(await repo.git(["log", "--format=%s"]))
      .trim()
      .split("\n");
    expect(subjects).not.toContain("second");
    expect(subjects).toContain("third");
  });

  test("squashes the tip commit into its parent from the context menu", async ({
    page,
  }) => {
    await page.goto(service.pairingUrl);
    const tipOid = new TextDecoder()
      .decode(await repo.git(["rev-parse", "HEAD"]))
      .trim();
    const row = page.getByTestId(`commit-row-${tipOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    const item = page.getByTestId(`commit-context-${tipOid}-squash-commit`);
    await expect(item).toHaveText("Squash into Parent…");
    await item.click();

    const dialog = page.getByTestId("commit-squash-dialog");
    await expect(dialog).toBeVisible();
    await page
      .getByTestId("commit-squash-dialog-message")
      .fill("base and second together");
    await page.getByTestId("commit-squash-dialog-confirm").click();

    // The history shrank to the single squashed commit with the new message.
    await expect
      .poll(async () => {
        const result = await repo.gitResult(["rev-parse", "HEAD~1"]);
        return String(result.code);
      })
      .toBe("128");
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual("base and second together");
    // Both changes survive the squash.
    expect(await repo.readText("a.txt")).toEqual("second\n");
  });

  test("checks a remote branch out as a local branch from its context menu", async ({
    page,
  }) => {
    const remote = await createBareRemote();
    try {
      await repo.git(["remote", "add", "origin", remote.path]);
      await repo.git(["switch", "-c", "feature"]);
      await repo.write("feature.txt", "feature\n");
      await repo.commitAll("feature");
      const featureOid = (await repo.headOid()).trim();
      await repo.git(["push", "origin", "feature"]);
      await repo.git(["switch", "main"]);
      // Drop the local twin so the remote ref renders its own pill: with a
      // local branch present the two merge into one badge, whose menu is the
      // local branch's.
      await repo.git(["branch", "-D", "feature"]);

      await page.goto(service.pairingUrl);
      // The remote branch has no local twin, so it renders its own pill whose
      // menu offers the checkout — GitKraken's "checkout remote branch".
      const badge = page.getByTestId("commit-ref-refs/remotes/origin/feature");
      await expect(badge).toBeVisible();
      await badge.click({ button: "right" });
      const item = page.getByTestId(
        "commit-ref-context-refs/remotes/origin/feature-checkout-remote",
      );
      await expect(item).toHaveText("Checkout origin/feature as Local Branch");
      await item.click();

      // gitResult, not git: a poll callback that throws fails the test on its
      // first evaluation instead of retrying until the branch appears.
      await expect
        .poll(async () => {
          const result = await repo.gitResult([
            "rev-parse",
            "refs/heads/feature",
          ]);
          return result.code === 0
            ? new TextDecoder().decode(result.stdout).trim()
            : "(pending)";
        })
        .toBe(featureOid);
      await expect
        .poll(async () =>
          new TextDecoder()
            .decode(await repo.git(["branch", "--show-current"]))
            .trim(),
        )
        .toBe("feature");
    } finally {
      await remote.dispose();
    }
  });

  test("targets the clicked remote and confirms removal", async ({ page }) => {
    const remote = await createBareRemote();
    try {
      await repo.git(["remote", "add", "origin", remote.path]);
      await repo.git(["remote", "add", "mirror", remote.path]);
      await repo.git(["push", "origin", "main"]);
      await page.goto(service.pairingUrl);
      await page.getByTestId("workbench-nav-remotes").click();

      await page.getByLabel("select remote origin").check();
      const mirrorRow = page.getByTestId("remote-row-mirror");
      await mirrorRow.click({ button: "right" });
      await expect(
        page.getByTestId("remote-context-mirror-edit"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-fetch"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-pull"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-push"),
      ).toBeVisible();
      await expect(
        page.getByTestId("remote-context-mirror-remove"),
      ).toBeVisible();

      await page.getByTestId("remote-context-mirror-edit").click();
      await expect(page.getByLabel("remote name for mirror")).toBeVisible();
      await page.getByTestId("cancel-edit-remote-mirror").click();

      await mirrorRow.click({ button: "right" });
      await page.getByTestId("remote-context-mirror-fetch").click();
      await expect(page.getByTestId("remote-message")).toContainText(
        /fetched mirror/,
      );

      await mirrorRow.click({ button: "right" });
      await page.getByTestId("remote-context-mirror-remove").click();
      await expect(page.getByTestId("remote-remove-dialog")).toBeVisible();
      expect(
        new TextDecoder()
          .decode(await repo.git(["remote"]))
          .trim()
          .split("\n"),
      ).toEqual(["mirror", "origin"]);
      await page.getByTestId("remote-remove-dialog-confirm").click();
      await expect(page.getByTestId("remote-message")).toContainText(
        /removed remote mirror/,
      );
      expect(
        new TextDecoder()
          .decode(await repo.git(["remote"]))
          .trim()
          .split("\n"),
      ).toEqual(["origin"]);
    } finally {
      await remote.dispose();
    }
  });

  test("opening a commit menu leaves no text selected behind it", async ({
    page,
  }) => {
    // Prevents: WebKit placing the caret — and with it a selection — when the right
    // button goes down, so right-clicking a commit highlighted the words under and
    // below the pointer. The row must refuse that mousedown default; the menu itself
    // still opens, which is asserted first so this cannot pass by not opening.
    await page.goto(service.pairingUrl);
    const row = page.getByTestId(`commit-row-${historicalOid}`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    await expect(
      page.getByTestId(`commit-context-${historicalOid}`),
    ).toBeVisible();
    // The expression travels as a string: the specs' TypeScript has no DOM types, and
    // the selection lives in the page.
    const rowSelection = await page.evaluate<string>(
      "window.getSelection()?.toString() ?? ''",
    );
    expect(rowSelection).toBe("");

    // The same right-press must be refused on a ref badge, whose menu opens over the
    // row's own.
    await page.keyboard.press("Escape");
    const badge = page.getByTestId("commit-ref-refs/heads/main");
    await expect(badge).toBeVisible();
    await badge.click({ button: "right" });
    await expect(
      page.getByTestId("commit-ref-context-refs/heads/main"),
    ).toBeVisible();
    const badgeSelection = await page.evaluate<string>(
      "window.getSelection()?.toString() ?? ''",
    );
    expect(badgeSelection).toBe("");
  });
});
