/**
 * The Node range the package promises, and whether a runtime is inside it.
 *
 * `engines` in `packages/npm-dist/package.json` is a promise to whoever installs the
 * tarball; the scripts that *measure* the package — `pack:smoke` installs it,
 * `bench:runtime` reports what it does — have to describe a runtime that promise covers.
 * Both used to name a favourite major (`/^v26\./`, `nodeMajor !== 26`) instead, which
 * would keep passing after the range narrowed and would refuse to run at the floor the
 * range allows.
 *
 * Only the `>=A.B <C` shape the manifest uses is understood. Anything else comes back as
 * `null` — "a shape this does not understand" — so a caller reports it rather than
 * treating an unparsed range as a pass.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The `engines.node` string from the manifest that is about to be published. */
export async function publishedEnginesRange(
  stagingRoot: string,
): Promise<string> {
  const raw: unknown = JSON.parse(
    await readFile(join(stagingRoot, "package.json"), "utf8"),
  );
  if (typeof raw !== "object" || raw === null) {
    return "";
  }
  const engines: unknown = Reflect.get(raw, "engines");
  if (typeof engines !== "object" || engines === null) {
    return "";
  }
  const node: unknown = Reflect.get(engines, "node");
  return typeof node === "string" ? node : "";
}

/** True when `v22.23.2` — or `22.23.2`, the form a report stores — is inside `>=22 <27`. */
export function satisfiesEngines(
  range: string,
  version: string,
): boolean | null {
  const parsed = /^>=\s*(\d+)(?:\.(\d+))?\s*<\s*(\d+)(?:\.(\d+))?$/.exec(
    range.trim(),
  );
  const found = /^v?(\d+)\.(\d+)\./.exec(version.trim());
  if (parsed === null || found === null) {
    return null;
  }
  const [, minMajor, minMinor, maxMajor, maxMinor] = parsed;
  const [, major, minor] = found;
  const atLeastMinimum =
    Number(major) > Number(minMajor) ||
    (Number(major) === Number(minMajor) &&
      Number(minor) >= Number(minMinor ?? 0));
  const belowMaximum =
    maxMinor === undefined
      ? Number(major) < Number(maxMajor)
      : Number(major) < Number(maxMajor) ||
        (Number(major) === Number(maxMajor) &&
          Number(minor) < Number(maxMinor));
  return atLeastMinimum && belowMaximum;
}
