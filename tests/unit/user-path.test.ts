/** The local host accepts the shell-style home shorthand used by repository launchers. */
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandUserPath } from "@refyard/host-node";

describe("expandUserPath", () => {
  it("expands ~/ paths against the host home directory", () => {
    expect(expandUserPath("~/Dev/kunkun")).toBe(join(homedir(), "Dev/kunkun"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandUserPath("/Volumes/Portable2TB/ExtDev/refyard")).toBe(
      "/Volumes/Portable2TB/ExtDev/refyard",
    );
  });
});
