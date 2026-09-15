/**
 * How often the workbench re-reads a repository nobody told it about.
 *
 * The SSE stream carries hints about writes *this service* performed. It says nothing about
 * the other programs that share the machine: a commit in a terminal, a rebase in an IDE, a
 * script that moved a branch. Without polling, those changes are invisible until the user
 * does something that happens to read again.
 *
 * The cadence is the one the design prescribes (DESIGN.md §10): **2 s while the page is
 * visible, 15 s while it is hidden, and 30 s for a repository whose reads are slow**. Slow
 * means the read took at least as long as the visible interval — a 2-second poll answered in
 * 3 seconds is a queue, not a refresh, and pacing it faster only makes the queue longer.
 *
 * Two rules bound the cost, both from the same paragraph of the design:
 *
 * - **only cheap reads are polled.** Status, refs, history, worktrees, stashes and
 *   submodules are pages of metadata. A diff, a preview fingerprint or a file's contents are
 *   read when the user selects them and are never on this timer — the design says explicitly
 *   not to hash a repository every 2 seconds to notice background change.
 * - **nothing runs without a subscriber.** These values feed TanStack Query, which stops the
 *   timer when no component observes the query — a page that shows nothing fetches nothing.
 *
 * `visible` is a parameter rather than a `document` read inside this module: the arithmetic
 * is what needs testing, and a module that reached for the DOM could not be tested in Node.
 */

/** The visible-page interval: short enough to feel live, long enough to not be a load. */
export const VISIBLE_INTERVAL_MS = 2_000;
/** The hidden-page interval. A background tab still learns, just four times slower. */
export const HIDDEN_INTERVAL_MS = 15_000;
/** The interval a slow repository is paced at, visible or not. */
export const SLOW_INTERVAL_MS = 30_000;
/** A read at least this slow means the repository is slow; see the header. */
export const SLOW_READ_MS = VISIBLE_INTERVAL_MS;

/**
 * The interval a background read should use.
 *
 * `lastReadMs` is the duration of the last *successful* read, or null before the first one
 * has finished — an unknown repository is not a slow one.
 */
export function pollIntervalMs(input: {
  readonly visible: boolean;
  readonly lastReadMs: number | null;
}): number {
  const base = input.visible ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS;
  if (input.lastReadMs === null || input.lastReadMs < SLOW_READ_MS) {
    return base;
  }
  // Slow outranks hidden: the slower number is always the safer one to pace at.
  return Math.max(base, SLOW_INTERVAL_MS);
}

/**
 * The last successful read duration per query key.
 *
 * Kept outside the query cache on purpose: TanStack stores the *result* of a read, not how
 * long it took, and the cadence needs the duration. Keyed by the same array a query uses,
 * joined into one string — the only thing this does with it is compare keys for equality.
 */
export interface ReadTimer {
  record(key: readonly unknown[], durationMs: number): void;
  last(key: readonly unknown[]): number | null;
  /** Keys currently timed; used by the tests to show the map does not grow forever. */
  size(): number;
}

export function createReadTimer(): ReadTimer {
  const durations = new Map<string, number>();
  const keyOf = (key: readonly unknown[]): string => JSON.stringify(key);
  return {
    record(key, durationMs) {
      durations.set(keyOf(key), durationMs);
    },
    last(key) {
      return durations.get(keyOf(key)) ?? null;
    },
    size() {
      return durations.size;
    },
  };
}

/**
 * Wrap a read so the cadence knows how slow it was.
 *
 * A failed read records nothing: an error says nothing about how long a successful read
 * takes, and backing off because something is broken would hide the problem for longer.
 */
export function timedRead<T>(input: {
  readonly key: readonly unknown[];
  readonly timer: ReadTimer;
  readonly run: () => Promise<T>;
  readonly now?: () => number;
}): () => Promise<T> {
  const now = input.now ?? (() => Date.now());
  return async () => {
    const started = now();
    const value = await input.run();
    input.timer.record(input.key, now() - started);
    return value;
  };
}

/**
 * The options every background read carries: the cadence, and that it keeps ticking while
 * the page is hidden (a background tab is exactly where "hidden 15 s" applies).
 *
 * `visible` is a parameter and not a `document` read here: this module is arithmetic and
 * bookkeeping, it is imported by a Node test, and a DOM read in it would mean the test
 * could only run in a browser. The app supplies the real answer.
 */
export function backgroundRead(input: {
  readonly key: readonly unknown[];
  readonly timer: ReadTimer;
  readonly visible: () => boolean;
}): {
  readonly refetchInterval: () => number;
  readonly refetchIntervalInBackground: true;
} {
  return {
    refetchInterval: () =>
      pollIntervalMs({
        visible: input.visible(),
        lastReadMs: input.timer.last(input.key),
      }),
    refetchIntervalInBackground: true,
  };
}
