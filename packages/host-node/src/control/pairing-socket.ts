/**
 * The local control channel a running service uses to hand out pairing tickets.
 *
 * A ticket is single-use on purpose: a URL that sits in a browser's history must
 * not be a standing credential, and the service must not mint new ones over HTTP
 * — an endpoint that issues credentials unauthenticated would widen the very
 * surface the ticket protects. The trusted channel is the local machine: the
 * service binds a socket only its owner can open (a unix socket in the 0700 state
 * directory, mode 0600; a named pipe on Windows), writes a discovery record beside
 * it, and `refyard pair` asks over that socket. Same user, same trust level as the
 * `p` keystroke on the service's own terminal — and nothing about it is reachable
 * over the network.
 */
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** What `refyard pair` needs to find and talk to a running service. */
export interface ServiceInstanceRecord {
  readonly instanceId: string;
  readonly pid: number;
  readonly port: number;
  /** The service's own origin, for messages that name the instance. */
  readonly url: string;
  /** Unix socket path, or the Windows pipe name `net` connects to. */
  readonly controlPath: string;
  readonly startedAt: string;
}

export function controlDirectory(stateRoot: string): string {
  return join(stateRoot, "control");
}

/**
 * Socket paths already bound by THIS process. Production runs one service per
 * process, but tests (and embedded hosts) can run several; the pid-based name
 * must then grow a suffix instead of silently replacing a live socket.
 */
const boundControlPaths = new Set<string>();

function controlPathFor(stateRoot: string, instanceId: string): string {
  if (process.platform === "win32") {
    // A named pipe is not a filesystem path; net takes the pipe name directly.
    let pipe = `\\\\.\\pipe\\refyard-${instanceId}`;
    let suffix = 2;
    while (boundControlPaths.has(pipe)) {
      pipe = `\\\\.\\pipe\\refyard-${instanceId}-${suffix}`;
      suffix += 1;
    }
    return pipe;
  }
  // A pid names the socket: unique among live processes, short, and a stale
  // file can only belong to a dead one.
  let base = join(controlDirectory(stateRoot), `p${process.pid}`);
  if (Buffer.byteLength(`${base}.sock`) > 100) {
    // A unix socket path is capped near 104 bytes on macOS, and a deep state
    // root can overflow it. A per-user directory under the temp root keeps the
    // socket addressable; the discovery record still lives in the state root.
    base = join(tmpdir(), "refyard-control", `p${process.pid}`);
  }
  let candidate = `${base}.sock`;
  let suffix = 2;
  while (boundControlPaths.has(candidate)) {
    candidate = `${base}-${suffix}.sock`;
    suffix += 1;
  }
  return candidate;
}

function recordPathFor(stateRoot: string, instanceId: string): string {
  return join(controlDirectory(stateRoot), `${instanceId}.json`);
}

export interface PairingControlServer {
  readonly controlPath: string;
  close(): Promise<void>;
}

export interface PairingControlOptions {
  /** The service's private state root; the socket and record live under it. */
  readonly stateRoot: string;
  readonly instanceId: string;
  readonly url: string;
  readonly port: number;
  /** Mints a fresh single-use pairing URL — the same function the `p` keystroke uses. */
  readonly mintPairingUrl: () => string;
  /** Called after a successful mint, so the service's own output can say so. */
  readonly onMinted?: () => void;
}

const MAX_REQUEST_BYTES = 4096;

