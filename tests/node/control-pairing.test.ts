/**
 * The pairing control channel: a same-user socket that mints single-use pairing
 * URLs on request — the programmatic twin of the `p` keystroke.
 *
 * The failure this suite prevents: minting quietly moving onto HTTP (widening
 * the auth surface the ticket exists to protect), and `refyard pair` guessing
 * between several running services instead of naming them.
 */
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listServiceInstances,
  requestPairingUrl,
  startPairingControl,
} from "@refyard/host-node";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      await cleanup();
    }
  }
});

async function tempStateRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "refyard-control-"));
}

describe("pairing control socket", () => {
  it("mints a pairing URL over the socket and records the instance", async () => {
    const stateRoot = await tempStateRoot();
    let minted = 0;
    const server = await startPairingControl({
      stateRoot,
      instanceId: "srvc_test_one",
      url: "http://127.0.0.1:1234",
      port: 1234,
      mintPairingUrl: () => {
        minted += 1;
        return `http://127.0.0.1:1234/?pair=ticket_${minted}`;
      },
    });
    cleanups.push(() => server.close());

    const instances = await listServiceInstances(stateRoot);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.port).toBe(1234);
    expect(instances[0]?.controlPath).toBe(server.controlPath);

    const first = await requestPairingUrl({ controlPath: server.controlPath });
    const second = await requestPairingUrl({ controlPath: server.controlPath });
    // Each request mints a fresh ticket — asking twice must not replay one.
    expect(first).toBe("http://127.0.0.1:1234/?pair=ticket_1");
    expect(second).toBe("http://127.0.0.1:1234/?pair=ticket_2");
  });

  it("keeps the socket owner-only on POSIX", async () => {
    if (process.platform === "win32") {
      return;
    }
    const stateRoot = await tempStateRoot();
    const server = await startPairingControl({
      stateRoot,
      instanceId: "srvc_test_mode",
      url: "http://127.0.0.1:1234",
      port: 1234,
      mintPairingUrl: () => "http://127.0.0.1:1234/?pair=x",
    });
    cleanups.push(() => server.close());
    const mode = (await stat(server.controlPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    const recordMode = (
      await stat(join(stateRoot, "control", "srvc_test_mode.json"))
    ).mode & 0o777;
    expect(recordMode).toBe(0o600);
  });

  it("answers unknown requests with an error and closes", async () => {
    const stateRoot = await tempStateRoot();
    const server = await startPairingControl({
      stateRoot,
      instanceId: "srvc_test_unknown",
      url: "http://127.0.0.1:1234",
      port: 1234,
      mintPairingUrl: () => {
        throw new Error("must not be called for an unknown request");
      },
    });
    cleanups.push(() => server.close());

    const { connect } = await import("node:net");
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(server.controlPath);
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ request: "shutdown" })}\n`);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.includes("\n")) {
          socket.end();
          resolve(buffer.split("\n")[0] ?? "");
        }
      });
      socket.on("error", reject);
    });
    expect(JSON.parse(answer)).toEqual({ error: "unknown request" });
  });

  it("removes its record and socket on close", async () => {
    const stateRoot = await tempStateRoot();
    const server = await startPairingControl({
      stateRoot,
      instanceId: "srvc_test_close",
      url: "http://127.0.0.1:1234",
      port: 1234,
      mintPairingUrl: () => "http://127.0.0.1:1234/?pair=x",
    });
    await server.close();
    expect(await listServiceInstances(stateRoot)).toEqual([]);
    const names = await readdir(join(stateRoot, "control"));
    expect(names).toEqual([]);
    // A request after close fails rather than hanging — the service is gone.
    await expect(
      requestPairingUrl({ controlPath: server.controlPath, timeoutMs: 500 }),
    ).rejects.toThrow();
  });

  it("ignores stale records from dead processes", async () => {
    const stateRoot = await tempStateRoot();
    const server = await startPairingControl({
      stateRoot,
      instanceId: "srvc_test_live",
      url: "http://127.0.0.1:1234",
      port: 1234,
      mintPairingUrl: () => "http://127.0.0.1:1234/?pair=x",
    });
    cleanups.push(() => server.close());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(stateRoot, "control", "srvc_test_dead.json"),
      JSON.stringify({
        instanceId: "srvc_test_dead",
        pid: 2 ** 30,
        port: 4321,
        url: "http://127.0.0.1:4321",
        controlPath: "/nonexistent",
        startedAt: new Date().toISOString(),
      }),
    );
    const instances = await listServiceInstances(stateRoot);
    expect(instances.map((instance) => instance.instanceId)).toEqual([
      "srvc_test_live",
    ]);
  });
});
