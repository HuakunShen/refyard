/**
 * Runtime connection resolution.
 *
 * These cases protect the two facts the security model rests on: the ticket is read from
 * the fragment and nowhere else, and the address the app talks to is decided by rules a
 * user can predict — a bad override falls back to the page's own origin instead of
 * producing a page that talks to nothing and explains nothing.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeBaseUrl,
  parseSessionConfig,
  readTicket,
  stripTicket,
} from "../../apps/web/src/lib/connection.js";

describe("pairing ticket", () => {
  it("reads the ticket from the fragment, where a server never sees it", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:47831/#pair=abc123",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBe("abc123");
    expect(config.baseUrl).toBe("http://127.0.0.1:47831");
  });

  it("accepts the design package's `ticket` spelling as well as the CLI's `pair`", () => {
    // A pairing URL is pasted around; refusing the other name turns a working URL into an
    // authentication failure.
    const config = parseSessionConfig({
      href: "http://127.0.0.1:47831/#ticket=abc123",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBe("abc123");
  });

  it("ignores a ticket in the query string", () => {
    // A query string is sent to the server and written to logs; accepting one here would
    // teach users to paste tickets into places that keep them.
    const config = parseSessionConfig({
      href: "http://127.0.0.1:47831/?ticket=abc123",
      storedBaseUrl: null,
    });
    expect(config.ticket).toBeNull();
  });

  it("reads a ticket from a fragment that carries more than the ticket", () => {
    const url = new URL("http://127.0.0.1:47831/#pair=abc123&repo=xyz");
    expect(readTicket(url)).toBe("abc123");
  });

  it("returns null rather than an empty ticket for an empty fragment", () => {
    expect(readTicket(new URL("http://127.0.0.1:47831/#"))).toBeNull();
    expect(readTicket(null)).toBeNull();
  });

  it("strips only the fragment, so the app keeps its query and path", () => {
    expect(stripTicket("http://127.0.0.1:47831/repo/1?x=2#ticket=abc")).toBe(
      "http://127.0.0.1:47831/repo/1?x=2",
    );
  });
});

describe("service address", () => {
  it("defaults to this page's origin, which is the service that served it", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:47831/",
      storedBaseUrl: null,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:47831");
    expect(config.overridden).toBe(false);
  });

  it("prefers an explicit ?api= override and says so", () => {
    const config = parseSessionConfig({
      href: "http://127.0.0.1:47831/?api=http://127.0.0.1:5000",
      storedBaseUrl: null,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:5000");
    expect(config.overridden).toBe(true);
  });

  it("falls back to the page's origin when an override is not a usable http address", () => {
    // A typo in the address must not produce a page that silently talks to nothing.
    const config = parseSessionConfig({
      href: "http://127.0.0.1:47831/?api=not a url",
      storedBaseUrl: null,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:47831");
    expect(config.overridden).toBe(false);
  });

  it("uses a remembered address when the URL carries none", () => {
    const config = parseSessionConfig({
      href: "https://app.example.test/",
      storedBaseUrl: "http://127.0.0.1:47831",
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:47831");
    expect(config.overridden).toBe(true);
  });

  it("normalises away a path, query and trailing slash", () => {
    // Requests are built as `base + path`; a trailing slash would request `//api/v1/…`.
    expect(normalizeBaseUrl("http://127.0.0.1:47831/")).toBe(
      "http://127.0.0.1:47831",
    );
    expect(normalizeBaseUrl("http://127.0.0.1:47831/app/?x=1#y")).toBe(
      "http://127.0.0.1:47831",
    );
  });

  it("refuses a scheme that cannot carry an authenticated API", () => {
    expect(normalizeBaseUrl("file:///tmp/index.html")).toBeNull();
    expect(normalizeBaseUrl("ws://127.0.0.1:47831")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
  });
});
