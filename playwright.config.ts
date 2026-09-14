/**
 * Playwright configuration for the read-only end-to-end run.
 *
 * One worker, no parallelism: each spec starts a real service against a temporary
 * repository with its own `HOME`, and two services racing for the same port would make a
 * failure impossible to attribute.
 *
 * The browser is the one Playwright manages (Chromium), not a system browser, so the run
 * is reproducible on a machine that has never opened Chrome. What it exercises is real:
 * the shipped static bundle, served by the shipped Node host, talking to the machine's own
 * `git` through the same code path a user runs.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
