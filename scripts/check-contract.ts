#!/usr/bin/env bun
/**
 * `pnpm check:contract` — prove the committed contract artifacts match the source.
 *
 * Three checks, in order of how early they catch a mistake:
 * 1. Every named schema converts to JSON Schema at all (a `transform` or a `Date`
 *    would fail here rather than silently producing a lossy artifact).
 * 2. Every `$ref` in the generated bundle resolves inside the same document.
 * 3. The committed files are byte-identical to a fresh generation, so editing the
 *    schemas without regenerating fails the build instead of shipping a contract
 *    that no longer describes the service.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContractArtifacts } from "@refyard/git-contract/json-schema";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures: string[] = [];

for (const artifact of buildContractArtifacts()) {
  const target = resolve(repoRoot, artifact.path);
  let committed: string;
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    failures.push(
      `${artifact.path} is missing — run \`bun scripts/generate-schema.ts\``,
    );
    continue;
  }
  if (committed !== artifact.contents) {
    failures.push(
      `${artifact.path} is out of date — run \`bun scripts/generate-schema.ts\``,
    );
  }
}

const bundleArtifact = buildContractArtifacts()[0];
let definitionCount = 0;
if (bundleArtifact !== undefined) {
  const bundle: unknown = JSON.parse(bundleArtifact.contents);
  if (typeof bundle !== "object" || bundle === null) {
    failures.push("generated bundle is not a JSON object");
  } else {
    const definitions: unknown = Reflect.get(bundle, "$defs");
    if (typeof definitions !== "object" || definitions === null) {
      failures.push("generated bundle has no $defs");
    } else {
      const names = new Set(Object.keys(definitions));
      definitionCount = names.size;
      const refs = new Set<string>();
      collectRefs(bundle, refs);
      for (const ref of refs) {
        if (!ref.startsWith("#/$defs/")) {
          failures.push(`$ref '${ref}' is not a local $defs pointer`);
          continue;
        }
        const name = ref.slice("#/$defs/".length);
        if (!names.has(name)) {
          failures.push(`$ref '${ref}' does not resolve to a definition`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error("check:contract: failed\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `check:contract: artifacts match the schemas, every $ref resolves (${definitionCount} named schemas)`,
);
process.exit(0);

/** Recursively collect `$ref` strings from a parsed JSON value. */
function collectRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, refs);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      refs.add(child);
      continue;
    }
    collectRefs(child, refs);
  }
}