export async function startPairingControl(
  options: PairingControlOptions,
): Promise<PairingControlServer> {
  await mkdir(controlDirectory(options.stateRoot), { recursive: true, mode: 0o700 });
  const controlPath = controlPathFor(options.stateRoot, options.instanceId);
  if (process.platform !== "win32") {
    // The socket's own directory (they usually coincide with the control dir,
    // but the long-path fallback lives under the temp root).
    await mkdir(dirname(controlPath), { recursive: true, mode: 0o700 });
    // A leftover socket file at this path cannot belong to anything live — the
    // name carries a pid, and this process holds that pid now — so removing it
    // keeps a restart from failing on a stale inode.
    try {
      await unlink(controlPath);
    } catch {
      // Nothing to clean up.
    }
  }
  boundControlPaths.add(controlPath);

  const server = createServer((socket) => {
    let buffer = "";
    let answered = false;
    socket.setEncoding("utf8");
    socket.on("error", () => {
      // A peer that vanishes mid-request is not this service's problem.
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      if (answered) {
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      answered = true;
      const line = buffer.slice(0, newline);
      if (isPairRequest(line)) {
        let pairingUrl: string;
        try {
          pairingUrl = options.mintPairingUrl();
        } catch {
          socket.end(`${JSON.stringify({ error: "the service could not mint a ticket" })}\n`);
          return;
        }
        options.onMinted?.();
        socket.end(`${JSON.stringify({ pairingUrl })}\n`);
        return;
      }
      socket.end(`${JSON.stringify({ error: "unknown request" })}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(controlPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  if (process.platform !== "win32") {
    await chmod(controlPath, 0o600);
  }

  const record: ServiceInstanceRecord = {
    instanceId: options.instanceId,
    pid: process.pid,
    port: options.port,
    url: options.url,
    controlPath,
    startedAt: new Date().toISOString(),
  };
  await writeFile(
    recordPathFor(options.stateRoot, options.instanceId),
    JSON.stringify(record),
    { mode: 0o600 },
  );

  return {
    controlPath,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      boundControlPaths.delete(controlPath);
      if (process.platform !== "win32") {
        try {
          await unlink(controlPath);
        } catch {
          // Already gone.
        }
      }
      try {
        await unlink(recordPathFor(options.stateRoot, options.instanceId));
      } catch {
        // Already gone.
      }
    },
  };
}

function isPairRequest(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { request?: unknown }).request === "pair"
    );
  } catch {
    return false;
  }
}

/**
 * Every live service registered under this state root.
 *
 * A record whose process is gone is skipped rather than deleted — cleanup is the
 * owning service's job, and a race with a starting process must not remove a live
 * record.
 */
export async function listServiceInstances(
  stateRoot: string,
): Promise<readonly ServiceInstanceRecord[]> {
  let names: string[];
  try {
    names = await readdir(controlDirectory(stateRoot));
  } catch {
    return [];
  }
  const records: ServiceInstanceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await readFile(join(controlDirectory(stateRoot), name), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as ServiceInstanceRecord).pid === "number" &&
        typeof (parsed as ServiceInstanceRecord).controlPath === "string" &&
        pidIsAlive((parsed as ServiceInstanceRecord).pid)
      ) {
        records.push(parsed as ServiceInstanceRecord);
      }
    } catch {
      // A torn or foreign record is ignored; discovery is best-effort.
    }
  }
  return records;
}

/** `kill(pid, 0)` probes liveness without touching the process. */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another user — for a same-user state
    // directory that still counts as live.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface RequestPairingOptions {
  readonly controlPath: string;
  readonly timeoutMs?: number;
}

/**
 * Ask a running service for a fresh pairing URL over its control channel.
 *
 * One request, one line, one answer, then the socket closes — the channel holds
 * no session and cannot do anything else.
 */
export function requestPairingUrl(
  options: RequestPairingOptions,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(options.controlPath);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("the service did not answer on its control channel"));
      }
    }, options.timeoutMs ?? 2000);
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ request: "pair" })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        fail(new Error("the service's answer was unreadable"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timer);
      socket.end();
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as {
          pairingUrl?: unknown;
          error?: unknown;
        };
        if (typeof parsed.pairingUrl === "string") {
          if (!settled) {
            settled = true;
            resolve(parsed.pairingUrl);
          }
          return;
        }
        fail(
          new Error(
            typeof parsed.error === "string"
              ? parsed.error
              : "the service refused to mint a ticket",
          ),
        );
      } catch {
        fail(new Error("the service's answer was unreadable"));
      }
    });
    socket.on("error", (error) => {
      fail(error);
    });
    socket.on("close", () => {
      fail(new Error("the control channel closed before answering"));
    });
  });
}
