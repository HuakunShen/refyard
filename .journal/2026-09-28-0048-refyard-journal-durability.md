# 2026-09-28 00:48 SGT — Journal startup durability and rollback-safe migration

**Timestamp:** 2026-09-28 00:48 +08  
**Core decision/topic:** Make Refyard's preview-bound admission and owner-seal journal recoverable without turning uncertain or rolled-back authority into an empty journal.

## Options considered

- Reject every pre-existing `journal/` directory whose index is absent. Rejected: the preceding Refyard release created `journal/records` during read-only opens, so users who never mutated a repository would be locked out on upgrade.
- Treat any missing index as fresh when there are no operation records. Rejected: owner-seal tombstones have no operation record, so this would forget negative admission authority.
- Rely only on `serde(default)` for fields added to the index. Rejected: a prior Refyard binary ignores the new fields and can rewrite them away while leaving the root marker intact.
- Sync only directories observed missing during `create_dir_all`. Rejected: a failed sync leaves the created paths behind, and the next process must not treat their existence as proof that the earlier sync succeeded.
- Sync the authority directory chain at every successful open and require a versioned current index under an established marker. Chosen: startup repairs safe unmarked legacy state first, then re-establishes directory durability before the service can admit or seal work.

## Final decision and rationale

Only an unmarked v0 journal with no published operation-record files may be initialized or upgraded in place. It is rewritten as index schema v1, with `boundRequests` and `ownerSeals` present, before the durable root marker is written. A marked journal must have the current schema and both authority arrays; missing or older schema fails closed. This makes a rollback writer's legacy-shaped rewrite visible rather than interpreting erased tombstones as an empty set.

On startup, Refyard syncs the directory chain beginning at `records/` and continuing through `journal/`, the state root, and its ancestors before exposing the host. It repeats the sync on every open so a prior post-rename or directory-creation sync failure cannot be bypassed merely because the path now exists. `EmbeddedRefyard::open` delegates root creation to this journal-owned path rather than creating it first.

## Key changes made

- Added a versioned index schema and strict validation of current-version authority fields.
- Preserved safe migration for a pre-marker empty legacy journal while refusing a missing index beside published records or a root marker.
- Made state-root and authority-directory sync failures prevent startup, including retries after partially created paths.
- Added regression tests for empty legacy migration, rollback rewrite, missing v1 authority arrays, and retried directory sync.
- Recorded the deferred P2 about an owner-seal retry returning a pruned operation correlation in the Xross review follow-ups; no P2 behavior change was made here.

## Verification

- `cargo test --locked --offline -p refyard-host`: 239 unit tests and all active host integration groups passed; fixture suites marked ignored remain intentionally ignored.
- `cargo clippy --locked --offline -p refyard-host --all-targets -- -D warnings`: passed.
- `cargo check --locked --offline -p refyard-host --target x86_64-pc-windows-msvc`: passed as a compile check only, not Windows runtime durability evidence.
- Read-only GPT-6 Sol High review found no remaining P0/P1 in the revised migration, rollback, or startup-sync paths.

## Future considerations

Windows runtime directory-metadata durability has not been exercised here; the existing `MoveFileExW(MOVEFILE_WRITE_THROUGH)` replacement path remains the documented Windows publication primitive. The Refyard change is not yet pinned or pushed into the Xross parent; full standalone verification and exact-head vendor advancement remain separate gates.
