/**
 * Every tracked path must be usable on Windows.
 *
 * `packages/git-core/src/bytes/nul.ts` was not. `NUL` (and `CON`, `PRN`, `AUX`,
 * `COM1`…`LPT9`) are device names in Windows, with or without an extension, so Git
 * refused to write the file at all:
 *
 *     error: invalid path 'packages/git-core/src/bytes/nul.ts'
 *     fatal: unable to checkout working tree
 *
 * A clone that cannot check out is not a clone, and nothing in this repository ran
 * on Windows to notice — the failure showed up when the suite was first run on a
 * Windows machine, which is also the only place it can be noticed. The characters
 * Windows forbids in a name (`< > : " | ? *`, control characters) and the trailing
 * dot or space it silently strips are checked for the same reason: each one turns
 * a path that exists in the index into one that does not exist on disk.
 *
 * Case-insensitive collisions are the same class of failure one step later: two
 * paths that differ only by case cannot both exist on the default Windows and
 * macOS filesystems, so the second checkout overwrites the first and one file
 * quietly becomes the other's content.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

/** Names Windows reserves, with or without an extension: `NUL`, `nul.txt`, `COM3`. */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/** Characters Windows does not allow in a path segment. */
const ILLEGAL = /[<>:"|?*\u0000-\u001f]/;

async function trackedPaths(): Promise<readonly string[]> {
  const { stdout } = await run("git", ["ls-files", "-z"], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split("\u0000").filter((path) => path.length > 0);
}

describe("tracked paths", () => {
  it("contains no name that Windows refuses to check out", async () => {
    const paths = await trackedPaths();
    expect(paths.length).toBeGreaterThan(100);
    const unusable: string[] = [];
    for (const path of paths) {
      for (const segment of path.split("/")) {
        if (RESERVED.test(segment)) {
          unusable.push(`${path} (reserved device name "${segment}")`);
        } else if (ILLEGAL.test(segment)) {
          unusable.push(`${path} (character Windows forbids in "${segment}")`);
        } else if (segment.endsWith(".") || segment.endsWith(" ")) {
          unusable.push(`${path} (trailing dot or space in "${segment}")`);
        }
      }
    }
    expect(unusable).toEqual([]);
  });

  it("contains no two paths that differ only by case", async () => {
    const paths = await trackedPaths();
    const byLowerCase = new Map<string, string>();
    const collisions: string[] = [];
    for (const path of paths) {
      const key = path.toLowerCase();
      const seen = byLowerCase.get(key);
      if (seen !== undefined) {
        collisions.push(`${seen} and ${path}`);
      }
      byLowerCase.set(key, path);
    }
    expect(collisions).toEqual([]);
  });
});
