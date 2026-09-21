/**
 * A local GitHub API stub: the upstream the provider tests stand in for.
 *
 * No provider test may touch api.github.com, so this server answers the two
 * endpoints the client knows, with route-table behavior tests can change per
 * case. It asserts nothing itself; the responses it produces are the evidence
 * the suites consume.
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface StubRoute {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body: string;
}

export interface GitHubStub {
  readonly baseUrl: string;
  /** Requests the stub has seen, as `METHOD /path?query` with headers. */
  readonly requests: readonly {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, string | undefined>;
  }[];
  set(route: string, response: StubRoute): void;
  clear(): void;
  close(): Promise<void>;
}

export async function startGitHubStub(): Promise<GitHubStub> {
  const routes = new Map<string, StubRoute>();
  const requests: {
    method: string;
    url: string;
    headers: Record<string, string | undefined>;
  }[] = [];
  const server = http.createServer((request, response) => {
    const url = `${request.method ?? "GET"} ${request.url}`;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      // A repeated header is joined the way a server would merge it; the tests
      // only look at single-valued headers like `authorization`.
      headers[key] = Array.isArray(value) ? value.join(", ") : (value ?? "");
    }
    requests.push({ method: request.method ?? "GET", url, headers });
    const route = routes.get(url);
    if (route === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Not Found" }));
      return;
    }
    response.writeHead(route.status, {
      "content-type": "application/json",
      ...route.headers,
    });
    response.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    set(route, responseBody) {
      routes.set(route, responseBody);
    },
    clear() {
      routes.clear();
      requests.length = 0;
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
