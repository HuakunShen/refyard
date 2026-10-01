/** Checks which replay operations the history metadata can rule out before confirmation. */
import { describe, expect, it } from "vitest";
import { commitReplayRestrictions } from "@refyard/git-ui/lib/commit-replay-restrictions";

const parentOid = "1".repeat(40);
const secondParentOid = "2".repeat(40);

describe("commit replay restrictions", () => {
  it("refuses dropping a root while allowing its patch to be replayed", () => {
    // Prevents asking for confirmation for a drop with no base to replay onto.
    expect(
      commitReplayRestrictions({
        parents: [],
        boundary: false,
        missingParents: [],
      }),
    ).toEqual({ merge: false, drop: "root" });
  });

  it("allows ordinary single-parent commits", () => {
    expect(
      commitReplayRestrictions({
        parents: [parentOid],
        boundary: false,
        missingParents: [],
      }),
    ).toEqual({ merge: false, drop: null });
  });

  it("refuses merge replay without choosing a mainline parent", () => {
    // Prevents offering a merge action whose required mainline decision is unsupported.
    expect(
      commitReplayRestrictions({
        parents: [parentOid, secondParentOid],
        boundary: false,
        missingParents: [],
      }),
    ).toEqual({ merge: true, drop: "merge" });
  });

  it("does not mislabel a shallow boundary as the first commit", () => {
    // Prevents interpreting incomplete history as proof that a commit is a root.
    expect(
      commitReplayRestrictions({
        parents: [],
        boundary: true,
        missingParents: [],
      }),
    ).toEqual({ merge: false, drop: "missing-parent" });
  });

  it("refuses dropping onto a parent whose object is missing", () => {
    // Prevents offering a replay base that the repository cannot resolve locally.
    expect(
      commitReplayRestrictions({
        parents: [parentOid],
        boundary: true,
        missingParents: [parentOid],
      }),
    ).toEqual({ merge: false, drop: "missing-parent" });
  });

  it("allows a boundary whose parent is known and available", () => {
    expect(
      commitReplayRestrictions({
        parents: [parentOid],
        boundary: true,
        missingParents: [],
      }),
    ).toEqual({ merge: false, drop: null });
  });
});
