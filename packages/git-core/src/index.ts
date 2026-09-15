/**
 * `@refyard/git-core` — the portable Git engine.
 *
 * Three responsibilities, and nothing else:
 *
 * - **planners** produce every production `git` invocation as a fixed argument
 *   vector (`plan/`),
 * - **parsers** turn Git's machine output back into structured facts, reading
 *   bytes rather than decoded text (`parse/`),
 * - **workflows** compose those two into reads that answer a product question —
 *   a status snapshot, a history page, a bounded diff (`workflows/`). They run
 *   commands through `GitEngine`, which the host implements, so a workflow is
 *   still plain code with no process, filesystem or clock of its own.
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
export * from "./parse/meta.js";
export * from "./plan/status.js";
export * from "./plan/paths.js";
export * from "./plan/commit.js";
export * from "./plan/refs.js";
export * from "./plan/branches.js";
export * from "./plan/remotes.js";
export * from "./plan/tags.js";
export * from "./plan/worktrees.js";
export * from "./plan/submodules.js";
export * from "./plan/merge.js";
export * from "./plan/repository.js";
export * from "./workflows/engine.js";
export * from "./workflows/status.js";
export * from "./workflows/history.js";
export * from "./workflows/repository.js";
export * from "./workflows/diff.js";
export * from "./workflows/stage.js";
export * from "./workflows/discard.js";
export * from "./workflows/commit.js";
export * from "./workflows/branches.js";
export * from "./workflows/network.js";
export * from "./workflows/stash.js";
export * from "./workflows/worktrees.js";
export * from "./workflows/merge.js";
