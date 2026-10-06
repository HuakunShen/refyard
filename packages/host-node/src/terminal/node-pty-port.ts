/**
 * The node-pty pty port.
 *
 * node-pty is an optional native module: this is the only file that knows it
 * exists, and loading it is a dynamic import so a machine without the module
 * degrades to "no terminal" — `capabilities` omits the surface, the routes answer
 * `UnsupportedOperation` — instead of failing the service at startup. The bundler
 * keeps `node-pty` external for the same reason: the native addon can never be
 * inlined into the CLI bundle.
 *
 * node-pty hands output back as strings; the port re-encodes them to UTF-8 bytes
 * so everything above this file speaks bytes only. node-pty buffers an incomplete
 * multibyte sequence across chunks, so the re-encoding does not corrupt split
 * characters. A kill reports exit code null: the host ended the session, and
 * inventing a numeric code would dress the kill up as an observed exit.
 */
import { chmodSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import type { IPty } from "node-pty";
import { createKunkunPtyPort } from "./kunkun-pty-port.js";
import type { PtyPort, PtyProcess, PtySpawnRequest } from "./port.js";

export interface NodePtyModule {
  spawn(
    file: string,
    args: readonly string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): IPty;
}

/**
 * The pty port this host should use, in preference order.
 *
 * `@kunkun.sh/pty` (a ~590 KB per-platform binding around the same
 * portable-pty crate) wins wherever it is installed and its owner's decision
 * record does not call the platform verified — Windows stays with node-pty
 * until the ConPTY specifics there are done. node-pty is the fallback, and a
 * machine with neither reports no terminal capability at all.
 */
export async function createPreferredPtyPort(): Promise<PtyPort | null> {
  if (process.platform !== "win32") {
    const small = await createKunkunPtyPort();
    if (small !== null) {
      return small;
    }
  }
  return createNodePtyPort();
}

export async function createNodePtyPort(
  load: () => Promise<NodePtyModule> = loadNodePty,
): Promise<PtyPort | null> {
  let module: NodePtyModule;
  try {
    module = await load();
    ensureMacSpawnHelperExecutable();
  } catch {
    // No native module on this machine is a product state, not an error: the
    // terminal simply is not among this host's capabilities.
    return null;
  }
  return {
    kind: "node-pty",
    spawn(request: PtySpawnRequest): PtyProcess {
      return new NodePtyProcess(
        module.spawn(request.shell, [...request.argv], {
          name: "xterm-256color",
          cols: request.cols,
          rows: request.rows,
          cwd: request.cwd,
          env: { ...request.env },
        }),
      );
    },
  };
}

async function loadNodePty(): Promise<NodePtyModule> {
  const module = (await import("node-pty")) as unknown as NodePtyModule & {
    default?: NodePtyModule;
  };
  return module.default ?? module;
}

/**
 * node-pty 1.1.0 ships its macOS `spawn-helper` without the executable bit, and
 * every spawn then fails with `posix_spawnp failed` — an upstream packaging bug
 * (the tarball stores the helper mode-644; npm and pnpm both extract it as
 * shipped). Restore the bit best-effort next to the loaded prebuild. Everything
 * that does not need it — other platforms, an already-fixed tree, a read-only
 * install — is left exactly as it was.
 */
function ensureMacSpawnHelperExecutable(): void {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    const entry = fileURLToPath(import.meta.resolve("node-pty"));
    const helper = resolve(
      dirname(entry),
      "..",
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );
    if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
      chmodSync(helper, 0o755);
    }
  } catch {
    // A helper this routine cannot find or fix produces a spawn failure with a
    // clear message later; it must not break loading the module here.
  }
}

class NodePtyProcess implements PtyProcess {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder("utf-8");
  private killed = false;

  constructor(private readonly pty: IPty) {}

  write(chunk: Uint8Array): void {
    // Keyboard bytes are UTF-8 by construction (the emulator encodes its input);
    // non-fatal decoding keeps a malformed paste from throwing inside a write.
    this.pty.write(this.decoder.decode(chunk));
  }

  resize(cols: number, rows: number): void {
    if (!this.killed) {
      this.pty.resize(cols, rows);
    }
  }

  kill(): void {
    if (this.killed) {
      return;
    }
    this.killed = true;
    try {
      this.pty.kill();
    } catch {
      // A shell that already exited cannot be killed again; the exit listener
      // has the truth and this cleanup must not race it into an error.
    }
  }

  onData(listener: (chunk: Uint8Array) => void): void {
    this.pty.onData((data: string) => {
      listener(this.encoder.encode(data));
    });
  }

  onExit(listener: (exitCode: number | null) => void): void {
    this.pty.onExit((event: { exitCode: number; signal?: number }) => {
      // node-pty reports `signal: 0` for a clean exit; only a real signal means
      // the host (or a kill) ended the session, and that stays null.
      const signaled = event.signal !== undefined && event.signal !== 0;
      listener(signaled ? null : event.exitCode);
    });
  }
}
