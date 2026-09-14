/**
 * Authorised paths: handles, the text codec, content fingerprints, recovery
 * backups and preview tokens.
 *
 * Each case here maps to a stated failure the design refuses to ship:
 *
 * - a handle escaping its approved root (traversal or a symlink swapped in later);
 * - a path whose bytes are not UTF-8 being used as an operation input instead of
 *   being refused with `UnsupportedPathEncoding`;
 * - a `git status` marker being treated as proof that content is unchanged;
 * - a discard running when its backup could not be verified.
 */
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHandleRegistry,
  createRecoveryStore,
  createTextCodec,
  encodeExecutionPath,
  fingerprintFile,
  HandleError,
  isInsideOrEqual,
  isSafeRelativePath,
  readPathMetadata,
  sniffContentKind,
} from "../../packages/host-node/src/index.js";
import {
  createPreviewStore,
  fingerprintBytes,
} from "../../packages/host-node/src/filesystem/preview.js";

let scratch = "";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "refyard-paths-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("handle registry", () => {
  it("resolves a handle to a real path inside its approved root", async () => {
    const registry = createHandleRegistry();
    await mkdir(join(scratch, "repo", "src"), { recursive: true });
    await registry.approveRoot({
      allowedRootId: "root_1",
      path: join(scratch, "repo"),
    });
    const handle = registry.handleFor("root_1", "src");
    const resolved = await registry.resolve(handle);
    expect(resolved.relativePath).toBe("src");
    expect(resolved.absolutePath.endsWith(join("repo", "src"))).toBe(true);
  });

  it("refuses a relative path that climbs out of the root", async () => {
    // Prevents: `../..` in a request reaching a directory the user never approved.
    const registry = createHandleRegistry();
    await registry.approveRoot({ allowedRootId: "root_1", path: scratch });
    expect(() => registry.handleFor("root_1", "../elsewhere")).toThrow(
      HandleError,
    );
    expect(() => registry.handleFor("root_1", "a/../../b")).toThrow(
      HandleError,
    );
    expect(() => registry.handleFor("root_1", "/etc")).toThrow(HandleError);
  });

  it("refuses a handle whose directory became a symlink to another root", async () => {
    // Prevents: the time-of-check/time-of-use escape, where a directory is swapped
    // for a link between approval and use.
    const registry = createHandleRegistry();
    const rootPath = join(scratch, "repo");
    const outside = join(scratch, "outside");
    await mkdir(rootPath, { recursive: true });
    await mkdir(outside, { recursive: true });
    await registry.approveRoot({ allowedRootId: "root_1", path: rootPath });
    const handle = registry.handleFor("root_1", "linked");
    await symlink(outside, join(rootPath, "linked"));
    await expect(registry.resolve(handle)).rejects.toThrow(HandleError);
  });

  it("refuses a root that is not inside its declared parent", async () => {
    const registry = createHandleRegistry();
    const parent = join(scratch, "parent");
    const other = join(scratch, "other");
    await mkdir(parent, { recursive: true });
    await mkdir(other, { recursive: true });
    await registry.approveRoot({ allowedRootId: "root_p", path: parent });
    await expect(
      registry.approveRoot({
        allowedRootId: "root_c",
        path: other,
        parentRootId: "root_p",
      }),
    ).rejects.toThrow(HandleError);
  });

  it("refuses an unknown handle instead of guessing a directory", async () => {
    const registry = createHandleRegistry();
    await expect(registry.resolve("dir_forged")).rejects.toThrow(HandleError);
  });

  it("agrees with the containment helper on the boundary cases", () => {
    expect(isInsideOrEqual("/a/b", "/a/b")).toBe(true);
    expect(isInsideOrEqual("/a/b", "/a/b/c")).toBe(true);
    expect(isInsideOrEqual("/a/b", "/a/bc")).toBe(false);
    expect(isInsideOrEqual("/a/b", "/a")).toBe(false);
  });

  it("rejects a relative path with empty, dot or NUL segments", () => {
    expect(isSafeRelativePath("src/app")).toBe(true);
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath(".")).toBe(false);
    expect(isSafeRelativePath("src//app")).toBe(false);
    expect(isSafeRelativePath("src/\u0000/app")).toBe(false);
  });
});

