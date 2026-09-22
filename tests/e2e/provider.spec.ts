/**
 * The provider axis in a real browser: gating, the connect flow, and the PR list.
 *
 * The upstream is a local stub; everything the page touches — capability gate,
 * sidebar view, token form, cached list — is the production surface. The token
 * used here is fake and only ever valid against the stub, and the case asserts
 * it never lands in browser storage.
 */
import { expect, test } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService } from "../support/e2e-service.js";
import { startGitHubStub, type GitHubStub } from "../support/github-stub.js";

const TOKEN = "github_pat_11TESTTOKEN000000000000000";
const USER_OK = JSON.stringify({ login: "octocat", type: "User" });
const PULLS = JSON.stringify([
  {
    number: 7,
    title: "Add provider panel",
    user: {
      login: "octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    },
    head: { ref: "feature/provider" },
    base: { ref: "main" },
    draft: false,
    html_url: "https://github.com/octocat/Hello-World/pull/7",
    updated_at: "2026-09-22T10:00:00Z",
  },
  {
    number: 6,
    title: "Draft: graph lanes",
    user: {
      login: "octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    },
    head: { ref: "draft/lanes" },
    base: { ref: "main" },
    draft: true,
    html_url: "https://github.com/octocat/Hello-World/pull/6",
    updated_at: "2026-09-21T10:00:00Z",
  },
]);

test.describe("Provider integration", () => {
  let repo: GitFixtureRepo;
  let service: Awaited<ReturnType<typeof startE2eService>>;
  let stub: GitHubStub;

  test.beforeEach(async () => {
    stub = await startGitHubStub();
    repo = await createRepo({ initialCommit: true });
    await repo.git([
      "remote",
      "add",
      "origin",
      "https://github.com/octocat/Hello-World.git",
    ]);
    service = await startE2eService({
      repo,
      providerGithubBaseUrl: stub.baseUrl,
      providerGithubLoginBaseUrl: stub.baseUrl,
    });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
    await stub.close();
  });

  test("connects from the sidebar with the device flow and lists open pull requests", async ({
    page,
  }) => {
    stub.set("POST /login/device/code", {
      status: 200,
      body: JSON.stringify({
        device_code: "device_code_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        // The host's first poll lands 8s after start — long enough for the
        // awaiting state to be observed calmly; the completion assertions
        // below carry their own larger timeouts.
        interval: 8,
      }),
    });
    stub.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({
        access_token: "ghu_e2e_access_token_0000000000000000001",
        refresh_token: "ghu_e2e_refresh_token_000000000000000001",
        expires_in: 28800,
        token_type: "bearer",
      }),
    });
    stub.set("GET /user", { status: 200, body: USER_OK });
    stub.set(
      "GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1",
      { status: 200, body: PULLS },
    );

    await page.goto(service.pairingUrl);

    // The capability gate: the view exists because this host reports the module.
    const nav = page.getByRole("button", { name: "Pull Requests" });
    await expect(nav).toBeVisible();
    await nav.click();

    // Not connected yet: the one-click device flow, and no rows at all.
    await expect(page.getByTestId("provider-device-start")).toBeVisible();
    await expect(page.getByTestId("provider-pull-requests")).toHaveCount(0);

    await page.getByTestId("provider-device-start").click();

    // The device code is meant to be seen — it is the whole UX of the flow.
    await expect(page.getByTestId("provider-device-code")).toHaveText(/\S+/);

    const rows = page.getByTestId("provider-pull-requests");
    await expect(rows).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("provider-pull-7")).toContainText(
      "Add provider panel",
    );
    await expect(page.getByTestId("provider-pull-6")).toContainText("draft");
    // The connect flow is gone once the account is connected.
    await expect(page.getByTestId("provider-device-start")).toHaveCount(0);

    // The token is a host-side secret: it must not survive in this origin's storage.
    const stored = await page.evaluate(() =>
      JSON.stringify([localStorage, sessionStorage].map((store) => ({ ...store }))),
    );
    expect(stored).not.toContain("ghu_e2e_access_token_0000000000000000001");
  });

  test("keeps the token form after a rejected token", async ({ page }) => {
    stub.set("GET /user", {
      status: 401,
      body: JSON.stringify({ message: "Bad credentials" }),
    });
    await page.goto(service.pairingUrl);
    const nav = page.getByRole("button", { name: "Pull Requests" });
    await nav.click();
    // The PAT path is the deliberate fallback behind the device flow.
    await page.getByTestId("provider-token-toggle").click();
    await page.getByTestId("provider-token-input").fill(TOKEN);
    await page.getByTestId("provider-connect").click();
    // The refusal is visible and the form stays usable for a corrected paste.
    await expect(page.getByTestId("provider-token-input")).toBeVisible();
  });
});
