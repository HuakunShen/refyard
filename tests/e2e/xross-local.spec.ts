/** Browser proof for the self-contained, facade-only Xross local entry. */
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import vectors from "../../integrations/xross/contracts/view-v1/vectors/method-responses.json" with { type: "json" };

const root = resolve(fileURLToPath(new URL("../../apps/web/build-xross-local", import.meta.url)));
const capabilitiesFixture = vectors.responses.refyard.capabilities.value;
let server: Server;
let origin: string;

// CI uses managed Chromium; this workstation uses its installed Chrome.
test.use({ channel: process.env.CI ? undefined : "chrome" });
test.skip(({ browserName }) => browserName !== "chromium", "The local-pack smoke entry is covered by Chromium");

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const file = resolve(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(file);
      const mime = extname(file) === ".js" ? "text/javascript" : extname(file) === ".css" ? "text/css" : extname(file) === ".svg" ? "image/svg+xml" : "text/html";
      response.writeHead(200, { "content-type": mime }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing local server address");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
});

test("Xross local entry renders only facade data and makes no API or external request", async ({ page }) => {
  const document = await readFile(join(root, "xross", "index.html"), "utf8");
  expect(document).toContain('href="../favicon.svg"');
  expect(document).not.toContain('rel="manifest"');
  const requests: string[] = [];
  const failedAssets: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failedAssets.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript((capabilities) => {
    const context = {
      contractMajor: 1, featureBits: ["refyard.read"], packId: "refyard",
      packDigest: "a".repeat(64), xrossVersion: "1.0.0",
      sourceClientIncarnation: "1".repeat(32), targetDeviceId: "xdev_1aaaaaaaaaaaaaaaaaaaaaaaaa",
      targetDisplayLabel: "Test Mac", targetPolicyRevision: "4",
      bridgeGeneration: "2".repeat(32), locale: "zh-Hans",
    };
    const status = {
      repositoryId: "repo_demo", worktreeId: "wt_main",
      snapshotId: `rsnapshot_${"0".repeat(31)}1`, readAtUnixMs: "1710000000000",
      head: { kind: "born", branchName: "main", oid: "0".repeat(40), detached: false },
      upstream: null, operationInProgress: null,
      entries: [{ pathId: "path_decomposed", displayPath: "e\u0301.txt", pathEncoding: "utf8",
        kind: "ordinary", indexStatus: ".", worktreeStatus: "M", originalPathId: null,
        originalDisplayPath: null, headOid: null, indexOid: null, headMode: null,
        indexMode: null, worktreeMode: null, submodule: null, unmergedStages: null }],
      entryCount: 2, truncated: true, nextCursor: "cur_second",
    };
    const statusCalls: (string | null)[] = [];
    Reflect.set(globalThis, "__xrossStatusCalls", statusCalls);
    Reflect.set(globalThis, "xrossRefyardV1", {
      context: async () => context,
      capabilities: async () => ({ ...capabilities,
        reads: ["filesystem", "repositories", "status"] }),
      listWorkspaceRoots: async () => ({ items: [{ workspaceRootId: "root_demo", displayLabel: "Projects", policyRevision: "1" }], nextCursor: null }),
      listRepositories: async () => ({ items: [{ repositoryId: "repo_demo", workspaceRootId: "root_demo", displayName: "Démo", objectFormat: "sha1", worktreeIds: ["wt_main"], primaryWorktreeId: "wt_main", head: status.head, operationInProgress: null }], nextCursor: null }),
      getStatus: async (request: { query: { cursor?: string } }) => {
        statusCalls.push(request.query.cursor ?? null);
        return request.query.cursor === undefined ? status : {
          ...status, entries: [{ ...status.entries[0], pathId: "path_second", displayPath: "next.txt" }],
          truncated: false, nextCursor: null,
        };
      },
      historyPage: async () => ({}), listRefs: async () => ({}), listWorktrees: async () => ({}),
      listStashes: async () => ({}), listSubmodules: async () => ({}), getPathPreviews: async () => ({}),
      readDiff: async () => ({}), previewMutation: async () => ({}), requestMutationSubmission: async () => ({ decision: "denied" }),
      getMutationJob: async () => ({}),
      listMutationRecoveries: async () => ({ snapshotId: `rrecoverysnapshot_${"0".repeat(31)}1`, items: [], nextCursor: null }),
      watchRepository: async function* () {}, watchMutation: async function* () {},
    });
  }, capabilitiesFixture);
  await page.goto(`${origin}/xross/`);
  await expect(page.getByRole("heading", { name: "Xross 中的 Refyard" })).toBeVisible();
  await expect(page.getByText("Projects")).toBeVisible();
  await page.getByRole("button", { name: "Démo" }).click();
  await expect(page.getByText("e\u0301.txt")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "__xrossStatusCalls"))).toEqual([null]);
  await page.getByRole("button", { name: "加载下一页" }).click();
  await expect(page.getByText("next.txt")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "__xrossStatusCalls"))).toEqual([null, "cur_second"]);
  expect(requests.every((url) => url.startsWith(origin))).toBe(true);
  expect(requests.some((url) => url.includes("/api/") || url.includes("service-worker"))).toBe(false);
  expect(failedAssets).toEqual([]);
});

