/**
 * Opening a repository on an SSH host through the shipped launcher.
 *
 * A real native host cannot be driven from Playwright here: the SSH half of the
 * product is a Rust host this runner does not start, and the packaged Node service
 * deliberately has no SSH targets (`sshConfig: false`, `targetKinds: ["local"]`). So
 * the host surface is faked at its published routes (`/api/v1/host/…`, repository
 * registration) by a recording stub, and everything else stays real: the built static
 * bundle, the shipped Node host that pairs the page and answers its Git reads, and the
 * page's own code paths. The fake is the point, not a shortcut — it is the only way to
 * assert which calls the page makes, in which order, and which calls it never makes
 * for a path that is not on this machine.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startE2eService, type E2eService } from "../support/e2e-service.js";

/**
 * The shell's service worker is blocked in this file. Request interception and service
 * workers do not mix: once the worker controls the page, an API read can be answered
 * without the route ever seeing it, and WebKit does exactly that here — the fake host
 * stops being the thing under the page. What the worker caches is a different spec's
 * subject, and nothing in this one would be more true for exercising it.
 */
test.use({ serviceWorkers: "block" });

const TARGET_ID = "tgt_e2eRemote";
const HOST_ID = "host_E2eRemote";
const HOST_LABEL = "E2E remote";
const REMOTE_PATH = "/srv/e2e-remote/repo";
const REMOTE_REPOSITORY_ID = "repo_E2eRemote";

