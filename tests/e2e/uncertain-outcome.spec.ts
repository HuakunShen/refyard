/**
 * The uncertain-outcome block, end to end, in a real browser.
 *
 * The backend behaviour — a killed write comes back `unknown`, blocks the
 * repository, and yields only to an acknowledgement that never rewrites the
 * outcome — is proven by the Rust suites, `session_owner.rs` and the native
 * shutdown tests. What only a browser test can prove is the *surface*: a refused
 * write with `UncertainOutcome` raises the panel, the panel names the operations
 * and the service's reason, the acknowledgement button is inert until the person
 * confirms, the call it sends is the contract's (fresh snapshot, `confirmed:
 * true`), and the block is gone afterwards — really gone, in that the next stage
 * runs for real.
 *
 * The Node service here is real; only the two wire answers that need a killed
 * process to produce (the block refusal and the acknowledgement) are intercepted,
 * which is the same `page.route` technique the launcher spec uses for host
 * surfaces.
 */
import { expect, test, type Route } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

const BLOCKED_OPERATION_ID = "op_e2e_unknown1";

/** A refusal shaped exactly like the service's write-block answer. */
function blockProblem(): unknown {
  return {
    problem: {
      code: "UncertainOutcome",
      message:
        "an operation was in flight when the service stopped; confirm the repository state before submitting new work",
      details: {
        reason: "an operation was in flight when the service stopped",
        operations: BLOCKED_OPERATION_ID,
      },
      retryable: false,
    },
  };
}

/** An acknowledgement answer the contract accepts, outcome still unknown. */
function unknownRecord(confirmedSnapshotId: string): unknown {
  return {
    operationId: BLOCKED_OPERATION_ID,
    clientRequestId: "crid-e2e-unknown1",
    kind: "stagePaths",
    target: {
      kind: "worktree",
      repositoryId: "repo_1",
      worktreeId: "wt_1",
      expectedSnapshotId: confirmedSnapshotId,
    },
    status: "unknown",
    sequence: 1,
    acceptedAt: "2026-09-18T00:00:00Z",
    startedAt: null,
    finishedAt: null,
    result: null,
    problem: null,
  };
}

test.describe("uncertain outcome acknowledgement", () => {
  // WebKit applies this spec's request interception unreliably once the app's service
  // worker has claimed the page, and an interception that silently does not apply
  // would really stage against the real service instead of meeting the fake refusal.
  // Chromium and Firefox carry the coverage; the native behaviour behind the fake is
  // proven engine-independently by the Rust, session_owner and shutdown suites.
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "page.route does not reliably intercept the page's API posts in WebKit once the service worker has claimed the page; an interception that silently misses would really stage against the service. Chromium and Firefox carry the coverage; the behaviour behind the fake is proven engine-independently by the Rust, session_owner and shutdown suites.",
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

  test("raises the panel on a blocked write, acks with explicit confirmation, and unblocks", async ({
    page,
  }) => {
    // The refusal: every write submission is answered with the block, until the
    // test lifts the interception after the acknowledgement. Path predicates rather
    // than globs: glob matching differs between browser engines, a write that
    // slipped past the fake would "pass" by writing to the real repository.
    let acknowledged = false;
    const fakeOperationsSubmit = async (route: Route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify(blockProblem()),
        });
        return;
      }
      await route.fallback();
    };
    const operationsMatcher = (url: URL): boolean =>
      url.pathname === "/api/v1/operations";
    await page.route(operationsMatcher, fakeOperationsSubmit);
    await page.route(
      (url) => url.pathname === "/api/v1/operations/acknowledge",
      async (route) => {
        const request = route.request();
        const body = request.postDataJSON() as {
          operationId: string;
          confirmedSnapshotId: string;
          confirmed: boolean;
        };
        // The contract's acknowledgement: a fresh snapshot the service minted, and
        // an explicit confirmation. Anything else is not a person's answer.
        expect(body.operationId).toBe(BLOCKED_OPERATION_ID);
        expect(body.confirmed).toBe(true);
        expect(body.confirmedSnapshotId).toMatch(/^snap_/);
        acknowledged = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(unknownRecord(body.confirmedSnapshotId)),
        });
      },
    );

    await repo.write("a.txt", "blocked at first\n");
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();

    // The stage is refused with the block, and the panel appears with the
    // service's reason and the operation that caused it.
    await working
      .getByRole("button", { name: "Stage a.txt", exact: true })
      .click();
    const panel = page.getByTestId("uncertain-outcome-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(
      "an operation was in flight when the service stopped",
    );
    await expect(panel).toContainText(BLOCKED_OPERATION_ID);

    // The button is inert until the checkbox arms it: an acknowledgement without
    // a confirmation is a refusal the service makes anyway, and the UI does not
    // even send it.
    const acknowledge = panel.getByTestId("uncertain-acknowledge");
    await expect(acknowledge).toBeDisabled();
    await panel.getByTestId("uncertain-confirm-checkbox").check();
    await expect(acknowledge).toBeEnabled();
    await acknowledge.click();

    await expect(panel).toBeHidden();
    expect(acknowledged).toBe(true);

    // The block is really gone: the same stage, now answered by the real
    // service, goes through and lands in the index.
    // Unroute with the same matcher the route was registered with: a leftover
    // handler would answer the second stage with the fake refusal again.
    await page.unroute(operationsMatcher, fakeOperationsSubmit);
    await working
      .getByRole("button", { name: "Stage a.txt", exact: true })
      .click();
    await expect(
      working.getByTestId("working-copy-staging-message"),
    ).toContainText(/staged 1 path/);
    await expect(
      working.getByRole("button", { name: "Unstage a.txt", exact: true }),
    ).toBeVisible();
  });

  test("keeps the panel and shows the refusal when the acknowledgement is refused", async ({
    page,
  }) => {
    // A confirmation the service refuses — here, a snapshot it never minted —
    // leaves the block standing, and the panel says so instead of lying.
    await page.route(
      (url) => url.pathname === "/api/v1/operations",
      async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify(blockProblem()),
          });
          return;
        }
        await route.fallback();
      },
    );
    await page.route(
      (url) => url.pathname === "/api/v1/operations/acknowledge",
      async (route) => {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            problem: {
              code: "NotFound",
              message: "no operation named op_e2e_unknown1 is uncertain",
              retryable: false,
            },
          }),
        });
      },
    );

    await repo.write("a.txt", "still blocked\n");
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toBeVisible();
    await working
      .getByRole("button", { name: "Stage a.txt", exact: true })
      .click();
    const panel = page.getByTestId("uncertain-outcome-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("uncertain-confirm-checkbox").check();
    await panel.getByTestId("uncertain-acknowledge").click();

    await expect(panel.getByTestId("uncertain-note")).toContainText("NotFound");
    await expect(panel).toBeVisible();
  });
});
