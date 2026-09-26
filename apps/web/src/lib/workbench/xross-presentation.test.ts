/** Projections preserve facade-only fields and checked wire timestamps. */
import { describe, expect, it } from "vitest";
import { remoteEndpointLabel, checkedUnixMillis } from "./xross-presentation.js";

describe("Xross presentation", () => {
  it("marks remote endpoints as host-only summaries", () => {
    expect(remoteEndpointLabel({ kind: "network", transport: "ssh", hostDisplay: "git.example" })).toContain("git.example");
    expect(remoteEndpointLabel({ kind: "redacted" })).toContain("redacted");
  });

  it("rejects timestamps beyond Date bounds", () => {
    expect(checkedUnixMillis("8640000000000000")).toBe(8640000000000000);
    expect(checkedUnixMillis("8640000000000001")).toBeNull();
    expect(checkedUnixMillis("18446744073709551615")).toBeNull();
  });
});
