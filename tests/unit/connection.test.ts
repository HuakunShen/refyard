/**
 * Runtime connection resolution.
 *
 * These cases protect the two facts the security model rests on: the ticket is read from
 * wherever the pairing URL carried it (fragment first, query string as an equal citizen —
 * the user's 2026-09-15 direction, after a browser flow dropped the fragment), and the
 * address the app talks to is decided by rules a user can predict — a bad override falls
 * back to the page's own origin instead of producing a page that talks to nothing and
 * explains nothing.
 *
 * The query form's exposure is bounded, and these are the bounds the tests keep an eye on:
 * the host never logs a query string, the ticket is single-use and expires in sixty
 * seconds, and `stripTicket` clears it from the address bar once it is spent.
 */
import { describe, expect, it } from "vitest";
import {
  extractTicketFromText,
  normalizeBaseUrl,
  parseSessionConfig,
  readTicket,
  stripTicket,
} from "../../apps/web/src/lib/connection.js";

describe("pairing ticket", () => {
  it("reads the ticket from the fragment, where a server never sees it", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/#pair=abc123",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBe("abc123");
    expect(config.baseUrl).toBe("http://127.0.0.1:9595");
  });

  it("reads the ticket from the query string, so opening the printed URL pairs", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/?pair=abc123",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBe("abc123");
    expect(config.baseUrl).toBe("http://127.0.0.1:9595");
  });

  it("accepts the design package's `ticket` spelling in both positions", () => {
    // A pairing URL is pasted around; refusing the other name turns a working URL into an
    // authentication failure.
    for (const href of [
      "http://127.0.0.1:9595/#ticket=abc123",
      "http://127.0.0.1:9595/?ticket=abc123",
    ]) {
      expect(parseSessionConfig({ href, storedBaseUrl: null }).ticket).toBe(
        "abc123",
      );
    }
  });

  it("prefers the fragment when a URL somehow carries both", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/?pair=from-query#pair=from-fragment",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBe("from-fragment");
  });

  it("reads a ticket from a URL that also overrides the service address", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/?api=http://127.0.0.1:5000&pair=abc123",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBe("abc123");
    expect(config.baseUrl).toBe("http://127.0.0.1:5000");
  });

  it("reads a ticket from a fragment that carries more than the ticket", () => {
    const url = new URL("http://127.0.0.1:9595/#pair=abc123&repo=xyz");
    expect(readTicket(url)).toBe("abc123");
  });

  it("returns null rather than an empty ticket for an empty fragment", () => {
    expect(readTicket(new URL("http://127.0.0.1:9595/#"))).toBeNull();
    expect(readTicket(new URL("http://127.0.0.1:9595/?pair="))).toBeNull();
    expect(readTicket(null)).toBeNull();
  });

  it("strips the ticket from both the fragment and the query, keeping everything else", () => {
    expect(stripTicket("http://127.0.0.1:9595/repo/1?pair=abc&x=2")).toBe(
      "http://127.0.0.1:9595/repo/1?x=2",
    );
    expect(stripTicket("http://127.0.0.1:9595/?pair=abc&ticket=def")).toBe(
      "http://127.0.0.1:9595/",
    );
    expect(stripTicket("http://127.0.0.1:9595/repo/1?x=2#ticket=abc")).toBe(
      "http://127.0.0.1:9595/repo/1?x=2",
    );
  });
});

describe("service address", () => {
  it("defaults to this page's origin, which is the service that served it", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/",
      storedBaseUrl: null,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:9595");
    expect(config.overridden).toBe(false);
  });

  it("prefers an explicit ?api= override and says so", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/?api=http://127.0.0.1:5000",
      storedBaseUrl: null,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:5000");
    expect(config.overridden).toBe(true);
  });

  it("falls back to the page's origin when an override is not a usable http address", () => {
    // A typo in the address must not produce a page that silently talks to nothing.
    const config = parseSessionConfig({
      href: "http://127.0.0.1:9595/?api=not a url",
      storedBaseUrl: null,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:9595");
    expect(config.overridden).toBe(false);
  });

  it("uses a remembered address when the URL carries none", () => {
    const config = parseSessionConfig({
      href: "https://app.example.test/",
      storedBaseUrl: "http://127.0.0.1:9595",
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:9595");
    expect(config.overridden).toBe(true);
  });

  it("keeps a service path and normalises away the query and trailing slash", () => {
    // Requests are built as `base + path`; a trailing slash would request `//api/v1/…`.
    expect(normalizeBaseUrl("http://127.0.0.1:9595/")).toBe(
      "http://127.0.0.1:9595",
    );
    expect(normalizeBaseUrl("http://127.0.0.1:9595/app/?x=1#y")).toBe(
      "http://127.0.0.1:9595/app",
    );
    // An embedding host serves the workbench under a prefix; dropping it would send every
    // request to that host's own `/api/v1/…` instead of the mounted service.
    expect(normalizeBaseUrl("http://127.0.0.1:3080/refyard")).toBe(
      "http://127.0.0.1:3080/refyard",
    );
    expect(normalizeBaseUrl("http://127.0.0.1:3080/refyard/")).toBe(
      "http://127.0.0.1:3080/refyard",
    );
  });

  it("refuses a scheme that cannot carry an authenticated API", () => {
    expect(normalizeBaseUrl("file:///tmp/index.html")).toBeNull();
    expect(normalizeBaseUrl("ws://127.0.0.1:9595")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
  });

  it("extracts ticket whether pasted as bare token or full pairing URL", () => {
    expect(extractTicketFromText("bare-ticket-123")).toBe("bare-ticket-123");
    expect(
      extractTicketFromText("http://127.0.0.1:9595/?pair=query-ticket-456"),
    ).toBe("query-ticket-456");
    expect(
      extractTicketFromText("http://127.0.0.1:9595/#pair=frag-ticket-789"),
    ).toBe("frag-ticket-789");
    expect(
      extractTicketFromText("http://127.0.0.1:9595/?ticket=design-ticket-abc"),
    ).toBe("design-ticket-abc");
    expect(extractTicketFromText("   spaced-token   ")).toBe("spaced-token");
  });
});
