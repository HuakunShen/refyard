/**
 * Git name, URL and message shapes shared by operations and reads.
 *
 * These schemas only pin down what can be expressed at all (characters, length).
 * Whether a name is *legal for Git* — no `..`, no `@{`, no trailing `.lock`, no
 * leading dash — is checked by `validate.ts`, because those rules are
 * cross-character rules that JSON Schema cannot state and that must be exercised
 * by their own tests.
 */
import { z } from "zod";
import { pathIdSchema, previewTokenSchema } from "./ids.js";
import { LIMITS } from "./limits.js";

/** Characters Git forbids everywhere in a ref name component. */
const NAME_BODY = /^[^\u0000-\u0020\u007f~^:?*[\\]+$/;

export const branchNameSchema = z
  .string()
  .min(1)
  .max(LIMITS.branchNameMaxLength)
  .regex(
    NAME_BODY,
    "branch names cannot contain control characters, spaces, or ~ ^ : ? * [ \\",
  )
  .meta({
    id: "BranchName",
    description:
      "A short branch name such as `main` or `feature/graph-paging`.",
  });

export const tagNameSchema = z
  .string()
  .min(1)
  .max(LIMITS.branchNameMaxLength)
  .regex(
    NAME_BODY,
    "tag names cannot contain control characters, spaces, or ~ ^ : ? * [ \\",
  )
  .meta({ id: "TagName", description: "A short tag name such as `v1.2.0`." });

export const remoteNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/,
    "remote names are 1–64 characters of [A-Za-z0-9._-]",
  )
  .meta({
    id: "RemoteName",
    description: "A configured remote name such as `origin`.",
  });

/** A fully qualified ref, e.g. `refs/heads/main`. Push never accepts a bare short name. */
export const fullRefNameSchema = z
  .string()
  .min(6)
  .max(1024)
  .regex(
    /^refs\/[^\u0000-\u0020\u007f~^:?*[\\]+$/,
    "must be a fully qualified ref under refs/",
  )
  .meta({
    id: "FullRefName",
    description:
      "Fully qualified ref such as `refs/heads/main` or `refs/tags/v1.0.0`. Explicit source and destination refs keep a push from inheriting surprise refspecs.",
  });

/**
 * A remote URL or explicitly approved local path.
 *
 * Only the type and length are pinned here. Which schemes are accepted, and why
 * `ext::` is refused, are semantic rules in `validate.ts` — a pattern here would
 * fire first and report "spaces are not allowed" for a URL whose real problem is
 * that it names a command to run.
 */
export const remoteUrlSchema = z.string().min(1).max(2048).meta({
  id: "RemoteUrl",
  description:
    "https:// or ssh:// URL, scp-like `user@host:path`, or an absolute local path the user approved. Credentials are redacted before display or logging.",
});

/** `stash@{n}` is a moving label, so it is only ever sent together with an OID. */
export const stashLocatorSchema = z
  .string()
  .regex(/^stash@\{\d+\}$/, "must look like stash@{0}")
  .meta({
    id: "StashLocator",
    description: "Reflog locator of a stash entry, e.g. `stash@{2}`.",
  });

export const stashRefSchema = z
  .strictObject({
    oid: z
      .string()
      .regex(/^[0-9a-f]{40}$/, "stash OIDs are SHA-1 object names"),
    locator: stashLocatorSchema,
  })
  .meta({
    id: "StashRef",
    description:
      "A stash identified by object name, with the locator it was listed under. The host re-checks that the locator still points at that object before any write.",
  });

/** A commit message travelling to `git commit -F -`, never through a shell. */
export const commitMessageSchema = z
  .string()
  .min(1)
  .max(LIMITS.commitMessageMaxBytes)
  .refine(
    (value) => !value.includes("\u0000"),
    "commit messages cannot contain NUL",
  )
  .meta({
    id: "CommitMessage",
    description: `Message passed on stdin as UTF-8 bytes. Maximum ${LIMITS.commitMessageMaxBytes} bytes; empty or whitespace-only messages are rejected.`,
  });

/**
 * Paths selected for an operation, with the preview tokens that authorise them.
 *
 * These two arrays are positional: entry *i* of `previewTokens` authorises entry
 * *i* of `pathIds`. `validate.ts` rejects a request whose lengths differ or whose
 * ids repeat, so an off-by-one can never silently authorise the wrong file.
 */
export const pathSelectionSchema = z
  .strictObject({
    pathIds: z.array(pathIdSchema).min(1).max(LIMITS.pathSelectionMaxEntries),
    previewTokens: z
      .array(previewTokenSchema)
      .min(1)
      .max(LIMITS.pathSelectionMaxEntries),
  })
  .meta({
    id: "PathSelection",
    description:
      "Paths plus their content-fingerprint tokens; lengths must match exactly.",
  });

/** Paths without preview tokens: operations that cannot lose content. */
export const plainPathSelectionSchema = z
  .strictObject({
    pathIds: z.array(pathIdSchema).min(1).max(LIMITS.pathSelectionMaxEntries),
  })
  .meta({
    id: "PlainPathSelection",
    description: "Paths addressed by id, in this worktree.",
  });

export type BranchName = z.infer<typeof branchNameSchema>;
export type TagName = z.infer<typeof tagNameSchema>;
export type RemoteName = z.infer<typeof remoteNameSchema>;
export type FullRefName = z.infer<typeof fullRefNameSchema>;
export type RemoteUrl = z.infer<typeof remoteUrlSchema>;
export type StashLocator = z.infer<typeof stashLocatorSchema>;
export type StashRef = z.infer<typeof stashRefSchema>;
export type CommitMessage = z.infer<typeof commitMessageSchema>;
export type PathSelection = z.infer<typeof pathSelectionSchema>;
export type PlainPathSelection = z.infer<typeof plainPathSelectionSchema>;
