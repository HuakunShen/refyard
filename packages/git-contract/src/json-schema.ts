/**
 * JSON Schema generation for the public contract.
 *
 * The Zod schemas are the source of truth; these artifacts are derived and
 * committed so that a change to the contract shows up as a reviewable diff, and
 * so a consumer outside TypeScript (a future Rust client, a docs page) can read
 * the same shapes. `scripts/check-contract.ts` regenerates them and fails when the
 * committed copies differ.
 *
 * Generation is deterministic: schemas come from a fixed registry, keys are
 * sorted, and the output is pretty-printed with a trailing newline.
 */
import { z } from "zod";
import { MUTATION_KINDS, OPERATION_TARGET_LIST } from "./operations.js";
import { CONTRACT_SCHEMAS, operationSchemaId } from "./registry.js";
import { API_MAJOR, CONTRACT_VERSION } from "./version.js";

export interface ContractArtifact {
  /** Path relative to the repository root. */
  readonly path: string;
  readonly contents: string;
}

const bundleId = `https://refyard.invalid/contract/${CONTRACT_VERSION}/contract.schema.json`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Generate every named schema into one `$defs` table.
 *
 * This is deliberately a *single* `z.toJSONSchema` call over a wrapper object:
 * Zod assigns `$defs` names per call, so generating each schema separately would
 * produce call-local names (`__schema3`) that collide and refs that dangle. One
 * call means one consistent document, and the wrapper's own `properties` are
 * dropped because every named schema already appears in `$defs` by its metadata
 * id.
 */
function buildDefinitions(): Record<string, unknown> {
  const wrapperShape: Record<string, z.ZodType> = {};
  for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
    wrapperShape[name] = schema;
  }
  const generated: unknown = z.toJSONSchema(z.object(wrapperShape), {
    target: "draft-2020-12",
    reused: "ref",
  });
  if (!isRecord(generated)) {
    throw new Error("z.toJSONSchema returned a non-object");
  }
  const definitions = generated["$defs"];
  if (!isRecord(definitions)) {
    throw new Error("generated schema has no $defs table");
  }
  for (const name of Object.keys(CONTRACT_SCHEMAS)) {
    if (!(name in definitions)) {
      throw new Error(
        `schema ${name} did not appear in the generated $defs table`,
      );
    }
  }
  const sorted: Record<string, unknown> = {};
  for (const name of Object.keys(definitions).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    sorted[name] = definitions[name];
  }
  return sorted;
}

/** The full contract as one draft-2020-12 document with every name in `$defs`. */
export function buildContractSchemaBundle(): string {
  const bundle = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: bundleId,
    title: "Refyard GitService contract",
    description:
      "Generated from packages/git-contract by `pnpm check:contract`. Schemas are JSON-Schema exports of the Zod schemas; request validation is authoritative in the Zod source, and its semantic rules (branch-name grammar, URL schemes, path containment) are intentionally not expressible here.",
    "x-api-major": API_MAJOR,
    "x-contract-version": CONTRACT_VERSION,
    $defs: buildDefinitions(),
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** One entry per operation: its kind, allowed targets, and payload schema name. */
export function buildOperationIndex(): string {
  const index = {
    apiMajor: API_MAJOR,
    contractVersion: CONTRACT_VERSION,
    operations: OPERATION_TARGET_LIST.map(([kind, targets]) => ({
      kind,
      targets: [...targets],
      payloadSchema: operationSchemaId(kind),
    })),
    count: MUTATION_KINDS.length,
  };
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Every artifact this repository commits, in write order. */
export function buildContractArtifacts(): readonly ContractArtifact[] {
  return [
    {
      path: "packages/git-contract/generated/contract.schema.json",
      contents: buildContractSchemaBundle(),
    },
    {
      path: "packages/git-contract/generated/operations.json",
      contents: buildOperationIndex(),
    },
  ];
}
