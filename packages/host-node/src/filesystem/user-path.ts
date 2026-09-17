/** Expand the small set of local path shorthand the browser launcher accepts. */
import { homedir } from "node:os";
import { join } from "node:path";

export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}
