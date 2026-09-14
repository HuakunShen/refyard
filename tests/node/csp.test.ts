/**
 * The document's own inline scripts, allowed by hash.
 *
 * Two failures are being prevented, and they pull in opposite directions:
 *
 * - a static single-page app that cannot boot because its inline bootstrap script is
 *   blocked by the service's own CSP (`script-src 'self'`);
 * - an "easy fix" for that, `script-src 'self' 'unsafe-inline'`, which would also allow
 *   every script an injected payload could add.
 *
 * These cases pin the narrow version: the hash of the script actually being served, and
 * nothing else. The end-to-end proof that a real browser accepts it is the Playwright run
 * (`pnpm test:e2e`), which fails at the first assertion if the shell does not boot.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  inlineScriptHashes,
  policyWithInlineScripts,
} from "@refyard/host-node";

/** The policy the asset server ships with, minus the hashes this module adds. */
const BASE_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'";

describe("inlineScriptHashes", () => {
  it("hashes an inline script the way CSP specifies", () => {
    const body = "\n  console.log('boot');\n";
    const expected = createHash("sha256").update(body, "utf8").digest("base64");
    expect(inlineScriptHashes(`<script>${body}</script>`)).toEqual([
      `'sha256-${expected}'`,
    ]);
  });

  it("ignores a script with a src attribute", () => {
    // An external script is already covered by `'self'`; hashing it would add a second,
    // meaningless permission.
    expect(
      inlineScriptHashes('<script src="/_app/start.js"></script>'),
    ).toEqual([]);
    expect(
      inlineScriptHashes('<script type="module" src="./a.js"></script>'),
    ).toEqual([]);
  });

  it("finds every inline script in a document, including one with attributes", () => {
    const html = [
      '<script type="module" src="/a.js"></script>',
      "<script>window.a = 1;</script>",
      '<script type="application/json">{"b":2}</script>',
      "<script>\n\twindow.c = 3;\n</script>",
    ].join("\n");
    expect(inlineScriptHashes(html)).toHaveLength(3);
  });

  it("treats an empty script as nothing to allow", () => {
    expect(inlineScriptHashes("<script></script>")).toEqual([]);
    expect(inlineScriptHashes("<script>   \n  </script>")).toEqual([]);
  });

  it("returns nothing for a document with no scripts at all", () => {
    expect(inlineScriptHashes("<html><body>hello</body></html>")).toEqual([]);
  });
});

describe("policyWithInlineScripts", () => {
  it("appends the hashes to script-src and leaves the rest of the policy alone", () => {
    const policy = policyWithInlineScripts(BASE_POLICY, [
      "'sha256-AAA='",
      "'sha256-BBB='",
    ]);
    expect(policy).toContain("script-src 'self' 'sha256-AAA=' 'sha256-BBB=';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
  });

  it("never introduces 'unsafe-inline' into script-src", () => {
    // The whole point of hashing: a document that contains an inline script must not be
    // served a policy that permits inline scripts in general. `style-src` keeps its own
    // 'unsafe-inline', which is why the assertion is per-directive rather than on the
    // whole policy.
    const policy = policyWithInlineScripts(BASE_POLICY, ["'sha256-AAA='"]);
    const scriptSrc = policy
      .split(";")
      .find((part) => part.trim().startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("returns the policy unchanged when there is nothing to name", () => {
    expect(policyWithInlineScripts(BASE_POLICY, [])).toBe(BASE_POLICY);
  });

  it("does not invent a script-src directive a policy does not have", () => {
    // Adding one would change what `default-src` means for scripts, which is not this
    // function's decision to make.
    const policy = "default-src 'self'; object-src 'none'";
    expect(policyWithInlineScripts(policy, ["'sha256-AAA='"])).toBe(policy);
  });
});
