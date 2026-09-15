/**
 * Static assets and the browser client, over a real server.
 *
 * The asset cases are about what a *browser* does with the answer, which is why
 * they assert on content type and status rather than only on bytes:
 *
 * - a missing `.js` must be a 404, because a browser that receives HTML where it
 *   expected a module reports a syntax error and a service worker would cache the
 *   wrong response for a URL that may exist later;
 * - `/api/*` must never fall through to the shell, so a client can rely on JSON;
 * - a path that climbs out of the asset root must be refused, not resolved;
 * - a route-shaped path *is* allowed to return the shell, because that is what a
 *   single-page app needs to boot on a deep link.
 *
 * The client cases run the real `@refyard/git-client` against the real server: a
 * stub would prove the DTO shapes match the schemas but not that the HTTP paths,
 * query strings and headers do.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { inlineScriptHashes } from "@refyard/host-node";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGitClient,
  createMutationClient,
  GitClientError,
} from "@refyard/git-client";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  ticketFrom,
  type TestService,
} from "../support/service.js";

const DOCUMENT = "<!doctype html><title>shell</title><div id=app></div>";

describe("static assets", () => {
  let repo: GitFixtureRepo;
  let webRoot: string;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    webRoot = await mkdtemp(join(tmpdir(), "refyard-web-"));
    await writeFile(join(webRoot, "200.html"), DOCUMENT);
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "assets", "app.js"), "export const x = 1;\n");
    await writeFile(join(webRoot, "assets", "app.css"), "body{}\n");
    service = await startTestService({ repo, webRoot });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
    await rm(webRoot, { recursive: true, force: true });
  });

  it("serves the shell for a client-side route", async () => {
    const response = await service.fetch("/repositories/repo_1/history");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe(DOCUMENT);
  });

  it("serves a real asset with its own content type", async () => {
    const response = await service.fetch("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toContain("export const x");
  });

  it("answers 404 for a missing asset instead of returning the shell", async () => {
    // Prevents: a browser being handed HTML where it expected JavaScript, which
    // shows up as a syntax error and gets cached under a hashed asset name.
    const response = await service.fetch("/assets/missing-1234.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("answers 404 for a missing stylesheet too", async () => {
    const response = await service.fetch("/assets/missing.css");
    expect(response.status).toBe(404);
  });

  it("sends a content security policy that forbids remote script and framing", async () => {
    const response = await service.fetch("/");
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses a traversal path", async () => {
    // Prevents: the asset handler reading a file next to the bundle — a log, a
    // configuration file, or a repository.
    for (const path of [
      "/../secret.txt",
      "/assets/../../secret.txt",
      "/%2e%2e/secret.txt",
    ]) {
      const response = await service.fetch(path);
      expect([400, 403, 404]).toContain(response.status);
    }
  });

  it("refuses a NUL byte in the path", async () => {
    const response = await service.fetch("/assets/app.js%00.html");
    expect([400, 404]).toContain(response.status);
  });

  it("refuses an asset that is a symlink out of the bundle", async () => {
    const outside = join(webRoot, "..", `outside-${Date.now()}.txt`);
    await writeFile(outside, "not part of the bundle\n");
    await symlink(outside, join(webRoot, "assets", "link.txt"));
    try {
      const response = await service.fetch("/assets/link.txt");
      expect([403, 404]).toContain(response.status);
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("re-hashes a document that was rebuilt under the running service", async () => {
    // Prevents: the stale-CSP trap in the development loop. The policy names the hash of
    // the document's own inline bootstrap, so it is only valid for the bytes it was read
    // from. `pnpm build` rewrites these files while a service is running; a header cached
    // by path alone would keep naming the old hash, the browser would refuse the new
    // inline script, and the app would never start — with nothing in the UI to explain it.
    const first = "<!doctype html><script>window.shell = 'one';</script>";
    const second =
      "<!doctype html><script>window.shell = 'two, and longer';</script>";
    await writeFile(join(webRoot, "200.html"), first);
    const before = await service.fetch("/");
    const policyBefore = before.headers.get("content-security-policy") ?? "";
    const hashBefore = /sha256-[A-Za-z0-9+/=]+/.exec(policyBefore)?.[0];
    expect(hashBefore).toBeDefined();
    // The policy names the hash of what was actually served, not of something else.
    const expectedBefore = inlineScriptHashes(first);
    expect(policyBefore).toContain(expectedBefore[0] ?? "no-hash");

    // The rebuild: same path, different bytes.
    await writeFile(join(webRoot, "200.html"), second);
    const after = await service.fetch("/");
    const policyAfter = after.headers.get("content-security-policy") ?? "";
    expect(policyAfter).toContain(inlineScriptHashes(second)[0] ?? "no-hash");
    expect(policyAfter).not.toContain(hashBefore ?? "never-matches");
  });

  it("records why a refusal happened, not only its status", async () => {
    // Prevents: a log line that says `problem=Forbidden` and leaves the reader guessing.
    // Two different checks answer with that code, and the difference matters: one is a
    // client sending a bad path, the other is a symlink inside the bundle.
    const response = await service.fetch("/api/v1/capabilities");
    expect(response.status).toBe(401);
    const line = service.log.find((entry) =>
      entry.includes("/api/v1/capabilities"),
    );
    expect(line).toBeDefined();
    expect(line).toContain("problem=Unauthenticated");
    // The reason is quoted, so a message containing spaces stays one token.
    expect(line).toMatch(/reason="[^"]+"/);
    expect(line?.split("\n")).toHaveLength(1);
  });

  it("serves a placeholder that says what is true when there is no web build", async () => {
    const bare = await startTestService({
      repo,
      inlineDocument: "<!doctype html><p>no build</p>",
    });
    try {
      const response = await bare.fetch("/");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("no build");
      // …but a missing asset is still a 404, not the placeholder.
      const asset = await bare.fetch("/assets/app.js");
      expect(asset.status).toBe(404);
    } finally {
      await bare.close();
    }
  });
});

describe("git client", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startTestService({ repo });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
  });

  /** A client that pairs itself, the way the SPA does after reading the fragment. */
  async function pairedClient(): Promise<{
    readonly client: ReturnType<typeof createGitClient>;
    readonly token: string;
  }> {
    let token: string | null = null;
    const client = createGitClient({
      baseUrl: service.baseUrl,
      fetch: (input, init) =>
        service.fetch(String(input).replace(service.baseUrl, ""), {
          ...init,
          ...(token === null ? {} : { token }),
        }),
      token: () => token,
    });
    const exchanged = await client.exchangeTicket(
      ticketFrom(service.pairingUrl),
    );
    token = exchanged.token;
    return { client, token };
  }

  it("pairs with a ticket and reads capabilities", async () => {
    const { client } = await pairedClient();
    const capabilities = await client.capabilities();
    expect(capabilities.apiMajor).toBe(1);
    // The staging mutations are implemented in this build and must be advertised;
    // everything else must stay absent until an effect exists for it.
    const kinds = capabilities.operations.map((operation) => operation.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "stagePaths",
        "unstagePaths",
        "discardTrackedPaths",
        "commit",
        "amendCommit",
      ]),
    );
    expect(kinds).toContain("createBranch");
    expect(kinds).toContain("createStash");
    expect(kinds).toContain("createWorktree");
    expect(kinds).toContain("abortMerge");
    // Every mutation the contract defines now has an effect, so the list is complete
    // and `unavailable` is empty. A kind with no effect stays absent until one
    // exists — the case below runs a service that has none.
    expect(kinds).toContain("initRepository");
    expect(kinds).toContain("cloneRepository");
    expect(capabilities.unavailable).toEqual([]);
    expect(capabilities.reads).toContain("status");
  });

  it("reads status, history and refs with contract-shaped values", async () => {
    await repo.write("a.txt", "changed\n");
    const { client } = await pairedClient();
    const status = await client.status({ repositoryId: service.repositoryId });
    expect(status.entries[0]?.displayPath).toBe("a.txt");
    const history = await client.history({
      repositoryId: service.repositoryId,
      limit: 5,
    });
    expect(history.commits[0]?.subject).toBe("base");
    const refs = await client.refs({ repositoryId: service.repositoryId });
    expect(refs.branches[0]?.name).toBe("main");
  });

  it("pages history with a cursor from the previous page", async () => {
    for (let index = 0; index < 4; index += 1) {
      await repo.write(`f${index}.txt`, `${index}\n`);
      await repo.commitAll(`commit ${index}`);
    }
    const { client } = await pairedClient();
    const first = await client.history({
      repositoryId: service.repositoryId,
      limit: 2,
    });
    expect(first.nextCursor).not.toBeNull();
    const second = await client.history({
      repositoryId: service.repositoryId,
      limit: 2,
      cursor: first.nextCursor ?? "",
    });
    const firstOids = new Set(first.commits.map((commit) => commit.oid));
    expect(second.commits.some((commit) => firstOids.has(commit.oid))).toBe(
      false,
    );
  });

  it("reads a diff for one path", async () => {
    await repo.write("a.txt", "changed\n");
    const { client } = await pairedClient();
    const status = await client.status({ repositoryId: service.repositoryId });
    const pathId = status.entries[0]?.pathId ?? "";
    const diff = await client.diff({
      repositoryId: service.repositoryId,
      kind: "unstaged",
      pathId,
    });
    expect(diff.files[0]?.changeKind).toBe("modified");
  });

  it("turns a 401 into an Unauthenticated error a UI can branch on", async () => {
    const client = createGitClient({
      baseUrl: service.baseUrl,
      fetch: (input, init) =>
        service.fetch(String(input).replace(service.baseUrl, ""), init ?? {}),
    });
    await expect(client.repositories()).rejects.toBeInstanceOf(GitClientError);
    try {
      await client.repositories();
    } catch (error) {
      expect(error).toBeInstanceOf(GitClientError);
      if (error instanceof GitClientError) {
        expect(error.code).toBe("Unauthenticated");
        expect(error.isUnauthenticated()).toBe(true);
        expect(error.status).toBe(401);
      }
    }
  });

  it("turns a 501 for an unimplemented operation into UnsupportedOperation", async () => {
    // A service with no effects at all stands in for a build that does not implement
    // the operation: the 501 comes from the registry, never from a hardcoded list of
    // "known but missing" kinds, and the client surfaces the closed code.
    const none = await startTestService({ repo, effects: [] });
    try {
      const token = await none.pair();
      const mutations = createMutationClient({
        baseUrl: none.baseUrl,
        fetch: (input, init) =>
          none.fetch(String(input).replace(none.baseUrl, ""), init ?? {}),
        token: () => token,
      });
      await expect(
        mutations.submit({
          clientRequestId: "http-501-1",
          target: {
            kind: "workspace",
            allowedRootId: none.allowedRootId,
            relativeDestination: "not-implemented-here",
          },
          operation: { kind: "initRepository", initialBranch: null },
        }),
      ).rejects.toMatchObject({ code: "UnsupportedOperation", status: 501 });

      // And the same service says so in capabilities: nothing is advertised, and
      // every kind it cannot run is named with a reason.
      const capabilitiesResponse = await none.fetch("/api/v1/capabilities", {
        token,
      });
      expect(capabilitiesResponse.status).toBe(200);
      const capabilities = (await capabilitiesResponse.json()) as {
        operations: readonly { kind: string }[];
        unavailable: readonly {
          code: string;
          message: string;
          operations: readonly string[];
        }[];
      };
      expect(capabilities.operations).toEqual([]);
      // One reason naming every missing kind — not one entry per kind, and not an
      // empty list: a build with nothing to offer says so explicitly.
      expect(capabilities.unavailable).toHaveLength(1);
      const missing = capabilities.unavailable[0];
      expect(missing?.code).toBe("not-implemented");
      expect(missing?.message.length).toBeGreaterThan(0);
      expect(missing?.operations.length).toBe(35);
      expect(missing?.operations).toContain("initRepository");
    } finally {
      await none.close();
    }
  });

  it("fails when the service answers with a body that breaks the contract", async () => {
    // Prevents: a drifted server shape reaching UI code as `undefined` deep inside a
    // component, where the cause is impossible to see.
    const client = createGitClient({
      baseUrl: service.baseUrl,
      fetch: async () =>
        new Response(JSON.stringify({ repositories: "not an array" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      token: () => "unused",
    });
    await expect(client.repositories()).rejects.toMatchObject({
      code: "InternalError",
    });
  });
});
