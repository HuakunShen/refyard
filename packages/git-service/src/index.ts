/**
 * `@refyard/git-service` — what the UI is allowed to know about its backend.
 *
 * Interfaces, error normalization, and the session/adapter contract. No transport
 * implementation lives here: `@refyard/backend-http` and `@refyard/backend-tauri`
 * depend on this package, never the other way around.
 */
export * from "./service.js";
export * from "./backend.js";
export * from "./host.js";
export * from "./events.js";
export * from "./errors.js";
