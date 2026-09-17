/** Coordinate the local Vite UI and empty repository launcher on one chosen port pair. */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const uiPort = await freePort();
const apiPort = await freePort();
const env = {
  ...process.env,
  REFYARD_DEV_UI_ORIGIN: `http://127.0.0.1:${uiPort}`,
  REFYARD_DEV_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
};
const children: ChildProcess[] = [];

children.push(
  spawn(
    "pnpm",
    [
      "--dir",
      "apps/web",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(uiPort),
    ],
    {
      env,
      stdio: "inherit",
    },
  ),
);
children.push(spawn("bun", ["apps/cli/src/dev.ts"], { env, stdio: "inherit" }));

let shuttingDown = false;
function stop(): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await Promise.race(
  children.map(
    (child) =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      }),
  ),
);
stop();

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("the dev coordinator could not choose a UI port");
  }
  const port = address.port;
  await closeServer(server);
  return port;
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
