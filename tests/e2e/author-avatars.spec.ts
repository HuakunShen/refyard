import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";

// A 1x1 transparent PNG: the avatar host is fulfilled locally so the suite
// never touches the network, while still exercising the real URL the row
// builds from the commit email — and the CSP entry that allows it.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Author avatars", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let octocatOid: string;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    // The base commit keeps the fixture's non-GitHub identity; this one is
    // authored with a noreply email the way GitHub writes commits since 2017.
    await repo.write("b.txt", "by octocat\n");
    await repo.git(["add", "-A"]);
    await repo.git(["commit", "--quiet", "-m", "from a github author"], {
      env: {
        GIT_AUTHOR_NAME: "The Octocat",
        GIT_AUTHOR_EMAIL: "583231+octocat@users.noreply.github.com",
        GIT_COMMITTER_NAME: "The Octocat",
        GIT_COMMITTER_EMAIL: "583231+octocat@users.noreply.github.com",
      },
    });
    octocatOid = (await repo.headOid()).trim();
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("shows the GitHub photo for noreply authors and initials for everyone else", async ({
    page,
  }) => {
    // Real-world failure prevented: a regression in the email→URL mapping, or a
    // CSP that dropped the avatar hosts, would silently turn every photo into
    // initials — this pins the src the row actually requests.
    await page.route("https://github.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PIXEL_PNG,
      }),
    );
    await page.goto(service.pairingUrl);

    const octoRow = page.getByTestId(`commit-row-${octocatOid}`);
    await expect(octoRow).toBeVisible();
    // The avatar lives in the author cell, a sibling of the message button;
    // scope to their shared row.
    const octoAvatar = octoRow.locator(
      "xpath=ancestor::div[contains(@class,'absolute')]//img[@data-testid='author-avatar-img']",
    );
    await expect(octoAvatar).toHaveAttribute(
      "src",
      "https://github.com/octocat.png?size=80",
    );

    // The graph draws the photo as the commit node itself, ringed in the lane
    // colour — the same URL the author column uses, so the browser fetches it
    // once for both.
    await expect(
      page
        .locator('svg[data-slot="graph-gutter"] image')
        .first(),
    ).toHaveAttribute("href", "https://github.com/octocat.png?size=80");

    // The fixture-authored commit has no GitHub email: colored initials, and
    // never a remote request for it.
    await expect(
      page.locator('[data-testid="author-avatar-initials"]').first(),
    ).toBeVisible();
  });

  test("the settings toggle trades photos for initials", async ({ page }) => {
    await page.route("https://github.com/**", (route) => route.abort());
    await page.goto(service.pairingUrl);
    await page.getByTestId("settings-open").click();
    const section = page.getByTestId("settings-appearance");
    await section.waitFor();
    // The visual switch overlays the checkbox, so drive the wrapping label.
    await page
      .locator('label:has([data-testid="settings-avatars-toggle"])')
      .click();

    // Off means no avatar decoration at all: plain author names, no photo and
    // no initials chip, and the graph draws plain dots — initials are the
    // fallback while photos are on, not a second persistent form.
    await expect(
      page.locator('[data-testid="author-avatar-img"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="author-avatar-initials"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('svg[data-slot="graph-gutter"] image'),
    ).toHaveCount(0);

    // The refusal survives a reload — it is a stored preference, not view state.
    await page.reload();
    await page.getByTestId(`commit-row-${octocatOid}`).waitFor();
    await expect(
      page.locator('[data-testid="author-avatar-img"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="author-avatar-initials"]'),
    ).toHaveCount(0);
  });
});
