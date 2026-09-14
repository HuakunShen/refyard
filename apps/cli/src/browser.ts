/**
 * The trusted OS adapter for opening a browser.
 *
 * One rule decides this whole file: the URL is produced by this program, and it is
 * passed as a **single argv element to an executable chosen by this program** — no
 * shell, no string interpolation, no `exec` of user text. On macOS the launcher is
 * `/usr/bin/open`, on Linux `xdg-open`, on Windows `rundll32 url.dll,FileProtocolHandler`;
 * each receives the URL as its own argument and nothing else.
 *
 * The URL itself is checked before it is handed over: it must be an `http://` URL on
 * a loopback authority. That keeps the pairing URL — the only URL here that carries
 * a secret — from being redirected to another host by a typo in a configuration
 * value, which is exactly the case a "just open whatever we were given" helper
 * would miss.
 *
 * Opening is best effort: a headless machine has no browser, and the caller has
 * already printed the URL, so a failure to launch is reported and does not stop the
 * service.
 */
import { spawn } from "node:child_process";

export interface BrowserCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export type OpenResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The command that opens one URL on this platform.
 *
 * Exported so a test can assert the argv shape without launching anything: the
 * arrangement being verified is "one URL, one argument", not "a browser appeared".
 */
export function browserCommandFor(
  url: string,
  platform: NodeJS.Platform,
): BrowserCommand | null {
  if (platform === "darwin") {
    return { executable: "/usr/bin/open", args: [url] };
  }
  if (platform === "win32") {
    return {
      executable: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  if (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    return { executable: "xdg-open", args: [url] };
  }
  return null;
}

/** True when a URL is a loopback http URL this service could have produced. */
export function isLoopbackHttpUrl(text: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") {
    return false;
  }
  return (
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "::1"
  );
}

export async function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<OpenResult> {
  if (!isLoopbackHttpUrl(url)) {
    return {
      ok: false,
      reason: "refusing to open a URL that is not a loopback http URL",
    };
  }
  const command = browserCommandFor(url, platform);
  if (command === null) {
    return {
      ok: false,
      reason: `no browser launcher is known for ${platform}`,
    };
  }
  return new Promise<OpenResult>((resolve) => {
    try {
      const child = spawn(command.executable, [...command.args], {
        stdio: "ignore",
        shell: false,
        detached: true,
        windowsHide: true,
      });
      child.on("error", (error: Error) => {
        resolve({ ok: false, reason: error.message });
      });
      child.on("spawn", () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "the launcher could not be started",
      });
    }
  });
}