interface ProblemBody {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

interface FakeHost {
  /** Bodies of every `POST /api/v1/host/targets`, in order. */
  readonly createTargetBodies: unknown[];
  /** Bodies of every repository registration, in order. */
  readonly registerBodies: unknown[];
  /** Bodies of every target disconnect, in order. */
  readonly disconnectBodies: unknown[];
  /** Every filesystem listing request URL this page made. */
  readonly filesystemRequests: string[];
  /** When set, target creation fails with the host's own words. */
  createTargetProblem: ProblemBody | null;
  /** When set, registering the path fails with the host's own words. */
  registerProblem: ProblemBody | null;
  /** How many target list reads still answer `connecting` before `ready`. */
  connectingReplies: number;
  /** Every target list read, for asserting the page refreshed target state. */
  targetListReads: number;
  /** Set while the fake should slow target creation down, so progress is observable. */
  createTargetDelayMs: number;
  /** Set once a repository was registered on the target. */
  registered: boolean;
  /** The service's own repository list, fetched once through the intercepted route. */
  localRepositories: unknown | null;
  /**
   * Whether the repository list is the real service's (with the remote entry added on
   * registration) instead of an empty list. The empty list keeps the launcher open;
   * the real one is what a page with a local repository to compare against needs.
   */
  serveLocalRepositories: boolean;
}

function createFakeHost(): FakeHost {
  return {
    createTargetBodies: [],
    registerBodies: [],
    disconnectBodies: [],
    filesystemRequests: [],
    createTargetProblem: null,
    registerProblem: null,
    connectingReplies: 0,
    targetListReads: 0,
    createTargetDelayMs: 0,
    registered: false,
    localRepositories: null,
    serveLocalRepositories: false,
  };
}

/** Performs the intercepted request for real and returns its JSON body unvalidated. */
async function readRealRepositories(route: Route): Promise<unknown> {
  const response = await route.fetch();
  return response.json();
}

/** Reads a field from an unvalidated request body without asserting its shape. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function parseBody(route: Route): unknown {
  const raw = route.request().postData();
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function targetSummary(state: "connecting" | "ready" | "unavailable"): unknown {
  return {
    targetId: TARGET_ID,
    kind: "ssh-config",
    label: HOST_LABEL,
    state,
    // The host's own answer about browsing that machine; the launcher must disable
    // Browse with it instead of listing anything here.
    remotePathBrowse: false,
    generation: "gen-e2e-1",
  };
}

interface FakeRepositoriesResponse {
  readonly repositories: readonly unknown[];
  readonly allowedRoots: readonly unknown[];
}

function remoteRepositoryList(): FakeRepositoriesResponse {
  return {
    repositories: [
      {
        repositoryId: REMOTE_REPOSITORY_ID,
        allowedRootId: "root_E2eRemote",
        targetId: TARGET_ID,
        displayName: "e2e-remote-repo",
        displayPath: REMOTE_PATH,
        objectFormat: "sha1",
        worktreeIds: ["wt_E2eRemote"],
        primaryWorktreeId: "wt_E2eRemote",
        head: {
          kind: "born",
          branchName: "main",
          oid: "a".repeat(40),
          detached: false,
        },
        operationInProgress: null,
        lastFetchedAt: null,
      },
    ],
    allowedRoots: [
      {
        allowedRootId: "root_E2eRemote",
        displayPath: "/srv/e2e-remote",
        repositoryIds: [REMOTE_REPOSITORY_ID],
      },
    ],
  };
}

async function installFakeHost(page: Page, fake: FakeHost): Promise<void> {
  await page.route("**/api/v1/host/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/host/capabilities") {
      await fulfillJson(route, 200, {
        sshConfig: true,
        localFolderPicker: false,
        uncertainOperationAcknowledgement: false,
        targetKinds: ["local", "ssh-config"],
      });
      return;
    }
    if (path === "/api/v1/host/ssh-hosts") {
      await fulfillJson(route, 200, {
        hosts: [
          {
            hostId: HOST_ID,
            sourceId: "source_E2e",
            alias: "e2e-remote",
            displayLabel: HOST_LABEL,
            discoveryIncomplete: false,
          },
        ],
        warnings: [],
        revision: "rev-e2e-1",
      });
      return;
    }
    if (path === "/api/v1/host/targets/disconnect") {
      fake.disconnectBodies.push(parseBody(route));
      await fulfillJson(route, 200, {});
      return;
    }
    if (path === "/api/v1/host/targets") {
      if (request.method() === "POST") {
        fake.createTargetBodies.push(parseBody(route));
        if (fake.createTargetDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, fake.createTargetDelayMs),
          );
        }
        if (fake.createTargetProblem !== null) {
          await fulfillJson(route, 502, {
            problem: fake.createTargetProblem,
          });
          return;
        }
        await fulfillJson(route, 200, targetSummary("ready"));
        return;
      }
      // The create answer describes the moment the target was minted; readiness is
      // the host's, so it is asked again until it says ready.
      fake.targetListReads += 1;
      const connecting = fake.connectingReplies > 0;
      if (connecting) fake.connectingReplies -= 1;
      await fulfillJson(route, 200, [
        targetSummary(connecting ? "connecting" : "ready"),
      ]);
      return;
    }
    await fulfillJson(route, 404, {
      problem: {
        code: "NotFound",
        message: `the fake host does not serve ${path}`,
        retryable: false,
      },
    });
  });

  await page.route("**/api/v1/filesystem/**", async (route) => {
    fake.filesystemRequests.push(route.request().url());
    await fulfillJson(route, 404, {
      problem: {
        code: "NotFound",
        message: "the fake host does not list directories",
        retryable: false,
      },
    });
  });

  await page.route("**/api/v1/repositories**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/repositories/register") {
      fake.registerBodies.push(parseBody(route));
      if (fake.registerProblem !== null) {
        await fulfillJson(route, 502, { problem: fake.registerProblem });
        return;
      }
      fake.registered = true;
      await fulfillJson(route, 200, remoteRepositoryList());
      return;
    }
    if (path === "/api/v1/repositories") {
      if (!fake.serveLocalRepositories) {
        // Nothing is registered on this machine: the launcher stays open until the
        // remote registration lands, which is the flow under test.
        await fulfillJson(
          route,
          200,
          fake.registered
            ? remoteRepositoryList()
            : { repositories: [], allowedRoots: [] },
        );
        return;
      }
      // The real list is fetched once and then served from the fake: the local
      // repository in it is real, and the registration's own refetch never waits on a
      // second round trip that the interception might leave hanging.
      fake.localRepositories ??= await readRealRepositories(route);
      const real = fake.localRepositories;
      if (!fake.registered) {
        await fulfillJson(route, 200, real);
        return;
      }
      const remote = remoteRepositoryList();
      const realRepositories = field(real, "repositories");
      const realRoots = field(real, "allowedRoots");
      await fulfillJson(route, 200, {
        repositories: [
          ...(Array.isArray(realRepositories) ? realRepositories : []),
          ...remote.repositories,
        ],
        allowedRoots: [
          ...(Array.isArray(realRoots) ? realRoots : []),
          ...remote.allowedRoots,
        ],
      });
      return;
    }
    await fulfillJson(route, 404, {
      problem: {
        code: "NotFound",
        message: `the fake host does not serve ${path}`,
        retryable: false,
      },
    });
  });
}

