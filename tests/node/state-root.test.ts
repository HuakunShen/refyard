/**
 * Where the private state directory lives.
 *
 * The journal and the recovery backups share this directory, and a backup only means
 * something if it is still there when it is needed — so the default must be a durable
 * per-user location, not a temporary one the system may clear. The tests pin the
 * choice per platform by driving the environment rather than the real machine.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultStateRoot } from "@refyard/host-node";

/**
 * Paths are built with the host's `join`, because that is what the implementation
 * does: faking `process.platform` selects the *branch*, while separators come from the
 * platform the code actually runs on. Asserting a backslash path from macOS would test
 * the test, not the code.
 */

function withEnvironment(
  values: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  action: () => void,
): void {
  const keys = [
    "REFYARD_STATE_DIR",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "XDG_STATE_HOME",
    "TMPDIR",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  const savedPlatform = process.platform;
  try {
    for (const key of keys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
    action();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    Object.defineProperty(process, "platform", {
      value: savedPlatform,
      configurable: true,
    });
  }
}

describe("the default state directory", () => {
  it("honours an explicit REFYARD_STATE_DIR above every platform default", () => {
    withEnvironment(
      { REFYARD_STATE_DIR: "/var/tmp/refyard-explicit", HOME: "/home/someone" },
      "linux",
      () => {
        expect(defaultStateRoot()).toEqual("/var/tmp/refyard-explicit");
      },
    );
  });

  it("uses Application Support on macOS, not the purgeable temp directory", () => {
    withEnvironment({ HOME: "/Users/someone" }, "darwin", () => {
      expect(defaultStateRoot()).toEqual(
        join("/Users/someone", "Library", "Application Support", "refyard"),
      );
    });
  });

  it("uses XDG_STATE_HOME on Linux when it is set, and ~/.local/state otherwise", () => {
    withEnvironment(
      { HOME: "/home/someone", XDG_STATE_HOME: "/home/someone/.state" },
      "linux",
      () => {
        expect(defaultStateRoot()).toEqual(
          join("/home/someone/.state", "refyard"),
        );
      },
    );
    withEnvironment({ HOME: "/home/someone" }, "linux", () => {
      expect(defaultStateRoot()).toEqual(
        join("/home/someone", ".local", "state", "refyard"),
      );
    });
  });

  it("uses LOCALAPPDATA on Windows", () => {
    withEnvironment(
      {
        USERPROFILE: "C:\\Users\\someone",
        LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local",
      },
      "win32",
      () => {
        expect(defaultStateRoot()).toEqual(
          join("C:\\Users\\someone\\AppData\\Local", "refyard"),
        );
      },
    );
  });

  it("falls back to the temp directory only when there is no home to speak of", () => {
    withEnvironment({ TMPDIR: "/var/tmp/x" }, "linux", () => {
      // A container with no HOME still gets a working service; the fallback is
      // named in the code so it is a decision, not an accident.
      expect(defaultStateRoot()).toEqual(join("/var/tmp/x", "refyard-state"));
    });
  });
});
