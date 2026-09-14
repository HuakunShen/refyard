import { readFile } from "node:fs/promises";

/**
 * The CLI's own version string.
 *
 * It is separate from the contract version on purpose: the CLI can be older or
 * newer than the service it talks to, and `GET /health` plus `GET /api/v1/capabilities`
 * are what a caller compares against, not this number.
 */
export const CLI_VERSION = "0.0.0-dev";

/**
 * The version this *installation* reports.
 *
 * A packaged build writes `dist/build-info.json` beside the bundle, and that file is
 * the truth for the tarball a user installed — the source constant would say
 * `0.0.0-dev` forever. Reading it is best-effort: a checkout run without a build (or a
 * bundle copied somewhere odd) falls back to the constant rather than failing.
 */
export async function reportedVersion(): Promise<string> {
  try {
    const info = await readFile(
      new URL("./build-info.json", import.meta.url),
      "utf8",
    );
    const parsed: unknown = JSON.parse(info);
    if (typeof parsed === "object" && parsed !== null) {
      const version = Reflect.get(parsed, "version");
      if (typeof version === "string" && version.length > 0) {
        return version;
      }
    }
  } catch {
    // No build-info: this is a source run.
  }
  return CLI_VERSION;
}
