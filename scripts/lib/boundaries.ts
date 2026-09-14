/**
 * The portability boundary checker.
 *
 * `packages/git-core` and `packages/git-graph` are the code that must survive a
 * future move to another host (QuickJS, JavaScriptCore, a native bridge). That
 * claim is only worth something if it is enforced mechanically, so this module
 * parses each production source file with a real TypeScript parser and reports:
 *
 * 1. **Imports.** No `node:*`, no host packages, no runtime import of the Zod
 *    contract (its *types* are fine — they erase). Relative imports must stay
 *    inside the package and use `.js` specifiers, or the built output is broken
 *    for Node even when the tests pass.
 * 2. **Globals.** `Buffer`, `process`, `fetch`, `TextDecoder`, timers, `console`,
 *    `Intl` and friends are host capabilities, not ECMAScript. `Date.now()` and
 *    `Math.random()` are host *reads* — core code receives time and randomness
 *    through a port instead.
 * 3. **Dynamic imports**, which would hide a dependency from checks like these.
 *
 * Detection is AST-based rather than textual: `// uses Buffer` in a comment,
 * `'Buffer'` in a string, and `obj.process` as a property name are all allowed.
 * The engine is exported separately from the file walker so tests can feed it
 * synthetic sources and prove each rule fires (and each near-miss does not).
 */
import { dirname, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { isInside } from "./files.ts";

export interface BoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
}

export interface PortabilityProfile {
  /** Display name of the package being checked. */
  readonly packageName: string;
  /** Absolute path of the package's `src` directory. */
  readonly srcDir: string;
  /** Bare specifiers that may be imported for their runtime value. */
  readonly allowedRuntimeImports: readonly string[];
  /** Bare specifiers that may be imported with `import type` only. */
  readonly allowedTypeOnlyImports: readonly string[];
  /** Host globals that must not appear as identifier references. */
  readonly bannedGlobals: readonly string[];
  /** `object.property` pairs that read the host (e.g. `Date.now`). */
  readonly bannedMemberAccess: readonly string[];
  /** Whether dynamic `import()` is a violation. */
  readonly forbidDynamicImport: boolean;
}

/** Globals that exist only because a host put them there. */
export const HOST_GLOBALS: readonly string[] = [
  // Node
  "Buffer",
  "process",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "global",
  "setImmediate",
  "clearImmediate",
  // Bun / Deno
  "Bun",
  "Deno",
  // Browser
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "XMLHttpRequest",
  "WebSocket",
  "alert",
  "confirm",
  "prompt",
  // Universal host plumbing
  "globalThis",
  "self",
  "console",
  "fetch",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "structuredClone",
  "atob",
  "btoa",
  "crypto",
  "performance",
  "Intl",
  "eval",
];

/** Host reads that are legal syntax but not legal in portable core. */
export const HOST_MEMBER_ACCESS: readonly string[] = [
  "Date.now",
  "Math.random",
  "crypto.getRandomValues",
];

/** Minimal structural view of an AST node: whatever the parser produced. */
interface AstNode {
  readonly type: string;
}

/** Keys that never contain structure worth visiting. */
const SKIPPED_KEYS = new Set([
  "loc",
  "range",
  "start",
  "end",
  "raw",
  "comments",
  "tokens",
]);

function isAstNode(value: unknown): value is AstNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type: unknown = Reflect.get(value, "type");
  return typeof type === "string";
}

/** Read one property off a foreign AST node without asserting its type. */
function read(node: AstNode, key: string): unknown {
  return Reflect.get(node, key);
}

function readString(node: AstNode, key: string): string | null {
  const value = read(node, key);
  return typeof value === "string" ? value : null;
}

function readNode(node: AstNode, key: string): AstNode | null {
  const value = read(node, key);
  return isAstNode(value) ? value : null;
}

