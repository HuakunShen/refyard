/**
 * Remote URL → forge coordinates. The single source for this mapping.
 *
 * The host calls it to decide which provider API a repository's remote names
 * before any request is built, and the browser calls it for avatars and links
 * on the redacted display URL. Both callers must agree, so both import this
 * module; nothing else may parse a remote URL.
 *
 * Browser-safe by construction: string in, plain object out, no host global —
 * host-side code imports the same file. Only github.com counts while GitHub is
 * the one integration; a GitLab or self-hosted remote returns null, because
 * every URL a caller builds from this module would 404.
 */
import type { ProviderId } from "@refyard/git-contract";

export interface ProviderRepo {
  readonly provider: ProviderId;
  readonly owner: string;
  /** Repository name without the `.git` suffix. */
  readonly repo: string;
}

/** https://, http:// and ssh:// spellings; scp-like is handled below. */
const SCHEME = /^(?:https?|ssh):\/\//i;
const OWNER = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const REPO = /^[a-z0-9._-]+$/i;

export function providerRepoFromRemote(remoteUrl: string): ProviderRepo | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let host: string | null = null;
  let path: string | null = null;
  const scheme = SCHEME.exec(trimmed);
  if (scheme !== null) {
    // Scheme'd form: authority up to the first `/`, then the path. Userinfo
    // (`git@`, `user:pass@`) and a `:port` belong to the authority, never to
    // the coordinates — a hostile remote must not name the owner with them.
    const rest = trimmed.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      return null;
    }
    const authority = rest.slice(0, slash);
    path = rest.slice(slash + 1);
    const at = authority.lastIndexOf("@");
    host = (at === -1 ? authority : authority.slice(at + 1)).toLowerCase();
    const colon = host.indexOf(":");
    if (colon !== -1) {
      host = host.slice(0, colon);
    }
  } else {
    // scp-like: git@github.com:owner/repo.git
    const scp = /^(?:[^@/]+@)?([^/:]+):([^/].*)$/.exec(trimmed);
    if (scp === null) {
      return null;
    }
    host = scp[1]?.toLowerCase() ?? null;
    path = scp[2] ?? null;
  }
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }
  const segments = (path ?? "")
    .replace(/\.git$/i, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const owner = segments[0] ?? "";
  const repo = segments[1] ?? "";
  if (!OWNER.test(owner) || !REPO.test(repo)) {
    // Not a usable owner/repository pair (empty, `settings/`, a trajectory of
    // an attack); null is the honest answer and a link built from it a lie.
    return null;
  }
  return { provider: "github", owner, repo };
}
