import { describe, expect, it } from "vitest";
import { pinnedRepository } from "../../apps/web/src/lib/workbench/pinned-repository.js";

const repositories = [
  { repositoryId: "a", displayPath: "/projects/a" },
  { repositoryId: "b", displayPath: "/private/tmp/projects/b" },
];

describe("host-pinned repository", () => {
  it("selects only the exact host identity", () => {
    expect(pinnedRepository(repositories, "b", "/projects/a")).toBe(repositories[1]);
    expect(pinnedRepository(repositories, "missing", "/projects/a")).toBeUndefined();
  });

  it("accepts the macOS private path alias only when no id was supplied", () => {
    expect(pinnedRepository(repositories, null, "/tmp/projects/b")).toBe(repositories[1]);
    expect(pinnedRepository(repositories, null, "/missing")).toBeUndefined();
  });

  it("never falls back to another session's first repository", () => {
    expect(pinnedRepository(repositories, null, null)).toBeUndefined();
    expect(pinnedRepository(repositories, "unknown", null)).toBeUndefined();
  });
});
