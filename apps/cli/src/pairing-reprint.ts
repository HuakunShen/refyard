/**
 * The `p` keystroke: another pairing URL, printed to the user's own terminal.
 *
 * A pairing ticket is single-use on purpose — a URL that sits in a browser's history must
 * not be a standing credential. The cost is that a second browser (or a second device in
 * front of the same machine) needs a fresh ticket, and the service cannot hand those out
 * over HTTP without widening the very authentication surface the ticket protects.
 *
 * The safe channel is the one the service already has: its own standard input. The user
 * types `p` in the terminal where they started `refyard open`, a new ticket is minted and
 * printed there, and no unauthenticated request can ever trigger it.
 */
export function isPairingCommand(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  return trimmed === "p" || trimmed === "pair";
}
