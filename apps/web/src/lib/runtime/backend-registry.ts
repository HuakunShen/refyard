/**
 * Which backend the workbench talks to, decided once at runtime.
 *
 * One UI, two transports: a desktop WebView reaches its own Rust host over Tauri IPC,
 * a browser reaches a Refyard service over authenticated HTTP. The choice is made here
 * and nowhere else — a component that could tell the difference would need a token
 * check, an `invoke` import, or a base URL, and the next adapter would have to edit it.
 *
 * Two properties this module is responsible for:
 *
 * - **Detection never throws and never guesses from a URL.** It looks for the marker
 *   Tauri injects into its own WebView; anywhere else (a plain tab, a prerender pass,
 *   a Node test) the answer is HTTP. A query parameter cannot switch a public page onto
 *   a native IPC channel it does not have.
 * - **The native imports are dynamic.** `@tauri-apps/api` is loaded only after the
 *   marker is present, so a browser bundle never evaluates Tauri code and the desktop
 *   bundle never pulls in an HTTP-shaped fallback.
 */
import {
  createHttpBackendAdapter,
  createHttpBackendSession,
} from "@refyard/backend-http";
import {
  createTauriBackendAdapter,
  type NativePorts,
} from "@refyard/backend-tauri";
import { isBackendError } from "@refyard/git-service";
import type {
  BackendConnectOptions,
  BackendSession,
} from "@refyard/git-service";
import type { HttpBackendAdapterOptions } from "@refyard/backend-http";
import { connectXrossView, type XrossViewConnection } from "./xross.js";

export type BackendKind = "http" | "tauri";

export type BackendSurface = "default" | "xross";

export interface BackendRegistryOptions {
  readonly surface?: "default";
  /** Everything the HTTP adapter needs: address, fetch, and where the caller stores a bearer. */
  readonly http: HttpBackendAdapterOptions;
  /**
   * The service instance a remembered session was paired with, when the caller kept it.
   * Used only for a session adopted while that service is unreachable; never invented.
   */
  readonly rememberedInstanceId?: string | null;
  /** The surface to detect on. Defaults to `globalThis`; a test passes a fake. */
  readonly runtime?: unknown;
  /** Test seam for the native ports; production loads them from `@tauri-apps/api`. */
  readonly loadNativePorts?: () => Promise<NativePorts>;
}

export interface XrossRegistryOptions {
  /** Select the Xross-only entry explicitly; no HTTP options exist on this surface. */
  readonly surface: "xross";
  readonly runtime?: unknown;
  /** Test seam for the Xross facade; production reads only `xrossRefyardV1`. */
  readonly loadXrossHost?: () => Promise<unknown>;
}

export interface BackendRegistry {
  readonly kind: BackendKind;
  connect(options?: BackendConnectOptions): Promise<BackendSession>;
}

export interface XrossRegistry {
  readonly kind: "xross";
  connect(): Promise<XrossViewConnection>;
}

/**
 * True when this JavaScript context is a Tauri WebView.
 *
 * Accepts a value to inspect so the rule is testable without a WebView, and tolerates
 * any value including `undefined` — a detection helper that throws outside a browser
 * would break prerendering and unit tests.
 */
export function isNativeWebview(runtime: unknown = globalThis): boolean {
  if (typeof runtime !== "object" || runtime === null) {
    return false;
  }
  if (Reflect.get(runtime, "isTauri") === true) {
    return true;
  }
  return Reflect.has(runtime, "__TAURI_INTERNALS__");
}

export function createBackendRegistry(options: XrossRegistryOptions): XrossRegistry;
export function createBackendRegistry(options: BackendRegistryOptions): BackendRegistry;
export function createBackendRegistry(options: BackendRegistryOptions | XrossRegistryOptions): BackendRegistry | XrossRegistry {
  if (options.surface === "xross") {
    return {
      kind: "xross",
      connect() {
        const loadHost =
          options.loadXrossHost ??
          (() => Promise.resolve(Reflect.get(options.runtime ?? globalThis, "xrossRefyardV1")));
        return connectXrossView(loadHost);
      },
    };
  }
  if (!isNativeWebview(options.runtime)) {
    return createHttpRegistry(options);
  }
  return {
    kind: "tauri",
    async connect(connectOptions = {}) {
      const ports =
        options.loadNativePorts === undefined
          ? await loadTauriPorts()
          : await options.loadNativePorts();
      return createTauriBackendAdapter({ ports }).connect(connectOptions);
    },
  };
}

/**
 * A paired browser whose service is not answering is not the same thing as an unpaired
 * browser.
 *
 * `connect` proves a remembered bearer with a probe, which is what makes a stale token
 * fail on the pairing panel instead of inside the first panel the user opens. When that
 * probe fails for a reason other than the service *refusing* the token — the service is
 * stopped, the tunnel is down, the machine is asleep — the tab is still paired, so it
 * keeps a session: reads fail per panel with the transport's own problem, which is where
 * a user can see *which* reads failed, and the event stream reports no live updates. An
 * unpaired tab, or one whose bearer was refused, still gets the pairing panel.
 */
function createHttpRegistry(options: BackendRegistryOptions): BackendRegistry {
  const rememberedToken = options.http.initialToken ?? null;
  const adapter = createHttpBackendAdapter(options.http);
  return {
    kind: "http",
    async connect(connectOptions = {}) {
      try {
        return await adapter.connect(connectOptions);
      } catch (error) {
        if (
          rememberedToken === null ||
          connectOptions.ticket !== undefined ||
          connectOptions.password !== undefined ||
          (isBackendError(error) && error.isUnauthenticated())
        ) {
          throw error;
        }
        return createHttpBackendSession({
          baseUrl: options.http.baseUrl,
          fetch: options.http.fetch,
          token: () => rememberedToken,
          sessionId: null,
          serviceInstanceId: options.rememberedInstanceId ?? "unreachable",
          ...(options.http.backendLabel === undefined
            ? {}
            : { backendLabel: options.http.backendLabel }),
        });
      }
    },
  };
}

/** The Tauri IPC surface, shaped into the adapter's injected ports. */
async function loadTauriPorts(): Promise<NativePorts> {
  const [core, events, webview] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/webview"),
  ]);
  return {
    invoke: (command, args) => core.invoke(command, args),
    listen: async (name, handler) => {
      // The Tauri listener hands back an unlistener directly; the adapter's port type
      // is a promise, so the async wrapper is the whole translation.
      const unlisten = await events.listen(name, (event) =>
        handler({ payload: event.payload }),
      );
      return () => {
        unlisten();
      };
    },
    onDragDropPaths: async (handler) => {
      // The OS drag this webview sees, translated from Tauri's discriminated event.
      // A dropped folder arrives as a full path — the thing that makes "drop a
      // repository onto the window" possible on the desktop and impossible in a
      // browser, which is why this port is optional and browser callers omit it.
      return webview.getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          handler({ phase: "leave" });
          return;
        }
        // `over` names only the cursor position; the paths came with `enter` and
        // come again with `drop`, which is the one that opens.
        const paths = payload.type === "over" ? [] : payload.paths;
        handler({ phase: payload.type, paths });
      });
    },
  };
}
