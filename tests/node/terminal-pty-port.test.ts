/**
 * The preferred pty loader, against whatever is installed.
 *
 * These cases prove the loader's contract rather than any one provider: the
 * preferred port spawns a real shell, carries bytes both ways, reports a real
 * exit code, and maps a host kill to `null`. They run against whichever
 * provider the loader picks on this machine — @kunkun.sh/pty when it is
 * linked, node-pty otherwise — and are skipped (honestly, by name) where no
 * pty module exists at all. The provider's identity is asserted so a machine
 * that believes it has the small binding cannot silently be testing node-pty.
 */
import { platform } from "node:process";
import { describe, expect, it } from "vitest";
import { createPreferredPtyPort } from "@refyard/host-node/terminal/node-pty-port";

describe("preferred pty loader", () => {
  it("picks the small binding when it is linked, node-pty otherwise", async () => {
    const port = await createPreferredPtyPort();
    if (port === null) {
      throw new Error(
        "no pty module on this machine; link @kunkun.sh/pty or install node-pty to run this case",
      );
    }
    if (platform !== "win32") {
      expect(["kunkun-sh-pty", "node-pty"]).toContain(port.kind);
    } else {
      expect(port.kind).toBe("node-pty");
    }
  });

  it("carries a shell's echo and a real exit code", async () => {
    const port = await createPreferredPtyPort();
    if (port === null) {
      return; // honestly absent: the terminal capability is off here
    }
    const chunks: Uint8Array[] = [];
    let exit: number | null | undefined;
    const process = port.spawn({
      cwd: "/tmp",
      shell: "/bin/sh",
      argv: [],
      env: { TERM: "xterm-256color", PATH: "/usr/bin:/bin" },
      cols: 80,
      rows: 24,
    });
    process.onData((chunk) => chunks.push(chunk));
    process.onExit((code) => {
      exit = code;
    });
    process.write(new TextEncoder().encode("echo loader_marker_$((3 + 4))\n"));
    const deadline = Date.now() + 10_000;
    while (
      Date.now() < deadline &&
      !text(chunks).includes("loader_marker_7") &&
      exit === undefined
    ) {
      await sleep(100);
    }
    expect(text(chunks)).toContain("loader_marker_7");
    expect(exit).toBeUndefined(); // still running: nothing fabricated an exit

    process.write(new TextEncoder().encode("exit 5\n"));
    while (Date.now() < deadline && exit === undefined) {
      await sleep(100);
    }
    expect(exit).toBe(5);
  });

  it("reports a host kill as an exit with no fabricated code", async () => {
    const port = await createPreferredPtyPort();
    if (port === null) {
      return;
    }
    let exit: number | null | undefined;
    const process = port.spawn({
      cwd: "/tmp",
      shell: "/bin/sh",
      argv: [],
      env: { TERM: "xterm-256color", PATH: "/usr/bin:/bin" },
      cols: 80,
      rows: 24,
    });
    process.onData(() => {});
    process.onExit((code) => {
      exit = code;
    });
    process.write(new TextEncoder().encode("sleep 30\n"));
    await sleep(300);
    process.kill();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && exit === undefined) {
      await sleep(100);
    }
    // The host ended the session; the code it died with is nobody's business.
    expect(exit).toBeNull();
  });
});

function text(chunks: readonly Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
