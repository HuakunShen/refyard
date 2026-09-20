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
