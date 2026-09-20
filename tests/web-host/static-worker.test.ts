/**
 * Cloudflare static Worker boundary tests.
 *
 * The worker is deliberately tiny: it must delegate ordinary asset requests to the
 * Static Assets binding, refuse API-looking paths before SPA fallback can answer them with
 * HTML, and attach security headers without receiving Git or bearer state.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import worker from "../../apps/web/src/worker.js";

interface AssetEnvironment {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly PUBLIC_API_ORIGINS: string;
}

function environment(
  calls: string[],
  body = "<!doctype html><title>refyard</title>",
): AssetEnvironment {
  return {
    ASSETS: {
      async fetch(request): Promise<Response> {
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
    PUBLIC_API_ORIGINS: "https://api.example.test",
  };
}

describe("Cloudflare static UI Worker", () => {
  it("delegates asset requests and adds a restrictive policy", async () => {
    // Prevents: the Worker becoming a second application server or serving an
    // unprotected static shell without the policy used by the local host.
    const calls: string[] = [];
    const response = await worker.fetch(
      new Request("https://ui.example.test/workspaces/one"),
      environment(calls),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual(["GET /workspaces/one"]);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://api.example.test",
    );
  });

  it("names the HTML bootstrap script in CSP without allowing arbitrary inline code", async () => {
    // Prevents: SvelteKit's inline bootstrap being blocked in production while a broad
    // `unsafe-inline` exception would let an injected script execute as well.
    const calls: string[] = [];
    const inline = "\n  console.log('boot');\n";
    const response = await worker.fetch(
      new Request("https://ui.example.test/"),
      environment(calls, `<!doctype html><script>${inline}</script>`),
    );

    const expected = createHash("sha256")
      .update(inline, "utf8")
      .digest("base64");
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain(`script-src 'self' 'sha256-${expected}'`);
    const scriptSource = policy
      .split(";")
      .find((part) => part.trim().startsWith("script-src"));
    expect(scriptSource).not.toContain("'unsafe-inline'");
  });

  it("returns a JSON 404 for API-looking paths instead of SPA HTML", async () => {
    // Prevents: an API typo being answered by single-page-app fallback, which makes a
    // client parse HTML as JSON and can hide a deployment or auth mistake.
    const calls: string[] = [];
    const response = await worker.fetch(
      new Request("https://ui.example.test/api/v1/repositories"),
      environment(calls),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      problem: { code: "NotFound" },
    });
    expect(calls).toEqual([]);
  });

  it("fails closed when no API origin is configured", async () => {
    // Prevents: the deployed shell silently granting JavaScript network access to
    // every HTTPS service when an operator forgot to configure the tunnel origin.
    // The check is scoped to connect-src: img-src legitimately names the GitHub
    // avatar hosts, and the policy as a whole therefore contains https:.
    const calls: string[] = [];
    const response = await worker.fetch(
      new Request("https://ui.example.test/workspaces/one"),
      { ...environment(calls), PUBLIC_API_ORIGINS: "" },
    );

    const policy = response.headers.get("content-security-policy") ?? "";
    const connectSource = policy
      .split(";")
      .find((part) => part.trim().startsWith("connect-src"));
    expect(connectSource?.trim()).toBe("connect-src 'self'");
  });

  it("refuses non-read asset methods before the binding runs", async () => {
    // Prevents: the static UI Worker accidentally becoming a write-capable HTTP proxy.
    const calls: string[] = [];
    const response = await worker.fetch(
      new Request("https://ui.example.test/index.html", { method: "POST" }),
      environment(calls),
    );

    expect(response.status).toBe(405);
    expect(calls).toEqual([]);
  });
});
