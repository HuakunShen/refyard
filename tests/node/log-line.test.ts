/**
 * The one-line-per-request log format.
 *
 * The reason a refusal happened belongs in the log next to the status: the asset route
 * refuses with `Forbidden` for two different reasons, and only the message says which.
 * But a message can carry text from the machine (a path, a branch name), so it is
 * escaped before it is printed — a file name containing a newline must not be able to
 * break the format, and a terminal escape must not reach the terminal. Both halves of
 * that are checked here, because a log line that lies about how many requests happened
 * is worse than no log line.
 */
import { describe, expect, it } from "vitest";
import { logLine } from "@refyard/host-node";

describe("logLine", () => {
  it("keeps a refusal's reason on the same line as its status", () => {
    const line = logLine({
      method: "GET",
      path: "/favicon.svg",
      status: 403,
      durationMs: 0.4,
      problemCode: "Forbidden",
      problemMessage: "that asset resolves outside the web assets",
    });
    expect(line).toContain("GET /favicon.svg 403");
    expect(line).toContain("problem=Forbidden");
    expect(line).toContain(
      'reason="that asset resolves outside the web assets"',
    );
  });

  it("escapes a newline in a message instead of starting a new log line", () => {
    // Prevents: a path or a branch name containing a newline forging a second request
    // line, which would make the log unreadable as evidence of what happened.
    const line = logLine({
      method: "GET",
      path: "/assets/app.js",
      status: 403,
      durationMs: 1,
      problemCode: "Forbidden",
      problemMessage: "refused: evil\nGET /api/v1/status 200 1ms",
    });
    expect(line.split("\n")).toHaveLength(1);
    expect(line).not.toContain("evil\n");
    expect(line).toContain("\\n");
  });

  it("escapes a terminal escape sequence rather than printing it", () => {
    // Prevents: repository content reaching the user's terminal as control sequences,
    // which is the same rule the API follows when it returns a path as JSON.
    const line = logLine({
      method: "GET",
      path: "/assets/app.js",
      status: 403,
      durationMs: 1,
      problemCode: "Forbidden",
      problemMessage: "escape \u001b[31mred\u001b[0m here",
    });
    expect(line).not.toContain("\u001b");
    expect(line).toContain("\\u001b");
  });

  it("bounds a long message instead of printing it whole", () => {
    const line = logLine({
      method: "GET",
      path: "/",
      status: 400,
      durationMs: 1,
      problemCode: "InvalidRequest",
      problemMessage: "x".repeat(5_000),
    });
    expect(line.length).toBeLessThan(500);
  });

  it("omits the reason when there is no message", () => {
    const line = logLine({
      method: "GET",
      path: "/",
      status: 200,
      durationMs: 1,
    });
    expect(line).not.toContain("reason=");
  });
});
