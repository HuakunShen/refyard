/**
 * The document's own inline scripts, named by hash instead of by blanket permission.
 *
 * The policy in `assets.ts` says `script-src 'self'`, and that is the right default: no
 * remote script, no CDN, no eval. But a single-page app cannot boot under it — the shell a
 * static build emits starts the app with an inline `<script>`, and an inline script is not
 * `'self'`. The choice is therefore between weakening the policy for every inline script
 * (`'unsafe-inline'`) and naming the one the document actually contains.
 *
 * Naming it by hash is the narrow option, and it is computed here, at serve time, from the
 * bytes about to be sent: the policy cannot drift from the document, and a build that
 * changes its bootstrap script changes its hash in the same step. With no inline script the
 * policy is untouched, so the placeholder page this installation serves before a web build
 * exists keeps the strictest form.
 *
 * What this does and does not protect against: it still stops the page from loading script
 * from anywhere else, and it still stops an *injected* inline script (an XSS payload has a
 * different hash and is refused). It does not protect against someone who can already
 * rewrite files inside the web root — such an attacker controls the document and would be
 * allowed to run the script they just wrote into it, which is why the web root is the
 * packaged bundle and nothing else.
 */
import { createHash } from "node:crypto";

/**
 * Inline `<script>` bodies: elements without a `src` attribute.
 *
 * Deliberately not a parser. A false negative (a script this pattern misses) leaves the
 * strict policy in place and the script blocked, which is the safe direction; a false
 * positive is impossible to act on, because the hash of a script the browser does not
 * consider inline would simply never be used.
 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/** Every inline script body in a document, hashed the way CSP specifies. */
export function inlineScriptHashes(html: string): readonly string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const body = match[1] ?? "";
    if (body.trim().length === 0) {
      continue;
    }
    hashes.push(
      `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
    );
  }
  return hashes;
}

/**
 * The same policy with the named hashes added to `script-src`.
 *
 * A policy without a `script-src` directive is returned unchanged: adding hashes to a
 * directive that does not exist would turn `default-src 'self'` into something else, and
 * this function's only job is to name scripts the document already contains.
 */
export function policyWithInlineScripts(
  policy: string,
  hashes: readonly string[],
): string {
  if (hashes.length === 0 || !/script-src/i.test(policy)) {
    return policy;
  }
  return policy.replace(
    /(script-src[^;]*)/i,
    (directive) => `${directive.trimEnd()} ${hashes.join(" ")}`,
  );
}
