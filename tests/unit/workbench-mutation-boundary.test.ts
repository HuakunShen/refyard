/** Keep write orchestration out of the route-level workbench component. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = resolve(process.cwd(), "apps/web/src/routes/+page.svelte");

describe("workbench mutation ownership", () => {
  it("keeps mutation client, follow, target runner, and preview orchestration outside +page.svelte", async () => {
    const source = await readFile(PAGE, "utf8");
    for (const owner of [
      "createMutationClient(",
      "followOperation(",
      "function performWrite(",
      "function previewTokensFor(",
      "mutations.submit(",
    ]) {
      expect(source, `${owner} still belongs to +page.svelte`).not.toContain(owner);
    }
  });
});
