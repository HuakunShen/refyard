/** Browser QA of the separately built static docs/showcase output. */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/site",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4321",
    launchOptions: process.env.REFYARD_BROWSER_BIN
      ? { executablePath: process.env.REFYARD_BROWSER_BIN }
      : {},
  },
  webServer: {
    command: "python3 -m http.server 4321 --bind 127.0.0.1 --directory apps/docs/dist",
    url: "http://127.0.0.1:4321/demo/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
