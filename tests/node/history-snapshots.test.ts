/** History snapshots own copied intent and observed repository tips. */
import { expect, it } from "vitest";
import { createSnapshotStore } from "@refyard/host-node";
import type { NormalizedHistoryIntent } from "@refyard/host-node/coordinator/snapshot-types";

it("copies normalized intent and preserves the complete-ref fingerprint", () => {
  // Prevents caller-owned state changing the walk after the first page.
  const intent: NormalizedHistoryIntent = {
    firstParentOnly: false,
    message: "find",
    author: null,
    resolvedRefOid: null,
    committedAfterSeconds: null,
    committedBeforeSeconds: null,
    resolvedPathText: "odd[1].txt",
    oid: null,
    oidLookup: false,
    topology: "sparse",
  };
  const tips = ["a"];
  const observedRefsFingerprint = "all-observed-ref-fingerprint";
  const store = createSnapshotStore({ nextSnapshotId: () => "snap_test" });
  const snapshot = store.create({
    kind: "history",
    repositoryId: "repo_test",
    worktreeId: "wt_test",
    tips,
    observedRefsFingerprint,
    historyIntent: intent,
  });
  tips[0] = "changed";
  Object.assign(intent, { resolvedPathText: "another.txt" });
  expect(snapshot.tips).toEqual(["a"]);
  expect(snapshot.observedRefsFingerprint).toBe(observedRefsFingerprint);
  expect(snapshot.historyIntent?.resolvedPathText).toBe("odd[1].txt");
});
