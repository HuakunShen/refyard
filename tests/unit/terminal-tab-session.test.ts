/**
 * The session half of one terminal tab: open races, input batching, resize
 * dedupe, and — the reason this module exists — the teardown contract. A tab
 * whose view unmounts without destroying its session leaks the whole chain:
 * the emulator buffer, the observer the transport registered, and the host's
 * pty, which keeps producing output into the detached buffer for the lifetime
 * of the app (observed as the webview renderer climbing past 200 MB).
 */
import { describe, expect, it, vi } from "vitest";
import type { TerminalOpenResponse } from "@refyard/git-contract";
import type {
  TerminalObserver,
  TerminalOpenRequest,
  TerminalService,
  TerminalSessionHandle,
} from "@refyard/git-service";
import {
  startTerminalTab,
  type EmulatorLike,
} from "@refyard/git-ui/lib/terminal-tab-session";

interface PendingOpen {
  resolve: (handle: TerminalSessionHandle) => void;
  reject: (error: unknown) => void;
}

/** A TerminalService whose open() the test resolves by hand. */
function fakeHost() {
  const requests: TerminalOpenRequest[] = [];
  const pending: PendingOpen[] = [];
  const handles: TerminalSessionHandle[] = [];
  let observer: TerminalObserver | null = null;

  const service: TerminalService = {
    open(request, sessionObserver) {
      requests.push(request);
      observer = sessionObserver;
      return new Promise<TerminalSessionHandle>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };

  function makeHandle(id: string): TerminalSessionHandle {
    const info: TerminalOpenResponse = {
      sessionId: id,
      shell: `/bin/${id}`,
      cwd: `/tmp/${id}`,
    };
    const handle: TerminalSessionHandle = {
      info,
      write: vi.fn<[data: Uint8Array], void>(),
      resize: vi.fn<[cols: number, rows: number], void>(),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    handles.push(handle);
    return handle;
  }

  return {
    service,
    requests,
    handles,
    resolveOpen(id: string): TerminalSessionHandle {
      const handle = makeHandle(id);
      pending.shift()?.resolve(handle);
      return handle;
    },
    emitOutput(bytes: Uint8Array): void {
      observer?.onData(bytes);
    },
    emitExit(code: number | null): void {
      observer?.onExit(code);
    },
  };
}

/** The xterm surface the session drives, without xterm. */
function fakeEmulator(cols = 80, rows = 24) {
  let input: ((data: string) => void) | null = null;
  const emulator: EmulatorLike = {
    cols,
    rows,
    write: vi.fn<[data: Uint8Array | string], void>(),
    onData(callback: (data: string) => void): { dispose(): void } {
      input = callback;
      return {
        dispose: () => {
          if (input === callback) {
            input = null;
          }
        },
      };
    },
    dispose: vi.fn<() => void>(),
  };
  return {
    emulator,
    type: (data: string): void => {
      input?.(data);
    },
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("terminal tab session", () => {
  it("sends the emulator grid on open, forwards output, and merges keystroke bursts into one write", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const ui = fakeEmulator();
    const onReady = vi.fn();
    const onExit = vi.fn();
    startTerminalTab(host.service, "repo-1", ui.emulator, { onReady, onExit });

    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]).toMatchObject({
      repositoryId: "repo-1",
      cols: 80,
      rows: 24,
    });

    // Keystrokes before the session exists wait in the queue; a flush with no
    // session must not drop them — a slow shell start must not eat typing.
    ui.type("ab");
    ui.type("cd");
    await vi.advanceTimersByTimeAsync(10);
    expect(host.handles).toHaveLength(0);

    const handle = host.resolveOpen("s1");
    await flush();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(handle.info);
    // The grid the host was asked for goes back once as the initial truth.
    expect(handle.resize).toHaveBeenCalledWith(80, 24);

    host.emitOutput(new Uint8Array([65, 10]));
    expect(ui.emulator.write).toHaveBeenCalledWith(new Uint8Array([65, 10]));

    // A burst typed at once becomes one write, queueing the earlier one with it.
    ui.type("xy");
    await vi.advanceTimersByTimeAsync(10);
    expect(handle.write).toHaveBeenCalledTimes(1);
    expect(handle.write).toHaveBeenCalledWith(
      new Uint8Array([97, 98, 99, 100, 120, 121]),
    );
    vi.useRealTimers();
  });

  it("destroy closes the session exactly once, disposes the emulator, and drops queued input", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const ui = fakeEmulator();
    const tab = startTerminalTab(host.service, "repo-1", ui.emulator, {
      onReady: vi.fn(),
      onExit: vi.fn(),
    });
    const handle = host.resolveOpen("s1");
    await flush();

    ui.type("never-sent");
    await tab.destroy();
    await vi.advanceTimersByTimeAsync(20);

    // The close-tab path and the unmount teardown can both run destroy(); the
    // second must be a no-op, not a second host round-trip.
    await tab.destroy();

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(ui.emulator.dispose).toHaveBeenCalledTimes(1);
    expect(handle.write).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("an open that resolves after destroy is closed, never adopted, and its output never reaches the emulator", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const ui = fakeEmulator();
    const onReady = vi.fn();
    const tab = startTerminalTab(host.service, "repo-1", ui.emulator, {
      onReady,
      onExit: vi.fn(),
    });
    await tab.destroy();

    const handle = host.resolveOpen("late");
    await flush();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    // Prevents the real-world failure this module was extracted for: a shell
    // the UI has abandoned keeps streaming output into a detached buffer.
    host.emitOutput(new Uint8Array([66]));
    expect(ui.emulator.write).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reports a grid once per change and never after destroy", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const ui = fakeEmulator();
    const tab = startTerminalTab(host.service, "repo-1", ui.emulator, {
      onReady: vi.fn(),
      onExit: vi.fn(),
    });
    const handle = host.resolveOpen("s1");
    await flush();
    expect(handle.resize).toHaveBeenCalledTimes(1);

    // A refit that changes nothing must not re-send the grid — the resize
    // observer loop is broken by the dedupe, not by luck.
    tab.resize(80, 24);
    expect(handle.resize).toHaveBeenCalledTimes(1);

    tab.resize(120, 30);
    expect(handle.resize).toHaveBeenCalledTimes(2);
    expect(handle.resize).toHaveBeenLastCalledWith(120, 30);

    await tab.destroy();
    tab.resize(200, 50);
    expect(handle.resize).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("exit stops input but destroy still closes the host session", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const ui = fakeEmulator();
    const onExit = vi.fn();
    const tab = startTerminalTab(host.service, "repo-1", ui.emulator, {
      onReady: vi.fn(),
      onExit,
    });
    const handle = host.resolveOpen("s1");
    await flush();

    host.emitExit(0);
    expect(onExit).toHaveBeenCalledWith(0);

    ui.type("after-exit");
    await vi.advanceTimersByTimeAsync(20);
    expect(handle.write).not.toHaveBeenCalled();

    // The shell died on its own, but the transport's observer entry (and any
    // host-side session record) only goes away through close().
    await tab.destroy();
    expect(handle.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
