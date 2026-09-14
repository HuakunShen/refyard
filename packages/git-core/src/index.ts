/**
 * `@refyard/git-core` — the portable Git engine.
 *
 * Two responsibilities, and nothing else:
 *
 * - **planners** produce every production `git` invocation as a fixed argument
 *   vector (`plan/`),
 * - **parsers** turn Git's machine output back into structured facts, reading
 *   bytes rather than decoded text (`parse/`).
 *
 * It imports no host module and touches no host global: privileged I/O arrives
 * through `GitHostPort`, text decoding through `TextCodec`, and time through the
 * caller. `pnpm check:boundaries` fails the build if that stops being true.
 */
export * from "./ports.js";
export * from "./bytes/nul.js";
export * from "./bytes/limits.js";
export * from "./parse/status.js";
export * from "./parse/numstat.js";
export * from "./parse/ls-files.js";
export * from "./parse/refs.js";
export * from "./parse/worktree.js";
export * from "./parse/cat-file.js";
export * from "./parse/patch.js";
export * from "./parse/network.js";
export * from "./plan/status.js";
export * from "./plan/paths.js";
export * from "./plan/commit.js";
