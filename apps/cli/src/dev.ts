/** Development coordinator: start an empty authenticated host for the launcher UI. */
import { resolveGitPath } from "./git-path.js";
import { openInBrowser } from "./browser.js";
import { runService } from "./serve.js";
import { DEFAULT_TICKET_TTL_SECONDS } from "./args.js";

const uiOrigin =
  process.env["REFYARD_DEV_UI_ORIGIN"] ?? "http://127.0.0.1:5173";
const apiOrigin =
  process.env["REFYARD_DEV_API_ORIGIN"] ?? "http://127.0.0.1:9595";
const apiPort = portFromOrigin(apiOrigin);
const service = await runService({
  repositoryPaths: [],
  allowEmpty: true,
  gitPath: resolveGitPath(),
  port: apiPort,
  portExplicit: false,
  openBrowser: false,
  ticketTtlSeconds: DEFAULT_TICKET_TTL_SECONDS,
  uiOrigin,
  apiOrigin,
  allowedOrigins: [uiOrigin],
  allowRoot: false,
  write: (line) => process.stdout.write(`[refyard dev] ${line}\n`),
  writeError: (line) => process.stderr.write(`[refyard dev] ${line}\n`),
});

const pairingUrl = service.pairingUrl;
process.stdout.write(`[refyard dev] launcher: ${pairingUrl}\n`);
await waitForUi(uiOrigin);
const opened = await openInBrowser(pairingUrl);
if (!opened.ok) {
  process.stdout.write(`[refyard dev] open this URL: ${pairingUrl}\n`);
}

const close = (): void => {
  void service.close().finally(() => process.exit(0));
};
process.once("SIGINT", close);
process.once("SIGTERM", close);

async function waitForUi(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function portFromOrigin(origin: string): number {
  const parsed = new URL(origin);
  const port = parsed.port.length > 0 ? Number.parseInt(parsed.port, 10) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid REFYARD_DEV_API_ORIGIN port: ${origin}`);
  }
  return port;
}
