/**
 * Tests for the portability boundary checker.
 *
 * The checker is what makes "Git core does not depend on a host" a fact rather
 * than an intention, so it is tested from both sides: every banned construct must
 * be reported, and every near-miss that merely *looks* like one (a comment, a
 * string, a property name) must not be. A checker with false positives gets
 * disabled by the next person in a hurry, which is the same as not having one.
 */
import { describe, expect, it } from "vitest";
import {
  HOST_GLOBALS,
  HOST_MEMBER_ACCESS,
  checkSourceBoundaries,
  type BoundaryViolation,
  type PortabilityProfile,
} from "../../scripts/lib/boundaries.ts";

const PROFILE: PortabilityProfile = {
  packageName: "@refyard/git-core",
  srcDir: "/repo/packages/git-core/src",
  allowedRuntimeImports: [],
  allowedTypeOnlyImports: ["@refyard/git-contract"],
  bannedGlobals: HOST_GLOBALS,
  bannedMemberAccess: HOST_MEMBER_ACCESS,
  forbidDynamicImport: true,
};

function check(
  source: string,
  file = "/repo/packages/git-core/src/sample.ts",
): BoundaryViolation[] {
  return checkSourceBoundaries(PROFILE, file, source);
}

function rules(source: string): string[] {
  return check(source).map((violation) => violation.rule);
}

describe("the boundary checker, on imports", () => {
  it("rejects a Node module import even when it is imported for one function", () => {
    expect(
      rules(
        `import { spawn } from 'node:child_process';\nexport const run = spawn;`,
      ),
    ).toEqual(["runtime-import"]);
  });

  it("rejects a runtime import of the Zod contract, because it would link Zod into core", () => {
    expect(
      rules(
        `import { MutationRequestSchema } from '@refyard/git-contract';\nexport const s = MutationRequestSchema;`,
      ),
    ).toEqual(["runtime-import"]);
  });

  it("allows a type-only import of a package that is allowed at runtime", () => {
    // Zod is a runtime dependency of the contract package, so `import type` of it
    // must not be reported: types erase, and the runtime rule is the stronger one.
    const contractProfile: PortabilityProfile = {
      ...PROFILE,
      packageName: "@refyard/git-contract",
      allowedRuntimeImports: ["zod"],
      allowedTypeOnlyImports: [],
    };
    expect(
      checkSourceBoundaries(
        contractProfile,
        "/repo/packages/git-contract/src/sample.ts",
        `import type { z } from "zod";\nexport type T = z.ZodType;`,
      ).map((violation) => violation.rule),
    ).toEqual([]);
    // A package that is allowed for neither still fails, type-only or not.
    expect(
      checkSourceBoundaries(
        contractProfile,
        "/repo/packages/git-contract/src/sample.ts",
        `import type { x } from "some-unknown-package";\nexport type T = x;`,
      ).map((violation) => violation.rule),
    ).toEqual(["type-only-import"]);
  });

  it("allows the contract as a type-only import, which erases at compile time", () => {
    expect(
      rules(
        `import type { StatusSnapshot } from '@refyard/git-contract';\nexport type S = StatusSnapshot;`,
      ),
    ).toEqual([]);
  });

  it("allows a mixed import whose value is used — and reports it, because it is a runtime import", () => {
    // `import { type A, b }` is a runtime import: b is used. The rule must apply
    // to the statement, and the two entries must not be averaged into "type-only".
    expect(
      rules(
        `import { type StatusSnapshot, problemSchema } from '@refyard/git-contract';\nexport type S = StatusSnapshot;\nexport const p = problemSchema;`,
      ),
    ).toEqual(["runtime-import"]);
  });

  it("rejects a relative import without the .js extension that compiled ESM needs", () => {
    expect(
      rules(
        `import { parseStatus } from './parse/status';\nexport const p = parseStatus;`,
      ),
    ).toEqual(["relative-extension"]);
  });

  it("rejects a relative import that escapes the package source directory", () => {
    expect(
      rules(
        `import { something } from '../../host-node/src/process.ts.js';\nexport const s = something;`,
      ),
    ).toEqual(["relative-escape"]);
  });

  it("rejects a dynamic import, which would hide a dependency from this check", () => {
    expect(
      rules(
        `export async function load() {\n  return import('./parse/status.js');\n}`,
      ),
    ).toEqual(["dynamic-import"]);
  });

  it("allows relative imports inside the package", () => {
    expect(
      rules(
        `import { parseStatus } from './parse/status.js';\nexport const p = parseStatus;`,
      ),
    ).toEqual([]);
  });
});

