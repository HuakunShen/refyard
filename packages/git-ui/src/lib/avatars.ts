/**
 * Author avatars for the history table: a GitHub photo where the commit email
 * identifies a GitHub account, and locally generated initials otherwise.
 *
 * The mapping is pure — no network happens here. GitHub commits since 2017
 * carry `{id}+{username}@users.noreply.github.com` (older ones the bare
 * `{username}@` form), and `github.com/<username>.png` serves that account's
 * avatar as a redirect into avatars.githubusercontent.com. Every other author
 * gets deterministic initials tinted by a hash of their email, so the same
 * person keeps the same colour across sessions without anything being stored.
 */

export interface GithubAvatar {
  readonly kind: "github";
  readonly url: string;
  readonly username: string;
}

export interface InitialsAvatar {
  readonly kind: "initials";
  readonly initials: string;
  /** Hue in degrees; lightness/chroma are fixed so themes stay legible. */
  readonly hue: number;
}

export type AuthorAvatar = GithubAvatar | InitialsAvatar;

const GITHUB_NOREPLY_WITH_ID = /^(\d+)\+([a-z0-9-]+)@users\.noreply\.github\.com$/i;
const GITHUB_NOREPLY_LEGACY = /^([a-z0-9-]+)@users\.noreply\.github\.com$/i;

export function authorAvatar(email: string, name: string): AuthorAvatar {
  const trimmed = email.trim();
  const withId = GITHUB_NOREPLY_WITH_ID.exec(trimmed);
  const legacy = GITHUB_NOREPLY_LEGACY.exec(trimmed);
  const username = (withId?.[2] ?? legacy?.[1])?.toLowerCase();
  if (username !== undefined) {
    return {
      kind: "github",
      username,
      url: `https://github.com/${username}.png?size=80`,
    };
  }
  return initialsAvatar(email, name);
}

export function initialsAvatar(email: string, name: string): InitialsAvatar {
  return {
    kind: "initials",
    initials: initialsOf(name, email),
    hue: hueOf(`${email}\u0000${name}`),
  };
}

function initialsOf(name: string, email: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => Array.from(word)[0] ?? "");
  const fromName = words.slice(0, 2).join("");
  if (fromName.length > 0) {
    return fromName.toUpperCase();
  }
  const local = email.trim().split("@")[0] ?? "";
  const letters = Array.from(local).filter((ch) => /[a-z0-9]/i.test(ch));
  return (letters.slice(0, 2).join("") || "?").toUpperCase();
}

/**
 * FNV-1a over the input, folded into a hue. Only stability matters — the same
 * author must land on the same colour, and collisions are merely cosmetic.
 */
function hueOf(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}

/**
 * The avatar of the GitHub account that owns a remote, for the remote badge's
 * identity icon: `https://github.com/drizzle-team/x.git` yields the
 * drizzle-team photo. Accepts the https and scp-like ssh shapes; anything that
 * is not a github.com host returns null and the badge falls back to a globe.
 *
 * The input is the already-redacted display URL — the host strips credentials
 * before it ever reaches the browser, and this function re-strips the userinfo
 * anyway so a hostile value cannot smuggle one into the constructed URL.
 */
export function githubOwnerAvatarUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let host: string | null = null;
  let path: string | null = null;
  const scheme = /^https?:\/\//i.exec(trimmed);
  if (scheme !== null) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname.toLowerCase();
      path = parsed.pathname;
    } catch {
      return null;
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
  const owner =
    path
      ?.replace(/^\/+/, "")
      .replace(/\.git$/i, "")
      .split("/")[0]
      ?.trim() ?? "";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(owner)) {
    // Not a usable account name (empty, `settings/`, trajectory of an attack);
    // the globe is the honest icon.
    return null;
  }
  return `https://github.com/${owner}.png?size=40`;
}
