/** Keep TanStack read composition out of the route-level workbench component. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = resolve(process.cwd(), "apps/web/src/routes/+page.svelte");

describe("workbench read ownership", () => {
  it("keeps query constructors and polling composition outside +page.svelte", async () => {
    const source = await readFile(PAGE, "utf8");
    for (const owner of [
      "createQuery(",
      "createInfiniteQuery(",
      "createReadTimer(",
      "timedRead(",
      "backgroundRead(",
    ]) {
      expect(source, `${owner} still belongs to +page.svelte`).not.toContain(owner);
    }
  });
});
