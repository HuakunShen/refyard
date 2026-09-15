# Form 2 evidence — managed workspaces

This is evidence for runtime repository approval and revocation, not a claim of multi-user
isolation or a security audit. The service still runs as one local OS user; every access change is
explicitly selected by that user and is recorded in the private access journal.

## Revision and environment

| Item | Value |
| --- | --- |
| Revision under test | `4c0ad74` plus the R4 working changes recorded with this evidence |
| OS | macOS arm64 (the current development machine) |
| Node | v26.8.2 |
| Git | 2.50.1 (Apple Git-155) |
| Repository fixtures | isolated temporary repositories with private HOME/config and no network |

## Behaviours exercised

The real CLI assembly and HTTP service were used. The integration case created one initial
repository, a second repository outside its root, and a nested repository inside its root.

| Behaviour | Observed result |
| --- | --- |
| Register nested repository | `POST /api/v1/repositories/register` returned 200; the existing root remained one root and the nested repository became readable in the current session |
| Register repository under a new root | returned 200; the response listed two repositories and two independently approved roots |
| Register a non-repository path | returned 404; no repository was added |
| Register a path inside `.git` | returned 403; no repository was added |
| Register the same path twice | returned 409; the existing record was not duplicated |
| Revoke the nested repository | returned 200; it disappeared from the list and the current session's status read returned 403 |
| Audit durability | `access.jsonl` contained register and revoke records with the canonical path, root id, repository id, actor and timestamp; a new service over the same private state root loaded both records |
| CLI scope | `serve --repo A --repo B` approved two independent roots and listed/read both; an unnamed third fixture was absent and not granted |

## Commands actually run

```text
pnpm exec vitest run tests/integration/managed-workspaces.test.ts
1 passed

pnpm exec vitest run tests/integration/auth.test.ts tests/integration/managed-workspaces.test.ts tests/integration/cli.test.ts
60 passed, 0 failed

pnpm build
1 successful turbo build task

pnpm exec playwright test tests/e2e/workspace.spec.ts --project=chromium
4 passed

pnpm check
8 workspace checks successful

pnpm check:contract
441 named schemas, every $ref resolves
```

The loopback integration and browser commands were run outside the default filesystem sandbox so
the temporary HTTP listeners could bind. No Cloudflare deployment, remote tunnel or second OS
user was exercised by this evidence; those remain separate rows in the release and security
matrices.
