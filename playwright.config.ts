/**
 * Playwright configuration for the read-only end-to-end run.
 *
 * One worker, no parallelism: each spec starts a real service against a temporary
 * repository with its own `HOME`, and two services racing for the same port would make a
 * failure impossible to attribute.
 *
 * The browsers are the ones Playwright manages — Chromium, Firefox and WebKit — not system
 * browsers, so the run is reproducible on a machine that has never opened any of them. What
 * it exercises is real: the shipped static bundle, served by the shipped Node host, talking
 * to the machine's own `git` through the same code path a user runs.
 *
 * Three engines because that is where the unverified rows were: service-worker behaviour,
 * storage, CSS layout and the CSP are exactly where engines differ, and a difference here
 * is a finding about the product (recorded in `docs/browser-support.md`), not a nuisance to
 * be silenced. An engine that fails is never skipped.
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
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