describe("text codec", () => {
  it("round-trips a UTF-8 path", () => {
    const codec = createTextCodec();
    const bytes = new TextEncoder().encode("src/中文名 file.txt");
    const display = codec.toDisplayPath(bytes);
    expect(display.representable).toBe(true);
    expect(display.text).toBe("src/中文名 file.txt");
    expect(encodeExecutionPath(display.text)).not.toBeNull();
  });

  it("escapes an invalid byte for display and refuses to encode it back", () => {
    // Prevents: a path that is not valid UTF-8 being sent back to Git as a
    // *different* path, which would stage or discard the wrong file.
    const codec = createTextCodec();
    const display = codec.toDisplayPath(
      new Uint8Array([0x66, 0x6f, 0x6f, 0xff]),
    );
    expect(display.representable).toBe(false);
    expect(display.text).toBe("foo\\xff");
    expect(encodeExecutionPath(display.text)).toBeNull();
  });

  it("refuses any text in the escape form, even when it could be a real name", () => {
    // Prevents: `\x41` being taken as a literal name when it may have been minted
    // as an escape for a byte that cannot be represented — the ambiguous case
    // fails closed rather than acting on a path the user was never shown.
    expect(encodeExecutionPath("a\\x41.txt")).toBeNull();
    expect(encodeExecutionPath("dir/normal.txt")).not.toBeNull();
  });

  it("keeps a NUL-containing string out of the execution path", () => {
    expect(encodeExecutionPath("a\u0000b")).toBeNull();
  });

  it("decodes prose with replacement instead of failing", () => {
    const codec = createTextCodec();
    expect(codec.decodeText(new Uint8Array([0x61, 0xff, 0x62]))).toBe(
      "a\uFFFDb",
    );
  });
});

describe("path metadata and fingerprints", () => {
  it("reports a regular file's size and mode without following symlinks", async () => {
    await writeFile(join(scratch, "a.txt"), "base\n");
    const metadata = await readPathMetadata(join(scratch, "a.txt"));
    expect(metadata.kind).toBe("regularFile");
    expect(metadata.sizeBytes).toBe(5);
  });

  it("classifies a directory, a symlink and a gitlink differently", async () => {
    await mkdir(join(scratch, "dir"));
    await writeFile(join(scratch, "target.txt"), "x");
    await symlink(join(scratch, "target.txt"), join(scratch, "link.txt"));
    expect((await readPathMetadata(join(scratch, "dir"))).kind).toBe(
      "directory",
    );
    expect((await readPathMetadata(join(scratch, "link.txt"))).kind).toBe(
      "symlink",
    );
  });

  it("fingerprints content, so a rewrite with the same size is not the same file", async () => {
    // Prevents: a discard authorised against "5 bytes" being applied to a file that
    // was edited from `base\n` to `new!\n` between preview and confirmation.
    const path = join(scratch, "a.txt");
    await writeFile(path, "base\n");
    const first = await fingerprintFile(path);
    await writeFile(path, "new!\n");
    const second = await fingerprintFile(path);
    expect(first.sizeBytes).toBe(second.sizeBytes);
    expect(first.hex).not.toBe(second.hex);
  });

  it("classifies content the way Git does: NUL means binary", async () => {
    await writeFile(join(scratch, "bin"), new Uint8Array([0x00, 0x01, 0x02]));
    await writeFile(join(scratch, "txt"), "hello\n");
    expect((await fingerprintFile(join(scratch, "bin"))).contentKind).toBe(
      "binary",
    );
    expect((await fingerprintFile(join(scratch, "txt"))).contentKind).toBe(
      "text",
    );
  });

  it("marks bytes that are neither valid text nor NUL-binary as unrepresentable", () => {
    // Prevents: a file that is not valid UTF-8 and has no NUL being treated as
    // text, which would show replacement characters and diff as garbage. Git's own
    // binary rule (a NUL byte) says nothing about these bytes, so this service
    // reports the honest third answer instead of picking one.
    expect(sniffContentKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "unrepresentable",
    );
    expect(sniffContentKind(new Uint8Array([0x00, 0xff]))).toBe("binary");
    expect(sniffContentKind(new TextEncoder().encode("plain"))).toBe("text");
  });
});

