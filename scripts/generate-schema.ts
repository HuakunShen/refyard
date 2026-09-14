#!/usr/bin/env bun
/**
 * `bun scripts/generate-schema.ts` — write the derived contract artifacts.
 *
 * `pnpm check:contract` runs the same generation in memory and compares, so this
 * command is only needed after intentionally changing the contract.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContractArtifacts } from "@refyard/git-contract/json-schema";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

for (const artifact of buildContractArtifacts()) {
  const target = resolve(repoRoot, artifact.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, artifact.contents, "utf8");
  console.log(`wrote ${artifact.path} (${artifact.contents.length} bytes)`);
}