describe("the boundary checker, on globals", () => {
  it("reports a host global used as a value", () => {
    expect(rules(`export const size = Buffer.byteLength('x');`)).toEqual([
      "host-global",
    ]);
  });

  it("reports a plain call to a host function", () => {
    expect(
      rules(`export function later(work: () => void) { setTimeout(work, 0); }`),
    ).toEqual(["host-global"]);
  });

  it("reports TextEncoder, which core must take from the text codec port", () => {
    expect(rules(`export const enc = new TextEncoder();`)).toEqual([
      "host-global",
    ]);
  });

  it("reports a host global used only as a type", () => {
    expect(
      rules(`export function f(x: Buffer): number { return x.length; }`),
    ).toEqual(["host-global"]);
  });

  it("ignores a host name in a comment", () => {
    expect(
      rules(
        `// Buffer and process belong to the host\nexport const answer = 42;`,
      ),
    ).toEqual([]);
  });

  it("ignores a host name inside a string", () => {
    expect(
      rules(`export const message = 'Buffer is not available here';`),
    ).toEqual([]);
  });

  it("ignores a property that merely shares a host name", () => {
    expect(
      rules(
        `export function read(config: { process: string }): string { return config.process; }`,
      ),
    ).toEqual([]);
  });

  it("ignores an object literal key but reports a destructuring binding and its later use", () => {
    expect(rules(`export const shaped = { process: 'value' };`)).toEqual([]);
    // One finding per position: the shorthand binding is key and value at the same
    // column (reported once), and the later `process` reference is a second line.
    const violations = check(
      `export function unwrap(source: { process: unknown }) {\n  const { process } = source;\n  return process;\n}`,
    );
    expect(violations.map((violation) => violation.rule)).toEqual([
      "host-global",
      "host-global",
    ]);
    expect(violations.map((violation) => violation.line)).toEqual([2, 3]);
  });
});

describe("the boundary checker, on host reads", () => {
  it("reports Date.now() but allows constructing a Date from a known instant", () => {
    expect(rules(`export const now = Date.now();`)).toEqual(["host-read"]);
    expect(rules(`export const stamp = new Date(0).toISOString();`)).toEqual(
      [],
    );
  });

  it("reports Math.random() while allowing the rest of Math", () => {
    expect(rules(`export const jitter = Math.random();`)).toEqual([
      "host-read",
    ]);
    expect(rules(`export const biggest = Math.max(1, 2);`)).toEqual([]);
  });

  it("allows JSON, which is ECMAScript and not a host capability", () => {
    expect(rules(`export const parsed: unknown = JSON.parse('{}');`)).toEqual(
      [],
    );
  });
});

describe("the boundary checker, on output shape", () => {
  it("reports a parse failure instead of passing the file", () => {
    const violations = check(`export const broken = ;`);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("parse-error");
  });

  it("reports one-based line and column so an editor can jump to the problem", () => {
    const violations = check(
      `export const fine = 1;\nexport const bad = process.pid;`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.column).toBe(20);
  });

  it("reports every violation in a file, not just the first", () => {
    const violations = check(
      `export const a = Buffer.byteLength('x');\nexport const b = Date.now();`,
    );
    expect(violations.map((violation) => violation.rule)).toEqual([
      "host-global",
      "host-read",
    ]);
  });
});
