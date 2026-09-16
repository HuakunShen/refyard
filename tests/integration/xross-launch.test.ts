/**
 * Xross launch adapter coverage.
 *
 * The adapter is deliberately tested against a small transport port rather than
 * copying Xross's Rust or protobuf implementation. That proves the policy and
 * lifecycle we own while keeping the external daemon's revision and permissions
 * visible as a separate integration fact.
 */
import { describe, expect, it } from "vitest";
import {
  launchRemoteRefyard,
  selectLaunchOutcome,
  type XrossExecEvent,
  type XrossLaunchTransport,
} from "../../integrations/xross/launch.js";

describe("Xross launch policy", () => {
  it("reports a ready launch without ever opting into automatic installation", () => {
    const outcome = selectLaunchOutcome({
      exec: "ready",
      node: "available",
      git: "available",
      forward: "allowed",
    });
    expect(outcome).toMatchObject({
      kind: "ready",
      installAutomatically: false,
    });
  });

  it("turns an absent program or refused exec into dependencyMissing", () => {
    // Prevents: silently installing or retrying a peer program when Xross has no
    // app registry from which a version or dependency declaration could be read.
    expect(
      selectLaunchOutcome({
        exec: "refused",
        node: "unknown",
        git: "unknown",
        forward: "unknown",
      }),
    ).toMatchObject({
      kind: "dependencyMissing",
      installAutomatically: false,
    });
  });

  it("keeps a forward refusal as permissionDenied", () => {
    // Prevents: describing the peer's egress policy as a missing dependency, which
    // would encourage an operator to install something that cannot fix a denial.
    expect(
      selectLaunchOutcome({
        exec: "ready",
        node: "available",
        git: "available",
        forward: "refused",
      }),
    ).toMatchObject({
      kind: "permissionDenied",
      installAutomatically: false,
    });
  });
});

describe("Xross launch lifecycle", () => {
  it("holds the remote exec, forwards its loopback port, and closes both", async () => {
    const calls: string[] = [];
    const events: readonly XrossExecEvent[] = [
      {
        stream: "stdout",
        text: '{"port":39421,"apiOnly":true}\n',
      },
      {
        stream: "stderr",
        text: "pairing URL (single use): https://ui.example.test/?pair=ticket-123\n",
      },
    ];
    const transport: XrossLaunchTransport = {
      async exec(input) {
        calls.push(`exec:${input.command.join(" ")}`);
        return {
          events: stream(events),
          async close() {
            calls.push("exec-close");
          },
        };
      },
      async openForward(input) {
        calls.push(
          `forward:${input.targetHost}:${input.targetPort}:${input.localPort}`,
        );
        return { forwardId: "forward-1", localPort: 45678 };
      },
      async closeForward(forwardId) {
        calls.push(`forward-close:${forwardId}`);
      },
    };

    const launched = await launchRemoteRefyard({
      transport,
      deviceId: "xdev_peer",
      repositoryPath: "/srv/refyard-repo",
      uiOrigin: "https://ui.example.test",
      localPort: 0,
    });

    expect(launched.pairingUrl).toContain("https://ui.example.test/");
    expect(new URL(launched.pairingUrl).searchParams.get("api")).toBe(
      "http://127.0.0.1:45678",
    );
    expect(calls[0]).toContain(
      "exec:refyard serve --json --no-open --repo /srv/refyard-repo --ui-origin https://ui.example.test",
    );
    expect(calls[1]).toBe("forward:127.0.0.1:39421:0");

    await launched.close();
    expect(calls.slice(-2)).toEqual(["forward-close:forward-1", "exec-close"]);
  });
});

async function* stream(
  events: readonly XrossExecEvent[],
): AsyncGenerator<XrossExecEvent> {
  for (const event of events) {
    yield event;
  }
}
