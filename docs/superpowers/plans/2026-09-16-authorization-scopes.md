# Authorization Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Refyard's advertised session scopes enforce real read, local-write, network and workspace-management authority without weakening repository/root grants.

**Architecture:** Route definitions declare their required semantic scope. Hono checks that scope after request parsing and before repository/root grant checks or route handlers. Mutation scope is a total mapping over all 35 mutation kinds; MCP and SSE require read authority. Repository/root grants remain independent and mandatory.

**Tech Stack:** TypeScript, Hono, Zod contract routes, Vitest integration tests.

**Spec:** `docs/product/git-client-direction.md` §15

## Global constraints

- `repository:read`, `repository:write`, `repository:network`, `workspace:manage` have distinct meanings.
- `repository:*` may satisfy any repository operation scope but never grants a repository id.
- The default local CLI receives all four scopes so normal GUI behavior is unchanged.
- Network operations are `fetch`, `pull`, `push`, and `pushTag`; remote configuration itself is a local write.
- Workspace mutations are `initRepository` and `cloneRepository`; register/revoke also require workspace management.
- Invalid requests remain validation errors; scope classification must not execute or normalize them.

### Task 1: Lock scope behavior with real HTTP cases

- [x] Allow the test service to choose session scopes while keeping all four as its default.
- [x] Add cases for read-only, write-without-network, network-without-write, and workspace denial.
- [x] Add an auth-store case proving `repository:*` cannot widen repository grants.
- [x] Run the focused tests and prove they fail because scopes are not enforced.

### Task 2: Make route scope part of GitService semantics

- [x] Add typed authorization scopes and `allowsScope` to the auth store.
- [x] Remove the current `repository:*` repository-id bypass.
- [x] Add a total mutation-kind-to-scope mapping.
- [x] Make every route definition declare or derive a required scope.
- [x] Enforce required scope in Hono before repository/root grant checks.
- [x] Require read scope for SSE and MCP.
- [x] Give the normal CLI all four explicit scopes.

### Task 3: Verify the security boundary

- [x] Run focused scope/auth/Hono cases.
- [x] Run `pnpm check`, `pnpm check:contract`, `pnpm test:unit`, and `pnpm test:integration`.
- [x] Run `git diff --check`.
- [x] Commit `feat(host-node): enforce authorization scopes`.
