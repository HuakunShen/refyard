/**
 * Pinned directory identity.
 *
 * An approval — an allowed root or a registered repository — must not survive
 * deleting the directory and creating a new one at the same path: the replacement
 * was never approved, and reading it under the old grant is how a service ends up
 * operating on a repository the user never pointed it at.
 *
 * The device and inode pair alone does not establish that on every filesystem. On
 * ext4 inode numbers are handed out again, so `rm -r root` followed by `mkdir root`
 * produced the *same* `dev` and `ino`, and the check silently passed — the revert
 * test for it failed on Linux and passed on macOS, which is what surfaced this. A
 * descriptor held on the directory closes that hole: while a descriptor keeps the
 * inode alive the kernel cannot free it, so a replacement gets a different number,
 * and on Linux the held inode's link count drops to zero the moment the last name
 * is removed.
 *
 * Two properties this must keep:
 *
 * - **No false positives.** Nothing here reads a timestamp, an entry count or a
 *   size, all of which change during ordinary use, so a root stays intact while
 *   files are created and deleted inside it.
 * - **Bounded.** A descriptor is a real resource and the default per-process limit
 *   on macOS is 256, so pins are capped; past the cap, or where a descriptor
 *   cannot be opened, identity falls back to the device and inode pair. Nothing
 *   here refuses an operation because it could not hold a descriptor.
 *
 * Windows is deliberately excluded from holding a descriptor: a directory there
 * cannot be deleted while a handle is open, so pinning would turn "delete this
 * repository" into a failure for the user. Windows keeps the numbers-only
 * comparison, and its swap test is where that either holds or does not.
 *
 * Descriptors are raw integers rather than `FileHandle` objects. A `FileHandle`
 * that is dropped without `close()` is closed *by the garbage collector*, and Node
 * treats that as an error — a whole suite of tests went red the first time this ran
 * with "A FileHandle object was closed during garbage collection", naming roots that
 * are correctly alive for the life of the service. An integer cannot be finalized,
 * so a pin that outlives its test costs one descriptor until the process exits,
 * which is exactly what the budget bounds.
 */
import type { Stats } from "node:fs";
import { close, fstat, open } from "node:fs";
import { stat } from "node:fs/promises";

/** What a check found at the recorded path. */
export type DirectoryState = "intact" | "missing" | "replaced";

export interface DirectoryPin {
  /** Device and inode recorded when the directory was approved. */
  readonly dev: number;
  readonly ino: number;
  check(): Promise<DirectoryState>;
  /** Drop the descriptor. The numbers stay valid for a comparison, nothing more. */
  release(): void;
}

export interface DirectoryPins {
  /** Record `path`'s identity. `info` is a stat the caller has already taken. */
  pin(path: string, info: Stats): Promise<DirectoryPin>;
  /**
   * How many descriptors are held right now.
   *
   * The budget is the only reason this is visible: a count that drifts (a release
   * that decrements twice, a pin that is never released) is a slow leak toward the
   * process descriptor limit, where the failure appears as a Git process that
   * cannot be spawned rather than as anything to do with identity.
   */
  held(): number;
}

/**
 * How many directories one service pins at once.
 *
 * Comfortably above the number of roots and repositories a workbench holds open,
 * and comfortably below the default descriptor limit, because a process that runs
 * out of descriptors fails somewhere unrelated — spawning Git, opening a socket —
 * which is a far worse failure than a weaker identity check.
 */
export const DEFAULT_PIN_BUDGET = 128;

export function createDirectoryPins(
  options: { readonly budget?: number } = {},
): DirectoryPins {
  const budget = options.budget ?? DEFAULT_PIN_BUDGET;
  let held = 0;

  async function hold(path: string): Promise<number | null> {
    if (held >= budget || process.platform === "win32") {
      return null;
    }
    const descriptor = await openDescriptor(path);
    if (descriptor === null) {
      // A directory that cannot be held is still usable. Identity then rests on
      // the numbers alone, exactly as it did before there was a descriptor.
      return null;
    }
    held += 1;
    return descriptor;
  }

  return {
    held: (): number => held,
    async pin(path, info): Promise<DirectoryPin> {
      const dev = Number(info.dev);
      const ino = Number(info.ino);
      // Reassigned by `release`, so a second release cannot close twice or hand
      // the same slot back to the budget twice.
      let descriptor = await hold(path);
      return {
        dev,
        ino,
        check: async (): Promise<DirectoryState> => {
          let current: Stats;
          try {
            current = await stat(path);
          } catch {
            return "missing";
          }
          if (!current.isDirectory()) {
            // A file or other non-directory at the path is not the directory that
            // was approved, whatever its numbers say.
            return "replaced";
          }
          if (Number(current.dev) !== dev || Number(current.ino) !== ino) {
            return "replaced";
          }
          if (descriptor === null) {
            return "intact";
          }
          // The numbers agree, but they are not proof on their own: an allocator
          // that recycles despite the held descriptor could hand the same pair out
          // twice. The held inode answers that directly — Linux zeroes a removed
          // directory's link count while the descriptor keeps the inode alive. On
          // APFS the count stays at 2, so there the numbers comparison is what
          // decides, and a kept-alive inode is what keeps the numbers honest.
          const heldInfo = await describeDescriptor(descriptor);
          if (heldInfo !== null && Number(heldInfo.nlink) === 0) {
            return "replaced";
          }
          return "intact";
        },
        release: (): void => {
          if (descriptor === null) {
            return;
          }
          const closing = descriptor;
          descriptor = null;
          held -= 1;
          close(closing, () => {
            // Closing a descriptor nobody else needs cannot fail in a way the
            // caller could act on.
          });
        },
      };
    },
  };
}

function openDescriptor(path: string): Promise<number | null> {
  return new Promise((settle) => {
    open(path, "r", (error, descriptor) => {
      settle(error === null ? descriptor : null);
    });
  });
}

function describeDescriptor(descriptor: number): Promise<Stats | null> {
  return new Promise((settle) => {
    fstat(descriptor, (error, info) => {
      settle(error === null ? info : null);
    });
  });
}
