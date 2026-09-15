/**
 * Origin, Host and cross-site validation.
 *
 * A local HTTP service is reachable by every page in every browser on the machine,
 * so "it is only bound to loopback" is not an access-control decision — a page on
 * `https://evil.example` can send a request to `127.0.0.1:9595` and read the
 * response if the service allows it. Three checks decide whether to answer:
 *
 * - **Host** must be one of this instance's own authorities. Otherwise a request
 *   that arrives through a DNS-rebinding name (`attacker.example` → 127.0.0.1)
 *   would look same-origin to the page that sent it.
 * - **Origin**, when present, must match exactly. `null` (a sandboxed frame, a
 *   `file://` page) is refused. This is the check that stops a cross-origin page
 *   from reading anything, because every cross-origin `fetch` a browser makes
 *   carries an Origin.
 * - **An absent Origin is not trusted, and not refused either.** A document request
 *   carries no Origin at all — refusing it would break opening the workbench in a
 *   browser, which is the main thing this service is for. What protects the data is
 *   the bearer token: every read needs an `Authorization` header, this service never
 *   reads a cookie, and it sends no CORS headers, so a cross-site form, image or
 *   script request has nothing to authenticate with and nothing to read. When the
 *   browser reports `Sec-Fetch-Site: cross-site`, the request is refused outright.
 *
 * The allowlist is built by the CLI at startup — from the listener's own addresses,
 * never from a request — and there is deliberately no way to widen it over HTTP.
 */
import type { Problem } from "@refyard/git-contract";

export interface OriginPolicyOptions {
  /** The loopback authorities this instance answers to, e.g. `127.0.0.1:9595`. */
  readonly authorities: readonly string[];
  /** Origins that may call this service, e.g. `http://127.0.0.1:9595`. */
  readonly allowedOrigins: readonly string[];
}

export interface OriginPolicy {
  check(input: OriginCheckInput): OriginVerdict;
  authorities(): readonly string[];
  allowedOrigins(): readonly string[];
}

export type OriginVerdict =
  { readonly ok: true } | { readonly ok: false; readonly problem: Problem };

export interface OriginCheckInput {
  readonly origin: string | undefined;
  readonly host: string | undefined;
  /**
   * `Sec-Fetch-Site` when the browser sent it: `same-origin`, `same-site`,
   * `cross-site` or `none`. Absent from older browsers and from non-browser clients.
   */
  readonly secFetchSite?: string | undefined;
}

export function createOriginPolicy(policy: OriginPolicyOptions): OriginPolicy {
  const authorities = new Set(policy.authorities);
  const origins = new Set(policy.allowedOrigins);

  return {
    authorities(): readonly string[] {
      return [...authorities];
    },

    allowedOrigins(): readonly string[] {
      return [...origins];
    },

    check(input): OriginVerdict {
      if (input.host === undefined || !authorities.has(input.host)) {
        return {
          ok: false,
          problem: {
            code: "Forbidden",
            message:
              "this service only answers on its own loopback authority; the Host header did not match",
            retryable: false,
          },
        };
      }
      if (input.origin === "null") {
        return {
          ok: false,
          problem: {
            code: "Forbidden",
            message:
              "an opaque (null) origin is refused; open the workbench from the URL this service printed",
            retryable: false,
          },
        };
      }
      if (input.origin !== undefined && !origins.has(input.origin)) {
        return {
          ok: false,
          problem: {
            code: "Forbidden",
            message: "that origin is not one this service was started for",
            retryable: false,
          },
        };
      }
      if (input.origin === undefined) {
        // An absent Origin is not *trusted*; it is only not evidence of a cross-site
        // caller. Two cases reach here:
        //
        // - a browser navigating to the app (a document request carries no Origin at
        //   all, which is why refusing these would break opening the workbench);
        // - a non-browser client, which cannot read a cross-origin response anyway
        //   because this service sends no CORS headers.
        //
        // What protects the data is that every read still needs a bearer in an
        // Authorization header, and this service never reads a cookie — so a
        // cross-site form or image request has nothing to authenticate with. When
        // the browser tells us the request is cross-site, it is refused outright.
        if (input.secFetchSite === "cross-site") {
          return {
            ok: false,
            problem: {
              code: "Forbidden",
              message:
                "a cross-site request is refused even without an Origin header; open the workbench directly",
              retryable: false,
            },
          };
        }
      }
      return { ok: true };
    },
  };
}

/**
 * The authorities a loopback listener answers to.
 *
 * `127.0.0.1` and `localhost` are both listed because a user may open either one,
 * and `[::1]` only when the listener was told to bind IPv6 loopback explicitly.
 * Nothing else is ever added: no LAN address, no hostname, no wildcard.
 */
export function loopbackAuthorities(input: {
  readonly port: number;
  readonly includeIpv6?: boolean;
}): string[] {
  const authorities = [`127.0.0.1:${input.port}`, `localhost:${input.port}`];
  if (input.includeIpv6 === true) {
    authorities.push(`[::1]:${input.port}`);
  }
  return authorities;
}

export function originsFor(authorities: readonly string[]): string[] {
  return authorities.map((authority) => `http://${authority}`);
}
