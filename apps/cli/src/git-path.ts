/**
 * Finding the Git executable — the CLI's spelling of a rule that lives in `host-node`.
 *
 * The rule itself is in `@refyard/host-node` because every host that assembles a service
 * needs it; this module is the app-local name the CLI already imports, kept so the command
 * line and the embedded hosts cannot drift apart on which Git they run.
 */
export { resolveGitPath } from "@refyard/host-node";
