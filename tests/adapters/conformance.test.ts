/**
 * The shared adapter suite, run against HTTP.
 *
 * The same scenarios run against the Tauri adapter once it exists — that is the
 * point of keeping them in `tests/support/adapter-conformance.ts` instead of here.
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  createAdapterHarness,
  type AdapterHarness,
} from "../support/adapter-harness.js";
import { describeAdapterConformance } from "../support/adapter-conformance.js";

const state: { harness: AdapterHarness | null; headOid: string } = {
  harness: null,
  headOid: "",
};

function activeHarness(): AdapterHarness {
  if (state.harness === null)
    throw new Error("the adapter harness was not started");
  return state.harness;
}

// Registered at file scope so the shared conformance cases below get a fresh
// service and fixture exactly like the transport-specific cases do.
beforeEach(async () => {
  state.harness = await createAdapterHarness();
  await state.harness.repo.write(
    "a.txt",
    "base\nmodified in the working tree\n",
  );
  state.headOid = await state.harness.repo.headOid();
});

afterEach(async () => {
  await state.harness?.dispose();
  state.harness = null;
});

describeAdapterConformance({
  name: "http",
  connect: () => activeHarness().connectHttp(),
  get repositoryId() {
    return activeHarness().repositoryId;
  },
  get fixture() {
    return {
      headOid: state.headOid,
      branchName: "main",
      modifiedPathName: "a.txt",
    };
  },
  activeSubscriptions: () => activeHarness().activeSubscriptions(),
  get secret() {
    return activeHarness().secretToken;
  },
  dispose: () => activeHarness().dispose(),
});

describe("the conformance fixture itself", () => {
  it("starts with a committed file that differs in the working tree", async () => {
    // Guards the suite above: if the fixture stopped producing a modified file, the
    // conformance cases could pass for the wrong reason.
    const text = new TextDecoder().decode(
      await activeHarness().repo.git(["status", "--porcelain"]),
    );
    if (!text.includes("a.txt")) {
      throw new Error(`the fixture no longer has a modified a.txt: ${text}`);
    }
  });
});