test("missing native facade stays refused without offering the browser connection form", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${origin}/xross/`);
  await expect(page.getByRole("alert")).toContainText("Xross Refyard host unavailable");
  await expect(page.getByPlaceholder("http://127.0.0.1:47831")).toHaveCount(0);
  await expect(page.getByText("Connect to the local service")).toHaveCount(0);
  expect(requests.every((url) => url.startsWith(origin) && !url.includes("/api/") && !url.includes("service-worker"))).toBe(true);
});

test("restart reattaches only an exact found job and keeps an unrelated unknown recovery fenced", async ({ page }) => {
  await page.addInitScript((capabilities) => {
    const jobId = `rjob_${"1".repeat(32)}`;
    const job = { jobId, state: "running", sequence: "18446744073709551614",
      createdAtUnixMs: "1710000000000", updatedAtUnixMs: "1710000000000", problemCode: null };
    const calls: string[] = [];
    Reflect.set(globalThis, "__xrossRecoveryCalls", calls);
    Reflect.set(globalThis, "xrossRefyardV1", {
      context: async () => ({ contractMajor: 1, featureBits: ["refyard.read"], packId: "refyard",
        packDigest: "a".repeat(64), xrossVersion: "1.0.0", sourceClientIncarnation: "1".repeat(32),
        targetDeviceId: "xdev_1aaaaaaaaaaaaaaaaaaaaaaaaa", targetDisplayLabel: "Test Mac",
        targetPolicyRevision: "4", bridgeGeneration: "2".repeat(32), locale: "en" }),
      capabilities: async () => ({ ...capabilities,
        reads: ["filesystem", "repositories"] }),
      listWorkspaceRoots: async () => ({ items: [], nextCursor: null }),
      listRepositories: async () => ({ items: [], nextCursor: null }),
      getStatus: async () => ({}), historyPage: async () => ({}), listRefs: async () => ({}),
      listWorktrees: async () => ({}), listStashes: async () => ({}), listSubmodules: async () => ({}),
      getPathPreviews: async () => ({}), readDiff: async () => ({}), previewMutation: async () => ({}),
      requestMutationSubmission: async () => ({ decision: "denied" }),
      getMutationJob: async (request: { jobId: string }) => {
        calls.push(`get:${request.jobId}`);
        return { ...job, sequence: calls.filter((call) => call.startsWith("get:")).length === 1
          ? job.sequence : "18446744073709551615" };
      },
      listMutationRecoveries: async () => ({ snapshotId: `rrecoverysnapshot_${"0".repeat(31)}1`,
        items: [
          { recoveryId: `rrecovery_${"0".repeat(31)}1`, operationKind: "stagePaths", resourceLabel: "repo one",
            summaryKey: "first", createdAtUnixMs: "1710000000000", updatedAtUnixMs: "1710000000000",
            writeFence: "blocked", state: { kind: "found", job } },
          { recoveryId: `rrecovery_${"0".repeat(31)}2`, operationKind: "commit", resourceLabel: "repo two",
            summaryKey: "second", createdAtUnixMs: "1710000000000", updatedAtUnixMs: "1710000000000",
            writeFence: "blocked", state: { kind: "unknown" } },
        ], nextCursor: null }),
      watchRepository: async function* () {},
      watchMutation: async function* (request: { jobId: string; sinceSequence?: string }) {
        calls.push(`watch:${request.jobId}:${request.sinceSequence}`);
        yield { kind: "gap" };
        yield { kind: "terminal" };
      },
    });
  }, capabilitiesFixture);
  await page.goto(`${origin}/xross/`);
  await expect(page.getByRole("alert")).toContainText("outcome is unknown");
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "__xrossRecoveryCalls"))).toEqual([
    `get:rjob_${"1".repeat(32)}`,
    `watch:rjob_${"1".repeat(32)}:18446744073709551614`,
    `get:rjob_${"1".repeat(32)}`,
    `get:rjob_${"1".repeat(32)}`,
  ]);
  await expect(page.getByText(`rjob_${"1".repeat(32)}`, { exact: true }).locator("..")).toContainText("18446744073709551615");
});

for (const language of [
  { locale: "en", title: "Refyard on Xross", empty: "No approved repositories were returned." },
  { locale: "zh-Hans", title: "Xross 中的 Refyard", empty: "未返回已批准的仓库。" },
  { locale: "ja", title: "Xross の Refyard", empty: "承認済みリポジトリは返されませんでした。" },
  { locale: "es", title: "Refyard en Xross", empty: "No se devolvieron repositorios aprobados." },
  { locale: "fr", title: "Refyard dans Xross", empty: "Aucun dépôt autorisé n’a été renvoyé." },
]) {
  test(`host locale ${language.locale} selects an accessible catalog heading and empty state`, async ({ page }) => {
    await page.addInitScript(({ locale, capabilities }) => {
      Reflect.set(globalThis, "xrossRefyardV1", {
        context: async () => ({ contractMajor: 1, featureBits: ["refyard.read"], packId: "refyard",
          packDigest: "a".repeat(64), xrossVersion: "1.0.0", sourceClientIncarnation: "1".repeat(32),
          targetDeviceId: "xdev_1aaaaaaaaaaaaaaaaaaaaaaaaa", targetDisplayLabel: "Test Mac",
          targetPolicyRevision: "4", bridgeGeneration: "2".repeat(32), locale }),
        capabilities: async () => ({ ...capabilities,
          reads: ["filesystem", "repositories"] }),
        listWorkspaceRoots: async () => ({ items: [], nextCursor: null }),
        listRepositories: async () => ({ items: [], nextCursor: null }),
        getStatus: async () => ({}), historyPage: async () => ({}), listRefs: async () => ({}),
        listWorktrees: async () => ({}), listStashes: async () => ({}), listSubmodules: async () => ({}),
        getPathPreviews: async () => ({}), readDiff: async () => ({}), previewMutation: async () => ({}),
        requestMutationSubmission: async () => ({ decision: "denied" }), getMutationJob: async () => ({}),
        listMutationRecoveries: async () => ({ snapshotId: `rrecoverysnapshot_${"0".repeat(31)}1`, items: [], nextCursor: null }),
        watchRepository: async function* () {}, watchMutation: async function* () {},
      });
    }, { locale: language.locale, capabilities: capabilitiesFixture });
    await page.goto(`${origin}/xross/`);
    await expect(page.getByRole("heading", { level: 1, name: language.title })).toBeVisible();
    await expect(page.getByText(language.empty)).toBeVisible();
  });
}
