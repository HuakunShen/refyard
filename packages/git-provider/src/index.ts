/**
 * `@refyard/git-provider` — forge integrations for the provider axis.
 *
 * Host-side by intent: the REST clients here run only in the Node service and
 * the Rust host's future counterpart, never in the browser. Browser code that
 * needs pure parsing imports the module it needs by subpath
 * (`@refyard/git-provider/remotes`), which keeps the clients out of the SPA
 * bundle entirely.
 */
export * from "./remotes.js";
export * from "./github/device-flow.js";
