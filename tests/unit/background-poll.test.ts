/**
 * The cadence the workbench re-reads at.
 *
 * These cases exist because the numbers are a product decision (DESIGN.md §10), not a
 * tuning detail: getting them wrong is either a repository polled hard enough to slow the
 * machine down, or a change made in the user's terminal that never appears. The arithmetic
 * is pure, so it is tested here rather than through a browser.
 */
import { describe, expect, it } from "vitest";
import {
  HIDDEN_INTERVAL_MS,
  SLOW_INTERVAL_MS,
  VISIBLE_INTERVAL_MS,
  backgroundRead,
  createReadTimer,
  pollIntervalMs,
  timedRead,
} from "../../apps/web/src/lib/background-poll.js";

describe("polling cadence", () => {
  it("polls a visible page every two seconds", () => {
    expect(pollIntervalMs({ visible: true, lastReadMs: 12 })).toBe(
      VISIBLE_INTERVAL_MS,
    );
  });

  it("slows to fifteen seconds when the page is hidden", () => {
    // A background tab still learns about an external change; it just stops competing with
    // whatever the user is actually looking at.
    expect(pollIntervalMs({ visible: false, lastReadMs: 12 })).toBe(
      HIDDEN_INTERVAL_MS,
    );
  });

  it("treats a repository with no finished read as fast, not slow", () => {
    // Before the first read there is nothing to judge, and backing off would delay the
    // first refresh of a repository we know nothing about.
    expect(pollIntervalMs({ visible: true, lastReadMs: null })).toBe(
      VISIBLE_INTERVAL_MS,
    );
  });

  it("backs off to thirty seconds when the read itself takes as long as the interval", () => {
    // Prevents: a 2-second poll against a repository that answers in 3, which is a growing
    // queue rather than a refresh — each tick starts while the previous read is still open.
    expect(
      pollIntervalMs({ visible: true, lastReadMs: VISIBLE_INTERVAL_MS }),
    ).toBe(SLOW_INTERVAL_MS);
    expect(pollIntervalMs({ visible: true, lastReadMs: 4_500 })).toBe(
      SLOW_INTERVAL_MS,
    );
  });

  it("does not speed up a slow repository because the page is hidden", () => {
    // Hidden is 15 s and slow is 30 s; the slower number always wins, or a hidden tab would
    // poll a slow repository twice as often as a visible one does.
    expect(pollIntervalMs({ visible: false, lastReadMs: 4_500 })).toBe(
      SLOW_INTERVAL_MS,
    );
  });

  it("records the duration of a successful read, and nothing on a failure", async () => {
    const timer = createReadTimer();
    let clock = 1_000;
    const key = ["status", "repo_1"];
    const read = timedRead({
      key,
      timer,
      now: () => clock,
      run: async () => {
        clock += 2_400;
        return "ok";
      },
    });
    expect(await read()).toBe("ok");
    expect(timer.last(key)).toBe(2_400);
    // A repository whose status read takes 2.4 s is slow: the next interval is 30 s.
    expect(pollIntervalMs({ visible: true, lastReadMs: timer.last(key) })).toBe(
      SLOW_INTERVAL_MS,
    );

    const failing = timedRead({
      key,
      timer,
      now: () => clock,
      run: async () => {
        throw new Error("the service is gone");
      },
    });
    await expect(failing()).rejects.toThrow("the service is gone");
    // The old duration stands: an error is not evidence about speed, and pretending the
    // repository got fast again would hammer it while it is broken.
    expect(timer.last(key)).toBe(2_400);
  });

  it("builds the options a background read needs, with the cadence from the timer", async () => {
    const timer = createReadTimer();
    const key = ["refs", "repo_1"];
    const options = backgroundRead({ key, timer, visible: () => true });
    expect(options.refetchIntervalInBackground).toBe(true);
    expect(options.refetchInterval()).toBe(VISIBLE_INTERVAL_MS);
    timer.record(key, 5_000);
    expect(options.refetchInterval()).toBe(SLOW_INTERVAL_MS);
    const hidden = backgroundRead({ key, timer, visible: () => false });
    expect(hidden.refetchInterval()).toBe(SLOW_INTERVAL_MS);
  });

  it("keeps one duration per query key, and answers null for an unknown one", () => {
    const timer = createReadTimer();
    const status = ["status", "http://127.0.0.1:9595", "tok", "repo_1"];
    const refs = ["refs", "http://127.0.0.1:9595", "tok", "repo_1"];
    expect(timer.last(status)).toBeNull();
    timer.record(status, 30);
    timer.record(refs, 900);
    expect(timer.last(status)).toBe(30);
    expect(timer.last(refs)).toBe(900);
    // The newest measurement of a key replaces the old one: the cadence follows the
    // repository as it is now, not the worst it has ever been.
    timer.record(status, 3_100);
    expect(timer.last(status)).toBe(3_100);
    expect(timer.size()).toBe(2);
  });
});
