/**
 * File discovery helpers for the repository's TypeScript scripts.
 *
 * Scripts are run directly by bun (and by Node 26's native type stripping), so
 * they import each other with explicit `.ts` extensions. Package source uses
 * `.js` specifiers instead, because it is compiled and published as ESM.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/** Absolute paths of every file with one of the given extensions, sorted. */
export async function listFiles(
  dir: string,
  extensions: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        await walk(full);
      } else if (
        extensions.some((extension) => entry.name.endsWith(extension))
      ) {
        found.push(full);
      }
    }
  }
  await walk(dir);
  return found.sort();
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Repository-relative, slash-separated path for stable error output. */
export function displayPath(repoRoot: string, absolute: string): string {
  return relative(repoRoot, absolute).split(sep).join("/");
}

/** True when `candidate` is inside `parent` (and not equal to it). */
export function isInside(parent: string, candidate: string): boolean {
  const parentResolved = resolve(parent);
  const candidateResolved = resolve(candidate);
  return candidateResolved.startsWith(`${parentResolved}${sep}`);
}
