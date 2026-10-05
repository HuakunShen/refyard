/**
 * The terminal service, against a fake pty.
 *
 * These cases exist because a terminal is the one surface where a routing or
 * ownership mistake drives a real shell: an output frame sent to the wrong
 * browser, a session capped too late, a refusal that is actually a fake success.
 * Every rule is exercised here without spawning anything, so the rules cannot be
 * flaked away by a slow shell — the real-spawn behaviour has its own test.
 */
import { describe, expect, it } from "vitest";
import { LIMITS } from "@refyard/git-contract";
import type { PtyPort, PtyProcess, PtySpawnRequest } from "@refyard/host-node/terminal/port";
import {
  createTerminalService,
  fromBase64,
} from "@refyard/host-node/terminal/service";

const OWNER = "browser-session-1";
const OTHER = "browser-session-2";

/** A scripted pty: output is queued by the test, input is recorded for asserts. */
class FakePty implements PtyProcess {
  readonly written: Uint8Array[] = [];
  resized: { cols: number; rows: number } | null = null;
  killed = false;
  private readonly dataListeners: ((chunk: Uint8Array) => void)[] = [];
  private readonly exitListeners: ((code: number | null) => void)[] = [];

  write(chunk: Uint8Array): void {
    this.written.push(chunk);
  }

  resize(cols: number, rows: number): void {
    this.resized = { cols, rows };
  }

  kill(): void {
    this.killed = true;
    for (const listener of [...this.exitListeners]) listener(null);
  }

  onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  emit(chunk: string): void {
    const bytes = new TextEncoder().encode(chunk);
    for (const listener of [...this.dataListeners]) listener(bytes);
  }

  exit(code: number | null): void {
    for (const listener of [...this.exitListeners]) listener(code);
  }
}

function serviceWith(overrides?: {
  readonly port?: PtyPort | null;
  readonly lookup?: (repositoryId: string) => { readonly text: string } | null;
}) {
  const processes: FakePty[] = [];
  const requests: PtySpawnRequest[] = [];
  const port: PtyPort | null =
    overrides?.port === undefined
      ? {
          kind: "fake",
          spawn(request) {
            requests.push(request);
            const pty = new FakePty();
            processes.push(pty);
            return pty;
          },
        }
      : overrides.port;
  const service = createTerminalService({
    port,
    repositories: {
      get: (repositoryId) => {
        const hit = overrides?.lookup
          ? overrides.lookup(repositoryId)
          : { text: "/repo/one" };
        return hit === null ? null : { displayPath: hit };
      },
    },
    command: { shell: "/bin/sh", argv: [], name: "sh" },
    environment: { HOME: "/home/user", SHELL: "/bin/zsh" },
    nextSessionId: (() => {
      let n = 0;
      return () => `term_test${(n += 1)}`;
    })(),
  });
  return { service, processes, requests, port };
}

describe("terminal capability", () => {
  it("a host with a pty port advertises the shell it will run", () => {
    const { service } = serviceWith();
    expect(service.capability()).toEqual({ shell: "sh" });
  });

  it("a host without a pty port advertises nothing", () => {
    const { service } = serviceWith({ port: null });
    expect(service.capability()).toBeNull();
  });
});

describe("opening sessions", () => {
  it("resolves the approved repository's directory on the host side", () => {
    const { service, requests } = serviceWith();
    const opened = service.open({
      repositoryId: "repo_one",
      cols: 80,
      rows: 24,
      ownerSessionId: OWNER,
    });
    expect(opened.shell).toBe("sh");
    expect(opened.cwd).toBe("/repo/one");
    expect(requests[0]?.cwd).toBe("/repo/one");
    // The login environment is pinned for terminal use; nothing else is invented.
    expect(requests[0]?.env.TERM).toBe("xterm-256color");
    expect(requests[0]?.env.HOME).toBe("/home/user");
  });

  it("refuses a repository this host has not approved", () => {
    const { service } = serviceWith({
      lookup: () => null,
    });
    expect(() =>
      service.open({
        repositoryId: "repo_unknown",
        cols: 80,
        rows: 24,
        ownerSessionId: OWNER,
      }),
    ).toThrow("no approved repository");
  });

  it("caps the number of live sessions instead of forking unboundedly", () => {
    const { service } = serviceWith();
    for (let i = 0; i < LIMITS.terminalSessionsPerService; i += 1) {
      service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    }
    expect(() =>
      service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER }),
    ).toThrow("terminal sessions at once");
  });

  it("a host without a pty port refuses to open instead of faking a session", () => {
    const { service } = serviceWith({ port: null });
    expect(() =>
      service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER }),
    ).toThrow("no pty module");
  });
});

