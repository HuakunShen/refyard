/**
 * What one of a commit's decoration names is, once classified.
 *
 * Decoration names arrive as full ref names (`refs/heads/v2`), and every menu
 * on the Branch / Tag column needs to know which kind it is pointing at: a
 * local branch can be checked out, merged and deleted; a remote-tracking ref
 * can only be copied by name here; a tag can be deleted. `other` is the honest
 * fallback for a ref kind this UI does not model yet — it renders, and offers
 * nothing but its full name.
 */
export type CommitRef =
  | {
      readonly kind: "local";
      readonly fullName: string;
      readonly branchName: string;
    }
  | {
      readonly kind: "remote";
      readonly fullName: string;
      readonly remoteName: string;
      readonly branchName: string;
    }
  | {
      readonly kind: "tag";
      readonly fullName: string;
      readonly tagName: string;
    }
  | { readonly kind: "other"; readonly fullName: string };

const PREFIXES = {
  heads: "refs/heads/",
  remotes: "refs/remotes/",
  tags: "refs/tags/",
} as const;

export function classifyCommitRef(refName: string): CommitRef {
  if (refName.startsWith(PREFIXES.heads)) {
    return {
      kind: "local",
      fullName: refName,
      branchName: refName.slice(PREFIXES.heads.length),
    };
  }
  if (refName.startsWith(PREFIXES.remotes)) {
    const rest = refName.slice(PREFIXES.remotes.length);
    const separator = rest.indexOf("/");
    // A remote-tracking ref without a `remote/branch` shape has no remote to
    // name; it stays a remote ref whose display name is the whole tail.
    return separator === -1
      ? {
          kind: "remote",
          fullName: refName,
          remoteName: rest,
          branchName: rest,
        }
      : {
          kind: "remote",
          fullName: refName,
          remoteName: rest.slice(0, separator),
          branchName: rest.slice(separator + 1),
        };
  }
  if (refName.startsWith(PREFIXES.tags)) {
    return {
      kind: "tag",
      fullName: refName,
      tagName: refName.slice(PREFIXES.tags.length),
    };
  }
  return { kind: "other", fullName: refName };
}

/** The short label a badge shows: `v2`, `origin/v2`, `v1.0`. */
export function commitRefDisplayName(ref: CommitRef): string {
  switch (ref.kind) {
    case "local":
      return ref.branchName;
    case "remote":
      return `${ref.remoteName}/${ref.branchName}`;
    case "tag":
      return ref.tagName;
    case "other":
      return ref.fullName;
  }
}