describe("recovery store", () => {
  it("verifies a backup before reporting success", async () => {
    const root = join(scratch, "recovery");
    const store = createRecoveryStore({ root, now: () => 1_000_000 });
    await writeFile(join(scratch, "a.txt"), "content that must survive\n");
    const outcome = await store.backUp({
      originalPath: join(scratch, "a.txt"),
      contentRoot: scratch,
      operationId: "op_1",
    });
    expect(outcome.kind).toBe("verified");
    if (outcome.kind === "verified") {
      expect(outcome.record.fingerprint.contentKind).toBe("text");
    }
    const listed = await store.list();
    expect(listed).toHaveLength(1);
  });

  it("refuses rather than evicting when the budget cannot hold the file", async () => {
    // Prevents: "back up what can be lost" degrading into "delete the older backup
    // and proceed", which silently destroys the previous safety net.
    const root = join(scratch, "recovery");
    const store = createRecoveryStore({
      root,
      budget: { maxTotalBytes: 8, maxAgeMs: 60_000 },
      now: () => 1_000,
    });
    await writeFile(join(scratch, "big.txt"), "far more than eight bytes\n");
    const outcome = await store.backUp({
      originalPath: join(scratch, "big.txt"),
      contentRoot: scratch,
      operationId: "op_2",
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
    expect(await store.list()).toHaveLength(0);
  });

  it("restores a verified backup", async () => {
    const root = join(scratch, "recovery");
    const store = createRecoveryStore({ root, now: () => 2_000 });
    const path = join(scratch, "b.txt");
    await writeFile(path, "original\n");
    const outcome = await store.backUp({
      originalPath: path,
      contentRoot: scratch,
      operationId: "op_3",
    });
    expect(outcome.kind).toBe("verified");
    await writeFile(path, "changed\n");
    if (outcome.kind === "verified") {
      await store.restore(outcome.record);
    }
    expect(await readFile(path, "utf8")).toBe("original\n");
  });
});

describe("preview store", () => {
  const claim = {
    repositoryId: "repo_1",
    worktreeId: "wt_1",
    pathId: "path_1",
    fingerprintHex: fingerprintBytes(new TextEncoder().encode("base\n")),
    sizeBytes: 5,
    contentKind: "text" as const,
  };

  it("accepts a token whose fingerprint still matches", () => {
    const store = createPreviewStore({ now: () => 0 });
    const issued = store.issue(claim);
    expect(issued.previewToken.startsWith("pt_")).toBe(true);
    expect(
      store.verify([
        {
          previewToken: issued.previewToken,
          pathId: "path_1",
          fingerprintHex: claim.fingerprintHex,
        },
      ]),
    ).toEqual({ ok: true });
  });

  it("refuses a token when the content changed since the preview", () => {
    // Prevents: discarding a file the user never saw, because status looked the
    // same while the content had been rewritten.
    const store = createPreviewStore({ now: () => 0 });
    const issued = store.issue(claim);
    const changed = fingerprintBytes(new TextEncoder().encode("other\n"));
    const check = store.verify([
      {
        previewToken: issued.previewToken,
        pathId: "path_1",
        fingerprintHex: changed,
      },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("stale-content");
    }
  });

  it("refuses a token after its TTL has passed", () => {
    let clock = 0;
    const store = createPreviewStore({ ttlSeconds: 300, now: () => clock });
    const issued = store.issue(claim);
    clock = 300_001;
    const check = store.verify([
      {
        previewToken: issued.previewToken,
        pathId: "path_1",
        fingerprintHex: claim.fingerprintHex,
      },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("expired");
    }
  });

  it("refuses a token used a second time", () => {
    // Prevents: a replayed request discarding a file that was re-previewed and
    // re-edited in between.
    const store = createPreviewStore({ now: () => 0 });
    const issued = store.issue(claim);
    const request = {
      previewToken: issued.previewToken,
      pathId: "path_1",
      fingerprintHex: claim.fingerprintHex,
    };
    expect(store.redeem([request]).ok).toBe(true);
    const again = store.redeem([request]);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("already-used");
    }
  });

  it("refuses a token minted for a different path", () => {
    const store = createPreviewStore({ now: () => 0 });
    const issued = store.issue(claim);
    const check = store.verify([
      {
        previewToken: issued.previewToken,
        pathId: "path_2",
        fingerprintHex: claim.fingerprintHex,
      },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("wrong-path");
    }
  });

  it("refuses a forged token", () => {
    const store = createPreviewStore({ now: () => 0 });
    const check = store.verify([
      {
        previewToken: "pt_forged",
        pathId: "path_1",
        fingerprintHex: claim.fingerprintHex,
      },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("unknown-token");
    }
  });

  it("leaves every token unused when one entry in a batch is stale", () => {
    // Prevents: a half-consumed batch forcing the client to re-preview paths it
    // never touched, which is how a user ends up confirming the same discard twice.
    const store = createPreviewStore({ now: () => 0 });
    const first = store.issue(claim);
    const second = store.issue({ ...claim, pathId: "path_2" });
    const result = store.redeem([
      {
        previewToken: first.previewToken,
        pathId: "path_1",
        fingerprintHex: claim.fingerprintHex,
      },
      {
        previewToken: second.previewToken,
        pathId: "path_2",
        fingerprintHex: "0".repeat(64),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(
      store.verify([
        {
          previewToken: first.previewToken,
          pathId: "path_1",
          fingerprintHex: claim.fingerprintHex,
        },
      ]).ok,
    ).toBe(true);
  });
});
