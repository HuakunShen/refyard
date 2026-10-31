/**
 * The launch event name, in one place.
 *
 * The host emits `refyard://launch` when a second `refyard <dir>` reaches a running app;
 * the adapter is the only thing that listens, and the name has to match the constant in
 * `apps/desktop/src-tauri/src/launch.rs` exactly. Keeping it here, beside the adapter that
 * subscribes to it, makes the pair findable from either side.
 */
export const LAUNCH_EVENT = "refyard://launch";
