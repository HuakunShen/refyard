# Exact-root embedded reads

**Timestamp:** 2026-09-27 00:48 +08
**Core decision/topic:** Add embedded status and worktree inventory reads scoped to one exact approved workspace root.

## Options considered

- Keep the existing embedded `status` entry and its first-root selection. Rejected: a sibling root could keep a request usable after the caller's root binding had been retired.
- Find a matching root by calling the broad `repositories()` projection and filtering it. Rejected: the projection probes every registered repository and makes unrelated registry state part of a scoped read.
- Change the existing standalone status/inventory behavior. Rejected: those APIs already serve standalone callers and retain their primary-worktree/full-inventory semantics.
- Add exact-root entry points that directly look up only the requested repository, resolve the exact root/worktree binding before leasing or Git I/O, and project inventory only for paths proven beneath that root. Chosen.

## Final decision and rationale

`status_for_root` selects the query's worktree together with the supplied `WorkspaceRootId` before acquiring the root lease or issuing Git commands. A missing worktree ID keeps `StatusQuery` semantics and therefore selects the primary worktree; callers targeting a linked-root worktree must provide its explicit ID. The root-scoped worktree inventory validates a current binding before I/O, then returns only rows represented in the exact-root canonical-containment sidecar. Existing standalone entry points remain unchanged.

This keeps root authority exact and avoids leaking sibling worktree display paths or branch metadata while preserving compatibility for standalone callers.

## Key changes made

- Added `ApplicationService` and `EmbeddedRefyard` methods `status_for_root(&StatusQuery, &WorkspaceRootId)` and `worktrees_with_root_bindings_for_root(&str, &WorkspaceRootId)`.
- Added regression coverage for wrong-repository roots, retired linked roots, exact linked-worktree selection, omitted-ID primary semantics, sibling-row exclusion, preservation of the standalone full inventory, and avoiding Git probes in unrelated registered repositories.
- No Xross source, vendored submodule, or Xross revision pin was changed.

## Future considerations

The Xross Task8 adapter can consume these methods after the Refyard revision is reviewed and pinned. It must still validate the requested repository/worktree/root tuple and canonical containment at its own boundary; this facade is an exact-root read capability, not a replacement for the adapter's ownership checks.
