/**
 * `refyard pair` — print a fresh pairing URL for a running service.
 *
 * A ticket is single-use by design (a URL in browser history must not be a
 * standing credential), so a second browser needs a second ticket. Minting is
 * not an HTTP endpoint: the running service listens on a same-user-only control
 * socket in its private state directory, and this command is the client of that
 * channel — the programmatic twin of typing `p` into the service's terminal.
 */
import {
  defaultStateRoot,
  listServiceInstances,
  requestPairingUrl,
} from "@refyard/host-node";

export interface PairCommandOptions {
  /** Pick a service by its loopback port; null means "the only one running". */
  readonly port: number | null;
  readonly json: boolean;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
  /** Private state override used by isolated integration fixtures. */
  readonly stateRoot?: string;
}

export async function runPairCommand(options: PairCommandOptions): Promise<number> {
  const instances = await listServiceInstances(
    options.stateRoot ?? defaultStateRoot(),
  );
  if (instances.length === 0) {
    options.writeError(
      "refyard pair: no running refyard service was found — start one with `refyard open`",
    );
    return 1;
  }
  const matching =
    options.port === null
      ? instances
      : instances.filter((instance) => instance.port === options.port);
  if (matching.length === 0) {
    options.writeError(
      `refyard pair: no running service on port ${options.port} (running: ${instances
        .map((instance) => instance.port)
        .join(", ")})`,
    );
    return 1;
  }
  if (matching.length > 1) {
    // Guessing would mint a ticket for the wrong service; naming the ports is
    // the only honest answer.
    options.writeError(
      `refyard pair: ${matching.length} services are running — choose one with --port (${matching
        .map((instance) => instance.port)
        .join(", ")})`,
    );
    return 1;
  }
  const instance = matching[0];
  if (instance === undefined) {
    options.writeError("refyard pair: the service record was unreadable");
    return 1;
  }
  try {
    const pairingUrl = await requestPairingUrl({
      controlPath: instance.controlPath,
    });
    if (options.json) {
      options.write(
        JSON.stringify({
          pairingUrl,
          port: instance.port,
          url: instance.url,
        }),
      );
    } else {
      options.write(pairingUrl);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.writeError(`refyard pair: ${message}`);
    return 1;
  }
}
