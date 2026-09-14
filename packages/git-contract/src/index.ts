/**
 * `@refyard/git-contract` — the public GitService contract.
 *
 * This module is a barrel only: schemas, inferred types, constants and the
 * semantic validators, with no side effects and no host access. It is the single
 * source for every shape the browser may see; the host validates against it and
 * the client builds against it, so a field cannot mean two things in two places.
 */
export * from "./version.js";
export * from "./ids.js";
export * from "./limits.js";
export * from "./targets.js";
export * from "./names.js";
export * from "./operations.js";
export * from "./requests.js";
export * from "./errors.js";
export * from "./reads.js";
export * from "./validate.js";
export * from "./registry.js";
export * from "./json-schema.js";