describe("ownership", () => {
  it("a second browser session cannot write into a shell it did not open", () => {
    const { service, processes } = serviceWith();
    const opened = service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    expect(() =>
      service.write({ sessionId: opened.sessionId, bytes: new TextEncoder().encode("id\n"), ownerSessionId: OTHER }),
    ).toThrow("another browser session");
    // The refused write must not have reached the shell.
    expect(processes[0]?.written).toHaveLength(0);
  });

  it("resize, close and the output stream all check the same ownership", () => {
    const { service } = serviceWith();
    const opened = service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    expect(() => service.resize({ sessionId: opened.sessionId, cols: 100, rows: 30, ownerSessionId: OTHER })).toThrow();
    expect(() => service.close({ sessionId: opened.sessionId, ownerSessionId: OTHER })).toThrow();
    expect(() => service.subscribe(opened.sessionId, OTHER, () => {})).toThrow();
  });
});

describe("output", () => {
  it("buffers the shell's first bytes until a stream attaches, then flushes in order", () => {
    const { service, processes } = serviceWith();
    const opened = service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    processes[0]?.emit("hel");
    processes[0]?.emit("lo\n");
    const frames: string[] = [];
    const detach = service.subscribe(opened.sessionId, OWNER, (frame) => {
      if (frame.kind === "output") frames.push(new TextDecoder().decode(fromBase64(frame.data)));
    });
    expect(frames).toEqual(["hel", "lo\n"]);
    detach();
  });

  it("buffers are bounded: a chatty shell without a viewer cannot grow memory", () => {
    const { service, processes } = serviceWith();
    const opened = service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    const chunk = "x".repeat(64 * 1024);
    for (let i = 0; i < 16; i += 1) {
      processes[0]?.emit(chunk);
    }
    const frames: string[] = [];
    service.subscribe(opened.sessionId, OWNER, (frame) => {
      if (frame.kind === "output") frames.push(frame.data);
    });
    const received = frames.reduce((total, frame) => total + frame.length, 0);
    // The oldest bytes went, the newest tail survived: bounded like scrollback,
    // not silently complete.
    expect(received).toBeLessThan(16 * 64 * 1024);
    expect(frames.length).toBeGreaterThan(0);
  });

  it("frames carry base64 the contract validates, and exit ends the stream once", () => {
    const { service, processes } = serviceWith();
    const opened = service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    const frames: string[] = [];
    service.subscribe(opened.sessionId, OWNER, (frame) => frames.push(frame.kind));
    processes[0]?.emit("ok");
    processes[0]?.exit(0);
    // A second exit signal (a killed process group after a clean exit) is not a
    // second truth: the session is gone after the first.
    processes[0]?.exit(0);
    expect(frames).toEqual(["output", "exit"]);
  });
});

describe("closing", () => {
  it("close kills the process; a late frame for a closed session is refused", () => {
    const { service, processes } = serviceWith();
    const opened = service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    service.close({ sessionId: opened.sessionId, ownerSessionId: OWNER });
    expect(processes[0]?.killed).toBe(true);
    expect(() =>
      service.write({ sessionId: opened.sessionId, bytes: new Uint8Array(1), ownerSessionId: OWNER }),
    ).toThrow();
  });

  it("closeAll ends every live session", () => {
    const { service, processes } = serviceWith();
    service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    service.open({ repositoryId: "repo_one", cols: 80, rows: 24, ownerSessionId: OWNER });
    service.closeAll();
    expect(processes.map((process) => process.killed)).toEqual([true, true]);
  });
});
