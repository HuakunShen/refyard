/**
 * Package-level boundary configuration.
 *
 * The profiles below say which packages are "portable" (no host APIs) and what
 * each may import. They are separate from the detection engine so the engine can
 * be tested with synthetic sources and the package list can be tested against the
 * real workspace.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { listFiles, pathExists } from "./files.ts";
import {
  HOST_GLOBALS,
  HOST_MEMBER_ACCESS,
  checkPackageReachIn,
  checkSourceBoundaries,
  type BoundaryViolation,
  type PortabilityProfile,
} from "./boundaries.ts";

/**
 * Directories whose files belong to no package, so they get their code through
 * package names rather than paths.
 */
const UNPACKAGED_DIRECTORIES = ["tests", "scripts"] as const;

export interface PortablePackage {
  /** Workspace directory name, e.g. `git-core`. */
  readonly directory: string;
  /** Package name used in messages, e.g. `@refyard/git-core`. */
  readonly packageName: string;
  readonly allowedRuntimeImports: readonly string[];
  readonly allowedTypeOnlyImports: readonly string[];
}

/**
 * Portable packages and their allowed imports.
 *
 * `git-contract` may import Zod at runtime because it *is* the schema package and
 * Zod is host-agnostic. `git-core` and `git-graph` may not import anything at
 * runtime — only their own files — and may take the contract's types, which erase
 * at compile time. That asymmetry is the whole point: the contract can be rich
 * because nothing that must stay portable ever links against it.
 */
export const PORTABLE_PACKAGES: readonly PortablePackage[] = [
  {
    directory: "git-contract",
    packageName: "@refyard/git-contract",
    allowedRuntimeImports: ["zod"],
    allowedTypeOnlyImports: [],
  },
  {
    directory: "git-core",
    packageName: "@refyard/git-core",
    allowedRuntimeImports: [],
    allowedTypeOnlyImports: ["@refyard/git-contract"],
  },
  {
    directory: "git-graph",
    packageName: "@refyard/git-graph",
    allowedRuntimeImports: [],
    allowedTypeOnlyImports: ["@refyard/git-contract"],
  },
];

export function profileFor(
  pkg: PortablePackage,
  packagesRoot: string,
): PortabilityProfile {
  return {
    packageName: pkg.packageName,
    srcDir: join(packagesRoot, pkg.directory, "src"),
    allowedRuntimeImports: pkg.allowedRuntimeImports,
    allowedTypeOnlyImports: pkg.allowedTypeOnlyImports,
    bannedGlobals: HOST_GLOBALS,
    bannedMemberAccess: HOST_MEMBER_ACCESS,
    forbidDynamicImport: true,
  };
}

interface TsconfigShape {
  readonly compilerOptions?: Record<string, unknown>;
  readonly extends?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readTsconfig(path: string): Promise<TsconfigShape> {
  const text = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  const compilerOptions: unknown = Reflect.get(parsed, "compilerOptions");
  const extendsValue: unknown = Reflect.get(parsed, "extends");
  return {
    compilerOptions: isRecord(compilerOptions) ? compilerOptions : undefined,
    extends: typeof extendsValue === "string" ? extendsValue : undefined,
  };
}

/**
 * Effective `lib`/`types`/`strict` for a package's tsconfig, following `extends`.
 * A single level of inheritance is what this repository uses; a deeper chain
 * would still merge correctly because the walk is recursive.
 */
export async function effectiveTsconfig(
  path: string,
  visited: readonly string[] = [],
): Promise<Record<string, unknown>> {
  if (visited.includes(path)) {
    throw new Error(`tsconfig extends cycle at ${path}`);
  }
  const config = await readTsconfig(path);
  const inherited =
    config.extends === undefined
      ? {}
      : await effectiveTsconfig(resolve(dirname(path), config.extends), [
          ...visited,
          path,
        ]);
  return { ...inherited, ...(config.compilerOptions ?? {}) };
}

function sameArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

/**
 * The portable tsconfig contract: `lib: ["ES2022"]` and `types: []`.
 *
 * Without this, a stray `"types": ["node"]` in a package config would let Node
 * globals type-check even though the runtime check above would catch their use —
 * and the reverse: a `lib: ["DOM"]` would let `window` type-check. Both are
 * checked, because both directions are mistakes people make.
 */
export async function checkPortableTsconfig(
  pkg: PortablePackage,
  packagesRoot: string,
): Promise<BoundaryViolation[]> {
  const configPath = join(packagesRoot, pkg.directory, "tsconfig.json");
  const violations: BoundaryViolation[] = [];
  const effective = await effectiveTsconfig(configPath);
  const file = `${pkg.directory}/tsconfig.json`;
  const report = (rule: string, message: string): void => {
    violations.push({ file, line: 1, column: 1, rule, message });
  };
  if (!sameArray(effective["lib"], ["ES2022"])) {
    report(
      "tsconfig-lib",
      `effective lib must be exactly ["ES2022"], found ${JSON.stringify(effective["lib"])}`,
    );
  }
  if (!sameArray(effective["types"], [])) {
    report(
      "tsconfig-types",
      `effective types must be exactly [], found ${JSON.stringify(effective["types"])}`,
    );
  }
  if (effective["strict"] !== true) {
    report("tsconfig-strict", "effective strict must be true");
  }
  if (effective["noEmit"] !== true) {
    report(
      "tsconfig-noemit",
      "effective noEmit must be true (these packages are checked, not emitted)",
    );
  }
  return violations;
}

export interface BoundaryCheckResult {
  readonly violations: readonly BoundaryViolation[];
  readonly checkedFiles: number;
  readonly checkedPackages: number;
  /** Test and script files scanned for relative reach-ins into package sources. */
  readonly checkedUnpackagedFiles: number;
  /** Packages declared portable whose sources do not exist yet (reported, not hidden). */
  readonly skippedPackages: readonly string[];
}

/**
 * Check every portable package's sources and configuration.
 *
 * The same walk covers `tests/` and `scripts/`: those files live outside every
 * package, so nothing stops them from reaching into one by relative path, and the
 * check is what makes the package name the only way in.
 */
export async function runBoundaryCheck(
  packagesRoot: string,
): Promise<BoundaryCheckResult> {
  const violations: BoundaryViolation[] = [];
  const skippedPackages: string[] = [];
  let checkedFiles = 0;
  let checkedPackages = 0;
  for (const pkg of PORTABLE_PACKAGES) {
    const profile = profileFor(pkg, packagesRoot);
    if (!(await pathExists(profile.srcDir))) {
      skippedPackages.push(pkg.packageName);
      continue;
    }
    checkedPackages += 1;
    const files = await listFiles(profile.srcDir, [".ts"]);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      violations.push(...checkSourceBoundaries(profile, file, source));
      checkedFiles += 1;
    }
    violations.push(...(await checkPortableTsconfig(pkg, packagesRoot)));
  }

  const repoRoot = dirname(packagesRoot);
  let checkedUnpackagedFiles = 0;
  for (const directory of UNPACKAGED_DIRECTORIES) {
    const root = join(repoRoot, directory);
    if (!(await pathExists(root))) {
      continue;
    }
    for (const file of await listFiles(root, [".ts"])) {
      const source = await readFile(file, "utf8");
      violations.push(...checkPackageReachIn(repoRoot, file, source));
      checkedUnpackagedFiles += 1;
    }
  }

  return {
    violations,
    checkedFiles,
    checkedPackages,
    checkedUnpackagedFiles,
    skippedPackages,
  };
}
