/**
 * Root Vitest configuration: one runner for contract, core, node and integration
 * suites. Suites are separated by directory so `pnpm test:unit` and
 * `pnpm test:integration` can run independently, while `pnpm test` runs
 * everything. All suites run against real temporary Git repositories; nothing
 * here touches a user's repository.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Git subprocesses and HTTP fixtures are slower than pure unit work, and a
    // test that waits 5 s for a spawn is a bug report, not a timeout to raise.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // A flaky test is a bug report against the product, so retries stay at 0 and
    // integration files that share a machine's Git process budget run serially.
    retry: 0,
    reporters: process.env.CI ? ["dot"] : ["default"],
  },
});
