/**
 * The updater state machine's rules, driven with fake probes: an in-flight check or
 * install cannot be re-entered, "up to date" and an offer and an error are the only
 * honest endings, and relaunching stays in the user's hands.
 */
import { describe, expect, it, vi } from "vitest";
import { stepUpdates } from "@refyard/git-ui/lib/updates";
import type { UpdatesProbe } from "@refyard/git-ui/lib/updates";

function probeWith(result: () => Promise<unknown>): UpdatesProbe {
  return { check: result as UpdatesProbe["check"] };
}

describe("the updates state machine", () => {
  it("moves idle to up-to-date when the feed offers nothing", async () => {
    const probe = probeWith(() => Promise.resolve(null));
    expect(await stepUpdates({ state: "idle" }, probe)).toEqual({
      state: "up-to-date",
    });
  });

  it("carries an offer with its install and relaunch actions", async () => {
    const offer = {
      version: "0.2.0",
      install: vi.fn(),
      relaunch: vi.fn(),
    };
    const probe = probeWith(() => Promise.resolve(offer));
    const next = await stepUpdates({ state: "idle" }, probe);
    expect(next).toEqual({
      state: "available",
      offer,
      version: "0.2.0",
    });
  });

  it("installs an offer when it is accepted, and reports ready", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const offer = { version: "0.2.0", install, relaunch: vi.fn() };
    const next = await stepUpdates(
      { state: "available", offer, version: "0.2.0" },
      probeWith(() => Promise.resolve(null)),
    );
    expect(install).toHaveBeenCalledOnce();
    expect(next).toEqual({ state: "ready", offer });
  });

  it("an in-flight check cannot be re-entered", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const probe: UpdatesProbe = {
      async check() {
        calls += 1;
        await gate;
        return null;
      },
    };
    const running = stepUpdates({ state: "idle" }, probe);
    const during = await stepUpdates({ state: "checking" }, probe);
    expect(during).toEqual({ state: "checking" });
    release?.();
    await running;
    expect(calls).toBe(1);
  });

  it("surfaces the feed's own failure as an error phase, not a crash", async () => {
    const probe = probeWith(() =>
      Promise.reject(new Error("no update feed reachable")),
    );
    const next = await stepUpdates({ state: "idle" }, probe);
    expect(next).toEqual({ state: "error", message: "no update feed reachable" });
  });
});
