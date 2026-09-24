/** The development coordinator can boot before the user chooses a repository. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { assembleService } from "@refyard/host-node";

it("assembles a zero-repository development service with management enabled", async () => {
  // Prevents the launcher from requiring a fake repository or scanning the current directory.
  const stateRoot = await mkdtemp(join(tmpdir(), "refyard-dev-state-"));
  try {
    const service = await assembleService({
      repositoryPaths: [],
      allowEmpty: true,
      gitPath: "git",
      stateRootPath: stateRoot,
      skipDoctor: true,
      write: () => undefined,
    });

    expect(service.repositoryIds).toEqual([]);
    expect(service.allowedRootIds).toEqual([]);
    expect(service.repositoryManagement).toBeDefined();
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
