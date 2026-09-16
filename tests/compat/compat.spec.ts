/**
 * Compatibility checks for the separately deployed page and API.
 *
 * Each case uses the built SPA through the same static host as the normal e2e suite and a
 * real CLI service. Only the response crossing the page/API boundary is rewritten, which
 * lets the test model a version skew without replacing either artifact with a stub.
 */
import { expect, test, type Route } from "@playwright/test";
import { UI_API_MAJOR, UI_CONTRACT_VERSION } from "../../apps/web/src/lib/session-negotiation.js";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

test.describe("page and service compatibility", () => {
  let repo: GitFixtureRepo;
  let service: E2eService;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("refuses an API-major mismatch before offering a write", async ({
    page,
  }) => {
    // Prevents: a cached page guessing that a changed major still has the same
    // mutation semantics and changing the repository under the wrong contract.
    await page.route("**/health", async (route) => {
      await rewriteJson(route, (body) => {
        body.apiMajor = UI_API_MAJOR + 1;
      });
    });

    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("connection-state")).toContainText(
      "incompatible service",
    );
    await expect(page.getByTestId("staging-panel")).toHaveCount(0);
    expect(await branchNames(repo)).not.toContain("must-not-be-created");
  });

  test("keeps reads working but blocks writes for a newer compatible contract", async ({
    page,
  }) => {
    // Prevents: a minor contract change making an old page either silently mutate
    // with different semantics or discard the reads it still understands.
    let rewritten = 0;
    await page.route("**/api/v1/capabilities", async (route) => {
      await rewriteJson(route, (body) => {
        body.contractVersion = incrementContractVersion(UI_CONTRACT_VERSION);
      });
      rewritten += 1;
    });

    await page.goto(service.pairingUrl);
    await expect.poll(() => rewritten).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.getByTestId("connection-state")).toContainText(
      "contract update available",
    );
    await expect(page.getByTestId("branch-panel")).toBeVisible();
    await page.getByLabel("new branch name").fill("must-not-be-created");
    await page.getByTestId("create-branch").click();
    await expect(page.getByTestId("branch-message")).toContainText(
      "writes are disabled",
    );
    expect(await branchNames(repo)).not.toContain("must-not-be-created");
  });

  test("ignores additive service fields the page does not know", async ({
    page,
  }) => {
    // Prevents: a harmless additive response field taking an older page offline.
    await page.route("**/health", async (route) => {
      await rewriteJson(route, (body) => {
        body.futureServiceField = "ignored";
      });
    });
    await page.route("**/api/v1/capabilities", async (route) => {
      await rewriteJson(route, (body) => {
        body.futureCapabilityField = { retainedBy: "newer-service" };
      });
    });

    await page.goto(service.pairingUrl);
    await expect(page.getByTestId("build-badge")).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  });
});

async function rewriteJson(
  route: Route,
  update: (body: Record<string, unknown>) => void,
): Promise<void> {
  const response = await route.fetch();
  const parsed: unknown = JSON.parse(await response.text());
  if (!isJsonObject(parsed)) {
    throw new Error("the compatibility response was not a JSON object");
  }
  const body = parsed;
  update(body);
  const headers = { ...response.headers() };
  delete headers["content-length"];
  await route.fulfill({
    status: response.status(),
    headers,
    body: JSON.stringify(body),
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function incrementContractVersion(version: string): string {
  const parts = version.split(".");
  const minor = Number.parseInt(parts[1] ?? "0", 10);
  return `${parts[0] ?? "1"}.${minor + 1}.0`;
}

async function branchNames(fixture: GitFixtureRepo): Promise<string> {
  const output = await fixture.git([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  return new TextDecoder().decode(output);
}
