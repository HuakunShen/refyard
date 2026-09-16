/**
 * Locate the static workbench bundled beside the executable.
 *
 * Release and development bundles place `cli.mjs` beside a `web/` directory. `open`
 * requires that artifact because its product contract is a local workbench; `serve`
 * deliberately never calls this helper and remains API-only.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";

export async function localWebRoot(
  cliDirectory: string,
): Promise<string | null> {
  const candidate = join(cliDirectory, "web");
  try {
    const root = await stat(candidate);
    if (!root.isDirectory()) {
      return null;
    }
    const fallback = await stat(join(candidate, "200.html"));
    return fallback.isFile() ? candidate : null;
  } catch {
    return null;
  }
}
