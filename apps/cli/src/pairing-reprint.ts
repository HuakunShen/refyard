/**
 * The `p` keystroke: another pairing URL, printed to the user's own terminal.
 *
 * A pairing ticket is single-use on purpose — a URL that sits in a browser's history must
 * not be a standing credential. The cost is that a second browser (or a second device in
 * front of the same machine) needs a fresh ticket, and the service cannot hand those out
 * over HTTP without widening the very authentication surface the ticket protects.
 *
 * Two trusted local channels mint tickets: this keystroke, on the terminal that started
 * the service, and `refyard pair`, which asks the running service over its same-user-only
 * control socket (see `host-node/src/control/pairing-socket.ts`). Neither is reachable by
 * a web page.
 */
export function isPairingCommand(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  return trimmed === "p" || trimmed === "pair";
}
