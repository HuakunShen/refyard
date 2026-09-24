/**
 * `refyard serve` / `refyard open` — run an assembled service in the foreground.
 *
 * The service itself is assembled by `@refyard/host-node`; what stays here is the part
 * that belongs to a command-line host: the port policy, the pairing control socket, the
 * terminal banner with the pairing URL, and the signal handlers.
 *
 * Foreground is the whole lifecycle model in this version: the process runs until
 * Ctrl+C, and Ctrl+C stops accepting new work before it exits. There is no daemon,
 * no service installer and no supervision — Xross is the future supervisor, and it
 * is not this release.
 */
import {
  createInterface,
  type Interface as ConsoleInterface,
} from "node:readline";
import {
  assembleService,
  defaultStateRoot,
  PortInUseError,
  startHttpHost,
  startPairingControl,
  type AssembleOptions,
  type HttpHost,
  type HttpHostOptions,
  type ServiceAssembly,
} from "@refyard/host-node";
import { API_MAJOR, CONTRACT_VERSION } from "@refyard/git-contract";
import { DEFAULT_PORT, DEFAULT_TICKET_TTL_SECONDS } from "./args.js";

import { isPairingCommand } from "./pairing-reprint.js";
import { reportedVersion } from "./version.js";
import { openInBrowser } from "./browser.js";


export interface RunServiceOptions extends AssembleOptions {
  readonly port: number;
  /**
   * Whether `port` was asked for by name.
   *
   * An explicit port is a request for *that* port — a bookmark, a tunnel, a script that
   * expects it — so a busy one is refused. The default port is a courtesy, and a busy one
   * means "take another free port and say which". Required rather than defaulted: a call
   * site that has not thought about which case it is in should not silently get one.
   */
  readonly portExplicit: boolean;
  readonly openBrowser: boolean;
  /** Pairing-ticket lifetime in seconds; 60 unless --ticket-ttl says otherwise. */
  readonly ticketTtlSeconds: number;
  /** Optional static root for an embedding host; the CLI itself leaves this absent. */
  readonly webRoot?: string | null;
  /** Exact browser origins allowed to call this API in hosted mode. */
  readonly allowedOrigins?: readonly string[];
  /** Origin of the separately deployed UI that receives the pairing URL. */
  readonly uiOrigin?: string;
  /** Browser-visible API origin, such as the HTTPS endpoint exposed by a tunnel. */
  readonly apiOrigin?: string;
  /** Hosted pairing secret, supplied by the environment and never placed in argv or logs. */
  readonly hostedPassword?: string;
  readonly allowRoot: boolean;
  /**
   * Machine output: one JSON object on stdout, pairing material on stderr only.
   *
   * A terminal is a private channel; a pipe may be read by anything, so the ticket
   * never appears on stdout in this mode.
   */
  readonly json?: boolean;
  /** Injected by tests so a run does not need a signal to stop. */
  readonly installSignalHandlers?: boolean;
  /** How long a stop waits for in-flight requests; the host's default is 5 s. */
  readonly shutdownGraceMs?: number;
}

export interface RunningService {
  readonly http: HttpHost;
  readonly assembly: ServiceAssembly;
  readonly url: string;
  /** The pairing URL carrying the one-time ticket. */
  readonly pairingUrl: string;
  close(): Promise<void>;
}

