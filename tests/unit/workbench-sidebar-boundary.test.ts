import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = resolve(process.cwd(), "apps/web/src/routes/+page.svelte");
const NAV = resolve(
  process.cwd(),
  "packages/git-ui/src/components/WorkbenchNav.svelte",
);

describe("repository sidebar ownership", () => {
  it("provides a reusable workbench navigation component", async () => {
    await expect(access(NAV)).resolves.toBeUndefined();
  });

  it("keeps the old stacked Git feature cards out of +page.svelte", async () => {
    const source = await readFile(PAGE, "utf8");
    for (const title of [
      'title="Branches"',
      'title="Remotes & sync"',
      'title="Stashes"',
      'title="Tags"',
      'title="Worktrees"',
      'title="Submodules"',
    ]) {
      expect(source, `${title} is still owned by +page.svelte`).not.toContain(title);
    }
  });
});
