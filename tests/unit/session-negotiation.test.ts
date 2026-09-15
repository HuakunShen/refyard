/**
 * Tests for the rules that decide whether a remembered session may be used.
 *
 * Both failures this prevents are silent: a token from another service instance makes
 * every call fail with 401 while the UI looks fine, and an API major mismatch means a
 * write could be understood differently rather than refused. Neither is visible in a
 * happy-path browser test, so the rules are pinned here.
 */
import { describe, expect, it } from "vitest";
import {
  UI_API_MAJOR,
  blocksWrites,
  negotiateSession,
} from "../../apps/web/src/lib/session-negotiation.ts";

const service = {
  serviceInstanceId: "srvc_a",
  apiMajor: UI_API_MAJOR,
  contractVersion: "1.0.0",
};

describe("session negotiation", () => {
  it("accepts a session from the same instance", () => {
    expect(
      negotiateSession({ instanceId: "srvc_a", hasToken: true }, service).kind,
    ).toEqual("ok");
  });

  it("accepts a session recorded before instance ids were kept", () => {
    // Refusing it would sign out every tab that predates this field, for no gain: the
    // token still has to satisfy the service.
    expect(
      negotiateSession({ instanceId: null, hasToken: true }, service).kind,
    ).toEqual("ok");
  });

  it("asks for a new pairing when the instance changed", () => {
    const verdict = negotiateSession(
      { instanceId: "srvc_other", hasToken: true },
      service,
    );
    expect(verdict.kind).toEqual("differentInstance");
    if (verdict.kind !== "differentInstance") {
      return;
    }
    expect(verdict.message).toMatch(/pair again/i);
    expect(verdict.previousInstanceId).toEqual("srvc_other");
    expect(blocksWrites(verdict)).toBe(true);
  });

  it("says nothing about a changed instance when there is no session to keep", () => {
    expect(
      negotiateSession({ instanceId: "srvc_other", hasToken: false }, service)
        .kind,
    ).toEqual("ok");
  });

  it("refuses a service whose API major differs, and names both majors", () => {
    const verdict = negotiateSession({ instanceId: "srvc_a", hasToken: true }, {
      ...service,
      apiMajor: UI_API_MAJOR + 1,
    });
    expect(verdict.kind).toEqual("incompatible");
    if (verdict.kind !== "incompatible") {
      return;
    }
    expect(verdict.message).toContain(`v${UI_API_MAJOR}`);
    expect(verdict.message).toContain(`v${UI_API_MAJOR + 1}`);
    expect(blocksWrites(verdict)).toBe(true);
  });

  it("refuses an incompatible major even before any session exists", () => {
    // The page must not become writable just because this tab is unpaired: an old UI
    // meeting a new service is the case where semantics drift.
    const verdict = negotiateSession({ instanceId: null, hasToken: false }, {
      ...service,
      apiMajor: UI_API_MAJOR - 1,
    });
    expect(verdict.kind).toEqual("incompatible");
  });
});
