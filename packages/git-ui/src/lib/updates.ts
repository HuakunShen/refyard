/**
 * The updater state machine, owned here because the Settings sheet renders it.
 *
 * `UpdatesProbe` is the only thing a host implements — the desktop shell wraps the
 * Tauri updater plugin in it; a test wraps a fake. The machine's rule is that a check or
 * an install already in flight cannot be re-entered, and that every ending is honest:
 * "up to date", an offer, or the feed's own error message.
 */

export interface UpdateOffer {
  /** The version the update carries, when the feed names one. */
  readonly version: string | null;
  /** Downloads and installs. The app keeps running until it is relaunched. */
  install(): Promise<void>;
  /** Relaunches into the installed version. Only meaningful after `install`. */
  relaunch(): Promise<void>;
}

export interface UpdatesProbe {
  /** Resolves the pending update, or null when the feed says the app is current. */
  check(): Promise<UpdateOffer | null>;
}

export type UpdatesPhase =
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "up-to-date" }
  | {
      readonly state: "available";
      readonly offer: UpdateOffer;
      readonly version: string | null;
    }
  | { readonly state: "installing"; readonly offer: UpdateOffer }
  | { readonly state: "ready"; readonly offer: UpdateOffer }
  | { readonly state: "error"; readonly message: string };

/** Pure transition step: the current phase plus what happened, and the next phase. */
export async function stepUpdates(
  phase: UpdatesPhase,
  probe: UpdatesProbe,
): Promise<UpdatesPhase> {
  switch (phase.state) {
    case "idle":
    case "up-to-date":
    case "error": {
      break;
    }
    case "checking":
    case "installing":
    case "ready": {
      // A check or install already in flight must not be re-entered.
      return phase;
    }
    case "available": {
      return await install(phase.offer);
    }
  }
  try {
    const offer = await probe.check();
    return offer === null
      ? { state: "up-to-date" }
      : { state: "available", offer, version: offer.version ?? null };
  } catch (error) {
    return {
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function install(offer: UpdateOffer): Promise<UpdatesPhase> {
  try {
    await offer.install();
    return { state: "ready", offer };
  } catch (error) {
    return {
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
