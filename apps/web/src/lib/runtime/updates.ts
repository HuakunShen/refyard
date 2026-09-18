/**
 * The desktop probe: wraps the Tauri updater plugin behind the probe interface the
 * Settings sheet's state machine consumes. Loaded lazily so a browser build never
 * downloads updater code; only the desktop runtime ever calls this.
 */
import type { UpdatesProbe } from "@refyard/git-ui";

export async function createDesktopUpdates(): Promise<UpdatesProbe> {
  const updater = await import("@tauri-apps/plugin-updater");
  const process = await import("@tauri-apps/plugin-process");
  return {
    async check() {
      const update = await updater.check();
      if (update === null) {
        return null;
      }
      return {
        version: update.version ?? null,
        async install(): Promise<void> {
          await update.downloadAndInstall();
        },
        async relaunch(): Promise<void> {
          await process.relaunch();
        },
      };
    },
  };
}
