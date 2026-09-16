/**
 * Whether this page may keep using the session it remembers.
 *
 * Two things can change under a static UI, and both are silent the other way:
 *
 * - **The service instance.** The address is a preference (`localhost:9595`), so a
 *   workbench bookmark can end up pointing at a *different* refyard — another
 *   machine's tunnel, or a second service started after the first stopped. A token
 *   minted by one instance means nothing to another, and retrying with it produces a
 *   stream of 401s that look like a bug in the app.
 * - **The API major.** The app is built once and can outlive the service it came from,
 *   or meet an older one. A UI that keeps issuing writes against semantics it was not
 *   built for is worse than one that stops: the request may be understood *differently*,
 *   not just refused.
 *
 * The rules are pure so they can be tested without a browser, and the *actions* — clear
 * storage, clear the query cache, block writes — are the caller's, which is what keeps
 * this module free of both `window` and the cache client.
 */
import { API_MAJOR, CONTRACT_VERSION } from "@refyard/git-contract";

/** What this build speaks. The major is the negotiate-or-stop number. */
export const UI_API_MAJOR = API_MAJOR;
export const UI_CONTRACT_VERSION = CONTRACT_VERSION;

export interface RememberedSession {
  /** Service instance the stored token was minted by, when it was recorded. */
  readonly instanceId: string | null;
  readonly hasToken: boolean;
}

export interface ServiceIdentity {
  readonly serviceInstanceId: string;
  readonly apiMajor: number;
  readonly contractVersion: string;
}

export type Negotiation =
  | { readonly kind: "ok" }
  | {
      /** Same version, different service: the token is not ours, so re-pair. */
      readonly kind: "differentInstance";
      readonly message: string;
      readonly previousInstanceId: string | null;
    }
  | {
      /** The service speaks a different major: refuse reads and writes alike. */
      readonly kind: "incompatible";
      readonly message: string;
      readonly serviceMajor: number;
      readonly uiMajor: number;
    }
  | {
      /** A compatible major with a newer contract: reads stay safe, writes stop. */
      readonly kind: "readOnlyCompatibility";
      readonly message: string;
      readonly serviceContractVersion: string;
      readonly uiContractVersion: string;
    };

/**
 * Decide what to do about the session this page remembers.
 *
 * A remembered session with no recorded instance is accepted: it predates instance
 * recording, and the token itself still has to satisfy the service. Refusing it would
 * sign every existing tab out for no security gain.
 */
export function negotiateSession(
  remembered: RememberedSession,
  service: ServiceIdentity,
): Negotiation {
  if (service.apiMajor !== UI_API_MAJOR) {
    return {
      kind: "incompatible",
      message: `this build speaks API v${UI_API_MAJOR}, and the service at this address speaks v${service.apiMajor}; update the service or the page — nothing will be sent`,
      serviceMajor: service.apiMajor,
      uiMajor: UI_API_MAJOR,
    };
  }
  if (
    remembered.hasToken &&
    remembered.instanceId !== null &&
    remembered.instanceId !== service.serviceInstanceId
  ) {
    return {
      kind: "differentInstance",
      message:
        "the service at this address is not the one this tab paired with (it restarted, or another instance is running here); pair again to continue",
      previousInstanceId: remembered.instanceId,
    };
  }
  if (service.contractVersion !== UI_CONTRACT_VERSION) {
    return {
      kind: "readOnlyCompatibility",
      message: `this page speaks contract ${UI_CONTRACT_VERSION}, and the service at this address speaks ${service.contractVersion}; reads remain available, but writes are disabled until both are updated`,
      serviceContractVersion: service.contractVersion,
      uiContractVersion: UI_CONTRACT_VERSION,
    };
  }
  return { kind: "ok" };
}

/** True when a negotiation forbids writes, whatever the connection state says. */
export function blocksWrites(negotiation: Negotiation): boolean {
  return negotiation.kind !== "ok";
}
