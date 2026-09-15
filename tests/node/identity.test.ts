/**
 * Pinned directory identity.
 *
 * The registry tests next door prove that an approval stops working after the
 * directory is replaced. This one drives the mechanism directly, because the defect
 * it exists for was invisible where it was written: on macOS a recreated directory
 * gets a fresh inode number, on ext4 it got the *same* one, so `rm -r` followed by
 * `mkdir` was indistinguishable from "nothing happened" and the check passed.
 *
 * The three cases below are the whole contract:
 *
 * - replacing the directory is detectable;
 * - removing it is distinguishable from replacing it;
 * - ordinary use — files created and deleted inside — is *not* a replacement, which
 *   is the half that a naive fix (comparing a timestamp) would break.
 */
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectoryPins, type DirectoryPins } from "@refyard/host-node";

describe("directory identity", () => {
  let scratch: string;
  let directory: string;
  let pins: DirectoryPins;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "refyard-identity-"));
    directory = join(scratch, "root");
    await mkdir(directory);
    pins = createDirectoryPins();
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  async function pinDirectory(): Promise<
    Awaited<ReturnType<DirectoryPins["pin"]>>
  > {
    return pins.pin(directory, await stat(directory));
  }

  it("reports a directory that was deleted and created again as replaced", async () => {
    // Prevents: an approval inheriting a directory nobody approved. On ext4 the
    // replacement gets the same device and inode number unless something holds the
    // old one, which is exactly what a pin does.
    const pin = await pinDirectory();
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory);
    expect(await pin.check()).toBe("replaced");
    pin.release();
  });

  it("reports a deleted directory as missing, not replaced", async () => {
    // Prevents: telling a user their directory "was replaced" when it is simply
    // gone, which sends them looking for a swap that never happened.
    const pin = await pinDirectory();
    await rm(directory, { recursive: true, force: true });
    expect(await pin.check()).toBe("missing");
    pin.release();
  });

  it("reports a directory that was moved away as missing", async () => {
    // Prevents: following a repository the user moved, under a grant that was given
    // for the path it used to be at. A rename keeps the inode and its link count
    // alive, so this is the case where only the path can answer.
    const pin = await pinDirectory();
    await rename(directory, join(scratch, "moved"));
    expect(await pin.check()).toBe("missing");
    pin.release();
  });

  it("stays intact while files are created and deleted inside it", async () => {
    // Prevents: the false positive that makes a check unusable — a root that goes
    // "replaced" because its contents changed, which is what the whole service is
    // for. Timestamps and entry counts move on every write; identity must not.
    const pin = await pinDirectory();
    await writeFile(join(directory, "file.txt"), "content\n");
    expect(await pin.check()).toBe("intact");
    await rm(join(directory, "file.txt"));
    expect(await pin.check()).toBe("intact");
    await mkdir(join(directory, "nested"));
    expect(await pin.check()).toBe("intact");
    pin.release();
  });

  it("reports a file that took the directory's place as replaced", async () => {
    // Prevents: a path that is no longer a directory at all being treated as the
    // approved root, so containment checks run against something that has no
    // children.
    const pin = await pinDirectory();
    await rm(directory, { recursive: true, force: true });
    await writeFile(directory, "not a directory\n");
    expect(await pin.check()).toBe("replaced");
    pin.release();
  });

  it("holds no descriptor once the budget is spent, and still compares", async () => {
    // Prevents: the budget quietly disabling the check. With nothing held, identity
    // is the numbers alone — weaker than a pin (on a filesystem that reuses inode
    // numbers it cannot see a replacement at all), but still a comparison, and a
    // deleted directory is still missing.
    const withoutDescriptors = createDirectoryPins({ budget: 0 });
    const pin = await withoutDescriptors.pin(directory, await stat(directory));
    expect(withoutDescriptors.held()).toBe(0);
    await rm(directory, { recursive: true, force: true });
    expect(await pin.check()).toBe("missing");
    pin.release();
  });

  it("counts one descriptor per pin, and gives it back on release", async (context) => {
    // Windows never holds a descriptor — a directory there cannot be deleted while
    // one is open, so pinning would turn "delete this repository" into a failure.
    // The count is a POSIX property, and the numbers-only comparison Windows keeps
    // is covered by the replacement cases above.
    context.skip(process.platform === "win32");
    // Prevents: a service that unregisters repositories in a loop exhausting its own
    // descriptor budget (a double release counting a slot twice, or a pin that is
    // never released), whose failure would show up as a Git process that cannot be
    // spawned.
    const budgeted = createDirectoryPins({ budget: 2 });
    const first = await budgeted.pin(directory, await stat(directory));
    expect(budgeted.held()).toBe(1);
    const second = await budgeted.pin(directory, await stat(directory));
    expect(budgeted.held()).toBe(2);
    const third = await budgeted.pin(directory, await stat(directory));
    expect(budgeted.held()).toBe(2);
    expect(third.ino).toBe(first.ino);
    first.release();
    first.release();
    expect(budgeted.held()).toBe(1);
    second.release();
    third.release();
    expect(budgeted.held()).toBe(0);
    const fourth = await budgeted.pin(directory, await stat(directory));
    expect(budgeted.held()).toBe(1);
    expect(await fourth.check()).toBe("intact");
    fourth.release();
    expect(budgeted.held()).toBe(0);
  });
});
