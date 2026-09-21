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

/* ------------------------------------------------------------ badge groups */

/**
 * One visual badge in the Branch / Tag column: GitKraken does not list refs,
 * it lists *logical branches*. A local `v2` and its `origin/v2` twin pointing
 * at the same commit render as a single pill whose icons say what it is
 * (a check for HEAD, a laptop for local, the remote's avatar for the remote);
 * they only split into two pills when the twins sit on different commits —
 * which, in a per-commit decoration list, happens by itself.
 */
export interface CommitRefBadgeGroup {
  /** The pill's label: the branch short name, tag name, or raw name. */
  readonly name: string;
  /**
   * The ref whose name anchors the pill — menu, test id, and the copy
   * actions. Priority: local, then remote, then tag, then other.
   */
  readonly primaryRefName: string;
  /** A local ref in the group is the branch HEAD is attached to. */
  readonly head: boolean;
  /** The group contains a local branch. */
  readonly local: boolean;
  /** Remote names with a twin in the group (`origin`, `upstream`, …). */
  readonly remotes: readonly string[];
  /** The group contains a tag. */
  readonly tag: boolean;
  /** Every constituent, for menus that must address one ref exactly. */
  readonly refs: readonly {
    readonly refName: string;
    readonly ref: CommitRef;
  }[];
}

/**
 * Cluster one commit's decoration names into badge groups.
 *
 * The symbolic remote HEAD ref (e.g. origin/HEAD) is dropped outright: it is
 * a pointer, not a branch, and rendering it is how a synced trunk reads as
 * three different pills. Everything else merges by branch short name — a
 * local branch and its remote twins share a pill, a tag never merges with a
 * branch even when they share a name.
 */
export function groupCommitRefs(
  refNames: readonly string[],
  currentBranch: string | null,
): readonly CommitRefBadgeGroup[] {
  const byKey = new Map<string, CommitRefBadgeGroup>();
  for (const refName of refNames) {
    const ref = classifyCommitRef(refName);
    if (ref.kind === "remote" && ref.branchName === "HEAD") {
      continue;
    }
    const key =
      ref.kind === "tag"
        ? `tag:${ref.tagName}`
        : ref.kind === "other"
          ? `other:${ref.fullName}`
          : ref.branchName;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        name: commitRefDisplayName(ref),
        primaryRefName: refName,
        head:
          ref.kind === "local" &&
          currentBranch !== null &&
          ref.branchName === currentBranch,
        local: ref.kind === "local",
        remotes: ref.kind === "remote" ? [ref.remoteName] : [],
        tag: ref.kind === "tag",
        refs: [{ refName, ref }],
      });
      continue;
    }
    const locals = existing.refs.filter(
      (entry) => entry.ref.kind === "local",
    );
    // The anchor prefers a local ref; keep the first one stable otherwise.
    const wantLocalAnchor =
      locals.length === 0 && ref.kind === "local";
    byKey.set(key, {
      ...existing,
      primaryRefName: wantLocalAnchor ? refName : existing.primaryRefName,
      head:
        existing.head ||
        (ref.kind === "local" &&
          currentBranch !== null &&
          ref.branchName === currentBranch),
      local: existing.local || ref.kind === "local",
      remotes:
        ref.kind === "remote" && !existing.remotes.includes(ref.remoteName)
          ? [...existing.remotes, ref.remoteName]
          : existing.remotes,
      tag: existing.tag || ref.kind === "tag",
      refs: [...existing.refs, { refName, ref }],
    });
  }
  return [...byKey.values()];
}