export async function runService(
  options: RunServiceOptions,
): Promise<RunningService> {
  if (
    process.getuid !== undefined &&
    process.getuid() === 0 &&
    !options.allowRoot
  ) {
    throw new Error(
      "refyard refuses to run as root: Git hooks and filters would run with root privileges. Pass --allow-root only if you understand that.",
    );
  }

  const assembly = await assembleService(options);
  const note = options.writeError ?? options.write;
  // Annotated so a mistyped field is a compile error: an unannotated object spread into
  // the call would silently drop whatever the host does not recognise.
  const hostOptions: Omit<HttpHostOptions, "port"> = {
    read: assembly.read,
    mutations: assembly.mutations,
    events: assembly.events,
    serviceInstanceId: assembly.serviceInstanceId,
    ticketTtlSeconds: options.ticketTtlSeconds,
    webRoot: options.webRoot ?? null,
    allowedOrigins: [
      ...(options.allowedOrigins ?? []),
      ...(options.uiOrigin === undefined ? [] : [options.uiOrigin]),
    ],
    ...(options.hostedPassword === undefined
      ? {}
      : { hostedPassword: options.hostedPassword }),
    repositoryManagement: assembly.repositoryManagement,
    ...(options.shutdownGraceMs === undefined
      ? {}
      : { shutdownGraceMs: options.shutdownGraceMs }),
    repositoryRootOf: (repositoryId: string) =>
      assembly.repositories.get(repositoryId)?.allowedRootId ?? null,
    provider: assembly.provider,
    grants: {
      allowedRootIds: [...assembly.allowedRootIds],
      repositoryIds: [...assembly.repositoryIds],
      scopes: [
        "repository:read",
        "repository:write",
        "repository:network",
        "workspace:manage",
        "provider:manage",
      ],
    },
    log: (line) => {
      // Service logs are diagnostics, not data: a machine reading stdout must not
      // find them interleaved with the JSON object.
      if (options.json === true) {
        note(`  ${line}`);
      } else {
        options.write(`  ${line}`);
      }
    },
  };

  let http: HttpHost;
  try {
    http = await startHttpHost({ ...hostOptions, port: options.port });
  } catch (error) {
    if (error instanceof PortInUseError && !options.portExplicit) {
      // The default port is a courtesy, not a promise: a second refyard, a dev server or a
      // tunnel may hold it. Taking a free port instead keeps the default usable, and the
      // note names both ports so nothing moves silently. An explicitly requested port is
      // not retried — see `RunServiceOptions.portExplicit`.
      http = await startHttpHost({ ...hostOptions, port: 0 });
      note(
        `note: port ${error.port} is in use; listening on port ${http.port} instead (pass --port to pin one)`,
      );
    } else {
      throw error;
    }
  }

  const origin = `http://127.0.0.1:${http.port}`;
  const pairingUrlFor = (): string => {
    const pairingOrigin = options.uiOrigin ?? origin;
    const issued = http.pairingUrl(pairingOrigin);
    if (options.uiOrigin === undefined) {
      return issued;
    }
    const url = new URL(issued);
    url.searchParams.set("api", options.apiOrigin ?? origin);
    return url.toString();
  };
  const pairingUrl = pairingUrlFor();
  const localUi = options.webRoot !== undefined && options.webRoot !== null;

  /**
   * The trusted local channel for more tickets: `refyard pair` connects to this
   * socket (same user only) and asks for a fresh pairing URL — the programmatic
   * twin of the `p` keystroke. Minting stays off HTTP on purpose: an endpoint
   * that hands out credentials would widen the surface the ticket protects.
   */
  const pairingControl = await startPairingControl({
    stateRoot: options.stateRootPath ?? defaultStateRoot(),
    instanceId: http.serviceInstanceId,
    url: origin,
    port: http.port,
    mintPairingUrl: pairingUrlFor,
    onMinted: () => {
      // The ticket itself goes to the requester; the service's own terminal
      // keeps a line so a human can see that one was handed out.
      note("a fresh pairing URL was issued over the local control socket (`refyard pair`)");
    },
  });

  /**
   * Two output modes, and the difference is who is reading.
   *
   * A terminal gets the banner, including the pairing URL — the user's own screen is
   * the private channel that a web page cannot read. A machine (`--json`) gets one
   * JSON object on stdout with no pairing material in it at all, and the pairing URL
   * goes to stderr: a supervisor can capture it, a log can strip it, and a program
   * parsing stdout can never mistake a ticket for data.
   */
  if (options.json === true) {
    options.write(
      JSON.stringify({
        serviceInstanceId: http.serviceInstanceId,
        port: http.port,
        url: origin,
        apiMajor: API_MAJOR,
        contractVersion: CONTRACT_VERSION,
        repositoryId: assembly.repositoryId,
        repositoryIds: [...assembly.repositoryIds],
        allowedRootIds: [...assembly.allowedRootIds],
        ui: localUi ? origin : null,
        apiOnly: !localUi,
      }),
    );
    note(`pairing URL (single use): ${pairingUrl}`);
    if (options.openBrowser && (localUi || options.uiOrigin !== undefined)) {
      const opened = await openInBrowser(pairingUrl);
      if (!opened.ok) {
        note(`could not open a browser: ${opened.reason}`);
      }
    } else if (options.openBrowser) {
      note(
        "not opening a browser: this CLI serves the API only; configure the deployed UI origin with --ui-origin",
      );
    }
    let jsonClosed = false;
    const closeJson = async (): Promise<void> => {
      if (jsonClosed) {
        return;
      }
      jsonClosed = true;
      await http.close();
      await pairingControl.close();
    };
    if (options.installSignalHandlers !== false) {
      const onJsonSignal = (): void => {
        note("stopping: no new requests will be accepted");
        void closeJson().then(() => {
          process.exitCode = 0;
        });
      };
      process.on("SIGINT", onJsonSignal);
      process.on("SIGTERM", onJsonSignal);
    }
    return { http, assembly, url: origin, pairingUrl, close: closeJson };
  }

  options.write(`refyard ${await reportedVersion()} (api ${API_MAJOR})`);
  options.write(`  repositories: ${assembly.repositoryPaths.join(", ")}`);
  options.write(`  git:        ${assembly.gitVersion}`);
  options.write(
    `  port:       ${http.port}${options.port === 0 ? " (chosen by the OS)" : ""}`,
  );
  options.write(
    `  ticket ttl: ${options.ticketTtlSeconds}s${options.ticketTtlSeconds === DEFAULT_TICKET_TTL_SECONDS ? "" : " (--ticket-ttl)"}`,
  );
  options.write(
    localUi
      ? `  ui:         ${origin} (bundled local workbench)`
      : "  ui:         API-only (use a hosted UI or integration client)",
  );
  options.write("");
  options.write(`  open this URL in your browser to pair this session:`);
  options.write(`    ${pairingUrl}`);
  options.write("");
  options.write(
    `  ready ${JSON.stringify({ serviceInstanceId: http.serviceInstanceId, port: http.port, url: origin })}`,
  );
  options.write(
    `  press p + Enter to print another pairing URL (each is single use)`,
  );
  options.write(
    `  or run \`refyard pair\` in another terminal for the same thing`,
  );
  options.write(`  press Ctrl+C to stop`);

  if (options.openBrowser && (localUi || options.uiOrigin !== undefined)) {
    const opened = await openInBrowser(pairingUrl);
    if (!opened.ok) {
      // The URL is already printed, so a missing browser is a note, not a failure.
      options.write(
        `  note: could not open a browser (${opened.reason}); use the URL above`,
      );
    }
  } else if (options.openBrowser) {
    options.write(
      "  note: not opening a browser: this CLI serves the API only; configure --ui-origin for the deployed UI",
    );
  }

  let closed = false;
  // Created once the listener is up; `close` shuts it down so the terminal
  // interface never holds the process open after a stop.
  let consoleInterface: ConsoleInterface | null = null;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    // Stop accepting new requests first, then drop sessions: an in-flight read gets
    // to finish, and nothing new is paired after the user asked to stop.
    await http.close();
    await pairingControl.close();
    consoleInterface?.close();
  };

  if (options.installSignalHandlers !== false) {
    const onSignal = (): void => {
      options.write("");
      options.write("stopping: no new requests will be accepted");
      void close().then(() => {
        process.exitCode = 0;
      });
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // A second browser needs a second ticket, and minting must stay out of the
    // authenticated API: the user's terminal is the channel that cannot be spoofed by a
    // web page. The interface is closed with the service so it never holds the process
    // open after a stop.
    const readline = createInterface({ input: process.stdin });
    consoleInterface = readline;
    readline.on("line", (line) => {
      if (isPairingCommand(line)) {
        options.write("");
        options.write("  a fresh pairing URL (single use):");
        options.write(`    ${pairingUrlFor()}`);
      }
    });
  }

  return {
    http,
    assembly,
    url: origin,
    pairingUrl,
    close,
  };
}

export { DEFAULT_PORT };
