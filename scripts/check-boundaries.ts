#!/usr/bin/env bun
/**
 * `pnpm check:boundaries` — enforce the portable-core claim.
 *
 * Fails when a portable package imports a host module, touches a host global or
 * host read, hides a dependency behind a dynamic import, leaves its own `src` via
 * a relative import, or ships a tsconfig that would let a host API type-check.
 *
 * Exits non-zero with `file:line:column` so an editor can jump to the violation.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundaryCheck } from "./lib/package-boundaries.ts";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const result = await runBoundaryCheck(resolve(repoRoot, "packages"));

if (result.violations.length === 0) {
  console.log(
    `check:boundaries: ${result.checkedPackages} portable packages, ${result.checkedFiles} source files — no host dependencies; ` +
      `${result.checkedUnpackagedFiles} test/script files — packages imported by name`,
  );
  process.exit(0);
}

console.error(`check:boundaries: ${result.violations.length} violation(s)\n`);
for (const violation of result.violations) {
  const path = violation.file.startsWith(repoRoot)
    ? violation.file.slice(repoRoot.length + 1)
    : violation.file;
  console.error(
    `${path}:${violation.line}:${violation.column}  [${violation.rule}] ${violation.message}`,
  );
}
console.error(
  "\nHint: portable packages are packages/git-contract, packages/git-core and packages/git-graph." +
    " Host APIs belong in packages/host-node behind a port." +
    " Tests and scripts import a package by name (`@refyard/<package>/<module>`)," +
    " never through a relative path into its `src`.",
);
process.exit(1);