/** Opens the launcher, picks the fake host, and types the remote path. */
async function chooseRemoteTarget(page: Page): Promise<void> {
  await expect(page.getByTestId("execution-target-control")).toBeVisible();
  await page.getByTestId("execution-target-open").click();
  await page.getByTestId(`execution-target-option-host:${HOST_ID}`).click();
  await expect(page.getByTestId("execution-target-open")).toContainText(
    HOST_LABEL,
  );
}

test.describe("ssh repository launcher", () => {
  let repo: GitFixtureRepo;
  let service: E2eService;
  let fake: FakeHost;

  test.beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startE2eService({ repo });
    fake = createFakeHost();
  });

  test.afterEach(async () => {
    await service.stop();
    await repo.dispose();
  });

  test("keeps Browse for this machine and offers the host picker beside it", async ({
    page,
  }) => {
    await installFakeHost(page, fake);
    await page.goto(service.pairingUrl);

    // The location control exists because the host answered that it supports SSH
    // targets, and it starts on this machine.
    await expect(page.getByTestId("execution-target-control")).toBeVisible();
    await expect(page.getByTestId("execution-target-open")).toContainText(
      "This machine",
    );
    // Local path entry and its Browse control are exactly what they were: the target
    // support must not cost the local flow anything.
    await expect(page.getByLabel("Local repository path")).toBeVisible();
    await expect(page.getByTestId("launcher-browse")).toBeEnabled();
    await page.getByTestId("launcher-browse").click();
    await expect(page.getByTestId("repository-path-picker")).toBeVisible();
  });

  test("replaces Browse with a typed remote path and opens it on the created target", async ({
    page,
  }) => {
    // One `connecting` answer exercises the wait: the page must ask the host again
    // rather than register against a target it has not been told is ready.
    fake.connectingReplies = 1;
    fake.createTargetDelayMs = 1000;
    await installFakeHost(page, fake);
    await page.goto(service.pairingUrl);

    await chooseRemoteTarget(page);
    // The path field now means the other machine, and the local picker is refused.
    await expect(page.getByLabel("Remote repository path")).toBeVisible();
    await expect(page.getByTestId("launcher-browse")).toBeDisabled();
    // Before a target exists nothing has asked the host about that machine, so the
    // limit is stated as this build's; it is never filled with this machine's folders.
    await expect(page.getByTestId("launcher-remote-browse-note")).toContainText(
      `does not browse directories on ${HOST_LABEL}`,
    );

    await page.getByLabel("Remote repository path").fill(REMOTE_PATH);
    await page.getByTestId("launcher-open").click();

    // Progress is shown while the target is being created, not a silent wait.
    await expect(page.getByTestId("launcher-target-progress")).toContainText(
      `connecting to ${HOST_LABEL}`,
    );

    // The published order: create, then wait for ready, then register the typed path
    // on that target — never on this machine. The wait is visible in the reads: the
    // first answer said `connecting`, so the host had to be asked again.
    await expect.poll(() => fake.registerBodies.length).toBe(1);
    expect(fake.createTargetBodies).toHaveLength(1);
    expect(fake.targetListReads).toBeGreaterThanOrEqual(2);
    expect(field(fake.createTargetBodies[0], "kind")).toBe("ssh-config");
    expect(field(fake.createTargetBodies[0], "hostId")).toBe(HOST_ID);
    const registration = fake.registerBodies[0];
    expect(field(registration, "path")).toBe(REMOTE_PATH);
    expect(field(registration, "targetId")).toBe(TARGET_ID);
    // No directory listing was ever requested: this machine was not asked about a path
    // it does not own, and there was no local fallback registration.
    expect(fake.filesystemRequests).toEqual([]);

    // The created target is visible, and the tab and header name the machine.
    await expect(
      page.getByTestId(
        `repository-target-tgt_e2eRemote/${REMOTE_REPOSITORY_ID}`,
      ),
    ).toContainText(HOST_LABEL);
    await expect(page.getByTestId("repository-target-label")).toContainText(
      HOST_LABEL,
    );
    await expect(page.getByTestId("launcher-target-error")).toHaveCount(0);
  });

  test("shows the host's own words when creating the target fails", async ({
    page,
  }) => {
    fake.createTargetProblem = {
      code: "Unavailable",
      message: "ssh: connect to host e2e-remote port 22: Connection refused",
      retryable: true,
    };
    await installFakeHost(page, fake);
    await page.goto(service.pairingUrl);

    await chooseRemoteTarget(page);
    await page.getByLabel("Remote repository path").fill(REMOTE_PATH);
    await page.getByTestId("launcher-open").click();

    await expect(page.getByTestId("launcher-target-error")).toContainText(
      "ssh: connect to host e2e-remote port 22: Connection refused",
    );
    // A failed target means nothing was registered anywhere — no local fallback.
    expect(fake.registerBodies).toEqual([]);
    expect(fake.filesystemRequests).toEqual([]);
  });

  test("shows the host's own words when the path cannot be opened there", async ({
    page,
  }) => {
    fake.registerProblem = {
      code: "NotFound",
      message: `not a git repository: '${REMOTE_PATH}'`,
      retryable: false,
    };
    await installFakeHost(page, fake);
    await page.goto(service.pairingUrl);

    await chooseRemoteTarget(page);
    await page.getByLabel("Remote repository path").fill(REMOTE_PATH);
    await page.getByTestId("launcher-open").click();

    await expect(page.getByTestId("launcher-target-error")).toContainText(
      `not a git repository: '${REMOTE_PATH}'`,
    );
    // The host's own `remotePathBrowse: false` now backs the disabled Browse, in the
    // host's words rather than an assumption.
    await expect(page.getByTestId("launcher-remote-browse-note")).toContainText(
      `The host reports it cannot list directories on ${HOST_LABEL}`,
    );
    // The target was created and asked again for readiness before the path was sent,
    // and the path went to the target, not to this machine.
    expect(fake.createTargetBodies).toHaveLength(1);
    expect(fake.registerBodies).toHaveLength(1);
    expect(field(fake.registerBodies[0], "targetId")).toBe(TARGET_ID);
    expect(fake.filesystemRequests).toEqual([]);
  });

  test("keeps the local tab's data when the remote tab is closed", async ({
    page,
  }) => {
    // A local repository this machine can actually read, next to the remote one: the
    // two must not share tabs, identity, or cached reads, and releasing the remote
    // machine must leave the local view exactly as it was.
    await repo.write("a.txt", "changed on this machine\n");
    fake.serveLocalRepositories = true;

    await installFakeHost(page, fake);
    await page.goto(service.pairingUrl);
    const working = page.getByTestId("working-copy-panel");
    await expect(working).toContainText("a.txt");

    await page.getByTestId("new-repository-tab").click();
    await chooseRemoteTarget(page);
    await page.getByLabel("Remote repository path").fill(REMOTE_PATH);
    await page.getByTestId("launcher-open").click();
    await expect.poll(() => fake.registerBodies.length).toBe(1);

    const tabs = page.getByTestId("repository-tabs");
    const tabRows = tabs.locator('[data-testid^="repository-tab-"]');
    await expect(tabRows).toHaveCount(2);
    // Two tabs, two machines, and the same path is not one of them: the remote tab is
    // the only one that names a host.
    await expect(
      page.getByTestId(
        `repository-target-tgt_e2eRemote/${REMOTE_REPOSITORY_ID}`,
      ),
    ).toContainText(HOST_LABEL);
    await expect(
      tabRows.first().locator('[data-testid^="repository-target-"]'),
    ).toHaveCount(0);

    // The remote tab shows the remote repository, not this machine's working copy.
    await expect(working).not.toContainText("a.txt");
    await expect(page.getByTestId("repository-target-label")).toContainText(
      HOST_LABEL,
    );

    // Back on this machine: its own data again, unchanged by the remote session.
    await tabRows.first().getByRole("button").first().click();
    await expect(working).toContainText("a.txt");
    await expect(page.getByTestId("repository-target-label")).toHaveCount(0);

    // Closing the remote tab releases its target and nothing else: the disconnect is
    // for that target, and the local view still reads.
    await tabs
      .getByRole("button", { name: "Close e2e-remote-repo", exact: true })
      .click();
    await expect.poll(() => fake.disconnectBodies.length).toBe(1);
    expect(field(fake.disconnectBodies[0], "targetId")).toBe(TARGET_ID);
    await expect(tabRows).toHaveCount(1);
    await expect(working).toContainText("a.txt");
  });
});