function childrenOf(node: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    const value = read(node, key);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) {
          children.push(item);
        }
      }
    } else if (isAstNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionOf(
  starts: readonly number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const start = starts[mid];
    if (start !== undefined && start <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const start = starts[low] ?? 0;
  return { line: low + 1, column: offset - start + 1 };
}

function offsetOf(node: AstNode): number {
  const start = read(node, "start");
  return typeof start === "number" ? start : 0;
}

/** Parent node types whose `key` is a type member name, not a value reference. */
const TYPE_MEMBER_PARENTS = new Set([
  "TSPropertySignature",
  "TSMethodSignature",
]);
/** Grandparent node types whose `Property` keys are inert. */
const INERT_KEY_GRANDPARENTS = new Set([
  "ObjectExpression",
  "TSTypeLiteral",
  "TSInterfaceBody",
]);

/**
 * Identifier positions that are property names or labels, not references.
 *
 * The grandparent is needed for `Property`: `{ process: 1 }` names a key, while
 * `const { process } = x` binds a value and shadows the host global.
 */
function isNonReferenceIdentifier(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
): boolean {
  if (parent === undefined) {
    return false;
  }
  const computed = read(parent, "computed") === true;
  if (TYPE_MEMBER_PARENTS.has(parent.type)) {
    return !computed && readNode(parent, "key") === node;
  }
  switch (parent.type) {
    case "MemberExpression":
      return !computed && readNode(parent, "property") === node;
    case "Property":
      return (
        !computed &&
        readNode(parent, "key") === node &&
        grandparent !== undefined &&
        INERT_KEY_GRANDPARENTS.has(grandparent.type)
      );
    case "MethodDefinition":
    case "PropertyDefinition":
      return !computed && readNode(parent, "key") === node;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return true;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return readNode(parent, "label") === node;
    case "TSQualifiedName":
      return true;
    case "TSTypeParameter":
      return readNode(parent, "name") === node;
    default:
      return false;
  }
}

/**
 * Import entries are parser records, not AST nodes: they carry no `type` field,
 * only the imported/local names and a per-specifier `isType` flag. Reading
 * `isType` off the node shape instead would report every `import type` as a
 * runtime import.
 */
function isTypeOnlyImportEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  return Reflect.get(entry, "isType") === true;
}

/**
 * Check one source string against a profile.
 *
 * Only path arithmetic touches the filesystem (for relative-import containment),
 * so tests can pass synthetic file names and sources.
 */
export function checkSourceBoundaries(
  profile: PortabilityProfile,
  file: string,
  source: string,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const starts = lineStarts(source);
  const report = (offset: number, rule: string, message: string): void => {
    const { line, column } = positionOf(starts, offset);
    violations.push({ file, line, column, rule, message });
  };

  const parsed = parseSync(file, source);
  const firstError = parsed.errors[0];
  if (firstError !== undefined) {
    report(
      0,
      "parse-error",
      `file could not be parsed: ${String(firstError.message)}`,
    );
    return violations;
  }

  // 1. Static imports.
  for (const record of parsed.module.staticImports) {
    const specifier = record.moduleRequest.value;
    const entries: unknown[] = [...record.entries];
    const typeOnly = entries.length > 0 && entries.every(isTypeOnlyImportEntry);
    if (specifier.startsWith(".")) {
      if (!specifier.endsWith(".js")) {
        report(
          record.moduleRequest.start,
          "relative-extension",
          `relative import '${specifier}' must end in .js so the compiled ESM output resolves`,
        );
      }
      const target = resolve(dirname(file), specifier);
      if (!isInside(profile.srcDir, target)) {
        report(
          record.moduleRequest.start,
          "relative-escape",
          `relative import '${specifier}' leaves ${profile.packageName}/src`,
        );
      }
      continue;
    }
    if (typeOnly) {
      // A type-only import erases at compile time, so it is strictly weaker than a
      // runtime import: anything allowed for its value is allowed for its types.
      const allowed =
        profile.allowedTypeOnlyImports.includes(specifier) ||
        profile.allowedRuntimeImports.includes(specifier);
      if (!allowed) {
        report(
          record.moduleRequest.start,
          "type-only-import",
          `type-only import of '${specifier}' is not on the allow list for ${profile.packageName}`,
        );
      }
      continue;
    }
    if (!profile.allowedRuntimeImports.includes(specifier)) {
      report(
        record.moduleRequest.start,
        "runtime-import",
        `runtime import of '${specifier}' is not available in portable ${profile.packageName}`,
      );
    }
  }

  // 2. Dynamic imports.
  if (profile.forbidDynamicImport) {
    for (const record of parsed.module.dynamicImports) {
      report(
        record.start,
        "dynamic-import",
        "dynamic import hides a dependency from the boundary check; import it statically instead",
      );
    }
  }

  // 3. Globals and host reads, over the whole AST.
  const bannedGlobals = new Set(profile.bannedGlobals);
  const bannedMembers = new Set(profile.bannedMemberAccess);
  const visit = (
    node: AstNode,
    parent: AstNode | undefined,
    grandparent: AstNode | undefined,
  ): void => {
    if (node.type === "Identifier") {
      const name = readString(node, "name");
      if (
        name !== null &&
        bannedGlobals.has(name) &&
        !isNonReferenceIdentifier(node, parent, grandparent)
      ) {
        report(
          offsetOf(node),
          "host-global",
          `'${name}' is a host global; portable code receives it through a port`,
        );
      }
    } else if (
      node.type === "MemberExpression" &&
      read(node, "computed") !== true
    ) {
      const object = readNode(node, "object");
      const property = readNode(node, "property");
      if (object?.type === "Identifier" && property?.type === "Identifier") {
        const memberPath = `${readString(object, "name")}.${readString(property, "name")}`;
        if (bannedMembers.has(memberPath)) {
          report(
            offsetOf(node),
            "host-read",
            `'${memberPath}' reads the host; take it from a port instead`,
          );
        }
      }
    }
    for (const child of childrenOf(node)) {
      visit(child, node, parent);
    }
  };
  if (isAstNode(parsed.program)) {
    visit(parsed.program, undefined, undefined);
  }

  // A shorthand property in a destructuring pattern yields one Identifier object
  // in both the key and the value slot, and a nested visitor can reach the same
  // node by two paths. Same position plus same rule is one finding.
  const seen = new Set<string>();
  const unique = violations.filter((violation) => {
    const key = `${violation.line}:${violation.column}:${violation.rule}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => a.line - b.line || a.column - b.column);
}
