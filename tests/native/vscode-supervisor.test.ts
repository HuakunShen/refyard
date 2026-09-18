/**
 * The extension's supervisor module, exercised against the real release binary: spawn,
 * machine pairing, and a first authenticated read — the exact path `activate` runs when
 * a person opens the workbench. The CLI-side rules are pinned in
 * `cli-machine-client.test.ts`; this file pins the wrapper the extension calls.
 */
import { afterAll, describe, expect, it } from "vitest";
import { realpath } from "node:fs/promises";
import {
  startMachineService,
  stopService,
  type RunningService,
} from "../../apps/refyard-vscode/src/supervisor.js";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

const services: { service: RunningService; repo: GitFixtureRepo }[] = [];

afterAll(async () => {
  for (const running of services) {
    stopService(running.service);
    await running.repo.dispose();
  }
});

describe("the extension's supervisor wrapper", () => {
  it("starts the CLI, pairs, and reads the opened repository", async () => {
    const repo = await createRepo({
      initialCommit: true,
      config: {
        "user.name": "Refyard Fixture",
        "user.email": "fixture@refyard.invalid",
      },
    });
    const service = await startMachineService({
      cliPath: joinBinary(),
      repositoryPath: repo.root,
      stateDir: `${repo.root}-state`,
      environment: repo.env,
    });
    services.push({ service, repo });

    // Prevents: the extension shipping while the CLI name or readiness shape drifted.
    const listing = await service.client.repositories();
    const realRoot = await realpath(repo.root);
    expect(
      listing.repositories.some((record) => record.displayPath === realRoot),
    ).toBe(true);

    const status = await service.client.status({
      repositoryId: listing.repositories[0]!.repositoryId,
    });
    expect(status.head.branchName).toBe("main");
  });
});

function joinBinary(): string {
  return process.env["REFYARD_NATIVE_BIN"] ?? "";
}
