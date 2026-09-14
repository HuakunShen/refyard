/**
 * Planners for tags.
 *
 * A tag is a name other people fetch, so the rules are conservative: an existing
 * tag is never overwritten (the workflow checks before creating, and Git would
 * refuse anyway without `--force`), an annotated message travels on stdin as bytes
 * exactly like a commit message, and nothing here deletes or moves anything on a
 * remote — `pushTag` publishes one tag by name with no force and no delete form.
 *
 * Signing configuration is left alone: a user with `tag.gpgSign=true` gets signed
 * annotated tags, and that is their configuration, not this build's decision.
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

function spec(
  context: PlanContext,
  argv: readonly string[],
  description: string,
  stdin?: Uint8Array,
): GitCommandSpec {
  return stdin === undefined
    ? { argv, cwdHandle: context.cwdHandle, deadlineClass: "hook", description }
    : {
        argv,
        cwdHandle: context.cwdHandle,
        deadlineClass: "hook",
        description,
        stdin,
      };
}

/**
 * `git tag <name> [<targetOid>]` — the lightweight form.
 *
 * `--` ends options before the name in the annotated form below; for the
 * lightweight form the name is a positional and the schema has already refused a
 * leading dash.
 */
export function planTagCreateLightweight(
  context: PlanContext,
  input: { readonly name: string; readonly targetOid: string | null },
): GitCommandSpec {
  const argv = ["tag", "--", input.name];
  if (input.targetOid !== null) {
    argv.push(input.targetOid);
  }
  return spec(context, argv, "tag create (lightweight)");
}

/**
 * `git tag --annotate --file=- <name> [<targetOid>]` — the annotated form.
 *
 * `--cleanup=verbatim` keeps the message exactly as typed, for the same reason a
 * commit message is kept verbatim. `--file=-` is stdin, so a long or awkward
 * message never becomes an argument.
 */
export function planTagCreateAnnotated(
  context: PlanContext,
  input: {
    readonly name: string;
    readonly targetOid: string | null;
    readonly message: Uint8Array;
  },
): GitCommandSpec {
  if (input.message.byteLength === 0) {
    throw new Error("planTagCreateAnnotated requires a non-empty message");
  }
  const argv = [
    "tag",
    "--annotate",
    "--cleanup=verbatim",
    "--file=-",
    input.name,
  ];
  if (input.targetOid !== null) {
    argv.push(input.targetOid);
  }
  return spec(context, argv, "tag create (annotated)", input.message);
}

/** `git tag --delete <name>` — local only; a remote tag is never touched. */
export function planTagDelete(
  context: PlanContext,
  name: string,
): GitCommandSpec {
  return spec(context, ["tag", "--delete", name], "tag --delete");
}

/**
 * `git rev-parse --verify --quiet refs/tags/<name>`.
 *
 * Exit 1 means "no such tag", which the workflow reads as "safe to create" — the
 * same convention `symbolic-ref HEAD` uses for an unborn branch. Any other non-zero
 * exit is a real failure.
 */
export function planTagExists(
  context: PlanContext,
  name: string,
): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", `refs/tags/${name}`],
    "rev-parse tag",
  );
}
