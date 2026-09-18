/**
 * The native folder-picker affordance, gated on the host's own answer.
 *
 * On the desktop the "Choose folder…" button opens the OS panel and returns a full
 * path — that flow is verified in the running app by hand and in `session_owner.rs`
 * at the dispatch level, because no automated test can click a system dialog. What a
 * browser test *can* pin is the gate in both directions:
 *
 * - the button exists only when the host's capabilities say the picker exists;
 * - when a caller clicks it against a host that cannot open one (any browser), the
 *   refusal surfaces as the host's own words instead of an empty result that would
 *   look like "nothing was chosen".
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

test.describe("native folder picker affordance", () => {
  // WebKit applies request interception unreliably once the app's service worker has
  // claimed the page (same as the uncertain-outcome spec): the faked capabilities get
  // replaced by the real service's answers, and the gated button never appears. The
  // gating itself is one `capabilities.localFolderPicker` branch in the launcher.
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "page.route does not reliably intercept in WebKit here; see the comment above",
  );

  let repo: GitFixtureRepo;
  let service: E2eService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service?.stop();
    await repo.dispose();
  });

  async function openWithPickerCapability(
    page: import("@playwright/test").Page,
    localFolderPicker: boolean,
  ): Promise<void> {
    // Both host reads are faked: capabilities alone would answer `true` and then be
    // replaced when the ssh-hosts read below hit the real service and demoted the
    // whole probe back to legacy (picker false) — an engine-level race, not a product
    // behaviour.
    await page.route("**/api/v1/host/capabilities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sshConfig: false,
          localFolderPicker,
          uncertainOperationAcknowledgement: true,
          targetKinds: ["local"],
        }),
      });
    });
    await page.route("**/api/v1/host/ssh-hosts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          hosts: [],
          warnings: [],
          revision: "rev-picker",
        }),
      });
    });
    // The page adopts every registered repository into a tab and closes the launcher
    // once tabs exist — an engine-level race against this test's assertions. An empty
    // list is the honest fixture here: nothing was opened yet, so the launcher stays.
    await page.route("**/api/v1/repositories", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ repositories: [] }),
        });
        return;
      }
      await route.fallback();
    });
    await page.goto(service.pairingUrl);
  }

  test("hides the button when the host reports no folder picker", async ({
    page,
  }) => {
    await openWithPickerCapability(page, false);
    const launcher = page.getByTestId("repository-launcher");
    await expect(launcher).toBeVisible();
    await expect(page.getByTestId("launcher-native-picker")).toHaveCount(0);
  });

  test("shows the button when the host offers it, and surfaces the refusal of one that cannot", async ({
    page,
  }) => {
    await openWithPickerCapability(page, true);
    const launcher = page.getByTestId("repository-launcher");
    await expect(launcher).toBeVisible();
    const button = page.getByTestId("launcher-native-picker");
    await expect(button).toBeVisible();

    // The HTTP host cannot open an OS dialog; clicking must answer with the host's
    // refusal — shown next to the form — and must not open a repository.
    await button.click();
    await expect(
      page.getByTestId("launcher-native-picker-error"),
    ).toContainText(/dialog|picker/i);
  });
});
